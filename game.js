/**
 * 万物起源 GENESIS — 游戏入口
 *
 * 微信小游戏原生 Canvas 实现
 * 职责：Canvas 创建、模块实例化、requestAnimationFrame 主循环、游戏状态管理
 */

const { Board, ELEMENT_COLORS } = require('./js/board');
const Renderer = require('./js/renderer');
const Particles = require('./js/particles');
const Input = require('./js/input');
const Score = require('./js/score');
const { Items, ITEM_TYPES } = require('./js/items');
const { GAME_CONFIG, msToFrames } = require('./js/config');

// ─── Canvas 初始化 ───

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// 获取系统信息用于适配
const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || 2;
const screenWidth = sysInfo.windowWidth;
const screenHeight = sysInfo.windowHeight;

// 设置 Canvas 尺寸（逻辑像素 × 设备像素比）
canvas.width = screenWidth * dpr;
canvas.height = screenHeight * dpr;
ctx.scale(dpr, dpr);

// ─── 游戏参数 ───

/** 棋盘中心坐标（逻辑像素） */
const centerX = screenWidth / 2;
// 棋盘垂直中心：在顶部分数区（~110px）和底部等级栏（~55px from bottom）之间居中
const centerY = (110 + (screenHeight - 55)) / 2;

/** 棋盘半径（逻辑像素）— 外圈轨道贴近屏宽，留约 20px 边距 */
const boardRadius = Math.min(screenWidth * 0.445, (screenHeight - 165) * 0.5);

/** 掉落物左右悬浮位坐标（固定） */
const dropTargetPositions = {
  left:  { x: centerX - boardRadius * GAME_CONFIG.items.dropSlotOffsetX, y: centerY + boardRadius * GAME_CONFIG.items.dropSlotOffsetY },
  right: { x: centerX + boardRadius * GAME_CONFIG.items.dropSlotOffsetX, y: centerY + boardRadius * GAME_CONFIG.items.dropSlotOffsetY },
};

// ─── 游戏状态 ───

let gameState = 'playing'; // 'playing' | 'gameover'
let decorationTimer = 0;   // 装饰粒子计时器
let comboDisplay = { count: 0, x: 0, y: 0, timer: 0 }; // combo 显示

// 调试开关 — 上线前改为 false，保留按钮代码以备后续调试
const DEBUG_ITEMS = true;

// 合成后流程状态机（pause → absorb → coreBurst → recovery）
let mergeFlowState = null;   // null | 'pause' | 'absorb' | 'coreBurst' | 'recovery'
let mergeFlowTimer = 0;
let mergeFlowAbsorbSlot = null;
let mergeFlowAbsorbProgress = 0;
let mergeFlowBurstFired = false;
let lastBurstPos = { x: centerX, y: centerY }; // 最近一次合成爆发中点（供 combo 掉落定位）

// ─── 模块实例化 ───

const board = new Board(boardRadius, centerX, centerY);
const renderer = new Renderer(ctx, screenWidth, screenHeight);
const particles = new Particles();
const score = new Score();
const items = new Items();

const input = new Input(
  canvas,
  dpr,
  handleSlotTap,
  handleRestart,
  handleDebugTap,
  handleItemTap,
  handleDropTap
);
input.setReferences(board, renderer, items);

// ─── 游戏逻辑 ───

/**
 * 处理格子点击（两步点击交互）
 *  - 未选中 + 点到有元素格子 → 选中
 *  - 点到当前选中格子 → 取消选中
 *  - 已选中 + 点到相邻+同级格子 → 触发合成
 *  - 已选中 + 点到其他格子（不相邻或不同级）→ 切换选中
 * @param {object} slot
 */
