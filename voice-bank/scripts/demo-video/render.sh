#!/bin/sh
# Renders the five-minute demo video end to end from a running /demo stage.
# Usage: sh scripts/demo-video/render.sh <out_dir> [stage_url]
# Needs: the app dev server (default http://localhost:5201), ffmpeg with libx264, python3 + numpy.
set -e
OUT=${1:?out dir}
URL=${2:-http://localhost:5201}
cd "$(dirname "$0")/../.."
rm -rf "$OUT/frames"
mkdir -p "$OUT"
node scripts/demo-video/record.cjs --url "$URL" --out "$OUT" --workers 4
python3 scripts/demo-video/mix.py "$OUT/timeline.json" public/demo/voice "$OUT"
python3 scripts/demo-video/srt.py "$OUT/timeline.json" "$OUT/subtitles.srt"
ffmpeg -y -loglevel error -i "$OUT/mix.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 "$OUT/mix-norm.wav"
ffmpeg -y -loglevel error -framerate 30 -i "$OUT/frames/f_%05d.jpg" -i "$OUT/mix-norm.wav" \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -level 4.1 -r 30 \
  -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT/zhixing-demo-5min.mp4"
ffmpeg -i "$OUT/zhixing-demo-5min.mp4" 2>&1 | grep -E "Duration|Stream" || true
