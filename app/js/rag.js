// ═══════════════════════════════════════════════════════════
// PocketAI — Local RAG Pipeline
// IndexedDB vector store, no external dependencies
// ═══════════════════════════════════════════════════════════

const RAG = (() => {
  const DB_NAME = 'pocketai_rag';
  const DB_VER = 1;
  const CHUNK_SIZE = 400;    // chars per chunk
  const CHUNK_OVERLAP = 80;  // overlap between chunks
  const TOP_K = 3;           // chunks to inject as context
  const PORT = 8080;

  let db = null;

  // ── Open IndexedDB ────────────────────────────────────────
  async function openDB() {
    if (db) return db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('docs')) {
          d.createObjectStore('docs', { keyPath: 'id', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains('chunks')) {
          const cs = d.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
          cs.createIndex('docId', 'docId', { unique: false });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  // ── IDB helpers ───────────────────────────────────────────
  async function idbPut(store, data) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(data);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function idbGetAll(store) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function idbDelete(store, id) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }

  async function idbClear(store) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }

  // ── Text chunking ─────────────────────────────────────────
  function chunkText(text) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      chunks.push(text.slice(start, end).trim());
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks.filter(c => c.length > 30);
  }

  // ── Embedding via llama-server ────────────────────────────
  async function getEmbedding(text) {
    const r = await fetch(`http://127.0.0.1:${PORT}/embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('Embedding request failed');
    const data = await r.json();
    return data.embedding;
  }

  // ── Cosine similarity ─────────────────────────────────────
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── Extract text from file ────────────────────────────────
  async function extractText(file) {
    if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = () => rej(new Error('File read error'));
        reader.readAsText(file);
      });
    }

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      return extractPDFText(file);
    }

    throw new Error(`Unsupported file type: ${file.type}`);
  }

  // ── PDF text extraction (pure JS, no library) ─────────────
  // Simple PDF text extraction — works for most text-layer PDFs
  async function extractPDFText(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const text = new TextDecoder('latin1').decode(bytes);

    const strings = [];

    // Extract text from BT...ET blocks (PDF content streams)
    const btEtRe = /BT([\s\S]*?)ET/g;
    let m;
    while ((m = btEtRe.exec(text)) !== null) {
      const block = m[1];
      // Tj and TJ operators
      const tjRe = /\(([^)]*)\)\s*Tj/g;
      const tjArrayRe = /\[([^\]]*)\]\s*TJ/g;
      let t;
      while ((t = tjRe.exec(block)) !== null) {
        strings.push(decodePDFString(t[1]));
      }
      while ((t = tjArrayRe.exec(block)) !== null) {
        const parts = t[1].match(/\(([^)]*)\)/g) || [];
        strings.push(...parts.map(p => decodePDFString(p.slice(1, -1))));
      }
    }

    const extracted = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (extracted.length < 100) {
      throw new Error(
        'Could not extract text from this PDF. It may be scanned/image-based. Try a text-layer PDF or a .txt file.'
      );
    }
    return extracted;
  }

  function decodePDFString(s) {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\\/g, '\\')
      .replace(/\\(\(|\))/g, '$1');
  }

  // ── Ingest a file ─────────────────────────────────────────
  async function ingestFile(file) {
    const statusEl = document.getElementById('rag-status');
    const setStatus = (msg, type = '') => {
      if (!statusEl) return;
      statusEl.classList.remove('hidden');
      statusEl.style.color = type === 'error' ? 'var(--error)' : type === 'ok' ? 'var(--accent)' : 'var(--text)';
      statusEl.textContent = msg;
    };

    setStatus(`Extracting text from ${file.name}…`);

    try {
      const rawText = await extractText(file);
      setStatus(`Chunking ${rawText.length} chars…`);

      const chunks = chunkText(rawText);
      setStatus(`Generating embeddings for ${chunks.length} chunks…`);

      // Save doc
      const docId = await idbPut('docs', {
        name: file.name,
        size: file.size,
        addedAt: Date.now(),
        chunks: chunks.length,
      });

      // Embed and store each chunk
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Embedding chunk ${i + 1} / ${chunks.length}…`);
        let embedding = null;
        try {
          embedding = await getEmbedding(chunks[i]);
        } catch (_) {
          // If embedding fails (server offline), store without embedding
          // Will use keyword fallback during query
        }
        await idbPut('chunks', {
          docId,
          docName: file.name,
          text: chunks[i],
          embedding,
          index: i,
        });
      }

      setStatus(`✓ Indexed ${file.name} (${chunks.length} chunks)`, 'ok');
      renderDocList();
    } catch (err) {
      setStatus(`✗ ${err.message}`, 'error');
    }
  }

  // ── Query ─────────────────────────────────────────────────
  async function query(question) {
    const chunks = await idbGetAll('chunks');
    if (!chunks.length) return null;

    let scored;

    // Try embedding-based similarity first
    try {
      const qVec = await getEmbedding(question);
      scored = chunks
        .filter(c => c.embedding)
        .map(c => ({ ...c, score: cosine(qVec, c.embedding) }))
        .sort((a, b) => b.score - a.score);
    } catch (_) {
      // Fallback: keyword overlap scoring
      const qWords = new Set(question.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      scored = chunks.map(c => {
        const cWords = c.text.toLowerCase().split(/\W+/);
        const overlap = cWords.filter(w => qWords.has(w)).length;
        return { ...c, score: overlap / Math.max(1, qWords.size) };
      }).sort((a, b) => b.score - a.score);
    }

    const topChunks = scored.slice(0, TOP_K).filter(c => c.score > 0);
    if (!topChunks.length) return null;

    return topChunks.map(c => `[From: ${c.docName}]\n${c.text}`).join('\n\n---\n\n');
  }

  // ── Has documents ─────────────────────────────────────────
  async function hasDocuments() {
    const docs = await idbGetAll('docs');
    return docs.length > 0;
  }

  // ── Clear all ─────────────────────────────────────────────
  async function clearAll() {
    await idbClear('docs');
    await idbClear('chunks');
    renderDocList();
  }

  // ── Render doc list in UI ─────────────────────────────────
  async function renderDocList() {
    const container = document.getElementById('rag-documents');
    if (!container) return;

    const docs = await idbGetAll('docs');
    if (!docs.length) {
      container.innerHTML = '<p style="color:var(--text-2);font-size:13px;padding:12px 0">No documents indexed yet.</p>';
      return;
    }

    container.innerHTML = docs.map(doc => `
      <div class="rag-doc-item" data-id="${doc.id}">
        <div>
          <div class="rag-doc-name">◫ ${doc.name}</div>
          <div class="rag-doc-meta">${doc.chunks} chunks · ${new Date(doc.addedAt).toLocaleDateString()}</div>
        </div>
        <button class="btn-secondary rag-doc-query" data-id="${doc.id}" style="font-size:11px;padding:4px 10px">
          Query ↗
        </button>
      </div>
    `).join('');

    // Wire query buttons
    container.querySelectorAll('.rag-doc-query').forEach(btn => {
      btn.addEventListener('click', () => {
        window.State.settings.ragEnabled = true;
        window.switchView?.('chat');
        document.getElementById('user-input').value = `Summarize the document "${
          docs.find(d => d.id == btn.dataset.id)?.name || ''
        }"`;
        document.getElementById('user-input').focus();
      });
    });
  }

  return { ingestFile, query, hasDocuments, clearAll, renderDocList };
})();

window.RAG = RAG;
