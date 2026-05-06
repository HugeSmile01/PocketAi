// ═══════════════════════════════════════════════════════════
// PocketAI — Core Application
// Full chat, streaming, health checks, settings, UI routing
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Config ────────────────────────────────────────────────
const CONFIG = {
  SERVER_PORT: 8080,
  HEALTH_INTERVAL: 5000,
  HEALTH_TIMEOUT: 2000,
  DEFAULT_TEMP: 0.7,
  DEFAULT_MAX_TOKENS: 512,
  DEFAULT_CTX: 2048,
  DEFAULT_SYSTEM: `You are PocketAI, a highly intelligent and helpful AI assistant running entirely on the user's device. You have no internet access by default — all inference is local and private. Be concise, accurate, and genuinely useful. Think step by step for complex problems.`,
};

// ── State ─────────────────────────────────────────────────
const State = {
  serverOnline: false,
  streaming: false,
  messages: [],          // current conversation
  deviceInfo: null,      // RAM/storage/tier result
  activeView: 'chat',
  tps: 0,                // measured tokens/sec
  settings: loadSettings(),
};

// ── DOM refs ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Settings persistence ──────────────────────────────────
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('pocketai_settings') || '{}');
  } catch (_) { return {}; }
}
function saveSettings() {
  localStorage.setItem('pocketai_settings', JSON.stringify(State.settings));
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Apply saved settings to UI
  applySettingsToUI();

  // Wire up all events
  wireEvents();

  // Device detection
  updateWelcomeStatus('Detecting your device…');
  try {
    State.deviceInfo = await ModelManager.init(
      State.settings.autoTier === false ? State.settings.manualTier : undefined
    );
    renderDeviceInfo();
  } catch (e) {
    console.warn('Device detection error:', e);
  }

  // Start health polling
  checkServer();
  setInterval(checkServer, CONFIG.HEALTH_INTERVAL);

  // Load plugins
  PluginManager.init();

  // Load RAG docs list
  RAG.renderDocList();

  // Auto-resize textarea
  $('user-input').addEventListener('input', autoResizeTextarea);
}

// ═══════════════════════════════════════════════════════════
// SERVER HEALTH
// ═══════════════════════════════════════════════════════════
async function checkServer() {
  try {
    const r = await fetch(
      `http://127.0.0.1:${CONFIG.SERVER_PORT}/health`,
      { signal: AbortSignal.timeout(CONFIG.HEALTH_TIMEOUT) }
    );
    const online = r.ok;
    setServerStatus(online);
    if (online && !State.serverOnline) {
      // Just came online — fetch model info
      fetchModelInfo();
    }
  } catch (_) {
    setServerStatus(false);
  }
}

function setServerStatus(online) {
  const changed = online !== State.serverOnline;
  State.serverOnline = online;

  // Sidebar indicator
  const statusEl = $('server-status');
  const statusText = statusEl.querySelector('.status-text');
  statusEl.className = `server-status ${online ? 'online' : 'offline'}`;
  statusText.textContent = online ? 'Server online' : 'Server offline';

  // Topbar dot
  const topDot = $('topbar-status');
  topDot.className = `status-dot ${online ? 'online' : 'offline'}`;

  // Send button
  $('btn-send').disabled = !online || State.streaming;

  // Disconnect banner
  const banner = $('disconnect-banner');
  if (!online) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Welcome screen status
  if (changed) {
    updateWelcomeStatus(
      online
        ? `Server ready · ${State.deviceInfo?.model?.name || 'Model'} loaded`
        : `Server offline — open Termux and run launch.sh`
    );
    addLog(online ? 'Server connected' : 'Server offline', online ? 'ok' : 'error');
  }

  // Drive status cards
  $('drive-conn-val').textContent = online ? 'Connected' : 'Offline';
  $('drive-conn-val').style.color = online ? 'var(--accent)' : 'var(--error)';
}

