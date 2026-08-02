#!/usr/bin/env python3
"""Decode Mine Bombers 3.11 .SPY images to PNG.

Format (reverse-engineered for this project):
  - 768-byte palette: 256 RGB triplets, 8-bit values that the game loads into the
    6-bit VGA DAC (>>2). Only the first 16 entries are used.
  - RLE stream: byte 0x01 escapes a run `01 <colour> <count>`; other bytes are
    literal pixels. Runs are clamped at 38400-byte plane boundaries (excess
    discarded).
  - Decoded 153600 bytes = 4 bitplanes of 38400 bytes each: VGA mode 12h,
    640x480, 80 bytes/row, MSB-first; plane p holds bit p of the colour index.

Also handles the companion formats:
  - .PPM files are ordinary PCX images (open with any image tool).
  - .VOC files are headerless raw unsigned 8-bit PCM (~11025 Hz mono).

Usage: decode_spy.py FILE.SPY [OUT.png]
"""
import sys
from PIL import Image

PLANE = 38400
TOTAL = PLANE * 4
W, H = 640, 480


def rle_decode(data: bytes) -> bytearray:
    out = bytearray()
    i = 0
    while i < len(data) and len(out) < TOTAL:
        b = data[i]
        if b == 0x01 and i + 2 < len(data):
            colour, count = data[i + 1], data[i + 2]
            boundary = ((len(out) // PLANE) + 1) * PLANE
            out.extend([colour] * min(count, boundary - len(out)))
            i += 3
        else:
            out.append(b)
            i += 1
    out.extend(b"\0" * (TOTAL - len(out)))
    return out


def decode(path: str) -> Image.Image:
    raw = open(path, "rb").read()
    palette = raw[:768]
    planes = rle_decode(raw[768:])
    buf = bytearray(W * H)
    for p in range(4):
        base = p * PLANE
        bit = 1 << p
        for y in range(H):
            row = base + y * 80
            for xb in range(80):
                b = planes[row + xb]
                if not b:
                    continue
                o = y * W + xb * 8
                for k in range(8):
                    if b & (0x80 >> k):
                        buf[o + k] |= bit
    img = Image.frombytes("P", (W, H), bytes(buf))
    img.putpalette(palette)
    return img


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".png"
    decode(src).convert("RGB").save(dst)
    print(dst)
