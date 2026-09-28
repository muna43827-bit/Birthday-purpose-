// js/particles.js
// Lightweight ambient particle field for cinematic backgrounds.
// Respects prefers-reduced-motion by rendering a single static frame.

export function initParticles(canvasId, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const config = {
    count: options.count ?? 42,
    color: options.color ?? "212, 175, 55", // rgb triplet
    maxSize: options.maxSize ?? 2.2,
    speed: options.speed ?? 0.15,
    ...options,
  };

  let particles = [];
  let width, height, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * config.maxSize + 0.4,
      vy: -(Math.random() * config.speed + 0.03),
      vx: (Math.random() - 0.5) * 0.06,
      alpha: Math.random() * 0.5 + 0.15,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: config.count }, makeParticle);
    if (reduceMotion) {
      drawStatic();
    } else {
      requestAnimationFrame(loop);
    }
  }

  function drawStatic() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${config.color}, ${p.alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.y += p.vy;
      p.x += p.vx;
      if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${config.color}, ${p.alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  init();
}
