# Reverse-Engineering the Mine Bombers `.SPY` Image Format

This document describes the `.SPY` graphics format used by *Mine Bombers 3.11*
(Skitso Productions, 1997), how it was reverse-engineered for the Open Bombers
remake, and the false trails along the way. As far as we know, this format has
never been publicly documented — a web search turned up nothing beyond the game
itself on abandonware archives.

The reference implementation is `tools/decode_spy.py`. It reproduces the game's
own renderer **pixel-perfectly**, verified against a live screen capture of the
original game (see "Verification" below).

## TL;DR — the format

A `.SPY` file has two parts:

1. **Palette** — 768 bytes: 256 RGB triplets. The values are 8-bit but the game
   feeds them to the 6-bit VGA DAC (i.e. it shifts them right by 2). Only the
   first 16 entries are meaningful; the rest are padding/garbage, often
   duplicates.
2. **RLE-compressed pixel data** — a byte stream where `0x01` is an escape:

   - `0x01 <colour> <count>` emits `count` copies of `colour` (count is 1–255).
   - Any other byte is a literal output byte.
   - A pixel value of `0x01` never appears as a literal; the encoder writes it
     as a run (`01 01 <n>`), which is what makes the escape unambiguous.
   - **Runs are clamped at 38,400-byte output boundaries**: if a run would
     cross the end of the current bitplane, only the bytes up to the boundary
     are written and the remainder of the run is discarded. This is the one
     non-obvious rule; without it, some files (e.g. `TITLEBE.SPY`) decode with
     a few hundred extra bytes and the lower planes shift, producing ghosted
     images.

The decompressed data is always **153,600 bytes = 4 bitplanes × 38,400 bytes**:
a **VGA mode 12h** screen, 640×480 in 16 colours.

- Each plane is 480 rows of 80 bytes (640 bits).
- Bits are MSB-first: bit 7 of a byte is the leftmost of its 8 pixels.
- Plane *p* contributes bit *p* of the 4-bit colour index
  (`index = p0 | p1<<1 | p2<<2 | p3<<3`).

Pseudo-code:

```
palette = file[0:768]                       # use entries 0..15, DAC = value >> 2
data    = rle_decode(file[768:])            # exactly 153600 bytes
for p in 0..3:
    for y in 0..479:
        row = data[p*38400 + y*80 : +80]
        for xb in 0..79:
            for k in 0..7:
                if row[xb] & (0x80 >> k):
                    pixel[y][xb*8 + k] |= (1 << p)
```

## Companion formats (for completeness)

- **`.PPM`** — not portable pixmaps: they are ordinary **PCX** files
  (the win/lose/draw player portraits, 132×219). Any image library opens them.
- **`.VOC`** — not real Creative VOC: headerless **raw unsigned 8-bit PCM**,
  ~11,025 Hz mono. `ffmpeg -f u8 -ar 11025 -ac 1 -i file.voc out.wav` works
  (skip the first ~16 bytes of some files to drop a stray length prefix).
- **`.MNE` / `.MNL`** — level maps, plain text: 45 rows × 64 characters + CRLF.
- **`.S3M`** — standard Scream Tracker 3 modules; render with libopenmpt.
- **`FONTTI.FON`** — 2,048 bytes = 256 glyphs × 8 bytes, an 8×8 1-bpp font.

## Notable file contents

- `SHAPET.SPY` — the in-game "Shapes" help screen. Every terrain tile, object,
  treasure and monster is shown on it at native 10×10 size with a caption, which
  made it the perfect source for sprite extraction (the actual in-game sprite
  data, e.g. player walking frames and weapon icons, is compiled into `MB.EXE`).
- `PLAYERS.SPY` — the top 30 rows are the in-game HUD strip (four 160px player
  panels: name box, dig-power row, cash row, portrait, vertical HEALTH bar).
