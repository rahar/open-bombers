// Shared constants: tiles, weapons, treasures, monsters, levels.

export const MAP_W = 64;
export const MAP_H = 45;
export const TILE = 10;                 // pixels — original game tile size (640x450 map)
export const HUD_H = 30;                // top bar height in px, as in the original
export const TICK_RATE = 30;            // host simulation Hz
export const SNAP_RATE = 15;            // state broadcast Hz

// ---- tiles ----
export const T = {
  EMPTY: 0,
  DIRT: 1,        // '0'  hardness 1
  ROCK_SOFT: 2,   // '2'-'4'
  ROCK_MED: 3,    // '5','6'
  ROCK_HARD: 4,   // '7'-'9','A'
  ROCK_VHARD: 5,  // 'B'-'F'
  SOLID: 6,       // '1'
  STEEL: 7,       // placed steel plate
  URETHANE: 8,    // foam
  BORDER: 9,      // outer rim, indestructible
};

// hardness: dig time multiplier and blast resistance
export const TILE_INFO = {
  [T.EMPTY]:      { hard: 0,  digHp: 0 },
  [T.DIRT]:       { hard: 1,  digHp: 14 },
  [T.ROCK_SOFT]:  { hard: 2,  digHp: 45 },
  [T.ROCK_MED]:   { hard: 3,  digHp: 90 },
  [T.ROCK_HARD]:  { hard: 4,  digHp: 160 },
  [T.ROCK_VHARD]: { hard: 5,  digHp: 260 },
  [T.SOLID]:      { hard: 6,  digHp: 420 },
  [T.STEEL]:      { hard: 8,  digHp: Infinity },
  [T.URETHANE]:   { hard: 2,  digHp: 70 },
  [T.BORDER]:     { hard: 99, digHp: Infinity },
};

export function walkable(t) { return t === T.EMPTY; }
export function diggable(t) { return t >= T.DIRT && t <= T.SOLID || t === T.URETHANE; }

// ---- treasures: the nine originals (values x10 to match the shop economy) ----
export const TREASURES = [
  { id: 0, name: 'Crolin',         value: 1000, sprite: 't_crolin' },
  { id: 1, name: 'Rubin',          value: 650,  sprite: 't_rubin' },
  { id: 2, name: 'Sceptre',        value: 500,  sprite: 't_sceptre' },
  { id: 3, name: 'Golden Cross',   value: 350,  sprite: 't_cross' },
  { id: 4, name: 'Golden Bar',     value: 300,  sprite: 't_bar' },
  { id: 5, name: 'Golden Egg',     value: 250,  sprite: 't_egg' },
  { id: 6, name: 'Pile of Coins',  value: 150,  sprite: 't_coins' },
  { id: 7, name: 'Ancient Shield', value: 150,  sprite: 't_shield' },
  { id: 8, name: 'Grass Bracelet', value: 100,  sprite: 't_bracelet' },
];
// weighted spawn table (rarer = more valuable)
export const TREASURE_WEIGHTS = [2, 4, 5, 8, 10, 12, 16, 16, 20];

// special buried pickups
export const PICKUPS = {
  RockpickP:  { name: 'Rockpick',  desc: '+2 dig power (this round)' },
  MedikitP:   { name: 'Medikit',   desc: '+40 health' },
  WeaponP:    { name: 'Weapon crate', desc: 'random weapons' },
};

// ---- weapons ----
// kind: bomb (fused), remote, mine, napalm, spray (urethane), plate (steel), use (instant)
export const WEAPONS = [
  { id: 'small',   name: 'Small Bomb',  price: 30,   kind: 'bomb',   fuse: 2.2, radius: 2.6, power: 3, dmg: 45,  start: 4 },
  { id: 'big',     name: 'Big Bomb',    price: 130,  kind: 'bomb',   fuse: 2.6, radius: 4.2, power: 5, dmg: 85 },
  { id: 'dyna',    name: 'Dynamite',    price: 300,  kind: 'bomb',   fuse: 3.0, radius: 5.6, power: 6, dmg: 120 },
  { id: 'nuke',    name: 'Tsar Bomb',   price: 2200, kind: 'bomb',   fuse: 4.0, radius: 9.0, power: 8, dmg: 300 },
  { id: 'napalm',  name: 'Napalm',      price: 420,  kind: 'napalm', fuse: 2.2, radius: 1.5, power: 1, dmg: 20 },
  { id: 'mine',    name: 'Mine',        price: 90,   kind: 'mine',   fuse: 0,   radius: 2.2, power: 3, dmg: 75 },
  { id: 'remote',  name: 'Remote Bomb', price: 170,  kind: 'remote', fuse: 0,   radius: 3.2, power: 4, dmg: 65 },
  { id: 'ureth',   name: 'Urethane',    price: 60,   kind: 'spray' },
  { id: 'plate',   name: 'Steel Plate', price: 45,   kind: 'plate' },
  { id: 'medkit',  name: 'Medikit',     price: 220,  kind: 'use' },
  { id: 'pick',    name: 'Rockpick',    price: 110,  kind: 'perm', digBonus: 1, desc: '+1 dig power, permanent' },
  { id: 'drill',   name: 'Power Drill', price: 520,  kind: 'perm', digBonus: 3, desc: '+3 dig power, permanent' },
];
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
// weapons that occupy the selector (droppable/usable in game)
export const SELECTABLE = ['small', 'big', 'dyna', 'nuke', 'napalm', 'mine', 'remote', 'ureth', 'plate', 'medkit'];

export const KILL_BOUNTY = 1000;
export const SURVIVE_BONUS = 350;

// ---- monsters: the four originals ----
export const MONSTERS = {
  slime:   { hp: 25, speed: 1.2, dmg: 6,  bounty: 100, sprite: 'm_slime' },
  furry:   { hp: 35, speed: 3.4, dmg: 12, bounty: 250, sprite: 'm_furry' },
  alien:   { hp: 80, speed: 3.8, dmg: 20, bounty: 500, sprite: 'm_alien' },
  grenade: { hp: 50, speed: 3.0, dmg: 15, bounty: 400, sprite: 'm_grenade' },
};
// map file lowercase chars -> monster type
export const MONSTER_CHARS = {
  e: 'slime', f: 'slime', o: 'slime', q: 'slime',
  k: 'furry', l: 'furry', p: 'furry',
  m: 'alien', s: 'alien', y: 'grenade',
};

export const PLAYER_COLORS = [
  { name: 'Red',    body: '#e04040', dark: '#801818', light: '#ff9070' },
  { name: 'Blue',   body: '#4060e0', dark: '#182880', light: '#70a0ff' },
  { name: 'Green',  body: '#30b040', dark: '#0e5518', light: '#70e880' },
  { name: 'Yellow', body: '#d8b020', dark: '#705808', light: '#ffe870' },
];

export const LEVELS = [
  'anzulaby','battle','bestiary','biofarm','boulder','caramba','castle','circle','crumble',
  'dent','egypti','explo','faust','flippi','grambbi','gurami','gurami2','hitler','huble',
  'hurry','inside','jail','jakaus','komplex','laby','labyrint','large','medieval','monimut',
  'oldmine','oldtime','palace','push','quarter','rocks','rooms','ruspe','ruubens','shatter',
  'ski','solukko','spyko','teens','teleroom','tiilii','tothecen',
];
export const LEVEL_EXT = 'mne';
