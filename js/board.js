/**
 * 棋盘数据结构与逻辑
 * 核心 + 三层同心圆（内圈 6 / 中圈 12 / 外圈 18 = 37 格）
 * 负责：格子初始化、旋转更新、相邻判定、分裂、合成、combo 连锁、吸附检测
 */

const { GAME_CONFIG, msToFrames, secondsToFrames, getTimedSplitInterval } = require('./config');

/** 圈层配置 */
const RING_CONFIG = {
  inner: { count: 6, direction: 1 },   // 顺时针
  mid:   { count: 12, direction: -1 }, // 逆时针
  outer: { count: 18, direction: 1 },  // 顺时针
};

/** 旋转速度默认值（弧度/帧）— 实例字段 rotationSpeeds 覆盖此常量 */
const ROTATION_SPEED = 0.004;

/** 圈层绘制半径比例（相对棋盘半径） */
const RING_RADIUS_RATIO = {
  inner: 0.28,
  mid:   0.52,
  outer: 0.78,
};

/** 分裂机制参数（帧数基于 60fps，1 帧 ≈ 16.6ms） */
const INITIAL_SPLIT_COUNT = GAME_CONFIG.initialSplit.count;              // 来自配置
const SPLIT_INTERVAL_FRAMES = msToFrames(GAME_CONFIG.initialSplit.intervalMs); // 来自配置
const FLY_FRAMES = 18;                 // 元素从核心飞到目标格的帧数（约 300ms）
const CORE_PULSE_FRAMES = 15;          // 核心脉冲动画时长
const DEADLOCK_MIN_LEVEL1 = 2;         // 合成后 Lv.1 最低保障数量

/** 元素颜色表 */
const ELEMENT_COLORS = {
  1:  { name: 'Quark',    primary: '#9B8FE2', secondary: '#CECBF6' },
  2:  { name: 'Proton',   primary: '#7F77DD', secondary: '#AFA9EC' },
  3:  { name: 'Atom',     primary: '#378ADD', secondary: '#85B7EB' },
  4:  { name: 'Molecule', primary: '#185FA5', secondary: '#378ADD' },
  5:  { name: 'Cell',     primary: '#1D9E75', secondary: '#5DCAA5' },
  6:  { name: 'Organism', primary: '#0F6E56', secondary: '#1D9E75' },
  7:  { name: 'Land',     primary: '#639922', secondary: '#97C459' },
  8:  { name: 'Planet',   primary: '#378ADD', secondary: '#85B7EB' },
  9:  { name: 'Star',     primary: '#EF9F27', secondary: '#FAC775' },
  10: { name: 'Galaxy',   primary: '#7F77DD', secondary: '#CECBF6' },
};

const TRANSCEND_COLORS = { name: 'Transcend', primary: '#FFD700', secondary: '#FFF4B0' };

function getElementColors(level) {
  if (level >= 16) return TRANSCEND_COLORS;
  return ELEMENT_COLORS[level] || ELEMENT_COLORS[(level - 1) % 10 + 1];
}