async function fetchModelInfo() {
  try {
    const r = await fetch(
      `http://127.0.0.1:${CONFIG.SERVER_PORT}/props`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!r.ok) return;
    const data = await r.json();
    const modelPath = data?.default_generation_settings?.model || '';
    const modelName = modelPath.split('/').pop().replace('.gguf', '');

    $('model-badge').textContent = modelName || 'Model';
    $('model-indicator').textContent = modelName || '—';
    $('drive-model-val').textContent = modelName;

    // Detect tier from filename
    let tier = 'nano';
    if (modelName.includes('7b') || modelName.includes('7B')) tier = 'full';
    else if (modelName.includes('3b') || modelName.includes('3B')) tier = 'mid';
    $('drive-tier-val').textContent = tier.charAt(0).toUpperCase() + tier.slice(1);

    addLog(`Model: ${modelName}`, 'ok');
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════
async function sendMessage() {
  const input = $('user-input');
  const text = input.value.trim();
  if (!text || State.streaming || !State.serverOnline) return;

  // Add to history
  State.messages.push({ role: 'user', content: text });
  renderMessage('user', text);
  input.value = '';
  autoResizeTextarea.call(input);
  updateTokenCounter();

  // Hide welcome screen
  const welcome = $('welcome');
  if (welcome) welcome.style.display = 'none';

  // Lock UI
  State.streaming = true;
  $('btn-send').disabled = true;
  $('btn-send').textContent = 'Stop';

  // Create assistant message placeholder
  const assistantEl = renderMessage('assistant', '');
  const contentEl = assistantEl.querySelector('.message-content');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  contentEl.appendChild(cursor);

  // RAG context injection
  let systemPrompt = State.settings.systemPrompt || CONFIG.DEFAULT_SYSTEM;
  if (State.settings.ragEnabled && RAG.hasDocuments()) {
    const ragContext = await RAG.query(text);
    if (ragContext) {
      systemPrompt += `\n\nRelevant document context:\n${ragContext}`;
    }
  }

  // Build messages array
  const messages = [
    { role: 'system', content: systemPrompt },
    ...State.messages.slice(-20), // keep last 20 for context window
  ];

  const settings = State.settings;
  let fullResponse = '';
  let tokenCount = 0;
  const t0 = performance.now();

  try {
    const response = await fetch(
      `http://127.0.0.1:${CONFIG.SERVER_PORT}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          messages,
          stream: true,
          temperature: parseFloat(settings.temperature ?? CONFIG.DEFAULT_TEMP),
          max_tokens: parseInt(settings.maxTokens ?? CONFIG.DEFAULT_MAX_TOKENS),
          top_p: 0.9,
          repeat_penalty: 1.1,
        }),
        signal: AbortSignal.timeout(120000), // 2 min max
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const chunk = JSON.parse(data);
          const token = chunk.choices?.[0]?.delta?.content || '';
          if (!token) continue;

          fullResponse += token;
          tokenCount++;

          // Render streamed token
          cursor.remove();
          contentEl.innerHTML = markdownToHTML(fullResponse);
          contentEl.appendChild(cursor);
          scrollToBottom();
        } catch (_) {}
      }
    }

    // Measure TPS
    const elapsed = (performance.now() - t0) / 1000;
    State.tps = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : 0;
    $('drive-tps-val').textContent = `${State.tps} tok/s`;

  } catch (err) {
    fullResponse = err.name === 'TimeoutError'
      ? 'Request timed out. The model may be overloaded.'
      : `Error: ${err.message}`;
    contentEl.innerHTML = `<span style="color:var(--warn)">${fullResponse}</span>`;
  } finally {
    cursor.remove();
    State.messages.push({ role: 'assistant', content: fullResponse });
    State.streaming = false;
    $('btn-send').disabled = !State.serverOnline;
    $('btn-send').textContent = 'Send';
    scrollToBottom();
  }
}

// ── Render a message bubble ───────────────────────────────
function renderMessage(role, content) {
  const welcome = $('welcome');
  if (welcome) welcome.style.display = 'none';

  const messages = $('messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'U' : 'A';

  const bubble = document.createElement('div');
  bubble.className = 'message-content';
  if (content) bubble.innerHTML = markdownToHTML(content);

  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);
  scrollToBottom();
  return div;
}

// ── Minimal Markdown renderer ─────────────────────────────
function markdownToHTML(text) {
  if (!text) return '';

  const codeBlocks = [];
  const inlineCodes = [];

  let html = escapeHTML(text)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      const safeLang = escapeHTML(lang || '');
      codeBlocks.push(`<pre><code class="lang-${safeLang}">${escapeHTML(code.trim())}</code></pre>`);
      return token;
    })
    .replace(/`([^`]+)`/g, (_, c) => {
      const token = `__INLINE_CODE_${inlineCodes.length}__`;
      inlineCodes.push(`<code>${escapeHTML(c)}</code>`);
      return token;
    })
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  const lines = html.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    const olMatch = line.match(/^\d+\.\s+(.+)$/);

    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${ulMatch[1]}</li>`);
      continue;
    }

    if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${olMatch[1]}</li>`);
      continue;
    }

    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }

    out.push(line === '' ? '<br>' : line);
  }

  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  html = out.join('\n');

  html = html
    .replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[Number(i)] || '')
    .replace(/__INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[Number(i)] || '')
    .replace(/\n/g, '<br>');

  return html;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollToBottom() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

// ─── Token counter ────────────────────────────────────────
function updateTokenCounter() {
  const text = $('user-input').value;
  const approxTokens = Math.round(text.length / 4);
  const maxCtx = parseInt(State.settings.ctxSize || CONFIG.DEFAULT_CTX);
  $('token-counter').textContent = `${approxTokens} / ${maxCtx}`;
}

function autoResizeTextarea() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
}

