// ============================================================
// entities.js — player, enemies, weapons, projectiles, pickups
// ============================================================

let ENEMY_ID = 1;

// ---------- Player ----------
function makePlayer(){
  return {
    x:0, y:0, r:12,
    hp:100, maxHp:100,
    baseSpd:180,
    dmgMul:1, spdMul:1, cdMul:1, magMul:1, lootMul:1,
    armor:0, regen:0,
    invuln:0,
    weapons:{},
    passives:{},
    last:{x:1, y:0},
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
    const dir = (p.last.x || p.last.y) ? p.last : {x:1, y:0};
    const base = Math.atan2(dir.y, dir.x);
    const spread = Math.min(0.8, 0.18 * (lvl.n - 1));
    for(let i=0;i<lvl.n;i++){
      const off = lvl.n === 1 ? 0 : (i/(lvl.n-1) - 0.5) * spread * 2;
      const a = base + off;
      S.projectiles.push({
        type:'shard', x:p.x, y:p.y,
        vx:Math.cos(a)*lvl.spd, vy:Math.sin(a)*lvl.spd,
        dmg:lvl.dmg * p.dmgMul, pr:lvl.pr,
        life:1.3, sz:lvl.sz, col:'#7ad6ff', hits:{}
      });
    }
    return;
  }

  if(id === 'seeker'){
    for(let i=0;i<lvl.n;i++){
      const a = Math.random() * Math.PI * 2;
      S.projectiles.push({
        type:'seeker', x:p.x, y:p.y,
        vx:Math.cos(a)*60, vy:Math.sin(a)*60,
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
function spawnEnemy(type){
  const p = S.player;
  const a = Math.random() * Math.PI * 2;
  const r = Math.max(W, H) * 0.65 + 60;
  const base = ENEMIES[type];
  const mins = S.t / 60;
  const hpScale = 1 + mins * 0.38;
  const dmgScale = 1 + mins * 0.14;
  const e = {
    id: ENEMY_ID++,
    type,
    x: p.x + Math.cos(a) * r,
    y: p.y + Math.sin(a) * r,
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
    kx: 0, ky: 0,
    hitFlash: 0,
    shootT: base.ranged ? 1.2 + Math.random()*1.4 : 0,
  };
  e.hpMax = e.hp;
  S.enemies.push(e);
  return e;
}

function updateEnemies(dt){
  const p = S.player;
  const maxD = Math.max(W, H) * 1.6;
  for(let i=S.enemies.length-1;i>=0;i--){
    const e = S.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

    let dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) + 1e-3;

    // Despawn if absurdly far
    if(d > maxD){
      S.enemies.splice(i, 1);
      continue;
    }

    dx /= d; dy /= d;
    e.x += dx * e.spd * dt + e.kx * dt;
    e.y += dy * e.spd * dt + e.ky * dt;
    e.kx *= 0.85; e.ky *= 0.85;

    if(e.ranged){
      e.shootT -= dt;
      if(e.shootT <= 0 && d < 460){
        e.shootT = 2.3;
        S.projectiles.push({
          type:'enemy', x:e.x, y:e.y,
          vx:dx*190, vy:dy*190,
          dmg:e.dmg, life:3, sz:6, col:'#66ffcc'
        });
      }
    }

    if(d < e.r + p.r){
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
  const mag = 72 * p.magMul;
  for(let i=S.pickups.length-1;i>=0;i--){
    const k = S.pickups[i];
    k.x += k.vx*dt; k.y += k.vy*dt;
    k.vx *= 0.9; k.vy *= 0.9;
    const dx = p.x - k.x, dy = p.y - k.y;
    const d = Math.hypot(dx, dy) + 1e-3;
    if(d < mag){
      const f = 460;
      k.vx += (dx/d) * f * dt;
      k.vy += (dy/d) * f * dt;
    }
    if(d < p.r + 7){
      if(k.type === 'xp'){
        const amt = k.val * (1 + metaBonus('xpMul')) * p.lootMul;
        gainXp(amt);
      }
      S.pickups.splice(i, 1);
    }
  }
}
