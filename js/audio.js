// Original Mine Bombers sound effects (converted from the DOS .VOC files).
const NAMES = ['aargh', 'applause', 'explos1', 'explos2', 'explos3', 'explos4', 'explos5',
  'karjaisu', 'kili', 'picaxe', 'pikkupom', 'urethan'];

let ctx = null;
const buffers = {};
let lastPlay = {};

export async function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await Promise.all(NAMES.map(async n => {
    try {
      const res = await fetch(`assets/sfx/${n}.wav`);
      buffers[n] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) { /* missing sound is not fatal */ }
  }));
}

export function playSound(name, vol = 1) {
  if (!ctx || !buffers[name]) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = performance.now();
  if (lastPlay[name] && now - lastPlay[name] < 60) return;  // throttle spam
  lastPlay[name] = now;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  const g = ctx.createGain();
  g.gain.value = Math.min(1, vol);
  src.connect(g).connect(ctx.destination);
  src.start();
}

// variety for explosions
export function playBoom(big) {
  const set = big ? ['explos1', 'explos2', 'explos3', 'explos4', 'explos5'] : ['pikkupom', 'explos1'];
  playSound(set[(Math.random() * set.length) | 0]);
}

// ---- music: the original S3M tracker songs (rendered to m4a) ----
let musicEl = null, musicName = null;

export function playMusic(name) {
  if (musicName === name) return;
  stopMusic();
  musicName = name;
  musicEl = new Audio(`assets/music/${name}.m4a`);
  musicEl.loop = true;
  musicEl.volume = 0.45;
  musicEl.play().catch(() => { /* needs a user gesture first */ });
}

export function stopMusic() {
  if (musicEl) { musicEl.pause(); musicEl = null; }
  musicName = null;
}
