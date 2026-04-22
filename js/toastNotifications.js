/**
 * toastNotifications.js — 游戏中"发现新形态"顶部浮层
 */

const { UI_CONFIG, getLevelColor, getLevelNameZh } = require('./config');
const ui = require('./uiHelpers');

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t; }

function getToastTitle(level) {
  if (level <= 15) return '✨ 发现新形态';
  if (level === 16) return '🏆 抵达超越';
  return '🏆 再度超越';
}

const SLIDE_IN_MS = 300;
const HOLD_MS = 2500;
const SLIDE_OUT_MS = 200;
const TOTAL_MS = SLIDE_IN_MS + HOLD_MS + SLIDE_OUT_MS;

const CARD_H = 60;
const CARD_MARGIN_X = 24;
const CARD_TOP_OFFSET = 16;

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
    const color = getLevelColor(level);

    let translateY = 0;
    let opacity = 1;

    if (elapsed < SLIDE_IN_MS) {
      const t = easeOut(elapsed / SLIDE_IN_MS);
      translateY = -(CARD_H + CARD_TOP_OFFSET) * (1 - t);
      opacity = t;
    } else if (elapsed < SLIDE_IN_MS + HOLD_MS) {
      translateY = 0;
      opacity = 1;
    } else {
      const t = easeIn((elapsed - SLIDE_IN_MS - HOLD_MS) / SLIDE_OUT_MS);
      translateY = -(CARD_H + CARD_TOP_OFFSET) * t;
      opacity = 1 - t;
    }

    const cardW = screenWidth - CARD_MARGIN_X * 2;
    const cardX = CARD_MARGIN_X;
    const cardY = statusBarHeight + CARD_TOP_OFFSET + translateY;

    ctx.save();
    ctx.globalAlpha = opacity;

    // 背景
    ctx.fillStyle = 'rgba(10,14,39,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cardX + 12, cardY);
    ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + CARD_H, 12);
    ctx.arcTo(cardX + cardW, cardY + CARD_H, cardX, cardY + CARD_H, 12);
    ctx.arcTo(cardX, cardY + CARD_H, cardX, cardY, 12);
    ctx.arcTo(cardX, cardY, cardX + cardW, cardY, 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 等级色描边
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity * 0.6;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = opacity;

    // 左侧等级色圆点 + 发光
    const dotX = cardX + 28;
    const dotY = cardY + CARD_H / 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 14, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 圆点内等级数字
    ui.drawText(ctx, String(level), dotX, dotY, {
      fontSize: 12,
      color: '#FFFFFF',
      weight: '700',
    });

    // 右侧文字
    const textX = dotX + 28;
    ui.drawText(ctx, getToastTitle(level), textX, cardY + 22, {
      fontSize: 12,
      color: 'rgba(255,255,255,0.7)',
      weight: '600',
      align: 'left',
    });
    const lvName = getLevelNameZh(level);
    ui.drawText(ctx, 'Lv.' + level + ' ' + lvName, textX, cardY + 42, {
      fontSize: 16,
      color: color,
      weight: '700',
      align: 'left',
      glow: 6,
      glowColor: color,
    });

    ctx.restore();
  },

  clear() {
    this.queue = [];
    this.current = null;
  },
};

module.exports = ToastManager;
