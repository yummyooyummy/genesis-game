class ShockwaveManager {
  constructor() {
    this.waves = [];
  }

  spawn(x, y) {
    this.waves.push({
      x, y,
      life: 18,
      maxLife: 18,
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
    const LS = GameGlobal.LayoutScale;
    ctx.save();
    for (const w of this.waves) {
      const t = 1 - w.life / w.maxLife;
      const radius = LS.ds(12) + LS.ds(42) * t;
      const alpha = (1 - t) * 0.75;
      const lineWidth = LS.ds(2) * (1 - t * 0.5);

      ctx.beginPath();
      ctx.arc(w.x, w.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 216, 135, ${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.shadowBlur = LS.ds(10);
      ctx.shadowColor = 'rgba(255, 182, 72, 0.8)';
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

module.exports = ShockwaveManager;
