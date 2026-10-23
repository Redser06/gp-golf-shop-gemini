/**
 * The Augusta Collection & Antigravity Agent Studio Client.
 */

const $ = (id) => document.getElementById(id);

const els = {
  productGrid: $('productGrid'),
  topupRow: $('topupRow'),
  bagBar: $('bagBar'),
  bagBarItems: $('bagBarItems'),
  bagBarTotal: $('bagBarTotal'),
  bagBarCheckoutBtn: $('bagBarCheckoutBtn'),
  bagBarClearBtn: $('bagBarClearBtn'),
  bagCount: $('bagCount'),
  bagTotalHeader: $('bagTotalHeader'),
  bagToggleBtn: $('bagToggleBtn'),
  heroQuickSelectBtn: $('heroQuickSelectBtn'),
  heroConsultBtn: $('heroConsultBtn'),
  chatBox: $('chatBox'),
  chatForm: $('chatForm'),
  chatInput: $('chatInput'),
  quickChips: $('quickChips'),
  receiptSection: $('receiptSection'),
  receiptAmount: $('receiptAmount'),
  receiptLinkId: $('receiptLinkId'),
  receiptStatus: $('receiptStatus'),
  receiptRecipient: $('receiptRecipient'),
  receiptLinkBtn: $('receiptLinkBtn'),
  statTools: $('statTools'),
  statCalls: $('statCalls'),
  statHttp: $('statHttp'),
  statLatency: $('statLatency'),
  consoleStream: $('consoleStream'),
  resetBtn: $('resetBtn'),
  clearConsoleBtn: $('clearConsoleBtn'),
};

let catalogue = [];
let currentCart = [];
let activeTab = 'all';
let stats = { calls: 0, http: 0, lastLatency: 0 };
let allEvents = [];

/* ------------------------------------------------------------- init & data */

async function init() {
  setupTabs();
  setupEventListeners();

  // Load Catalogue
  try {
    const res = await fetch('/api/catalogue');
    const data = await res.json();
    catalogue = data.catalogue || [];
    renderCatalogue();
  } catch (err) {
    console.error('Failed to load catalogue:', err);
  }

  // Load Initial State
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data.state) applyServerState(data.state);
  } catch (err) {
    console.error('Failed to load state:', err);
  }

  // Start Stream & Polling fallback
  startEventStream();
}

function renderCatalogue() {
  const mainPacks = catalogue.filter((item) => item.qty === 3);
  const topups = catalogue.filter((item) => item.qty < 3);

  els.productGrid.innerHTML = mainPacks
    .map(
      (p) => `
    <div class="product-card" data-id="${p.id}">
      <span class="product-badge">${p.badge}</span>
      <h3 class="product-title">${p.name}</h3>
      <div class="product-price">${p.priceDisplay} <small style="font-size:11px;color:#888;">(3 balls)</small></div>
      <p class="product-desc">${p.tagline}</p>
      <div class="product-specs">
        <div class="spec-item"><span>Compression</span><strong>${p.specs.compression}</strong></div>
        <div class="spec-item"><span>Cover</span><strong>${p.specs.cover}</strong></div>
        <div class="spec-item"><span>Dimples</span><strong>${p.specs.dimples}</strong></div>
        <div class="spec-item"><span>Feel</span><strong>${p.specs.feel}</strong></div>
      </div>
      <button class="btn-add-product" data-add="${p.id}">Add 3 to Bag ($16.00)</button>
    </div>
  `
    )
    .join('');

  els.topupRow.innerHTML = topups
    .map(
      (t) => `
    <button class="topup-btn" data-add="${t.id}">
      <strong>${t.name}</strong>
      <span>${t.priceDisplay}</span>
    </button>
  `
    )
    .join('');
}

