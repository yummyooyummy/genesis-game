/**
 * 道具系统
 * 负责：库存管理、掉落物生命周期（flyIn → floating → blinking）、
 *       三种道具效果（清空 / 进化 / 磁吸）的执行与动效推进
 *
 * 统一规则：清空和进化均作用于全场最低等级的粒子
 */

const { GAME_CONFIG, msToFrames } = require('./config');
const { ELEMENT_COLORS } = require('./board');
const playerData = require('./playerData');

/** 三种道具类型（顺序即道具栏顺序） */
const ITEM_TYPES = ['clear', 'upgrade', 'magnet'];

class Items {
  constructor() {
    /** 库存数量（按类型） */
    this.inventory = { clear: 0, upgrade: 0, magnet: 0 };

    /** 屏幕上悬浮/飞行中的掉落物（最多 2 个，对应左右两侧固定位） */
    this.drops = [];

    /**
     * 正在播放的使用动效（清空/升级时锁输入并做屏幕反馈）
     * { type: 'clear'|'upgrade', frame: number, totalFrames: number }
     */
    this.useAnim = null;

    /** 闪光延迟效果（0.2s 闪光 → 执行） */
    this._pendingEffect = null;

    /** 磁吸动画状态 */
    this._magnetAnim = null;

    /**
     * 使用失败提示（如"该道具暂时无法使用"）
     * { text: string, frame: number, totalFrames: number }
     */
    this.useFailHint = null;
  }

  /** 重置到初始状态（由 game.js 的 handleRestart 调用） */
  reset() {
    this.inventory = { clear: 0, upgrade: 0, magnet: 0 };
    this.drops = [];
    this.useAnim = null;
    this._pendingEffect = null;
    this._magnetAnim = null;
    this.useFailHint = null;
  }

  /** 给某种道具 +N（调试用 / 拾取到位后调用） */
  grant(type, count = 1) {
    if (!ITEM_TYPES.includes(type)) return;
    this.inventory[type] += count;
  }

  // ─── 掉落物系统 ───

  /**
   * 生成一个掉落物（从触发源飞向左/右悬浮位）。
   * @param {'clear'|'upgrade'|'magnet'} type
   * @param {number} sourceX - 触发源 x（合成中点 / 核心）
   * @param {number} sourceY - 触发源 y
   * @param {{left:{x,y}, right:{x,y}}} targetPositions - 左右两个固定悬浮位坐标
   */
  spawnDrop(type, sourceX, sourceY, targetPositions) {
    const leftOccupied = this.drops.find(d => d.slot === 'left');
    const rightOccupied = this.drops.find(d => d.slot === 'right');

    let slot;
    if (!leftOccupied && !rightOccupied) {
      slot = Math.random() < 0.5 ? 'left' : 'right';
    } else if (!leftOccupied) {
      slot = 'left';
    } else if (!rightOccupied) {
      slot = 'right';
    } else {
      // 两侧都有：覆盖 blinking 阶段且 phaseFrame 最大的
      const blinking = this.drops
        .filter(d => d.phase === 'blinking')
        .sort((a, b) => b.phaseFrame - a.phaseFrame);
      if (blinking.length > 0) {
        const victim = blinking[0];
        slot = victim.slot;
        this.drops = this.drops.filter(d => d !== victim);
      } else {
        // 两侧都在 flyIn/floating：直接入库，不丢弃
        this.inventory[type] += 1;
        return;
      }
    }

    const target = slot === 'left' ? targetPositions.left : targetPositions.right;
    this.drops.push({
      type,
      slot,
      phase: 'flyIn',
      phaseFrame: 0,
      totalFlyInFrames: msToFrames(GAME_CONFIG.items.flyInMs),
      startX: sourceX,
      startY: sourceY,
      targetX: target.x,
      targetY: target.y,
      pickingUp: false,
      pickupFrame: 0,
      pickupTotalFrames: msToFrames(GAME_CONFIG.items.flyToInventoryMs),
      pickupTargetX: 0,
      pickupTargetY: 0,
    });
  }

  /**
   * 玩家点击悬浮掉落物 → 开始飞向道具栏对应槽位。
   * @param {object} drop
   * @param {Array<{type,x,y,r}>} itemBarSlots - renderer.itemBarSlots
   */
  pickupDrop(drop, itemBarSlots) {
    if (drop.pickingUp) return;
    const targetSlot = itemBarSlots.find(s => s.type === drop.type);
    if (!targetSlot) return;
    drop.pickingUp = true;
    drop.pickupFrame = 0;
    drop.pickupTargetX = targetSlot.x;
    drop.pickupTargetY = targetSlot.y;
  }

