# 🧠 PocketAI

> Your private, offline AI on a flash drive. No cloud. No subscriptions. No data leaks.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform: Android](https://img.shields.io/badge/Platform-Android-brightgreen.svg)]()
[![Model: Qwen2.5](https://img.shields.io/badge/Model-Qwen2.5-blue.svg)]()

---

## ⚡ One-Command Setup

```bash
git clone https://github.com/YOUR_USERNAME/pocketai.git && cd pocketai && bash setup/install.sh
```

That's it. The script handles everything.

---

## What is PocketAI?

PocketAI is a fully offline AI assistant that runs from a USB flash drive on any Android phone. Plug in the drive, open Chrome, and you have a private AI that:

- 🔒 **Never sends your data anywhere** — 100% local inference
- 📱 **Works on 1GB+ RAM phones** — adaptive model tiering
- 💾 **Lives on your flash drive** — no app install required
- 🔌 **Cloud fallback optional** — bring your own API key when offline isn't enough
- 🧩 **Extensible via plugins** — PDF Summarizer, Code Helper, Prompt Library included

---

## Hardware Requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| Android Phone | 2GB RAM, Android 8+ | 4GB+ RAM, Android 12+ |
| Flash Drive | 16GB USB-A or USB-C | 32GB+ USB-C (faster) |
| OTG Support | Required | Required |
| Browser | Chrome 90+ | Chrome latest |

---

## Architecture

```
┌─────────────────────────────────────────┐
│           FLASH DRIVE                   │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │  GGUF    │  │  llama   │  │  PWA  │ │
│  │  Models  │→ │  server  │→ │  App  │ │
│  └──────────┘  └──────────┘  └───────┘ │
│                  localhost:8080          │
└─────────────────────────────────────────┘
```

Three tiers, all on the flash drive, communicating over localhost.

---

## Model Tiers (Auto-Selected by RAM)

| Tier | Model | RAM Needed | Best For |
|------|-------|-----------|---------|
| Nano | Qwen2.5-1.5B Q4_K_M | ~700MB | Chat, 1-2GB phones |
| Mid | Qwen2.5-3B Q4_K_M | ~1.5GB | RAG, summarization |
| Full | Qwen2.5-7B Q4_K_M | ~3.5GB | Code, creative, 4GB+ |

---

## Quick Start (After Cloning)

### Step 1 — Run the installer
```bash
bash setup/install.sh
```

### Step 2 — Download a model
```bash
bash setup/download_model.sh nano    # ~1GB, works on all phones
bash setup/download_model.sh mid     # ~2.2GB
bash setup/download_model.sh full    # ~4.5GB
```

### Step 3 — Copy to your flash drive
```bash
bash setup/deploy_to_drive.sh /path/to/your/drive
```

### Step 4 — On your Android phone
1. Plug in the flash drive via OTG
2. Install Termux from F-Droid: https://f-droid.org/packages/com.termux/
3. In Termux: `bash /storage/[DRIVE]/setup/termux_setup.sh`
4. Open Chrome → navigate to `file:///storage/[DRIVE]/app/index.html`
5. Tap "Install App" when Chrome prompts

---

## Project Structure

```
pocketai/
├── app/                    # Progressive Web App
│   ├── index.html          # Entry point
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service worker
│   ├── css/
│   │   └── main.css        # All styles
│   ├── js/
│   │   ├── app.js          # Core chat logic
│   │   ├── model-manager.js # RAM detection + tier switching
│   │   ├── rag.js          # Local RAG pipeline
│   │   └── plugins.js      # Plugin loader
│   └── plugins/
│       ├── pdf-summarizer/ # PDF extraction + summary
│       ├── code-helper/    # Syntax highlighting + code chat
│       └── prompt-library/ # Preset system prompts
├── engine/                 # Compiled llama-server goes here
├── models/                 # GGUF model files go here
├── docs/                   # User's RAG document store
├── setup/
│   ├── install.sh          # Main installer (run this first)
│   ├── download_model.sh   # Model downloader
│   ├── deploy_to_drive.sh  # Copy everything to flash drive
│   ├── termux_setup.sh     # Runs on the Android phone
│   └── build_engine.sh     # Cross-compile llama-server (optional)
└── scripts/
    ├── launch.sh           # Start the inference server
    └── health_check.sh     # Verify everything is running
```

---

## Building the Engine from Source

The engine (llama-server) must be compiled for ARM64 Android. The automated script handles this:

```bash
bash setup/build_engine.sh
```

Requirements: Android NDK r26+, CMake 3.22+. Set `ANDROID_NDK_PATH` in your environment first.

Alternatively, download a pre-compiled binary:
```bash
bash setup/install.sh --download-engine
```

---

## Plugins

PocketAI ships with 3 plugins. Add your own by creating a folder in `app/plugins/` with a `manifest.json`.

| Plugin | Description |
|--------|-------------|
| PDF Summarizer | Drag-drop any PDF, get a summary |
| Code Helper | Syntax highlighting + code-focused prompting |
| Prompt Library | Swap AI persona with one tap |

Plugin format documentation: [docs/plugin-spec.md](docs/plugin-spec.md)

---

## License

MIT — use it, sell it, modify it. Model licenses are separate (see [docs/licenses.md](docs/licenses.md)).

---

## Roadmap

- [ ] Phase 0: Core inference loop validated
- [ ] Phase 1: NDK engine + RAM tier switcher  
- [ ] Phase 2: PWA chat UI + USB status page
- [ ] Phase 3: RAG pipeline + 3 launch plugins
- [ ] Phase 4: Encryption + license keys + cloud fallback

---

*Built solo. No VC. No cloud dependency. Just a flash drive and a dream.*
