// ============================================================
// engine.js — canvas, input, shared state, main loop, utilities
// SpaceAttractor edition
// ============================================================

const S = {
  mode: 'menu',
  paused: false,
  player: null,
  enemies: [],
  projectiles: [],
  pickups: [],
  parts: [],
  pops: [],
  bodies: [],
  cam: {x:0, y:0},
  t: 0,
  kills: 0,
  runGold: 0,
  xp: 0,
  xpNext: 5,
  lvl: 1,
  sector: SECTORS[0],
  sectorIdx: 0,
  hero: HEROES[0],
  room: 1,
  roomState: 'fighting',
  roomSpawnLeft: 0,
  roomSpawnTimer: 0,
  roomKind: 'normal',
  roomClearT: 0,
  warpT: 0,
  arena: {x:-600, y:-420, w:1200, h:840},
  shake: 0,
  flash: 0,
  rerollsLeft: 0,
  revivesLeft: 0,
  pendingChoices: null,
  newSectorUnlocked: null,
  bgStars: [],
  nebulae: [],
  objective: null,
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

// ---------- Gravity ----------
function applyGravity(obj, dt){
  for(const b of S.bodies){
    const dx = b.x - obj.x, dy = b.y - obj.y;
    const d2 = dx*dx + dy*dy;
    const d = Math.sqrt(d2) + 1e-3;
    const minD = b.r * 1.2;
    const effD2 = Math.max(d2, minD * minD);
    const force = b.mass / effD2;
    obj.vx = (obj.vx || 0) + (dx / d) * force * dt;
    obj.vy = (obj.vy || 0) + (dy / d) * force * dt;
  }
}

function bodyCollision(x, y, r){
  for(const b of S.bodies){
    const dx = x - b.x, dy = y - b.y;
    const d = Math.hypot(dx, dy);
    if(d < b.crashR + r) return b;
  }
  return null;
}

function lineHitsBody(x1, y1, x2, y2){
  for(const b of S.bodies){
    const dx = x2 - x1, dy = y2 - y1;
    const fx = x1 - b.x, fy = y1 - b.y;
    const a = dx*dx + dy*dy;
    const bv = 2*(fx*dx + fy*dy);
    const c = fx*fx + fy*fy - b.r*b.r;
    let disc = bv*bv - 4*a*c;
    if(disc >= 0){
      disc = Math.sqrt(disc);
      const t1 = (-bv - disc) / (2*a);
      const t2 = (-bv + disc) / (2*a);
      if((t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1)){
        return true;
      }
    }
  }
  return false;
}

// ---------- Input: keyboard ----------
const keys = {};
window.addEventListener('keydown', e => {
  initAudio(); resumeAudio();
  keys[e.key.toLowerCase()] = true;
  if(e.key === 'Escape') togglePause();
  if(e.key === ' ' && e.target.tagName !== 'INPUT') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// ---------- Input: floating joystick ----------
const touch = {
  active:false, id:null, x:0, y:0,
  startX:0, startY:0, startT:0, moved:false,
};
const joy = {
  active:false,
  baseX:0, baseY:0,
  stickX:0, stickY:0,
  dx:0, dy:0,
  mag:0,
  radius:62,
};

const TAP_MAX_MS = 220;
const TAP_MAX_DIST = 24;

function startTouch(id, x, y){
  initAudio(); resumeAudio();
  if(S.mode !== 'playing' || S.paused) return;
  touch.active = true;
  touch.id = id;
  touch.x = x; touch.y = y;
  touch.startX = x; touch.startY = y;
  touch.startT = performance.now();
  touch.moved = false;
  joy.active = true;
  joy.baseX = x; joy.baseY = y;
  joy.stickX = x; joy.stickY = y;
  joy.dx = 0; joy.dy = 0; joy.mag = 0;
}
function moveTouch(id, x, y){
  if(!touch.active || touch.id !== id) return;
  touch.x = x; touch.y = y;
  if(!touch.moved){
    const ddx = x - touch.startX, ddy = y - touch.startY;
    if(ddx*ddx + ddy*ddy > TAP_MAX_DIST * TAP_MAX_DIST) touch.moved = true;
  }
  let offX = x - joy.baseX;
  let offY = y - joy.baseY;
  const m = Math.hypot(offX, offY);
  if(m < 0.001){
    joy.stickX = joy.baseX; joy.stickY = joy.baseY;
    joy.dx = 0; joy.dy = 0; joy.mag = 0;
    return;
  }
  if(m > joy.radius){
    joy.baseX = x - (offX / m) * joy.radius;
    joy.baseY = y - (offY / m) * joy.radius;
    offX = x - joy.baseX;
    offY = y - joy.baseY;
  }
  joy.stickX = x; joy.stickY = y;
  const m2 = Math.hypot(offX, offY) || 1;
  joy.dx = offX / m2;
  joy.dy = offY / m2;
  joy.mag = Math.min(1, m2 / joy.radius);
}
function endTouch(id){
  if(touch.active && touch.id === id){
    const wasTap = !touch.moved && (performance.now() - touch.startT < TAP_MAX_MS);
    touch.active = false;
    touch.id = null;
    joy.active = false;
    joy.mag = 0;
    if(wasTap && typeof forceFireAll === 'function') forceFireAll();
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

cv.addEventListener('mousedown', e => { startTouch('mouse', e.clientX, e.clientY); });
cv.addEventListener('mousemove', e => { if(touch.active) moveTouch('mouse', e.clientX, e.clientY); });
cv.addEventListener('mouseup',   () => endTouch('mouse'));
cv.addEventListener('mouseleave',() => endTouch('mouse'));

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

// ---------- Meta persistence ----------
const META_KEY = 'spaceattractor.v1';
const meta = Object.assign({
  gold: 0,
  totalKills: 0,
  totalGold: 0,
  maxTime: 0,
  maxLevel: 0,
  maxRoom: 0,
  upgrades: {},
  heroesUnlocked: {pilot:true},
  sectorsUnlocked: {nebula:true},
  selectedHero: 'pilot',
  selectedSector: 'nebula',
}, (()=>{ try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } })());

function saveMeta(){
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

function metaBonus(stat){
  let v = 0;
  for(const u of META){
    if(u.stat === stat) v += (meta.upgrades[u.id] || 0) * u.step;
  }
  return v;
}

// ---------- Screen helpers ----------
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