- `TITLEBE.SPY`, `MAIN3.SPY`, `OPTIONS5.SPY`, `SHOPPIC.SPY`, … — full screens
  (title, main menu, options, the shop frame; the shop's item list is drawn
  dynamically by the EXE).

The game runs entirely in mode 12h: the 64×45 tile map at 10×10 px per tile
(640×450) plus the 30 px HUD equals exactly 640×480.

## How it was cracked (and the dead ends)

The path matters more than the destination here, because the format actively
misleads you:

1. **The RLE was found quickly.** `01 <colour> <count>` decodes *every* file to
   ~153,600 bytes — too consistent to be coincidence. But 153,600 is ambiguous:
   320×480, 640×240, 320×240×2, 640×480 at 4 bpp… all fit.
2. **Autocorrelation of the decoded stream showed a sharp 80-byte period.**
   That was read as "80-byte rows" or "4×80 plane chunks per 320px row", and led
   to a long tour of wrong layouts: linear rows, Mode X plane interleaves in
   every permutation, field/interlace weaves, packed 4-bit nibbles, tile grids.
   Each produced *tantalisingly close* images — readable text, correct
   proportions — because with 16-colour planar data, any bit-plane treated as
   pixels still looks like a ghost of the picture. The real reason for the
   80-byte period: it is one **plane row** (640 bits).
3. **Ground truth broke the loop.** The original game was booted in the browser
   with js-dos (the DOSBox-X native app worked too, but macOS screen-capture
   permissions blocked screenshots; js-dos exposes `ci.screenshot()` giving the
   raw framebuffer). The title screen capture provided a byte-exact reference —
   after quantising the SPY palette through the 6-bit DAC round-trip
   (`v -> (v>>2)<<2 | v>>6`), every captured pixel matched a palette entry
   exactly.
4. **js-dos also answered the resolution question**: the framebuffer is
   640×480 — mode 12h, not mode 13h/Mode X. 153,600 bytes = 640×480 ÷ 8 bits
   × 4 planes. The "16 unique colours in a 256-entry palette" observation
   suddenly made sense.
5. **The last bug was the boundary clamp.** With plain RLE, `TITLEBE.SPY`
   decoded 422 bytes long and `MAIN3.SPY` 5 bytes long, shearing the last
   planes. Aligning the decode against the ground-truth capture located two
   runs that each emitted 211 bytes too many — and the second one ended exactly
   at `3 × 38400`. Conclusion: the game decodes per plane and truncates runs at
   the plane boundary. With that rule, `TITLEBE.SPY` matches the live screen
   153,600 / 153,600 bytes, and every other file decodes cleanly.

Lessons for the next DOS format: get a live capture early (an emulator
screenshot is worth a week of layout guessing), check bit-planar 16-colour
modes before assuming byte-per-pixel, and treat "output is a few bytes off"
as a semantics bug in the compressor handling, not as trailing junk.

## Verification

`OPTIONS5.SPY` and other drift-free files decode to visually flawless screens.
For hard proof, `TITLEBE.SPY` was compared byte-for-byte against the running
game: the js-dos framebuffer was converted to palette indices, re-encoded into
the four-plane layout, and diffed against the decoder output — **153,600 of
153,600 bytes identical**.

## What the remake uses

- `assets/gfx/sprites.png` + `sprites.json` — 33 sprites (10×10) cropped from
  `SHAPET.SPY`: terrain, objects, tools, the nine treasures, four monsters, the
  level exit and the tiny miner figure (recoloured per player at runtime).
- `assets/gfx/hud.png` — the HUD strip from `PLAYERS.SPY`.
- `assets/gfx/title.png` — the title screen (menu backdrop).
- `assets/gfx/portraits/` — the twelve PCX portraits
  (`pun`/`sin`/`vih`/`kel` = red/blue/green/yellow × `voit`/`lose`/`draw`).
- `assets/music/` — the two S3M songs rendered to AAC.

All assets are converted locally from the freeware release's own data files;
the decoding tools are in `tools/`.