function handleSlotTap(slot) {
  if (gameState !== 'playing') return;
  if (board.inputLocked) return;       // 初始分裂/合成动画期间屏蔽输入
  if (slot.reserved) return;           // 预定槽位（飞行未落地）不可点击
  if (slot.level === null) return;     // 空格不可选（防御性检查）

  const selected = board.selectedSlot;

  // 情况 1：未选中 → 选中当前格子
  if (!selected) {
    board.selectSlot(slot);
    return;
  }

  // 情况 2：点了当前选中格子 → 取消选中
  if (slot === selected) {
    board.clearSelection();
    return;
  }

  // 情况 3：相邻 + 同级 → 触发合成
  if (slot.level === selected.level && board.isAdjacent(selected, slot)) {
    board.clearSelection();
    performMerge(selected, slot);
    return;
  }

  // 情况 4：其他情况 → 切换选中到新格子
  board.selectSlot(slot);
}

/**
 * combo 达到阈值时触发一次道具掉落
 */
function checkComboDropTrigger() {
  if (score.combo > 0 && score.combo % GAME_CONFIG.items.comboTriggerCount === 0) {
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    items.spawnDrop(type, lastBurstPos.x, lastBurstPos.y, dropTargetPositions);
  }
}

/**
 * 执行一次玩家主动的合成（两步点击达成条件后）：启动动画，后续链路通过
 * updateMergeAnimations 的 onBurst / onComplete 回调推进。
 *
 * @param {object} slotA - 第一步选中的格子（新元素最终留在此处）
 * @param {object} slotB - 第二步点击的格子（将清空）
 */
function performMerge(slotA, slotB) {
  // 合法性已由 handleSlotTap 校验（相邻 + 同级 + 非空）
  score.resetCombo();
  const combo = score.incrementCombo();
  const newLevel = slotA.level + 1;
  score.addMergeScore(newLevel, combo);

  board.startMergeAnimation(slotA, slotB);
}

/**
 * 合成动画中点聚合瞬间：喷爆发粒子 + 刷新 combo 显示。
 * 每一步 combo 都会触发一次（包含玩家主动合成和自动连锁）。
 */
function handleMergeBurst(anim, midX, midY) {
  const colors = ELEMENT_COLORS[anim.newLevel] || ELEMENT_COLORS[1];
  particles.spawn(midX, midY, colors.primary, 16, { speed: 4, life: 32 });
  particles.spawn(midX, midY, colors.secondary, 10, { speed: 2.5, life: 22 });
  lastBurstPos = { x: midX, y: midY };

  if (score.combo >= 2) {
    comboDisplay = { count: score.combo, x: centerX, y: centerY, timer: 60 };
  }
}

/**
 * 合成动画结束后：检查 combo 连锁 → 进入 mergeFlow 状态机。
 * 连锁期间直接启动下一段合成动画；连锁终止后才进入 pause → absorb → coreBurst → recovery。
 */
function handleMergeComplete(slotA, newLevel) {
  // Combo 连锁：找相邻同级最近的一个，继续合成
  const nextPartner = board.findNearestAdjacentSameLevel(slotA);
  if (nextPartner) {
    const c = score.incrementCombo();
    const chainedLevel = slotA.level + 1;
    score.addMergeScore(chainedLevel, c);
    checkComboDropTrigger();
    board.startMergeAnimation(slotA, nextPartner);
    return;
  }

  // 连锁终止 — 进入 mergeFlow 状态机
  mergeFlowState = 'pause';
  mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.newElementPauseMs);
  board.mergeFlowLocked = true;
  board._recomputeInputLock();
}

/**
 * 每帧推进合成后流程状态机。
 */
