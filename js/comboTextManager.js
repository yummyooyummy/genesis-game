const LS = require('./layoutScale');

const MAX_SLOTS = 3;
const LIFE_FRAMES = 40;
const SPAWN_FRAMES = 10;
const FADE_FRAMES = 20;

class ComboTextManager {
  constructor() {
    this.items = [];
  }

  push(combo) {
    this.items.unshift({ combo, life: LIFE_FRAMES, maxLife: LIFE_FRAMES, age: 0 });
    if (this.items.length > MAX_SLOTS) this.items.length = MAX_SLOTS;
  }

  reset() {
    this.items = [];
  }

  update() {
    for (const it of this.items) {
      it.life -= 1;
      it.age += 1;
    }
    this.items = this.items.filter(it => it.life > 0);
  }

  render(ctx) {
    const centerX = LS.dx(187.5);
    const baseY = LS.dy(150);
    const slotGap = LS.ds(42);

    ctx.save();
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const y = baseY - i * slotGap;

      let scale = 1.0;
      if (it.age < SPAWN_FRAMES) {
        const t = it.age / SPAWN_FRAMES;
        scale = 0.3 + t * 0.85 + Math.sin(t * Math.PI) * 0.15;
      }

      let alpha = i === 0 ? 1.0 : (i === 1 ? 0.55 : 0.3);
      if (it.life < FADE_FRAMES) alpha *= (it.life / FADE_FRAMES);

      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = 'rgba(255,216,135,0.9)';
      ctx.shadowBlur = LS.ds(24) * scale;
      ctx.fillStyle = '#FFD887';

      const fontSize = i === 0 ? 36 : (i === 1 ? 28 : 22);
      ctx.font = `700 ${LS.df(fontSize * scale)}px "Space Grotesk", sans-serif`;

      ctx.fillText(`Combo ×${it.combo}`, centerX, y);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

module.exports = ComboTextManager;
