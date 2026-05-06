#!/usr/bin/env bash
# =============================================================================
# PocketAI — Deploy to Flash Drive
# Usage: bash setup/deploy_to_drive.sh /path/to/flashdrive
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
DRIVE_PATH="${1:-}"

# ── Validate drive path ───────────────────────────────────────────────────────
if [ -z "$DRIVE_PATH" ]; then
  echo -e "\nUsage: ${CYAN}bash setup/deploy_to_drive.sh /path/to/flashdrive${NC}\n"
  echo "Common paths:"
  echo "  macOS:  /Volumes/DRIVE_NAME"
  echo "  Linux:  /media/\$USER/DRIVE_NAME  or  /mnt/usb"
  echo "  WSL2:   /mnt/d  (if drive is D:)"
  exit 1
fi

[ -d "$DRIVE_PATH" ] || fail "Drive path not found: $DRIVE_PATH"

# ── Check available space ─────────────────────────────────────────────────────
step "Checking drive space"

AVAIL_KB=$(df -k "$DRIVE_PATH" | tail -1 | awk '{print $4}')
AVAIL_GB=$(echo "scale=1; $AVAIL_KB / 1048576" | bc)
info "Available: ${AVAIL_GB} GB on $DRIVE_PATH"

# Calculate size of what we're copying
SOURCE_SIZE_KB=$(du -sk "$ROOT_DIR/app" "$ROOT_DIR/engine" "$ROOT_DIR/setup" "$ROOT_DIR/scripts" "$ROOT_DIR/docs" 2>/dev/null | awk '{sum+=$1} END {print sum}')
MODELS_SIZE_KB=$(du -sk "$ROOT_DIR/models" 2>/dev/null | awk '{print $1}' || echo 0)
TOTAL_KB=$((SOURCE_SIZE_KB + MODELS_SIZE_KB))
TOTAL_GB=$(echo "scale=1; $TOTAL_KB / 1048576" | bc)

info "Deploying: ~${TOTAL_GB} GB"

if [ "$AVAIL_KB" -lt "$TOTAL_KB" ]; then
  fail "Not enough space. Need ~${TOTAL_GB}GB but only ${AVAIL_GB}GB available."
fi
ok "Sufficient space"

# ── Create directory structure on drive ───────────────────────────────────────
step "Creating PocketAI folder structure on drive"

DEST="$DRIVE_PATH/pocketai"
mkdir -p "$DEST"/{app,engine,models,docs,setup,scripts}
ok "Directory structure created"

# ── Copy function with progress ───────────────────────────────────────────────
copy_dir() {
  local src="$1" dest="$2" label="$3"
  if [ -d "$src" ] && [ "$(ls -A "$src" 2>/dev/null)" ]; then
    rsync -av --progress "$src/" "$dest/" 2>/dev/null | tail -5 || \
      cp -r "$src/." "$dest/"
    ok "$label copied"
  else
    warn "$label: source empty or missing ($src), skipping"
  fi
}

step "Copying app (PWA)"
copy_dir "$ROOT_DIR/app" "$DEST/app" "PWA"

step "Copying inference engine"
if [ -f "$ROOT_DIR/engine/llama-server" ]; then
  copy_dir "$ROOT_DIR/engine" "$DEST/engine" "Engine binaries"
else
  warn "Engine binary not found. Build it with: bash setup/build_engine.sh"
  warn "Or re-run with --download-engine flag after setup/install.sh"
fi

step "Copying models"
if [ "$(ls -A "$ROOT_DIR/models" 2>/dev/null)" ]; then
  copy_dir "$ROOT_DIR/models" "$DEST/models" "Model files"
else
  warn "No models found. Run: bash setup/download_model.sh nano"
fi

step "Copying setup scripts"
copy_dir "$ROOT_DIR/setup" "$DEST/setup" "Setup scripts"
copy_dir "$ROOT_DIR/scripts" "$DEST/scripts" "Launch scripts"

# ── Make all scripts executable ───────────────────────────────────────────────
step "Setting permissions"
find "$DEST" -name "*.sh" -exec chmod +x {} \;
[ -f "$DEST/engine/llama-server" ] && chmod +x "$DEST/engine/llama-server"
[ -f "$DEST/engine/llama-cli" ]    && chmod +x "$DEST/engine/llama-cli"
ok "Permissions set"

# ── Write drive manifest ──────────────────────────────────────────────────────
step "Writing drive manifest"

MODELS_JSON="[]"
if [ -d "$DEST/models" ]; then
  MODELS_JSON=$(python3 - << 'PYEOF' 2>/dev/null || echo "[]"
import json, os, glob
models_dir = os.environ.get("DEST", "") + "/models"
models = []
for f in glob.glob(f"{models_dir}/*.gguf"):
    name = os.path.basename(f)
    size = os.path.getsize(f)
    tier = "nano" if "1.5b" in name.lower() else ("full" if "7b" in name.lower() else "mid")
    models.append({"filename": name, "size_bytes": size, "tier": tier})
print(json.dumps(models))
PYEOF
)
fi

cat > "$DEST/drive_manifest.json" << EOF
{
  "product": "PocketAI",
  "version": "1.0.0",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "drive_path": "$DRIVE_PATH",
  "models": $MODELS_JSON,
  "engine_present": $([ -f "$DEST/engine/llama-server" ] && echo "true" || echo "false")
}
EOF
ok "Drive manifest written"

# ── Summary ───────────────────────────────────────────────────────────────────
FINAL_SIZE=$(du -sh "$DEST" | cut -f1)
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       Flash Drive Ready! ✓                    ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Drive: ${CYAN}$DRIVE_PATH${NC}"
echo -e "  Used:  ${CYAN}$FINAL_SIZE${NC}"
echo ""
echo -e "  ${BOLD}On your Android phone:${NC}"
echo ""
echo -e "  1. Install Termux from F-Droid:"
echo -e "     ${CYAN}https://f-droid.org/packages/com.termux/${NC}"
echo ""
echo -e "  2. Plug in your flash drive (OTG adapter if needed)"
echo ""
echo -e "  3. In Termux, run the setup script:"
echo -e "     ${CYAN}bash /storage/[DRIVE_UUID]/pocketai/setup/termux_setup.sh${NC}"
echo -e "     (Replace [DRIVE_UUID] with your drive's folder name in /storage/)"
echo ""
echo -e "  4. Open Chrome and navigate to:"
echo -e "     ${CYAN}file:///storage/[DRIVE_UUID]/pocketai/app/index.html${NC}"
echo ""