class Board {
  /**
   * @param {number} boardRadius - 棋盘绘制半径（像素）
   * @param {number} centerX - 棋盘中心 x
   * @param {number} centerY - 棋盘中心 y
   */
  constructor(boardRadius, centerX, centerY) {
    this.boardRadius = boardRadius;
    this.centerX = centerX;
    this.centerY = centerY;

    // 核心
    this.core = { level: 1 };

    // 旋转偏移（弧度）
    this.rotation = { inner: 0, mid: 0, outer: 0 };

    // 格子数组
    this.slots = [];
    this._initSlots();

    // 分裂队列与动画状态
    this.queuedSplits = 0;         // 待分裂数量
    this.splitTimer = 0;           // 距离下一次分裂的帧数
    this.flyingElements = [];      // 正在从核心飞向目标格的元素
    this.corePulse = 0;            // 核心脉冲动画剩余帧数
    this.coreLevelUpFrame = 0;     // 核心升级放大动效剩余帧数
    this.inputLocked = false;      // 初始分裂/合成动画期间屏蔽输入
    this.initialSplitsComplete = false; // 初始 4 次分裂是否已全部完成（锁输入的判据之一）

    // 定时自动分裂状态
    this.gameFrame = 0;                                                       // 游戏帧计数（不因暂停重置）
    this.safePeriodFrames = secondsToFrames(GAME_CONFIG.timedSplit.safePeriodSeconds);
    this.warningFrames = secondsToFrames(GAME_CONFIG.timedSplit.preSplitWarningSeconds);
    this.timedSplitScheduledFrame = null;   // 下次定时分裂触发的帧号（null = 尚未排期）
    this.timedSplitWarningProgress = 0;     // 0..1 — 前摇进度（非前摇期间为 0）

    // 两步点击交互
    this.selectedSlot = null;      // 当前选中的格子（null = 未选中）

    // 合成动画队列（Stage 5）
    this.mergeAnimations = [];     // { slotA, slotB, sourceLevel, newLevel, frame, ... }

    // 合成后流程锁（由 game.js 的 mergeFlow 状态机控制）
    this.mergeFlowLocked = false;

    // 道具使用锁（由 items.js 的 useAnim 控制）
    this.itemUseLocked = false;

    // 定时分裂暂停剩余帧数（暂停道具设置；0 = 未暂停）
    this.timedSplitPauseFramesRemaining = 0;

    // 每圈旋转速度（弧度/帧）— 运行时可直接改：
    //   board.rotationSpeeds.inner = 0.006
    //   board.rotationSpeeds = { inner: X, mid: Y, outer: Z }
    // 方向由 RING_CONFIG[ring].direction 决定，不在此处控制
    this.rotationSpeeds = {
      inner: ROTATION_SPEED,
      mid:   ROTATION_SPEED,
      outer: ROTATION_SPEED,
    };

    // 开局自动排队 4 次分裂
    this.queueInitialSplits();
  }

  /** 初始化 37 个格子 */
  _initSlots() {
    this.slots = [];
    const rings = ['inner', 'mid', 'outer'];

    for (const ring of rings) {
      const count = RING_CONFIG[ring].count;
      for (let i = 0; i < count; i++) {
        this.slots.push({
          ring,
          slotIndex: i,
          level: null,         // null = 空
          reserved: false,     // 已被分裂队列锁定（即将到来的 Lv.1）
          baseAngle: (Math.PI * 2 * i) / count,
        });
      }
    }
  }

  // ─── 旋转 ───

  /** 每帧更新旋转偏移（使用 this.rotationSpeeds，可运行时调整） */
  updateRotation() {
    if (GameGlobal.TimeFreeze && GameGlobal.TimeFreeze.isFrozen()) return;
    for (const ring of ['inner', 'mid', 'outer']) {
      this.rotation[ring] += this.rotationSpeeds[ring] * RING_CONFIG[ring].direction;
    }
  }

  /**
   * 获取格子当前角度
   * @param {object} slot
   * @returns {number} 弧度
   */
  getCurrentAngle(slot) {
    return slot.baseAngle + this.rotation[slot.ring];
  }

  /**
   * 获取格子在 Canvas 上的 (x, y) 坐标
   * @param {object} slot
   * @returns {{x: number, y: number}}
   */
  getSlotPosition(slot) {
    const angle = this.getCurrentAngle(slot);
    const radius = this.boardRadius * RING_RADIUS_RATIO[slot.ring];
    return {
      x: this.centerX + Math.cos(angle) * radius,
      y: this.centerY + Math.sin(angle) * radius,
    };
  }

  // ─── 相邻判定 ───

