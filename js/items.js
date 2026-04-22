/**
 * 道具系统
 * 负责：库存管理、掉落物生命周期（flyIn → floating → blinking）、
 *       三种道具效果（清空 / 升级 / 暂停）的执行与动效推进
 *
 * 触发来源（由 game.js 调度）：
 *   - combo 连锁达到 comboTriggerCount → spawnDrop
 *   - 核心升级到 coreLevelForGift 及以上 → spawnDrop
 *
 * 拾取流程：floating 悬浮 → 玩家点击 → 飞向底部道具栏对应槽位 → 库存 +1
 */

const { GAME_CONFIG, msToFrames } = require('./config');
const { ELEMENT_COLORS } = require('./board');

/** 三种道具类型（顺序即道具栏顺序） */
const ITEM_TYPES = ['clear', 'upgrade', 'magnet'];

/** 圈层优先级（inner > mid > outer，用于"最密集圈"的 tie-breaker） */
const RING_ORDER = ['inner', 'mid', 'outer'];

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
      const ring = this._findDensestRingWithLv1(board);
      if (!ring) {
        this._showFailHint('该道具暂时无法使用');
        return false;
      }
      this.inventory.clear -= 1;
      this._useClear(board, particles, ring);
      return true;
    }

    if (type === 'upgrade') {
      return this._useUpgrade(board, particles);
    }

    return false;
  }

  /**
   * 找"最靠近满"且含有 Lv.1 的圈：
   *   1. 按"真实空位数"升序排序（空位少 = 更满）
   *   2. 并列时 inner > mid > outer（内圈更关键）
   *   3. 从最满开始找第一个有 Lv.1 的圈
   *   4. 所有圈都没有 Lv.1 → null（上层显示不可用提示）
   * @returns {'inner'|'mid'|'outer'|null}
   */
  _findDensestRingWithLv1(board) {
    const targetLevel = GAME_CONFIG.items.clearItemTargetLevel;

    const stats = RING_ORDER.map((ring) => {
      const slotsInRing = board.slots.filter((s) => s.ring === ring);
      const empty = slotsInRing.filter((s) => s.level === null && !s.reserved).length;
      const lv1 = slotsInRing.filter(
        (s) => s.level === targetLevel && !s.mergeAnimating
      ).length;
      return { ring, empty, lv1, order: RING_ORDER.indexOf(ring) };
    });

    stats.sort((a, b) => {
      if (a.empty !== b.empty) return a.empty - b.empty;
      return a.order - b.order;
    });

    for (const s of stats) {
      if (s.lv1 > 0) return s.ring;
    }
    return null;
  }

  /**
   * 清空道具效果：把 ring 上所有 Lv.1 清掉，每个消散时喷粒子，锁输入 18 帧。
   */
  _useClear(board, particles, ring) {
    const targetLevel = GAME_CONFIG.items.clearItemTargetLevel;
    const victims = board.slots.filter(
      (s) => s.ring === ring && s.level === targetLevel && !s.mergeAnimating
    );

    for (const slot of victims) {
      const pos = board.getSlotPosition(slot);
      const colors = ELEMENT_COLORS[slot.level] || ELEMENT_COLORS[1];
      particles.spawn(pos.x, pos.y, colors.primary,   12, { speed: 3,   life: 28 });
      particles.spawn(pos.x, pos.y, colors.secondary,  8, { speed: 1.8, life: 22 });
      slot.level = null;
      slot.reserved = false;
      if (board.selectedSlot === slot) board.clearSelection();
    }

    this._startUseAnim('clear', board);
  }

  /**
   * 升级道具效果：从 Lv.1-upgradeItemMaxSourceLevel 中随机选 N 个 +1。
   * 升级后可能形成相邻同级，useAnim 结束时通过 onUpgradeComplete 回调给 game.js，
   * 由 game.js 决定是否立即启动合成连锁。
   * @returns {boolean} 是否成功使用
   */
  _useUpgrade(board, particles) {
    const maxLevel = GAME_CONFIG.items.upgradeItemMaxSourceLevel;
    const count    = GAME_CONFIG.items.upgradeItemCount;

    const pool = board.slots.filter(
      (s) =>
        s.level !== null &&
        s.level >= 1 &&
        s.level <= maxLevel &&
        !s.mergeAnimating &&
        !s.reserved
    );

    if (pool.length === 0) {
      this._showFailHint('该道具暂时无法使用');
      return false;
    }

    this.inventory.upgrade -= 1;

    // Fisher-Yates 洗牌
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const targets = shuffled.slice(0, Math.min(count, shuffled.length));

    // 升级 + 闪光 + 粒子
    for (const slot of targets) {
      slot.level += 1;
      slot._upgradeFlashFrame = GAME_CONFIG.items.itemUseAnimFrames;
      const pos = board.getSlotPosition(slot);
      const colors = ELEMENT_COLORS[slot.level] || ELEMENT_COLORS[1];
      particles.spawn(pos.x, pos.y, colors.primary,   14, { speed: 2.8, life: 30 });
      particles.spawn(pos.x, pos.y, colors.secondary, 10, { speed: 1.8, life: 24 });
      particles.spawn(pos.x, pos.y, '#FFFFFF',         6, { speed: 2.2, life: 20, radius: 2 });
    }

    this._pendingUpgradedSlots = targets;
    this._startUseAnim('upgrade', board);
    return true;
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

  /**
   * 每帧推进：useAnim 计时 / useFailHint 计时 / 暂停倒计时镜像 / 升级闪光衰减 /
   * 暂停结束过渡特效。
   * 由 game.js 主循环调用。
   * @param {object} board
   * @param {object} particles
   * @param {(upgradedSlots:object[]) => void} [onUpgradeComplete]
   *   升级道具 useAnim 结束时触发，game.js 用它启动合成连锁
   */
  update(board, particles, onUpgradeComplete) {
    // 升级闪光帧数衰减
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
