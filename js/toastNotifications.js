/**
 * toastNotifications.js — 游戏中"发现新形态"顶部浮层
 */

const { getLevelNameZh } = require('./config');
const { getElementColors } = require('./board');

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t; }

function getToastTitle(level) {
  if (level <= 15) return '✨ 发现新形态';
  if (level === 16) return '🏆 抵达超越';
  return '🏆 再度超越';
}

const SLIDE_IN_MS = 300;
const HOLD_MS = 1400;
const SLIDE_OUT_MS = 300;
const TOTAL_MS = SLIDE_IN_MS + HOLD_MS + SLIDE_OUT_MS;

const CARD_W = 320;
const CARD_H = 76;
const CARD_TOP = 110;
const CARD_R = 14;
const PLATE_SIZE = 44;
const PARTICLE_RADIUS = 14;
const SWEEP_DURATION = 900;
const SWEEP_WIDTH = 40;

const FONT_EN = "'Space Grotesk', Arial";
const FONT_ZH = "'Noto Sans SC', 'PingFang SC', sans-serif";

function _roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function _drawParticle(ctx, x, y, level) {
  const colors = getElementColors(level);
  const r = PARTICLE_RADIUS;

  ctx.save();
  ctx.globalAlpha = 0.3;
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.8);
  glow.addColorStop(0, colors.primary);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const grad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
  grad.addColorStop(0, colors.secondary);
  grad.addColorStop(1, colors.primary);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  const fontSize = Math.max(13, r * 1.05);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fontSize}px ${FONT_EN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(level), x, y);
}

const ToastManager = {
  queue: [],
  current: null,
  startTime: 0,

  push(level) {
    this.queue.push({ level });
    if (!this.current) this._showNext();
  },

  _showNext() {
    if (this.queue.length === 0) {
      this.current = null;
      return;
    }
    this.current = this.queue.shift();
    this.startTime = Date.now();
  },

  update() {
    if (!this.current) return;
    if (Date.now() - this.startTime >= TOTAL_MS) {
      this._showNext();
    }
  },

  draw(ctx, screenWidth, statusBarHeight) {
    if (!this.current) return;
    const elapsed = Date.now() - this.startTime;
    const level = this.current.level;

    let translateY = 0;
    let opacity = 1;

    if (elapsed < SLIDE_IN_MS) {
      const t = easeOut(elapsed / SLIDE_IN_MS);
      translateY = -(CARD_H + CARD_TOP) * (1 - t);
      opacity = t;
    } else if (elapsed < SLIDE_IN_MS + HOLD_MS) {
      translateY = 0;
      opacity = 1;
    } else {
      const t = easeIn((elapsed - SLIDE_IN_MS - HOLD_MS) / SLIDE_OUT_MS);
      translateY = -(CARD_H + CARD_TOP) * t;
      opacity = 1 - t;
    }

    const cardX = (screenWidth - CARD_W) / 2;
    const cardY = statusBarHeight + CARD_TOP + translateY;

    ctx.save();
    ctx.globalAlpha = opacity;

    // --- 背景 ---
    const bgGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + CARD_H);
    bgGrad.addColorStop(0, '#1A2244');
    bgGrad.addColorStop(1, '#131938');
    _roundRectPath(ctx, cardX, cardY, CARD_W, CARD_H, CARD_R);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // --- 金色描边 ---
    _roundRectPath(ctx, cardX, cardY, CARD_W, CARD_H, CARD_R);
    ctx.strokeStyle = 'rgba(255,182,72,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- 金色光扫（hold 阶段） ---
    const holdStart = SLIDE_IN_MS;
    const holdEnd = SLIDE_IN_MS + HOLD_MS;
    if (elapsed >= holdStart && elapsed < holdEnd) {
      const sweepElapsed = elapsed - holdStart;
      if (sweepElapsed < SWEEP_DURATION) {
        const sweepT = sweepElapsed / SWEEP_DURATION;
        const sweepX = cardX - SWEEP_WIDTH + (CARD_W + SWEEP_WIDTH * 2) * sweepT;

        ctx.save();
        _roundRectPath(ctx, cardX, cardY, CARD_W, CARD_H, CARD_R);
        ctx.clip();

        const sweepGrad = ctx.createLinearGradient(
          sweepX - SWEEP_WIDTH / 2, 0, sweepX + SWEEP_WIDTH / 2, 0
        );
        sweepGrad.addColorStop(0, 'transparent');
        sweepGrad.addColorStop(0.5, 'rgba(255,182,72,0.12)');
        sweepGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(cardX, cardY, CARD_W, CARD_H);

        ctx.restore();
      }
    }

    // --- 左侧粒子 ---
    const padding = 14;
    const plateX = cardX + padding + PLATE_SIZE / 2;
    const plateY = cardY + CARD_H / 2;
    _drawParticle(ctx, plateX, plateY, level);

    // --- 右侧文字 ---
    const textX = cardX + padding + PLATE_SIZE + 12;

    // kicker
    ctx.fillStyle = '#8891B8';
    ctx.font = `600 12px ${FONT_ZH}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(getToastTitle(level), textX, cardY + 26);

    // 主标题：金色渐变，混排字体
    const lvText = `Lv.${level} `;
    const nameText = getLevelNameZh(level);

    ctx.font = `bold 18px ${FONT_EN}`;
    const lvWidth = ctx.measureText(lvText).width;
    ctx.font = `bold 18px ${FONT_ZH}`;
    const nameWidth = ctx.measureText(nameText).width;
    const totalWidth = lvWidth + nameWidth;

    const titleY = cardY + 52;
    const goldGrad = ctx.createLinearGradient(textX, 0, textX + totalWidth, 0);
    goldGrad.addColorStop(0, '#FFD887');
    goldGrad.addColorStop(1, '#FFB648');

    ctx.fillStyle = goldGrad;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.font = `bold 18px ${FONT_EN}`;
    ctx.fillText(lvText, textX, titleY);

    ctx.font = `bold 18px ${FONT_ZH}`;
    ctx.fillText(nameText, textX + lvWidth, titleY);

    ctx.restore();
  },

  clear() {
    this.queue = [];
    this.current = null;
  },
};

module.exports = ToastManager;
