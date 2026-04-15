// ============================================================
// game.js — spawner, level-up, render, UI wiring, main loop, init
// ============================================================

// ---------- Spawner ----------
function updateSpawner(dt){
  S.spawnTimer -= dt;
  const mins = S.t / 60;
  const rate = Math.max(0.18, 1.0 - mins * 0.09);
  const cap = 120;
  if(S.spawnTimer <= 0 && S.enemies.length < cap){
    S.spawnTimer = rate;
    const count = 1 + Math.floor(mins * 0.5);
    for(let i=0;i<count;i++){
      if(S.enemies.length >= cap) break;
      const t = pickWeighted(S.biome.pool, S.biome.weights);
      spawnEnemy(t);
    }
  }
  S.bossTimer -= dt;
  if(S.bossTimer <= 0){
    S.bossTimer = 90;
    const b = spawnEnemy('boss');
    const extra = Math.floor(mins / 1.5);
    b.hp *= (1 + extra * 0.6);
    b.hpMax = b.hp;
    popup('BOSS', S.player.x, S.player.y - 60, '#ff4466');
    S.shake = 10;
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
      if(cur.level < WEAPONS[id].max){
        pool.push({kind:'w', id, lvl:cur.level + 1});
      }
    } else if(slots < 6){
      pool.push({kind:'w', id, lvl:1, isNew:true});
    }
  }
  for(const id in PASSIVES){
    const cur = p.passives[id] || 0;
    if(cur < PASSIVES[id].max){
      pool.push({kind:'p', id, lvl:cur + 1, isNew:cur === 0});
    }
  }
  for(let i=pool.length-1;i>0;i--){
    const j = (Math.random() * (i+1)) | 0;
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
}

