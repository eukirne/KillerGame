// ============================================================
// entities.js — player, enemies, weapons, projectiles, pickups
// SpaceAttractor edition — gravity-aware movement & combat
// ============================================================

let ENEMY_ID = 1;

// ---------- Player ----------
function makePlayer(){
  return {
    x:0, y:0, r:16,
    vx:0, vy:0,
    hp:100, maxHp:100,
    baseSpd:340,
    dmgMul:1, spdMul:1, cdMul:1, magMul:1, lootMul:1,
    armor:0, regen:0, gravResist:0,
    invuln:0,
    aim:{x:1, y:0},
    moving:false,
    weapons:{},
    passives:{},
  };
}

function applyMetaAndHero(p){
  p.maxHp  += metaBonus('maxHp');
  p.dmgMul += metaBonus('dmgMul');
  p.spdMul += metaBonus('spdMul');
  p.magMul += metaBonus('magMul');
  const m = S.hero.mods || {};
  for(const k in m){
    if(typeof p[k] === 'number') p[k] += m[k];
  }
  p.hp = p.maxHp;
}

function giveWeapon(id){
  const p = S.player;
  if(!p.weapons[id]){
    p.weapons[id] = {level:1, t:0, extra:{}};
  } else if(p.weapons[id].level < WEAPONS[id].max){
    p.weapons[id].level++;
  }
}
function givePassive(id){
  const p = S.player;
  const def = PASSIVES[id];
  p.passives[id] = (p.passives[id] || 0) + 1;
  if(def.stat === 'maxHp'){
    p.maxHp += def.step;
    p.hp = Math.min(p.maxHp, p.hp + def.step);
  } else {
    p[def.stat] += def.step;
  }
}

// ---------- Particles / popups ----------
function burst(x, y, col, n){
  for(let i=0;i<n;i++){
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    S.parts.push({
      x, y,
      vx:Math.cos(a)*s, vy:Math.sin(a)*s,
      life:0.5, maxLife:0.5,
      col, sz:2 + Math.random()*2.2
    });
  }
}
function popup(text, x, y, col){
  S.pops.push({text:String(text), x, y, life:0.7, col});
}
function updateParts(dt){
  for(let i=S.parts.length-1;i>=0;i--){
    const p = S.parts[i];
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
    if(p.life <= 0) S.parts.splice(i,1);
  }
  for(let i=S.pops.length-1;i>=0;i--){
    const p = S.pops[i];
    p.y -= 42*dt;
    p.life -= dt;
    if(p.life <= 0) S.pops.splice(i,1);
  }
}

// ---------- Body collision resolution ----------
function resolveBodyCollision(entity){
  for(const b of S.bodies){
    const dx = entity.x - b.x, dy = entity.y - b.y;
    const dist = Math.hypot(dx, dy);
    const minD = b.r + entity.r;
    if(dist < minD){
      const nx = dx / (dist + 1e-3);
      const ny = dy / (dist + 1e-3);
      entity.x = b.x + nx * minD;
      entity.y = b.y + ny * minD;
      const dot = entity.vx * nx + entity.vy * ny;
      if(dot < 0){
        entity.vx -= nx * dot * 1.4;
        entity.vy -= ny * dot * 1.4;
      }
    }
  }
}

// ---------- Crash/burn for player ----------
function checkCrashBurn(p){
  for(const b of S.bodies){
    const dx = p.x - b.x, dy = p.y - b.y;
    const dist = Math.hypot(dx, dy);
    if(dist < b.crashR + p.r && p.invuln <= 0){
      const dmg = Math.max(1, b.crashDmg - p.armor);
      p.hp -= dmg;
      p.invuln = 0.45;
      popup('-' + dmg, p.x, p.y - 22, b.isStar ? '#ffcc44' : '#ff8844');
      S.flash = 0.15;
      S.shake = Math.max(S.shake, b.isStar ? 8 : 4);
      burst(p.x, p.y, b.isStar ? '#ffcc44' : '#ff8844', 6);
      sfx.crash();
    }
  }
}

function checkCrashBurnEnemy(e){
  if(e.crashCD > 0) return;
  for(const b of S.bodies){
    const dx = e.x - b.x, dy = e.y - b.y;
    const dist = Math.hypot(dx, dy);
    if(dist < b.crashR + e.r){
      const dmg = b.crashDmg;
      e.hp -= dmg;
      e.crashCD = 0.4;
      e.hitFlash = 1;
      popup('-' + dmg, e.x, e.y - e.r - 2, b.isStar ? '#ffcc44' : '#ff8844');
      burst(e.x, e.y, b.isStar ? '#ffcc44' : '#ff8844', 4);
      throttledSfx('crash', 0.12);
      return;
    }
  }
}