function applyServerState(st) {
  currentCart = st.cart || [];
  els.bagCount.textContent = st.cartCount || 0;
  els.bagTotalHeader.textContent = st.cartTotalLabel || '$0.00';

  if (currentCart.length > 0) {
    els.bagBar.hidden = false;
    els.bagBarTotal.textContent = st.cartTotalLabel;
    els.bagBarItems.innerHTML = currentCart
      .map((c) => {
        const item = catalogue.find((i) => i.id === c.id);
        return `<span class="bag-item-tag"><strong>${c.qty}×</strong> ${item ? item.name : c.id}</span>`;
      })
      .join('');
  } else {
    els.bagBar.hidden = true;
  }

  // Handle messages
  if (st.messages && st.messages.length) {
    renderChatMessages(st.messages);
  }

  // Handle Link Receipt
  if (st.link) {
    els.receiptSection.hidden = false;
    els.receiptAmount.textContent = st.cartTotalLabel || '$16.00';
    els.receiptLinkId.textContent = st.link.id;
    els.receiptStatus.textContent = st.linkStatus || st.link.status || 'ACTIVE';
    els.receiptRecipient.textContent = st.customerEmail;
    els.receiptLinkBtn.href = st.link.url;
  } else {
    els.receiptSection.hidden = true;
  }
}

function renderChatMessages(msgs) {
  els.chatBox.innerHTML = msgs
    .map(
      (m) => `
    <div class="chat-bubble ${m.role}">
      ${escapeHtml(m.content)}
    </div>
  `
    )
    .join('');
  els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

/* ------------------------------------------------------------- cart actions */

async function addToCart(id) {
  try {
    const res = await fetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.state) applyServerState(data.state);
  } catch (err) {
    console.error('Add to cart failed:', err);
  }
}

async function clearCart() {
  try {
    const res = await fetch('/api/cart/clear', { method: 'POST' });
    const data = await res.json();
    if (data.state) applyServerState(data.state);
  } catch (err) {
    console.error('Clear cart failed:', err);
  }
}

async function triggerCheckout() {
  appendChatMessage('user', 'Please generate my Global Payments checkout link!');
  els.bagBarCheckoutBtn.disabled = true;
  els.bagBarCheckoutBtn.textContent = 'Creating Link…';

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'conor.a.redmond+deals@gmail.com' }),
    });
    const data = await res.json();
    if (data.reply) appendChatMessage('assistant', data.reply);
  } catch (err) {
    appendChatMessage('assistant', `Checkout error: ${err.message}`);
  } finally {
    els.bagBarCheckoutBtn.disabled = false;
    els.bagBarCheckoutBtn.textContent = 'Instant Checkout →';
  }
}

/* ------------------------------------------------------------- chat actions */

async function sendChat(message) {
  if (!message) return;
  appendChatMessage('user', message);
  els.chatInput.value = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (data.reply) {
      appendChatMessage('assistant', data.reply);
    }
  } catch (err) {
    appendChatMessage('assistant', `Error: ${err.message}`);
  }
}

function appendChatMessage(role, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = content;
  els.chatBox.appendChild(bubble);
  els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

/* ------------------------------------------------------------- telemetry & events */

function startEventStream() {
  let eventSource = null;
  try {
    eventSource = new EventSource('/api/stream');
    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        handleStreamEvent(payload);
      } catch {
        /* ignore parse errors */
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      startPollingFallback();
    };
  } catch {
    startPollingFallback();
  }
}

