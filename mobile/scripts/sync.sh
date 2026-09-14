#!/usr/bin/env bash
set -euo pipefail

mobile_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm -C "$mobile_dir/../app" build
pnpm -C "$mobile_dir" exec cap sync
