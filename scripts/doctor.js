/**
 * Pre-flight diagnostic checker for The Augusta Collection (Gemini 3.8 Flash).
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PORT = 8942;

async function checkPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close();
      resolve(true);
    });
    srv.listen(port);
  });
}

async function run() {
  console.log('\n  ⛳ The Augusta Collection (Gemini 3.8 Flash) — Pre-flight Check\n');
  let issues = 0;

  // 1. MCP Server build
  const mcpBin = path.join(ROOT, 'mcp-server', 'lib', 'core', 'index.js');
  if (fs.existsSync(mcpBin)) {
    console.log('  ✓ MCP Server binary found: mcp-server/lib/core/index.js');
  } else {
    console.log('  ✗ MCP Server binary missing. Build mcp-server first.');
    issues++;
  }

  // 2. Global Payments Sandbox credentials
  const envFile = path.join(ROOT, 'mcp-server', '.env');
  if (fs.existsSync(envFile)) {
    const txt = fs.readFileSync(envFile, 'utf8');
    if (txt.includes('GPAPI_APP=')) {
      console.log('  ✓ Global Payments sandbox credentials present');
    } else {
      console.log('  ✗ GPAPI_APP missing in mcp-server/.env');
      issues++;
    }
  } else {
    console.log('  ✗ mcp-server/.env missing');
    issues++;
  }

  // 3. Model API Key
  const candidates = [
    path.join(ROOT, '.env'),
    path.join(process.env.HOME || '', '.hermes', '.env'),
    path.join(process.env.HOME || '', '.hermes', 'profiles', 'coder-prototyper', '.env'),
  ];
  let foundKey = false;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const match = fs.readFileSync(c, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (match && match[1]) {
        foundKey = true;
        console.log(`  ✓ OPENROUTER_API_KEY found in ${path.basename(c)}`);
        break;
      }
    }
  }
  if (!foundKey) {
    console.log('  ✗ OPENROUTER_API_KEY not found');
    issues++;
  }

  // 4. macOS Mail check
  try {
    await execFileAsync('osascript', ['-e', 'tell application "Mail" to return name']);
    console.log('  ✓ macOS Mail application online');
  } catch (err) {
    console.log(`  ✗ macOS Mail unavailable: ${err.message}`);
    issues++;
  }

  // 5. Port 8942 check
  const portFree = await checkPortFree(PORT);
  if (portFree) {
    console.log(`  ✓ Port ${PORT} is free`);
  } else {
    console.log(`  ! Port ${PORT} is in use (server may already be running)`);
  }

  console.log(`\n  Diagnostic finished. ${issues} issue(s) detected.\n`);
  process.exit(issues ? 1 : 0);
}

run();
