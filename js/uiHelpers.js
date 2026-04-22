/**
 * uiHelpers.js — Canvas 绘制工具函数层
 * 提供可复用的 UI 绘制原语，供后续界面模块调用。
 * 所有默认值从 UI_CONFIG 读取，不硬编码。
 */

const { UI_CONFIG } = require('./config.js');

// ─── 内部辅助 ───────────────────────────────────────────

const FONT_ZH = '"PingFang SC", "Noto Sans SC", system-ui, sans-serif';
const FONT_EN = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** 检测文本是否含非 ASCII 字符，返回对应字体栈 */
function _pickFont(text) {
  return /[^\x00-\x7F]/.test(text) ? FONT_ZH : FONT_EN;
}

/** 手写圆角矩形路径（兼容微信小游戏低版本，不依赖 ctx.roundRect） */
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

// ─── 导出函数 ───────────────────────────────────────────

/**
 * 绘制半透明毛玻璃质感的圆角矩形卡片
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 左上角 x
 * @param {number} y - 左上角 y
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {object} [options]
 */
function drawGlassCard(ctx, x, y, w, h, options) {
  const o = Object.assign({
    radius: UI_CONFIG.radius.cardGlass,
    fillColor: UI_CONFIG.color.glassCard,
    borderColor: UI_CONFIG.color.borderSoft,
    borderWidth: 1,
    shadow: true,
  }, options);

  ctx.save();

  // 柔和阴影
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = UI_CONFIG.glow.cardSoft;
    ctx.shadowOffsetY = 4;
  }

  // 填充
  _roundRectPath(ctx, x, y, w, h, o.radius);
  ctx.fillStyle = o.fillColor;
  ctx.fill();

  // 关闭阴影再描边，避免边框也带阴影
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  if (o.borderWidth > 0) {
    _roundRectPath(ctx, x, y, w, h, o.radius);
    ctx.strokeStyle = o.borderColor;
    ctx.lineWidth = o.borderWidth;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 绘制金色纪念卡片（半透明金色背景 + 金色描边 + 外发光）
 */
function drawGoldCard(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(255,215,0,0.15)';
  ctx.shadowBlur = 40;
  _roundRectPath(ctx, x, y, w, h, 16);
  ctx.fillStyle = 'rgba(255,215,0,0.04)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  _roundRectPath(ctx, x, y, w, h, 16);
  ctx.strokeStyle = 'rgba(255,215,0,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制紫色主按钮（带光晕）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 左上角 x
 * @param {number} y - 左上角 y
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {string} text - 按钮文字
 * @param {object} [options]
 */
function drawPrimaryButton(ctx, x, y, w, h, text, options) {
  const o = Object.assign({
    glow: true,
    pressed: false,
    fontSize: UI_CONFIG.font.buttonPrimary,
  }, options);

  ctx.save();

  // 光晕
  if (o.glow) {
    ctx.shadowColor = o.pressed
      ? UI_CONFIG.color.accentPurple
      : UI_CONFIG.color.accentPurpleLight;
    ctx.shadowBlur = o.pressed
      ? UI_CONFIG.glow.buttonPrimary * 0.5
      : UI_CONFIG.glow.buttonPrimary;
  }

  // 渐变填充
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, UI_CONFIG.color.accentPurple);
  grad.addColorStop(1, UI_CONFIG.color.accentPurpleLight);

  const r = UI_CONFIG.radius.button;
  _roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // 按下态叠加半透明暗层
  if (o.pressed) {
    _roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fill();
  }

  // 关闭阴影再绘制文字
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  drawText(ctx, text, x + w / 2, y + h / 2, {
    fontSize: o.fontSize,
    color: UI_CONFIG.color.textPrimary,
    align: 'center',
    baseline: 'middle',
    weight: '600',
  });

  ctx.restore();
}

/**
 * 绘制透明描边次要按钮
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 左上角 x
 * @param {number} y - 左上角 y
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {string} text - 按钮文字
 * @param {object} [options]
 */
function drawSecondaryButton(ctx, x, y, w, h, text, options) {
  const o = Object.assign({
    borderColor: UI_CONFIG.color.borderGlass,
    fontSize: UI_CONFIG.font.buttonSecondary,
    pressed: false,
  }, options);

  ctx.save();

  const r = UI_CONFIG.radius.button;
  _roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = o.borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 按下态填充微弱底色
  if (o.pressed) {
    _roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(74,90,158,0.15)';
    ctx.fill();
  }

  drawText(ctx, text, x + w / 2, y + h / 2, {
    fontSize: o.fontSize,
    color: UI_CONFIG.color.textSecondary,
    align: 'center',
    baseline: 'middle',
    weight: 'normal',
  });

  ctx.restore();
}

/**
 * 绘制文本（支持对齐、颜色、字号、发光）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text - 文本内容
 * @param {number} x - 绘制 x 坐标
 * @param {number} y - 绘制 y 坐标
 * @param {object} [options]
 */
function drawText(ctx, text, x, y, options) {
  const o = Object.assign({
    fontSize: UI_CONFIG.font.body,
    color: UI_CONFIG.color.textPrimary,
    align: 'center',
    baseline: 'middle',
    weight: 'normal',
    glow: 0,
    glowColor: null,
  }, options);

  ctx.save();

  const fontFamily = _pickFont(text);
  ctx.font = `${o.weight} ${o.fontSize}px ${fontFamily}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align;
  ctx.textBaseline = o.baseline;

  if (o.glow > 0) {
    ctx.shadowColor = o.glowColor || o.color;
    ctx.shadowBlur = o.glow;
  }

  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 测量文本宽度（用于布局计算）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text - 文本内容
 * @param {number} fontSize - 字号
 * @param {string} [weight='normal'] - 字重
 * @returns {number} 文本宽度（px）
 */
function measureText(ctx, text, fontSize, weight) {
  ctx.save();
  const fontFamily = _pickFont(text);
  ctx.font = `${weight || 'normal'} ${fontSize}px ${fontFamily}`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

/**
 * 检测点是否在矩形内（用于触摸命中检测）
 * @param {number} px - 触摸点 x
 * @param {number} py - 触摸点 y
 * @param {number} x - 矩形左上角 x
 * @param {number} y - 矩形左上角 y
 * @param {number} w - 矩形宽度
 * @param {number} h - 矩形高度
 * @returns {boolean}
 */
function isPointInRect(px, py, x, y, w, h) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

module.exports = {
  drawGlassCard,
  drawGoldCard,
  drawPrimaryButton,
  drawSecondaryButton,
  drawText,
  measureText,
  isPointInRect,
};
