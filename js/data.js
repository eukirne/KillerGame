// ============================================================
// data.js — game content definitions
// All weapons, passives, enemies, biomes, heroes, meta upgrades.
// ============================================================

const WEAPONS = {
  shard: {
    name: 'Shard',
    desc: 'Hurls shards in the direction you are moving.',
    color: '#7ad6ff',
    max: 5,
    l: [
      {cd:0.55, dmg:10, n:1, spd:520, pr:1, sz:6},
      {cd:0.50, dmg:12, n:2, spd:520, pr:1, sz:6},
      {cd:0.45, dmg:14, n:3, spd:540, pr:1, sz:7},
      {cd:0.40, dmg:18, n:4, spd:560, pr:2, sz:7},
      {cd:0.34, dmg:22, n:5, spd:580, pr:2, sz:8},
    ]
  },
  seeker: {
    name: 'Seeker',
    desc: 'Homing bolts that chase the nearest foe.',
    color: '#ff9e66',
    max: 5,
    l: [
      {cd:0.95, dmg:18, n:1, spd:280, life:2.4, sz:7},
      {cd:0.90, dmg:22, n:2, spd:300, life:2.4, sz:7},
      {cd:0.85, dmg:26, n:2, spd:320, life:2.6, sz:8},
      {cd:0.78, dmg:30, n:3, spd:340, life:2.6, sz:8},
      {cd:0.70, dmg:36, n:4, spd:360, life:2.8, sz:9},
    ]
  },
  orbit: {
    name: 'Orbit',
    desc: 'Blades that orbit you and shred anything close.',
    color: '#9feaff',
    max: 5,
    l: [
      {dmg:8,  n:2, radius:70, spd:2.8, sz:10, hit:0.25},
      {dmg:10, n:3, radius:74, spd:3.0, sz:10, hit:0.25},
      {dmg:12, n:4, radius:78, spd:3.2, sz:11, hit:0.22},
      {dmg:15, n:5, radius:82, spd:3.4, sz:11, hit:0.22},
      {dmg:18, n:6, radius:86, spd:3.6, sz:12, hit:0.20},
    ]
  },
  aura: {
    name: 'Aura',
    desc: 'Burns everything that stands too close.',
    color: '#ff7a66',
    max: 5,
    l: [
      {dmg:5,  radius:80,  tick:0.40},
      {dmg:7,  radius:88,  tick:0.36},
      {dmg:9,  radius:96,  tick:0.32},
      {dmg:12, radius:106, tick:0.28},
      {dmg:16, radius:118, tick:0.24},
    ]
  },
  nova: {
    name: 'Nova',
    desc: 'Releases an expanding shockwave ring.',
    color: '#b27aff',
    max: 5,
    l: [
      {cd:3.6, dmg:24, radius:160},
      {cd:3.3, dmg:30, radius:180},
      {cd:3.0, dmg:38, radius:200},
      {cd:2.6, dmg:48, radius:225},
      {cd:2.2, dmg:62, radius:255},
    ]
  },
  thunder: {
    name: 'Thunder',
    desc: 'Strikes random foes with sky lightning.',
    color: '#ffde66',
    max: 5,
    l: [
      {cd:1.30, dmg:32, n:1, radius:24},
      {cd:1.20, dmg:38, n:2, radius:26},
      {cd:1.10, dmg:46, n:3, radius:28},
      {cd:0.95, dmg:58, n:4, radius:30},
      {cd:0.80, dmg:74, n:5, radius:32},
    ]
  },
};

const PASSIVES = {
  might:   {name:'Might',   desc:'+8% damage per level',     max:5, stat:'dmgMul', step:0.08},
  vigor:   {name:'Vigor',   desc:'+15 max HP per level',     max:5, stat:'maxHp',  step:15},
  swift:   {name:'Swift',   desc:'+6% move speed per level', max:5, stat:'spdMul', step:0.06},
  haste:   {name:'Haste',   desc:'-7% cooldowns per level',  max:5, stat:'cdMul',  step:-0.07},
  magnet:  {name:'Magnet',  desc:'+30% pickup range',        max:4, stat:'magMul', step:0.30},
  fortune: {name:'Fortune', desc:'+15% gold & XP gain',      max:4, stat:'lootMul',step:0.15},
  armor:   {name:'Armor',   desc:'-1 damage taken per hit',  max:4, stat:'armor',  step:1},
  regen:   {name:'Regen',   desc:'+0.6 HP regen / sec',      max:4, stat:'regen',  step:0.6},
};

