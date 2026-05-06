#!/usr/bin/env bash
# =============================================================================
# PocketAI — Main Installer
# Run: bash setup/install.sh
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

DOWNLOAD_ENGINE=false
for arg in "$@"; do
  [[ "$arg" == "--download-engine" ]] && DOWNLOAD_ENGINE=true
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'EOF'
  ██████╗  ██████╗  ██████╗██╗  ██╗███████╗████████╗ █████╗ ██╗
  ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝██╔══██╗██║
  ██████╔╝██║   ██║██║     █████╔╝ █████╗     ██║   ███████║██║
  ██╔═══╝ ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   ██╔══██║██║
  ██║     ╚██████╔╝╚██████╗██║  ██╗███████╗   ██║   ██║  ██║██║
  ╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝
EOF
echo -e "${NC}"
echo -e "${BOLD}  Private Offline AI on a Flash Drive${NC}"
echo -e "  ─────────────────────────────────────\n"

# ── Helper functions ──────────────────────────────────────────────────────────
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "  ${NC}$1${NC}"; }

# ── Detect OS ─────────────────────────────────────────────────────────────────
step "Detecting environment"
OS="$(uname -s)"
ARCH="$(uname -m)"
info "OS: $OS | Arch: $ARCH"

case "$OS" in
  Linux)   PKG_MGR=$(command -v apt-get || command -v dnf || command -v pacman || echo "") ;;
  Darwin)  PKG_MGR="brew" ;;
  *)       warn "Untested OS: $OS. Proceeding anyway." ;;
esac
ok "Environment detected"

# ── Check dependencies ────────────────────────────────────────────────────────
step "Checking dependencies"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 found ($(command -v "$1"))"
    return 0
  else
    return 1
  fi
}

MISSING=()
check_cmd git    || MISSING+=("git")
check_cmd cmake  || MISSING+=("cmake")
check_cmd python3 || MISSING+=("python3")
check_cmd curl   || MISSING+=("curl")

if [ ${#MISSING[@]} -gt 0 ]; then
  warn "Missing: ${MISSING[*]}"
  step "Installing missing dependencies"
  
  if [[ "$OS" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq
      sudo apt-get install -y "${MISSING[@]}" build-essential
      ok "Installed via apt"
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y "${MISSING[@]}" gcc g++ make
      ok "Installed via dnf"
    elif command -v pacman &>/dev/null; then
      sudo pacman -Sy --noconfirm "${MISSING[@]}" base-devel
      ok "Installed via pacman"
    else
      fail "Cannot auto-install. Please install: ${MISSING[*]}"
    fi
  elif [[ "$OS" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
      info "Installing Homebrew..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install "${MISSING[@]}"
    ok "Installed via Homebrew"
  fi
fi

# ── Check for Android NDK ─────────────────────────────────────────────────────
step "Checking Android NDK"

NDK_FOUND=false
COMMON_NDK_PATHS=(
  "$HOME/Android/Sdk/ndk"
  "$HOME/Library/Android/sdk/ndk"
  "/opt/android-ndk"
  "$ANDROID_NDK_HOME"
  "$ANDROID_NDK_PATH"
)

for path in "${COMMON_NDK_PATHS[@]}"; do
  if [ -d "$path" ] 2>/dev/null; then
    # Find latest NDK version
    NDK_VERSION=$(ls "$path" 2>/dev/null | sort -V | tail -1)
    if [ -n "$NDK_VERSION" ]; then
      export ANDROID_NDK="$path/$NDK_VERSION"
      NDK_FOUND=true
      ok "NDK found: $ANDROID_NDK"
      break
    fi
  fi
done

if [ "$NDK_FOUND" = false ]; then
  warn "Android NDK not found."
  echo ""
  echo -e "  To install NDK:"
  echo -e "  1. Open Android Studio → SDK Manager → SDK Tools"
  echo -e "  2. Check 'NDK (Side by side)' → Apply"
  echo -e "  3. Or set ANDROID_NDK_PATH=/path/to/ndk in your environment"
  echo ""
  if [ "$DOWNLOAD_ENGINE" = false ]; then
    warn "Skipping engine build. Run with --download-engine to download prebuilt binary."
    warn "Or install NDK and re-run: bash setup/install.sh"
  fi
fi

# ── Clone / update llama.cpp ──────────────────────────────────────────────────
step "Setting up llama.cpp"

LLAMA_DIR="$(dirname "$0")/../.llama_cpp"

if [ -d "$LLAMA_DIR" ]; then
  info "llama.cpp already cloned, pulling latest..."
  git -C "$LLAMA_DIR" pull --quiet
  ok "llama.cpp updated"
else
  info "Cloning llama.cpp..."
  git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_DIR" --quiet
  ok "llama.cpp cloned"
fi

# ── Build engine ──────────────────────────────────────────────────────────────
if [ "$NDK_FOUND" = true ]; then
  step "Building inference engine for Android ARM64"
  bash "$(dirname "$0")/build_engine.sh" "$LLAMA_DIR"
elif [ "$DOWNLOAD_ENGINE" = true ]; then
  step "Downloading prebuilt engine binary"
  bash "$(dirname "$0")/download_engine.sh"
else
  warn "Engine not built. Run 'bash setup/build_engine.sh' after installing NDK."
fi

# ── Setup Python deps for model download ──────────────────────────────────────
step "Setting up Python environment"

VENV_DIR="$(dirname "$0")/../.venv"
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  ok "Virtual environment created"
fi

source "$VENV_DIR/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet huggingface_hub tqdm

ok "Python dependencies installed"

# ── Create .env config ────────────────────────────────────────────────────────
step "Creating configuration"

CONFIG_FILE="$(dirname "$0")/../.env"
if [ ! -f "$CONFIG_FILE" ]; then
cat > "$CONFIG_FILE" << 'ENVEOF'
# PocketAI Configuration
# Edit these values to match your setup

# Default model tier: nano | mid | full
DEFAULT_MODEL_TIER=nano

# Inference server port
SERVER_PORT=8080

# Context window size (tokens)
# 2048 = safe for 1-2GB phones
# 4096 = better for 3GB+ phones
CONTEXT_SIZE=2048

# Number of CPU threads for inference
# Rule of thumb: number of physical CPU cores - 1
CPU_THREADS=4

# Your flash drive mount path (auto-detected if blank)
DRIVE_PATH=

# Cloud fallback API endpoint (optional)
# Leave blank to disable cloud fallback
CLOUD_API_ENDPOINT=

# HuggingFace token (optional, needed for gated models)
HF_TOKEN=
ENVEOF
  ok "Configuration file created: .env"
else
  ok "Configuration file already exists"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       Installation Complete! ✓        ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. Download a model:"
echo -e "     ${CYAN}bash setup/download_model.sh nano${NC}   (~1GB, any phone)"
echo -e "     ${CYAN}bash setup/download_model.sh mid${NC}    (~2.2GB)"
echo -e "     ${CYAN}bash setup/download_model.sh full${NC}   (~4.5GB, flagship)"
echo ""
echo -e "  2. Deploy to your flash drive:"
echo -e "     ${CYAN}bash setup/deploy_to_drive.sh /path/to/drive${NC}"
echo ""
echo -e "  3. On your phone: plug in drive, open Termux, run:"
echo -e "     ${CYAN}bash /storage/[DRIVE]/setup/termux_setup.sh${NC}"
echo ""
echo -e "  4. Open Chrome and load:"
echo -e "     ${CYAN}file:///storage/[DRIVE]/app/index.html${NC}"
echo ""