let lastSeq = 0;
async function startPollingFallback() {
  while (true) {
    try {
      const res = await fetch(`/api/poll?since=${lastSeq}&wait=2000`);
      if (res.ok) {
        const data = await res.json();
        for (const evt of data.events || []) {
          handleStreamEvent(evt);
          if (evt.seq) lastSeq = Math.max(lastSeq, evt.seq);
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function handleStreamEvent(evt) {
  allEvents.push(evt);

  if (evt.kind === 'tool_call') {
    stats.calls++;
    els.statCalls.textContent = stats.calls;
  }
  if (evt.kind === 'http') {
    stats.http++;
    els.statHttp.textContent = stats.http;
  }
  if (evt.durationMs) {
    els.statLatency.textContent = `${evt.durationMs}ms`;
  }
  if (evt.state) {
    applyServerState(evt.state);
  }

  renderEventCard(evt);
}

function renderEventCard(evt) {
  if (activeTab === 'mcp' && evt.kind !== 'mcp' && evt.kind !== 'tool_call' && evt.kind !== 'tool_result') return;
  if (activeTab === 'http' && evt.kind !== 'http') return;
  if (activeTab === 'reasoning' && evt.kind !== 'gemini_reasoning' && evt.kind !== 'agent_thinking') return;

  const card = document.createElement('div');
  let cardClass = 'event-card';
  let title = evt.kind.toUpperCase();
  let content = '';

  if (evt.kind === 'mcp') {
    cardClass += ' mcp';
    const method = evt.frame?.method || (evt.frame?.result ? 'RESULT' : 'FRAME');
    title = `MCP · ${method} (${evt.dir || 'stdio'})`;
    content = JSON.stringify(evt.frame, null, 2);
  } else if (evt.kind === 'tool_call') {
    cardClass += ' mcp';
    title = `GEMINI TOOL CALL · ${evt.tool}`;
    content = JSON.stringify(evt.args, null, 2);
  } else if (evt.kind === 'tool_result') {
    cardClass += ' mcp';
    title = `MCP TOOL RESULT · ${evt.tool} (${evt.durationMs}ms)`;
    content = JSON.stringify(evt.result || evt.error, null, 2);
  } else if (evt.kind === 'http') {
    cardClass += ' http';
    title = `HTTPS WIRE · ${evt.method || 'POST'} ${evt.status || 200}`;
    content = `${evt.url || 'apis.sandbox.globalpay.com'}\n${JSON.stringify(evt.body || evt.response || {}, null, 2)}`;
  } else if (evt.kind === 'gemini_reasoning') {
    cardClass += ' reasoning';
    title = `GEMINI 3.8 FLASH REASONING`;
    content = typeof evt.reasoning === 'string' ? evt.reasoning : JSON.stringify(evt.reasoning, null, 2);
  } else if (evt.kind === 'email') {
    cardClass += ' email';
    title = `MACOS MAIL DELIVERY · ${evt.phase}`;
    content = `To: ${evt.to}\nSubject: ${evt.subject}\nTransport: ${evt.via || 'macOS Mail'}`;
  } else {
    content = JSON.stringify(evt, null, 2);
  }

  const timeStr = new Date(evt.at || Date.now()).toLocaleTimeString();
  card.className = cardClass;
  card.innerHTML = `
    <div class="event-meta">
      <span class="event-kind">${escapeHtml(title)}</span>
      <span class="event-time">${timeStr}</span>
    </div>
    <div class="event-body"><pre class="event-json">${escapeHtml(content)}</pre></div>
  `;

  els.consoleStream.appendChild(card);
  els.consoleStream.scrollTop = els.consoleStream.scrollHeight;
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      rerenderConsole();
    });
  });
}

function rerenderConsole() {
  els.consoleStream.innerHTML = '';
  for (const evt of allEvents) {
    renderEventCard(evt);
  }
}

function setupEventListeners() {
  document.addEventListener('click', (e) => {
    const addId = e.target.closest('[data-add]')?.dataset.add;
    if (addId) addToCart(addId);
  });

  els.bagBarClearBtn.addEventListener('click', clearCart);
  els.bagBarCheckoutBtn.addEventListener('click', triggerCheckout);

  els.heroQuickSelectBtn.addEventListener('click', () => {
    addToCart('tour-velocity-3');
    setTimeout(() => triggerCheckout(), 300);
  });

  els.heroConsultBtn.addEventListener('click', () => {
    $('conciergeSection').scrollIntoView({ behavior: 'smooth' });
    els.chatInput.focus();
  });

  els.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat(els.chatInput.value.trim());
  });

  els.quickChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) sendChat(chip.dataset.msg);
  });

  els.resetBtn.addEventListener('click', async () => {
    await fetch('/api/reset', { method: 'POST' });
    allEvents = [];
    stats = { calls: 0, http: 0, lastLatency: 0 };
    els.statCalls.textContent = '0';
    els.statHttp.textContent = '0';
    els.statLatency.textContent = '0ms';
    els.consoleStream.innerHTML = '';
    applyServerState({ cart: [], cartCount: 0, cartTotalLabel: '$0.00', messages: [] });
  });

  els.clearConsoleBtn.addEventListener('click', () => {
    els.consoleStream.innerHTML = '';
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

init();
