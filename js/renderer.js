/**
 * Canvas 渲染器
 * 负责：暗色背景、轨道线、元素绘制、核心绘制、分数/等级 UI、游戏结束界面
 */

const { RING_CONFIG, RING_RADIUS_RATIO, ELEMENT_COLORS, getElementColors } = require('./board');
const { GAME_CONFIG, UI_CONFIG, getLevelNameEn, getLevelColor } = require('./config');
const { ItemCooldown } = require('./items');
const ItemIcons = require('./itemIcons');
const LS = require('./layoutScale');

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

  /** 清空画布并填充渐变背景 */
  clear() {
    const { ctx } = this;
    const stops = UI_CONFIG.backgroundGradient.stops;
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    for (const s of stops) grad.addColorStop(s.offset, s.color);
    ctx.fillStyle = grad;
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
  drawSlots(board, items) {
    const { ctx } = this;

    const pe = items && items._pendingEffect;
    const clearPre = pe && pe.type === 'clear' && pe.frame < 0 ? pe : null;
    const upgradePre = pe && pe.type === 'upgrade' && pe.frame < 0 ? pe : null;
    const bounceRec = GameGlobal.upgradedTargets;
    const bounceAlive = bounceRec && (Date.now() - bounceRec.upgradedAt) < 300;

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
        const r = board.getElementRadius(slot.level);
        const isClearTarget = clearPre && clearPre.targets.includes(slot);
        const isUpgradeTarget = upgradePre && upgradePre.targets.includes(slot);
        const isBounce = bounceAlive && bounceRec.slots.includes(slot);

        if (isBounce) {
          const bt = (Date.now() - bounceRec.upgradedAt) / 300;
          let scale;
          if (bt < 0.3) scale = 0.6 + 0.6 * (bt / 0.3);
          else scale = 1.2 - 0.2 * (1 - Math.pow(1 - (bt - 0.3) / 0.7, 3));
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.scale(scale, scale);
          ctx.translate(-pos.x, -pos.y);
          this._drawElement(pos.x, pos.y, slot.level, r);
          ctx.restore();
        } else {
          this._drawElement(pos.x, pos.y, slot.level, r);
        }

        if (isClearTarget) {
          const t = (clearPre.frame + clearPre.preFrames) / clearPre.preFrames;
          const pulse = Math.pow(Math.sin(t * Math.PI * 2), 2);
          ctx.save();
          ctx.globalAlpha = pulse * 0.45;
          ctx.fillStyle = 'rgba(255,60,60,1)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        if (isUpgradeTarget) {
          const t = (upgradePre.frame + upgradePre.preFrames) / upgradePre.preFrames;
          ctx.save();
          ctx.globalAlpha = t * 0.5;
          ctx.fillStyle = 'rgba(255,216,135,1)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          const shrinkR = r * (2.5 - t * 1.4);
          ctx.save();
          ctx.globalAlpha = t * 0.85;
          ctx.strokeStyle = 'rgba(255,216,135,0.9)';
          ctx.lineWidth = LS.ds(1.5 + t * 1.5);
          ctx.shadowColor = 'rgba(255,182,72,0.8)';
          ctx.shadowBlur = LS.ds(8 + t * 12);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, shrinkR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

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
        const t = anim.frame / anim.convergeFrames;
        const glowStrength = 0.4 + t * 0.4;
        this._drawMergeGlow(state.sourcePos.x, state.sourcePos.y, anim.sourceLevel, r, glowStrength);
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
    const { moves, targets, frame, preFrames, totalFrames } = items._magnetAnim;

    // 前摇阶段：目标粒子青色光环脉动
    if (frame < 0 && targets) {
      const { ctx } = this;
      const t = (frame + preFrames) / preFrames; // 0 → 1
      let pulse;
      if (t < 0.7) {
        const k = t / 0.7;
        pulse = Math.sin(k * Math.PI / 2);
      } else {
        pulse = 1;
      }
      for (const slot of targets) {
        if (slot.level === null) continue;
        const pos = board.getSlotPosition(slot);
        const ringRadius = board.getElementRadius(slot.level) * (1.2 + pulse * 0.5);
        ctx.save();
        ctx.globalAlpha = pulse * 0.85;
        ctx.strokeStyle = 'rgba(123,208,224,0.9)';
        ctx.lineWidth = LS.ds(2 + pulse * 1);
        ctx.shadowColor = 'rgba(123,208,224,0.8)';
        ctx.shadowBlur = LS.ds(8 + pulse * 10);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    // 滑动阶段
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

  _drawMergeGlow(x, y, level, radius, strength) {
    const colors = getElementColors(level);
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = strength;
    const grad = ctx.createRadialGradient(x, y, radius * 0.9, x, y, radius * 3.0);
    grad.addColorStop(0, colors.secondary);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 绘制顶部 UI — 左上角当前分数（大号）+ 历史最高分（小号 + 皇冠）
   * @param {number} score - 当前分数
   * @param {number} highScore - 历史最高分
   */
  drawScoreUI(score, highScore = 0) {
    const { ctx } = this;

    // 当前分数（大号白色，带千位分隔符）
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${LS.df(32)}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this._formatNumber(score), LS.dx(20), LS.dy(60));

    // 历史最高分（皇冠 + 小号金色）
    const crownSize = LS.ds(11);
    const crownX = LS.dx(26);
    const crownY = LS.dy(92);
    this._drawCrown(crownX, crownY, crownSize, '#EF9F27');

    ctx.fillStyle = '#EF9F27';
    ctx.font = `${LS.df(11)}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._formatNumber(highScore), LS.dx(44), LS.dy(92));
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

    const slotRadius = LS.ds(29);
    const slotStyles = {
      magnet:  { r: 123, g: 208, b: 224, label: '磁吸' },
      clear:   { r: 180, g: 165, b: 255, label: '清空' },
      upgrade: { r: 255, g: 182, b: 72,  label: '进化' },
    };
    const slotCenters = [
      { type: 'magnet',  cx: LS.dx(92),    cy: LS.dy(642) },
      { type: 'clear',   cx: LS.dx(187.5), cy: LS.dy(642) },
      { type: 'upgrade', cx: LS.dx(283),   cy: LS.dy(642) },
    ];

    this.itemBarSlots = [];

    const PRESS_DURATION_MS = 180;
    const pressState = GameGlobal.itemPressState;
    const pressNow = Date.now();
    let pressedType = null;
    if (pressState && pressNow - pressState.pressedAt < PRESS_DURATION_MS) {
      pressedType = pressState.type;
    }

    const GAIN_DURATION_MS = 300;
    const gainState = GameGlobal.itemGainState || {};

    for (const slot of slotCenters) {
      const { type, cx, cy } = slot;
      const style = slotStyles[type];
      const { r: cr, g: cg, b: cb } = style;
      const count = items.inventory[type];
      const active = count > 0;

      const isPressed = pressedType === type;
      const pressT = isPressed ? (pressNow - pressState.pressedAt) / PRESS_DURATION_MS : 1;
      const easeOut = 1 - Math.pow(1 - pressT, 2);
      const pressScale = isPressed ? (0.82 + 0.18 * easeOut) : 1.0;
      const pressBrightness = isPressed ? (1 + 0.5 * (1 - pressT)) : 1.0;
      const sr = slotRadius * pressScale;

      if (isPressed) {
        const haloRadius = slotRadius * (1.0 + pressT * 0.6);
        const haloAlpha = 0.6 * (1 - pressT);
        ctx.save();
        ctx.globalAlpha = haloAlpha;
        ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
        ctx.lineWidth = LS.ds(3);
        ctx.shadowBlur = LS.ds(16);
        ctx.shadowColor = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.shadowBlur = 0;
      }

      // 玻璃态圆形背景
      ctx.save();
      if (active) {
        ctx.shadowBlur = LS.ds(14);
        ctx.shadowColor = `rgba(${cr},${cg},${cb},${Math.min(0.55 * pressBrightness, 1.0)})`;
      }
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr);
      if (active) {
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.8)`);
        grad.addColorStop(0.65, `rgba(${cr},${cg},${cb},0.33)`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0.13)`);
      } else {
        grad.addColorStop(0, 'rgba(60,60,60,0.8)');
        grad.addColorStop(0.65, 'rgba(60,60,60,0.33)');
        grad.addColorStop(1, 'rgba(60,60,60,0.13)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = active
        ? `rgba(${cr},${cg},${cb},${Math.min(0.67 * pressBrightness, 1.0)})`
        : 'rgba(100,100,100,0.4)';
      ctx.lineWidth = LS.ds(1);
      ctx.stroke();
      ctx.restore();

      // 图标
      const iconColor = active ? '#FFFFFF' : '#5A5A5A';
      this._drawItemIcon(type, cx, cy, iconColor, active);

      // CD 视觉反馈
      const now = Date.now();
      if (ItemCooldown.isOnCooldown(type, now)) {
        const progress = ItemCooldown.getCooldownProgress(type, now);
        const remaining = ItemCooldown.getRemainingSeconds(type, now);

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(cx, cy, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + Math.PI * 2 * (1 - progress);
        ctx.arc(cx, cy, sr, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (remaining > 0) {
          ctx.save();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${LS.df(20)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(remaining, cx, cy);
          ctx.restore();
        }
      }

      // 数量徽章（始终显示，count=0 时淡化）
      {
        const badgeAlpha = count > 0 ? 1.0 : 0.45;
        const bx = cx + LS.ds(20);
        const by = cy - LS.ds(24);
        const bw = LS.ds(18);
        const bh = LS.ds(18);
        const br = LS.ds(9);

        let badgeScale = 1.0;
        let extraGlow = 0;
        const gs = gainState[type];
        if (gs && pressNow - gs.gainedAt < GAIN_DURATION_MS) {
          const gt = (pressNow - gs.gainedAt) / GAIN_DURATION_MS;
          if (gt < 0.3) {
            badgeScale = 0.5 + (1.6 - 0.5) * (gt / 0.3);
          } else {
            const k = (gt - 0.3) / 0.7;
            badgeScale = 1.6 - 0.6 * (1 - Math.pow(1 - k, 3));
          }
          extraGlow = (1 - gt) * 10;
        }

        ctx.save();
        ctx.globalAlpha *= badgeAlpha;
        ctx.translate(bx, by);
        ctx.scale(badgeScale, badgeScale);
        ctx.translate(-bx, -by);
        if (extraGlow > 0) {
          ctx.shadowColor = '#FFD887';
          ctx.shadowBlur = LS.ds(extraGlow);
        }
        ctx.fillStyle = 'rgba(10,14,39,0.85)';
        ctx.beginPath();
        const rx = bx - bw / 2, ry = by - bh / 2;
        ctx.moveTo(rx + br, ry);
        ctx.arcTo(rx + bw, ry, rx + bw, ry + bh, br);
        ctx.arcTo(rx + bw, ry + bh, rx, ry + bh, br);
        ctx.arcTo(rx, ry + bh, rx, ry, br);
        ctx.arcTo(rx, ry, rx + bw, ry, br);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.67)`;
        ctx.lineWidth = LS.ds(1);
        ctx.stroke();
        ctx.fillStyle = '#E8ECFF';
        ctx.font = `${LS.df(11)}px 'Space Grotesk', Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`×${count}`, bx, by);
        ctx.restore();
      }

      // 底部中文标签
      ctx.fillStyle = '#8891B8';
      ctx.font = `${LS.df(11)}px 'Noto Sans SC', Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(style.label, cx, cy + slotRadius + LS.ds(14));

      this.itemBarSlots.push({ type, x: cx, y: cy, r: slotRadius });
    }
    GameGlobal._rendererItemBarSlots = this.itemBarSlots;
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

    // PNG 图标优先
    const iconKey = type === 'upgrade' ? 'evolve' : type;
    const icon = ItemIcons[iconKey];
    if (icon && icon.width > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const iconSize = 26;
      ctx.drawImage(icon, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
      ctx.restore();
      return;
    }

    // Canvas fallback
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
    const fontSize = LS.df(14);

    // "核心等级"
    ctx.save();
    ctx.font = `${fontSize}px Arial`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = UI_CONFIG.color.textMuted;
    ctx.fillText('核心等级', LS.dx(24), LS.dy(755));

    // 分隔符
    ctx.fillText('|', LS.dx(88), LS.dy(755));

    // "Lv.X Name" 彩色
    ctx.fillStyle = getLevelColor(coreLevel);
    ctx.fillText(`Lv.${coreLevel} ${name}`, LS.dx(100), LS.dy(755));
    ctx.restore();

    // 底部分隔线
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, LS.dy(720));
    ctx.lineTo(LS.dx(375), LS.dy(720));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 绘制右下角暂停按钮（⏸ 双竖线）
   */
  drawPauseButton() {
    const { ctx } = this;
    const cx = LS.dx(339);
    const cy = LS.dy(755);
    const r = LS.ds(17);

    // 圆形背景
    ctx.save();
    ctx.fillStyle = 'rgba(30,40,80,0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,90,158,0.6)';
    ctx.lineWidth = LS.ds(1);
    ctx.stroke();
    ctx.restore();

    // 双竖条
    ctx.save();
    ctx.fillStyle = '#E8ECFF';
    const barW = LS.ds(3);
    const barH = LS.ds(12);
    const gap = LS.ds(5);
    ctx.fillRect(cx - gap / 2 - barW, cy - barH / 2, barW, barH);
    ctx.fillRect(cx + gap / 2, cy - barH / 2, barW, barH);
    ctx.restore();

    this.pauseBtnPos = { x: cx, y: cy, r: r + LS.ds(6) };
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
    ctx.font = `bold ${LS.df(20 + combo * 2)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText(`COMBO x${combo}!`, x, y - LS.ds(40));
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
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${LS.df(18)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(`+${popup.points}`, LS.dx(187.5), LS.dy(300) + yOffset);
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
    if (items.useAnim.type === 'clear') return;
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
    ctx.font = `bold ${LS.df(17)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hint.text, LS.dx(187.5), LS.dy(560));
    ctx.restore();
  }

  /**
   * 绘制掉落物（flyIn / floating / blinking / pickingUp 四阶段）。
   * @param {import('./items').Items} items
   */
  drawDrops(items) {
    const { ctx } = this;
    const iconColors = { magnet: '#7BD0E0', clear: '#B4A5FF', upgrade: '#FFB648' };

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