function updateMergeFlow() {
  if (mergeFlowState === null) return;

  mergeFlowTimer -= 1;

  if (mergeFlowState === 'pause') {
    if (mergeFlowTimer <= 0) {
      const absorbSlot = board.checkAbsorb();
      if (absorbSlot) {
        mergeFlowAbsorbSlot = absorbSlot;
        mergeFlowAbsorbProgress = 0;
        absorbSlot.mergeAnimating = true;
        mergeFlowState = 'absorb';
        mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.absorbAnimMs);
      } else {
        mergeFlowState = 'recovery';
        mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.recoveryMs);
      }
    }
    return;
  }

  if (mergeFlowState === 'absorb') {
    const totalFrames = msToFrames(GAME_CONFIG.mergeFlow.absorbAnimMs);
    mergeFlowAbsorbProgress = 1 - mergeFlowTimer / totalFrames;
    if (mergeFlowAbsorbSlot && mergeFlowTimer % 3 === 0) {
      const pos = board.getSlotPosition(mergeFlowAbsorbSlot);
      const t = mergeFlowAbsorbProgress;
      const trailX = pos.x + (centerX - pos.x) * t;
      const trailY = pos.y + (centerY - pos.y) * t;
      const colors = ELEMENT_COLORS[mergeFlowAbsorbSlot.level] || ELEMENT_COLORS[1];
      particles.spawnTrail(trailX, trailY, colors.primary);
    }
    if (mergeFlowTimer <= 0) {
      mergeFlowAbsorbSlot.mergeAnimating = false;
      const newCoreLevel = board.doAbsorb(mergeFlowAbsorbSlot);
      score.addAbsorbScore(newCoreLevel);
      mergeFlowAbsorbSlot = null;
      mergeFlowBurstFired = false;
      mergeFlowState = 'coreBurst';
      mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.coreUpgradeBurstMs);
    }
    return;
  }

  if (mergeFlowState === 'coreBurst') {
    if (!mergeFlowBurstFired) {
      mergeFlowBurstFired = true;
      const coreColors = ELEMENT_COLORS[board.core.level] || ELEMENT_COLORS[1];
      particles.spawn(centerX, centerY, coreColors.primary, 24, { speed: 5, life: 45, radius: 4 });
      particles.spawn(centerX, centerY, coreColors.secondary, 16, { speed: 3, life: 35, radius: 3 });
      board.corePulse = 15;
    }
    if (mergeFlowTimer <= 0) {
      const nextAbsorb = board.checkAbsorb();
      if (nextAbsorb) {
        mergeFlowAbsorbSlot = nextAbsorb;
        mergeFlowAbsorbProgress = 0;
        nextAbsorb.mergeAnimating = true;
        mergeFlowState = 'absorb';
        mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.absorbAnimMs);
      } else {
        mergeFlowState = 'recovery';
        mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.recoveryMs);
      }
    }
    return;
  }

  if (mergeFlowState === 'recovery') {
    if (mergeFlowTimer <= 0) {
      mergeFlowState = null;
      board.mergeFlowLocked = false;
      board._recomputeInputLock();

      if (!board.isFull()) {
        // 合成后分裂：使用阶段性偏向算法
        const target = board._findEmptyForMergeSplit();
        if (target) {
          target.reserved = true;
          board.corePulse = 15;
          board.flyingElements.push({
            startX: board.centerX,
            startY: board.centerY,
            targetSlot: target,
            frame: 0,
            totalFrames: 18,
          });
        }
        // 死锁保险
        const lv1 = board.countLevel1Incoming();
        if (lv1 < 2) {
          board.queueSplit(2 - lv1);
        }
      } else {
        gameState = 'gameover';
        input.isGameOver = true;
      }
    }
    return;
  }
}

/**
 * 调试：点击屏幕左下角"+1 ALL"按钮 → 三种道具各 +1 + 生成一个随机掉落物
 * 仅在 DEBUG_ITEMS=true 时生效；上线前置 false
 */
function handleDebugTap() {
  if (!DEBUG_ITEMS) return;
  items.grant('clear', 1);
  items.grant('upgrade', 1);
  items.grant('pause', 1);
  // 同时生成一个随机掉落物用于测试拾取流程
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  items.spawnDrop(type, centerX, centerY, dropTargetPositions);
}

/**
 * 点击道具栏图标 → 使用对应道具
 * @param {'clear'|'upgrade'|'pause'} type
 */
function handleItemTap(type) {
  if (gameState !== 'playing') return;
  items.use(type, board, particles);
}

/**
 * 点击悬浮掉落物 → 拾取飞向道具栏
 * @param {object} drop
 */
function handleDropTap(drop) {
  if (gameState !== 'playing') return;
  if (!renderer.itemBarSlots) return;
  items.pickupDrop(drop, renderer.itemBarSlots);
}

