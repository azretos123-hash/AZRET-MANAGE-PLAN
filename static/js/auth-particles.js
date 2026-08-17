/* YARIN V93 — lightweight cinematic image particles for authentication screens.
   Local, dependency-free Canvas2D implementation inspired by the supplied WebGL concept.
   Desktop gets richer particles and pointer momentum; mobile uses a lower-cost mode. */
(() => {
  'use strict';

  const canvas = document.getElementById('authParticleCanvas');
  const rotator = document.getElementById('authWallpaperRotator');
  if (!canvas || !rotator) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reducedMotion) {
    canvas.hidden = true;
    return;
  }

  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) {
    canvas.hidden = true;
    return;
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
  const cores = Number(navigator.hardwareConcurrency || 8);
  const memory = Number(navigator.deviceMemory || 8);
  const lowPower = Boolean(coarsePointer || cores <= 4 || memory <= 4);

  let width = Math.max(1, window.innerWidth);
  let height = Math.max(1, window.innerHeight);
  let dpr = 1;
  let particles = [];
  let running = true;
  let raf = 0;
  let lastFrame = 0;
  let sourceData = null;
  let sourceW = 0;
  let sourceH = 0;
  let imageLoadToken = 0;

  const pointer = {
    x: -9999,
    y: -9999,
    lastX: -9999,
    lastY: -9999,
    vx: 0,
    vy: 0,
    active: false,
  };

  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  const targetCount = () => {
    const areaFactor = Math.min(1.35, Math.max(0.78, (width * height) / (1440 * 900)));
    const base = lowPower ? 420 : (width < 1100 ? 850 : 1550);
    return Math.max(280, Math.round(base * areaFactor));
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.2 : 1.65);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const wanted = targetCount();
    if (particles.length > wanted) particles.length = wanted;
    while (particles.length < wanted) particles.push(makeParticle(true));
  }

  function sampleColor(x, y) {
    if (!sourceData || !sourceW || !sourceH) {
      return [72, 187, 219];
    }
    const sx = clamp(Math.floor((x / width) * sourceW), 0, sourceW - 1);
    const sy = clamp(Math.floor((y / height) * sourceH), 0, sourceH - 1);
    const idx = (sy * sourceW + sx) * 4;
    return [sourceData[idx], sourceData[idx + 1], sourceData[idx + 2]];
  }

  function makeParticle(randomLife = false) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const maxLife = 90 + Math.random() * 210;
    return {
      x,
      y,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      life: randomLife ? Math.random() * maxLife : 0,
      maxLife,
      seed: Math.random() * Math.PI * 2,
      size: lowPower ? 0.8 + Math.random() * 1.3 : 0.9 + Math.random() * 1.8,
      color: sampleColor(x, y),
    };
  }

  function respawn(p) {
    const edgeBias = Math.random();
    if (edgeBias < 0.18) {
      p.x = Math.random() < 0.5 ? -4 : width + 4;
      p.y = Math.random() * height;
    } else {
      p.x = Math.random() * width;
      p.y = Math.random() * height;
    }
    p.vx = (Math.random() - 0.5) * 0.2;
    p.vy = (Math.random() - 0.5) * 0.2;
    p.life = 0;
    p.maxLife = 90 + Math.random() * 210;
    p.seed = Math.random() * Math.PI * 2;
    p.color = sampleColor(clamp(p.x, 0, width), clamp(p.y, 0, height));
  }

  function activeWallpaperUrl() {
    const slide = rotator.querySelector('.auth-bg-slide-v47.active') || rotator.querySelector('.auth-bg-slide-v47');
    if (!slide) return '';
    const raw = slide.style.backgroundImage || getComputedStyle(slide).backgroundImage || '';
    const match = raw.match(/url\(["']?(.*?)["']?\)/i);
    return match ? match[1] : '';
  }

  function drawImageCover(image) {
    if (!sampleCtx) return;
    const sampleWidth = lowPower ? 72 : 112;
    const sampleHeight = Math.max(42, Math.round(sampleWidth * (height / width)));
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;

    const iw = image.naturalWidth || image.width || 1;
    const ih = image.naturalHeight || image.height || 1;
    const scale = Math.max(sampleWidth / iw, sampleHeight / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (sampleWidth - dw) / 2;
    const dy = (sampleHeight - dh) / 2;

    sampleCtx.clearRect(0, 0, sampleWidth, sampleHeight);
    sampleCtx.drawImage(image, dx, dy, dw, dh);
    try {
      const imageData = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);
      sourceData = imageData.data;
      sourceW = sampleWidth;
      sourceH = sampleHeight;
      particles.forEach((p) => { p.color = sampleColor(p.x, p.y); });
    } catch (_) {
      sourceData = null;
      sourceW = 0;
      sourceH = 0;
    }
  }

  function setImage(url) {
    if (!url) return;
    const token = ++imageLoadToken;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (token !== imageLoadToken) return;
      drawImageCover(img);
    };
    img.onerror = () => {};
    img.src = url;
  }

  function updatePointer(e) {
    if (lowPower) return;
    const x = e.clientX;
    const y = e.clientY;
    if (!pointer.active) {
      pointer.lastX = x;
      pointer.lastY = y;
      pointer.active = true;
    }
    const rawVx = x - pointer.lastX;
    const rawVy = y - pointer.lastY;
    pointer.vx += (rawVx - pointer.vx) * 0.34;
    pointer.vy += (rawVy - pointer.vy) * 0.34;
    pointer.x = x;
    pointer.y = y;
    pointer.lastX = x;
    pointer.lastY = y;
  }

  function clearPointer() {
    pointer.active = false;
    pointer.x = -9999;
    pointer.y = -9999;
    pointer.vx = 0;
    pointer.vy = 0;
  }

  function frame(time) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const frameInterval = lowPower ? 34 : 16;
    if (time - lastFrame < frameInterval) return;
    const dt = Math.min(2.2, Math.max(0.55, (time - lastFrame) / 16.67 || 1));
    lastFrame = time;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'screen';

    const pointerRadius = 190;
    const pointerRadius2 = pointerRadius * pointerRadius;
    const t = time * 0.00011;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life += dt;

      const flow = Math.sin(p.x * 0.0045 + t * 8 + p.seed) + Math.cos(p.y * 0.0038 - t * 6 + p.seed * 0.7);
      const angle = flow * Math.PI;
      p.vx = p.vx * 0.985 + Math.cos(angle) * 0.0065 * dt;
      p.vy = p.vy * 0.985 + Math.sin(angle) * 0.0065 * dt;

      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < pointerRadius2) {
          const proximity = 1 - dist2 / pointerRadius2;
          p.vx += pointer.vx * proximity * 0.017;
          p.vy += pointer.vy * proximity * 0.017;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.life >= p.maxLife || p.x < -24 || p.x > width + 24 || p.y < -24 || p.y > height + 24) {
        respawn(p);
        continue;
      }

      const ratio = p.life / p.maxLife;
      const fadeIn = Math.min(1, ratio / 0.08);
      const fadeOut = ratio > 0.82 ? Math.max(0, (1 - ratio) / 0.18) : 1;
      const alpha = fadeIn * fadeOut * (lowPower ? 0.22 : 0.30);
      const [r, g, b] = p.color;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      const s = p.size * (0.72 + fadeOut * 0.42);
      ctx.fillRect(p.x, p.y, s, s);
    }

    ctx.globalCompositeOperation = 'source-over';
    pointer.vx *= 0.88;
    pointer.vy *= 0.88;
  }

  function onWallpaperChange(event) {
    const url = event?.detail?.url || activeWallpaperUrl();
    setImage(url);
  }

  resize();
  setImage(activeWallpaperUrl());

  window.addEventListener('resize', resize, { passive: true });
  if (!lowPower) {
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('pointerleave', clearPointer, { passive: true });
    window.addEventListener('blur', clearPointer, { passive: true });
  }
  window.addEventListener('yarin:auth-wallpaper', onWallpaperChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    running = true;
    lastFrame = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  });

  running = !document.hidden;
  if (running) raf = requestAnimationFrame(frame);

  window.YarinAuthParticles = {
    setImage,
    refresh: () => setImage(activeWallpaperUrl()),
    destroy: () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', resize);
      window.removeEventListener('yarin:auth-wallpaper', onWallpaperChange);
      if (!lowPower) {
        window.removeEventListener('pointermove', updatePointer);
        window.removeEventListener('pointerleave', clearPointer);
        window.removeEventListener('blur', clearPointer);
      }
      ctx.clearRect(0, 0, width, height);
    },
  };
})();
