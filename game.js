/**
 * 万物起源 GENESIS — 游戏入口
 *
 * 微信小游戏原生 Canvas 实现
 * 职责：Canvas 创建、模块实例化、requestAnimationFrame 主循环、游戏状态管理
 */

const { Board, ELEMENT_COLORS, getElementColors } = require('./js/board');
const Renderer = require('./js/renderer');
const Particles = require('./js/particles');
const Input = require('./js/input');
const Score = require('./js/score');
const { Items, ITEM_TYPES, ItemCooldown } = require('./js/items');
const { GAME_CONFIG, UI_CONFIG, msToFrames, getLevelColor, getLevelNameZh, getLevelNameEn } = require('./js/config');
const playerData = require('./js/playerData');
const ui = require('./js/uiHelpers');
const toast = require('./js/toastNotifications');
const ItemIcons = require('./js/itemIcons');
const ConfettiManager = require('./js/confettiParticles');

// ─── Canvas 初始化 ───

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// 获取系统信息用于适配
const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || 2;
const screenWidth = sysInfo.windowWidth;
const screenHeight = sysInfo.windowHeight;
const statusBarHeight = sysInfo.statusBarHeight || 20;

// 设置 Canvas 尺寸（逻辑像素 × 设备像素比）
canvas.width = screenWidth * dpr;
canvas.height = screenHeight * dpr;
ctx.scale(dpr, dpr);

// 初始化坐标缩放系统（必须在任何绘制函数之前）
const LayoutScale = require('./js/layoutScale');
const LS = LayoutScale;
LayoutScale.init(screenWidth, screenHeight);
console.log(`[LayoutScale] screen=${screenWidth}x${screenHeight}, scaleX=${LayoutScale.scaleX.toFixed(3)}, scaleY=${LayoutScale.scaleY.toFixed(3)}, scaleMin=${LayoutScale.scaleMin.toFixed(3)}`);

// ─── 游戏参数 ───

/** 棋盘中心坐标（逻辑像素） */
const centerX = LS.dx(187.5);
const centerY = LS.dy(400);

/** 棋盘半径（逻辑像素）— 设计稿 319/2 ≈ 159.5 */
const boardRadius = LS.ds(159.5);

/** 掉落物左右悬浮位坐标（固定） */
const dropTargetPositions = {
  left:  { x: centerX - boardRadius * GAME_CONFIG.items.dropSlotOffsetX, y: centerY + boardRadius * GAME_CONFIG.items.dropSlotOffsetY },
  right: { x: centerX + boardRadius * GAME_CONFIG.items.dropSlotOffsetX, y: centerY + boardRadius * GAME_CONFIG.items.dropSlotOffsetY },
};

// ─── 游戏状态 ───

// 游戏状态机
// 'menu'     → 开始界面
// 'playing'  → 游戏中
// 'paused'   → 暂停弹窗
// 'gameover' → 结束界面
let gameState = 'menu';
let gameOverButtons = null; // { restart, home, share } 每个 { x, y, w, h }
let menuButtons = null;     // { start: { x, y, w, h } }
let menuOrbitAngle = 0;
let pauseDialogButtons = null; // { resume, restart, home } 每个 { x, y, w, h }
let decorationTimer = 0;   // 装饰粒子计时器
let comboDisplay = { count: 0, x: 0, y: 0, timer: 0 }; // combo 显示

// 调试开关 — 上线前改为 false
const DEBUG_ITEMS = false;

// ─── 存档 + 单局追踪 ───

const savedData = playerData.loadPlayerData();
let sessionMaxLevel = 1;
let sessionStartMaxLevel = 1;
let sessionMaxCombo = 0;
let sessionMergeCount = 0;
let lastGameResult = null; // { isNewRecord, newlyUnlockedLevel } 供结束界面用
console.log('[存档] 读取成功');
console.log('[存档] 最高分', savedData.maxScore, '最高等级', savedData.maxLevel);

// 合成后流程状态机（pause → absorb → coreBurst → recovery）
let mergeFlowState = null;   // null | 'pause' | 'absorb' | 'coreBurst' | 'recovery'
let mergeFlowTimer = 0;
let mergeFlowAbsorbSlot = null;
let mergeFlowAbsorbProgress = 0;
let mergeFlowBurstFired = false;
let lastBurstPos = { x: centerX, y: centerY }; // 最近一次合成爆发中点（供 combo 掉落定位）

