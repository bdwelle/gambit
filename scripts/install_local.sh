#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPORT_MAP_PATH="${HOME}/.deno/bin/gambit.imports.json"

mkdir -p "$(dirname "${IMPORT_MAP_PATH}")"

cat > "${IMPORT_MAP_PATH}" <<JSON
{
  "imports": {
    "@bolt-foundry/gambit-core": "${ROOT_DIR}/packages/gambit-core/mod.ts",
    "@deno/dnt": "jsr:@deno/dnt@^0.42.3",
    "@std/front-matter": "jsr:@std/front-matter@^1.0.9",
    "@std/front-matter/any": "jsr:@std/front-matter@^1.0.9/any",
    "@std/front_matter": "jsr:@std/front_matter@^0.224.4",
    "@std/fs": "jsr:@std/fs@^1.0.20",
    "@std/jsonc": "jsr:@std/jsonc@^1.0.2",
    "@std/path": "jsr:@std/path@^1.0.6",
    "@std/cli": "jsr:@std/cli@^1.0.7",
    "@std/cli/prompt-secret": "jsr:@std/cli@^1.0.7/prompt-secret",
    "@std/dotenv": "jsr:@std/dotenv@^0.225.5",
    "@std/dotenv/parse": "jsr:@std/dotenv@^0.225.5/parse",
    "@std/assert": "jsr:@std/assert@^1.0.6",
    "@std/tar": "jsr:@std/tar@^0.1.9",
    "@std/tar/tar-stream": "jsr:@std/tar@^0.1.9/tar-stream",
    "@std/toml": "jsr:@std/toml@^1.0.9",
    "@std/http": "jsr:@std/http@^1.0.8",
    "playwright-core": "npm:playwright-core@^1.57.0",
    "zod": "npm:zod@^3.23.8",
    "zod-to-json-schema": "npm:zod-to-json-schema@^3.23.0",
    "@openai/openai": "npm:openai@^4.78.1",
    "@google/generative-ai": "npm:@google/generative-ai@^0.24.1",
    "puppeteer-core": "npm:puppeteer-core@^24.35.0",
    "react": "npm:react@^19.2.0",
    "react-dom": "npm:react-dom@^19.2.0"
  }
}
JSON

if ! command -v deno >/dev/null 2>&1; then
  echo "Deno is required (https://deno.land)."
  exit 1
fi

deno install --global -A -f -n gambit \
  --config "${IMPORT_MAP_PATH}" \
  "${ROOT_DIR}/src/cli.ts"

echo "Installed gambit to ~/.deno/bin/gambit"
