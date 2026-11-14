#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
crate="${root}/tools/vtracer-wasm"

export PATH="${HOME}/.cargo/bin:${PATH}"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Install wasm-pack and the wasm32-unknown-unknown Rust target before building VTracer." >&2
  exit 1
fi

cd "$crate"
wasm-pack build --target web --release --out-dir "${root}/assets/wasm/vtracer"
printf '*.d.ts\n' > "${root}/assets/wasm/vtracer/.gitignore"
