# Open Bombers

A browser remake of **Mine Bombers 3.11** (Skitso Productions, 1997) with **online multiplayer over WebRTC**.

Dig through the mine, collect treasures, buy bombs in the shop between rounds, and blow up your friends. The remake ships with:

- **Original graphics**, reverse-engineered from the game's `.SPY` files (VGA mode 12h: 16-colour, 4 bitplanes, RLE-compressed) — terrain tiles, all nine treasures, monsters, the HUD bar, title art, and the PCX win/lose portraits. The game renders at the native 640×480 layout (10px tiles, 30px HUD), pixel-doubled.
- **Original music**: both S3M tracker songs (HUIPPE and OEKU), rendered with libopenmpt — menu and in-game themes.
- **47 original levels**, loaded straight from the game's `.MNE` map files (plus a random cave generator)
- **Original sound effects**, converted from the DOS version's raw PCM files
- The classic loop: weapon shop → round → last-man-standing / all-treasures / time-out → shop
- The nine original treasures (Crolin down to the Grass Bracelet) and the four original monsters (slime, furry, alien, grenade monster)
- Weapons: small/big bombs, dynamite, napalm (spreads through corridors!), mines, remote bombs, urethane foam, steel plates, medikits, rockpicks & power drills, and one very large bomb
- Kill bounties, survive bonuses, weapon selling
- Options from the original: rounds, time, treasure amount, starting cash, damage, **darkness mode**, monsters on/off

## The .SPY graphics format (reverse-engineered)

Documented here since it isn't publicly known: a `.SPY` file is a 768-byte palette
(256×RGB, 6-bit VGA DAC values stored ×4, only the first 16 entries used) followed by an
RLE stream: byte `0x01` escapes a run (`0x01 <colour> <count>`), all other bytes are
literals. The decoded 153 600 bytes are four 1-bit planes of 38 400 bytes (640×480,
80 bytes per row, MSB-first; plane *p* contributes bit *p* of the colour index).
Runs are clamped at each plane boundary — the excess is discarded. The decoder in
`tools/` reproduces the game's own output pixel-perfectly (verified against a live
screen capture of the DOS original). The `.PPM` files are ordinary PCX images, the
`.VOC` files are headerless raw unsigned 8-bit PCM at ~11 kHz.

## Play in the browser (GitHub Pages)

The game is a fully static site, so it runs directly on GitHub Pages:

1. Push this repository to GitHub.
2. In the repo settings, under **Pages**, set *Source* to **GitHub Actions**
   (the included `.github/workflows/pages.yml` deploys the site on every push
   to `main`).
3. Open `https://<your-user>.github.io/<repo>/` — host a game there, send the
   room code to friends, and play. Signalling goes through the public PeerJS
   broker; the game traffic itself is peer-to-peer WebRTC, so no server of
   your own is needed.

## Running locally

Any static file server works. For example:

```sh
cd open-bombers
python3 -m http.server 8473
```

Then open `http://localhost:8473/`.

## Playing online

1. One player clicks **HOST ONLINE GAME** and shares the 4-letter room code.
2. Up to three friends click **JOIN ONLINE GAME** and enter the code (they need to open the same app — host it anywhere static, or use a tunnel; game traffic itself is peer-to-peer WebRTC).
3. The host starts the game; everyone shops, readies up, and the round begins.

Signalling uses the free public [PeerJS](https://peerjs.com) broker; after the handshake all game data flows directly between browsers. The host's browser is the authoritative game server — if the host closes the tab, the game ends.

## Controls

| Action | Keys |
| --- | --- |
| Move / dig | Arrow keys or WASD |
| Drop / use selected weapon | Space |
| Cycle weapon | Shift or Tab |
| Detonate remote bombs | X or Ctrl |

Move into dirt or rock to dig it — harder rock digs slower; rockpicks and drills raise your dig power. In the shop, left-click buys, right-click sells at 70%.

## Project layout

- `index.html`, `css/style.css` — shell and menus
- `js/const.js` — tiles, weapons, treasures, monsters
- `js/map.js` — original `.MNE` parser, random generator, network encoding
- `js/game.js` — the host-authoritative simulation
- `js/render.js` — canvas renderer with procedural pixel sprites
- `js/net.js` — PeerJS host/client wrapper
- `js/audio.js` — original sound effect playback
- `js/main.js` — menus, lobby, shop, input, game loops
- `assets/levels/` — original level files, `assets/sfx/` — converted sounds

## Credits & licensing

- Original game: **Mine Bombers 3.11** by **Skitso Productions** (1997),
  released by its authors as freeware. All game assets (levels, graphics,
  sounds, music) were converted from that freeware release and remain the
  property of their creators — see `LICENSE` for details.
- Remake code: original work, MIT-licensed.
- Format documentation: see `SPY Reverse.md` for the reverse-engineered
  `.SPY` image format and `tools/decode_spy.py` for the reference decoder.