// ─── Welcome status ───────────────────────────────────────
function updateWelcomeStatus(msg) {
  const el = $('welcome-status');
  if (el) el.textContent = msg;
}

// ═══════════════════════════════════════════════════════════
// DEVICE INFO RENDERING
// ═══════════════════════════════════════════════════════════
function renderDeviceInfo() {
  const info = State.deviceInfo;
  if (!info) return;

  // Model badge
  const badge = `${info.model.badge} · ${info.ram.label} RAM`;
  $('model-badge').textContent = badge;
  $('model-indicator').textContent = info.model.name;

  // Drive status cards
  $('drive-model-val').textContent = info.model.name;
  $('drive-tier-val').textContent = info.model.label;

  if (info.storage.freeGB) {
    const pct = Math.min(100, ((info.model.sizeMB / 1024) / info.storage.freeGB) * 100);
    $('seg-models').style.width = `${Math.max(2, pct)}%`;
    $('seg-free').style.width = `${Math.max(2, 100 - pct - 4)}%`;
  }

  // Welcome screen
  updateWelcomeStatus(
    State.serverOnline
      ? `Ready · ${info.model.name} · ${info.ram.label} RAM`
      : `${info.model.name} recommended · Start server in Termux`
  );

  // Settings tier selector default
  if (!State.settings.manualTier) {
    $('setting-tier').value = info.selectedTier;
    State.settings.manualTier = info.selectedTier;
  }

  addLog(`Device: ${info.ram.label} RAM, ${info.storage.freeGB?.toFixed(1) || '?'}GB free`, 'ok');
  addLog(`Recommended model: ${info.model.name}`, 'ok');
}

// ═══════════════════════════════════════════════════════════
// CLOUD FALLBACK
// ═══════════════════════════════════════════════════════════
async function triggerCloudFallback(text) {
  if (!State.settings.cloudEnabled) return;

  return new Promise((resolve, reject) => {
    $('cloud-modal').classList.remove('hidden');
    $('cloud-confirm').onclick = () => {
      $('cloud-modal').classList.add('hidden');
      sendToCloud(text).then(resolve).catch(reject);
    };
    $('cloud-cancel').onclick = () => {
      $('cloud-modal').classList.add('hidden');
      reject(new Error('Cancelled'));
    };
  });
}

async function sendToCloud(userText) {
  const endpoint = State.settings.cloudEndpoint || 'https://api.openai.com/v1';
  const key = State.settings.cloudKey;
  if (!key) throw new Error('No API key configured');

  const r = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: State.settings.systemPrompt || CONFIG.DEFAULT_SYSTEM },
        ...State.messages.slice(-10),
      ],
      stream: true,
    }),
  });
  if (!r.ok) throw new Error(`Cloud API error: ${r.status}`);
  return r;
}

