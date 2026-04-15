// ============================================================
// entities.js — player, enemies, weapons, projectiles, pickups
// ============================================================

let ENEMY_ID = 1;

// ---------- Player ----------
function makePlayer(){
  return {
    x:0, y:0, r:16,
    hp:100, maxHp:100,
    baseSpd:520,             // horizontal slide speed (px/s)
    dmgMul:1, spdMul:1, cdMul:1, magMul:1, lootMul:1,
    armor:0, regen:0,
    invuln:0,
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

// ---------- Damage dealing ----------
function damage(e, amt){
  if(e.hp <= 0) return;
  const d = Math.round(amt);
  e.hp -= d;
  e.hitFlash = 1;
  popup(d, e.x + (Math.random()-0.5)*10, e.y - e.r - 2, '#ffffff');
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

    if(id === 'aura'){
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

    w.t -= dt;
    if(w.t <= 0){
      w.t = (lvl.cd || 1) * p.cdMul;
      fireWeapon(id, lvl);
    }
  }
}

function fireWeapon(id, lvl){
  const p = S.player;

  if(id === 'shard'){
    // Straight up with a horizontal spread as levels grow.
    const base = -Math.PI / 2;
    const spread = Math.min(0.9, 0.16 * (lvl.n - 1));
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'shard', x:p.x, y:p.y - p.r,
        vx:Math.cos(a)*lvl.spd, vy:Math.sin(a)*lvl.spd,
        dmg:lvl.dmg * p.dmgMul, pr:lvl.pr,
        life:1.6, sz:lvl.sz, col:'#7ad6ff', hits:{}
      });
    }
    return;
  }

  if(id === 'seeker'){
    // Launch upward with fan spread, then home onto targets.
    const base = -Math.PI / 2;
    const spread = 0.7;
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'seeker', x:p.x, y:p.y - p.r,
        vx:Math.cos(a)*lvl.spd*0.55, vy:Math.sin(a)*lvl.spd*0.55,
        dmg:lvl.dmg * p.dmgMul,
        life:lvl.life, sz:lvl.sz, col:'#ff9e66',
        spd:lvl.spd, target:null
      });
    }
    return;
  }

  if(id === 'nova'){
    S.projectiles.push({
      type:'nova', x:p.x, y:p.y, vx:0, vy:0,
      dmg:lvl.dmg * p.dmgMul, radius:0, maxR:lvl.radius,
      life:0.45, col:'#b27aff', hits:{}
    });
    S.shake = Math.max(S.shake, 6);
    return;
  }

  if(id === 'thunder'){
    for(let i=0;i<lvl.n;i++){
      const cands = S.enemies.filter(e =>
        (e.x-p.x)*(e.x-p.x) + (e.y-p.y)*(e.y-p.y) < 520*520);
      if(!cands.length) break;
      const e = cands[(Math.random() * cands.length) | 0];
      S.projectiles.push({
        type:'thunder', x:e.x, y:e.y,
        dmg:lvl.dmg * p.dmgMul,
        life:0.25, sz:lvl.radius, col:'#ffde66',
        target:e, hit:false
      });
    }
    return;
  }
}

// ---------- Projectiles ----------
function updateProjectiles(dt){
  const ps = S.projectiles;
  for(let i=ps.length-1;i>=0;i--){
    const p = ps[i];
    p.life -= dt;

    if(p.type === 'shard'){
      p.x += p.vx*dt; p.y += p.vy*dt;
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

    else if(p.type === 'seeker'){
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
          e.kx = (dx/d) * 280;
          e.ky = (dy/d) * 280;
        }
      }
    }

    else if(p.type === 'thunder'){
      if(!p.hit && p.life < 0.2){
        p.hit = true;
        if(p.target && p.target.hp > 0){
          damage(p.target, p.dmg);
          burst(p.target.x, p.target.y, '#ffde66', 10);
        }
      }
    }

    else if(p.type === 'enemy'){
      p.x += p.vx*dt; p.y += p.vy*dt;
      const pl = S.player;
      const dx = pl.x - p.x, dy = pl.y - p.y;
      if(dx*dx + dy*dy < (pl.r + p.sz) * (pl.r + p.sz)){
        if(pl.invuln <= 0){
          const d = Math.max(1, Math.round(p.dmg - pl.armor));
          pl.hp -= d;
          pl.invuln = 0.6;
          popup('-' + d, pl.x, pl.y - 22, '#ff6680');
          S.flash = 0.2;
        }
        p.life = 0;
      }
    }

    if(p.life <= 0) ps.splice(i, 1);
  }
}

