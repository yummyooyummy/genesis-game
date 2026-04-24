function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class ShockwaveManager {
  constructor() {
    this.waves = [];
  }

  spawn(x, y, color, opts = {}) {
    const LS = require('./layoutScale');
    const maxLife = opts.maxLife || 10;
    this.waves.push({
      x, y,
      color: color || '#FFD887',
      life: maxLife,
      maxLife,
      startRadius: opts.startRadius || LS.ds(12),
      endRadius: opts.endRadius || LS.ds(54),
    });
  }

  reset() {
    this.waves = [];
  }

  update() {
    for (const w of this.waves) {
      w.life -= 1;
    }
    this.waves = this.waves.filter(w => w.life > 0);
  }

  render(ctx) {
    const LS = require('./layoutScale');
    ctx.save();
    for (const w of this.waves) {
      const t = 1 - w.life / w.maxLife;
      const radius = w.startRadius + (w.endRadius - w.startRadius) * t;
      const alpha = (1 - t) * 0.75;
      const lineWidth = LS.ds(2) * (1 - t * 0.5);

      ctx.beginPath();
      ctx.arc(w.x, w.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(w.color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.shadowBlur = LS.ds(10);
      ctx.shadowColor = hexToRgba(w.color, 0.8);
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

module.exports = ShockwaveManager;
