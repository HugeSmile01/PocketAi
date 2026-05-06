#!/usr/bin/env bash
# =============================================================================
# PocketAI — Model Downloader
# Usage: bash setup/download_model.sh [nano|mid|full]
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "  $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$ROOT_DIR/models"
VENV_DIR="$ROOT_DIR/.venv"

# ── Load .env ─────────────────────────────────────────────────────────────────
[ -f "$ROOT_DIR/.env" ] && source "$ROOT_DIR/.env"

# ── Model registry ────────────────────────────────────────────────────────────
declare -A MODEL_REPO MODEL_FILE MODEL_SIZE MODEL_DESC

MODEL_REPO[nano]="Qwen/Qwen2.5-1.5B-Instruct-GGUF"
MODEL_FILE[nano]="qwen2.5-1.5b-instruct-q4_k_m.gguf"
MODEL_SIZE[nano]="~1.0 GB"
MODEL_DESC[nano]="Nano tier — works on 1-2GB phones. Fast chat and basic tasks."

MODEL_REPO[mid]="Qwen/Qwen2.5-3B-Instruct-GGUF"
MODEL_FILE[mid]="qwen2.5-3b-instruct-q4_k_m.gguf"
MODEL_SIZE[mid]="~2.2 GB"
MODEL_DESC[mid]="Mid tier — 2-4GB phones. RAG, summarization, better reasoning."

MODEL_REPO[full]="Qwen/Qwen2.5-7B-Instruct-GGUF"
MODEL_FILE[full]="qwen2.5-7b-instruct-q4_k_m.gguf"
MODEL_SIZE[full]="~4.5 GB"
MODEL_DESC[full]="Full tier — 4GB+ phones. Code generation, creative writing, long context."

# ── Parse argument ────────────────────────────────────────────────────────────
TIER="${1:-}"

if [ -z "$TIER" ]; then
  echo -e "\n${BOLD}Available model tiers:${NC}\n"
  for t in nano mid full; do
    echo -e "  ${CYAN}$t${NC}  ${MODEL_SIZE[$t]}  —  ${MODEL_DESC[$t]}"
  done
  echo ""
  echo -e "Usage: ${CYAN}bash setup/download_model.sh [nano|mid|full]${NC}"
  echo -e "       ${CYAN}bash setup/download_model.sh all${NC}  (download all three)\n"
  exit 0
fi

download_tier() {
  local tier="$1"
  [ -z "${MODEL_REPO[$tier]+_}" ] && fail "Unknown tier '$tier'. Choose: nano, mid, full"

  echo -e "\n${BOLD}Downloading: ${CYAN}${tier^^} tier${NC}"
  info "Model:  ${MODEL_FILE[$tier]}"
  info "Source: ${MODEL_REPO[$tier]}"
  info "Size:   ${MODEL_SIZE[$tier]}"

  mkdir -p "$MODELS_DIR"

  OUT_FILE="$MODELS_DIR/${MODEL_FILE[$tier]}"
  if [ -f "$OUT_FILE" ]; then
    EXISTING_SIZE=$(du -sh "$OUT_FILE" | cut -f1)
    warn "Already downloaded ($EXISTING_SIZE). Delete $OUT_FILE to re-download."
    return
  fi

  # Activate venv
  if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
  else
    warn "Virtual environment not found. Run setup/install.sh first."
    warn "Attempting download with curl fallback..."
    FALLBACK_URL="https://huggingface.co/${MODEL_REPO[$tier]}/resolve/main/${MODEL_FILE[$tier]}"
    if [ -n "${HF_TOKEN:-}" ]; then
      curl -L -H "Authorization: Bearer $HF_TOKEN" \
           --progress-bar --retry 5 --retry-delay 3 \
           -o "$OUT_FILE" "$FALLBACK_URL"
    else
      curl -L --progress-bar --retry 5 --retry-delay 3 \
           -o "$OUT_FILE" "$FALLBACK_URL"
    fi
    ok "Downloaded: $OUT_FILE"
    return
  fi

  # Use huggingface_hub for reliable downloads with resume
  python3 - << PYEOF
import sys, os
from huggingface_hub import hf_hub_download

token = os.environ.get("HF_TOKEN") or None
repo_id = "${MODEL_REPO[$tier]}"
filename = "${MODEL_FILE[$tier]}"
local_dir = "${MODELS_DIR}"

print(f"  Downloading {filename} from {repo_id}...")
try:
    path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=local_dir,
        token=token,
    )
    size = os.path.getsize(path) / (1024**3)
    print(f"  Saved: {path} ({size:.2f} GB)")
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
PYEOF

  ok "Model ready: $OUT_FILE"

  # Write tier metadata
  cat > "$MODELS_DIR/${tier}_info.json" << EOF
{
  "tier": "$tier",
  "filename": "${MODEL_FILE[$tier]}",
  "repo": "${MODEL_REPO[$tier]}",
  "quantization": "Q4_K_M",
  "downloaded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# ── Run ───────────────────────────────────────────────────────────────────────
if [ "$TIER" = "all" ]; then
  for t in nano mid full; do
    download_tier "$t"
  done
else
  download_tier "$TIER"
fi

echo ""
echo -e "${GREEN}${BOLD}Done!${NC} Next: ${CYAN}bash setup/deploy_to_drive.sh /path/to/your/drive${NC}"
