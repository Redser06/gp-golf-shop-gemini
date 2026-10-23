/**
 * The Augusta Collection & Fairway Club — Server.
 *
 * Runs on Port 8942.
 * Powered by Antigravity + Google Gemini 3.8 Flash.
 * Drives Global Payments MCP Server over stdio.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { startMcpServer } from './lib/mcp-client.js';
import { GeminiAgent, loadApiKey } from './lib/gemini-agent.js';
import { CATALOGUE, findItem, cartTotals, cartSummary, formatAmount } from './lib/catalogue.js';
import { sendViaMacMail, buildEmailBody } from './lib/emailer.js';
import { PaymentWatcher } from './lib/payment-watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8942);
const HOST = process.env.HOST || '127.0.0.1';

const BUILD_ID = `augusta-gemini38@${new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, 'Z')}.${crypto.randomBytes(4).toString('hex')}`;

const SHOP = {
  name: 'The Augusta Collection',
  orderRef: 'AUGUSTA-GOLF-3BALLS',
  customerEmail: 'conor.a.redmond+deals@gmail.com',
  senderEmail: 'conor.a.redmond@gmail.com',
};

/* ------------------------------------------------------------------ state */

const state = {
  phase: 'idle', // idle | browsing | checking_out | link_ready | paid | failed
  cartCount: 0,
  cart: [], // [{ id, qty }]
  customerEmail: SHOP.customerEmail,
  link: null,
  linkStatus: null,
  emailResult: null,
  lastError: null,
  messages: [],
};

const sseClients = new Set();
const pollWaiters = new Set();
const eventLog = [];
const EVENT_LOG_LIMIT = 500;
let seq = 0;

let mcpClient = null;
let mcpTools = [];
let mcpStatus = { state: 'booting', detail: 'Spawning MCP server over stdio…' };
let agent = null;
let watcher = null;

function broadcast(event, { log = true } = {}) {
  const payload = { ...event, seq: ++seq, at: Date.now() };
  if (log) {
    eventLog.push(payload);
    if (eventLog.length > EVENT_LOG_LIMIT) eventLog.shift();
  }

  // Wake long-poll waiters
  for (const waiter of [...pollWaiters]) {
    if (waiter.since < payload.seq) {
      pollWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.respond([payload]);
    }
  }

  // SSE broadcast
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(line);
    } catch {
      sseClients.delete(client);
    }
  }
  return payload;
}

function sink(event) {
  if (event.kind === 'mcp') {
    broadcast(event);
    return;
  }
  if (event.kind === 'http') {
    broadcast(event);
    return;
  }
  if (event.kind === 'sys') {
    broadcast(event);
    return;
  }
  broadcast(event);
}

function seedAgentContext() {
  if (!agent) return;
  const totals = cartTotals(state.cart);
  const context = {
    role: 'system',
    content: `ORDER CONTEXT:
Customer Email: ${state.customerEmail}
Cart Items: ${cartSummary(state.cart)}
Total: ${totals.label} (${totals.total} cents).
The amount for create_payment_link is "${totals.total}".
Currency: USD, Country: US.
Order Reference: ${SHOP.orderRef}`,
  };

  const existing = agent.history.findIndex((m) => m.role === 'system' && m._orderContext);
  if (existing >= 0) {
    agent.history[existing] = { ...context, _orderContext: true };
  } else {
    agent.history.push({ ...context, _orderContext: true });
  }
}

function publicState() {
  const totals = cartTotals(state.cart);
  return {
    phase: state.phase,
    cartCount: totals.count,
    cart: state.cart,
    cartTotal: totals.total,
    cartTotalLabel: totals.label,
    customerEmail: state.customerEmail,
    link: state.link,
    linkStatus: state.linkStatus,
    emailResult: state.emailResult,
    lastError: state.lastError,
    messages: state.messages,
  };
}

/* ------------------------------------------------------------- http utils */

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Build-Id': BUILD_ID,
      'X-Harness': 'Antigravity',
      'X-Model': 'Gemini 3.8 Flash',
    };
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* -------------------------------------------------------------- checkout */

