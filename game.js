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
const { Items } = require('./js/items');
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

// ─── 游戏状态 ───

let gameState = 'playing'; // 'playing' | 'gameover'
let decorationTimer = 0;   // 装饰粒子计时器
let comboDisplay = { count: 0, x: 0, y: 0, timer: 0 }; // combo 显示

// 合成后流程状态机（pause → absorb → coreBurst → recovery）
let mergeFlowState = null;   // null | 'pause' | 'absorb' | 'coreBurst' | 'recovery'
let mergeFlowTimer = 0;
let mergeFlowAbsorbSlot = null;
let mergeFlowAbsorbProgress = 0;
let mergeFlowBurstFired = false;

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
  handleRestart
);
input.setReferences(board, renderer);

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

  // 绘制 UI
  renderer.drawScoreUI(score.total, score.highScore);
  renderer.drawCoreLevelUI(board.core.level);

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
