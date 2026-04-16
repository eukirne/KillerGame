// ============================================================
// audio.js — procedural sound effects via Web Audio API
// ============================================================

let audioCtx = null;
let audioMuted = false;
const audioVol = 1.0;
const sfxLastT = {};

function initAudio(){
  if(audioCtx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({latencyHint: 'interactive', sampleRate: 44100});
    if(audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e){}
}

function resumeAudio(){
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// --- Shared noise buffer (pre-generated on first use) ---
let noiseBuf = null;
function getNoiseBuf(){
  if(noiseBuf) return noiseBuf;
  const len = audioCtx.sampleRate; // 1 second of noise
  noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
  return noiseBuf;
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
  osc.start();
  osc.stop(t + dur);
}

function playNoise(dur, vol){
  if(!audioCtx || audioMuted) return;
  const t = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuf();
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime((vol || 0.1) * audioVol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(gain).connect(audioCtx.destination);
  src.start(0, 0, dur);
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
    playTone(880, 0.08, 'square', 0.25);
  },
  seekerShoot(){
    playTone(660, 0.1, 'sawtooth', 0.2, 440);
  },
  hit(){
    playNoise(0.05, 0.2);
    playTone(220, 0.05, 'square', 0.15);
  },
  kill(){
    playTone(500, 0.1, 'square', 0.25, 260);
    playNoise(0.07, 0.18);
  },
  playerHit(){
    playNoise(0.12, 0.4);
    playTone(110, 0.15, 'sawtooth', 0.3, 55);
  },
  pickup(){
    playTone(1200, 0.06, 'sine', 0.18, 1600);
  },
  levelUp(){
    playTone(523, 0.1, 'square', 0.3);
    setTimeout(() => playTone(659, 0.1, 'square', 0.3), 80);
    setTimeout(() => playTone(784, 0.14, 'square', 0.35), 160);
  },
  roomClear(){
    playTone(440, 0.1, 'square', 0.25);
    setTimeout(() => playTone(554, 0.1, 'square', 0.25), 100);
    setTimeout(() => playTone(659, 0.1, 'square', 0.25), 200);
    setTimeout(() => playTone(880, 0.2, 'square', 0.35), 300);
  },
  boss(){
    playTone(75, 0.4, 'sawtooth', 0.4, 38);
    playNoise(0.3, 0.35);
  },
  nova(){
    playNoise(0.18, 0.35);
    playTone(190, 0.22, 'sine', 0.25, 70);
  },
  thunder(){
    playNoise(0.12, 0.4);
    playTone(100, 0.14, 'square', 0.3, 900);
  },
  tap(){
    playTone(1100, 0.05, 'square', 0.2);
  },
  explode(){
    playNoise(0.18, 0.45);
    playTone(80, 0.2, 'square', 0.25, 30);
  },
};