/**
 * 升级道具 useAnim 结束后的回调：
 *  1) 若任一被升级的元素与相邻同级可合成 → 启动 combo 连锁
 *     （后续链由 handleMergeComplete 驱动；它结束后 mergeFlow 会自动检查吸附）
 *  2) 否则若存在等级 = 核心等级的元素 → 直接进入 mergeFlow pause 阶段
 *     让已有的 absorb → coreBurst → recovery 流程跑一次
 * @param {object[]} upgradedSlots
 */
function handleUpgradeComplete(upgradedSlots) {
  for (const slot of upgradedSlots) {
    if (slot.level === null) continue;        // 安全检查
    if (slot.mergeAnimating) continue;
    const partner = board.findNearestAdjacentSameLevel(slot);
    if (partner && !partner.mergeAnimating) {
      score.resetCombo();
      const combo = score.incrementCombo();
      const newLevel = slot.level + 1;
      score.addMergeScore(newLevel, combo);
      board.startMergeAnimation(slot, partner);
      return;  // 启动一个链就够了，handleMergeComplete 会继续 combo
    }
  }

  // 无相邻同级可合成，但升级可能把元素推到了核心等级 → 触发吸附流程
  if (board.checkAbsorb()) {
    mergeFlowState = 'pause';
    mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.newElementPauseMs);
    board.mergeFlowLocked = true;
    board._recomputeInputLock();
  }
}

/** 处理重新开始 */
function handleRestart() {
  board.reset();
  score.reset();
  particles.clear();
  items.reset();
  gameState = 'playing';
  input.isGameOver = false;
  comboDisplay = { count: 0, x: 0, y: 0, timer: 0 };
  decorationTimer = 0;
  mergeFlowState = null;
  mergeFlowTimer = 0;
  mergeFlowAbsorbSlot = null;
  mergeFlowAbsorbProgress = 0;
  mergeFlowBurstFired = false;
}

// ─── 主循环 ───