async function finalizeCheckout(link) {
  state.link = link;
  state.linkStatus = link.status || 'ACTIVE';
  state.phase = 'link_ready';

  const totals = cartTotals(state.cart);
  const subject = `Your order from ${SHOP.name} — ${cartSummary(state.cart)} (${totals.label})`;
  const body = buildEmailBody({
    shopName: SHOP.name,
    items: cartSummary(state.cart),
    amountDisplay: totals.label,
    linkUrl: link.url,
    linkId: link.id,
    orderRef: SHOP.orderRef,
  });

  broadcast({
    kind: 'email',
    phase: 'dispatching',
    to: state.customerEmail,
    subject,
  });

  const mailResult = await sendViaMacMail({
    to: state.customerEmail,
    subject,
    body,
    from: SHOP.senderEmail,
  });

  state.emailResult = { ...mailResult, to: state.customerEmail, subject };

  broadcast({
    kind: 'email',
    phase: mailResult.ok ? 'delivered' : 'failed',
    to: state.customerEmail,
    subject,
    via: mailResult.transport,
  });

  startWatchingPayment(link.id);
  broadcast({ kind: 'state', state: publicState() });
}

function startWatchingPayment(linkId) {
  if (!mcpClient) return;
  watcher?.stop();
  watcher = new PaymentWatcher({
    mcpClient,
    onStatus: (status, link) => {
      state.linkStatus = status;
      if (link) state.link = { ...state.link, ...link };
      broadcast({ kind: 'link_status', status, link: state.link });
      broadcast({ kind: 'state', state: publicState() });
    },
    onPaid: (link) => {
      state.linkStatus = 'PAID';
      state.phase = 'paid';
      broadcast({ kind: 'paid', link, amount: cartTotals(state.cart).label });
      broadcast({ kind: 'state', state: publicState() });
    },
  });
  watcher.watch(linkId);
}

