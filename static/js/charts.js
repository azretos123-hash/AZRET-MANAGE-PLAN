/* ==========================================================================
   YARIN يارين — Mini Charts
   A tiny, dependency-free canvas charting helper so the dashboard renders
   fully offline (no CDN / external library required for the PWA).
   ========================================================================== */

const AzretCharts = (function () {

  function getColors() {
    const dark = document.body.getAttribute('data-theme') === 'dark';
    return {
      grid: dark ? 'rgba(232,169,127,0.15)' : 'rgba(138,122,108,0.12)',
      text: dark ? '#C9A98F' : '#8A7A6C',
      blue: '#FF8A3D',
      blueDark: '#B84D02',
      success: '#16B356',
      danger: '#E5484D',
      palette: ['#FF8A3D', '#B84D02', '#16B356', '#F5A524', '#E5484D', '#A89684', '#2B1204', '#3FE28A'],
    };
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.parentElement.clientWidth || 400;
    // Use the rendered CSS height first. Setting canvas.height below changes the
    // HTML backing-store attribute, so reading that attribute on the next draw
    // used to multiply the logical height by devicePixelRatio over and over.
    // That made charts grow/distort after refreshes on high-DPI/mobile screens.
    const attrH = parseInt(canvas.getAttribute('height'), 10) || 220;
    const h = rect.height || attrH;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawEmpty(ctx, w, h, colors, msg) {
    ctx.fillStyle = colors.text;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg || 'No data yet', w / 2, h / 2);
  }

  function lineChart(canvasId, labels, series) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const colors = getColors();
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 44, r: 16, t: 16, b: 28 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const allVals = series.flatMap(s => s.data);
    const maxVal = Math.max(...allVals, 1) * 1.15;

    // grid lines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = pad.t + (plotH / steps) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      const val = maxVal - (maxVal / steps) * i;
      ctx.fillStyle = colors.text;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatShort(val), pad.l - 8, y + 3);
    }

    if (allVals.every(v => v === 0)) {
      drawEmpty(ctx, w, h, colors);
      return;
    }

    const stepX = labels.length > 1 ? plotW / (labels.length - 1) : 0;

    series.forEach((s, si) => {
      ctx.beginPath();
      s.data.forEach((val, i) => {
        const x = pad.l + stepX * i;
        const y = pad.t + plotH - (val / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color || colors.palette[si % colors.palette.length];
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // fill under first series
      if (si === 0) {
        const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
        grad.addColorStop(0, hexAlpha(s.color || colors.blue, 0.28));
        grad.addColorStop(1, hexAlpha(s.color || colors.blue, 0.02));
        ctx.lineTo(pad.l + stepX * (labels.length - 1), pad.t + plotH);
        ctx.lineTo(pad.l, pad.t + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // points
      s.data.forEach((val, i) => {
        const x = pad.l + stepX * i;
        const y = pad.t + plotH - (val / maxVal) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = s.color || colors.palette[si % colors.palette.length];
        ctx.fill();
      });
    });

    // x labels — keep them readable on dense/mobile charts.  Older builds
    // drew every timestamp, which caused the Gold Saver labels to overlap
    // into one unreadable line.  Pick evenly-spaced representative labels
    // based on the actual rendered width, while always keeping first/last.
    ctx.fillStyle = colors.text;
    ctx.font = (w < 520 ? '9px' : '10px') + ' sans-serif';
    ctx.textAlign = 'center';
    if (labels.length) {
      const maxVisible = Math.max(2, Math.floor(plotW / (w < 520 ? 64 : 78)));
      const visibleCount = Math.min(labels.length, maxVisible);
      const indexes = new Set();
      if (visibleCount === 1) {
        indexes.add(0);
      } else {
        for (let j = 0; j < visibleCount; j++) {
          indexes.add(Math.round(j * (labels.length - 1) / (visibleCount - 1)));
        }
      }
      indexes.forEach(i => {
        const x = pad.l + stepX * i;
        ctx.fillText(labels[i], x, h - 8);
      });
    }
  }

  function barChart(canvasId, labels, series) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const colors = getColors();
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 44, r: 16, t: 16, b: 28 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const allVals = series.flatMap(s => s.data);
    const maxVal = Math.max(...allVals, 1) * 1.2;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = pad.t + (plotH / steps) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      const val = maxVal - (maxVal / steps) * i;
      ctx.fillStyle = colors.text;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatShort(val), pad.l - 8, y + 3);
    }

    if (allVals.every(v => v === 0)) {
      drawEmpty(ctx, w, h, colors);
      return;
    }

    const groupW = plotW / labels.length;
    const barW = Math.min(18, (groupW * 0.6) / series.length);
    const gap = 6;

    labels.forEach((lab, li) => {
      const groupX = pad.l + groupW * li + groupW / 2;
      const totalW = series.length * barW + (series.length - 1) * gap;
      let startX = groupX - totalW / 2;

      series.forEach((s, si) => {
        const val = s.data[li] || 0;
        const barH = (val / maxVal) * plotH;
        const x = startX + si * (barW + gap);
        const y = pad.t + plotH - barH;
        const color = s.color || colors.palette[si % colors.palette.length];
        roundRect(ctx, x, y, barW, barH, 4);
        ctx.fillStyle = color;
        ctx.fill();
      });

      ctx.fillStyle = colors.text;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lab, groupX, h - 8);
    });
  }

  function donutChart(canvasId, labels, values) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const colors = getColors();
    ctx.clearRect(0, 0, w, h);

    const total = values.reduce((a, b) => a + b, 0);
    const cx = w * 0.32, cy = h / 2, r = Math.min(cx, cy) - 10, rInner = r * 0.6;

    if (total <= 0) {
      drawEmpty(ctx, w, h, colors);
      return;
    }

    let start = -Math.PI / 2;
    values.forEach((val, i) => {
      const slice = (val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = colors.palette[i % colors.palette.length];
      ctx.fill();
      start += slice;
    });

    // inner cutout for donut
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // legend
    const legendX = w * 0.58;
    let legendY = 20;
    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    labels.forEach((lab, i) => {
      if (legendY > h - 12) return;
      ctx.fillStyle = colors.palette[i % colors.palette.length];
      roundRect(ctx, legendX, legendY - 8, 10, 10, 2);
      ctx.fill();
      ctx.fillStyle = colors.text;
      const pct = total ? Math.round((values[i] / total) * 100) : 0;
      ctx.fillText(`${truncate(lab, 12)} (${pct}%)`, legendX + 16, legendY + 1);
      legendY += 20;
    });
  }

  /** Standalone pie chart (full slices, no donut cutout) with a right-hand
   *  legend — used by the Smart Salary Planner allocation breakdown. Fully
   *  offline / dependency-free, same as the other canvas charts here. */
  function pieChart(canvasId, labels, values) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const colors = getColors();
    ctx.clearRect(0, 0, w, h);

    const total = values.reduce((a, b) => a + b, 0);
    const cx = w * 0.32, cy = h / 2, r = Math.min(cx, cy) - 10;

    if (total <= 0) {
      drawEmpty(ctx, w, h, colors);
      return;
    }

    const strokeColor = document.body.getAttribute('data-theme') === 'dark' ? '#1A0D04' : '#FFFFFF';

    let start = -Math.PI / 2;
    values.forEach((val, i) => {
      const slice = (val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = colors.palette[i % colors.palette.length];
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      start += slice;
    });

    // legend
    const legendX = w * 0.58;
    let legendY = 18;
    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    labels.forEach((lab, i) => {
      if (legendY > h - 12) return;
      ctx.fillStyle = colors.palette[i % colors.palette.length];
      roundRect(ctx, legendX, legendY - 8, 10, 10, 2);
      ctx.fill();
      ctx.fillStyle = colors.text;
      const pct = total ? Math.round((values[i] / total) * 100) : 0;
      ctx.fillText(`${truncate(lab, 15)} (${pct}%)`, legendX + 16, legendY + 1);
      legendY += 20;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < 0) { y += h; h = Math.abs(h); }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function formatShort(val) {
    if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'k';
    return Math.round(val).toString();
  }

  function truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : (str || '');
  }

  function hexAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return { lineChart, barChart, donutChart, pieChart };
})();