function gameLoop() {
  // === UPDATE ===

  if (gameState === 'playing') {
    // 旋转
    board.updateRotation();

    // 分裂队列 + 飞行动画推进
    board.updateSplits(
      // onSplitStart: 核心发射瞬间 — 在核心位置爆一小圈起飞粒子
      () => {
        particles.spawn(centerX, centerY, ELEMENT_COLORS[1].secondary, 8, {
          speed: 1.8,
          life: 18,
          radius: 2,
        });
      },
      // onLand: 元素落地到目标格 — 在格子位置播出生粒子
      (slot) => {
        const pos = board.getSlotPosition(slot);
        particles.spawn(pos.x, pos.y, ELEMENT_COLORS[1].secondary, 8, {
          speed: 2,
          life: 22,
          radius: 2,
        });
      }
    );

    // 定时自动分裂（与合成后分裂并行独立运行）
    board.updateTimedSplit(() => {
      // 定时分裂发射瞬间 — 核心处爆一圈更醒目的粒子（与初始分裂做视觉区分）
      particles.spawn(centerX, centerY, ELEMENT_COLORS[1].primary, 14, {
        speed: 2.8,
        life: 26,
        radius: 2.5,
      });
    });

    // 合成动画推进（玩家主动合成及 combo 连锁）
    board.updateMergeAnimations(handleMergeBurst, handleMergeComplete);

    // 合成后流程状态机
    updateMergeFlow();

    // 道具动效推进（使用动效计时 + 失败提示计时 + 暂停倒计时镜像 + 结束瞬间特效）
    // 升级道具 useAnim 结束时回调：尝试启动合成连锁
    items.update(board, particles, handleUpgradeComplete);

    // 掉落物生命周期推进（flyIn → floating → blinking → 消失 / 拾取飞行）
    items.updateDrops();

    // 为每个飞行中的元素沿路径撒尾迹粒子
    for (const fly of board.flyingElements) {
      const pos = board.getFlyingPosition(fly);
      particles.spawnTrail(pos.x, pos.y, ELEMENT_COLORS[1].primary);
    }

    // 所有暂态都清空后若棋盘仍满 → 游戏结束
    // 不检查 queuedSplits — 棋盘满时队列永远无法消耗
    if (
      board.isFull() &&
      board.flyingElements.length === 0 &&
      board.mergeAnimations.length === 0 &&
      mergeFlowState === null
    ) {
      board.queuedSplits = 0;
      gameState = 'gameover';
      input.isGameOver = true;
    }

    // combo 显示计时
    if (comboDisplay.timer > 0) {
      comboDisplay.timer -= 1;
    }

    // 装饰粒子（每 30 帧生成一轮）
    decorationTimer += 1;
    if (decorationTimer >= 30) {
      decorationTimer = 0;
      for (const slot of board.slots) {
        if (slot.level === null) continue;
        const pos = board.getSlotPosition(slot);
        const colors = ELEMENT_COLORS[slot.level] || ELEMENT_COLORS[1];
        particles.spawnDecoration(pos.x, pos.y, colors.secondary, board.getElementRadius(slot.level));
      }
    }
  }

  // 粒子更新（无论游戏状态）
  particles.update();

  // === RENDER ===

  ctx.save();

  // 清空背景
  renderer.clear();

  // 绘制轨道线
  renderer.drawTracks(centerX, centerY, boardRadius);

  // 绘制选中态连接线（在元素下层，作为相邻关系的背景提示）
  renderer.drawConnectionLines(board);

  // 绘制所有格子和元素（选中格 / 合成动画格 由后续专用函数绘制）
  renderer.drawSlots(board);

  // 绘制选中高亮（发光环 + 脉冲元素）
  renderer.drawSelectionHighlight(board);

  // 绘制核心（带脉冲缩放/发光 + 定时分裂前摇呼吸环）
  renderer.drawCore(centerX, centerY, board.core.level, board.getCorePulseRatio(), board.timedSplitWarningProgress);

  // 绘制从核心飞向目标格的新元素
  renderer.drawFlyingElements(board);

  // 绘制吸附飞行中的元素
  if (mergeFlowState === 'absorb' && mergeFlowAbsorbSlot) {
    const absPos = board.getSlotPosition(mergeFlowAbsorbSlot);
    const t = mergeFlowAbsorbProgress;
    const ease = 1 - Math.pow(1 - t, 3);
    const ax = absPos.x + (centerX - absPos.x) * ease;
    const ay = absPos.y + (centerY - absPos.y) * ease;
    const level = mergeFlowAbsorbSlot.level;
    const radius = board.getElementRadius(level) * (1 - ease * 0.4);
    renderer._drawElement(ax, ay, level, radius);
  }

  // 绘制合成动画（聚合 + 新元素弹出）
  renderer.drawMergeAnimations(board);

  // 绘制粒子
  particles.draw(ctx);

  // 道具使用期间的屏幕边缘脉冲（清空=暖金/升级=绿松）
  renderer.drawItemUseBurst(items);

  // 暂停道具视觉反馈（核心波纹 + 屏幕紫光 + 顶部倒计时）
  renderer.drawPauseOverlay(board, centerX, centerY);

  // 掉落物绘制（flyIn / floating / blinking / pickingUp）
  renderer.drawDrops(items);

  // 绘制 UI
  renderer.drawScoreUI(score.total, score.highScore);
  renderer.drawItemBar(items);
  renderer.drawCoreLevelUI(board.core.level);

  // 道具使用失败提示文字（在 UI 之上）
  renderer.drawUseFailHint(items);

  // 调试按钮（DEBUG_ITEMS=true 时在左下角显示）
  if (DEBUG_ITEMS) {
    renderer.drawDebugButton();
  }

  // combo 显示
  if (comboDisplay.timer > 0) {
    renderer.drawCombo(comboDisplay.count, comboDisplay.x, comboDisplay.y);
  }

  // 浮动得分
  renderer.drawScorePopup(score.lastScorePopup);

  // 游戏结束界面
  if (gameState === 'gameover') {
    renderer.drawGameOver(board.core.level, score.total);
  }

  ctx.restore();

  // 继续循环
  requestAnimationFrame(gameLoop);
}

// ─── 启动游戏 ───

requestAnimationFrame(gameLoop);
