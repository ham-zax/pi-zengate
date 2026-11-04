#!/usr/bin/env bash
# Pi + ZenGate setup for Linux, macOS and WSL.
# This file holds no gateway URL and no key: it asks you for both.
# Run it with:  curl -fsSL https://pastebin.com/raw/XXXXXXX | bash
set -euo pipefail

dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
file="$dir/zengate.json"

printf '\n=== Pi + ZenGate setup ===\n'
printf 'Config file: %s\n' "$file"

while :; do
  read -r -p 'Gateway /v1 URL: ' url
  url="$(printf '%s' "${url//[[:space:]]/}" | sed 's:/*$::')"
  case "$url" in
    http://*|https://*) ;;
    *) printf 'A http:// or https:// URL is required.\n'; continue ;;
  esac
  case "$url" in
    */v1) ;;
    *) url="$url/v1" ;;
  esac
  break
done

read -r -s -p 'Gateway API key (hidden): ' key
printf '\n'
key="${key//[[:space:]]/}"
if [ -z "$key" ]; then
  printf 'No API key entered. Nothing was written.\n' >&2
  exit 1
fi
if [[ "$key" == *'"'* || "$key" == *\\* ]]; then
  printf 'The key contains a quote or backslash. Write %s by hand.\n' "$file" >&2
  exit 1
fi

umask 077
mkdir -p "$dir"
printf '{\n  "baseUrl": "%s",\n  "apiKey": "%s"\n}\n' "$url" "$key" > "$file"
chmod 600 "$file"
printf 'Wrote %s\n' "$file"

models="$dir/models.json"
if [ -f "$models" ] && grep -q 'opencode2api' "$models"; then
  if command -v jq >/dev/null 2>&1; then
    count="$(jq -r '.providers | keys | length' "$models" 2>/dev/null || printf '?')"
    if [ "$count" = "1" ]; then
      mv "$models" "$models.disabled"
      printf 'Old models.json held only opencode2api, so it moved to models.json.disabled.\n'
    else
      printf 'models.json holds other providers too. Delete its "opencode2api" entry by hand.\n'
    fi
  else
    printf 'models.json mentions opencode2api. Delete that entry if the extension shows no models.\n'
  fi
fi

printf '\n'
if command -v pi >/dev/null 2>&1; then
  found="$(pi --list-models 2>/dev/null | grep -c '^[[:space:]]*opencode2api' || true)"
  printf 'opencode2api models found: %s\n' "$found"
  if [ "$found" = "0" ]; then
    printf 'Zero models: restart Pi, then run  pi --list-models\n'
  else
    printf 'Done. In Pi run /zengate to see the catalog state.\n'
  fi
else
  printf 'pi is not on PATH. Open Pi later and run  /zengate\n'
fi