// ---------- Damage dealing ----------
function damage(e, amt){
  if(e.hp <= 0) return;
  const d = Math.round(amt);
  e.hp -= d;
  e.hitFlash = 1;
  popup(d, e.x + (Math.random()-0.5)*10, e.y - e.r - 2, '#ffffff');
  throttledSfx('hit', 0.06);
}

// ---------- Weapons ----------
function updateWeapons(dt){
  const p = S.player;
  for(const id in p.weapons){
    const w = p.weapons[id];
    const def = WEAPONS[id];
    const lvl = def.l[w.level - 1];

    if(id === 'orbit'){
      w.extra.angle = (w.extra.angle || 0) + lvl.spd * dt;
      if(!w.extra.hits) w.extra.hits = [];
      while(w.extra.hits.length < lvl.n) w.extra.hits.push({});
      while(w.extra.hits.length > lvl.n) w.extra.hits.pop();
      for(let i=0;i<lvl.n;i++){
        const a = w.extra.angle + (i/lvl.n) * Math.PI*2;
        const bx = p.x + Math.cos(a)*lvl.radius;
        const by = p.y + Math.sin(a)*lvl.radius;
        for(const e of S.enemies){
          const dx = e.x - bx, dy = e.y - by;
          const rr = (e.r + lvl.sz);
          if(dx*dx + dy*dy < rr*rr){
            const last = w.extra.hits[i][e.id] || 0;
            if(S.t - last > lvl.hit){
              w.extra.hits[i][e.id] = S.t;
              damage(e, lvl.dmg * p.dmgMul);
            }
          }
        }
      }
      continue;
    }

    if(id === 'plasma'){
      w.extra.tick = (w.extra.tick || 0) - dt;
      if(w.extra.tick <= 0){
        w.extra.tick = lvl.tick * p.cdMul;
        const r2 = lvl.radius * lvl.radius;
        for(const e of S.enemies){
          const dx = e.x - p.x, dy = e.y - p.y;
          if(dx*dx + dy*dy < r2) damage(e, lvl.dmg * p.dmgMul);
        }
      }
      continue;
    }

    if(p.moving) continue;

    w.t -= dt;
    if(w.t <= 0){
      w.t = (lvl.cd || 1) * p.cdMul;
      fireWeapon(id, lvl);
    }
  }
}

function fireWeapon(id, lvl){
  const p = S.player;

  if(id === 'photon'){
    const base = Math.atan2(p.aim.y, p.aim.x);
    const spread = Math.min(0.9, 0.16 * (lvl.n - 1));
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'photon', x:p.x, y:p.y,
        vx:Math.cos(a)*lvl.spd, vy:Math.sin(a)*lvl.spd,
        dmg:lvl.dmg * p.dmgMul, pr:lvl.pr,
        life:1.4, sz:lvl.sz, col:'#7ad6ff', hits:{},
        gravity:true
      });
    }
    throttledSfx('shoot', 0.05);
    return;
  }

  if(id === 'missile'){
    const base = Math.atan2(p.aim.y, p.aim.x);
    const spread = 0.6;
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'missile', x:p.x, y:p.y,
        vx:Math.cos(a)*lvl.spd*0.5, vy:Math.sin(a)*lvl.spd*0.5,
        dmg:lvl.dmg * p.dmgMul,
        life:lvl.life, sz:lvl.sz, col:'#ff9e66',
        spd:lvl.spd, target:null,
        gravity:true
      });
    }
    throttledSfx('missile', 0.08);
    return;
  }

  if(id === 'railgun'){
    const base = Math.atan2(p.aim.y, p.aim.x);
    const spread = Math.min(0.5, 0.12 * (lvl.n - 1));
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'railgun', x:p.x, y:p.y,
        vx:Math.cos(a)*lvl.spd, vy:Math.sin(a)*lvl.spd,
        dmg:lvl.dmg * p.dmgMul, pr:lvl.pr,
        life:lvl.life, sz:lvl.sz, col:'#ffde66', hits:{},
        gravity:true
      });
    }
    throttledSfx('railgun', 0.08);
    return;
  }

  if(id === 'nova'){
    S.projectiles.push({
      type:'nova', x:p.x, y:p.y, vx:0, vy:0,
      dmg:lvl.dmg * p.dmgMul, radius:0, maxR:lvl.radius,
      life:0.45, col:'#b27aff', hits:{},
      gravity:false
    });
    S.shake = Math.max(S.shake, 6);
    sfx.nova();
    return;
  }
}

