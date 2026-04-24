const LS = require('./layoutScale');

const MAX_AGE = 48; // 0.8s @60fps
const FLOAT_HEIGHT = 40;

class ScoreTextManager {
  constructor() {
    this.items = [];
  }

  spawn(x, y, points) {
    this.items.push({ x, y, points, age: 0 });
  }

  update() {
    for (const it of this.items) it.age += 1;
    this.items = this.items.filter(it => it.age < MAX_AGE);
  }

  render(ctx) {
    if (this.items.length === 0) return;
    ctx.save();
    for (const it of this.items) {
      const t = it.age / MAX_AGE;
      const offsetY = -FLOAT_HEIGHT * t;

      let alpha;
      if (t < 0.2) alpha = t / 0.2;
      else if (t < 0.7) alpha = 1;
      else alpha = (1 - t) / 0.3;

      const scale = t < 0.3 ? (0.9 + 0.1 * (t / 0.3)) : 1.0;
      const fontSize = LS.df(18) * scale;

      ctx.globalAlpha = alpha;
      ctx.font = `700 ${fontSize}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = LS.ds(4);
      ctx.fillText(`+${it.points}`, it.x, it.y + LS.ds(offsetY));
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  reset() {
    this.items = [];
  }
}

module.exports = ScoreTextManager;