// ═══════════════════════════════════════════════════════════
// VIEW ROUTING
// ═══════════════════════════════════════════════════════════
function switchView(viewId) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));

  const view = $(`view-${viewId}`);
  if (view) view.classList.add('active');

  const navBtn = document.querySelector(`[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');

  State.activeView = viewId;
  $('topbar-title').textContent = viewId.charAt(0).toUpperCase() + viewId.slice(1);

  // Close sidebar on mobile
  if (window.innerWidth < 640) {
    $('sidebar').classList.remove('open');
  }
}

// ═══════════════════════════════════════════════════════════
// SETTINGS UI
// ═══════════════════════════════════════════════════════════
function applySettingsToUI() {
  const s = State.settings;
  if ($('setting-auto-tier')) $('setting-auto-tier').checked = s.autoTier !== false;
  if ($('setting-tier'))      $('setting-tier').value       = s.manualTier || 'nano';
  if ($('setting-ctx'))       $('setting-ctx').value        = s.ctxSize || '2048';
  if ($('setting-temp'))      $('setting-temp').value       = s.temperature || '0.7';
  if ($('temp-val'))          $('temp-val').textContent     = s.temperature || '0.7';
  if ($('setting-max-tokens')) $('setting-max-tokens').value = s.maxTokens || '512';
  if ($('setting-system-prompt')) $('setting-system-prompt').value = s.systemPrompt || CONFIG.DEFAULT_SYSTEM;
  if ($('setting-cloud-enable'))  $('setting-cloud-enable').checked = !!s.cloudEnabled;
  if ($('setting-cloud-endpoint')) $('setting-cloud-endpoint').value = s.cloudEndpoint || '';
  if ($('setting-cloud-key'))     $('setting-cloud-key').value = s.cloudKey || '';
  toggleManualTierRow();
}

function toggleManualTierRow() {
  const auto = $('setting-auto-tier')?.checked;
  const row = $('manual-tier-row');
  if (row) row.style.display = auto ? 'none' : 'flex';
}

// ═══════════════════════════════════════════════════════════
// LOG
// ═══════════════════════════════════════════════════════════
function addLog(msg, type = '') {
  const el = $('log-entries');
  if (!el) return;
  if (el.textContent === 'Waiting for server...') el.textContent = '';
  const line = document.createElement('div');
  line.className = `log-entry ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════
function wireEvents() {
  // Send button
  $('btn-send')?.addEventListener('click', sendMessage);

  // Enter to send (Shift+Enter = newline)
  $('user-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    updateTokenCounter();
  });

  // New chat
  $('btn-new-chat')?.addEventListener('click', () => {
    State.messages = [];
    $('messages').innerHTML = '';
    const w = document.createElement('div');
    w.id = 'welcome';
    w.className = 'welcome';
    w.innerHTML = `
      <div class="welcome-icon">PocketAI</div>
      <h2>PocketAI</h2>
      <p>Your private AI. Everything runs on your flash drive.</p>
      <div class="welcome-status" id="welcome-status">${
        State.serverOnline ? 'Ready' : 'Start the server in Termux'
      }</div>
      <div class="quick-actions">
        <button class="quick-btn" data-prompt="Explain quantum entanglement simply">Explain something</button>
        <button class="quick-btn" data-prompt="Write a Python function that">Write code</button>
        <button class="quick-btn" data-prompt="Summarize this in 3 bullet points:">Summarize</button>
      </div>`;
    $('messages').appendChild(w);
    wireQuickActions();
    switchView('chat');
  });

  // Nav items
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Sidebar toggle (mobile)
  $('btn-sidebar-toggle')?.addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
  });

  // Quick action buttons
  wireQuickActions();

  // Reconnect banner
  $('btn-reconnect')?.addEventListener('click', checkServer);

  // Cloud fallback button
  $('btn-cloud-fallback')?.addEventListener('click', () => {
    const last = State.messages.filter(m => m.role === 'user').pop();
    if (last) triggerCloudFallback(last.content);
  });

  // Settings
  $('setting-auto-tier')?.addEventListener('change', function () {
    State.settings.autoTier = this.checked;
    toggleManualTierRow();
    saveSettings();
  });
  $('setting-tier')?.addEventListener('change', function () {
    State.settings.manualTier = this.value;
    saveSettings();
  });
  $('setting-ctx')?.addEventListener('change', function () {
    State.settings.ctxSize = this.value;
    saveSettings();
  });
  $('setting-temp')?.addEventListener('input', function () {
    $('temp-val').textContent = this.value;
    State.settings.temperature = this.value;
    saveSettings();
  });
  $('setting-max-tokens')?.addEventListener('change', function () {
    State.settings.maxTokens = this.value;
    saveSettings();
  });
  $('setting-system-prompt')?.addEventListener('change', function () {
    State.settings.systemPrompt = this.value;
  });
  $('btn-save-system')?.addEventListener('click', () => {
    State.settings.systemPrompt = $('setting-system-prompt').value;
    saveSettings();
    showToast('System prompt saved');
  });
  $('setting-cloud-enable')?.addEventListener('change', function () {
    State.settings.cloudEnabled = this.checked;
    saveSettings();
  });
  $('btn-save-cloud')?.addEventListener('click', () => {
    State.settings.cloudEnabled = $('setting-cloud-enable').checked;
    State.settings.cloudEndpoint = $('setting-cloud-endpoint').value;
    State.settings.cloudKey = $('setting-cloud-key').value;
    saveSettings();
    showToast('Cloud settings saved');
  });
  $('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Clear all chat history?')) {
      State.messages = [];
      localStorage.removeItem('pocketai_history');
      showToast('History cleared');
    }
  });
  $('btn-clear-rag')?.addEventListener('click', async () => {
    if (confirm('Delete all indexed documents?')) {
      await RAG.clearAll();
      showToast('Document index cleared');
    }
  });

  // RAG file drop / input
  const dropzone = $('rag-dropzone');
  const fileInput = $('rag-file-input');
  dropzone?.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) RAG.ingestFile(files[0]);
  });
  fileInput?.addEventListener('change', e => {
    if (e.target.files.length) RAG.ingestFile(e.target.files[0]);
  });
}

function wireQuickActions() {
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('user-input').value = btn.dataset.prompt;
      autoResizeTextarea.call($('user-input'));
      updateTokenCounter();
      $('user-input').focus();
    });
  });
}

// ── Toast notification ────────────────────────────────────
function showToast(msg, duration = 2500) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Go ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);
window.showToast = showToast;
window.State = State;