/* ---------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(
      `data: ${JSON.stringify({
        kind: 'hello',
        state: publicState(),
        mcp: mcpStatus,
        tools: mcpTools.map((t) => t.name),
        harness: 'Antigravity',
        model: 'Gemini 3.8 Flash',
      })}\n\n`
    );

    for (const past of eventLog) {
      res.write(`data: ${JSON.stringify(past)}\n\n`);
    }

    sseClients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* closed */
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  if (pathname === '/api/poll' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const waitMs = Math.min(Number(url.searchParams.get('wait') || 1200), 8000);

    if (since === 0) {
      const hello = {
        kind: 'hello',
        state: publicState(),
        mcp: mcpStatus,
        tools: mcpTools.map((t) => t.name),
        harness: 'Antigravity',
        model: 'Gemini 3.8 Flash',
      };
      return json(res, 200, { events: [hello, ...eventLog], seq });
    }

    const pending = eventLog.filter((e) => e.seq > since);
    if (pending.length) {
      return json(res, 200, { events: pending, seq: pending[pending.length - 1].seq });
    }

    const waiter = {
      since,
      respond: (events) => {
        pollWaiters.delete(waiter);
        try {
          json(res, 200, { events, seq: events.length ? events[events.length - 1].seq : since });
        } catch {
          /* disconnected */
        }
      },
    };
    waiter.timer = setTimeout(() => {
      pollWaiters.delete(waiter);
      try {
        json(res, 200, { events: [], seq: since });
      } catch {
        /* disconnected */
      }
    }, waitMs);

    pollWaiters.add(waiter);
    req.on('close', () => {
      clearTimeout(waiter.timer);
      pollWaiters.delete(waiter);
    });
    return;
  }

  if (pathname === '/api/health') {
    return json(res, 200, {
      ok: mcpStatus.state === 'ready',
      buildId: BUILD_ID,
      harness: 'Antigravity',
      model: 'google/gemini-3.8-flash',
      mcp: mcpStatus,
      tools: mcpTools.length,
      state: publicState(),
    });
  }

  if (pathname === '/api/catalogue') {
    return json(res, 200, { catalogue: CATALOGUE });
  }

  if (pathname === '/api/state') {
    return json(res, 200, { state: publicState(), mcp: mcpStatus, tools: mcpTools.map((t) => t.name) });
  }

  if (pathname === '/api/cart/add' && req.method === 'POST') {
    const body = await readBody(req);
    const item = findItem(body.id);
    if (!item) return json(res, 400, { error: 'Unknown product' });

    if (state.phase === 'paid') {
      state.cart = [];
      state.link = null;
      state.linkStatus = null;
      state.phase = 'idle';
    }

    const existing = state.cart.find((l) => l.id === item.id);
    if (existing) existing.qty += 1;
    else state.cart.push({ id: item.id, qty: 1 });

    state.phase = 'browsing';
    seedAgentContext();
    broadcast({ kind: 'cart_updated', state: publicState() });
    return json(res, 200, { ok: true, state: publicState() });
  }

  if (pathname === '/api/cart/remove' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '');
    state.cart = state.cart.filter((l) => l.id !== id);
    seedAgentContext();
    broadcast({ kind: 'cart_updated', state: publicState() });
    return json(res, 200, { ok: true, state: publicState() });
  }

  if (pathname === '/api/cart/clear' && req.method === 'POST') {
    state.cart = [];
    seedAgentContext();
    broadcast({ kind: 'cart_updated', state: publicState() });
    return json(res, 200, { ok: true, state: publicState() });
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const message = String(body.message || '').trim();
    if (!message) return json(res, 400, { error: 'Message required' });

    state.messages.push({ role: 'user', content: message });
    broadcast({ kind: 'user_message', text: message });

    try {
      const result = await agent.chat(message, {
        mcpClient,
        mcpTools,
        customerEmail: state.customerEmail,
      });

      state.messages.push({ role: 'assistant', content: result.reply });
      if (result.link) {
        await finalizeCheckout(result.link);
      }
      broadcast({ kind: 'assistant_reply', reply: result.reply });
      broadcast({ kind: 'state', state: publicState() });
      return json(res, 200, { ok: true, reply: result.reply, link: result.link });
    } catch (err) {
      broadcast({ kind: 'agent_error', error: err.message });
      return json(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/checkout' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.email) state.customerEmail = String(body.email);

    const totals = cartTotals(state.cart);
    if (!totals.count) return json(res, 400, { error: 'Bag is empty' });

    state.phase = 'checking_out';
    broadcast({ kind: 'phase', phase: state.phase });

    const prompt =
      body.prompt ||
      `I would like to purchase ${cartSummary(state.cart)} for ${totals.label}. Please generate the official Global Payments single-use link for ${totals.total} cents and email it to ${state.customerEmail}.`;

    state.messages.push({ role: 'user', content: prompt });
    broadcast({ kind: 'user_message', text: prompt });

    try {
      const result = await agent.chat(prompt, {
        mcpClient,
        mcpTools,
        customerEmail: state.customerEmail,
        requireTool: true,
      });

      state.messages.push({ role: 'assistant', content: result.reply });
      if (result.link) {
        await finalizeCheckout(result.link);
      }
      broadcast({ kind: 'state', state: publicState() });
      return json(res, 200, { ok: true, reply: result.reply, link: result.link });
    } catch (err) {
      state.phase = 'failed';
      state.lastError = err.message;
      broadcast({ kind: 'agent_error', error: err.message });
      broadcast({ kind: 'state', state: publicState() });
      return json(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    watcher?.stop();
    watcher = null;
    state.phase = 'idle';
    state.cart = [];
    state.link = null;
    state.linkStatus = null;
    state.emailResult = null;
    state.lastError = null;
    state.messages = [];

    const keep = eventLog.filter((e) => e.kind === 'mcp' || e.kind === 'sys');
    eventLog.length = 0;
    eventLog.push(...keep);

    if (agent) {
      agent.history = [];
      seedAgentContext();
    }

    broadcast({ kind: 'reset' }, { log: false });
    broadcast({ kind: 'state', state: publicState() });
    return json(res, 200, { ok: true, state: publicState() });
  }

  if (pathname.startsWith('/api/')) {
    return json(res, 404, { error: 'Not Found' });
  }

  return serveStatic(req, res, pathname);
});

/* ------------------------------------------------------------------- boot */

async function boot() {
  console.log(`\n  ⛳ The Augusta Collection — Antigravity + Gemini 3.8 Flash`);
  console.log(`  http://${HOST}:${PORT}\n`);

  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('  ! Warning: No OPENROUTER_API_KEY found.');
  }

  try {
    const started = await startMcpServer({ onEvent: sink });
    mcpClient = started.client;
    mcpTools = started.tools;
    mcpStatus = {
      state: 'ready',
      detail: `Global Payments MCP · ${mcpTools.length} tools online`,
    };

    agent = new GeminiAgent({
      apiKey,
      onEvent: sink,
    });

    seedAgentContext();
  } catch (err) {
    mcpStatus = { state: 'failed', detail: err.message };
    console.error('  ! Failed to start MCP server:', err.message);
  }

  server.listen(PORT, HOST, () => {
    console.log(`  ✓ Storefront listening on http://${HOST}:${PORT}`);
    console.log(`  ✓ MCP Status: ${mcpStatus.state} — ${mcpStatus.detail}\n`);
  });
}

boot();