function renderLevelUpChoices(){
  const div = document.getElementById('choices');
  div.innerHTML = '';
  for(const c of S.pendingChoices){
    const def = c.kind === 'w' ? WEAPONS[c.id] : PASSIVES[c.id];
    const el = document.createElement('div');
    el.className = 'choice' + (c.isNew ? ' new' : '');
    el.innerHTML =
      `<span class="clvl">${c.isNew ? 'NEW' : 'LV ' + c.lvl}</span>
       <div class="ctitle">${def.name}</div>
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
function startRun(){
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
  S.cam.x = 0; S.cam.y = 0;
  S.t = 0;
  S.kills = 0;
  S.runGold = 0;
  S.xp = 0;
  S.xpNext = 5;
  S.lvl = 1;
  S.spawnTimer = 0.5;
  S.bossTimer = 90;
  S.shake = 0;
  S.flash = 0;
  S.rerollsLeft = metaBonus('rerolls') | 0;
  S.revivesLeft = metaBonus('revives') | 0;
  S.paused = false;
  S.newBiomeUnlocked = null;
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
  // Biome unlock: survive 5+ minutes to unlock the next one
  if(S.t >= 300 && S.biomeIdx + 1 < BIOMES.length){
    const next = BIOMES[S.biomeIdx + 1];
    if(!meta.biomesUnlocked[next.id]){
      meta.biomesUnlocked[next.id] = true;
      S.newBiomeUnlocked = next.name;
    }
  }
  checkHeroUnlocks();
  saveMeta();
  let summary =
    `TIME: <b>${fmtTime(S.t)}</b><br>` +
    `LEVEL: <b>${S.lvl}</b><br>` +
    `KILLS: <b>${S.kills}</b><br>` +
    `GOLD EARNED: <b>+${earned}</b>`;
  if(S.newBiomeUnlocked){
    summary += `<br><br><span style="color:#ffcf66">NEW BIOME: ${S.newBiomeUnlocked}</span>`;
  }
  document.getElementById('summary').innerHTML = summary;
  show('gameover');
}

function checkHeroUnlocks(){
  const unlockedBiomes = Object.keys(meta.biomesUnlocked).length;
  for(const h of HEROES){
    if(meta.heroesUnlocked[h.id]) continue;
    const u = h.unlock;
    let ok = false;
    if(u.type === 'free')      ok = true;
    else if(u.type === 'level')ok = meta.maxLevel >= u.v;
    else if(u.type === 'kills')ok = meta.totalKills >= u.v;
    else if(u.type === 'time') ok = meta.maxTime >= u.v;
    else if(u.type === 'biome')ok = unlockedBiomes > u.v;
    else if(u.type === 'gold') ok = meta.totalGold >= u.v;
    if(ok) meta.heroesUnlocked[h.id] = true;
  }
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
  timeEl.textContent  = fmtTime(S.t);
  killsEl.textContent = 'x ' + S.kills;
  goldEl.textContent  = '+ ' + S.runGold;
  lvlEl.textContent   = 'Lv ' + S.lvl;
}

// ---------- Render ----------
function render(){
  ctx.fillStyle = S.biome ? S.biome.bg : '#05070d';
  ctx.fillRect(0, 0, W, H);

  if(S.mode !== 'playing' && S.mode !== 'gameover') return;
  if(!S.player) return;

  const shx = (Math.random() - 0.5) * S.shake;
  const shy = (Math.random() - 0.5) * S.shake;

  ctx.save();
  ctx.translate(W/2 - S.cam.x + shx, H/2 - S.cam.y + shy);

  // Grid in world space.
  ctx.strokeStyle = S.biome.grid;
  ctx.lineWidth = 1;
  const gs = 64;
  const left   = S.cam.x - W/2 - gs;
  const right  = S.cam.x + W/2 + gs;
  const top    = S.cam.y - H/2 - gs;
  const bottom = S.cam.y + H/2 + gs;
  const x0 = Math.floor(left / gs) * gs;
  const y0 = Math.floor(top / gs) * gs;
  ctx.beginPath();
  for(let x=x0;x<right;x+=gs){ ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
  for(let y=y0;y<bottom;y+=gs){ ctx.moveTo(left, y); ctx.lineTo(right, y); }
  ctx.stroke();

  // Pickups
  for(const k of S.pickups){
    ctx.fillStyle = '#3ad1ff';
    ctx.beginPath();
    ctx.arc(k.x, k.y, 3.2, 0, Math.PI*2);
    ctx.fill();
  }

  // Enemies
  for(const e of S.enemies){
    ctx.fillStyle = e.hitFlash > 0 ? '#fff' : e.col;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
    ctx.fill();
    if(e.boss){
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2, 5);
      ctx.fillStyle = '#ff6680';
      ctx.fillRect(e.x - e.r, e.y - e.r - 10, (e.r * 2) * (e.hp / e.hpMax), 5);
    }
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
    } else if(p.type === 'thunder'){
      ctx.strokeStyle = '#ffde66';
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.max(0.2, p.life / 0.25);
      ctx.beginPath();
      ctx.moveTo(p.x + (Math.random()-0.5)*6, p.y - 320);
      ctx.lineTo(p.x + (Math.random()-0.5)*6, p.y - 160);
      ctx.lineTo(p.x + (Math.random()-0.5)*6, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffde66';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz * Math.max(0.4, p.life / 0.25), 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Orbit blades
  const orbit = S.player.weapons.orbit;
  if(orbit){
    const lvl = WEAPONS.orbit.l[orbit.level - 1];
    const ang = orbit.extra.angle || 0;
    for(let i=0;i<lvl.n;i++){
      const a = ang + (i/lvl.n) * Math.PI*2;
      const bx = S.player.x + Math.cos(a) * lvl.radius;
      const by = S.player.y + Math.sin(a) * lvl.radius;
      ctx.fillStyle = '#9feaff';
      ctx.beginPath();
      ctx.arc(bx, by, lvl.sz, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Aura ring
  const aura = S.player.weapons.aura;
  if(aura){
    const lvl = WEAPONS.aura.l[aura.level - 1];
    ctx.strokeStyle = '#ff7a66';
    ctx.globalAlpha = 0.22 + 0.06*Math.sin(S.t*6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S.player.x, S.player.y, lvl.radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Player — circle with an aim indicator that lights up when stopped
  // (i.e. firing). While moving it dims, reminding you that you're only
  // dodging, not damaging.
  const pl = S.player;
  if(pl.invuln > 0 && ((S.t * 18) | 0) % 2 === 0){
    ctx.globalAlpha = 0.45;
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = pl.moving ? '#5a6a9a' : '#ffcf66';
  ctx.beginPath();
  ctx.arc(pl.x + pl.aim.x * (pl.r + 4), pl.y + pl.aim.y * (pl.r + 4),
          pl.r * 0.45, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Particles
  for(const p of S.parts){
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.sz, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Popups
  ctx.textAlign = 'center';
  ctx.font = '700 13px ui-monospace,Menlo,Consolas,monospace';
  for(const p of S.pops){
    ctx.globalAlpha = Math.max(0, p.life / 0.7);
    ctx.fillStyle = p.col;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

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
  if(S.mode === 'playing' && !S.paused){
    step(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function step(dt){
  const p = S.player;
  S.t += dt;

  // --- Movement: 2D drag-to-move, stopping unleashes weapons. ---
  const speed = p.baseSpd * p.spdMul;
  const maxStep = speed * dt;
  let moved = false;
  const kv = getKeyVec();
  if(kv){
    p.x += kv.x * maxStep;
    p.y += kv.y * maxStep;
    moved = true;
  } else {
    const tp = getTargetScreen();
    if(tp){
      // Touch is in screen coords; convert to world using the camera.
      const wx = tp.x - W/2 + S.cam.x;
      const wy = tp.y - H/2 + S.cam.y;
      const dx = wx - p.x, dy = wy - p.y;
      const d = Math.hypot(dx, dy);
      const stopDist = 4;
      if(d > stopDist){
        const stepLen = Math.min(d - stopDist, maxStep);
        p.x += (dx/d) * stepLen;
        p.y += (dy/d) * stepLen;
        moved = stepLen > 0.5;
      }
    }
  }
  p.moving = moved;

  // --- Auto-aim at the nearest enemy. ---
  let nearest = null, nd = Infinity;
  for(const e of S.enemies){
    const ex = e.x - p.x, ey = e.y - p.y;
    const d2 = ex*ex + ey*ey;
    if(d2 < nd){ nd = d2; nearest = e; }
  }
  if(nearest){
    const ex = nearest.x - p.x, ey = nearest.y - p.y;
    const d = Math.hypot(ex, ey) + 1e-3;
    p.aim.x = ex/d; p.aim.y = ey/d;
  }

  p.invuln -= dt;
  if(p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

  // Camera follow.
  S.cam.x += (p.x - S.cam.x) * Math.min(1, dt * 9);
  S.cam.y += (p.y - S.cam.y) * Math.min(1, dt * 9);

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
      // clear nearby enemies
      for(const e of S.enemies){
        const dx = e.x - p.x, dy = e.y - p.y;
        if(dx*dx + dy*dy < 300*300) e.hp = 0;
      }
      popup('REVIVE', p.x, p.y - 40, '#7ad6ff');
    } else {
      gameOver();
    }
  }
}

// ---------- Menus / meta UI ----------
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
       <div class="r">${
         cost !== null
           ? `<button>+ ${cost}</button>`
           : `<span style="color:#7ad6ff;font-size:11px">MAX</span>`
       }</div>`;
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
  const unlockedBiomes = Object.keys(meta.biomesUnlocked).length;
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
      else if(u.type === 'biome') req = `Unlock ${u.v+1} biomes (${unlockedBiomes})`;
      else if(u.type === 'gold')  req = `Earn ${u.v} total gold`;
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
      el.onclick = () => {
        meta.selectedHero = h.id;
        S.hero = h;
        saveMeta();
        renderChars();
      };
    }
    c.appendChild(el);
  }
}