// 开局自动吸附状态：初始分裂落地后自动吸附 1 个 Lv.1 → 核心升 Lv.2
let openingAbsorbPending = true;
let openingAbsorbActive = false; // 开局吸附流程进行中（recovery 阶段跳过合成后分裂）

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
  null,
  handleItemTap,
  handleDropTap
);
input.setReferences(board, renderer, items);
input.onGameOverTouch = function (x, y) {
  if (isGameOverBtnHit(x, y, 'restart')) { handleRestart(); return; }
  if (isGameOverBtnHit(x, y, 'home'))    { handleHome(); return; }
  if (isGameOverBtnHit(x, y, 'share'))   { handleShare(); return; }
};
input.onMenuTouch = function (x, y) {
  if (menuButtons && menuButtons.start && ui.isPointInRect(x, y, menuButtons.start.x, menuButtons.start.y, menuButtons.start.w, menuButtons.start.h)) {
    handleStart();
  }
};
input.onPauseTap = handlePause;
input.onPausedTouch = function (x, y) {
  if (!pauseDialogButtons) return;
  if (ui.isPointInRect(x, y, pauseDialogButtons.resume.x, pauseDialogButtons.resume.y, pauseDialogButtons.resume.w, pauseDialogButtons.resume.h)) {
    handleResume();
    return;
  }
  if (ui.isPointInRect(x, y, pauseDialogButtons.restart.x, pauseDialogButtons.restart.y, pauseDialogButtons.restart.w, pauseDialogButtons.restart.h)) {
    handleRestart();
    return;
  }
  if (ui.isPointInRect(x, y, pauseDialogButtons.home.x, pauseDialogButtons.home.y, pauseDialogButtons.home.w, pauseDialogButtons.home.h)) {
    handleHome();
    return;
  }
};

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
 * combo=3: 随机 50% 清空 / 50% 磁吸
 * combo=4: 进化
 */
function checkComboDropTrigger() {
  const combo = score.combo;
  if (combo === 3) {
    const coreLv = board.core.level;
    const threshold = GAME_CONFIG.items.clearDropThreshold;
    const evolveChance = GAME_CONFIG.items.evolveDropChanceOnCombo3;
    const clearChance = coreLv <= threshold
      ? GAME_CONFIG.items.clearDropChanceEarly
      : GAME_CONFIG.items.clearDropChanceLate;
    const rand = Math.random();
    let type;
    if (rand < evolveChance) {
      type = 'upgrade';
    } else if (rand < evolveChance + clearChance) {
      type = 'clear';
    } else {
      type = 'magnet';
    }
    items.spawnDrop(type, lastBurstPos.x, lastBurstPos.y, dropTargetPositions);
  } else if (combo === 4) {
    items.spawnDrop('upgrade', lastBurstPos.x, lastBurstPos.y, dropTargetPositions);
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
  const colors = getElementColors(anim.newLevel);
  particles.spawn(midX, midY, colors.primary, 16, { speed: 4, life: 32 });
  particles.spawn(midX, midY, colors.secondary, 10, { speed: 2.5, life: 22 });
  lastBurstPos = { x: midX, y: midY };

  sessionMergeCount++;
  if (score.combo > sessionMaxCombo) sessionMaxCombo = score.combo;

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
      const colors = getElementColors(mergeFlowAbsorbSlot.level);
      particles.spawnTrail(trailX, trailY, colors.primary);
    }
    if (mergeFlowTimer <= 0) {
      mergeFlowAbsorbSlot.mergeAnimating = false;
      const newCoreLevel = board.doAbsorb(mergeFlowAbsorbSlot);
      // 追踪本局最高核心等级
      if (newCoreLevel > sessionMaxLevel) sessionMaxLevel = newCoreLevel;
      // 历史首次达到新等级 → 触发 toast + 立即更新存档
      const storedMaxLevel = playerData.loadPlayerData().maxLevel;
      if (newCoreLevel > storedMaxLevel) {
        toast.push(newCoreLevel);
        const pd = playerData.loadPlayerData();
        pd.maxLevel = newCoreLevel;
        playerData.savePlayerData(pd);
      }
      if (!openingAbsorbActive) {
        score.addAbsorbScore(newCoreLevel);
        // 核心升级赠送道具：进化 Lv.5/7/9...（奇数≥5）、清空 Lv.6/8/10...（偶数≥6）
        if (newCoreLevel >= 5 && newCoreLevel % 2 === 1) {
          items.spawnDrop('upgrade', centerX, centerY, dropTargetPositions);
        } else if (newCoreLevel >= 6 && newCoreLevel % 2 === 0) {
          items.spawnDrop('clear', centerX, centerY, dropTargetPositions);
        }
        // 磁吸分阶段赠送
        if (GAME_CONFIG.items.magnetRewardLevels.includes(newCoreLevel)) {
          items.spawnDrop('magnet', centerX, centerY, dropTargetPositions);
        }
      }
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
      const coreColors = getElementColors(board.core.level);
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

      // 开局吸附完成后不触发合成后分裂
      if (openingAbsorbActive) {
        openingAbsorbActive = false;
        return;
      }

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
        console.log('[状态] 切换到 gameOver');
        input.isGameOver = true;
        _saveOnGameOver();
      }
    }
    return;
  }
}


