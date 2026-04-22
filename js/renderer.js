/**
 * Canvas 渲染器
 * 负责：暗色背景、轨道线、元素绘制、核心绘制、分数/等级 UI、游戏结束界面
 */

const { RING_CONFIG, RING_RADIUS_RATIO, ELEMENT_COLORS, getElementColors } = require('./board');
const { GAME_CONFIG, getLevelNameEn } = require('./config');

/** 背景色 */
const BG_COLOR = '#0a0a1a';

/** 轨道线颜色 */
const TRACK_COLOR = 'rgba(255, 255, 255, 0.08)';

/** 格子空位颜色 */
const EMPTY_SLOT_COLOR = 'rgba(255, 255, 255, 0.12)';

/** 核心底色 */
const CORE_BG_COLOR = 'rgba(255, 255, 255, 0.15)';

class Renderer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  constructor(ctx, canvasWidth, canvasHeight) {
    this.ctx = ctx;
    this.width = canvasWidth;
    this.height = canvasHeight;
  }

  /** 清空画布并填充背景 */
  clear() {
    const { ctx } = this;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * 绘制三层同心圆轨道线
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} boardRadius
   */
  drawTracks(centerX, centerY, boardRadius) {
    const { ctx } = this;
    ctx.strokeStyle = TRACK_COLOR;
    ctx.lineWidth = 1;

    for (const ring of ['inner', 'mid', 'outer']) {
      const r = boardRadius * RING_RADIUS_RATIO[ring];
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * 绘制核心
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} coreLevel
   * @param {number} [pulse=0] - 0..1 脉冲强度（分裂瞬间 1，衰减到 0）
   * @param {number} [warningProgress=0] - 0..1 定时分裂前摇进度（0=无；1=即将触发）
   */
  drawCore(centerX, centerY, coreLevel, pulse = 0, warningProgress = 0) {
    const { ctx } = this;
    const colors = getElementColors(coreLevel);
    const baseRadius = 24;
    // 脉冲放大：最大 +25% 尺寸
    const radius = baseRadius * (1 + pulse * 0.25);

    // 前摇震动偏移（严格 ≤2px，频率 ~18Hz）
    let shakeX = 0, shakeY = 0;
    if (warningProgress > 0) {
      const t = warningProgress * 90; // 伪帧数（1.5s ≈ 90 帧）
      const intensity = Math.sin(warningProgress * Math.PI); // 中间最强
      shakeX = Math.sin(t * 1.2) * 2 * intensity;
      shakeY = Math.cos(t * 1.7) * 2 * intensity;
    }

    const cx = centerX + shakeX;
    const cy = centerY + shakeY;

    // 外发光（脉冲时更亮更大）
    const glowRadius = radius * (2 + pulse * 0.8);
    const glowAlphaHex = Math.min(0xFF, Math.floor(0x60 + pulse * 0x80)).toString(16).padStart(2, '0');
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, glowRadius);
    glow.addColorStop(0, colors.primary + glowAlphaHex);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 核心圆
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, colors.secondary);
    grad.addColorStop(1, colors.primary);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 前摇内部脉冲发光（严格限制在核心范围内）
    if (warningProgress > 0) {
      const heartbeat = Math.sin(warningProgress * Math.PI) * (0.5 + 0.5 * Math.sin(warningProgress * 90 * 0.4));
      const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.95);
      innerGlow.addColorStop(0, `rgba(255, 240, 200, ${0.6 * heartbeat})`);
      innerGlow.addColorStop(0.6, `rgba(239, 159, 39, ${0.4 * heartbeat})`);
      innerGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = innerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    // 核心边框（脉冲时更亮）
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 等级文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Lv.${coreLevel}`, cx, cy);
  }

  /**
   * 绘制正在从核心飞往目标格的新生元素（尺寸随进度增长）
   * @param {import('./board').default} board
   */
  drawFlyingElements(board) {
    if (!board.flyingElements || board.flyingElements.length === 0) return;
    const targetRadius = board.getElementRadius(1);
    for (const fly of board.flyingElements) {
      const pos = board.getFlyingPosition(fly);
      // 从 0.3× 逐渐长大到目标尺寸
      const radius = targetRadius * (0.3 + pos.t * 0.7);
      this._drawElement(pos.x, pos.y, 1, radius);
    }
  }

  /**
   * 绘制所有格子（空位 + 元素）
   * @param {import('./board').default} board
   */
  drawSlots(board) {
    const { ctx } = this;

    for (const slot of board.slots) {
      // 选中的格子单独由 drawSelectionHighlight 绘制（带脉冲）
      if (slot === board.selectedSlot) continue;
      // 合成动画中的格子由 drawMergeAnimations 绘制（Stage 5）
      if (slot.mergeAnimating) continue;
      // 磁吸动画中的格子由 drawMagnetAnimation 绘制
      if (slot._magnetAnimating) continue;

      const pos = board.getSlotPosition(slot);

      if (slot.level === null) {
        // 空位：小空心圆
        ctx.fillStyle = EMPTY_SLOT_COLOR;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 有元素：绘制彩色圆 + 等级名
        this._drawElement(pos.x, pos.y, slot.level, board.getElementRadius(slot.level));

        // 升级道具闪光叠加（白光一闪，18 帧线性衰减）
        if (slot._upgradeFlashFrame && slot._upgradeFlashFrame > 0) {
          const flashAlpha = (slot._upgradeFlashFrame / 18) * 0.85;
          ctx.save();
          ctx.globalAlpha = flashAlpha;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, board.getElementRadius(slot.level) + 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  /**
   * 绘制选中格子的连接线 — 从选中格子向 4 个几何邻居连线。
   * 同级 + 相邻（isAdjacent）的连接线高亮，其余暗淡。
   * 每帧重算，保证随圈层旋转实时更新端点和高亮状态。
   * @param {import('./board').default} board
   */
  drawConnectionLines(board) {
    if (!GAME_CONFIG.interaction.showConnectionLines) return;
    const selected = board.selectedSlot;
    if (!selected) return;

    const { ctx } = this;
    const selPos = board.getSlotPosition(selected);
    const neighbors = board.getNeighborsForConnection(selected);

    for (const nb of neighbors) {
      const nbPos = board.getSlotPosition(nb);

      // 可合成判定：相邻 + 同级 + 非空
      const eligible =
        nb.level !== null &&
        nb.level === selected.level &&
        board.isAdjacent(selected, nb);

      ctx.save();
      if (eligible) {
        const colors = getElementColors(selected.level);
        ctx.strokeStyle = colors.secondary;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.85;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55;
      }
      ctx.beginPath();
      ctx.moveTo(selPos.x, selPos.y);
      ctx.lineTo(nbPos.x, nbPos.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 绘制选中格子的高亮（发光环 + 元素脉冲呼吸）
   * 周期约 60 帧（1 秒），缩放 1.0 ↔ 1.15。
   * @param {import('./board').default} board
   */
  drawSelectionHighlight(board) {
    const selected = board.selectedSlot;
    if (!selected || selected.level === null) return;

    const { ctx } = this;
    const pos = board.getSlotPosition(selected);
    const baseRadius = board.getElementRadius(selected.level);
    const colors = getElementColors(selected.level);

    // 脉冲缩放（用 gameFrame 产生 0 → 1 → 0 循环，周期 60 帧）
    let pulseScale = 1.0;
    if (GAME_CONFIG.interaction.selectionPulseEnabled) {
      const phase = (board.gameFrame % 60) / 60; // 0..1
      const breath = (Math.sin(phase * Math.PI * 2) + 1) / 2; // 0..1
      pulseScale = 1.0 + breath * 0.15; // 1.0 ↔ 1.15
    }
    const radius = baseRadius * pulseScale;

    // 1) 外发光环（比平时发光更明亮）
    ctx.save();
    ctx.globalAlpha = 0.45;
    const glow = ctx.createRadialGradient(pos.x, pos.y, radius * 0.9, pos.x, pos.y, radius * 2.4);
    glow.addColorStop(0, colors.secondary);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2) 元素本体（带脉冲缩放）
    this._drawElement(pos.x, pos.y, selected.level, radius);

    // 3) 额外的白色高光环（醒目标识"选中"）
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 绘制合成动画队列：
   *   - 聚合阶段：两个源元素从各自 slot 向中点滑动，半径缩小
   *   - 弹出阶段：新元素从中点回到 slotA 位置，半径 0.5×→1.2×→1.0×
   * @param {import('./board').default} board
   */
  drawMergeAnimations(board) {
    if (!board.mergeAnimations || board.mergeAnimations.length === 0) return;
    for (const anim of board.mergeAnimations) {
      const state = board.getMergeAnimationState(anim);
      if (state.phase === 'converge') {
        const r = board.getElementRadius(anim.sourceLevel) * state.radiusScale;
        this._drawElement(state.sourcePos.x, state.sourcePos.y, anim.sourceLevel, r);
        this._drawElement(state.consumedPos.x, state.consumedPos.y, anim.sourceLevel, r);
      } else {
        const r = board.getElementRadius(anim.newLevel) * state.scale;
        this._drawElement(state.newPos.x, state.newPos.y, anim.newLevel, r);
      }
    }
  }

  /**
   * 绘制磁吸动画（粒子从外圈向内圈滑动）
   * @param {import('./items').Items} items
   * @param {import('./board').default} board
   */
  drawMagnetAnimation(items, board) {
    if (!items._magnetAnim) return;
    const { moves, frame, totalFrames } = items._magnetAnim;
    const t = Math.min(1, frame / totalFrames);
    const ease = 1 - Math.pow(1 - t, 3);

    for (const move of moves) {
      const x = move.fromPos.x + (move.toPos.x - move.fromPos.x) * ease;
      const y = move.fromPos.y + (move.toPos.y - move.fromPos.y) * ease;
      this._drawElement(x, y, move.level, board.getElementRadius(move.level));
    }
  }

  /**
   * 绘制单个元素（代码绘制方式 B）
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @param {number} radius
   */
  _drawElement(x, y, level, radius) {
    const { ctx } = this;
    const colors = getElementColors(level);

    // 外发光
    ctx.save();
    ctx.globalAlpha = 0.3;
    const glow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 1.8);
    glow.addColorStop(0, colors.primary);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 元素主体
    const grad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, 0, x, y, radius);
    grad.addColorStop(0, colors.secondary);
    grad.addColorStop(1, colors.primary);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 元素名称 — 只显示等级数字（原型 UI：2、3、7 等）
    const fontSize = Math.max(10, radius * 0.95);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(level), x, y);
  }

  /**
   * 绘制顶部 UI — 左上角当前分数（大号）+ 历史最高分（小号 + 皇冠）
   * @param {number} score - 当前分数
   * @param {number} highScore - 历史最高分
   */
  drawScoreUI(score, highScore = 0) {
    const { ctx } = this;
    const leftMargin = 24;
    const topMargin = 20;

    // 当前分数（大号白色，带千位分隔符）
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this._formatNumber(score), leftMargin, topMargin);

    // 历史最高分（皇冠 + 小号金色）
    const crownSize = 16;
    const scoreHeight = 36;
    const highY = topMargin + scoreHeight + 6;
    const crownX = leftMargin + crownSize / 2;
    const crownY = highY;
    this._drawCrown(crownX, crownY, crownSize, '#EF9F27');

    ctx.fillStyle = '#EF9F27';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._formatNumber(highScore), leftMargin + crownSize + 6, crownY);
  }

  /**
   * 绘制底部道具栏（3 个槽位水平居中于屏幕底部、核心等级文字上方）。
   * 每槽 = 圆形背景 + 几何图标 + 下方数量 "×N"。数量为 0 时图标变灰。
   * 命中坐标保存到 this.itemBarSlots，供 input.js 的命中检测使用。
   *
   * @param {import('./items').Items} items
   */
  drawItemBar(items) {
    const { ctx } = this;

    const slotRadius = 30;
    const slotSpacing = 92;        // 槽位中心间距（直径 60 + 间距 32）
    const centerX = this.width / 2;
    const centerY = this.height - 115;
    const types = ['clear', 'upgrade', 'magnet'];

    this.itemBarSlots = [];

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const count = items.inventory[type];
      const active = count > 0;
      const cx = centerX + (i - 1) * slotSpacing;
      const cy = centerY;

      // 圆盘底色
      ctx.fillStyle = active ? '#6B6B6B' : '#3A3A3A';
      ctx.beginPath();
      ctx.arc(cx, cy, slotRadius, 0, Math.PI * 2);
      ctx.fill();

      // 图标
      const iconColor = active ? '#FFFFFF' : '#5A5A5A';
      this._drawItemIcon(type, cx, cy, iconColor, active);

      // 数量文字（下方居中）
      ctx.fillStyle = active ? '#FFFFFF' : '#6A6A6A';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${count}`, cx, cy + slotRadius + 16);

      this.itemBarSlots.push({ type, x: cx, y: cy, r: slotRadius });
    }
  }

  /**
   * 在 (cx, cy) 绘制指定道具的几何图标。
   * @param {'clear'|'upgrade'|'magnet'} type
   * @param {number} cx
   * @param {number} cy
   * @param {string} color
   * @param {boolean} active - 非激活时降低视觉强度
   */
  _drawItemIcon(type, cx, cy, color, active) {
    const { ctx } = this;
    const alpha = active ? 1 : 0.7;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (type === 'clear') {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      const radii = [7, 12, 17];
      for (let i = 0; i < radii.length; i++) {
        ctx.lineWidth = 2.5 - i * 0.4;
        const rotOffset = (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radii[i], rotOffset, rotOffset + Math.PI * 1.5);
        ctx.stroke();
      }
    } else if (type === 'upgrade') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx + 10, cy + 1);
      ctx.lineTo(cx + 5, cy + 1);
      ctx.lineTo(cx + 5, cy + 9);
      ctx.lineTo(cx - 5, cy + 9);
      ctx.lineTo(cx - 5, cy + 1);
      ctx.lineTo(cx - 10, cy + 1);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'magnet') {
      // 紫色 U 形磁铁 + 内向箭头
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 9, 0, Math.PI);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(cx - 9, cy - 4, 3, 10);
      ctx.fillRect(cx + 6, cy - 4, 3, 10);
      // 内向小箭头
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy + 8);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx + 4, cy + 8);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制底部核心等级 UI（原型样式：核心等级 | Lv.N Name）
   * @param {number} coreLevel
   */
  drawCoreLevelUI(coreLevel) {
    const { ctx } = this;
    const name = getLevelNameEn(coreLevel);
    const cx = this.width / 2;
    const y = this.height - 30;

    ctx.save();
    ctx.font = '11px Arial';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#888888';

    const text = `核心等级 | Lv.${coreLevel} ${name}`;
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  /**
   * 绘制右下角暂停按钮（⏸ 双竖线）
   */
  drawPauseButton() {
    const { ctx } = this;
    const x = this.width - 24 - 12;
    const y = this.height - 40;
    const half = 12;

    ctx.save();
    ctx.fillStyle = '#888888';
    const barW = 4;
    const barH = 16;
    const gap = 6;
    ctx.fillRect(x - gap / 2 - barW, y - barH / 2, barW, barH);
    ctx.fillRect(x + gap / 2, y - barH / 2, barW, barH);
    ctx.restore();

    this.pauseBtnPos = { x, y, r: half + 6 };
  }

  /**
   * 绘制小皇冠图标（用于历史最高分）
   * @param {number} cx - 中心 x
   * @param {number} cy - 中心 y
   * @param {number} size - 高度参考
   * @param {string} color
   */
  _drawCrown(cx, cy, size, color) {
    const { ctx } = this;
    const w = size * 1.4;
    const h = size;
    const halfW = w / 2;
    const halfH = h / 2;

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, cy + halfH);        // BL
    ctx.lineTo(cx + halfW, cy + halfH);        // BR
    ctx.lineTo(cx + halfW, cy);                // 右边缘 base 顶
    ctx.lineTo(cx + w / 3, cy - halfH);        // 右尖
    ctx.lineTo(cx + w / 8, cy - h * 0.15);     // 右 V 凹
    ctx.lineTo(cx, cy - halfH);                // 中尖
    ctx.lineTo(cx - w / 8, cy - h * 0.15);     // 左 V 凹
    ctx.lineTo(cx - w / 3, cy - halfH);        // 左尖
    ctx.lineTo(cx - halfW, cy);                // 左边缘 base 顶
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 整数千分位格式化：1234567 → "1,234,567" */
  _formatNumber(n) {
    const s = String(Math.floor(Math.max(0, n)));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * 绘制 combo 提示
   * @param {number} combo
   * @param {number} x
   * @param {number} y
   */
  drawCombo(combo, x, y) {
    if (combo < 2) return;

    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${20 + combo * 2}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText(`COMBO x${combo}!`, x, y - 40);
    ctx.restore();
  }

  /**
   * 绘制浮动得分
   * @param {object|null} popup - { points, combo, time }
   */
  drawScorePopup(popup) {
    if (!popup) return;

    const { ctx } = this;
    const elapsed = Date.now() - popup.time;
    if (elapsed > 1500) return; // 1.5 秒后消失

    const alpha = Math.max(0, 1 - elapsed / 1500);
    const yOffset = -elapsed * 0.03;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = popup.combo > 1 ? '#FFD700' : '#fff';
    ctx.font = `bold 18px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = popup.combo > 1
      ? `+${popup.points} (x${popup.combo})`
      : `+${popup.points}`;
    ctx.fillText(text, this.width / 2, this.height / 2 - 100 + yOffset);
    ctx.restore();
  }

  /**
   * 绘制游戏结束界面
   * @param {number} coreLevel
   * @param {number} score
   */
  drawGameOver(coreLevel, score) {
    const { ctx } = this;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, this.width, this.height);

    const cx = this.width / 2;
    const cy = this.height / 2;

    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏结束', cx, cy - 80);

    // 核心等级
    const colors = getElementColors(coreLevel);
    ctx.fillStyle = colors.primary;
    ctx.font = 'bold 24px Arial';
    ctx.fillText(
      `核心等级: Lv.${coreLevel} ${getLevelNameEn(coreLevel)}`,
      cx, cy - 20
    );

    // 最终得分
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.fillText(`最终得分: ${score}`, cx, cy + 30);

    // 再来一局按钮
    const btnWidth = 180;
    const btnHeight = 50;
    const btnX = cx - btnWidth / 2;
    const btnY = cy + 70;

    // 按钮背景
    ctx.fillStyle = '#9B8FE2';
    ctx.beginPath();
    this._roundRect(btnX, btnY, btnWidth, btnHeight, 12);
    ctx.fill();

    // 按钮文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('再来一局', cx, btnY + btnHeight / 2);

    // 保存按钮区域用于点击检测
    this.restartBtn = { x: btnX, y: btnY, width: btnWidth, height: btnHeight };
  }

  /**
   * 绘制道具使用期间的屏幕边缘脉冲（清空=暖金、升级=绿松）。
   * 强度随 frame 呈抛物线 0 → 1 → 0。
   * @param {import('./items').Items} items
   */
  drawItemUseBurst(items) {
    if (!items.useAnim) return;
    const { ctx } = this;
    const anim = items.useAnim;
    const progress = anim.frame / anim.totalFrames;
    const intensity = 1 - Math.abs(1 - progress * 2); // 0→1→0
    const alpha = intensity * 0.32;

    const colorByType = {
      clear:   '239, 159, 39',    // 暖金
      upgrade: '93, 202, 165',    // 绿松
      magnet:  '155, 127, 221',   // 紫
    };
    const rgb = colorByType[anim.type] || '255, 255, 255';

    const thickness = 70;
    ctx.save();

    // 上
    let grad = ctx.createLinearGradient(0, 0, 0, thickness);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, thickness);

    // 下
    grad = ctx.createLinearGradient(0, this.height, 0, this.height - thickness);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.height - thickness, this.width, thickness);

    // 左
    grad = ctx.createLinearGradient(0, 0, thickness, 0);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, thickness, this.height);

    // 右
    grad = ctx.createLinearGradient(this.width, 0, this.width - thickness, 0);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(this.width - thickness, 0, thickness, this.height);

    ctx.restore();
  }

  /**
   * 绘制道具使用失败提示（屏幕中下方红色文字）
   * @param {import('./items').Items} items
   */
  drawUseFailHint(items) {
    if (!items.useFailHint) return;
    const { ctx } = this;
    const hint = items.useFailHint;
    const progress = hint.frame / hint.totalFrames;
    // fade：头 15% 淡入，尾 30% 淡出，中间实心
    let alpha;
    if (progress < 0.15) alpha = progress / 0.15;
    else if (progress > 0.7) alpha = (1 - progress) / 0.3;
    else alpha = 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FF6464';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hint.text, this.width / 2, this.height * 0.68);
    ctx.restore();
  }

  /**
   * 绘制掉落物（flyIn / floating / blinking / pickingUp 四阶段）。
   * @param {import('./items').Items} items
   */
  drawDrops(items) {
    const { ctx } = this;
    const iconColors = { clear: '#EF9F27', upgrade: '#5DCAA5', magnet: '#9B7FDD' };

    for (const drop of items.drops) {
      let x, y, scale, alpha;

      if (drop.pickingUp) {
        // 飞向道具栏
        const t = drop.pickupFrame / drop.pickupTotalFrames;
        const ease = 1 - Math.pow(1 - t, 3);
        x = drop.targetX + (drop.pickupTargetX - drop.targetX) * ease;
        y = drop.targetY + (drop.pickupTargetY - drop.targetY) * ease;
        scale = 1 - ease * 0.6;
        alpha = 1;
      } else if (drop.phase === 'flyIn') {
        const t = drop.phaseFrame / drop.totalFlyInFrames;
        const ease = 1 - Math.pow(1 - t, 3);
        x = drop.startX + (drop.targetX - drop.startX) * ease;
        y = drop.startY + (drop.targetY - drop.startY) * ease;
        scale = 0.5 + ease * 0.5;
        alpha = 0.6 + ease * 0.4;
      } else if (drop.phase === 'floating') {
        x = drop.targetX;
        y = drop.targetY;
        const breath = Math.sin(drop.phaseFrame * 0.1) * 0.08;
        scale = 1 + breath;
        alpha = 1;
      } else {
        // blinking
        x = drop.targetX;
        y = drop.targetY;
        scale = 1;
        alpha = 0.3 + Math.abs(Math.sin(drop.phaseFrame * 0.18)) * 0.7;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      // 外圈光晕
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, 0.08)`;
      ctx.fill();
      ctx.strokeStyle = iconColors[drop.type];
      ctx.lineWidth = 2;
      ctx.stroke();

      // 图标（复用 _drawItemIcon 的逻辑，但以 0,0 为中心）
      this._drawItemIcon(drop.type, 0, 0, iconColors[drop.type], true);

      ctx.restore();
    }
  }



  /**
   * 绘制圆角矩形
   */
  _roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }

  /**
   * 检查是否点击了重新开始按钮
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isRestartBtnHit(x, y) {
    if (!this.restartBtn) return false;
    const btn = this.restartBtn;
    return x >= btn.x && x <= btn.x + btn.width &&
           y >= btn.y && y <= btn.y + btn.height;
  }
}

module.exports = Renderer;