  /**
   * 将角度规范化到 [0, 2π)
   */
  _normalizeAngle(angle) {
    let a = angle % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  /**
   * 两个角度之间的最小差值（绝对值）
   */
  _angleDiff(a1, a2) {
    let diff = Math.abs(this._normalizeAngle(a1) - this._normalizeAngle(a2));
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff;
  }

  /**
   * 判断两个格子是否相邻
   * @param {object} slotA
   * @param {object} slotB
   * @returns {boolean}
   */
  isAdjacent(slotA, slotB) {
    // 同圈相邻
    if (slotA.ring === slotB.ring) {
      const count = RING_CONFIG[slotA.ring].count;
      const diff = Math.abs(slotA.slotIndex - slotB.slotIndex);
      return diff === 1 || diff === count - 1; // 首尾相接
    }

    // 跨圈相邻：只允许相邻圈层（inner↔mid, mid↔outer）
    const adjacentRings = {
      inner: ['mid'],
      mid: ['inner', 'outer'],
      outer: ['mid'],
    };
    if (!adjacentRings[slotA.ring].includes(slotB.ring)) return false;

    // 计算当前角度差
    const angleA = this._normalizeAngle(this.getCurrentAngle(slotA));
    const angleB = this._normalizeAngle(this.getCurrentAngle(slotB));
    const diff = this._angleDiff(angleA, angleB);

    // 阈值：较大圈层的单格角度 × 0.5
    const outerRing = RING_CONFIG[slotA.ring].count > RING_CONFIG[slotB.ring].count
      ? slotA.ring : slotB.ring;
    const slotAngle = (Math.PI * 2) / RING_CONFIG[outerRing].count;
    const threshold = slotAngle * 0.5;

    return diff < threshold;
  }

  /**
   * 获取某格子的所有相邻且同级的格子
   * @param {object} slot
   * @returns {object[]}
   */
  getAdjacentSameLevel(slot) {
    if (slot.level === null) return [];
    return this.slots.filter(
      (s) => s !== slot && s.level === slot.level && this.isAdjacent(slot, s)
    );
  }

  /**
   * 判断格子是否与核心相邻（内圈所有格子始终与核心相邻）
   * @param {object} slot
   * @returns {boolean}
   */
  isAdjacentToCore(slot) {
    return slot.ring === 'inner';
  }

  // ─── 核心分裂 ───

  /** 排队开局 4 次连续分裂，期间屏蔽玩家输入 */
  queueInitialSplits() {
    this.initialSplitsComplete = false;
    this.inputLocked = true;
    this.queuedSplits = INITIAL_SPLIT_COUNT;
    this.splitTimer = 0; // 下一帧立即触发第一次
  }

  /** 追加 N 次分裂（合成后调用、死锁保险） */
  queueSplit(count = 1) {
    if (count <= 0) return;
    this.queuedSplits += count;
  }

  /**
   * 每帧推进分裂队列与飞行动画
   * @param {(target:object) => void} [onSplitStart] - 一次分裂触发时回调（用于播放发射粒子）
   * @param {(slot:object) => void} [onLand] - 飞行元素到达目标格时回调（用于落地粒子）
   */
  updateSplits(onSplitStart, onLand) {
    // 1) 队列计时：到点就从核心发射一个元素
    if (this.queuedSplits > 0) {
      if (this.splitTimer <= 0) {
        const target = this._findEmptyForSplit();
        if (target) {
          target.reserved = true;
          this.corePulse = CORE_PULSE_FRAMES;
          this.flyingElements.push({
            startX: this.centerX,
            startY: this.centerY,
            targetSlot: target,
            frame: 0,
            totalFrames: FLY_FRAMES,
          });
          this.queuedSplits -= 1;
          this.splitTimer = SPLIT_INTERVAL_FRAMES;
          if (onSplitStart) onSplitStart(target);
        }
      } else {
        this.splitTimer -= 1;
      }
    } else if (this.splitTimer > 0) {
      this.splitTimer -= 1;
    }

    // 2) 推进飞行动画，到达则落地
    for (let i = this.flyingElements.length - 1; i >= 0; i--) {
      const fly = this.flyingElements[i];
      fly.frame += 1;
      if (fly.frame >= fly.totalFrames) {
        fly.targetSlot.level = 1;
        fly.targetSlot.reserved = false;
        this.flyingElements.splice(i, 1);
        if (onLand) onLand(fly.targetSlot);
      }
    }

    // 3) 核心脉冲衰减
    if (this.corePulse > 0) this.corePulse -= 1;
    if (this.coreLevelUpFrame > 0) this.coreLevelUpFrame -= 1;

    // 4) 首次完成初始 4 次分裂：标记完成
    if (!this.initialSplitsComplete && this.queuedSplits === 0 && this.flyingElements.length === 0) {
      this.initialSplitsComplete = true;
    }
    // 重新计算输入锁
    this._recomputeInputLock();
  }

  /**
   * 根据当前状态重新计算输入锁：
   *  - 初始 4 次分裂尚未完成 → 锁
   *  - 有合成动画在进行中 → 锁
   *  - 合成后流程（mergeFlow）进行中 → 锁
   *  - 道具使用动效进行中（清空/升级）→ 锁
   *  - 否则 → 解锁
   * 合成后分裂（queueSplit + flying）不锁输入。
   */
  _recomputeInputLock() {
    this.inputLocked = !this.initialSplitsComplete
      || this.mergeAnimations.length > 0
      || this.mergeFlowLocked
      || this.itemUseLocked;
  }

  /**
   * 定时自动分裂：每帧调用一次。
   * 机制：游戏开始后 safePeriodSeconds 为安全期，期间不触发；之后按核心等级查表获取间隔，
   * 在触发前 preSplitWarningSeconds 秒进入前摇动效；到点从中/外圈空位池随机选一个分裂。
   * 空位池为空则跳过本次（不触发 game over），下一轮继续。
   *
   * @param {(target:object) => void} [onTimedSplitFire] - 本次定时分裂成功发射时的回调（用于额外粒子）
   */
  updateTimedSplit(onTimedSplitFire) {
    // 暂停道具：冻结定时分裂调度 — scheduledFrame 跟着 gameFrame 前进，保证"剩余帧"不变
    if (this.timedSplitPauseFramesRemaining > 0) {
      this.timedSplitPauseFramesRemaining -= 1;
      this.gameFrame += 1;
      if (this.timedSplitScheduledFrame !== null) {
        this.timedSplitScheduledFrame += 1;
      }
      this.timedSplitWarningProgress = 0;
      return;
    }

    this.gameFrame += 1;

    // 安全期内：不做任何调度
    if (this.gameFrame < this.safePeriodFrames) {
      this.timedSplitWarningProgress = 0;
      return;
    }

    // 安全期刚结束：安排第一次定时分裂
    if (this.timedSplitScheduledFrame === null) {
      const intervalSeconds = getTimedSplitInterval(this.core.level);
      this.timedSplitScheduledFrame = this.gameFrame + secondsToFrames(intervalSeconds);
      this.timedSplitWarningProgress = 0;
      return;
    }

    const framesUntilFire = this.timedSplitScheduledFrame - this.gameFrame;

    // 前摇进度：0 → 1（非前摇期间归 0）
    if (framesUntilFire > 0 && framesUntilFire <= this.warningFrames) {
      this.timedSplitWarningProgress = 1 - framesUntilFire / this.warningFrames;
    } else {
      this.timedSplitWarningProgress = 0;
    }

    // 到点触发
    if (framesUntilFire <= 0) {
      this._fireTimedSplit(onTimedSplitFire);
      const intervalSeconds = getTimedSplitInterval(this.core.level);
      this.timedSplitScheduledFrame = this.gameFrame + secondsToFrames(intervalSeconds);
      this.timedSplitWarningProgress = 0;
    }
  }

  /**
   * 发射一次定时分裂：按概率选圈（外 40%、中 40%、内 20%），再从该圈空位中随机选一个。
   * 若选中圈无空位则 fallback 到其余圈的空位池。
   *
   * @param {(target:object) => void} [onFire] - 成功发射时的回调
   * @returns {boolean} 是否成功发射
   */
  _fireTimedSplit(onFire) {
    const emptyByRing = { inner: [], mid: [], outer: [] };
    for (const s of this.slots) {
      if (s.level === null && !s.reserved) emptyByRing[s.ring].push(s);
    }
    const allEmpty = [...emptyByRing.outer, ...emptyByRing.mid, ...emptyByRing.inner];
    if (allEmpty.length === 0) return false;

    const r = Math.random();
    const pick = r < 0.4 ? 'outer' : r < 0.8 ? 'mid' : 'inner';
    const pool = emptyByRing[pick].length > 0 ? emptyByRing[pick] : allEmpty;
    const target = pool[Math.floor(Math.random() * pool.length)];
    target.reserved = true;
    this.corePulse = CORE_PULSE_FRAMES;
    this.flyingElements.push({
      startX: this.centerX,
      startY: this.centerY,
      targetSlot: target,
      frame: 0,
      totalFrames: FLY_FRAMES,
    });
    if (onFire) onFire(target);
    return true;
  }

  /**
   * 按统一的分裂位置规则寻找目标格（"已有 Lv.1"均含 reserved 飞行中）：
   *   Step 0  内圈无 Lv.1 + 内圈有空位 → 任意内圈空位（开局种子）
   *   P1      内圈同圈相邻于 Lv.1 的空位
   *   P2      中圈同圈相邻于 Lv.1 的空位
   *   P3      中圈无 Lv.1 + 内圈有 Lv.1 → 最对齐内圈 Lv.1 的中圈空位（中圈种子）
   *   P4      外圈同圈相邻于 Lv.1 的空位
   *   P5      外圈无 Lv.1 + 中圈有 Lv.1 → 最对齐中圈 Lv.1 的外圈空位（外圈种子）
   *   都失败  null（由上层触发游戏结束）
   */
  _findEmptyForSplit() {
    const ringEmpty = (ring) => this.slots.filter(
      (s) => s.ring === ring && s.level === null && !s.reserved
    );
    const ringHasLv1 = (ring) => this.slots.some(
      (s) => s.ring === ring && (s.level === 1 || s.reserved)
    );
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const innerEmpty = ringEmpty('inner');
    const innerHas = ringHasLv1('inner');

    // Step 0: 内圈种子（开局或内圈 Lv.1 被清空时）
    if (!innerHas && innerEmpty.length > 0) {
      return pickRandom(innerEmpty);
    }

    // P1: 内圈同圈相邻
    if (innerHas && innerEmpty.length > 0) {
      const found = this._findSameRingAdjacent('inner', innerEmpty);
      if (found) return found;
    }

    const midEmpty = ringEmpty('mid');
    const midHas = ringHasLv1('mid');

    // P2: 中圈同圈相邻
    if (midHas && midEmpty.length > 0) {
      const found = this._findSameRingAdjacent('mid', midEmpty);
      if (found) return found;
    }

    // P3: 中圈种子（对齐内圈 Lv.1）
    if (!midHas && innerHas && midEmpty.length > 0) {
      const found = this._findSeedAligned('inner', midEmpty);
      if (found) return found;
    }

    const outerEmpty = ringEmpty('outer');
    const outerHas = ringHasLv1('outer');

    // P4: 外圈同圈相邻
    if (outerHas && outerEmpty.length > 0) {
      const found = this._findSameRingAdjacent('outer', outerEmpty);
      if (found) return found;
    }

    // P5: 外圈种子（对齐中圈 Lv.1）
    if (!outerHas && midHas && outerEmpty.length > 0) {
      const found = this._findSeedAligned('mid', outerEmpty);
      if (found) return found;
    }

    return null;
  }

  /**
   * 在指定圈层的空位中，找"同圈相邻于 Lv.1（含 reserved）"的格子
   * @param {'inner'|'mid'|'outer'} ring
   * @param {object[]} emptySlots - 已过滤的该圈空位
   * @returns {object|null} 随机一个候选，或 null
   */
  _findSameRingAdjacent(ring, emptySlots) {
    const count = RING_CONFIG[ring].count;
    const lv1Indices = new Set(
      this.slots
        .filter((s) => s.ring === ring && (s.level === 1 || s.reserved))
        .map((s) => s.slotIndex)
    );
    if (lv1Indices.size === 0) return null;

    const candidates = emptySlots.filter((s) => {
      const prev = (s.slotIndex - 1 + count) % count;
      const next = (s.slotIndex + 1) % count;
      return lv1Indices.has(prev) || lv1Indices.has(next);
    });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * 种子对齐：在子圈空位中选"当前角度最接近任一父圈 Lv.1（含 reserved）"的一个
   * @param {'inner'|'mid'|'outer'} parentRing
   * @param {object[]} childEmptySlots
   * @returns {object|null}
   */
  _findSeedAligned(parentRing, childEmptySlots) {
    const anchors = this.slots.filter(
      (s) => s.ring === parentRing && (s.level === 1 || s.reserved)
    );
    if (anchors.length === 0) return null;

    const scored = childEmptySlots.map((c) => {
      const ca = this._normalizeAngle(this.getCurrentAngle(c));
      let minDiff = Infinity;
      for (const p of anchors) {
        const pa = this._normalizeAngle(this.getCurrentAngle(p));
        const d = this._angleDiff(ca, pa);
        if (d < minDiff) minDiff = d;
      }
      return { slot: c, diff: minDiff };
    });

    const overall = Math.min(...scored.map((x) => x.diff));
    const EPS = 1e-6;
    const ties = scored.filter((x) => x.diff - overall < EPS);
    return ties[Math.floor(Math.random() * ties.length)].slot;
  }

  /**
   * 合成后分裂专用：按核心等级查 spawnDistribution 确定圈层概率，
   * 加权随机选圈层，在该圈层内用"优先相邻空位"规则选具体位置。
   * 若目标圈层无空位则 fallback 到下一优先级。
   * @returns {object|null}
   */
  _findEmptyForMergeSplit() {
    const dist = GAME_CONFIG.spawnDistribution;
    let phase;
    if (this.core.level <= dist.earlyUntilCoreLevel) phase = dist.early;
    else if (this.core.level <= dist.midUntilCoreLevel) phase = dist.mid;
    else phase = dist.late;

    const ringEmpty = (ring) => this.slots.filter(
      (s) => s.ring === ring && s.level === null && !s.reserved
    );

    const rings = [
      { ring: 'inner', rate: phase.innerRate },
      { ring: 'mid',   rate: phase.midRate },
      { ring: 'outer', rate: phase.outerRate },
    ];

    // 加权随机选一个圈层
    const roll = Math.random();
    let cumulative = 0;
    let chosen = null;
    for (const r of rings) {
      cumulative += r.rate;
      if (roll < cumulative) { chosen = r.ring; break; }
    }
    if (!chosen) chosen = rings[rings.length - 1].ring;

    // chosen → 其余圈层（按 rate 降序）的顺序尝试
    const fallbackOrder = [chosen, ...rings
      .filter((r) => r.ring !== chosen)
      .sort((a, b) => b.rate - a.rate)
      .map((r) => r.ring)];

    for (const ring of fallbackOrder) {
      const empty = ringEmpty(ring);
      if (empty.length === 0) continue;
      const adj = this._findSameRingAdjacent(ring, empty);
      if (adj) return adj;
      return empty[Math.floor(Math.random() * empty.length)];
    }
    return null;
  }

  /**
   * 获取飞行元素当前插值位置（ease-out cubic）
   * @param {object} fly
   * @returns {{ x:number, y:number, t:number }}
   */
  getFlyingPosition(fly) {
    const t = Math.min(1, fly.frame / fly.totalFrames);
    const ease = 1 - Math.pow(1 - t, 3);
    const end = this.getSlotPosition(fly.targetSlot);
    return {
      x: fly.startX + (end.x - fly.startX) * ease,
      y: fly.startY + (end.y - fly.startY) * ease,
      t,
    };
  }

  /** 核心脉冲比例 0..1（渲染缩放/发光强度用） */
  getCorePulseRatio() {
    return CORE_PULSE_FRAMES > 0 ? this.corePulse / CORE_PULSE_FRAMES : 0;
  }

  getCoreLevelUpScale() {
    const total = 48;
    if (this.coreLevelUpFrame <= 0) return 1.0;
    const t = 1 - (this.coreLevelUpFrame / total);
    if (t < 0.3) {
      return 1.0 + 0.5 * (t / 0.3);
    }
    const k = (t - 0.3) / 0.7;
    return 1.5 - 0.5 * (1 - Math.pow(1 - k, 3));
  }

  /**
   * Lv.1 元素总数（含棋盘上已有 + 飞行中 + 队列待分裂）
   * 用于合成后的死锁保险：保证至少有 2 个 Lv.1 可合成
   */
  countLevel1Incoming() {
    let count = this.slots.filter((s) => s.level === 1).length;
    count += this.flyingElements.length;   // 飞行中必然是 Lv.1
    count += this.queuedSplits;             // 队列中也都是 Lv.1
    return count;
  }

  // ─── 合成 ───

  /** 选中某个格子（覆盖之前的选中） */
  selectSlot(slot) {
    this.selectedSlot = slot;
  }

  /** 清除当前选中 */
  clearSelection() {
    this.selectedSlot = null;
  }

  /**
   * 查找与某格子相邻且同级的最近一个（combo 连锁使用）
   * @param {object} slot
   * @returns {object|null}
   */
  findNearestAdjacentSameLevel(slot) {
    const neighbors = this.getAdjacentSameLevel(slot);
    if (neighbors.length === 0) return null;
    let closest = neighbors[0];
    let minDiff = Infinity;
    const slotAngle = this._normalizeAngle(this.getCurrentAngle(slot));
    for (const n of neighbors) {
      const d = this._angleDiff(slotAngle, this._normalizeAngle(this.getCurrentAngle(n)));
      if (d < minDiff) {
        minDiff = d;
        closest = n;
      }
    }
    return closest;
  }

  // ─── 合成动画（Stage 5）───

  /**
   * 启动一次合成动画：slotA 为"新元素落位点"，slotB 为被消耗。
   * 两格子立即标记 mergeAnimating = true（被 drawSlots 跳过、被 drawMergeAnimations 接管），
   * 实际的 level 写回发生在动画结束帧。
   *
   * @param {object} slotA
   * @param {object} slotB
   * @returns {object|null} 动画对象
   */
  startMergeAnimation(slotA, slotB) {
    if (!slotA || !slotB || slotA === slotB) return null;
    if (slotA.level === null || slotB.level === null) return null;

    slotA.mergeAnimating = true;
    slotB.mergeAnimating = true;
    this.inputLocked = true;

    const convergeFrames = GAME_CONFIG.mergeAnimation.convergeFrames;
    const popFrames = GAME_CONFIG.mergeAnimation.popFrames;

    const anim = {
      slotA,
      slotB,
      sourceLevel: slotA.level,
      newLevel: slotA.level + 1,
      frame: 0,
      convergeFrames,
      popFrames,
      totalFrames: convergeFrames + popFrames,
      burstFired: false,
    };
    this.mergeAnimations.push(anim);
    return anim;
  }

  /**
   * 每帧推进合成动画。
   * @param {(anim:object, midX:number, midY:number) => void} [onBurst]
   *   — 在聚合中点瞬间回调（用于喷粒子、刷新 combo 显示）
   * @param {(slotA:object, newLevel:number) => void} [onComplete]
   *   — 在一段动画结束时回调（用于连锁下一步、吸附、排下一次分裂）
   */
  updateMergeAnimations(onBurst, onComplete) {
    if (GameGlobal.TimeFreeze && GameGlobal.TimeFreeze.isFrozen()) return;
    for (let i = this.mergeAnimations.length - 1; i >= 0; i--) {
      const anim = this.mergeAnimations[i];
      anim.frame += 1;

      // 聚合结束瞬间：触发粒子爆发（仅一次）
      if (!anim.burstFired && anim.frame >= anim.convergeFrames) {
        anim.burstFired = true;
        const posA = this.getSlotPosition(anim.slotA);
        if (onBurst) onBurst(anim, posA.x, posA.y);
      }

      // 动画结束：写回状态、解除 mergeAnimating、触发完成回调
      if (anim.frame >= anim.totalFrames) {
        anim.slotA.level = anim.newLevel;
        anim.slotB.level = null;
        anim.slotB.reserved = false;
        anim.slotA.mergeAnimating = false;
        anim.slotB.mergeAnimating = false;
        this.mergeAnimations.splice(i, 1);
        if (onComplete) onComplete(anim.slotA, anim.newLevel);
      }
    }
    // 合成动画数量可能变化，重算输入锁
    this._recomputeInputLock();
  }

  /**
   * 计算一段合成动画当前帧的渲染状态（供 renderer 使用）
   *   - 聚合阶段：两元素从各自 slot 位置向中点滑动（ease-out），半径从 1.0 缩到 0.7
   *   - 弹出阶段：新元素从中点滑到 slotA 位置，半径 0.5 → 1.2 → 1.0
   *
   * @param {object} anim
   * @returns {{ phase:'converge'|'pop', ... }}
   */
  getMergeAnimationState(anim) {
    const posA = this.getSlotPosition(anim.slotA);
    const posB = this.getSlotPosition(anim.slotB);
    const mid = { x: posA.x, y: posA.y };

    if (anim.frame < anim.convergeFrames) {
      const t = anim.frame / anim.convergeFrames;
      const ease = 1 - Math.pow(1 - t, 3);
      const sourcePos = { x: posA.x, y: posA.y };
      const consumedPos = {
        x: posB.x + (posA.x - posB.x) * ease,
        y: posB.y + (posA.y - posB.y) * ease,
      };
      const radiusScale = 1;
      return { phase: 'converge', sourcePos, consumedPos, radiusScale, mid };
    }

    const pt = Math.min(1, (anim.frame - anim.convergeFrames) / anim.popFrames);
    let scale;
    if (pt < 0.5) {
      scale = 0.5 + (pt / 0.5) * 0.7;       // 0.5 → 1.2
    } else {
      scale = 1.2 - ((pt - 0.5) / 0.5) * 0.2; // 1.2 → 1.0
    }
    const newPos = { x: posA.x, y: posA.y };
    return { phase: 'pop', newPos, scale, mid };
  }

  /**
   * 获取一个格子的"几何邻居"用于绘制连接线。
   * 返回顺序：同圈左 / 同圈右 / 跨圈朝核心侧对齐 / 跨圈远离核心侧对齐。
   * 内圈不含"朝核心侧"（核心不画连接线），外圈不含"远离核心侧"。
   * 跨圈邻居 = 当前角度差最小的那一个（随旋转每帧变化）；连接线是否"可合成"由调用方另行判定。
   *
   * @param {object} slot
   * @returns {object[]} 最多 4 个邻居引用（内圈最多 3 个，外圈最多 3 个，中圈 4 个）
   */
  getNeighborsForConnection(slot) {
    const neighbors = [];
    const count = RING_CONFIG[slot.ring].count;
    const ringSlots = this.getSlotsByRing(slot.ring);

    // 同圈左/右（索引固定，不随旋转变化）
    const leftIdx = (slot.slotIndex - 1 + count) % count;
    const rightIdx = (slot.slotIndex + 1) % count;
    const left = ringSlots.find((s) => s.slotIndex === leftIdx);
    const right = ringSlots.find((s) => s.slotIndex === rightIdx);
    if (left) neighbors.push(left);
    if (right) neighbors.push(right);

    // 跨圈朝核心侧（inner→无；mid→inner；outer→mid）
    const towardCoreRing = { inner: null, mid: 'inner', outer: 'mid' }[slot.ring];
    if (towardCoreRing) {
      const aligned = this._findAlignedInRing(slot, towardCoreRing);
      if (aligned) neighbors.push(aligned);
    }

    // 跨圈远离核心侧（inner→mid；mid→outer；outer→无）
    const awayFromCoreRing = { inner: 'mid', mid: 'outer', outer: null }[slot.ring];
    if (awayFromCoreRing) {
      const aligned = this._findAlignedInRing(slot, awayFromCoreRing);
      if (aligned) neighbors.push(aligned);
    }

    return neighbors;
  }

  /**
   * 在 targetRing 中找出当前角度最接近 slot 的那一个格子
   * @param {object} slot
   * @param {'inner'|'mid'|'outer'} targetRing
   * @returns {object|null}
   */
  _findAlignedInRing(slot, targetRing) {
    const slotAngle = this._normalizeAngle(this.getCurrentAngle(slot));
    let best = null;
    let bestDiff = Infinity;
    for (const s of this.slots) {
      if (s.ring !== targetRing) continue;
      const a = this._normalizeAngle(this.getCurrentAngle(s));
      const d = this._angleDiff(slotAngle, a);
      if (d < bestDiff) {
        bestDiff = d;
        best = s;
      }
    }
    return best;
  }

  // ─── 吸附 ───

  /**
   * 检查棋盘上是否有等级 = 核心等级的元素
   * @returns {object|null} 需要吸附的格子，或 null
   */
  checkAbsorb() {
    return this.slots.find((s) => s.level === this.core.level) || null;
  }

  /**
   * 执行吸附：核心升级，格子清空
   * @param {object} slot
   * @returns {number} 新的核心等级
   */
  doAbsorb(slot) {
    slot.level = null;
    this.core.level += 1;
    return this.core.level;
  }

  // ─── 游戏状态 ───

  /**
   * 棋盘是否已满
   * @returns {boolean}
   */
  isFull() {
    return this.slots.every((s) => s.level !== null);
  }

  /**
   * 获取按圈层分组的格子
   * @param {string} ring
   * @returns {object[]}
   */
  getSlotsByRing(ring) {
    return this.slots.filter((s) => s.ring === ring);
  }

  /** 重置棋盘 */
  reset() {
    this.core.level = 1;
    this.rotation = { inner: 0, mid: 0, outer: 0 };
    for (const s of this.slots) {
      s.level = null;
      s.reserved = false;
      s.mergeAnimating = false;
      s._upgradeFlashFrame = 0;
    }
    this.queuedSplits = 0;
    this.splitTimer = 0;
    this.flyingElements = [];
    this.corePulse = 0;
    this.coreLevelUpFrame = 0;
    this.initialSplitsComplete = false;
    this.inputLocked = true;
    // 定时分裂状态也重置
    this.gameFrame = 0;
    this.timedSplitScheduledFrame = null;
    this.timedSplitWarningProgress = 0;
    // 选中状态 + 合成动画队列也重置
    this.selectedSlot = null;
    this.mergeAnimations = [];
    this.mergeFlowLocked = false;
    this.itemUseLocked = false;
    this.timedSplitPauseFramesRemaining = 0;
    // 重新排队开局 4 次分裂
    this.queueInitialSplits();
  }

  /**
   * 获取元素在格子中的显示半径
   * @param {number} level - 元素等级
   * @returns {number} 半径（像素）
   */
  getElementRadius(level) {
    // 低级小，高级大：8px ~ 20px
    return 8 + level * 1.2;
  }
}

module.exports = {
  Board,
  RING_CONFIG,
  RING_RADIUS_RATIO,
  ELEMENT_COLORS,
  ROTATION_SPEED,
  getElementColors,
};
