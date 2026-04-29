/**
 * 道具系统
 * 负责：库存管理、掉落物生命周期（flyIn → floating → blinking）、
 *       三种道具效果（清空 / 进化 / 磁吸）的执行与动效推进
 *
 * 统一规则：清空和进化均作用于全场最低等级的粒子
 */

const { GAME_CONFIG, msToFrames } = require('./config');
const { ELEMENT_COLORS, getElementColors } = require('./board');

/** 三种道具类型（顺序即道具栏顺序） */
const ITEM_TYPES = ['clear', 'upgrade', 'magnet'];

/** 道具冷却管理 */
const ItemCooldown = {
  lastUseTime: { magnet: 0, clear: 0, upgrade: 0 },

  isOnCooldown(itemType, now) {
    return (now - this.lastUseTime[itemType]) < GAME_CONFIG.items.cooldownMs;
  },

  getRemainingSeconds(itemType, now) {
    const remaining = GAME_CONFIG.items.cooldownMs - (now - this.lastUseTime[itemType]);
    return Math.max(0, Math.ceil(remaining / 1000));
  },

  getCooldownProgress(itemType, now) {
    return Math.min(1, (now - this.lastUseTime[itemType]) / GAME_CONFIG.items.cooldownMs);
  },

  triggerCooldown(itemType, now) {
    this.lastUseTime[itemType] = now;
  },

  reset() {
    this.lastUseTime = { magnet: 0, clear: 0, upgrade: 0 };
  },

  _pauseStartTime: 0,

  onPause(now) {
    this._pauseStartTime = now;
  },

  onResume(now) {
    if (this._pauseStartTime > 0) {
      const pausedDuration = now - this._pauseStartTime;
      for (const key in this.lastUseTime) {
        if (this.lastUseTime[key] > 0) {
          this.lastUseTime[key] += pausedDuration;
        }
      }
      this._pauseStartTime = 0;
    }
  },
};

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
    ItemCooldown.reset();
  }

  /** 给某种道具 +N（调试用 / 拾取到位后调用） */
  grant(type, count = 1) {
    if (!ITEM_TYPES.includes(type)) return;
    this.inventory[type] += count;
    this._triggerGainEffect(type);
  }

  _triggerGainEffect(type) {
    const GAIN_COLORS = {
      magnet:  'rgba(123,208,224,0.9)',
      clear:   'rgba(180,165,255,0.9)',
      upgrade: 'rgba(255,182,72,0.9)',
    };
    GameGlobal.itemGainState = GameGlobal.itemGainState || {};
    GameGlobal.itemGainState[type] = { gainedAt: Date.now() };
    const p = GameGlobal.particles;
    const slots = GameGlobal._rendererItemBarSlots;
    if (p && slots) {
      const slot = slots.find(s => s.type === type);
      if (slot) {
        p.spawn(slot.x, slot.y, GAIN_COLORS[type] || '#FFFFFF', 10, { speed: 4, life: 40, radius: 2 });
      }
    }
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
          this._triggerGainEffect(drop.type);
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

    const now = Date.now();
    if (ItemCooldown.isOnCooldown(type, now)) return false;

    let result = false;
    if (type === 'clear') {
      result = this._useClear(board, particles);
    } else if (type === 'upgrade') {
      result = this._useUpgrade(board, particles);
    } else if (type === 'magnet') {
      result = this._useMagnet(board, particles);
    }

    if (result) ItemCooldown.triggerCooldown(type, now);
    return result;
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
    const remaining = allParticles.filter(s => s.level !== minLevel);
    let secondMinLevel = null;
    if (remaining.length > 0) {
      secondMinLevel = Math.min(...remaining.map(s => s.level));
    }
    const targets = allParticles.filter(
      s => s.level === minLevel || s.level === secondMinLevel
    );

    this.inventory.clear -= 1;
    this._pendingEffect = { type: 'clear', targets, preFrames: 25, flashFrames: 12, frame: -25 };
    board.itemUseLocked = true;
    board._recomputeInputLock();
    return true;
  }

  /**
   * 进化道具：全场最低等级粒子全部 +1 级（0.2s 闪光 → 执行）
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
    const targets = allParticles.filter(s => s.level === minLevel);

    this.inventory.upgrade -= 1;
    this._pendingEffect = {
      type: 'upgrade', targets, preFrames: 30, frame: -30,
      executeFrames: 14, afterFrames: 12,
      executed: false, afterTriggered: false,
    };
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
    const targets = moves.map(m => m.slot);
    for (const move of moves) {
      move.fromPos = board.getSlotPosition(move.slot);
      move.toPos = board.getSlotPosition(move.targetSlot);
    }
    this._magnetAnim = { moves, targets, frame: -25, preFrames: 25, totalFrames: 30 };
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
        const colors = getElementColors(slot.level);
        particles.spawn(pos.x, pos.y, colors.primary, 16, { speed: 6, life: 35, radius: 2 });
        particles.spawn(pos.x, pos.y, colors.secondary, 8, { speed: 1.8, life: 22 });
        particles.spawn(pos.x, pos.y, 'rgba(180,165,255,0.6)', 6, { speed: 0.8, life: 45, radius: 3 });
        slot.level = null;
        slot.reserved = false;
        if (board.selectedSlot === slot) board.clearSelection();
      }
      this._startUseAnim('clear', board);
    } else if (type === 'upgrade') {
      for (const slot of targets) {
        slot.level += 1;
      }
      this._pendingUpgradedSlots = targets;
      this._startUseAnim('upgrade', board);
      return; // don't null _pendingEffect yet — afterFrames still pending
    }

    this._pendingEffect = null;
  }

  /** 磁吸动画结束 → 应用移动/合成 + 喷粒子 */
  _executeMagnet(board, particles, onMagnetComplete) {
    const mergedSlots = [];
    for (const move of this._magnetAnim.moves) {
      move.slot._magnetAnimating = false;
      const pos = board.getSlotPosition(move.targetSlot);
      const colors = getElementColors(move.level);

      if (move.action === 'move') {
        move.targetSlot.level = move.level;
        move.slot.level = null;
        particles.spawn(pos.x, pos.y, colors.primary, 6, { speed: 1.5, life: 18 });
      } else {
        move.targetSlot.level = move.level + 1;
        move.slot.level = null;
        const newColors = getElementColors(move.level + 1);
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
   * @param {() => void} [onClearComplete]
   *   清空道具 useAnim 结束时触发
   */
  update(board, particles, onUpgradeComplete, onMagnetComplete, onClearComplete) {
    // 磁吸动画推进
    if (this._magnetAnim) {
      this._magnetAnim.frame += 1;
      if (this._magnetAnim.frame < 0) {
        // 前摇阶段：不做状态修改，渲染层读 targets 画闪烁
      } else if (this._magnetAnim.frame === 0) {
        // 前摇结束，进入滑动阶段：标记 _magnetAnimating
        for (const move of this._magnetAnim.moves) {
          move.slot._magnetAnimating = true;
        }
      } else if (this._magnetAnim.frame >= this._magnetAnim.totalFrames) {
        this._executeMagnet(board, particles, onMagnetComplete);
      }
    }

    // 闪光延迟效果推进
    if (this._pendingEffect) {
      const pe = this._pendingEffect;
      pe.frame += 1;

      if (pe.type === 'clear') {
        if (pe.frame < 0) {
          // 前摇
        } else {
          if (pe.frame === 0) {
            for (const slot of pe.targets) slot._upgradeFlashFrame = pe.flashFrames;
          }
          for (const slot of pe.targets) {
            if (slot._upgradeFlashFrame > 0) slot._upgradeFlashFrame -= 1;
          }
          if (pe.frame >= pe.flashFrames) {
            this._executePendingEffect(board, particles);
          }
        }
      } else if (pe.type === 'upgrade') {
        if (pe.frame < 0) {
          if (pe.frame % 3 === 0) {
            for (const slot of pe.targets) {
              const pos = board.getSlotPosition(slot);
              particles.spawnConverge(pos.x, pos.y, 'rgba(255,216,135,0.95)', 2,
                { life: 20, minDistance: 30, maxDistance: 55, radius: 2 });
            }
          }
        } else if (pe.frame < pe.executeFrames) {
          if (!pe.executed) {
            pe.executed = true;
            this._executePendingEffect(board, particles);
          }
        } else if (pe.frame < pe.executeFrames + pe.afterFrames) {
          if (!pe.afterTriggered) {
            pe.afterTriggered = true;
            for (const slot of pe.targets) {
              const pos = board.getSlotPosition(slot);
              particles.spawn(pos.x, pos.y, 'rgba(255,216,135,0.85)', 7,
                { speed: 0.35, life: 28, radius: 2.5 });
            }
          }
        } else {
          this._pendingEffect = null;
        }
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
        const type = this.useAnim.type;
        const upgraded = this._pendingUpgradedSlots;
        this.useAnim = null;
        board.itemUseLocked = false;
        board._recomputeInputLock();
        this._pendingUpgradedSlots = null;

        if (type === 'upgrade' && upgraded && onUpgradeComplete) {
          onUpgradeComplete(upgraded);
        } else if (type === 'clear' && onClearComplete) {
          onClearComplete();
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

module.exports = { Items, ITEM_TYPES, ItemCooldown };
