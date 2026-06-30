#!/bin/bash
# Setup RTK (Rust Token Killer) for Overlord
# Reduces Claude's token consumption by 60-90% on shell commands

set -e

# Skip if user opts out
if [ "$RTK_SKIP" = "1" ]; then
  echo "[rtk] skipped (RTK_SKIP=1)"
  exit 0
fi

# Check if rtk is installed
if command -v rtk &> /dev/null; then
  echo "[rtk] rtk $(rtk --version 2>/dev/null | head -1) found"
else
  echo "[rtk] rtk not found. Installing..."

  # Try brew first (macOS), then curl
  if command -v brew &> /dev/null; then
    brew install rtk
  else
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi

  if ! command -v rtk &> /dev/null; then
    echo "[rtk] WARNING: rtk installation failed. Overlord will work without it but Claude agents will use more tokens."
    echo "[rtk] Install manually: https://github.com/rtk-ai/rtk#installation"
    exit 0
  fi
fi

# Init rtk for Claude Code if not already done
if rtk init --show 2>&1 | grep -q "\[ok\] Hook"; then
  echo "[rtk] already configured for Claude Code"
else
  echo "[rtk] configuring rtk for Claude Code..."
  mkdir -p "$HOME/.claude"
  if rtk init -g --auto-patch; then
    echo "[rtk] done. Restart Claude Code to activate."
  else
    echo "[rtk] WARNING: rtk configuration failed. Overlord will work without RTK hooks."
    if [ "$CI" = "true" ]; then
      exit 0
    fi
    exit 1
  fi
fi