function renderBiomes(){
  const c = document.getElementById('biomes');
  c.innerHTML = '';
  for(let i=0;i<BIOMES.length;i++){
    const b = BIOMES[i];
    const unlocked = !!meta.biomesUnlocked[b.id];
    const selected = meta.selectedBiome === b.id;
    const prev = BIOMES[i-1];
    const el = document.createElement('div');
    el.className = 'card' + (unlocked ? ' owned' : ' locked');
    el.innerHTML =
      `<div>
         <div class="t">${b.name}</div>
         <div class="d">${unlocked ? 'Tap to select' : `Survive 5:00 in ${prev ? prev.name : 'prev biome'}`}</div>
       </div>
       <div class="r"><span style="color:${selected?'#7ad6ff':'#90a2cc'};font-size:11px">${selected?'SELECTED':''}</span></div>`;
    if(unlocked){
      el.onclick = () => {
        meta.selectedBiome = b.id;
        S.biomeIdx = i;
        S.biome = b;
        saveMeta();
        renderBiomes();
      };
    }
    c.appendChild(el);
  }
}

// ---------- Button wiring ----------
document.body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if(!b) return;
  const a = b.dataset.act;
  if(a === 'play'){
    startRun();
  } else if(a === 'meta'){
    hideAll(); renderMeta(); show('metaScreen');
  } else if(a === 'chars'){
    hideAll(); renderChars(); show('charsScreen');
  } else if(a === 'biomes'){
    hideAll(); renderBiomes(); show('biomesScreen');
  } else if(a === 'home'){
    hideAll(); show('menu'); S.mode = 'menu'; S.paused = false;
  } else if(a === 'retry'){
    startRun();
  } else if(a === 'resume'){
    hide('pause'); S.paused = false;
  } else if(a === 'quit'){
    hide('pause'); gameOver();
  } else if(a === 'reroll'){
    doReroll();
  }
});

document.getElementById('pauseBtn').addEventListener('click', togglePause);

// ---------- Init ----------
S.hero = HEROES.find(h => h.id === meta.selectedHero) || HEROES[0];
if(!meta.heroesUnlocked[S.hero.id]) S.hero = HEROES[0];
const bi = BIOMES.findIndex(b => b.id === meta.selectedBiome);
S.biomeIdx = bi >= 0 ? bi : 0;
S.biome = BIOMES[S.biomeIdx];
if(!meta.biomesUnlocked[S.biome.id]){
  S.biomeIdx = 0;
  S.biome = BIOMES[0];
  meta.selectedBiome = 'city';
}
S.player = makePlayer();

requestAnimationFrame(loop);
