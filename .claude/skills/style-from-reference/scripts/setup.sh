#!/usr/bin/env bash
# name: setup.sh
# description: One-time install of the style-from-reference analyzer (venv + Python packages + models).
# usage: setup.sh [--no-models | --light]
#   --no-models  install everything but download models on first use
#   --light      picture analysis only (Pillow + yt-dlp, about 50 MB): no stems, transcript, rhythm or tags
# env:
#   STYLE_REF_HOME   where the venv and models live (default: ~/.cache/style-from-reference)
#   STYLE_REF_TORCH  "cpu" (default) or "cuda"; only matters on Linux, where it picks the torch wheels
# Works the same on macOS and on a Linux server. Needs python3.10-3.12 and ffmpeg on PATH.
# Remove everything again with: rm -rf "$STYLE_REF_HOME"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${STYLE_REF_HOME:-$HOME/.cache/style-from-reference}"
VENV="$HOME_DIR/venv"
TORCH_FLAVOUR="${STYLE_REF_TORCH:-cpu}"
WARM=1
[ "${1:-}" = "--no-models" ] && WARM=0
LIGHT=0
[ "${1:-}" = "--light" ] && LIGHT=1

die() { echo "setup: $*" >&2; exit 1; }

PY=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || die "need python3.12, 3.11 or 3.10 on PATH (torch does not support newer versions yet)"
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found (macOS: brew install ffmpeg; Debian/Ubuntu: apt-get install ffmpeg)"
command -v ffprobe >/dev/null 2>&1 || die "ffprobe not found (it ships with ffmpeg)"

mkdir -p "$HOME_DIR"
[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
PIP=("$VENV/bin/python" -m pip --disable-pip-version-check)
"${PIP[@]}" install --quiet --upgrade pip

if [ "$LIGHT" = "1" ]; then
  "${PIP[@]}" install --upgrade "Pillow>=10.1" yt-dlp
  echo "setup: light install done. Analyze with: --skip stems,transcript,rhythm,tags"
  exit 0
fi

TORCH_PINS="$(grep -E '^(torch|torchaudio)==' "$HERE/requirements.txt" | tr '\n' ' ')"
if [ "$(uname -s)" = "Linux" ] && [ "$TORCH_FLAVOUR" = "cpu" ]; then
  # The default Linux wheels bundle several GB of CUDA libraries a CPU server never uses.
  # shellcheck disable=SC2086
  "${PIP[@]}" install $TORCH_PINS --index-url https://download.pytorch.org/whl/cpu
else
  # shellcheck disable=SC2086
  "${PIP[@]}" install $TORCH_PINS
fi
"${PIP[@]}" install -r "$HERE/requirements.txt"
"${PIP[@]}" install --quiet --upgrade yt-dlp   # TikTok changes often; keep the downloader current

if [ "$WARM" = "1" ]; then
  bash "$HERE/style-ref" warm
fi
bash "$HERE/style-ref" doctor
