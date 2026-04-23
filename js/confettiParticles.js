const { UI_CONFIG } = require('./config');

const ConfettiManager = {
  particles: [],
  initialized: false,

  init(canvasWidth, canvasHeight) {
    this.particles = [];
    const cfg = UI_CONFIG.newRecordConfetti;
    for (let i = 0; i < cfg.count; i++) {
      const rMin = cfg.particle.radiusRange[0];
      const rMax = cfg.particle.radiusRange[1];
      const oMin = cfg.particle.opacityRange[0];
      const oMax = cfg.particle.opacityRange[1];
      this.particles.push({
        x: Math.random() * canvasWidth,
        y: -20 + Math.random() * (canvasHeight + 40),
        radius: rMin + Math.random() * (rMax - rMin),
        opacity: oMin + Math.random() * (oMax - oMin),
        vy: 0.3 + Math.random() * 0.8,
        vx: (Math.random() - 0.5) * 0.3,
        canvasWidth,
        canvasHeight,
      });
    }
    this.initialized = true;
  },

  update() {
    for (const p of this.particles) {
      p.y += p.vy;
      p.x += p.vx;
      if (p.y > p.canvasHeight + 20) {
        p.y = -20;
        p.x = Math.random() * p.canvasWidth;
      }
    }
  },

  draw(ctx) {
    const color = UI_CONFIG.newRecordConfetti.particle.color;
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  reset() {
    this.particles = [];
    this.initialized = false;
  },
};

module.exports = ConfettiManager;
