// ============================================================
// game.js — spawner, level-up, render, UI wiring, main loop
// SpaceAttractor edition
// ============================================================

// ---------- Gravity body generation ----------
const PLANET_COLS = [
  {col:'#3a7fbf', glow:'#2a5faf'},
  {col:'#6b4f9f', glow:'#8b6fbf'},
  {col:'#bf6f3a', glow:'#df8f5a'},
  {col:'#3a9f6b', glow:'#5abf8b'},
  {col:'#9f3a6b', glow:'#bf5a8b'},
  {col:'#5f6faf', glow:'#7f8fcf'},
];

function generateBodies(){
  S.bodies = [];
  const ar = S.arena;
  const room = S.room;
  const sec = S.sector.bodies || {min:1, max:3, starChance:0.15};
  const count = Math.min(12, sec.min + 3 + Math.floor((room - 1) * (sec.max - sec.min + 1) / 5));
  const placed = [];

  for(let i = 0; i < count; i++){
    const isStar = Math.random() < sec.starChance + (room - 1) * 0.01;
    const tmpl = isStar ? BODY_TYPES.star :
      BODY_TYPES[['planet_s','planet_m','planet_l'][Math.min(2, (Math.random()*3)|0)]];
    const rVar = tmpl.r * rand(0.85, 1.15);
    let bx, by, ok = false;

    for(let attempt = 0; attempt < 60; attempt++){
      bx = rand(ar.x + rVar + 80, ar.x + ar.w - rVar - 80);
      by = rand(ar.y + rVar + 80, ar.y + ar.h - rVar - 80);
      if(bx*bx + by*by < 200*200) continue;
      ok = true;
      for(const pb of placed){
        const dd = Math.hypot(bx - pb.x, by - pb.y);
        if(dd < rVar + pb.r + 160){ ok = false; break; }
      }
      if(ok) break;
    }
    if(!ok) continue;

    const pc = PLANET_COLS[i % PLANET_COLS.length];
    placed.push({
      x:bx, y:by, r:Math.round(rVar),
      mass: tmpl.mass * rand(0.8, 1.2),
      col: isStar ? tmpl.col : pc.col,
      origCol: isStar ? tmpl.col : pc.col,
      glow: isStar ? tmpl.glow : pc.glow,
      origGlow: isStar ? tmpl.glow : pc.glow,
      crashR: Math.round(rVar * (tmpl.crashR / tmpl.r)),
      crashDmg: tmpl.crashDmg,
      isStar: !!tmpl.isStar,
      conquered: false,
      conquerProg: 0,
      turretTimer: 0,
    });
  }
  if(!placed.some(b => !b.isStar)){
    const last = placed[placed.length - 1];
    if(last){ last.isStar = false; last.col = PLANET_COLS[0].col; last.origCol = last.col; last.glow = PLANET_COLS[0].glow; last.origGlow = last.glow; last.crashDmg = 25; }
  }
  S.bodies = placed;
}

// ---------- Starfield ----------
function generateStarfield(){
  S.bgStars = [];
  S.nebulae = [];
  const SC = ['#fff','#fff','#fff','#aaccff','#ffddaa','#ffc8a0','#ccddff','#ffe8cc','#ff9988','#88aaff'];
  for(let i = 0; i < 700; i++){
    S.bgStars.push({
      x: rand(-2000, 2000), y: rand(-2000, 2000),
      sz: rand(0.6, 1.2), bright: rand(0.2, 0.5),
      twinkleSpd: rand(0.3, 1.5), depth: rand(0.02, 0.06),
      col: SC[(Math.random()*SC.length)|0],
    });
  }
  for(let i = 0; i < 500; i++){
    S.bgStars.push({
      x: rand(-2500, 2500), y: rand(-2500, 2500),
      sz: rand(0.8, 2.0), bright: rand(0.35, 0.8),
      twinkleSpd: rand(0.5, 3), depth: rand(0.1, 0.22),
      col: SC[(Math.random()*SC.length)|0],
    });
  }
  for(let i = 0; i < 200; i++){
    S.bgStars.push({
      x: rand(-2000, 2000), y: rand(-2000, 2000),
      sz: rand(1.2, 3.2), bright: rand(0.6, 1.0),
      twinkleSpd: rand(1.5, 5), depth: rand(0.3, 0.5),
      col: SC[(Math.random()*SC.length)|0],
    });
  }
  const clN = 8 + Math.floor(Math.random() * 6);
  for(let c = 0; c < clN; c++){
    const cx = rand(-1800, 1800), cy = rand(-1800, 1800);
    const cc = SC[(Math.random()*SC.length)|0];
    const sn = 12 + Math.floor(Math.random() * 14);
    const sp = 30 + Math.random() * 60;
    const dp = rand(0.08, 0.35);
    for(let i = 0; i < sn; i++){
      S.bgStars.push({
        x: cx + (Math.random()-0.5)*sp*2, y: cy + (Math.random()-0.5)*sp*2,
        sz: rand(0.6, 2.5), bright: rand(0.4, 0.95),
        twinkleSpd: rand(1, 4), depth: dp + rand(-0.03, 0.03),
        col: Math.random() < 0.6 ? cc : '#fff',
      });
    }
  }
  const NC = ['rgba(60,80,180,0.06)','rgba(180,60,120,0.05)','rgba(60,180,140,0.05)','rgba(140,60,180,0.06)','rgba(180,120,60,0.05)','rgba(80,60,180,0.055)'];
  const nebN = 5 + Math.floor(Math.random() * 4);
  for(let i = 0; i < nebN; i++){
    S.nebulae.push({
      x: rand(-1800, 1800), y: rand(-1800, 1800),
      r: rand(200, 500), col: NC[(Math.random()*NC.length)|0],
      depth: rand(0.04, 0.15),
    });
  }
}

