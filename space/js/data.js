// ============================================================
// data.js — SpaceAttractor content definitions
// Weapons, passives, enemies, sectors, pilots, meta upgrades.
// ============================================================

const WEAPONS = {
  photon: {
    name: 'Photon Bolt',
    desc: 'Fast energy bolts. Affected by gravity.',
    color: '#7ad6ff',
    max: 5,
    gravity: true,
    l: [
      {cd:0.50, dmg:11, n:1, spd:540, pr:1, sz:6},
      {cd:0.45, dmg:13, n:2, spd:540, pr:1, sz:6},
      {cd:0.40, dmg:16, n:3, spd:560, pr:1, sz:7},
      {cd:0.36, dmg:20, n:4, spd:580, pr:2, sz:7},
      {cd:0.30, dmg:25, n:5, spd:600, pr:2, sz:8},
    ]
  },
  missile: {
    name: 'Homing Missile',
    desc: 'Locks onto foes. Pulled by gravity wells.',
    color: '#ff9e66',
    max: 5,
    gravity: true,
    l: [
      {cd:0.90, dmg:20, n:1, spd:290, life:2.6, sz:7},
      {cd:0.85, dmg:24, n:2, spd:310, life:2.6, sz:7},
      {cd:0.80, dmg:28, n:2, spd:330, life:2.8, sz:8},
      {cd:0.72, dmg:34, n:3, spd:350, life:2.8, sz:8},
      {cd:0.65, dmg:42, n:4, spd:370, life:3.0, sz:9},
    ]
  },
  orbit: {
    name: 'Drone Ring',
    desc: 'Drones orbit your ship. Ignores gravity.',
    color: '#9feaff',
    max: 5,
    gravity: false,
    l: [
      {dmg:9,  n:2, radius:72, spd:2.8, sz:10, hit:0.25},
      {dmg:11, n:3, radius:76, spd:3.0, sz:10, hit:0.25},
      {dmg:13, n:4, radius:80, spd:3.2, sz:11, hit:0.22},
      {dmg:16, n:5, radius:84, spd:3.4, sz:11, hit:0.22},
      {dmg:20, n:6, radius:88, spd:3.6, sz:12, hit:0.20},
    ]
  },
  plasma: {
    name: 'Plasma Field',
    desc: 'Burns nearby ships. Ignores gravity.',
    color: '#ff7a66',
    max: 5,
    gravity: false,
    l: [
      {dmg:6,  radius:82,  tick:0.38},
      {dmg:8,  radius:90,  tick:0.34},
      {dmg:10, radius:100, tick:0.30},
      {dmg:13, radius:110, tick:0.26},
      {dmg:17, radius:122, tick:0.22},
    ]
  },
  nova: {
    name: 'Shockwave',
    desc: 'Expanding energy pulse. Ignores gravity.',
    color: '#b27aff',
    max: 5,
    gravity: false,
    l: [
      {cd:3.4, dmg:26, radius:165},
      {cd:3.1, dmg:32, radius:185},
      {cd:2.8, dmg:40, radius:210},
      {cd:2.4, dmg:50, radius:235},
      {cd:2.0, dmg:65, radius:265},
    ]
  },
  railgun: {
    name: 'Railgun',
    desc: 'Piercing beam. Warped by gravity fields.',
    color: '#ffde66',
    max: 5,
    gravity: true,
    l: [
      {cd:1.25, dmg:35, n:1, spd:900, pr:3, sz:4, life:0.6},
      {cd:1.15, dmg:42, n:1, spd:950, pr:4, sz:4, life:0.6},
      {cd:1.05, dmg:50, n:2, spd:1000, pr:4, sz:5, life:0.7},
      {cd:0.90, dmg:62, n:2, spd:1050, pr:5, sz:5, life:0.7},
      {cd:0.75, dmg:78, n:3, spd:1100, pr:6, sz:6, life:0.8},
    ]
  },
};

const PASSIVES = {
  might:   {name:'Power Core',   desc:'+8% damage per level',     max:5, stat:'dmgMul', step:0.08},
  vigor:   {name:'Hull Plating', desc:'+15 max HP per level',     max:5, stat:'maxHp',  step:15},
  swift:   {name:'Thrusters',    desc:'+6% move speed per level', max:5, stat:'spdMul', step:0.06},
  haste:   {name:'Overclock',    desc:'-7% cooldowns per level',  max:5, stat:'cdMul',  step:-0.07},
  magnet:  {name:'Tractor Beam', desc:'+30% pickup range',        max:4, stat:'magMul', step:0.30},
  fortune: {name:'Salvager',     desc:'+15% scrap & XP gain',     max:4, stat:'lootMul',step:0.15},
  armor:   {name:'Shields',      desc:'-1 damage taken per hit',  max:4, stat:'armor',  step:1},
  regen:   {name:'Nano Repair',  desc:'+0.6 HP regen / sec',      max:4, stat:'regen',  step:0.6},
};

