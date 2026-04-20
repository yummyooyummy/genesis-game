/**
 * Canvas 渲染器
 * 负责：暗色背景、轨道线、元素绘制、核心绘制、分数/等级 UI、游戏结束界面
 */

const { RING_CONFIG, RING_RADIUS_RATIO, ELEMENT_COLORS } = require('./board');
const { GAME_CONFIG } = require('./config');

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
    const colors = ELEMENT_COLORS[coreLevel] || ELEMENT_COLORS[1];
    const baseRadius = 24;
    // 脉冲放大：最大 +25% 尺寸
    const radius = baseRadius * (1 + pulse * 0.25);

    // 外发光（脉冲时更亮更大）
    const glowRadius = radius * (2 + pulse * 0.8);
    const glowAlphaHex = Math.min(0xFF, Math.floor(0x60 + pulse * 0x80)).toString(16).padStart(2, '0');
    const glow = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, glowRadius);
    glow.addColorStop(0, colors.primary + glowAlphaHex);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 前摇呼吸环（醒目但不刺眼；一次完整"吸气-呼气"正好跨越 1.5s 前摇周期）
    if (warningProgress > 0) {
      const breath = Math.sin(warningProgress * Math.PI); // 0 → 1 → 0
      const ringRadius = radius + 6 + breath * 18;
      const alpha = 0.15 + breath * 0.55;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#EF9F27'; // 暖色（金橙，提示即将分裂）
      ctx.lineWidth = 2 + breath * 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 核心圆
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    grad.addColorStop(0, colors.secondary);
    grad.addColorStop(1, colors.primary);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    // 核心边框（脉冲时更亮）
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 等级文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Lv.${coreLevel}`, centerX, centerY);
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
        const colors = ELEMENT_COLORS[selected.level] || ELEMENT_COLORS[1];
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
    const colors = ELEMENT_COLORS[selected.level] || ELEMENT_COLORS[1];

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
   * 绘制单个元素（代码绘制方式 B）
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @param {number} radius
   */
  _drawElement(x, y, level, radius) {
    const { ctx } = this;
    const colors = ELEMENT_COLORS[level] || ELEMENT_COLORS[1];

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
    const leftMargin = 22;
    const topMargin = 38;

    // 当前分数（大号白色）
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this._formatNumber(score), leftMargin, topMargin);

    // 历史最高分（皇冠 + 小号金色）
    const crownSize = 12;
    const crownX = leftMargin + crownSize;
    const crownY = topMargin + 52;
    this._drawCrown(crownX, crownY, crownSize, '#EF9F27');

    ctx.fillStyle = 'rgba(239, 159, 39, 0.85)';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._formatNumber(highScore), leftMargin + crownSize * 2 + 6, crownY);
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

    const slotRadius = 36;
    const slotSpacing = 92;        // 槽位中心间距
    const centerX = this.width / 2;
    const centerY = this.height - 115;
    const types = ['clear', 'upgrade', 'pause'];

    // 每槽配色（使用状态：实色；数量 0：降透明 + 降饱和 → 用统一灰色）
    const iconColors = {
      clear:   '#EF9F27',  // 暖金
      upgrade: '#5DCAA5',  // 绿松
      pause:   '#7F77DD',  // 冷紫
    };

    this.itemBarSlots = [];

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const count = items.inventory[type];
      const active = count > 0;
      const cx = centerX + (i - 1) * slotSpacing; // i=0 → -1, i=1 → 0, i=2 → +1
      const cy = centerY;

      // 槽位底盘
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.arc(cx, cy, slotRadius, 0, Math.PI * 2);
      ctx.fill();

      // 槽位边框
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, slotRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 图标
      const iconColor = active ? iconColors[type] : 'rgba(255, 255, 255, 0.3)';
      this._drawItemIcon(type, cx, cy, iconColor, active);

      // 数量文字（下方居中）
      ctx.fillStyle = active ? '#fff' : 'rgba(255, 255, 255, 0.35)';
      ctx.font = `${active ? 'bold ' : ''}15px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${count}`, cx, cy + slotRadius + 14);

      this.itemBarSlots.push({ type, x: cx, y: cy, r: slotRadius });
    }
  }

  /**
   * 在 (cx, cy) 绘制指定道具的几何图标。
   * @param {'clear'|'upgrade'|'pause'} type
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
      // 同心螺旋圈：3 圈弧线，半径递增，起点旋转 120° 错开
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      const radii = [9, 16, 22];
      for (let i = 0; i < radii.length; i++) {
        ctx.lineWidth = 3.2 - i * 0.5;
        const rotOffset = (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radii[i], rotOffset, rotOffset + Math.PI * 1.5);
        ctx.stroke();
      }
    } else if (type === 'upgrade') {
      // 向上三角 + 底部两条竖线（类似"加速"指示）
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 14);        // 顶尖
      ctx.lineTo(cx + 13, cy + 1);    // 右下
      ctx.lineTo(cx + 6, cy + 1);     // 右下内收
      ctx.lineTo(cx + 6, cy + 12);    // 右竖条底
      ctx.lineTo(cx - 6, cy + 12);    // 左竖条底
      ctx.lineTo(cx - 6, cy + 1);     // 左下内收
      ctx.lineTo(cx - 13, cy + 1);    // 左下
      ctx.closePath();
      ctx.fill();
    } else if (type === 'pause') {
      // 外围光晕环（"时间"感）
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;

      // 两条竖条
      ctx.fillStyle = color;
      const barW = 4;
      const barH = 17;
      const gap = 6;
      ctx.fillRect(cx - gap / 2 - barW, cy - barH / 2, barW, barH);
      ctx.fillRect(cx + gap / 2,        cy - barH / 2, barW, barH);
    }

    ctx.restore();
  }

  /**
   * 绘制底部核心等级 UI（原型样式：核心等级 | Lv.N Name）
   * @param {number} coreLevel
   */
  drawCoreLevelUI(coreLevel) {
    const { ctx } = this;
    const colors = ELEMENT_COLORS[coreLevel] || ELEMENT_COLORS[1];
    const name = ELEMENT_COLORS[coreLevel]?.name || '';
    const cx = this.width / 2;
    const y = this.height - 40;

    ctx.font = '16px Arial';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const label = '核心等级';
    const sep = '  |  ';
    const levelText = `Lv.${coreLevel} ${name}`;

    const labelWidth = ctx.measureText(label).width;
    const sepWidth = ctx.measureText(sep).width;
    const levelWidth = ctx.measureText(levelText).width;
    const totalWidth = labelWidth + sepWidth + levelWidth;
    let cursor = cx - totalWidth / 2;

    // 左侧标签（柔和白）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(label, cursor, y);
    cursor += labelWidth;

    // 分隔竖线（更淡）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillText(sep, cursor, y);
    cursor += sepWidth;

    // 右侧等级名（使用元素主色）
    ctx.fillStyle = colors.primary;
    ctx.fillText(levelText, cursor, y);
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
    const colors = ELEMENT_COLORS[coreLevel] || ELEMENT_COLORS[1];
    ctx.fillStyle = colors.primary;
    ctx.font = 'bold 24px Arial';
    ctx.fillText(
      `核心等级: Lv.${coreLevel} ${ELEMENT_COLORS[coreLevel]?.name || ''}`,
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
   * 绘制调试按钮（左下角小按钮，点击给三种道具各 +1）。
   * 仅在 game.js DEBUG_ITEMS=true 时调用。
   */
  drawDebugButton() {
    const { ctx } = this;
    const w = 60;
    const h = 32;
    const x = 12;
    const y = this.height - 44;

    ctx.save();
    ctx.fillStyle = 'rgba(155, 143, 226, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this._roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+1 ALL', x + w / 2, y + h / 2);
    ctx.restore();

    this.debugBtn = { x, y, width: w, height: h };
  }

  /**
   * 检测是否点击了调试按钮
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isDebugBtnHit(x, y) {
    if (!this.debugBtn) return false;
    const b = this.debugBtn;
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
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