// ---------- Rooms ----------
function placeAtArenaEdge(e){
  const p = S.player;
  const spawnDist = Math.max(W, H) * 0.6 + 80;
  for(let k = 0; k < 20; k++){
    const ang = Math.random() * Math.PI * 2;
    const dist = spawnDist + Math.random() * 200;
    const tx = p.x + Math.cos(ang) * dist;
    const ty = p.y + Math.sin(ang) * dist;
    let insideBody = false;
    for(const b of S.bodies){
      if(Math.hypot(tx-b.x, ty-b.y) < b.r + e.r + 30){ insideBody = true; break; }
    }
    if(insideBody) continue;
    e.x = tx; e.y = ty;
    return;
  }
  const ang = Math.random() * Math.PI * 2;
  e.x = p.x + Math.cos(ang) * spawnDist;
  e.y = p.y + Math.sin(ang) * spawnDist;
}

function forceFireAll(){
  if(!S.player || S.mode !== 'playing') return;
  const p = S.player;
  let fired = false;
  for(const id in p.weapons){
    if(id === 'orbit' || id === 'plasma') continue;
    const w = p.weapons[id];
    const def = WEAPONS[id];
    const lvl = def.l[w.level - 1];
    fireWeapon(id, lvl);
    w.t = Math.min(w.t, 0.08);
    fired = true;
  }
  if(fired) sfx.tap();
}

function startRoom(skipBodies){
  const n = S.room;
  S.roomState = 'fighting';
  S.roomSpawnTimer = 0.3;
  if(!skipBodies) generateBodies();
  S.roomKind = 'normal';
  S.roomSpawnLeft = Math.min(80, 15 + Math.floor(n * 3));
  const planets = S.bodies.filter(b => !b.isStar);
  if(planets.length > 0){
    popup('CONQUER ALL PLANETS', S.player.x, S.player.y - 50, '#44dd88');
  }
}

function updateConquer(dt){
  const p = S.player;
  const isStationary = !p.moving;
  for(const b of S.bodies){
    if(b.isStar || b.conquered) continue;
    const dx = p.x - b.x, dy = p.y - b.y;
    const dist = Math.hypot(dx, dy);
    const captureRange = b.r + 80;
    if(dist < captureRange && isStationary){
      b.conquerProg = Math.min(1, (b.conquerProg || 0) + dt / 3.0);
      if(((S.t * 8) | 0) % 3 === 0){
        const a = Math.random() * Math.PI * 2;
        const sr = 8;
        S.parts.push({
          x: p.x + Math.cos(a)*sr, y: p.y + Math.sin(a)*sr,
          vx: (b.x - p.x) * 1.8, vy: (b.y - p.y) * 1.8,
          life: 0.4, maxLife: 0.4, col: '#44dd88', sz: 2
        });
      }
      if(b.conquerProg >= 1){
        b.conquered = true;
        b.conquerProg = 1;
        b.col = '#44dd88';
        b.glow = '#22aa66';
        b.turretTimer = 1.0;
        popup('CONQUERED', b.x, b.y - b.r - 20, '#44dd88');
        sfx.pickup();
        S.shake = 4;
        burst(b.x, b.y, '#44dd88', 15);
      }
    } else {
      b.conquerProg = Math.max(0, (b.conquerProg || 0) - dt * 0.5);
    }
  }
  for(const b of S.bodies){
    if(!b.conquered) continue;
    b.turretTimer -= dt;
    if(b.turretTimer <= 0){
      b.turretTimer = 1.6;
      let nearest = null, nd = Infinity;
      for(const e of S.enemies){
        const dx = e.x - b.x, dy = e.y - b.y;
        const d = Math.hypot(dx, dy);
        if(d < 420 && d < nd){ nd = d; nearest = e; }
      }
      if(nearest){
        const dx = nearest.x - b.x, dy = nearest.y - b.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        S.projectiles.push({
          type:'turret', x: b.x + (dx/d)*(b.r+5), y: b.y + (dy/d)*(b.r+5),
          vx: (dx/d)*340, vy: (dy/d)*340,
          dmg: 12 + S.room * 3, pr: 2, life: 2.0, sz: 5,
          col: '#44dd88', gravity: false, hits: {}
        });
        throttledSfx('shoot', 0.15);
      }
    }
  }
}

