// ============================================================
// engine.js — canvas, input, shared state, main loop, utilities
// ============================================================

const S = {
  mode: 'menu',           // 'menu' | 'playing' | 'gameover'
  paused: false,
  player: null,
  enemies: [],
  projectiles: [],
  pickups: [],
  parts: [],
  pops: [],
  cam: {x:0, y:0},
  t: 0,
  kills: 0,
  runGold: 0,
  xp: 0,
  xpNext: 5,
  lvl: 1,
  biome: BIOMES[0],
  biomeIdx: 0,
  hero: HEROES[0],
  spawnTimer: 0.5,
  bossTimer: 90,
  shake: 0,
  flash: 0,
  rerollsLeft: 0,
  revivesLeft: 0,
  pendingChoices: null,
  newBiomeUnlocked: null,
};

// ---------- Canvas ----------
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d', {alpha:false});
let W = 0, H = 0;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize(){
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width  = Math.floor(W * DPR);
  cv.height = Math.floor(H * DPR);
  cv.style.width  = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// ---------- Utilities ----------
function clamp(v, a, b){ return v<a?a:v>b?b:v; }
function rand(a, b){ return a + Math.random()*(b-a); }
function pickWeighted(pool, weights){
  let total = 0;
  for(const w of weights) total += w;
  let r = Math.random() * total;
  for(let i=0;i<pool.length;i++){
    r -= weights[i];
    if(r <= 0) return pool[i];
  }
  return pool[0];
}
function fmtTime(t){
  const m = (t/60)|0, s = (t%60|0);
  return (''+m).padStart(2,'0') + ':' + (''+s).padStart(2,'0');
}

// ---------- Input: keyboard ----------
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if(e.key === 'Escape') togglePause();
  if(e.key === ' ') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// ---------- Input: single-touch target X ----------
// Space-Invaders style: touch anywhere on the canvas and the ship
// slides to that X position (capped at `baseSpd`). One thumb only.
const touch = {active:false, id:null, x:0, y:0};

function startTouch(id, x, y){
  if(S.mode !== 'playing' || S.paused) return;
  touch.active = true;
  touch.id = id;
  touch.x = x;
  touch.y = y;
}
function moveTouch(id, x, y){
  if(!touch.active || touch.id !== id) return;
  touch.x = x;
  touch.y = y;
}
function endTouch(id){
  if(touch.active && touch.id === id){
    touch.active = false;
    touch.id = null;
  }
}

cv.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  if(!t) return;
  startTouch(t.identifier, t.clientX, t.clientY);
}, {passive:false});
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier === touch.id){ moveTouch(t.identifier, t.clientX, t.clientY); break; }
  }
}, {passive:false});
cv.addEventListener('touchend', e => {
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier === touch.id){ endTouch(t.identifier); break; }
  }
}, {passive:false});
cv.addEventListener('touchcancel', e => {
  for(const t of e.changedTouches) endTouch(t.identifier);
}, {passive:false});

// Mouse fallback for desktop testing — behaves like a single touch.
cv.addEventListener('mousedown', e => { startTouch('mouse', e.clientX, e.clientY); });
cv.addEventListener('mousemove', e => { if(touch.active) moveTouch('mouse', e.clientX, e.clientY); });
cv.addEventListener('mouseup',   () => endTouch('mouse'));
cv.addEventListener('mouseleave',() => endTouch('mouse'));

// Returns the unit-length keyboard move vector, or null if no keys pressed.
function getKeyVec(){
  let dx = 0, dy = 0;
  if(keys['a'] || keys['arrowleft'])  dx -= 1;
  if(keys['d'] || keys['arrowright']) dx += 1;
  if(keys['w'] || keys['arrowup'])    dy -= 1;
  if(keys['s'] || keys['arrowdown'])  dy += 1;
  if(dx || dy){
    const m = Math.hypot(dx, dy);
    return {x: dx/m, y: dy/m};
  }
  return null;
}

// Returns the current touch target in screen pixels, or null if no touch.
function getTargetScreen(){
  return touch.active ? {x: touch.x, y: touch.y} : null;
}

// ---------- Meta persistence ----------
const META_KEY = 'killerhorde.v1';
const meta = Object.assign({
  gold: 0,
  totalKills: 0,
  totalGold: 0,
  maxTime: 0,
  maxLevel: 0,
  upgrades: {},
  heroesUnlocked: {rogue:true},
  biomesUnlocked: {city:true},
  selectedHero: 'rogue',
  selectedBiome: 'city',
}, (()=>{ try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } })());

function saveMeta(){
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

function metaBonus(stat){
  let v = 0;
  for(const u of META){
    if(u.stat === stat){
      v += (meta.upgrades[u.id] || 0) * u.step;
    }
  }
  return v;
}

// ---------- Screens helpers ----------
function show(id){ document.getElementById(id).classList.add('show'); }
function hide(id){ document.getElementById(id).classList.remove('show'); }
function hideAll(){
  for(const el of document.querySelectorAll('.screen')) el.classList.remove('show');
}

function togglePause(){
  if(S.mode !== 'playing') return;
  S.paused = !S.paused;
  if(S.paused) show('pause'); else hide('pause');
}
