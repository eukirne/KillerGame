// ============================================================
// audio.js — procedural sound effects via Web Audio API
// ============================================================

let audioCtx = null;
let audioMuted = false;
const audioVol = 0.35;
const sfxLastT = {};

function initAudio(){
  if(audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e){}
}

function resumeAudio(){
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// --- Primitives ---

function playTone(freq, dur, type, vol, endFreq){
  if(!audioCtx || audioMuted) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t);
  if(endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  gain.gain.setValueAtTime((vol || 0.15) * audioVol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function playNoise(dur, vol){
  if(!audioCtx || audioMuted) return;
  const t = audioCtx.currentTime;
  const len = Math.max(1, (audioCtx.sampleRate * dur) | 0);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime((vol || 0.1) * audioVol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(gain).connect(audioCtx.destination);
  src.start(t);
}

// --- Throttle helper ---

function throttledSfx(name, minGap){
  if(!audioCtx) return;
  const now = audioCtx.currentTime;
  if(now - (sfxLastT[name] || 0) < minGap) return;
  sfxLastT[name] = now;
  sfx[name]();
}

// --- Sound effects ---

const sfx = {
  shoot(){
    playTone(880, 0.07, 'square', 0.1);
  },
  seekerShoot(){
    playTone(660, 0.09, 'sawtooth', 0.08, 440);
  },
  hit(){
    playNoise(0.04, 0.1);
    playTone(220, 0.04, 'square', 0.06);
  },
  kill(){
    playTone(500, 0.09, 'square', 0.1, 260);
    playNoise(0.06, 0.08);
  },
  playerHit(){
    playNoise(0.1, 0.2);
    playTone(110, 0.12, 'sawtooth', 0.12, 55);
  },
  pickup(){
    playTone(1200, 0.05, 'sine', 0.06, 1600);
  },
  levelUp(){
    playTone(523, 0.08, 'square', 0.12);
    setTimeout(() => playTone(659, 0.08, 'square', 0.12), 70);
    setTimeout(() => playTone(784, 0.12, 'square', 0.15), 140);
  },
  roomClear(){
    playTone(440, 0.08, 'square', 0.1);
    setTimeout(() => playTone(554, 0.08, 'square', 0.1), 90);
    setTimeout(() => playTone(659, 0.08, 'square', 0.1), 180);
    setTimeout(() => playTone(880, 0.18, 'square', 0.15), 270);
  },
  boss(){
    playTone(75, 0.35, 'sawtooth', 0.2, 38);
    playNoise(0.25, 0.15);
  },
  nova(){
    playNoise(0.15, 0.18);
    playTone(190, 0.2, 'sine', 0.12, 70);
  },
  thunder(){
    playNoise(0.1, 0.22);
    playTone(100, 0.12, 'square', 0.15, 900);
  },
  tap(){
    playTone(1100, 0.04, 'square', 0.08);
  },
  explode(){
    playNoise(0.15, 0.25);
    playTone(80, 0.18, 'square', 0.12, 30);
  },
};
