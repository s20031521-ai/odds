#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/hdc-collector.mjs