// ---------- Projectiles ----------
function updateProjectiles(dt){
  const ps = S.projectiles;
  for(let i=ps.length-1;i>=0;i--){
    const p = ps[i];
    p.life -= dt;

    // Apply gravity to affected projectiles
    if(p.gravity) applyGravity(p, dt);

    if(p.type === 'photon' || p.type === 'railgun'){
      p.x += p.vx*dt; p.y += p.vy*dt;
      // Planet collision (cover)
      let absorbed = false;
      for(const b of S.bodies){
        const dx = p.x - b.x, dy = p.y - b.y;
        if(dx*dx + dy*dy < b.r*b.r){
          absorbed = true;
          burst(p.x, p.y, p.col, 3);
          break;
        }
      }
      if(absorbed){ p.life = 0; }
      else {
        for(const e of S.enemies){
          if(p.hits[e.id]) continue;
          const dx = e.x - p.x, dy = e.y - p.y;
          const rr = (e.r + p.sz);
          if(dx*dx + dy*dy < rr*rr){
            p.hits[e.id] = 1;
            damage(e, p.dmg);
            p.pr--;
            if(p.pr <= 0){ p.life = 0; break; }
          }
        }
      }
    }

    else if(p.type === 'missile'){
      if(!p.target || p.target.hp <= 0){
        let best = null, bd = 1e9;
        for(const e of S.enemies){
          const d = (e.x-p.x)*(e.x-p.x) + (e.y-p.y)*(e.y-p.y);
          if(d < bd){ bd = d; best = e; }
        }
        p.target = best;
      }
      if(p.target){
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        p.vx = p.vx * 0.88 + (dx/d) * p.spd * 0.14;
        p.vy = p.vy * 0.88 + (dy/d) * p.spd * 0.14;
        const m = Math.hypot(p.vx, p.vy);
        if(m > p.spd){ p.vx *= p.spd/m; p.vy *= p.spd/m; }
      }
      p.x += p.vx*dt; p.y += p.vy*dt;
      // Planet collision
      let absorbed = false;
      for(const b of S.bodies){
        const dx = p.x - b.x, dy = p.y - b.y;
        if(dx*dx + dy*dy < b.r*b.r){
          absorbed = true;
          burst(p.x, p.y, p.col, 3);
          break;
        }
      }
      if(absorbed){ p.life = 0; }
      else {
        for(const e of S.enemies){
          const dx = e.x - p.x, dy = e.y - p.y;
          const rr = (e.r + p.sz);
          if(dx*dx + dy*dy < rr*rr){
            damage(e, p.dmg);
            p.life = 0;
            break;
          }
        }
      }
    }

    else if(p.type === 'nova'){
      p.radius += p.maxR * dt / 0.45;
      const r2 = p.radius * p.radius;
      for(const e of S.enemies){
        if(p.hits[e.id]) continue;
        const dx = e.x - p.x, dy = e.y - p.y;
        const d2 = dx*dx + dy*dy;
        if(d2 < r2){
          p.hits[e.id] = 1;
          damage(e, p.dmg);
          const d = Math.sqrt(d2) + 1e-3;
          e.vx = (e.vx||0) + (dx/d) * 280;
          e.vy = (e.vy||0) + (dy/d) * 280;
        }
      }
    }

    else if(p.type === 'enemy'){
      if(p.gravity) applyGravity(p, dt);
      p.x += p.vx*dt; p.y += p.vy*dt;
      // Planet blocks enemy projectiles (cover!)
      let absorbed = false;
      for(const b of S.bodies){
        const dx = p.x - b.x, dy = p.y - b.y;
        if(dx*dx + dy*dy < b.r*b.r){
          absorbed = true;
          break;
        }
      }
      if(absorbed){ p.life = 0; }
      else {
        const pl = S.player;
        const dx = pl.x - p.x, dy = pl.y - p.y;
        if(dx*dx + dy*dy < (pl.r + p.sz) * (pl.r + p.sz)){
          if(pl.invuln <= 0){
            const d = Math.max(1, Math.round(p.dmg - pl.armor));
            pl.hp -= d;
            pl.invuln = 0.6;
            popup('-' + d, pl.x, pl.y - 22, '#ff6680');
            S.flash = 0.2;
            throttledSfx('playerHit', 0.2);
          }
          p.life = 0;
        }
      }
    }

    if(p.life <= 0) ps.splice(i, 1);
  }
}