function updateSpawner(dt){
  const p = S.player;
  if(S.roomState === 'fighting'){
    const planets = S.bodies.filter(b => !b.isStar);
    const allConquered = planets.length > 0 && planets.every(b => b.conquered);
    S.roomSpawnTimer -= dt;
    if(S.roomSpawnTimer <= 0 && S.roomSpawnLeft > 0){
      const maxOnScreen = 10 + Math.floor(S.room * 1.5);
      if(S.enemies.length < maxOnScreen){
        const batch = Math.min(S.roomSpawnLeft, 2 + Math.floor(S.room / 3));
        for(let i = 0; i < batch; i++){
          const t = pickWeighted(S.sector.pool, S.sector.weights);
          const e = spawnEnemy(t);
          placeAtArenaEdge(e);
        }
        S.roomSpawnLeft -= batch;
      }
      S.roomSpawnTimer = Math.max(0.25, 0.9 - S.room * 0.03);
    }
    if(S.roomSpawnLeft <= 0 && !allConquered){
      S.roomSpawnLeft = Math.min(25, 4 + Math.floor(S.room * 1.2));
    }
    if(allConquered && S.roomSpawnLeft > 0) S.roomSpawnLeft = 0;
    if(allConquered && S.enemies.length === 0){
      S.roomState = 'cleared';
      S.roomClearT = 1.4;
      const healAmt = 5 + Math.floor(S.room * 0.25);
      p.hp = Math.min(p.maxHp, p.hp + healAmt);
      popup('SYSTEM ' + S.room + ' CLEAR', p.x, p.y - 40, '#ffcf66');
      sfx.roomClear();
      gainXp(3 + S.room * 0.4);
    }
  } else if(S.roomState === 'cleared'){
    S.roomClearT -= dt;
    if(S.roomClearT <= 0){
      S.roomState = 'warping';
      S.warpT = 1.5;
      S.bodies = [];
      S.pickups = [];
      S.projectiles = [];
      sfx.warp();
    }
  } else if(S.roomState === 'warping'){
    S.warpT -= dt;
    if(S.warpT <= 0.75 && S.bodies.length === 0){
      S.room++;
      if(S.room > (meta.maxRoom || 0)) meta.maxRoom = S.room;
      generateBodies();
    }
    if(S.warpT <= 0){
      startRoom(true);
    }
  }
}

// ---------- XP / Level up ----------
function gainXp(amt){
  S.xp += amt;
  let ups = 0;
  while(S.xp >= S.xpNext){
    S.xp -= S.xpNext;
    S.lvl++;
    S.xpNext = Math.round(S.xpNext * 1.5 + 2);
    ups++;
  }
  if(ups > 0){
    S.pendingLevelUps = (S.pendingLevelUps || 0) + ups;
    if(!S.paused) triggerLevelUp();
  }
}

