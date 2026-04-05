#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
HOST="${HOST:-0.0.0.0}"

cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

echo "Building app..."
npm run build

echo "Hosting built app at http://${HOST}:${PORT}"
npm run preview -- --host "$HOST" --port "$PORT"