const ENEMIES = {
  drone:   {hp:24,  spd:58,  dmg:8,  r:13, col:'#7f8dbf', xp:1, gold:1},
  scout:   {hp:14,  spd:125, dmg:7,  r:11, col:'#ff8a66', xp:1, gold:1},
  gunship: {hp:28,  spd:65,  dmg:6,  r:14, col:'#66ffcc', xp:2, gold:2, ranged:true},
  heavy:   {hp:120, spd:42,  dmg:15, r:22, col:'#b85cff', xp:4, gold:3},
  cruiser: {hp:260, spd:34,  dmg:20, r:26, col:'#66a3ff', xp:8, gold:6},
  bomber:  {hp:24,  spd:90,  dmg:24, r:13, col:'#ffde66', xp:2, gold:2, explode:true},
  boss:    {hp:2800,spd:55,  dmg:32, r:44, col:'#ff4466', xp:80,gold:60, boss:true},
};

const SECTORS = [
  {
    id:'nebula', name:'Orion Nebula',
    bg:'#04061a', grid:'#0b1028', starField:'#3a5fff',
    pool:['drone','scout','gunship','heavy','bomber'],
    weights:[6,4,2,1,1],
    bodies:{min:1, max:2, starChance:0.1},
  },
  {
    id:'belt', name:'Asteroid Belt',
    bg:'#0f0a04', grid:'#221608', starField:'#ff8844',
    pool:['scout','drone','bomber','cruiser','gunship'],
    weights:[6,3,2,1,2],
    bodies:{min:2, max:3, starChance:0.15},
  },
  {
    id:'frost', name:'Frost Expanse',
    bg:'#03101a', grid:'#0a1e30', starField:'#88ddff',
    pool:['cruiser','drone','gunship','heavy','scout'],
    weights:[3,4,2,2,3],
    bodies:{min:2, max:4, starChance:0.2},
  },
  {
    id:'core', name:'Galactic Core',
    bg:'#1a0406', grid:'#2c0a0d', starField:'#ff4444',
    pool:['bomber','scout','heavy','gunship','cruiser'],
    weights:[4,4,3,2,2],
    bodies:{min:3, max:5, starChance:0.3},
  },
  {
    id:'void', name:'The Void',
    bg:'#06041a', grid:'#12082e', starField:'#aa66ff',
    pool:['heavy','gunship','cruiser','bomber','scout'],
    weights:[3,3,3,3,3],
    bodies:{min:3, max:6, starChance:0.4},
  },
];

const HEROES = [
  {id:'pilot',   name:'Pilot',     desc:'Nimble striker.',           start:'photon',  mods:{spdMul:0.10},               unlock:{type:'free'}},
  {id:'gunner',  name:'Gunner',    desc:'Lock-on specialist.',       start:'missile', mods:{dmgMul:0.10},               unlock:{type:'level', v:20}},
  {id:'warden',  name:'Warden',    desc:'Shielded tank.',            start:'plasma',  mods:{maxHp:30, armor:1},         unlock:{type:'kills', v:1000}},
  {id:'sniper',  name:'Sniper',    desc:'Long-range devastation.',   start:'railgun', mods:{cdMul:-0.10},               unlock:{type:'time',  v:300}},
  {id:'blaster', name:'Blaster',   desc:'Explosive pulses.',         start:'nova',    mods:{lootMul:0.15},              unlock:{type:'biome', v:1}},
  {id:'ace',     name:'Ace',       desc:'Drone commander.',          start:'orbit',   mods:{dmgMul:0.08, spdMul:0.05},  unlock:{type:'gold',  v:5000}},
];

const META = [
  {id:'might',   name:'Power Core',desc:'+4% damage per level',         max:5, cost:[50,100,200,400,800],   stat:'dmgMul', step:0.04},
  {id:'vigor',   name:'Hull',      desc:'+10 max HP per level',         max:5, cost:[50,100,200,400,800],   stat:'maxHp',  step:10},
  {id:'swift',   name:'Thrusters', desc:'+3% move speed per level',     max:5, cost:[60,120,240,480,960],   stat:'spdMul', step:0.03},
  {id:'greed',   name:'Salvager',  desc:'+8% scrap drop per level',     max:5, cost:[80,160,320,640,1280],  stat:'goldMul',step:0.08},
  {id:'scholar', name:'Scanner',   desc:'+8% XP gain per level',        max:5, cost:[80,160,320,640,1280],  stat:'xpMul',  step:0.08},
  {id:'magnet',  name:'Tractor',   desc:'+20% pickup range',            max:3, cost:[100,250,500],          stat:'magMul', step:0.20},
  {id:'luck',    name:'Luck',      desc:'+1 reroll per run',            max:3, cost:[200,500,1200],         stat:'rerolls',step:1},
  {id:'revive',  name:'Failsafe',  desc:'Start runs with a revive',     max:2, cost:[600,1800],             stat:'revives',step:1},
];

// --- Gravity body templates ---
const BODY_TYPES = {
  planet_s: {r:28,  mass:800000,  col:'#3a7fbf', glow:'#2a5f8f', crashR:22,  crashDmg:15, label:'S Planet'},
  planet_m: {r:42,  mass:1600000, col:'#5f4fbf', glow:'#3f2f8f', crashR:36,  crashDmg:25, label:'M Planet'},
  planet_l: {r:60,  mass:2800000, col:'#bf5f3a', glow:'#8f3f2a', crashR:52,  crashDmg:40, label:'L Planet'},
  star:     {r:48,  mass:5000000, col:'#ffe066', glow:'#ffaa22', crashR:55,  crashDmg:60, label:'Star', isStar:true},
};