function buildChoices(){
  const p = S.player;
  const pool = [];
  const slots = Object.keys(p.weapons).length;
  for(const id in WEAPONS){
    const cur = p.weapons[id];
    if(cur){
      if(cur.level < WEAPONS[id].max) pool.push({kind:'w', id, lvl:cur.level + 1});
    } else if(slots < 6){
      pool.push({kind:'w', id, lvl:1, isNew:true});
    }
  }
  for(const id in PASSIVES){
    const cur = p.passives[id] || 0;
    if(cur < PASSIVES[id].max) pool.push({kind:'p', id, lvl:cur + 1, isNew:cur === 0});
  }
  for(let i = pool.length-1; i > 0; i--){
    const j = (Math.random()*(i+1))|0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

function triggerLevelUp(){
  if(!S.pendingLevelUps || S.pendingLevelUps <= 0) return;
  S.pendingLevelUps--;
  S.pendingChoices = buildChoices();
  if(!S.pendingChoices.length){
    S.player.hp = Math.min(S.player.maxHp, S.player.hp + 20);
    if(S.pendingLevelUps > 0) triggerLevelUp();
    return;
  }
  renderLevelUpChoices();
  show('levelup');
  S.paused = true;
  sfx.levelUp();
}

function renderLevelUpChoices(){
  const div = document.getElementById('choices');
  div.innerHTML = '';
  for(const c of S.pendingChoices){
    const def = c.kind === 'w' ? WEAPONS[c.id] : PASSIVES[c.id];
    const el = document.createElement('div');
    el.className = 'choice' + (c.isNew ? ' new' : '');
    let extra = '';
    if(c.kind === 'w'){
      extra = WEAPONS[c.id].gravity ? ' <span style="color:#ffcf66;font-size:10px">GRAVITY</span>' : ' <span style="color:#9fb4dc;font-size:10px">STABLE</span>';
    }
    el.innerHTML =
      `<span class="clvl">${c.isNew ? 'NEW' : 'LV ' + c.lvl}</span>
       <div class="ctitle">${def.name}${extra}</div>
       <div class="cdesc">${def.desc}</div>`;
    el.onclick = () => pickChoice(c);
    div.appendChild(el);
  }
  const rb = document.getElementById('rerollBtn');
  if(S.rerollsLeft > 0){
    rb.style.display = 'block';
    document.getElementById('rerollN').textContent = S.rerollsLeft;
  } else {
    rb.style.display = 'none';
  }
}

function pickChoice(c){
  if(c.kind === 'w') giveWeapon(c.id);
  else givePassive(c.id);
  hide('levelup');
  S.paused = false;
  if(S.pendingLevelUps > 0) triggerLevelUp();
}

function doReroll(){
  if(S.rerollsLeft <= 0) return;
  S.rerollsLeft--;
  S.pendingChoices = buildChoices();
  renderLevelUpChoices();
}

// ---------- Start / end run ----------
function startRun(startingRoom){
  initAudio();
  resumeAudio();
  S.mode = 'playing';
  S.player = makePlayer();
  applyMetaAndHero(S.player);
  S.player.x = 0;
  S.player.y = 0;
  giveWeapon(S.hero.start);
  S.enemies = [];
  S.projectiles = [];
  S.pickups = [];
  S.parts = [];
  S.pops = [];
  S.bodies = [];
  S.objective = null;
  S.nebulae = [];
  const aw = 2800;
  const ah = 2200;
  S.arena = {x: -aw/2, y: -ah/2, w: aw, h: ah};
  S.cam.x = 0; S.cam.y = 0;
  S.t = 0;
  S.kills = 0;
  S.runGold = 0;
  S.xp = 0;
  S.xpNext = 5;
  S.lvl = 1;
  S.room = startingRoom || 1;
  S.shake = 0;
  S.flash = 0;
  S.rerollsLeft = metaBonus('rerolls') | 0;
  S.revivesLeft = metaBonus('revives') | 0;
  S.paused = false;
  S.newSectorUnlocked = null;
  generateStarfield();
  startRoom();
  hideAll();
}

function gameOver(){
  S.mode = 'gameover';
  S.paused = true;
  const earned = Math.round(S.runGold);
  meta.gold += earned;
  meta.totalKills += S.kills;
  meta.totalGold += earned;
  if(S.t > meta.maxTime) meta.maxTime = S.t;
  if(S.lvl > meta.maxLevel) meta.maxLevel = S.lvl;
  if(S.room > (meta.maxRoom || 0)) meta.maxRoom = S.room;
  if(S.room >= 15 && S.sectorIdx + 1 < SECTORS.length){
    const next = SECTORS[S.sectorIdx + 1];
    if(!meta.sectorsUnlocked[next.id]){
      meta.sectorsUnlocked[next.id] = true;
      S.newSectorUnlocked = next.name;
    }
  }
  checkHeroUnlocks();
  saveMeta();
  const pName = getPlayerName();
  let rank = -1;
  if(pName) rank = submitScore(pName, S.room, S.kills, S.lvl, S.t);
  let summary =
    `SYSTEM: <b>${S.room}</b><br>` +
    `TIME: <b>${fmtTime(S.t)}</b><br>` +
    `LEVEL: <b>${S.lvl}</b><br>` +
    `KILLS: <b>${S.kills}</b><br>` +
    `SCRAP EARNED: <b>+${earned}</b>`;
  if(rank > 0) summary += `<br><br><span style="color:#7ad6ff"># ${rank} ON LEADERBOARD</span>`;
  if(S.newSectorUnlocked) summary += `<br><span style="color:#ffcf66">NEW SECTOR: ${S.newSectorUnlocked}</span>`;
  document.getElementById('summary').innerHTML = summary;
  renderRestartPicker();
  show('gameover');
}

function renderRestartPicker(){
  const div = document.getElementById('restartPicker');
  const maxSys = S.room;
  let html = '<p class="restart-label">RESTART FROM</p><div class="restart-grid">';
  for(let i = 1; i <= maxSys; i++){
    const cls = i === maxSys ? ' current' : '';
    html += `<button class="restart-sys${cls}" data-act="startFrom" data-room="${i}">${i}</button>`;
  }
  html += '</div>';
  div.innerHTML = html;
}

function renderMenuStartPicker(){
  const div = document.getElementById('menuStartPicker');
  const max = meta.maxRoom || 1;
  if(max <= 1){
    div.style.display = 'none';
    return;
  }
  div.style.display = 'block';
  let html = '<p class="restart-label">OR SKIP TO SYSTEM</p><div class="restart-grid">';
  for(let i = 2; i <= max; i++){
    html += `<button class="restart-sys" data-act="startFrom" data-room="${i}">${i}</button>`;
  }
  html += '</div>';
  div.innerHTML = html;
}

function checkHeroUnlocks(){
  const unlockedSectors = Object.keys(meta.sectorsUnlocked).length;
  for(const h of HEROES){
    if(meta.heroesUnlocked[h.id]) continue;
    const u = h.unlock;
    let ok = false;
    if(u.type === 'free')      ok = true;
    else if(u.type === 'level')ok = meta.maxLevel >= u.v;
    else if(u.type === 'kills')ok = meta.totalKills >= u.v;
    else if(u.type === 'time') ok = meta.maxTime >= u.v;
    else if(u.type === 'room') ok = (meta.maxRoom || 0) >= u.v;
    else if(u.type === 'biome')ok = unlockedSectors > u.v;
    else if(u.type === 'gold') ok = meta.totalGold >= u.v;
    if(ok) meta.heroesUnlocked[h.id] = true;
  }
}

// ---------- Sign-in / Leaderboard ----------
const LB_KEY = 'spaceattractor.lb';
const PLAYER_KEY = 'spaceattractor.player';

function getPlayerName(){ return localStorage.getItem(PLAYER_KEY) || ''; }
function setPlayerName(n){ localStorage.setItem(PLAYER_KEY, n); }

function loadLB(){
  try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
  catch(e){ return []; }
}
function saveLB(lb){ localStorage.setItem(LB_KEY, JSON.stringify(lb)); }

function submitScore(name, room, kills, lvl, time){
  const lb = loadLB();
  const entry = {name, room, kills, lvl, time:Math.round(time), date:Date.now()};
  lb.push(entry);
  lb.sort((a,b) => b.room - a.room || b.kills - a.kills || a.time - b.time);
  if(lb.length > 100) lb.length = 100;
  saveLB(lb);
  const rank = lb.indexOf(entry);
  return rank >= 0 ? rank + 1 : -1;
}

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderLeaderboard(){
  const lb = loadLB();
  const name = getPlayerName();
  const div = document.getElementById('lb');
  if(!lb.length){
    div.innerHTML = '<p class="sub">No scores yet. Play a game!</p>';
    return;
  }
  let html = '<table class="lb-table"><thead><tr><th>#</th><th>NAME</th><th>SEC</th><th>KILLS</th><th>LV</th><th>TIME</th></tr></thead><tbody>';
  const shown = lb.slice(0, 30);
  for(let i = 0; i < shown.length; i++){
    const s = shown[i];
    const me = s.name === name ? ' class="me"' : '';
    html += `<tr${me}><td class="rk">${i+1}</td><td>${escHtml(s.name)}</td><td>${s.room}</td><td>${s.kills}</td><td>${s.lvl}</td><td>${fmtTime(s.time)}</td></tr>`;
  }
  html += '</tbody></table>';
  div.innerHTML = html;
}

// ---------- HUD ----------
const hpFill  = document.getElementById('hpfill');
const xpFill  = document.getElementById('xpfill');
const timeEl  = document.getElementById('time');
const killsEl = document.getElementById('kills');
const goldEl  = document.getElementById('gold');
const lvlEl   = document.getElementById('lvl');

function updateHud(){
  const p = S.player;
  hpFill.style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
  xpFill.style.width = clamp(S.xp / S.xpNext * 100, 0, 100) + '%';
  timeEl.textContent  = 'SYS ' + S.room;
  killsEl.textContent = 'x ' + S.kills;
  goldEl.textContent  = '+ ' + S.runGold;
  lvlEl.textContent   = 'Lv ' + S.lvl;
}

// ---------- Render ----------
function render(){
  const sec = S.sector;
  ctx.fillStyle = sec ? sec.bg : '#020408';
  ctx.fillRect(0, 0, W, H);

  if(S.mode !== 'playing' && S.mode !== 'gameover') return;
  if(!S.player) return;

  // Nebulae (deepest layer)
  if(S.nebulae){
    for(const n of S.nebulae){
      const nx = n.x - S.cam.x * n.depth + W/2;
      const ny = n.y - S.cam.y * n.depth + H/2;
      if(nx < -n.r*2 || nx > W+n.r*2 || ny < -n.r*2 || ny > H+n.r*2) continue;
      const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, n.r);
      grad.addColorStop(0, n.col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(nx, ny, n.r, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Parallax starfield (screen space, slow scroll)
  for(const st of S.bgStars){
    const sx = st.x - S.cam.x * st.depth + W/2;
    const sy = st.y - S.cam.y * st.depth + H/2;
    if(sx < -4 || sx > W+4 || sy < -4 || sy > H+4) continue;
    const twinkle = 0.7 + 0.3 * Math.sin(S.t * st.twinkleSpd + st.x);
    ctx.globalAlpha = st.bright * twinkle;
    ctx.fillStyle = st.col || '#fff';
    if(st.sz > 1.8){
      ctx.beginPath();
      ctx.arc(sx, sy, st.sz * 0.5, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillRect(sx, sy, st.sz, st.sz);
    }
  }
  ctx.globalAlpha = 1;

  const shx = (Math.random() - 0.5) * S.shake;
  const shy = (Math.random() - 0.5) * S.shake;

  ctx.save();
  ctx.translate(W/2 - S.cam.x + shx, H/2 - S.cam.y + shy);

  // Gravity bodies
  for(const b of S.bodies){
    if(b.isStar){
      const grad = ctx.createRadialGradient(b.x, b.y, b.r*0.4, b.x, b.y, b.r*2.8);
      grad.addColorStop(0, 'rgba(255,220,80,0.25)');
      grad.addColorStop(0.5, 'rgba(255,150,40,0.08)');
      grad.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r*2.8, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.5 + 0.2*Math.sin(S.t*3);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r*0.5, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = b.glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 10, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
      const hg = ctx.createRadialGradient(b.x - b.r*0.3, b.y - b.r*0.3, b.r*0.1, b.x, b.y, b.r);
      hg.addColorStop(0, 'rgba(255,255,255,0.15)');
      hg.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
    }
    if(b.conquered){
      ctx.strokeStyle = '#44dd88';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + 0.15 * Math.sin(S.t * 3);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 14, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#44dd88';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - b.r - 8);
      ctx.lineTo(b.x - 5, b.y - b.r - 2);
      ctx.lineTo(b.x + 5, b.y - b.r - 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = b.isStar ? 'rgba(255,200,60,0.06)' : 'rgba(120,160,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI*2);
      ctx.stroke();
    }
    if(!b.isStar && !b.conquered && b.conquerProg > 0){
      const pl2 = S.player;
      ctx.strokeStyle = '#44dd88';
      ctx.globalAlpha = b.conquerProg * 0.5;
      ctx.lineWidth = 1.5 + b.conquerProg * 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(pl2.x, pl2.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#44dd88';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 12, -Math.PI/2, -Math.PI/2 + b.conquerProg * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Pickups
  for(const k of S.pickups){
    ctx.fillStyle = '#3ad1ff';
    ctx.beginPath();
    ctx.arc(k.x, k.y, 3.2, 0, Math.PI*2);
    ctx.fill();
  }

  // Enemies
  for(const e of S.enemies){
    if(e.guardian){
      ctx.strokeStyle = '#ff9944';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(S.t * 5 + e.id);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const evA = Math.atan2(e.vy||0, e.vx||0);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(evA);
    ctx.fillStyle = e.hitFlash > 0 ? '#fff' : e.col;
    ctx.beginPath();
    ctx.moveTo(e.r, 0);
    ctx.lineTo(-e.r * 0.7, -e.r * 0.6);
    ctx.lineTo(-e.r * 0.35, 0);
    ctx.lineTo(-e.r * 0.7, e.r * 0.6);
    ctx.closePath();
    ctx.fill();
    const eSpd = Math.hypot(e.vx||0, e.vy||0);
    if(eSpd > 10){
      ctx.fillStyle = e.col;
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(S.t * 18 + e.id);
      ctx.beginPath();
      ctx.moveTo(-e.r * 0.45, -e.r * 0.22);
      ctx.lineTo(-e.r * (0.8 + eSpd * 0.002), 0);
      ctx.lineTo(-e.r * 0.45, e.r * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // Projectiles
  for(const p of S.projectiles){
    if(p.type === 'nova'){
      ctx.strokeStyle = '#b27aff';
      ctx.lineWidth = 6;
      ctx.globalAlpha = Math.max(0, p.life / 0.45);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      if(p.gravity){
        ctx.strokeStyle = p.col;
        ctx.globalAlpha = 0.2;
        ctx.lineWidth = p.sz * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx*0.03, p.y - p.vy*0.03);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Orbit drones
  const orbitW = S.player.weapons.orbit;
  if(orbitW){
    const oLvl = WEAPONS.orbit.l[orbitW.level - 1];
    const oAng = orbitW.extra.angle || 0;
    for(let i=0;i<oLvl.n;i++){
      const oa = oAng + (i/oLvl.n) * Math.PI*2;
      const obx = S.player.x + Math.cos(oa) * oLvl.radius;
      const oby = S.player.y + Math.sin(oa) * oLvl.radius;
      ctx.fillStyle = '#9feaff';
      ctx.beginPath();
      ctx.arc(obx, oby, oLvl.sz, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Plasma field ring
  const plasmaW = S.player.weapons.plasma;
  if(plasmaW){
    const pLvl = WEAPONS.plasma.l[plasmaW.level - 1];
    ctx.strokeStyle = '#ff7a66';
    ctx.globalAlpha = 0.22 + 0.06*Math.sin(S.t*6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S.player.x, S.player.y, pLvl.radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Player ship (triangle)
  const pl = S.player;
  if(pl.invuln > 0 && ((S.t * 18) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
  const moveVel = Math.hypot(pl.vx, pl.vy);
  if(moveVel > 5) pl.headingA = Math.atan2(pl.vy, pl.vx);
  const shipA = pl.headingA || 0;
  ctx.save();
  ctx.translate(pl.x, pl.y);
  ctx.rotate(shipA);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(pl.r, 0);
  ctx.lineTo(-pl.r * 0.7, -pl.r * 0.65);
  ctx.lineTo(-pl.r * 0.4, 0);
  ctx.lineTo(-pl.r * 0.7, pl.r * 0.65);
  ctx.closePath();
  ctx.fill();
  if(pl.moving){
    ctx.fillStyle = '#3ad1ff';
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(S.t * 20);
    ctx.beginPath();
    ctx.moveTo(-pl.r * 0.5, -pl.r * 0.3);
    ctx.lineTo(-pl.r * 1.1, 0);
    ctx.lineTo(-pl.r * 0.5, pl.r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Aim reticle
  const aimA = Math.atan2(pl.aim.y, pl.aim.x);
  ctx.strokeStyle = '#ffcf66';
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(pl.x + Math.cos(aimA) * (pl.r + 8), pl.y + Math.sin(aimA) * (pl.r + 8));
  ctx.lineTo(pl.x + Math.cos(aimA) * (pl.r + 32), pl.y + Math.sin(aimA) * (pl.r + 32));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffcf66';
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(pl.x + Math.cos(aimA) * (pl.r + 35), pl.y + Math.sin(aimA) * (pl.r + 35), 3, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Particles
  for(const pt of S.parts){
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.col;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.sz, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Popups
  ctx.textAlign = 'center';
  ctx.font = '700 13px ui-monospace,Menlo,Consolas,monospace';
  for(const pp of S.pops){
    ctx.globalAlpha = Math.max(0, pp.life / 0.7);
    ctx.fillStyle = pp.col;
    ctx.fillText(pp.text, pp.x, pp.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  if(S.roomState === 'warping' && S.warpT > 0){
    const warpTotal = 1.5;
    const prog = 1 - S.warpT / warpTotal;
    const intensity = prog < 0.5 ? prog * 2 : (1 - prog) * 2;
    const cx = W/2, cy = H/2;
    for(const st of S.bgStars){
      let sx = ((st.x * 0.4 + 2200) % (W + 40)) - 20;
      let sy = ((st.y * 0.4 + 2200) % (H + 40)) - 20;
      const sdx = sx - cx, sdy = sy - cy;
      const sd = Math.hypot(sdx, sdy) + 1;
      const snx = sdx / sd, sny = sdy / sd;
      const len = intensity * 220 * Math.min(1.5, sd / 80);
      ctx.strokeStyle = `rgba(140,200,255,${(0.15 + intensity * 0.5) * st.bright})`;
      ctx.lineWidth = st.sz * (1 + intensity * 2);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + snx * len, sy + sny * len);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(10,20,80,${intensity * 0.12})`;
    ctx.fillRect(0, 0, W, H);
    if(prog > 0.43 && prog < 0.57){
      const flash = 1 - Math.abs(prog - 0.5) / 0.07;
      if(flash > 0){
        ctx.globalAlpha = flash * 0.8;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = '#7ad6ff';
    ctx.font = '900 22px system-ui';
    ctx.textAlign = 'center';
    ctx.globalAlpha = intensity;
    ctx.fillText(prog < 0.5 ? 'WARPING...' : 'SYSTEM ' + S.room, cx, cy - 50);
    ctx.globalAlpha = 1;
  }

  // Minimap
  const ar = S.arena;
  const mmW = 120, mmH = Math.round(mmW * ar.h / ar.w);
  const mmX = 12, mmY = 62;
  const mmScale = mmW / ar.w;

  ctx.fillStyle = 'rgba(2,4,12,0.7)';
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = 'rgba(80,120,220,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  for(const b of S.bodies){
    const bx = mmX + (b.x - ar.x) * mmScale;
    const by = mmY + (b.y - ar.y) * mmScale;
    const br = Math.max(2, b.r * mmScale);
    if(b.isStar){
      ctx.fillStyle = b.col;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(bx, by, br * 2.5, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = b.col;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.fillStyle = '#ff4466';
  ctx.globalAlpha = 0.7;
  for(const e of S.enemies){
    const ex = mmX + (e.x - ar.x) * mmScale;
    const ey = mmY + (e.y - ar.y) * mmScale;
    ctx.fillRect(ex - 1, ey - 1, 2, 2);
  }

  const px = mmX + (pl.x - ar.x) * mmScale;
  const py = mmY + (pl.y - ar.y) * mmScale;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(px, py, 2.5, 0, Math.PI*2);
  ctx.fill();

  const vx = mmX + (S.cam.x - W/2 - ar.x) * mmScale;
  const vy = mmY + (S.cam.y - H/2 - ar.y) * mmScale;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(vx, vy, W * mmScale, H * mmScale);
  ctx.globalAlpha = 1;

  // Floating joystick (screen space)
  if(joy.active){
    ctx.fillStyle = 'rgba(10,15,30,0.38)';
    ctx.strokeStyle = 'rgba(100,180,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joy.baseX, joy.baseY, joy.radius, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(100,180,255,0.85)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joy.stickX, joy.stickY, 26, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }

  if(S.flash > 0){
    ctx.globalAlpha = Math.min(1, S.flash * 2.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ---------- Main loop ----------
let last = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if(S.mode === 'playing' && !S.paused) step(dt);
  render();
  requestAnimationFrame(loop);
}

function step(dt){
  const p = S.player;
  S.t += dt;

  const speed = p.baseSpd * p.spdMul;
  let targetVx = 0, targetVy = 0;
  const kv = getKeyVec();
  if(kv){
    targetVx = kv.x * speed;
    targetVy = kv.y * speed;
  } else if(joy.active && joy.mag > 0.05){
    targetVx = joy.dx * joy.mag * speed;
    targetVy = joy.dy * joy.mag * speed;
  }

  const blend = Math.min(1, dt * 5);
  p.vx = p.vx * (1 - blend) + targetVx * blend;
  p.vy = p.vy * (1 - blend) + targetVy * blend;

  // Player gravity (reduced by gravResist passive)
  for(const b of S.bodies){
    const dx = b.x - p.x, dy = b.y - p.y;
    const d2 = dx*dx + dy*dy;
    const dd = Math.sqrt(d2) + 1e-3;
    const minD = b.r * 1.2;
    const effD2 = Math.max(d2, minD * minD);
    const force = b.mass / effD2 * 2.5 * Math.max(0, 1 - p.gravResist);
    p.vx += (dx / dd) * force * dt;
    p.vy += (dy / dd) * force * dt;
  }

  if(S.roomState === 'warping'){
    p.vx += -p.x * 4 * dt;
    p.vy += -p.y * 4 * dt;
  }

  const maxV = speed * 1.5;
  const vm = Math.hypot(p.vx, p.vy);
  if(vm > maxV){ p.vx *= maxV / vm; p.vy *= maxV / vm; }

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.moving = Math.hypot(p.vx, p.vy) > speed * 0.08;

  resolveBodyCollision(p);
  checkCrashBurn(p);

  let nearest = null, nd = Infinity;
  for(const e of S.enemies){
    const ex = e.x - p.x, ey = e.y - p.y;
    const d2 = ex*ex + ey*ey;
    if(d2 < nd){ nd = d2; nearest = e; }
  }
  if(nearest){
    const ex = nearest.x - p.x, ey = nearest.y - p.y;
    const dd = Math.hypot(ex, ey) + 1e-3;
    p.aim.x = ex/dd; p.aim.y = ey/dd;
  }

  p.invuln -= dt;
  if(p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

  S.cam.x += (p.x - S.cam.x) * Math.min(1, dt * 9);
  S.cam.y += (p.y - S.cam.y) * Math.min(1, dt * 9);

  updateConquer(dt);
  updateSpawner(dt);
  updateEnemies(dt);
  updateWeapons(dt);
  updateProjectiles(dt);
  updatePickups(dt);
  updateParts(dt);

  S.shake *= Math.pow(0.001, dt);
  S.flash = Math.max(0, S.flash - dt);
  updateHud();

  if(p.hp <= 0){
    if(S.revivesLeft > 0){
      S.revivesLeft--;
      p.hp = p.maxHp;
      p.invuln = 2.2;
      S.flash = 0.5;
      for(const e of S.enemies){
        const dx = e.x - p.x, dy = e.y - p.y;
        if(dx*dx + dy*dy < 300*300) e.hp = 0;
      }
      popup('FAILSAFE', p.x, p.y - 40, '#7ad6ff');
    } else {
      gameOver();
    }
  }
}

// ---------- Menus ----------
function renderMeta(){
  document.getElementById('metaGold').textContent = meta.gold;
  const c = document.getElementById('upgrades');
  c.innerHTML = '';
  for(const u of META){
    const lvl = meta.upgrades[u.id] || 0;
    const cost = lvl < u.max ? u.cost[lvl] : null;
    const el = document.createElement('div');
    el.className = 'card' + (lvl > 0 ? ' owned' : '');
    el.innerHTML =
      `<div>
         <div class="t">${u.name} <span style="color:#7ad6ff">${lvl}/${u.max}</span></div>
         <div class="d">${u.desc}</div>
       </div>
       <div class="r">${cost !== null ? `<button>+ ${cost}</button>` : `<span style="color:#7ad6ff;font-size:11px">MAX</span>`}</div>`;
    if(cost !== null){
      el.querySelector('button').onclick = () => {
        if(meta.gold >= cost){
          meta.gold -= cost;
          meta.upgrades[u.id] = lvl + 1;
          saveMeta();
          renderMeta();
        }
      };
    }
    c.appendChild(el);
  }
}

function renderChars(){
  const c = document.getElementById('chars');
  c.innerHTML = '';
  const unlockedSectors = Object.keys(meta.sectorsUnlocked).length;
  for(const h of HEROES){
    const unlocked = !!meta.heroesUnlocked[h.id];
    const selected = meta.selectedHero === h.id;
    const el = document.createElement('div');
    el.className = 'card' + (unlocked ? ' owned' : ' locked');
    const u = h.unlock;
    let req = '';
    if(!unlocked){
      if(u.type === 'level') req = `Reach Lv ${u.v}`;
      else if(u.type === 'kills') req = `${meta.totalKills}/${u.v} kills`;
      else if(u.type === 'time')  req = `Survive ${(u.v/60)|0}:00`;
      else if(u.type === 'room')  req = `Reach sector ${u.v} (${meta.maxRoom||0})`;
      else if(u.type === 'biome') req = `Unlock ${u.v+1} sectors (${unlockedSectors})`;
      else if(u.type === 'gold')  req = `Earn ${u.v} total scrap`;
    } else {
      req = selected ? 'SELECTED' : 'TAP TO SELECT';
    }
    el.innerHTML =
      `<div>
         <div class="t">${h.name}</div>
         <div class="d">${h.desc} &middot; Starts with <b>${WEAPONS[h.start].name}</b></div>
       </div>
       <div class="r"><span style="color:${selected?'#7ad6ff':'#90a2cc'};font-size:11px">${req}</span></div>`;
    if(unlocked){
      el.onclick = () => { meta.selectedHero = h.id; S.hero = h; saveMeta(); renderChars(); };
    }
    c.appendChild(el);
  }
}

function renderSectors(){
  const c = document.getElementById('sectors');
  c.innerHTML = '';
  for(let i = 0; i < SECTORS.length; i++){
    const b = SECTORS[i];
    const unlocked = !!meta.sectorsUnlocked[b.id];
    const selected = meta.selectedSector === b.id;
    const prev = SECTORS[i-1];
    const el = document.createElement('div');
    el.className = 'card' + (unlocked ? ' owned' : ' locked');
    el.innerHTML =
      `<div>
         <div class="t">${b.name}</div>
         <div class="d">${unlocked ? 'Tap to select' : `Clear sector 15 in ${prev ? prev.name : 'prev sector'}`}</div>
       </div>
       <div class="r"><span style="color:${selected?'#7ad6ff':'#90a2cc'};font-size:11px">${selected?'SELECTED':''}</span></div>`;
    if(unlocked){
      el.onclick = () => { meta.selectedSector = b.id; S.sectorIdx = i; S.sector = b; saveMeta(); renderSectors(); };
    }
    c.appendChild(el);
  }
}

// ---------- Button wiring ----------
document.body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if(!b) return;
  const act = b.dataset.act;
  if(act === 'play') startRun();
  else if(act === 'startFrom'){
    const room = parseInt(b.dataset.room) || 1;
    startRun(room);
  }
  else if(act === 'meta'){ hideAll(); renderMeta(); show('metaScreen'); }
  else if(act === 'chars'){ hideAll(); renderChars(); show('charsScreen'); }
  else if(act === 'sectors'){ hideAll(); renderSectors(); show('sectorsScreen'); }
  else if(act === 'signin'){
    const name = document.getElementById('nameInput').value.trim();
    if(!name) return;
    setPlayerName(name);
    document.getElementById('playerTag').textContent = name;
    hideAll(); renderMenuStartPicker(); show('menu');
  }
  else if(act === 'changeName'){
    e.preventDefault();
    document.getElementById('nameInput').value = getPlayerName();
    hideAll(); show('signin');
  }
  else if(act === 'lb'){ hideAll(); renderLeaderboard(); show('lbScreen'); S.mode = 'menu'; S.paused = false; }
  else if(act === 'home'){ hideAll(); renderMenuStartPicker(); show('menu'); S.mode = 'menu'; S.paused = false; }
  else if(act === 'resume'){ hide('pause'); S.paused = false; }
  else if(act === 'quit'){ hide('pause'); gameOver(); }
  else if(act === 'reroll') doReroll();
});

document.getElementById('pauseBtn').addEventListener('click', togglePause);
const muteBtn = document.getElementById('muteBtn');
muteBtn.addEventListener('click', () => {
  audioMuted = !audioMuted;
  muteBtn.textContent = audioMuted ? 'OFF' : 'SND';
  muteBtn.classList.toggle('muted', audioMuted);
});

// ---------- Init ----------
S.hero = HEROES.find(h => h.id === meta.selectedHero) || HEROES[0];
if(!meta.heroesUnlocked[S.hero.id]) S.hero = HEROES[0];
const bi = SECTORS.findIndex(b => b.id === meta.selectedSector);
S.sectorIdx = bi >= 0 ? bi : 0;
S.sector = SECTORS[S.sectorIdx];
if(!meta.sectorsUnlocked[S.sector.id]){
  S.sectorIdx = 0;
  S.sector = SECTORS[0];
  meta.selectedSector = 'nebula';
}
S.player = makePlayer();

const _savedName = getPlayerName();
if(_savedName){
  document.getElementById('playerTag').textContent = _savedName;
  renderMenuStartPicker();
  show('menu');
} else {
  show('signin');
}

document.getElementById('nameInput').addEventListener('keydown', (ev) => {
  if(ev.key === 'Enter') document.querySelector('[data-act="signin"]').click();
});

requestAnimationFrame(loop);
