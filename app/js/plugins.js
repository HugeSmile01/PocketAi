// ═══════════════════════════════════════════════════════════
// PocketAI — Plugin Manager + Built-in Plugins
// ═══════════════════════════════════════════════════════════

const PluginManager = (() => {

  // ── Built-in plugin registry ──────────────────────────────
  const BUILTIN_PLUGINS = [
    {
      id: 'pdf-summarizer',
      name: 'PDF Summarizer',
      icon: '◫',
      desc: 'Summarize any text or PDF document',
      render: renderPDFSummarizer,
    },
    {
      id: 'code-helper',
      name: 'Code Helper',
      icon: '⌨',
      desc: 'Syntax highlighting & code-focused AI',
      render: renderCodeHelper,
    },
    {
      id: 'prompt-library',
      name: 'Prompt Library',
      icon: '◌',
      desc: 'One-tap AI persona switcher',
      render: renderPromptLibrary,
    },
    {
      id: 'device-advisor',
      name: 'Device Advisor',
      icon: '◉',
      desc: 'Which model is best for your phone?',
      render: renderDeviceAdvisor,
    },
  ];

  let activePlugin = null;

  // ── Init ──────────────────────────────────────────────────
  function init() {
    renderPluginGrid();
  }

  // ── Grid ──────────────────────────────────────────────────
  function renderPluginGrid() {
    const grid = document.getElementById('plugin-grid');
    if (!grid) return;

    grid.innerHTML = BUILTIN_PLUGINS.map(p => `
      <div class="plugin-card" data-plugin="${p.id}">
        <div class="plugin-icon">${p.icon}</div>
        <div class="plugin-name">${p.name}</div>
        <div class="plugin-desc">${p.desc}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.plugin-card').forEach(card => {
      card.addEventListener('click', () => openPlugin(card.dataset.plugin));
    });
  }

  // ── Open plugin ───────────────────────────────────────────
  function openPlugin(id) {
    const plugin = BUILTIN_PLUGINS.find(p => p.id === id);
    if (!plugin) return;

    // Toggle active state
    document.querySelectorAll('.plugin-card').forEach(c => {
      c.classList.toggle('active', c.dataset.plugin === id);
    });

    const panel = document.getElementById('plugin-panel');
    panel.classList.remove('hidden');

    if (activePlugin === id) {
      panel.classList.add('hidden');
      activePlugin = null;
      document.querySelectorAll('.plugin-card').forEach(c => c.classList.remove('active'));
      return;
    }

    activePlugin = id;
    plugin.render(panel);
  }

  // ── Shared: call LLM ──────────────────────────────────────
  async function callLLM(systemPrompt, userPrompt, onToken) {
    const port = 8080;
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        temperature: 0.5,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return full;
        try {
          const chunk = JSON.parse(data);
          const token = chunk.choices?.[0]?.delta?.content || '';
          full += token;
          if (onToken) onToken(token, full);
        } catch (_) {}
      }
    }
    return full;
  }

  // ════════════════════════════════════════════════════════
  // PLUGIN 1: PDF / Text Summarizer
  // ════════════════════════════════════════════════════════
  function renderPDFSummarizer(panel) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">◫</span>
        <div>
          <div style="font-weight:600">PDF Summarizer</div>
          <div style="font-size:12px;color:var(--text-2)">Paste text or drop a .txt/.md file</div>
        </div>
      </div>
      <textarea id="pdf-input" placeholder="Paste your document text here (or drag a .txt file onto this area)…"
        style="width:100%;height:140px;background:var(--bg-4);border:1px solid var(--border-2);color:var(--text);
               padding:10px;border-radius:8px;font-size:13px;resize:vertical;font-family:var(--sans)"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-primary" id="pdf-summarize">Summarize</button>
        <button class="btn-secondary" id="pdf-bullets">Bullet Points</button>
        <button class="btn-secondary" id="pdf-keypoints">Key Points</button>
        <button class="btn-secondary" id="pdf-eli5">Explain Simply</button>
      </div>
      <div id="pdf-output" style="margin-top:14px;padding:12px;background:var(--bg-4);border:1px solid var(--border);
           border-radius:8px;font-size:13px;line-height:1.65;min-height:60px;display:none"></div>
    `;

    const textarea = panel.querySelector('#pdf-input');
    const output = panel.querySelector('#pdf-output');

    // Drag-drop .txt onto textarea
    textarea.addEventListener('dragover', e => e.preventDefault());
    textarea.addEventListener('drop', async e => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.txt') || file.name.endsWith('.md'))) {
        textarea.value = await file.text();
      }
    });

    const runSummary = async (mode) => {
      const text = textarea.value.trim();
      if (!text) { alert('Paste some text first'); return; }

      const prompts = {
        summarize: 'Write a clear, comprehensive summary of this text in 2-4 paragraphs.',
        bullets: 'Extract the most important points from this text as a concise bullet list.',
        keypoints: 'Identify the 5 most critical facts or arguments in this text.',
        eli5: 'Explain this text as simply as possible, as if to someone unfamiliar with the topic.',
      };

      output.style.display = 'block';
      output.innerHTML = '<span class="cursor"></span>';

      try {
        await callLLM(
          'You are an expert document analyst. Be precise and helpful.',
          `${prompts[mode]}\n\nDocument:\n${text.slice(0, 6000)}`,
          (_, full) => {
            output.innerHTML = markdownToHTML(full) + '<span class="cursor"></span>';
          }
        );
        output.querySelector('.cursor')?.remove();
      } catch (err) {
        output.innerHTML = `<span style="color:var(--error)">Error: ${err.message}. Is the server running?</span>`;
      }
    };

    panel.querySelector('#pdf-summarize').onclick = () => runSummary('summarize');
    panel.querySelector('#pdf-bullets').onclick   = () => runSummary('bullets');
    panel.querySelector('#pdf-keypoints').onclick = () => runSummary('keypoints');
    panel.querySelector('#pdf-eli5').onclick      = () => runSummary('eli5');
  }

  // ════════════════════════════════════════════════════════
  // PLUGIN 2: Code Helper
  // ════════════════════════════════════════════════════════
  function renderCodeHelper(panel) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">⌨</span>
        <div>
          <div style="font-weight:600">Code Helper</div>
          <div style="font-size:12px;color:var(--text-2)">AI optimized for code tasks</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <button class="lang-btn btn-secondary" data-lang="python" style="font-size:11px;padding:4px 10px">Python</button>
        <button class="lang-btn btn-secondary" data-lang="javascript" style="font-size:11px;padding:4px 10px">JavaScript</button>
        <button class="lang-btn btn-secondary" data-lang="bash" style="font-size:11px;padding:4px 10px">Bash</button>
        <button class="lang-btn btn-secondary" data-lang="java" style="font-size:11px;padding:4px 10px">Java</button>
        <button class="lang-btn btn-secondary" data-lang="c" style="font-size:11px;padding:4px 10px">C/C++</button>
        <button class="lang-btn btn-secondary" data-lang="sql" style="font-size:11px;padding:4px 10px">SQL</button>
      </div>
      <textarea id="code-input" placeholder="Paste code here, or describe what you want to build…"
        style="width:100%;height:120px;background:var(--bg);border:1px solid var(--border-2);color:var(--text);
               padding:10px;border-radius:8px;font-size:12px;font-family:var(--mono);resize:vertical"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-primary" id="code-explain">Explain</button>
        <button class="btn-secondary" id="code-review">Review</button>
        <button class="btn-secondary" id="code-fix">Fix Bugs</button>
        <button class="btn-secondary" id="code-optimize">Optimize</button>
        <button class="btn-secondary" id="code-write">Write From Scratch</button>
      </div>
      <div id="code-output" style="margin-top:14px;display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:11px;color:var(--text-2);font-family:var(--mono)">Output</span>
          <button id="code-copy" style="font-size:11px;background:none;border:1px solid var(--border);color:var(--text-2);
            padding:3px 8px;border-radius:4px;cursor:pointer">Copy</button>
        </div>
        <pre id="code-result" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;
          padding:14px;font-size:12px;font-family:var(--mono);overflow-x:auto;white-space:pre-wrap;line-height:1.5"></pre>
      </div>
    `;

    let selectedLang = 'python';

    panel.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        panel.querySelectorAll('.lang-btn').forEach(b => b.style.borderColor = '');
        this.style.borderColor = 'var(--accent)';
        this.style.color = 'var(--accent)';
        selectedLang = this.dataset.lang;
      });
    });
    // Default highlight first
    panel.querySelector('[data-lang="python"]').style.borderColor = 'var(--accent)';
    panel.querySelector('[data-lang="python"]').style.color = 'var(--accent)';

    const output = panel.querySelector('#code-output');
    const result = panel.querySelector('#code-result');

    const runCode = async (task) => {
      const code = panel.querySelector('#code-input').value.trim();
      if (!code) { alert('Enter code or a description first'); return; }

      const systemPrompts = {
        explain: `You are an expert ${selectedLang} programmer. Explain code clearly and precisely. Use simple language.`,
        review: `You are a senior ${selectedLang} code reviewer. Identify bugs, security issues, performance problems. Be specific.`,
        fix: `You are a ${selectedLang} debugging expert. Find and fix all bugs. Show the corrected code with explanation.`,
        optimize: `You are a ${selectedLang} performance expert. Optimize this code for speed and readability. Explain changes.`,
        write: `You are an expert ${selectedLang} programmer. Write clean, well-commented, production-quality code.`,
      };

      const userPrompts = {
        explain: `Explain this ${selectedLang} code:\n\`\`\`${selectedLang}\n${code}\n\`\`\``,
        review: `Review this ${selectedLang} code:\n\`\`\`${selectedLang}\n${code}\n\`\`\``,
        fix: `Fix bugs in this ${selectedLang} code:\n\`\`\`${selectedLang}\n${code}\n\`\`\``,
        optimize: `Optimize this ${selectedLang} code:\n\`\`\`${selectedLang}\n${code}\n\`\`\``,
        write: `Write ${selectedLang} code for: ${code}`,
      };

      output.style.display = 'block';
      result.textContent = '…';

      try {
        await callLLM(systemPrompts[task], userPrompts[task], (_, full) => {
          result.textContent = full;
        });
      } catch (err) {
        result.textContent = `Error: ${err.message}`;
      }
    };

    panel.querySelector('#code-explain').onclick  = () => runCode('explain');
    panel.querySelector('#code-review').onclick   = () => runCode('review');
    panel.querySelector('#code-fix').onclick      = () => runCode('fix');
    panel.querySelector('#code-optimize').onclick = () => runCode('optimize');
    panel.querySelector('#code-write').onclick    = () => runCode('write');

    panel.querySelector('#code-copy').onclick = () => {
      navigator.clipboard.writeText(result.textContent).then(() => {
        window.showToast?.('Copied!');
      });
    };
  }

  // ════════════════════════════════════════════════════════
  // PLUGIN 3: Prompt Library
  // ════════════════════════════════════════════════════════
  const PROMPTS = [
    { id: 'default', name: 'PocketAI (Default)', icon: '◈',
      prompt: 'You are PocketAI, a highly intelligent helpful assistant running locally on the user\'s device. Be concise, accurate, and genuinely useful.' },
    { id: 'tutor', name: 'Patient Tutor', icon: '◎',
      prompt: 'You are a patient, encouraging tutor. Explain concepts clearly with examples. Check understanding. Adapt to the learner\'s level.' },
    { id: 'coder', name: 'Senior Engineer', icon: '⌨',
      prompt: 'You are a senior software engineer with 15 years of experience. Give precise, idiomatic, production-quality code. Point out edge cases and potential bugs. Be direct.' },
    { id: 'writer', name: 'Creative Writer', icon: '✦',
      prompt: 'You are a skilled creative writer. Write with vivid imagery, strong voice, and compelling narrative. Match the user\'s requested tone and genre.' },
    { id: 'analyst', name: 'Data Analyst', icon: '◫',
      prompt: 'You are a data analyst. Break down problems methodically. Use numbers and evidence. Give structured, actionable insights.' },
    { id: 'doctor', name: 'Medical Info', icon: '◌',
      prompt: 'You are a knowledgeable medical information assistant. Provide accurate, evidence-based health information. Always recommend consulting a healthcare professional for personal medical decisions.' },
    { id: 'lawyer', name: 'Legal Info', icon: '◉',
      prompt: 'You are a legal information assistant. Explain legal concepts clearly. Note that this is general information, not legal advice, and users should consult a qualified attorney for specific situations.' },
    { id: 'debate', name: 'Devil\'s Advocate', icon: '◐',
      prompt: 'You are a sharp devil\'s advocate. Challenge assumptions, find weaknesses in arguments, and push back thoughtfully. Be intellectually rigorous.' },
    { id: 'translator', name: 'Translator', icon: '◑',
      prompt: 'You are an expert translator and linguist. Translate accurately while preserving tone, nuance, and cultural context. If asked to translate, do so directly.' },
    { id: 'chef', name: 'Chef', icon: '✧',
      prompt: 'You are an experienced chef. Give practical, delicious recipe advice. Suggest substitutions, explain techniques, and help with meal planning.' },
  ];

  function renderPromptLibrary(panel) {
    const current = window.State?.settings?.systemPrompt || '';

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">◌</span>
        <div>
          <div style="font-weight:600">Prompt Library</div>
          <div style="font-size:12px;color:var(--text-2)">Tap a persona to activate it</div>
        </div>
      </div>
      <div id="prompt-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px"></div>
      <div id="current-prompt" style="margin-top:14px;padding:10px 14px;background:var(--bg-4);
           border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text-2);font-family:var(--mono)">
        Active: Default
      </div>
    `;

    const grid = panel.querySelector('#prompt-grid');
    const currentPromptEl = panel.querySelector('#current-prompt');

    grid.innerHTML = PROMPTS.map(p => `
      <div class="prompt-card" data-id="${p.id}" style="
        background:var(--bg-4);border:1px solid var(--border);border-radius:10px;
        padding:12px;cursor:pointer;transition:all 0.15s;text-align:center
      ">
        <div style="font-size:20px;margin-bottom:4px">${p.icon}</div>
        <div style="font-size:12px;font-weight:500">${p.name}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.prompt-card').forEach(card => {
      card.addEventListener('click', function () {
        const p = PROMPTS.find(x => x.id === this.dataset.id);
        if (!p) return;

        grid.querySelectorAll('.prompt-card').forEach(c => {
          c.style.borderColor = '';
          c.style.background = 'var(--bg-4)';
        });
        this.style.borderColor = 'var(--accent)';
        this.style.background = 'var(--accent-dim)';

        if (window.State) {
          window.State.settings.systemPrompt = p.prompt;
          // Save
          localStorage.setItem('pocketai_settings', JSON.stringify(window.State.settings));
        }

        currentPromptEl.textContent = `Active: ${p.name}`;
        window.showToast?.(`Persona: ${p.name}`);
      });
    });

    // Highlight active
    const activeId = PROMPTS.find(p => p.prompt === current)?.id || 'default';
    const activeCard = grid.querySelector(`[data-id="${activeId}"]`);
    if (activeCard) {
      activeCard.style.borderColor = 'var(--accent)';
      activeCard.style.background = 'var(--accent-dim)';
    }
  }

  // ════════════════════════════════════════════════════════
  // PLUGIN 4: Device Advisor
  // Tells users exactly which model suits their phone
  // ════════════════════════════════════════════════════════
  async function renderDeviceAdvisor(panel) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">◉</span>
        <div>
          <div style="font-weight:600">Device Advisor</div>
          <div style="font-size:12px;color:var(--text-2)">Which model is best for your phone?</div>
        </div>
      </div>
      <div id="advisor-content">
        <div style="color:var(--text-2);font-size:13px">Scanning your device…</div>
      </div>
    `;

    const content = panel.querySelector('#advisor-content');

    try {
      const info = await ModelManager.init(
        window.State?.settings?.autoTier === false
          ? window.State?.settings?.manualTier
          : undefined
      );

      const models = info.allModels;
      const ramMB = info.ram.usableMB;
      const freeGB = info.storage.freeGB;

      const makeRow = (tier, m) => {
        const canRunRAM = ramMB >= m.ramMB;
        const canRunStorage = freeGB >= m.sizeMB / 1024;
        const canRun = canRunRAM && canRunStorage;
        const isRec = tier === info.selectedTier;

        return `
          <div style="
            background:${isRec ? 'var(--accent-dim)' : 'var(--bg-4)'};
            border:1px solid ${isRec ? 'var(--accent)' : 'var(--border)'};
            border-radius:10px;padding:14px;margin-bottom:8px;
            display:flex;justify-content:space-between;align-items:center;gap:12px
          ">
            <div>
              <div style="font-weight:600;font-size:14px">${m.name}
                ${isRec ? '<span style="color:var(--accent);font-size:11px;margin-left:6px">★ Recommended</span>' : ''}
              </div>
              <div style="font-size:12px;color:var(--text-2);margin-top:2px">${m.desc}</div>
              <div style="font-size:11px;font-family:var(--mono);color:var(--text-2);margin-top:4px">
                ${m.sizeMB >= 1024 ? (m.sizeMB/1024).toFixed(1)+'GB' : m.sizeMB+'MB'} disk ·
                ${m.ramMB >= 1024 ? (m.ramMB/1024).toFixed(1)+'GB' : m.ramMB+'MB'} RAM
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:20px;font-family:var(--mono);font-weight:700;
                color:${canRun ? 'var(--accent)' : 'var(--error)'}">
                ${m.badge}
              </div>
              <div style="font-size:11px;color:${canRun ? 'var(--accent)' : 'var(--error)'}">
                ${canRun ? '✓ Compatible' : !canRunRAM ? '✗ Low RAM' : '✗ Low storage'}
              </div>
            </div>
          </div>
        `;
      };

      content.innerHTML = `
        <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:10px;
             padding:14px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);text-transform:uppercase">Device RAM</div>
            <div style="font-size:20px;font-family:var(--mono);font-weight:700;color:var(--accent)">${info.ram.label}</div>
            <div style="font-size:11px;color:var(--text-2)">${info.ram.usableMB}MB usable</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);text-transform:uppercase">Free Storage</div>
            <div style="font-size:20px;font-family:var(--mono);font-weight:700;color:var(--accent)">
              ${freeGB ? freeGB.toFixed(1)+'GB' : '?'}
            </div>
            <div style="font-size:11px;color:var(--text-2)">${info.storage.source}</div>
          </div>
        </div>

        <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);text-transform:uppercase;
             margin-bottom:8px;letter-spacing:0.08em">Model Compatibility</div>
        ${makeRow('nano', models.nano)}
        ${makeRow('mid', models.mid)}
        ${makeRow('full', models.full)}

        <div style="margin-top:12px;padding:12px 14px;background:var(--bg-3);border:1px solid var(--border);
             border-radius:10px;font-size:13px;line-height:1.6;color:var(--text-2)">
          ${info.recommendation}
        </div>

        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn-primary" id="apply-rec">
            Apply ${info.model.name} ★
          </button>
        </div>
      `;

      content.querySelector('#apply-rec').onclick = () => {
        if (window.State) {
          window.State.settings.manualTier = info.selectedTier;
          window.State.settings.autoTier = false;
          localStorage.setItem('pocketai_settings', JSON.stringify(window.State.settings));
        }
        window.showToast?.(`${info.model.name} selected`);
      };

    } catch (err) {
      content.innerHTML = `<div style="color:var(--error)">Detection error: ${err.message}</div>`;
    }
  }

  // ── Shared markdown (reuse from app.js scope) ──────────
  function markdownToHTML(text) {
    if (!text) return '';
    return text
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${code.trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  window.markdownToHTML = markdownToHTML;

  return { init, openPlugin };
})();

window.PluginManager = PluginManager;