// ---------- Enemies ----------
function spawnEnemy(type, xOverride){
  const base = ENEMIES[type];
  const mins = S.t / 60;
  const hpScale = 1 + mins * 0.38;
  const dmgScale = 1 + mins * 0.14;
  const margin = base.r + 20;
  const x = xOverride != null ? xOverride : rand(margin, Math.max(margin + 1, W - margin));
  const e = {
    id: ENEMY_ID++,
    type,
    x,
    y: -base.r - 10,
    r: base.r,
    hp: Math.round(base.hp * hpScale),
    hpMax: 0,
    spd: base.spd,
    dmg: Math.round(base.dmg * dmgScale),
    col: base.col,
    xp: base.xp,
    gold: base.gold,
    ranged: !!base.ranged,
    explode: !!base.explode,
    boss: !!base.boss,
    drift: (Math.random() - 0.5) * 2,   // -1..1 horizontal drift
    driftT: rand(0.6, 1.6),
    kx: 0, ky: 0,
    hitFlash: 0,
    shootT: base.ranged ? 1.0 + Math.random()*1.2 : 0,
  };
  e.hpMax = e.hp;
  S.enemies.push(e);
  return e;
}

function updateEnemies(dt){
  const p = S.player;
  for(let i=S.enemies.length-1;i>=0;i--){
    const e = S.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

    // Downward drift with some zigzag for variety.
    e.driftT -= dt;
    if(e.driftT <= 0){
      e.driftT = rand(0.6, 1.6);
      e.drift = (Math.random() - 0.5) * 2;
    }
    const vy = e.spd;
    const vx = e.drift * e.spd * 0.35;
    e.x += vx * dt + e.kx * dt;
    e.y += vy * dt + e.ky * dt;
    e.kx *= 0.85; e.ky *= 0.85;

    // Clamp horizontally and bounce drift off the walls.
    if(e.x < e.r + 4){ e.x = e.r + 4; e.drift = Math.abs(e.drift); }
    else if(e.x > W - e.r - 4){ e.x = W - e.r - 4; e.drift = -Math.abs(e.drift); }

    // Escaped past the bottom — grazes the player and despawns.
    if(e.y > H + e.r + 40){
      if(!e.boss && p.invuln <= 0){
        const dmgTaken = Math.max(1, Math.round(e.dmg * 0.5 - p.armor));
        if(dmgTaken > 0){
          p.hp -= dmgTaken;
          p.invuln = 0.4;
          popup('-' + dmgTaken, p.x, p.y - 22, '#ff6680');
          S.flash = 0.15;
        }
      }
      if(e.boss){
        // Bosses don't leave — wrap back up.
        e.y = -e.r - 20;
        e.x = clamp(e.x, e.r + 20, W - e.r - 20);
      } else {
        S.enemies.splice(i, 1);
        continue;
      }
    }

    if(e.ranged){
      e.shootT -= dt;
      if(e.shootT <= 0 && e.y > -10 && e.y < H){
        e.shootT = rand(1.8, 2.8);
        // Aim at the player, biased toward straight down.
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        S.projectiles.push({
          type:'enemy', x:e.x, y:e.y + e.r,
          vx:(dx/d) * 220, vy:(dy/d) * 220,
          dmg:e.dmg, life:4, sz:6, col:'#66ffcc'
        });
      }
    }

    // Contact with player.
    const ddx = p.x - e.x, ddy = p.y - e.y;
    if(ddx*ddx + ddy*ddy < (e.r + p.r) * (e.r + p.r)){
      if(p.invuln <= 0){
        const dmgTaken = Math.max(1, Math.round(e.dmg - p.armor));
        p.hp -= dmgTaken;
        p.invuln = 0.6;
        S.shake = Math.max(S.shake, 5);
        S.flash = 0.22;
        popup('-' + dmgTaken, p.x, p.y - 22, '#ff6680');
      }
      if(e.explode){
        e.hp = 0;
        burst(e.x, e.y, '#ffde66', 18);
        S.shake = Math.max(S.shake, 5);
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
      S.enemies.splice(i, 1);
    }
  }
}

// ---------- Pickups ----------
function updatePickups(dt){
  const p = S.player;
  const mag = 110 * p.magMul;
  for(let i=S.pickups.length-1;i>=0;i--){
    const k = S.pickups[i];
    // Gentle gravity so pickups drift toward the player's lane.
    k.vy += 180 * dt;
    k.vx *= 0.985;
    k.x += k.vx * dt;
    k.y += k.vy * dt;

    const dx = p.x - k.x, dy = p.y - k.y;
    const d = Math.hypot(dx, dy) + 1e-3;
    if(d < mag){
      const f = 820;
      k.vx += (dx/d) * f * dt;
      k.vy += (dy/d) * f * dt;
    }
    if(d < p.r + 9){
      if(k.type === 'xp'){
        const amt = k.val * (1 + metaBonus('xpMul')) * p.lootMul;
        gainXp(amt);
      }
      S.pickups.splice(i, 1);
      continue;
    }
    // Off the bottom of the screen — gone.
    if(k.y > H + 40){
      S.pickups.splice(i, 1);
    }
  }
}
