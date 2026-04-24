/**
 * 粒子效果系统
 * 管理粒子的生成、更新、渲染和上限控制
 * 同屏粒子上限：200
 */

const MAX_PARTICLES = 200;

class Particles {
  constructor() {
    this.pool = [];
  }

  /**
   * 在指定位置生成一组粒子
   * @param {number} x - 中心 x
   * @param {number} y - 中心 y
   * @param {string} color - 粒子颜色
   * @param {number} count - 粒子数量
   * @param {object} [opts] - 可选参数
   * @param {number} [opts.speed] - 初始速度范围
   * @param {number} [opts.life] - 生命周期（帧数）
   * @param {number} [opts.radius] - 粒子半径
   */
  spawn(x, y, color, count, opts = {}) {
    const speed = opts.speed || 3;
    const life = opts.life || 40;
    const radius = opts.radius || 3;

    for (let i = 0; i < count; i++) {
      if (this.pool.length >= MAX_PARTICLES) break;

      const angle = Math.random() * Math.PI * 2;
      const v = (Math.random() * 0.5 + 0.5) * speed;

      this.pool.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        radius: radius * (Math.random() * 0.5 + 0.5),
        color,
        alpha: 1,
        life,
        maxLife: life,
      });
    }
  }

  spawnConverge(targetX, targetY, color, count, opts = {}) {
    const life = opts.life || 30;
    const minDist = opts.minDistance || 60;
    const maxDist = opts.maxDistance || 100;
    const radius = opts.radius || 2;

    for (let i = 0; i < count; i++) {
      if (this.pool.length >= MAX_PARTICLES) break;
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      this.pool.push({
        x: targetX + Math.cos(angle) * dist,
        y: targetY + Math.sin(angle) * dist,
        targetX,
        targetY,
        radius: radius * (Math.random() * 0.5 + 0.5),
        color,
        alpha: 1,
        life,
        maxLife: life,
        isConverge: true,
      });
    }
  }

  /**
   * 生成尾迹粒子（用于吸附动画）
   * @param {number} x - 当前位置 x
   * @param {number} y - 当前位置 y
   * @param {string} color - 粒子颜色
   */
  spawnTrail(x, y, color) {
    if (this.pool.length >= MAX_PARTICLES) return;

    this.pool.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.random() * 2 + 1,
      color,
      alpha: 0.8,
      life: 20,
      maxLife: 20,
    });
  }

  /**
   * 生成元素装饰粒子
   * @param {number} x - 元素中心 x
   * @param {number} y - 元素中心 y
   * @param {string} color - 辅色
   * @param {number} elementRadius - 元素半径
   */
  spawnDecoration(x, y, color, elementRadius) {
    if (this.pool.length >= MAX_PARTICLES) return;

    const angle = Math.random() * Math.PI * 2;
    const dist = elementRadius * (0.8 + Math.random() * 0.6);

    this.pool.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      radius: Math.random() * 1.5 + 0.5,
      color,
      alpha: 0.4 + Math.random() * 0.3,
      life: 60 + Math.floor(Math.random() * 40),
      maxLife: 100,
    });
  }

  /** 每帧更新 */
  update() {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];

      if (p.isConverge) {
        p.x += (p.targetX - p.x) * 0.15;
        p.y += (p.targetY - p.y) * 0.15;
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        if (dx * dx + dy * dy < 25) {
          p.life = 0;
        } else {
          p.life -= 1;
        }
        p.alpha = Math.min(1, p.life / 5);
      } else {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        p.alpha = Math.max(0, p.life / p.maxLife);
        p.vx *= 0.97;
        p.vy *= 0.97;
      }

      if (p.life <= 0) {
        this.pool.splice(i, 1);
      }
    }
  }

  /**
   * 渲染所有粒子
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 清空所有粒子 */
  clear() {
    this.pool.length = 0;
  }

  /** 当前粒子数 */
  get count() {
    return this.pool.length;
  }
}

module.exports = Particles;
