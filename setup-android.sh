#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node --version
npm install
npm run verify:source
npm run setup:android
npm run open:android