/**
 * 点击道具栏图标 → 使用对应道具
 * @param {'clear'|'upgrade'|'magnet'} type
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

/**
 * 磁吸道具动画结束后的回调：检查合成连锁 + 吸附
 * @param {object[]} mergedSlots - 磁吸过程中发生合成的目标格
 */
function handleMagnetComplete(mergedSlots) {
  // 先检查所有受影响的格子是否能触发合成连锁
  const allSlots = [...mergedSlots];
  for (const slot of allSlots) {
    if (slot.level === null || slot.mergeAnimating) continue;
    const partner = board.findNearestAdjacentSameLevel(slot);
    if (partner && !partner.mergeAnimating) {
      score.resetCombo();
      const combo = score.incrementCombo();
      const newLevel = slot.level + 1;
      score.addMergeScore(newLevel, combo);
      board.startMergeAnimation(slot, partner);
      return;
    }
  }

  // 无合成但可能有吸附
  if (board.checkAbsorb()) {
    mergeFlowState = 'pause';
    mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.newElementPauseMs);
    board.mergeFlowLocked = true;
    board._recomputeInputLock();
  }
}

/** 游戏结束时保存存档（两个 gameover 触发点共用） */
function _saveOnGameOver() {
  const result = playerData.updateAfterGame({
    score: score.total,
    maxLevelReached: sessionMaxLevel,
  });
  lastGameResult = {
    score: score.total,
    maxLevel: sessionMaxLevel,
    maxCombo: sessionMaxCombo,
    mergeCount: sessionMergeCount,
    isNewRecord: result.isNewRecord,
    newlyUnlockedLevel: sessionMaxLevel > sessionStartMaxLevel ? sessionMaxLevel : null,
  };
  console.log('[存档] 更新完成', JSON.stringify(lastGameResult));
}

/**
 * 绘制简化版星球（蓝色渐变圆 + 椭圆轨道环 + 高光）
 */
function drawPlanet(cx, cy, size) {
  const r = size / 2;
  ctx.save();

  // 蓝色径向渐变主体
  const grad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#7BD0E0');
  grad.addColorStop(0.6, '#4A7DB8');
  grad.addColorStop(1, '#1a3a6a');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(123,208,224,0.4)';
  ctx.shadowBlur = 30;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 椭圆轨道环（30° 倾斜）
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 6);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.4, r * 0.35, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180,165,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 左上高光
  const hlGrad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 0, cx - r * 0.35, cy - r * 0.35, r * 0.5);
  hlGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
  hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hlGrad;
  ctx.fill();

  ctx.restore();
}

/**
 * 绘制全局三段线性渐变背景
 */
function drawBgGradient() {
  const stops = UI_CONFIG.backgroundGradient.stops;
  const grad = ctx.createLinearGradient(0, 0, 0, screenHeight);
  for (const s of stops) grad.addColorStop(s.offset, s.color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, screenWidth, screenHeight);
}

/**
 * 绘制开始界面 — Stellar Marquee 极简版
 */
