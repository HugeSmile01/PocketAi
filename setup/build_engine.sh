#!/usr/bin/env bash
# =============================================================================
# PocketAI — Build llama-server for Android ARM64
# Usage: bash setup/build_engine.sh [llama_cpp_dir]
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "  $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LLAMA_DIR="${1:-$ROOT_DIR/.llama_cpp}"
OUTPUT_DIR="$ROOT_DIR/engine"

step "Building llama-server for Android ARM64"
info "Source: $LLAMA_DIR"
info "Output: $OUTPUT_DIR"

# ── Find NDK ──────────────────────────────────────────────────────────────────
if [ -z "${ANDROID_NDK:-}" ]; then
  COMMON_NDK_PATHS=(
    "$HOME/Android/Sdk/ndk"
    "$HOME/Library/Android/sdk/ndk"
    "/opt/android-ndk"
    "${ANDROID_NDK_HOME:-}"
    "${ANDROID_NDK_PATH:-}"
  )
  for path in "${COMMON_NDK_PATHS[@]}"; do
    if [ -d "$path" ] 2>/dev/null; then
      NDK_VERSION=$(ls "$path" 2>/dev/null | sort -V | tail -1)
      if [ -n "$NDK_VERSION" ]; then
        export ANDROID_NDK="$path/$NDK_VERSION"
        break
      fi
    fi
  done
fi

[ -z "${ANDROID_NDK:-}" ] && fail "ANDROID_NDK not set. Install NDK or set ANDROID_NDK_PATH."
[ -d "$ANDROID_NDK" ]    || fail "NDK path does not exist: $ANDROID_NDK"
ok "Using NDK: $ANDROID_NDK"

# ── Check CMake ───────────────────────────────────────────────────────────────
CMAKE_MIN="3.22"
CMAKE_VERSION=$(cmake --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [ -z "$CMAKE_VERSION" ]; then
  fail "CMake not found. Install CMake $CMAKE_MIN+"
fi
ok "CMake $CMAKE_VERSION"

# ── Build ─────────────────────────────────────────────────────────────────────
BUILD_DIR="$LLAMA_DIR/build-android-arm64"
mkdir -p "$BUILD_DIR"

step "Configuring CMake (ARM64 + FMA optimizations)"
cmake -S "$LLAMA_DIR" -B "$BUILD_DIR" \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-28 \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_NATIVE=OFF \
  -DLLAMA_ARM_FMA=ON \
  -DLLAMA_F16C=OFF \
  -DLLAMA_AVX=OFF \
  -DLLAMA_AVX2=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=ON \
  -Wno-dev \
  --log-level=WARNING
ok "CMake configured"

step "Compiling (this takes 5-15 minutes)"
CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
cmake --build "$BUILD_DIR" --config Release -j"$CORES" --target llama-server llama-cli
ok "Build complete"

# ── Copy binaries ─────────────────────────────────────────────────────────────
step "Installing binaries to $OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for binary in llama-server llama-cli; do
  SRC="$BUILD_DIR/bin/$binary"
  [ -f "$SRC" ] || SRC="$BUILD_DIR/$binary"
  if [ -f "$SRC" ]; then
    cp "$SRC" "$OUTPUT_DIR/$binary"
    chmod +x "$OUTPUT_DIR/$binary"
    SIZE=$(du -sh "$OUTPUT_DIR/$binary" | cut -f1)
    ok "Installed $binary ($SIZE)"
  else
    warn "$binary not found in build output"
  fi
done

# ── Write version info ────────────────────────────────────────────────────────
LLAMA_HASH=$(git -C "$LLAMA_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
cat > "$OUTPUT_DIR/engine_info.json" << EOF
{
  "llama_cpp_commit": "$LLAMA_HASH",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "target_abi": "arm64-v8a",
  "android_platform": "android-28",
  "optimizations": ["ARM_FMA"],
  "built_by": "PocketAI build_engine.sh"
}
EOF

echo ""
echo -e "${GREEN}${BOLD}Engine built successfully!${NC}"
echo -e "  Binaries: $OUTPUT_DIR/"
echo -e "  Next: bash setup/download_model.sh nano"
