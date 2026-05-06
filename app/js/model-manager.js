// ═══════════════════════════════════════════════════════════
// PocketAI — Model Manager
// Detects device RAM, storage, and selects optimal model tier
// ═══════════════════════════════════════════════════════════

const ModelManager = (() => {

  // ── Model registry ────────────────────────────────────────
  const MODELS = {
    nano: {
      id: 'nano',
      name: 'Qwen2.5 1.5B',
      filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
      sizeMB: 986,
      ramMB: 700,
      label: 'Nano',
      badge: '1.5B',
      desc: 'Fast, works on all phones',
      ctx: 2048,
      threads: 2,
      quality: 1,
    },
    mid: {
      id: 'mid',
      name: 'Qwen2.5 3B',
      filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
      sizeMB: 2200,
      ramMB: 1500,
      label: 'Mid',
      badge: '3B',
      desc: 'Balanced — RAG & reasoning',
      ctx: 2048,
      threads: 4,
      quality: 2,
    },
    full: {
      id: 'full',
      name: 'Qwen2.5 7B',
      filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
      sizeMB: 4500,
      ramMB: 3500,
      label: 'Full',
      badge: '7B',
      desc: 'Best quality — code & creative',
      ctx: 4096,
      threads: 4,
      quality: 3,
    },
  };

  // ── State ─────────────────────────────────────────────────
  let detectedRAM = null;
  let detectedStorage = null;
  let selectedTier = null;
  let availableModels = [];

  // ── RAM Detection ─────────────────────────────────────────
  // Uses multiple signals for best estimate across all devices
  async function detectRAM() {
    let ramGB = null;

    // 1. navigator.deviceMemory (Chrome Android — most reliable)
    if (navigator.deviceMemory) {
      ramGB = navigator.deviceMemory;
    }

    // 2. Performance memory API (Chrome fallback)
    if (!ramGB && performance.memory) {
      // jsHeapSizeLimit gives a rough ceiling correlated to device RAM
      const heapMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
      if (heapMB > 0) {
        // Heuristic: heap limit is usually ~25-30% of device RAM
        ramGB = Math.round((heapMB * 4) / 1024);
      }
    }

    // 3. UserAgent hints (navigator.userAgentData) — Android Chrome 90+
    if (!ramGB && navigator.userAgentData?.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues(['deviceMemory']);
        if (hints.deviceMemory) ramGB = hints.deviceMemory;
      } catch (_) {}
    }

    // 4. Conservative fallback — assume 2GB if unknown
    if (!ramGB || ramGB < 0.5) ramGB = 2;

    // Clamp to sensible range
    ramGB = Math.max(0.5, Math.min(32, ramGB));
    detectedRAM = ramGB;
    return ramGB;
  }

  // ── Storage Detection ─────────────────────────────────────
  async function detectStorage() {
    let result = { totalGB: null, freeGB: null, source: 'unknown' };

    // 1. StorageManager API (Chrome Android 61+)
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        // quota = available to origin, usage = used
        const freeBytes = (est.quota || 0) - (est.usage || 0);
        result = {
          totalGB: (est.quota || 0) / 1e9,
          freeGB: freeBytes / 1e9,
          usedGB: (est.usage || 0) / 1e9,
          source: 'StorageManager',
        };
      } catch (_) {}
    }

    // 2. If StorageManager gave us something useful, use it
    if (!result.freeGB || result.freeGB < 0.1) {
      // Fallback: estimate based on detected RAM (phones usually have
      // 4-8x their RAM in storage, conservatively assume 16GB free)
      const ramGB = detectedRAM || 2;
      result = {
        totalGB: null,
        freeGB: Math.max(4, ramGB * 4),
        usedGB: null,
        source: 'heuristic',
      };
    }

    detectedStorage = result;
    return result;
  }

  // ── Tier Selection ────────────────────────────────────────
  // Picks the best model the device can actually run
  function selectTier(ramGB, storageFreeGB, manualOverride) {
    if (manualOverride && MODELS[manualOverride]) {
      return manualOverride;
    }

    const ramMB = ramGB * 1024;
    // Leave 400MB headroom for OS + browser
    const usableMB = ramMB - 400;
    const storMB = storageFreeGB * 1024;

    // Try highest quality first, fall back
    if (usableMB >= MODELS.full.ramMB && storMB >= MODELS.full.sizeMB) {
      return 'full';
    }
    if (usableMB >= MODELS.mid.ramMB && storMB >= MODELS.mid.sizeMB) {
      return 'mid';
    }
    return 'nano';
  }

  // ── Check which models exist on the server ────────────────
  async function probeAvailableModels(port = 8080) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return data.data || [];
    } catch (_) {
      return [];
    }
  }

  // ── Main init ─────────────────────────────────────────────
  async function init(manualOverride) {
    const [ramGB, storage] = await Promise.all([detectRAM(), detectStorage()]);
    selectedTier = selectTier(ramGB, storage.freeGB, manualOverride);

    return {
      ram: {
        detected: ramGB,
        usableMB: Math.round(ramGB * 1024 - 400),
        label: ramGB >= 8 ? '8GB+' : ramGB >= 4 ? '4GB' : ramGB >= 2 ? '2GB' : '1GB',
      },
      storage: {
        freeGB: storage.freeGB ? parseFloat(storage.freeGB.toFixed(1)) : null,
        totalGB: storage.totalGB ? parseFloat(storage.totalGB.toFixed(1)) : null,
        source: storage.source,
      },
      selectedTier,
      model: MODELS[selectedTier],
      allModels: MODELS,
      recommendation: buildRecommendation(ramGB, storage.freeGB, selectedTier),
    };
  }

  function buildRecommendation(ramGB, storeFreeGB, tier) {
    const m = MODELS[tier];
    const lines = [];

    lines.push(`Your device has ~${ramGB}GB RAM and ~${storeFreeGB?.toFixed(1) || '?'}GB free storage.`);
    lines.push(`Recommended: ${m.name} (${m.badge}) — ${m.desc}.`);

    if (tier === 'nano' && ramGB >= 2) {
      lines.push('If the Mid model is downloaded, it may also work on your device.');
    }
    if (tier === 'full') {
      lines.push('Your device can run the best model tier available.');
    }

    return lines.join(' ');
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    detectRAM,
    detectStorage,
    selectTier,
    getModel: (id) => MODELS[id] || MODELS.nano,
    getAllModels: () => MODELS,
    getCurrentTier: () => selectedTier,
    getDetectedRAM: () => detectedRAM,
    getDetectedStorage: () => detectedStorage,
  };
})();

window.ModelManager = ModelManager;
