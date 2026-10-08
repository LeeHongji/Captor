#!/bin/zsh
set -e
cd "$(dirname "$0")"
exec npm run dev -- --host 127.0.0.1