const ENEMIES = {
  walker:  {hp:24,  spd:60,  dmg:8,  r:14, col:'#7f8dbf', xp:1, gold:1},
  runner:  {hp:14,  spd:122, dmg:7,  r:11, col:'#ff8a66', xp:1, gold:1},
  shooter: {hp:28,  spd:68,  dmg:6,  r:13, col:'#66ffcc', xp:2, gold:2, ranged:true},
  brute:   {hp:120, spd:44,  dmg:15, r:22, col:'#b85cff', xp:4, gold:3},
  tank:    {hp:260, spd:36,  dmg:20, r:26, col:'#66a3ff', xp:8, gold:6},
  bomb:    {hp:24,  spd:92,  dmg:24, r:14, col:'#ffde66', xp:2, gold:2, explode:true},
  boss:    {hp:2400,spd:62,  dmg:30, r:42, col:'#ff4466', xp:80,gold:60, boss:true},
};

const BIOMES = [
  {
    id:'city', name:'Night City',
    bg:'#06091a', grid:'#0d1530',
    pool:['walker','runner','shooter','brute','bomb'],
    weights:[6,4,2,1,1]
  },
  {
    id:'desert', name:'Rust Desert',
    bg:'#180a04', grid:'#2a1608',
    pool:['runner','walker','bomb','tank','shooter'],
    weights:[6,3,2,1,2]
  },
  {
    id:'glacier', name:'Glacier Rift',
    bg:'#03111a', grid:'#0a2230',
    pool:['tank','walker','shooter','brute','runner'],
    weights:[3,4,2,2,3]
  },
  {
    id:'inferno', name:'Inferno',
    bg:'#1a0406', grid:'#2c0a0d',
    pool:['bomb','runner','brute','shooter','tank'],
    weights:[4,4,3,2,2]
  },
  {
    id:'void', name:'The Void',
    bg:'#08041a', grid:'#16082e',
    pool:['brute','shooter','tank','bomb','runner'],
    weights:[3,3,3,3,3]
  },
];

const HEROES = [
  {id:'rogue',   name:'Rogue',     desc:'Nimble blade thrower.',     start:'shard',   mods:{spdMul:0.10},               unlock:{type:'free'}},
  {id:'mage',    name:'Arc Mage',  desc:'Homing devastation.',       start:'seeker',  mods:{dmgMul:0.10},               unlock:{type:'level', v:20}},
  {id:'warden',  name:'Warden',    desc:'Burning aura, thick hide.', start:'aura',    mods:{maxHp:30, armor:1},         unlock:{type:'kills', v:1000}},
  {id:'storm',   name:'Storm',     desc:'Thunder incarnate.',        start:'thunder', mods:{cdMul:-0.10},               unlock:{type:'time',  v:300}},
  {id:'nova',    name:'Nova',      desc:'Explosive heart.',          start:'nova',    mods:{lootMul:0.15},              unlock:{type:'biome', v:1}},
  {id:'duelist', name:'Duelist',   desc:'Whirling blades.',          start:'orbit',   mods:{dmgMul:0.08, spdMul:0.05},  unlock:{type:'gold',  v:5000}},
];

const META = [
  {id:'might',   name:'Might',   desc:'+4% damage per level',         max:5, cost:[50,100,200,400,800],   stat:'dmgMul', step:0.04},
  {id:'vigor',   name:'Vigor',   desc:'+10 max HP per level',         max:5, cost:[50,100,200,400,800],   stat:'maxHp',  step:10},
  {id:'swift',   name:'Swift',   desc:'+3% move speed per level',     max:5, cost:[60,120,240,480,960],   stat:'spdMul', step:0.03},
  {id:'greed',   name:'Greed',   desc:'+8% gold drop per level',      max:5, cost:[80,160,320,640,1280],  stat:'goldMul',step:0.08},
  {id:'scholar', name:'Scholar', desc:'+8% XP gain per level',        max:5, cost:[80,160,320,640,1280],  stat:'xpMul',  step:0.08},
  {id:'magnet',  name:'Magnet',  desc:'+20% pickup range',            max:3, cost:[100,250,500],          stat:'magMul', step:0.20},
  {id:'luck',    name:'Luck',    desc:'+1 reroll per run',            max:3, cost:[200,500,1200],         stat:'rerolls',step:1},
  {id:'revive',  name:'Revive',  desc:'Start runs with a revive',     max:2, cost:[600,1800],             stat:'revives',step:1},
];
