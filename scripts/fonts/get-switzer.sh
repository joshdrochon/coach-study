#!/usr/bin/env bash
# pnpm fonts: downloads the Switzer web fonts from Fontshare into public/fonts/switzer.
# The Fontshare license does not allow redistributing the files, so they are not committed.
# Without them the app falls back to the system sans-serif stack.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=public/fonts/switzer
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/switzer.zip" "https://api.fontshare.com/v2/fonts/download/switzer"
for weight in Regular Semibold Bold; do
  unzip -joq "$tmp/switzer.zip" "*/Fonts/WEB/fonts/Switzer-$weight.woff2" -d "$out"
done
echo "fonts: wrote $(ls "$out" | tr '\n' ' ')"
