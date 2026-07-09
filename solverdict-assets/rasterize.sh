#!/usr/bin/env bash
# Rasterize SolVerdict SVGs → PNG / ICO.
#
# Requires:
#   rsvg-convert   → sudo apt install librsvg2-bin
#   python3 + PIL  → pip install Pillow   (only for the .ico assembly)
#
# Everything is rendered straight from the SVG source, so miter joins and butt
# caps are preserved exactly. Do NOT replace this with a PIL-drawn renderer:
# PIL's ImageDraw.line() only offers joint="curve", which rounds every vertex
# and silently breaks the sharp check mark and the pointed hex apex.

set -euo pipefail
cd "$(dirname "$0")"

command -v rsvg-convert >/dev/null || {
  echo "error: rsvg-convert not found. Run: sudo apt install librsvg2-bin" >&2
  exit 1
}

mkdir -p png ico

FAVICON_SIZES=(16 32 48 64 96 128 192 256 512)

echo "Rendering favicons (dark background)…"
for s in "${FAVICON_SIZES[@]}"; do
  rsvg-convert -w "$s" -h "$s" -o "png/favicon-${s}.png" svg/favicon.svg
  echo "  → png/favicon-${s}.png"
done

echo "Rendering symbol (transparent)…"
for s in "${FAVICON_SIZES[@]}"; do
  rsvg-convert -w "$s" -h "$s" -o "png/symbol-transparent-${s}.png" svg/solverdict-symbol.svg
  echo "  → png/symbol-transparent-${s}.png"
done

echo "Rendering apple-touch-icon (180, dark)…"
rsvg-convert -w 180 -h 180 -o png/apple-touch-icon.png svg/favicon.svg

echo "Rendering lockups…"
rsvg-convert -w 1400 -o png/lockup.png              svg/solverdict-lockup.svg
rsvg-convert -w 1400 -o png/lockup-dark.png         svg/solverdict-lockup-dark.svg
rsvg-convert -w 1240 -o png/lockup-compact.png      svg/solverdict-lockup-compact.svg

echo "Rendering og-image (1200x630, dark, centered)…"
rsvg-convert -w 1100 -o png/.og-tmp.png svg/solverdict-lockup.svg
python3 - <<'PY'
from PIL import Image
src = Image.open("png/.og-tmp.png").convert("RGBA")
canvas = Image.new("RGBA", (1200, 630), (11, 15, 20, 255))  # #0B0F14
canvas.paste(src, ((1200 - src.width)//2, (630 - src.height)//2), src)
canvas.convert("RGB").save("png/og-image.png")
PY
rm -f png/.og-tmp.png
echo "  → png/og-image.png"

echo "Assembling favicon.ico (16, 32, 48)…"
python3 - <<'PY'
import struct
from PIL import Image

def write_ico(paths, out):
    entries, blobs = [], []
    for p in paths:
        blob = open(p, "rb").read()
        w, h = Image.open(p).size
        entries.append((0 if w >= 256 else w, 0 if h >= 256 else h, len(blob)))
        blobs.append(blob)
    offset = 6 + 16 * len(entries)
    with open(out, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(entries)))
        for w, h, size in entries:
            f.write(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, size, offset))
            offset += size
        for blob in blobs:
            f.write(blob)

write_ico([f"png/favicon-{s}.png" for s in (16, 32, 48)], "ico/favicon.ico")
write_ico([f"png/symbol-transparent-{s}.png" for s in (16, 32, 48)],
          "ico/favicon-transparent.ico")
PY
echo "  → ico/favicon.ico"
echo "  → ico/favicon-transparent.ico"

echo
echo "Done. Verify the check mark is sharp (not rounded):"
echo "  python3 -c \"from PIL import Image; Image.open('png/favicon-512.png').crop((140,210,260,330)).resize((360,360), Image.NEAREST).save('/tmp/check.png')\""