  /**
   * 每帧推进所有掉落物的生命周期。
   */
  updateDrops() {
    const cfg = GAME_CONFIG.items;
    const floatFrames = msToFrames(cfg.dropDurationMs);
    const blinkFrames = msToFrames(cfg.blinkDurationMs);

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];

      // 拾取飞行中
      if (drop.pickingUp) {
        drop.pickupFrame += 1;
        if (drop.pickupFrame >= drop.pickupTotalFrames) {
          this.inventory[drop.type] += 1;
          this.drops.splice(i, 1);
        }
        continue;
      }

      drop.phaseFrame += 1;

      if (drop.phase === 'flyIn') {
        if (drop.phaseFrame >= drop.totalFlyInFrames) {
          drop.phase = 'floating';
          drop.phaseFrame = 0;
        }
      } else if (drop.phase === 'floating') {
        if (drop.phaseFrame >= floatFrames) {
          drop.phase = 'blinking';
          drop.phaseFrame = 0;
        }
      } else if (drop.phase === 'blinking') {
        if (drop.phaseFrame >= blinkFrames) {
          this.drops.splice(i, 1);
        }
      }
    }
  }

  /**
   * 通用前置条件：库存 > 0 且无其他动效冲突
   * 合成-吸附锁定 / 合成动画 / 道具自身动画期间禁止再次使用
   */
  canUse(type, board) {
    if (this.inventory[type] <= 0) return false;
    if (this._pendingEffect !== null) return false;
    if (this._magnetAnim !== null) return false;
    if (this.useAnim !== null) return false;
    if (board.mergeFlowLocked) return false;
    if (board.mergeAnimations.length > 0) return false;
    if (!board.initialSplitsComplete) return false;
    return true;
  }

  /**
   * 使用某个道具。所有可行性校验都在这里完成。
   * @param {'clear'|'upgrade'|'magnet'} type
   * @param {object} board
   * @param {object} particles
   * @returns {boolean} 是否成功使用（失败不扣库存）
   */
  use(type, board, particles) {
    if (!this.canUse(type, board)) return false;

    if (type === 'clear') {
      return this._useClear(board, particles);
    }

    if (type === 'upgrade') {
      return this._useUpgrade(board, particles);
    }

    if (type === 'magnet') {
      return this._useMagnet(board, particles);
    }

    return false;
  }

  /**
   * 清空道具：全场最低等级粒子全部消失（0.2s 闪光 → 执行）
   */
  _useClear(board, particles) {
    const allParticles = board.slots.filter(
      s => s.level !== null && !s.mergeAnimating && !s.reserved
    );
    if (allParticles.length === 0) {
      this._showFailHint('场上没有粒子');
      return false;
    }

    const minLevel = Math.min(...allParticles.map(s => s.level));
    const targets = allParticles.filter(s => s.level === minLevel);

    this.inventory.clear -= 1;
    for (const slot of targets) {
      slot._upgradeFlashFrame = 12;
    }
    this._pendingEffect = { type: 'clear', targets, delayFrames: 12 };
    board.itemUseLocked = true;
    board._recomputeInputLock();
    return true;
  }

  /**
   * 进化道具：全场最低等级粒子全部 +1 级（0.2s 闪光 → 执行）
   * 上限：最低等级 > maxLevel - 2 时无法使用
   */
  _useUpgrade(board, particles) {
    const allParticles = board.slots.filter(
      s => s.level !== null && !s.mergeAnimating && !s.reserved
    );
    if (allParticles.length === 0) {
      this._showFailHint('场上没有粒子');
      return false;
    }

    const minLevel = Math.min(...allParticles.map(s => s.level));
    const maxAllowed = playerData.loadPlayerData().maxLevel - 2;

    if (minLevel > maxAllowed) {
      this._showFailHint(`无法使用：最低 Lv.${minLevel} 超过上限`);
      return false;
    }

    const targets = allParticles.filter(s => s.level === minLevel);

    this.inventory.upgrade -= 1;
    for (const slot of targets) {
      slot._upgradeFlashFrame = 12;
    }
    this._pendingEffect = { type: 'upgrade', targets, delayFrames: 12 };
    board.itemUseLocked = true;
    board._recomputeInputLock();
    return true;
  }

  /**
   * 磁吸道具：所有粒子分层向内吸附一格（0.5s 流动动画）
   */
  _useMagnet(board, particles) {
    const moves = [];
    const plannedLevels = new Map();
    for (const s of board.slots) {
      plannedLevels.set(s, (s.mergeAnimating || s.reserved) ? null : s.level);
    }

    // Phase 1: outer → mid
    const outerParticles = board.getSlotsByRing('outer').filter(
      s => plannedLevels.get(s) !== null
    );
    for (const slot of outerParticles) {
      const result = this._findInwardTarget(board, slot, 'mid', plannedLevels);
      if (result) {
        const srcLevel = plannedLevels.get(slot);
        moves.push({ slot, targetSlot: result.target, action: result.action, level: srcLevel });
        plannedLevels.set(slot, null);
        plannedLevels.set(result.target, result.action === 'merge' ? srcLevel + 1 : srcLevel);
      }
    }

    // Phase 2: mid → inner（只移动原有中圈粒子，不移动刚从外圈到达的）
    const phase1Targets = new Set(moves.map(m => m.targetSlot));
    const midParticles = board.getSlotsByRing('mid').filter(s =>
      s.level !== null && !s.mergeAnimating && !s.reserved &&
      plannedLevels.get(s) !== null && !phase1Targets.has(s)
    );
    for (const slot of midParticles) {
      const result = this._findInwardTarget(board, slot, 'inner', plannedLevels);
      if (result) {
        const srcLevel = plannedLevels.get(slot);
        moves.push({ slot, targetSlot: result.target, action: result.action, level: srcLevel });
        plannedLevels.set(slot, null);
        plannedLevels.set(result.target, result.action === 'merge' ? srcLevel + 1 : srcLevel);
      }
    }

    if (moves.length === 0) {
      this._showFailHint('无法吸附');
      return false;
    }

    this.inventory.magnet -= 1;
    for (const move of moves) {
      move.fromPos = board.getSlotPosition(move.slot);
      move.toPos = board.getSlotPosition(move.targetSlot);
      move.slot._magnetAnimating = true;
    }
    this._magnetAnim = { moves, frame: 0, totalFrames: 30 };
    board.itemUseLocked = true;
    board._recomputeInputLock();
    return true;
  }

  /**
   * 磁吸辅助：在 targetRing 中找可吸附的目标（空位 → move，同级 → merge）
   */
  _findInwardTarget(board, slot, targetRing, plannedLevels) {
    const aligned = board._findAlignedInRing(slot, targetRing);
    if (!aligned) return null;

    const ringSlots = board.getSlotsByRing(targetRing);
    const count = ringSlots.length;
    const leftIdx = (aligned.slotIndex - 1 + count) % count;
    const rightIdx = (aligned.slotIndex + 1) % count;
    const left = ringSlots.find(s => s.slotIndex === leftIdx);
    const right = ringSlots.find(s => s.slotIndex === rightIdx);
    const candidates = [aligned];
    if (left) candidates.push(left);
    if (right) candidates.push(right);

    const srcLevel = plannedLevels.get(slot);
    for (const target of candidates) {
      const tLevel = plannedLevels.get(target);
      if (tLevel === null && !target.reserved) {
        return { target, action: 'move' };
      }
      if (tLevel === srcLevel && !target.mergeAnimating) {
        return { target, action: 'merge' };
      }
    }
    return null;
  }

  /** 启动使用动效 + 锁输入 */
  _startUseAnim(type, board) {
    this.useAnim = {
      type,
      frame: 0,
      totalFrames: GAME_CONFIG.items.itemUseAnimFrames,
    };
    board.itemUseLocked = true;
    board._recomputeInputLock();
  }

  /** 显示"该道具暂时无法使用"等提示，1.5s 自动消失 */
  _showFailHint(text) {
    this.useFailHint = {
      text,
      frame: 0,
      totalFrames: msToFrames(1500),
    };
  }

  /** 闪光延迟到期 → 执行实际效果 + 启动屏幕脉冲 */
  _executePendingEffect(board, particles) {
    const { type, targets } = this._pendingEffect;

    if (type === 'clear') {
      for (const slot of targets) {
        const pos = board.getSlotPosition(slot);
        const colors = ELEMENT_COLORS[slot.level] || ELEMENT_COLORS[1];
        particles.spawn(pos.x, pos.y, colors.primary, 12, { speed: 3, life: 28 });
        particles.spawn(pos.x, pos.y, colors.secondary, 8, { speed: 1.8, life: 22 });
        slot.level = null;
        slot.reserved = false;
        if (board.selectedSlot === slot) board.clearSelection();
      }
      this._startUseAnim('clear', board);
    } else if (type === 'upgrade') {
      for (const slot of targets) {
        slot.level += 1;
        const pos = board.getSlotPosition(slot);
        const colors = ELEMENT_COLORS[slot.level] || ELEMENT_COLORS[1];
        particles.spawn(pos.x, pos.y, colors.primary, 14, { speed: 2.8, life: 30 });
        particles.spawn(pos.x, pos.y, colors.secondary, 10, { speed: 1.8, life: 24 });
        particles.spawn(pos.x, pos.y, '#FFFFFF', 6, { speed: 2.2, life: 20, radius: 2 });
      }
      this._pendingUpgradedSlots = targets;
      this._startUseAnim('upgrade', board);
    }

    this._pendingEffect = null;
  }

  /** 磁吸动画结束 → 应用移动/合成 + 喷粒子 */
  _executeMagnet(board, particles, onMagnetComplete) {
    const mergedSlots = [];
    for (const move of this._magnetAnim.moves) {
      move.slot._magnetAnimating = false;
      const pos = board.getSlotPosition(move.targetSlot);
      const colors = ELEMENT_COLORS[move.level] || ELEMENT_COLORS[1];

      if (move.action === 'move') {
        move.targetSlot.level = move.level;
        move.slot.level = null;
        particles.spawn(pos.x, pos.y, colors.primary, 6, { speed: 1.5, life: 18 });
      } else {
        move.targetSlot.level = move.level + 1;
        move.slot.level = null;
        const newColors = ELEMENT_COLORS[move.level + 1] || ELEMENT_COLORS[1];
        particles.spawn(pos.x, pos.y, newColors.primary, 14, { speed: 3, life: 28 });
        particles.spawn(pos.x, pos.y, newColors.secondary, 8, { speed: 2, life: 22 });
        mergedSlots.push(move.targetSlot);
      }
      if (board.selectedSlot === move.slot) board.clearSelection();
    }

    this._magnetAnim = null;
    board.itemUseLocked = false;
    board._recomputeInputLock();

    if (onMagnetComplete) onMagnetComplete(mergedSlots);
  }

  /**
   * 每帧推进：闪光延迟 / useAnim 计时 / useFailHint 计时 / 升级闪光衰减。
   * 由 game.js 主循环调用。
   * @param {object} board
   * @param {object} particles
   * @param {(upgradedSlots:object[]) => void} [onUpgradeComplete]
   *   升级道具 useAnim 结束时触发，game.js 用它启动合成连锁
   */
  update(board, particles, onUpgradeComplete, onMagnetComplete) {
    // 磁吸动画推进
    if (this._magnetAnim) {
      this._magnetAnim.frame += 1;
      if (this._magnetAnim.frame >= this._magnetAnim.totalFrames) {
        this._executeMagnet(board, particles, onMagnetComplete);
      }
    }

    // 闪光延迟效果推进（0.2s 闪光 → 执行实际效果）
    if (this._pendingEffect) {
      for (const slot of this._pendingEffect.targets) {
        if (slot._upgradeFlashFrame > 0) slot._upgradeFlashFrame -= 1;
      }
      this._pendingEffect.delayFrames -= 1;
      if (this._pendingEffect.delayFrames <= 0) {
        this._executePendingEffect(board, particles);
      }
    }

    // 升级闪光帧数衰减（useAnim 期间残余）
    if (this._pendingUpgradedSlots) {
      for (const slot of this._pendingUpgradedSlots) {
        if (slot._upgradeFlashFrame > 0) slot._upgradeFlashFrame -= 1;
      }
    }

    // 使用动效推进，到点解锁输入 / 升级时通知 game.js 检查连锁
    if (this.useAnim) {
      this.useAnim.frame += 1;
      if (this.useAnim.frame >= this.useAnim.totalFrames) {
        const wasUpgrade = this.useAnim.type === 'upgrade';
        const upgraded = this._pendingUpgradedSlots;
        this.useAnim = null;
        board.itemUseLocked = false;
        board._recomputeInputLock();
        this._pendingUpgradedSlots = null;

        if (wasUpgrade && upgraded && onUpgradeComplete) {
          onUpgradeComplete(upgraded);
        }
      }
    }

    // 失败提示计时
    if (this.useFailHint) {
      this.useFailHint.frame += 1;
      if (this.useFailHint.frame >= this.useFailHint.totalFrames) {
        this.useFailHint = null;
      }
    }

  }
}

module.exports = { Items, ITEM_TYPES };