// ---------- Enemies ----------
function spawnEnemy(type){
  const p = S.player;
  const base = ENEMIES[type];
  const a = Math.random() * Math.PI * 2;
  const r = Math.max(W, H) * 0.62 + 60;
  const room = S.room || 1;
  const hpScale = 1 + (room - 1) * 0.16;
  const dmgScale = 1 + (room - 1) * 0.07;
  const spdScale = 1 + (room - 1) * 0.014;
  const e = {
    id: ENEMY_ID++,
    type,
    x: p.x + Math.cos(a) * r,
    y: p.y + Math.sin(a) * r,
    vx: 0, vy: 0,
    r: base.r,
    hp: Math.round(base.hp * hpScale),
    hpMax: 0,
    spd: Math.round(base.spd * spdScale),
    dmg: Math.round(base.dmg * dmgScale),
    col: base.col,
    xp: base.xp,
    gold: base.gold,
    ranged: !!base.ranged,
    explode: !!base.explode,
    boss: !!base.boss,
    kx: 0, ky: 0,
    hitFlash: 0,
    shootT: base.ranged ? 1.2 + Math.random()*1.4 : 0,
    crashCD: 0,
  };
  e.hpMax = e.hp;
  S.enemies.push(e);
  return e;
}

// --- Boss attack execution ---
function bossAttack(e, p){
  const type = e.bossType;
  if(type === 'charger'){
    e.chargeX = p.x; e.chargeY = p.y;
    e.bossPhase = 'charging';
    e.bossTimer = 0.65;
    sfx.boss();
  } else if(type === 'spreader'){
    const n = 10 + ((S.room / 5) | 0) * 2;
    for(let k = 0; k < n; k++){
      const a = (k / n) * Math.PI * 2;
      S.projectiles.push({
        type:'enemy', x:e.x, y:e.y,
        vx:Math.cos(a)*210, vy:Math.sin(a)*210,
        dmg:Math.round(e.dmg*0.5), life:2.4, sz:7, col:'#ff4466',
        gravity:true
      });
    }
    S.shake = Math.max(S.shake, 8);
    sfx.explode();
    e.bossPhase = 'recovering';
    e.bossTimer = 1.4;
  } else if(type === 'summoner'){
    const count = 2 + Math.min(3, ((S.room / 10) | 0));
    const pool = S.sector.pool;
    for(let k = 0; k < count; k++){
      const t = pool[(Math.random() * pool.length) | 0];
      const ne = spawnEnemy(t);
      ne.x = e.x + (Math.random()-0.5) * 80;
      ne.y = e.y + (Math.random()-0.5) * 80;
    }
    sfx.boss();
    e.bossPhase = 'recovering';
    e.bossTimer = 2.2;
  }
}

