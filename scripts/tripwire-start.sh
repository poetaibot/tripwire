#!/usr/bin/env bash
set -euo pipefail
cd /home/claw/.openclaw/workspace/tripwire
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
exec npm start
