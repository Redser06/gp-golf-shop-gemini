/**
 * Stdio JSON-RPC 2.0 Client for Global Payments MCP Server.
 *
 * Spawns the MCP server child process, performs protocol handshake,
 * routes tool calls, and intercepts raw HTTP telemetry mirrored on stderr.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const MCP_DIR = path.join(PROJECT_ROOT, 'mcp-server');
export const MCP_SERVER_PATH = path.join(MCP_DIR, 'lib', 'core', 'index.js');
const PROTOCOL_VERSION = '2024-11-05';
const HTTP_EVENT_PREFIX = 'GPAPI_HTTP_EVENT ';

export function readDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export class McpStdioClient {
  constructor({ serverPath, env = {}, onEvent = () => {} }) {
    this.serverPath = serverPath;
    this.extraEnv = env;
    this.onEvent = onEvent;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject, timer, method }
    this.serverInfo = null;
    this.tools = [];
  }

  start() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.serverPath)) {
        return reject(new Error(`MCP server executable missing at: ${this.serverPath}`));
      }

      const procEnv = {
        ...process.env,
        DEBUG_API_CALLS: 'true',
        DEBUG: 'true',
        ...this.extraEnv,
      };

      this.proc = spawn('node', [this.serverPath], {
        env: procEnv,
        cwd: path.dirname(this.serverPath),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let handshakeDone = false;

      this.proc.on('error', (err) => {
        this.onEvent({ kind: 'sys', level: 'error', text: `MCP process error: ${err.message}` });
        if (!handshakeDone) reject(err);
      });

      this.proc.on('exit', (code, sig) => {
        this.onEvent({
          kind: 'sys',
          level: 'warn',
          text: `MCP process exited (code ${code}, sig ${sig})`,
        });
        for (const { reject: pReject } of this.pending.values()) {
          pReject(new Error(`MCP process exited with code ${code}`));
        }
        this.pending.clear();
      });

      // Parse JSON-RPC frames on stdout
      const rlOut = createInterface({ input: this.proc.stdout });
      rlOut.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const frame = JSON.parse(trimmed);
          this.handleFrame(frame);
        } catch {
          this.onEvent({ kind: 'sys', level: 'debug', text: `[stdout] ${trimmed}` });
        }
      });

      // Parse stderr (logs and mirrored HTTP calls)
      const rlErr = createInterface({ input: this.proc.stderr });
      rlErr.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed.startsWith(HTTP_EVENT_PREFIX)) {
          const raw = trimmed.slice(HTTP_EVENT_PREFIX.length);
          try {
            const httpPayload = JSON.parse(raw);
            this.onEvent({
              kind: 'http',
              ...httpPayload,
              at: Date.now(),
            });
            return;
          } catch {
            /* fall through */
          }
        }

        this.onEvent({ kind: 'sys', level: 'info', text: trimmed });
      });

      // Perform MCP initialization handshake
      this.initialize()
        .then(async (initResult) => {
          this.serverInfo = initResult;
          this.notify('notifications/initialized');
          const list = await this.listTools();
          this.tools = list.tools || [];
          handshakeDone = true;
          resolve({ client: this, tools: this.tools, serverInfo: this.serverInfo });
        })
        .catch((err) => {
          handshakeDone = true;
          reject(err);
        });
    });
  }

  send(msg) {
    if (!this.proc || this.proc.killed) {
      throw new Error('MCP process is not running');
    }
    const line = JSON.stringify(msg) + '\n';
    this.proc.stdin.write(line);
    this.onEvent({
      kind: 'mcp',
      dir: 'out',
      frame: msg,
      at: Date.now(),
    });
  }

  request(method, params, timeoutMs = 25000) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout (${method}, id=${id}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.send(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    this.send(msg);
  }

  handleFrame(frame) {
    this.onEvent({
      kind: 'mcp',
      dir: 'in',
      frame,
      at: Date.now(),
    });

    if (frame.id !== undefined && this.pending.has(frame.id)) {
      const { resolve, reject, timer } = this.pending.get(frame.id);
      clearTimeout(timer);
      this.pending.delete(frame.id);

      if (frame.error) {
        reject(new Error(`MCP error ${frame.error.code}: ${frame.error.message}`));
      } else {
        resolve(frame.result);
      }
    }
  }

  async initialize() {
    return this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'gp-golf-shop-gemini',
        version: '1.0.0',
      },
    });
  }

  async listTools() {
    return this.request('tools/list', {});
  }

  async callTool(name, args = {}) {
    return this.request('tools/call', {
      name,
      arguments: args,
    });
  }

  async close() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
  }
}

export async function startMcpServer({ onEvent = () => {} } = {}) {
  const mcpEnvFile = path.join(MCP_DIR, '.env');
  const mcpEnv = readDotEnv(mcpEnvFile);

  const client = new McpStdioClient({
    serverPath: MCP_SERVER_PATH,
    env: mcpEnv,
    onEvent,
  });

  const res = await client.start();
  return res;
}