function updateEnemies(dt){
  const p = S.player;
  const ar = S.arena;
  for(let i=S.enemies.length-1;i>=0;i--){
    const e = S.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
    e.crashCD = Math.max(0, (e.crashCD || 0) - dt);

    let dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) + 1e-3;
    dx /= d; dy /= d;

    let mx = dx, my = dy, moveSpd = e.spd;

    // --- Boss AI ---
    if(e.boss && e.bossType){
      e.bossTimer -= dt;
      if(e.bossPhase === 'chase'){
        if(e.bossTimer <= 0){
          e.bossPhase = 'telegraph';
          e.bossTimer = 0.65;
          e.telegraphT = 0;
          e.chargeX = p.x; e.chargeY = p.y;
        }
      } else if(e.bossPhase === 'telegraph'){
        e.telegraphT += dt;
        moveSpd = 0;
        if(e.bossTimer <= 0) bossAttack(e, p);
      } else if(e.bossPhase === 'charging'){
        const cdx = e.chargeX - e.x, cdy = e.chargeY - e.y;
        const cd = Math.hypot(cdx, cdy) + 1e-3;
        mx = cdx / cd; my = cdy / cd;
        moveSpd = e.spd * 4.5;
        if(cd < 40 || e.bossTimer <= 0){
          e.bossPhase = 'chase';
          e.bossTimer = 1.5 + Math.random() * 1.0;
          S.shake = Math.max(S.shake, 7);
        }
      } else if(e.bossPhase === 'recovering'){
        moveSpd = e.spd * 0.3;
        if(e.bossTimer <= 0){
          e.bossPhase = 'chase';
          e.bossTimer = 1.5 + Math.random() * 1.0;
        }
      }
      if(e.hp < e.hpMax * 0.4 && !e.enraged){
        e.enraged = true;
        e.spd = Math.round(e.spd * 1.35);
        S.shake = Math.max(S.shake, 8);
        popup('ENRAGED', e.x, e.y - e.r - 16, '#ff4466');
      }
    }

    // Planet avoidance - smart steering around gravity bodies
    let avoidX = 0, avoidY = 0;
    if(!(e.boss && e.bossPhase === 'charging')){
      for(const b of S.bodies){
        const bdx = e.x - b.x, bdy = e.y - b.y;
        const bd = Math.hypot(bdx, bdy) + 1e-3;
        const safeR = b.r + e.r + 140;
        if(bd < safeR){
          const proximity = 1 - bd / safeR;
          const gravForce = b.mass / (bd * bd);
          const steerStr = proximity * moveSpd * 8;
          const pushForce = gravForce + steerStr;
          avoidX += (bdx / bd) * pushForce;
          avoidY += (bdy / bd) * pushForce;
          const cross = bdx * my - bdy * mx;
          const perpDir = cross > 0 ? 1 : -1;
          avoidX += (-bdy / bd) * perpDir * steerStr * 0.6;
          avoidY += (bdx / bd) * perpDir * steerStr * 0.6;
        }
      }
    }

    // Velocity-based movement with gravity + avoidance
    const chaseForce = moveSpd * 3.5;
    e.vx += (mx * chaseForce + avoidX) * dt;
    e.vy += (my * chaseForce + avoidY) * dt;

    applyGravity(e, dt);

    // Clamp enemy speed
    const maxESpd = moveSpd * 1.8;
    const evm = Math.hypot(e.vx, e.vy);
    if(evm > maxESpd){ e.vx *= maxESpd / evm; e.vy *= maxESpd / evm; }

    // Drag
    e.vx *= 0.96;
    e.vy *= 0.96;

    e.x += e.vx * dt + e.kx * dt;
    e.y += e.vy * dt + e.ky * dt;
    e.kx *= 0.85; e.ky *= 0.85;

    // Resolve planet collisions
    resolveBodyCollision(e);
    checkCrashBurnEnemy(e);

    if(e.ranged){
      e.shootT -= dt;
      if(e.shootT <= 0 && d < 520){
        e.shootT = rand(1.8, 2.8);
        // Check line of sight (cover system)
        if(!lineHitsBody(e.x, e.y, p.x, p.y)){
          S.projectiles.push({
            type:'enemy', x:e.x, y:e.y,
            vx:dx * 210, vy:dy * 210,
            dmg:e.dmg, life:4, sz:6, col:'#66ffcc',
            gravity:true
          });
        }
      }
    }

    // Contact with player
    if(d < e.r + p.r){
      if(p.invuln <= 0){
        let contactDmg = e.dmg;
        if(e.boss && e.bossPhase === 'charging') contactDmg = Math.round(e.dmg * 2);
        const dmgTaken = Math.max(1, Math.round(contactDmg - p.armor));
        p.hp -= dmgTaken;
        p.invuln = 0.6;
        S.shake = Math.max(S.shake, 5);
        S.flash = 0.22;
        popup('-' + dmgTaken, p.x, p.y - 22, '#ff6680');
        throttledSfx('playerHit', 0.2);
      }
      if(e.explode){
        e.hp = 0;
        burst(e.x, e.y, '#ffde66', 18);
        S.shake = Math.max(S.shake, 5);
        throttledSfx('explode', 0.08);
      }
    }

    if(e.hp <= 0){
      S.kills++;
      const g = Math.round(e.gold * (1 + metaBonus('goldMul')) * p.lootMul);
      S.runGold += g;
      S.pickups.push({
        x:e.x, y:e.y,
        vx:(Math.random()-0.5)*60, vy:(Math.random()-0.5)*60,
        type:'xp', val:e.xp
      });
      burst(e.x, e.y, e.col, e.boss ? 40 : 8);
      if(e.boss){ S.shake = Math.max(S.shake, 14); }
      throttledSfx('kill', 0.04);
      S.enemies.splice(i, 1);
    }
  }
}

// ---------- Pickups ----------
function updatePickups(dt){
  const p = S.player;
  const mag = 90 * p.magMul;
  for(let i=S.pickups.length-1;i>=0;i--){
    const k = S.pickups[i];
    k.x += k.vx * dt; k.y += k.vy * dt;
    k.vx *= 0.9; k.vy *= 0.9;
    const dx = p.x - k.x, dy = p.y - k.y;
    const d = Math.hypot(dx, dy) + 1e-3;
    if(d < mag){
      const f = 520;
      k.vx += (dx/d) * f * dt;
      k.vy += (dy/d) * f * dt;
    }
    if(d < p.r + 8){
      if(k.type === 'xp'){
        const amt = k.val * (1 + metaBonus('xpMul')) * p.lootMul;
        gainXp(amt);
      }
      throttledSfx('pickup', 0.03);
      S.pickups.splice(i, 1);
    }
  }
}
