// ============================================================
// landing.js — animated background particles for the landing page
// ============================================================

(() => {
  const cv = document.getElementById('bg');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  function resize(){
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width  = Math.floor(W * DPR);
    cv.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const COLORS = ['#3ad1ff', '#ff6680', '#b27aff', '#ffcf66'];
  const parts = [];
  const COUNT = Math.min(70, Math.max(30, Math.floor((W * H) / 22000)));
  for (let i = 0; i < COUNT; i++) {
    parts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: 0.7 + Math.random() * 1.8,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      tw: Math.random() * Math.PI * 2,
    });
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    ctx.clearRect(0, 0, W, H);

    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.tw += dt * 2.4;
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;

      const a = 0.35 + 0.35 * Math.sin(p.tw);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
