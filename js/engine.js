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

// ---------- Input: twin virtual joysticks ----------
// Left half of screen = movement thumb. Right half = aim thumb.
// Each stick has an adaptive origin that re-centers as the finger
// drifts past `MAX_R`, so changing direction updates the vector
// immediately — no stale "dead zone" between old and new heading.
const MAX_R = 55;                 // stick radius used for both UX and origin drag
const DEAD_Z = 8;                 // ignore micro-jitter

const touches = {
  move: {active:false, id:null, ox:0, oy:0, x:0, y:0},
  aim:  {active:false, id:null, ox:0, oy:0, x:0, y:0},
};
const joyMoveEl  = document.getElementById('joyMove');
const joyAimEl   = document.getElementById('joyAim');
const stickMoveEl= joyMoveEl.querySelector('.stick');
const stickAimEl = joyAimEl.querySelector('.stick');

function sideFor(x){ return x < W/2 ? 'move' : 'aim'; }

function startTouch(id, x, y){
  if(S.mode !== 'playing' || S.paused) return;
  const side = sideFor(x);
  const t = touches[side];
  if(t.active) return;            // that side is already in use; ignore
  t.active = true;
  t.id = id;
  t.ox = x; t.oy = y;
  t.x = x;  t.y = y;
}

function moveTouch(id, x, y){
  for(const key of ['move','aim']){
    const t = touches[key];
    if(!t.active || t.id !== id) continue;
    // Drag origin behind the finger so the vector always reflects the
    // most recent direction the finger is heading.
    const dx = x - t.ox, dy = y - t.oy;
    const d = Math.hypot(dx, dy);
    if(d > MAX_R){
      const pull = d - MAX_R;
      t.ox += (dx / d) * pull;
      t.oy += (dy / d) * pull;
    }
    t.x = x; t.y = y;
    return;
  }
}

function endTouch(id){
  for(const key of ['move','aim']){
    const t = touches[key];
    if(t.active && t.id === id){
      t.active = false;
      t.id = null;
      return;
    }
  }
}

cv.addEventListener('touchstart', e => {
  e.preventDefault();
  for(const t of e.changedTouches) startTouch(t.identifier, t.clientX, t.clientY);
}, {passive:false});
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for(const t of e.changedTouches) moveTouch(t.identifier, t.clientX, t.clientY);
}, {passive:false});
cv.addEventListener('touchend', e => {
  e.preventDefault();
  for(const t of e.changedTouches) endTouch(t.identifier);
}, {passive:false});
cv.addEventListener('touchcancel', e => {
  for(const t of e.changedTouches) endTouch(t.identifier);
}, {passive:false});

// Mouse fallback: the mouse acts as a single touch; its side (left or
// right) is decided by the click position, same as finger input.
let mouseId = 'mouse';
let mdown = false;
cv.addEventListener('mousedown', e => { mdown = true; startTouch(mouseId, e.clientX, e.clientY); });
cv.addEventListener('mousemove', e => { if(mdown) moveTouch(mouseId, e.clientX, e.clientY); });
cv.addEventListener('mouseup',   () => { mdown = false; endTouch(mouseId); });
cv.addEventListener('mouseleave',() => { mdown = false; endTouch(mouseId); });

function stickVec(t){
  if(!t.active) return null;
  const dx = t.x - t.ox, dy = t.y - t.oy;
  const d = Math.hypot(dx, dy);
  if(d < DEAD_Z) return null;
  return {x: dx/d, y: dy/d};
}

function getMoveVec(){
  // Keyboard takes priority on desktop
  let kx = 0, ky = 0;
  if(keys['w'] || keys['arrowup'])    ky -= 1;
  if(keys['s'] || keys['arrowdown'])  ky += 1;
  if(keys['a'] || keys['arrowleft'])  kx -= 1;
  if(keys['d'] || keys['arrowright']) kx += 1;
  if(kx || ky){
    const m = Math.hypot(kx, ky);
    return {x: kx/m, y: ky/m};
  }
  return stickVec(touches.move) || {x:0, y:0};
}

// Returns null if the aim stick is idle — weapons then fall back to
// movement direction (or auto-aim for homing weapons).
function getAimVec(){
  return stickVec(touches.aim);
}

// Sync the on-screen joystick visuals to the current touch state.
// Called each frame from the main loop.
function updateJoyUI(){
  const pairs = [
    {t:touches.move, joy:joyMoveEl, stick:stickMoveEl},
    {t:touches.aim,  joy:joyAimEl,  stick:stickAimEl},
  ];
  for(const {t, joy, stick} of pairs){
    if(t.active){
      joy.style.left = (t.ox - 70) + 'px';
      joy.style.top  = (t.oy - 70) + 'px';
      joy.style.display = 'block';
      const dx = t.x - t.ox, dy = t.y - t.oy;
      const d = Math.hypot(dx, dy);
      if(d > 0.01){
        const m = Math.min(d, MAX_R);
        const a = Math.atan2(dy, dx);
        stick.style.transform = `translate(${Math.cos(a)*m}px,${Math.sin(a)*m}px)`;
      } else {
        stick.style.transform = 'translate(0px,0px)';
      }
    } else {
      joy.style.display = 'none';
    }
  }
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