function drawMenuScreen() {
  // ── 背景 ──
  drawBgGradient();

  // ── 数据准备 ──
  const data = playerData.loadPlayerData();
  const hasRecord = (data.maxScore || 0) > 0;

  // ── 星球 ──
  const planetSize = hasRecord ? LS.ds(200) : LS.ds(220);
  const planetCY = hasRecord ? LS.dy(248) : LS.dy(290);
  drawPlanet(LS.dx(187.5), planetCY, planetSize);

  // ── 虚线轨道环（动画旋转） ──
  menuOrbitAngle += 0.002;
  const orbitSize = hasRecord ? LS.ds(228) : LS.ds(250);
  const orbitR = orbitSize / 2;
  ctx.save();
  ctx.translate(LS.dx(187.5), planetCY);
  ctx.rotate(-Math.PI / 6 + menuOrbitAngle);
  ctx.beginPath();
  ctx.ellipse(0, 0, orbitR, orbitR * 0.25, 0, 0, Math.PI * 2);
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(180,165,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── GENESIS 标题 ──
  const titleY = hasRecord ? LS.dy(400) : LS.dy(470);
  ui.drawText(ctx, 'GENESIS', LS.dx(187.5), titleY, {
    fontSize: LS.df(42),
    color: UI_CONFIG.color.textPrimary,
    weight: '600',
    glow: UI_CONFIG.glow.heroTitle,
    glowColor: UI_CONFIG.color.accentPurpleLight,
  });

  // ── 副标题 ──
  const subY = hasRecord ? LS.dy(430) : LS.dy(500);
  ui.drawText(ctx, '万 物 起 源', LS.dx(187.5), subY, {
    fontSize: LS.df(12),
    color: UI_CONFIG.color.textMuted,
    weight: 'normal',
  });

  // ── 开始按钮 ──
  const btnW = LS.ds(300);
  const btnH = LS.ds(52);
  const btnX = LS.dx(187.5) - btnW / 2;
  const btnY = LS.dy(700) - btnH / 2;

  // ── 版本号 ──
  ui.drawText(ctx, '万物起源 v1.0.0', LS.dx(187.5), LS.dy(758), {
    fontSize: LS.df(10.5),
    color: UI_CONFIG.color.textMuted,
  });

  if (hasRecord) {
    // ── 金色奖牌卡（左右两列布局）──
    const cardW = LS.ds(300);
    const cardH = LS.ds(108);
    const cardX = LS.dx(187.5) - cardW / 2;
    const cardY = LS.dy(520) - cardH / 2;
    ui.drawGoldCard(ctx, cardX, cardY, cardW, cardH);

    // 4 点星装饰（卡片右上角内侧）
    const spkX = LS.dx(320);
    const spkY = LS.dy(478);
    const spkR = LS.ds(6);
    ctx.save();
    ctx.fillStyle = '#FFD887';
    ctx.beginPath();
    ctx.moveTo(spkX, spkY - spkR);
    ctx.quadraticCurveTo(spkX + spkR * 0.25, spkY - spkR * 0.25, spkX + spkR, spkY);
    ctx.quadraticCurveTo(spkX + spkR * 0.25, spkY + spkR * 0.25, spkX, spkY + spkR);
    ctx.quadraticCurveTo(spkX - spkR * 0.25, spkY + spkR * 0.25, spkX - spkR, spkY);
    ctx.quadraticCurveTo(spkX - spkR * 0.25, spkY - spkR * 0.25, spkX, spkY - spkR);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 左列："最高纪录" 标签 + 分数
    ui.drawText(ctx, '最高纪录', LS.dx(108), LS.dy(494), {
      fontSize: LS.df(11),
      color: '#FFD887',
    });
    ui.drawText(ctx, (data.maxScore || 0).toLocaleString(), LS.dx(108), LS.dy(518), {
      fontSize: LS.df(32),
      color: '#FFD887',
      weight: '700',
      glow: 8,
      glowColor: 'rgba(255,215,0,0.3)',
    });

    // 中间竖线（渐变虚线，高 72，中心 y=520）
    const lineTop = LS.dy(484);
    const lineBot = LS.dy(556);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(180,165,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LS.dx(187.5), lineTop);
    ctx.lineTo(LS.dx(187.5), lineBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 右列："最高等级" 标签 + 彩点 + 等级名
    const lvl = data.maxLevel || 1;
    const lvColor = getLevelColor(lvl);
    const lvName = getLevelNameZh(lvl);

    ui.drawText(ctx, '最高等级', LS.dx(267), LS.dy(494), {
      fontSize: LS.df(11),
      color: UI_CONFIG.color.textMuted,
    });

    // 彩色小圆点
    ctx.save();
    ctx.fillStyle = lvColor;
    ctx.shadowColor = lvColor + '99';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(LS.dx(224), LS.dy(526), LS.ds(5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // "Lv.X 名字"
    ui.drawText(ctx, 'Lv.' + lvl + ' ' + lvName, LS.dx(277), LS.dy(526), {
      fontSize: LS.df(18),
      color: lvColor,
      weight: '600',
      glow: 6,
      glowColor: lvColor,
    });
  }

  // ── "开始游戏" 主按钮 ──
  if (!hasRecord) {
    const breathe = UI_CONFIG.ctaButton.breathe;
    const pulse = (Math.sin(Date.now() / (breathe.durationMs / 2) * Math.PI) + 1) / 2;
    const glowRadius = breathe.minGlow + pulse * (breathe.maxGlow - breathe.minGlow);
    ctx.save();
    ctx.shadowColor = UI_CONFIG.ctaButton.outerGlow.color;
    ctx.shadowBlur = glowRadius;
    ctx.fillStyle = 'rgba(0,0,0,0.01)';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.restore();
  }
  ui.drawPrimaryButton(ctx, btnX, btnY, btnW, btnH, '开始游戏', { useCta: true });
  menuButtons = { start: { x: btnX, y: btnY, w: btnW, h: btnH } };
}

/**
 * 绘制结束界面（静态布局，不处理触摸）
 * 数据来源：lastGameResult + playerData
 */
function drawGameOverScreen() {
  // ── 背景 ──
  drawBgGradient();

  // ── 数据准备 ──
  const data = lastGameResult || {};
  const curScore = data.score || 0;
  const maxLevel = data.maxLevel || 1;
  const maxScore = playerData.loadPlayerData().maxScore || 0;
  const levelName = getLevelNameZh(maxLevel);
  const isNewRecord = !!(data.isNewRecord);

  // ── 破纪录金色粒子 ──
  if (data.isNewRecord) {
    if (!ConfettiManager.initialized) ConfettiManager.init(screenWidth, screenHeight);
    ConfettiManager.update();
    ConfettiManager.draw(ctx);
  }

  // ── 标题 "游戏结束" ──
  ui.drawText(ctx, '游戏结束', LS.dx(187.5), LS.dy(125), {
    fontSize: LS.df(26),
    color: UI_CONFIG.color.textPrimary,
    weight: '600',
  });

  // ── 标题渐变线 ──
  ctx.save();
  ctx.strokeStyle = UI_CONFIG.color.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LS.dx(187.5) - LS.ds(30), LS.dy(150));
  ctx.lineTo(LS.dx(187.5) + LS.ds(30), LS.dy(150));
  ctx.stroke();
  ctx.restore();

  // ── 分数卡片（中心 187.5, 230，尺寸 319×108）──
  const cardW = LS.ds(319);
  const cardH = LS.ds(108);
  const cardX = LS.dx(187.5) - cardW / 2;
  const cardY = LS.dy(230) - cardH / 2;
  ui.drawGlassCard(ctx, cardX, cardY, cardW, cardH);

  // 第 1 行：本局分数
  ui.drawText(ctx, '本局分数', LS.dx(48), LS.dy(204), {
    fontSize: LS.df(12.5),
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });
  ui.drawText(ctx, String(curScore), LS.dx(327), LS.dy(204), {
    fontSize: LS.df(26),
    color: UI_CONFIG.color.textPrimary,
    align: 'right',
    weight: '700',
  });

  // 卡内分隔线
  const divW = LS.ds(291);
  ctx.save();
  ctx.strokeStyle = UI_CONFIG.color.borderSoft;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(LS.dx(187.5) - divW / 2, LS.dy(234));
  ctx.lineTo(LS.dx(187.5) + divW / 2, LS.dy(234));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 第 2 行：最高分数
  const highScoreColor = isNewRecord ? UI_CONFIG.color.accentGold : UI_CONFIG.color.textPrimary;

  ui.drawText(ctx, '最高分数', LS.dx(48), LS.dy(260), {
    fontSize: LS.df(12.5),
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });

  if (isNewRecord) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,182,72,0.60)';
    ctx.shadowBlur = UI_CONFIG.glow.recordGold;
  }
  ui.drawText(ctx, String(maxScore), LS.dx(327), LS.dy(260), {
    fontSize: LS.df(22),
    color: highScoreColor,
    align: 'right',
    weight: '700',
  });
  if (isNewRecord) ctx.restore();

  // NEW! 徽章
  if (isNewRecord) {
    const badgeFontSize = LS.df(9);
    const badgeW = LS.ds(38);
    const badgeH = LS.ds(18);
    const badgeX = LS.dx(236);
    const badgeY = LS.dy(260) - badgeH / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(138,127,209,0.50)';
    ctx.shadowBlur = 10;
    const grad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
    grad.addColorStop(0, UI_CONFIG.color.accentPurple);
    grad.addColorStop(1, UI_CONFIG.color.accentPurpleLight);
    ctx.fillStyle = grad;
    const r = badgeH / 2;
    ctx.beginPath();
    ctx.moveTo(badgeX + r, badgeY);
    ctx.lineTo(badgeX + badgeW - r, badgeY);
    ctx.arc(badgeX + badgeW - r, badgeY + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(badgeX + r, badgeY + badgeH);
    ctx.arc(badgeX + r, badgeY + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ui.drawText(ctx, 'NEW!', badgeX + badgeW / 2, badgeY + badgeH / 2, {
      fontSize: badgeFontSize,
      color: '#FFFFFF',
      weight: '600',
    });
  }

  // ── 详情区（3 行）──
  const details = [
    { label: '核心等级', value: 'Lv.' + maxLevel + ' ' + levelName, valueColor: UI_CONFIG.color.accentCyan, y: 328 },
    { label: '最高连锁', value: String(data.maxCombo || 0), valueColor: UI_CONFIG.color.textPrimary, y: 358 },
    { label: '合成次数', value: String(data.mergeCount || 0), valueColor: UI_CONFIG.color.textPrimary, y: 388 },
  ];

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    ui.drawText(ctx, d.label, LS.dx(52), LS.dy(d.y), {
      fontSize: LS.df(12),
      color: UI_CONFIG.color.textMuted,
      align: 'left',
    });
    ui.drawText(ctx, d.value, LS.dx(323), LS.dy(d.y), {
      fontSize: LS.df(12),
      color: d.valueColor,
      align: 'right',
    });

    if (i < details.length - 1) {
      const lineY = LS.dy(d.y + 15);
      ctx.save();
      ctx.strokeStyle = UI_CONFIG.color.borderSoft;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(LS.dx(52), lineY);
      ctx.lineTo(LS.dx(323), lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── 发现新形态横幅 ──
  const newLevel = data.newlyUnlockedLevel;
  if (newLevel != null) {
    const bannerW = LS.ds(319);
    const bannerH = LS.ds(92);
    const bannerX = LS.dx(187.5) - bannerW / 2;
    const bannerY = LS.dy(578) - bannerH / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(255,182,72,0.28)';
    ctx.shadowBlur = 24;
    ui.drawGlassCard(ctx, bannerX, bannerY, bannerW, bannerH, {
      radius: UI_CONFIG.radius.cardScore,
      borderColor: 'rgba(255,182,72,0.30)',
    });
    ctx.restore();

    const dotR = LS.ds(20);
    const dotCX = bannerX + LS.ds(16) + dotR;
    const dotCY = bannerY + bannerH / 2 - LS.ds(4);
    const dotColor = getLevelColor(newLevel);

    ctx.save();
    ctx.shadowColor = dotColor + '99';
    ctx.shadowBlur = 14;
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(dotCX, dotCY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const textLeft = dotCX + dotR + LS.ds(14);
    const enName = getLevelNameEn(newLevel);
    const zhName = getLevelNameZh(newLevel);

    ui.drawText(ctx, '发现新形态', textLeft, bannerY + LS.ds(24), {
      fontSize: LS.df(13),
      color: UI_CONFIG.color.accentGoldSoft,
      align: 'left',
    });

    ctx.save();
    ctx.shadowColor = 'rgba(255,216,135,0.50)';
    ctx.shadowBlur = 14;
    ui.drawText(ctx, 'Lv.' + newLevel + ' ' + enName + ' ' + zhName, textLeft, bannerY + LS.ds(46), {
      fontSize: LS.df(15.5),
      color: UI_CONFIG.color.accentGold,
      align: 'left',
      weight: '600',
    });
    ctx.restore();

    ui.drawText(ctx, zhName + ' · 首次达成', bannerX + bannerW / 2, bannerY + bannerH - LS.ds(10), {
      fontSize: LS.df(11),
      color: UI_CONFIG.color.textMuted,
    });
  }

  // ── 按钮区 ──
  // 重新开始主按钮（中心 187.5, 700，尺寸 319×52）
  const restartW = LS.ds(319);
  const restartH = LS.ds(52);
  const restartX = LS.dx(187.5) - restartW / 2;
  const restartY = LS.dy(700) - restartH / 2;
  ui.drawPrimaryButton(ctx, restartX, restartY, restartW, restartH, '重新开始');

  // 返回主页（中心 156, 756，尺寸 257×44）+ 分享（中心 320, 756，尺寸 54×44）
  const homeW = LS.ds(257);
  const homeH = LS.ds(44);
  const homeX = LS.dx(156) - homeW / 2;
  const homeY = LS.dy(756) - homeH / 2;
  ui.drawSecondaryButton(ctx, homeX, homeY, homeW, homeH, '返回主页');

  const shareW = LS.ds(54);
  const shareH = LS.ds(44);
  const shareX = LS.dx(320) - shareW / 2;
  const shareY = LS.dy(756) - shareH / 2;
  ui.drawSecondaryButton(ctx, shareX, shareY, shareW, shareH, '分享');

  gameOverButtons = {
    restart: { x: restartX, y: restartY, w: restartW, h: restartH },
    home:    { x: homeX, y: homeY, w: homeW, h: homeH },
    share:   { x: shareX, y: shareY, w: shareW, h: shareH },
  };
}

function isGameOverBtnHit(tx, ty, key) {
  if (!gameOverButtons || !gameOverButtons[key]) return false;
  const b = gameOverButtons[key];
  return ui.isPointInRect(tx, ty, b.x, b.y, b.w, b.h);
}

function handleHome() {
  toast.clear();
  handleRestart();
  gameState = 'menu';
  input.isMenu = true;
  console.log('[状态] 切换到 menu');
}

function handleStart() {
  handleRestart();
  console.log('[状态] 从 menu 进入 playing');
}

function handleShare() {
  console.log('[分享] 占位 — 待接入微信分享');
}

function handlePause() {
  if (gameState !== 'playing') return;
  gameState = 'paused';
  input.isPaused = true;
  ItemCooldown.onPause(Date.now());
  console.log('[状态] 切换到 paused');
}

function handleResume() {
  if (gameState !== 'paused') return;
  gameState = 'playing';
  input.isPaused = false;
  pauseDialogButtons = null;
  ItemCooldown.onResume(Date.now());
  console.log('[状态] 从 paused 恢复到 playing');
}

/**
 * 绘制暂停弹窗（遮罩 + 毛玻璃卡片 + 内嵌统计卡 + 三按钮）
 */
function drawPauseDialog() {
  // 半透明遮罩
  ctx.fillStyle = UI_CONFIG.color.bgOverlay;
  ctx.fillRect(0, 0, screenWidth, screenHeight);

  // 弹窗卡片（中心 187.5, 406，尺寸 284×286）
  const cardW = LS.ds(284);
  const cardH = LS.ds(286);
  const cardX = LS.dx(187.5) - cardW / 2;
  const cardY = LS.dy(406) - cardH / 2;

  ui.drawGlassCard(ctx, cardX, cardY, cardW, cardH, {
    radius: UI_CONFIG.radius.dialog,
    fillColor: UI_CONFIG.color.glassCardDense,
    borderColor: UI_CONFIG.color.borderGlass,
  });

  // "游戏暂停" 标题（左对齐）
  ui.drawText(ctx, '游戏暂停', LS.dx(67), LS.dy(293), {
    fontSize: LS.df(17),
    color: UI_CONFIG.color.textPrimary,
    weight: '600',
    align: 'left',
  });

  // 内嵌统计卡（中心 187.5, 356，尺寸 240×66）
  const statW = LS.ds(240);
  const statH = LS.ds(66);
  const statX = LS.dx(187.5) - statW / 2;
  const statY = LS.dy(356) - statH / 2;
  ui.drawGlassCard(ctx, statX, statY, statW, statH, {
    radius: UI_CONFIG.radius.md,
    fillColor: 'rgba(20,30,60,0.5)',
    borderColor: UI_CONFIG.color.borderSoft,
  });

  // "当前分数" + 数值
  ui.drawText(ctx, '当前分数', LS.dx(83), LS.dy(343), {
    fontSize: LS.df(13),
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });
  ui.drawText(ctx, String(score.total), LS.dx(292), LS.dy(343), {
    fontSize: LS.df(13),
    color: UI_CONFIG.color.textPrimary,
    align: 'right',
    weight: '600',
  });

  // "核心等级" + 等级名
  const lvName = getLevelNameZh(board.core.level);
  ui.drawText(ctx, '核心等级', LS.dx(83), LS.dy(369), {
    fontSize: LS.df(13),
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });
  ui.drawText(ctx, 'Lv.' + board.core.level + ' ' + lvName, LS.dx(292), LS.dy(369), {
    fontSize: LS.df(13),
    color: UI_CONFIG.color.accentCyan,
    align: 'right',
    weight: '600',
  });

  // 按钮区
  const btnW = LS.ds(240);
  const btnX = LS.dx(187.5) - btnW / 2;

  const primaryH = LS.ds(42);
  const secondaryH = LS.ds(38);

  const resumeBtnY = LS.dy(418) - primaryH / 2;
  ui.drawPrimaryButton(ctx, btnX, resumeBtnY, btnW, primaryH, '继续游戏');

  const restartBtnY = LS.dy(464) - secondaryH / 2;
  ui.drawSecondaryButton(ctx, btnX, restartBtnY, btnW, secondaryH, '重新开始');

  const homeBtnY = LS.dy(510) - secondaryH / 2;
  ui.drawSecondaryButton(ctx, btnX, homeBtnY, btnW, secondaryH, '返回主页');

  pauseDialogButtons = {
    resume:  { x: btnX, y: resumeBtnY, w: btnW, h: primaryH },
    restart: { x: btnX, y: restartBtnY, w: btnW, h: secondaryH },
    home:    { x: btnX, y: homeBtnY, w: btnW, h: secondaryH },
  };
}

/** 处理重新开始 */
function handleRestart() {
  board.reset();
  score.reset();
  particles.clear();
  items.reset();
  gameState = 'playing';
  input.isGameOver = false;
  input.isMenu = false;
  input.isPaused = false;
  comboDisplay = { count: 0, x: 0, y: 0, timer: 0 };
  decorationTimer = 0;
  mergeFlowState = null;
  mergeFlowTimer = 0;
  mergeFlowAbsorbSlot = null;
  mergeFlowAbsorbProgress = 0;
  mergeFlowBurstFired = false;
  openingAbsorbPending = true;
  openingAbsorbActive = false;
  pauseDialogButtons = null;
  // 重置单局追踪
  sessionMaxLevel = 1;
  sessionStartMaxLevel = playerData.loadPlayerData().maxLevel || 1;
  sessionMaxCombo = 0;
  sessionMergeCount = 0;
  lastGameResult = null;
  ConfettiManager.reset();
}

// ─── 主循环 ───

function gameLoop() {
  if (gameState === 'menu') {
    drawMenuScreen();
  } else if (gameState === 'playing') {
    // === UPDATE ===

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

    // 开局自动吸附：初始分裂全部落地后，选最近核心的 Lv.1 启动吸附动画
    if (openingAbsorbPending && board.initialSplitsComplete) {
      openingAbsorbPending = false;
      openingAbsorbActive = true;
      const innerSlots = board.getSlotsByRing('inner').filter(s => s.level === 1);
      const target = innerSlots.length > 0 ? innerSlots[0] : board.slots.find(s => s.level === 1);
      if (target) {
        target.mergeAnimating = true;
        mergeFlowAbsorbSlot = target;
        mergeFlowAbsorbProgress = 0;
        mergeFlowBurstFired = false;
        mergeFlowState = 'absorb';
        mergeFlowTimer = msToFrames(GAME_CONFIG.mergeFlow.absorbAnimMs);
        board.mergeFlowLocked = true;
        board._recomputeInputLock();
      }
    }

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
    items.update(board, particles, handleUpgradeComplete, handleMagnetComplete);

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
      console.log('[状态] 切换到 gameOver');
      input.isGameOver = true;
      _saveOnGameOver();
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
        const colors = getElementColors(slot.level);
        particles.spawnDecoration(pos.x, pos.y, colors.secondary, board.getElementRadius(slot.level));
      }
    }

    // 粒子更新
    particles.update();

    toast.update();

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

    // 绘制磁吸动画（粒子向内滑动）
    renderer.drawMagnetAnimation(items, board);

    // 绘制粒子
    particles.draw(ctx);

    // 道具使用期间的屏幕边缘脉冲（清空=暖金/升级=绿松）
    renderer.drawItemUseBurst(items);

    // 掉落物绘制（flyIn / floating / blinking / pickingUp）
    renderer.drawDrops(items);

    // 绘制 UI
    const storedMax1 = playerData.loadPlayerData().maxScore;
    const displayMax1 = Math.max(storedMax1, score.total);
    renderer.drawScoreUI(score.total, displayMax1);
    renderer.drawItemBar(items);
    renderer.drawCoreLevelUI(board.core.level);
    renderer.drawPauseButton();

    // 道具使用失败提示文字（在 UI 之上）
    renderer.drawUseFailHint(items);



    // combo 显示
    if (comboDisplay.timer > 0) {
      renderer.drawCombo(comboDisplay.count, comboDisplay.x, comboDisplay.y);
    }

    // 浮动得分
    renderer.drawScorePopup(score.lastScorePopup);

    // 顶部 toast 浮层（在所有 UI 之上）
    toast.draw(ctx, screenWidth, statusBarHeight);

    ctx.restore();
  } else if (gameState === 'paused') {
    // 暂停状态：渲染 playing 画面（静态，不跑 update）+ 叠加暂停弹窗
    ctx.save();

    renderer.clear();
    renderer.drawTracks(centerX, centerY, boardRadius);
    renderer.drawConnectionLines(board);
    renderer.drawSlots(board);
    renderer.drawSelectionHighlight(board);
    renderer.drawCore(centerX, centerY, board.core.level, board.getCorePulseRatio(), board.timedSplitWarningProgress);
    renderer.drawFlyingElements(board);

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

    renderer.drawMergeAnimations(board);
    renderer.drawMagnetAnimation(items, board);
    particles.draw(ctx);
    renderer.drawItemUseBurst(items);
    renderer.drawDrops(items);
    const storedMax2 = playerData.loadPlayerData().maxScore;
    const displayMax2 = Math.max(storedMax2, score.total);
    renderer.drawScoreUI(score.total, displayMax2);
    renderer.drawItemBar(items);
    renderer.drawCoreLevelUI(board.core.level);
    renderer.drawPauseButton();

    ctx.restore();

    drawPauseDialog();
  } else if (gameState === 'gameover') {
    drawGameOverScreen();
  }

  // 继续循环
  requestAnimationFrame(gameLoop);
}

// ─── 启动游戏 ───

ItemIcons.preload().then(() => {
  console.log('[ItemIcons] 预加载完成');
  requestAnimationFrame(gameLoop);
});
