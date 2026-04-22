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
const { Items, ITEM_TYPES } = require('./js/items');
const { GAME_CONFIG, UI_CONFIG, msToFrames, getLevelColor, getLevelNameZh, getLevelNameEn } = require('./js/config');
const playerData = require('./js/playerData');
const ui = require('./js/uiHelpers');

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
const centerY = screenHeight * 0.42;

/** 棋盘半径（逻辑像素）— 外圈轨道贴近屏宽，留约 20px 边距 */
const boardRadius = Math.min(screenWidth * 0.445, (screenHeight - 165) * 0.5);

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
let pauseDialogButtons = null; // { resume, restart, home } 每个 { x, y, w, h }
let decorationTimer = 0;   // 装饰粒子计时器
let comboDisplay = { count: 0, x: 0, y: 0, timer: 0 }; // combo 显示

// 调试开关 — 上线前改为 false，保留按钮代码以备后续调试
const DEBUG_ITEMS = true;

// ─── 存档 + 单局追踪 ───

const savedData = playerData.loadPlayerData();
let sessionMaxLevel = 1;
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
  handleDebugTap,
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
 */
function checkComboDropTrigger() {
  const combo = score.combo;
  if (combo === 2) {
    items.spawnDrop('magnet', lastBurstPos.x, lastBurstPos.y, dropTargetPositions);
  } else if (combo === 3) {
    items.spawnDrop('clear', lastBurstPos.x, lastBurstPos.y, dropTargetPositions);
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
      if (!openingAbsorbActive) {
        score.addAbsorbScore(newCoreLevel);
        // 核心升级赠送道具：进化 Lv.5/7/9...（奇数≥5）、清空 Lv.6/8/10...（偶数≥6）
        if (newCoreLevel >= 5 && newCoreLevel % 2 === 1) {
          items.spawnDrop('upgrade', centerX, centerY, dropTargetPositions);
        } else if (newCoreLevel >= 6 && newCoreLevel % 2 === 0) {
          items.spawnDrop('clear', centerX, centerY, dropTargetPositions);
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
 * 调试：点击屏幕左下角"+1 ALL"按钮 → 三种道具各 +1 + 生成一个随机掉落物
 * 仅在 DEBUG_ITEMS=true 时生效；上线前置 false
 */
function handleDebugTap() {
  if (!DEBUG_ITEMS) return;
  items.grant('clear', 1);
  items.grant('upgrade', 1);
  items.grant('magnet', 1);
  // 同时生成一个随机掉落物用于测试拾取流程
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  items.spawnDrop(type, centerX, centerY, dropTargetPositions);
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
    isNewRecord: result.isNewRecord,
    newlyUnlockedLevel: result.newlyUnlockedLevel,
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
 * 绘制开始界面（三变体自动切换）
 */
function drawMenuScreen() {
  const W = screenWidth;
  const H = screenHeight;
  const padX = UI_CONFIG.spacing.screenPaddingX;
  const padBottom = UI_CONFIG.spacing.screenPaddingBottom;

  // ── 背景 ──
  ctx.fillStyle = UI_CONFIG.color.bgDeep;
  ctx.fillRect(0, 0, W, H);

  // ── 数据准备 ──
  const data = playerData.loadPlayerData();
  // TODO: 等新设计稿出来后删除 — totalGames/unlockedCount/isVeteran 已废弃
  // const totalGames = data.totalGames || 0;
  // const unlockedCount = data.unlockedLevels ? data.unlockedLevels.length : 1;
  const isNewbie = (data.maxLevel || 1) <= 1;
  // const isVeteran = unlockedCount >= 15;

  // ── 星球 ──
  const planetSize = isNewbie ? UI_CONFIG.size.heroPlanet : UI_CONFIG.size.heroPlanetCompact;
  const planetY = isNewbie ? H * 0.22 : H * 0.15;
  drawPlanet(W / 2, planetY, planetSize);

  // ── GENESIS 标题 ──
  const titleY = planetY + planetSize / 2 + 32;
  ui.drawText(ctx, 'GENESIS', W / 2, titleY, {
    fontSize: UI_CONFIG.font.heroLogo,
    color: UI_CONFIG.color.textPrimary,
    weight: '700',
    glow: UI_CONFIG.glow.heroTitle,
    glowColor: UI_CONFIG.color.accentPurpleLight,
  });

  // ── 副标题 ──
  const subY = titleY + 24;
  ui.drawText(ctx, '万 物 起 源', W / 2, subY, {
    fontSize: UI_CONFIG.font.heroSubtitle,
    color: UI_CONFIG.color.textMuted,
    weight: 'normal',
  });

  // ── 按钮区（先算位置，三变体共用） ──
  const btnH = UI_CONFIG.size.buttonPrimaryHeight;
  const btnW = Math.min(UI_CONFIG.size.buttonPrimaryMaxWidth, W - padX * 2);
  const btnX = (W - btnW) / 2;
  const btnY = H - padBottom - btnH - 30;

  // ── 版本号 ──
  ui.drawText(ctx, '万物起源 v1.0.0', W / 2, H - padBottom - 6, {
    fontSize: UI_CONFIG.font.hintXs,
    color: UI_CONFIG.color.textMuted,
  });

  if (isNewbie) {
    // ═══ 变体 A：新手 ═══
    const cardW = W - padX * 2;
    const cardH = 100;
    const cardX = padX;
    const cardY = subY + 30;
    ui.drawGlassCard(ctx, cardX, cardY, cardW, cardH);

    ui.drawText(ctx, '开启你的第一次探索', W / 2, cardY + 32, {
      fontSize: UI_CONFIG.font.cardTitle,
      color: UI_CONFIG.color.textPrimary,
      weight: '600',
    });
    ui.drawText(ctx, 'Begin your first exploration', W / 2, cardY + 56, {
      fontSize: UI_CONFIG.font.bodySmall,
      color: UI_CONFIG.color.textMuted,
    });

    // 卡片内小粒子示意（静态 5 个小圆点）
    const dotColors = [UI_CONFIG.codexColors[0], UI_CONFIG.codexColors[2], UI_CONFIG.codexColors[4], UI_CONFIG.codexColors[1], UI_CONFIG.codexColors[3]];
    const dotBaseY = cardY + 80;
    for (let i = 0; i < 5; i++) {
      const dx = W / 2 + (i - 2) * 22;
      ctx.beginPath();
      ctx.arc(dx, dotBaseY, 3, 0, Math.PI * 2);
      ctx.fillStyle = dotColors[i];
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else {
    // ═══ 变体 B/C：进阶 / 资深 ═══
    let curY = subY + 26;

    /* TODO: 等新设计稿出来后删除 — 图鉴点阵 + 解锁进度已废弃
    // 图鉴点阵（15 个圆点）
    const dotSize = UI_CONFIG.size.codexDotSize;
    const dotGap = UI_CONFIG.size.codexDotGap;
    const totalDotsW = 15 * dotSize + 14 * dotGap;
    const dotsStartX = (W - totalDotsW) / 2;

    for (let i = 0; i < 15; i++) {
      const dx = dotsStartX + i * (dotSize + dotGap) + dotSize / 2;
      const dy = curY;
      const isUnlocked = i < unlockedCount;
      ctx.beginPath();
      ctx.arc(dx, dy, dotSize / 2, 0, Math.PI * 2);
      if (isUnlocked) {
        ctx.fillStyle = UI_CONFIG.codexColors[i];
        ctx.shadowColor = UI_CONFIG.codexColors[i];
        ctx.shadowBlur = UI_CONFIG.glow.codexDot;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = 'rgba(74,90,158,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 解锁进度文字
    curY += 22;
    if (isVeteran) { ... } else { ... }
    */

    // 本局目标卡片
    curY += 28;
    const objCardW = W - padX * 2;
    const objCardH = 90;
    const objCardX = padX;
    ui.drawGlassCard(ctx, objCardX, curY, objCardW, objCardH);

    // TODO: 等新设计稿出来后删除 — 本局目标卡片已废弃
    // ...

    // 底部统计行
    curY += objCardH + 16;
    const statsText = '最高分 ' + (data.maxScore || 0).toLocaleString();
    ui.drawText(ctx, statsText, W / 2, curY, {
      fontSize: UI_CONFIG.font.hintXs,
      color: UI_CONFIG.color.textMuted,
    });
  }

  // ── "开始游戏" 主按钮 ──
  ui.drawPrimaryButton(ctx, btnX, btnY, btnW, btnH, '开始游戏');
  menuButtons = { start: { x: btnX, y: btnY, w: btnW, h: btnH } };
}

/**
 * 绘制结束界面（静态布局，不处理触摸）
 * 数据来源：lastGameResult + playerData
 */
function drawGameOverScreen() {
  const W = screenWidth;
  const H = screenHeight;
  const padX = UI_CONFIG.spacing.screenPaddingX;
  const padBottom = UI_CONFIG.spacing.screenPaddingBottom;
  const padTop = UI_CONFIG.spacing.screenPaddingTop;

  // ── 背景 ──
  ctx.fillStyle = UI_CONFIG.color.bgDeep;
  ctx.fillRect(0, 0, W, H);

  // ── 数据准备 ──
  const data = lastGameResult || {};
  const curScore = data.score || 0;
  const maxLevel = data.maxLevel || 1;
  const maxScore = playerData.loadPlayerData().maxScore || 0;
  const levelName = getLevelNameZh(maxLevel);

  let cursorY = padTop;

  // ── 标题 "游戏结束" ──
  ui.drawText(ctx, '游戏结束', W / 2, cursorY, {
    fontSize: UI_CONFIG.font.screenTitle,
    color: UI_CONFIG.color.textPrimary,
    weight: '600',
  });

  // ── 短横线分隔符 ──
  cursorY += 20;
  ctx.save();
  ctx.strokeStyle = UI_CONFIG.color.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 20, cursorY);
  ctx.lineTo(W / 2 + 20, cursorY);
  ctx.stroke();
  ctx.restore();

  // ── 分数卡片 ──
  cursorY += 20;
  const cardX = padX;
  const cardW = W - padX * 2;
  const cardH = 130;
  ui.drawGlassCard(ctx, cardX, cursorY, cardW, cardH);

  const cardPadX = 20;
  const cardInnerLeft = cardX + cardPadX;
  const cardInnerRight = cardX + cardW - cardPadX;
  const rowH = cardH / 2;

  // 第 1 行：本局分数
  const row1Y = cursorY + rowH / 2;
  ui.drawText(ctx, '本局分数', cardInnerLeft, row1Y, {
    fontSize: UI_CONFIG.font.cardLabel,
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });
  ui.drawText(ctx, String(curScore), cardInnerRight, row1Y, {
    fontSize: UI_CONFIG.font.scoreLG,
    color: UI_CONFIG.color.textPrimary,
    align: 'right',
    weight: 'bold',
  });

  // 虚线 divider
  const divY = cursorY + rowH;
  ctx.save();
  ctx.strokeStyle = UI_CONFIG.color.borderSoft;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cardInnerLeft, divY);
  ctx.lineTo(cardInnerRight, divY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 第 2 行：最高分数
  const row2Y = cursorY + rowH + rowH / 2;
  const isNewRecord = !!(data.isNewRecord);
  const highScoreColor = isNewRecord ? UI_CONFIG.color.accentGold : UI_CONFIG.color.textPrimary;

  ui.drawText(ctx, '最高分数', cardInnerLeft, row2Y, {
    fontSize: UI_CONFIG.font.cardLabel,
    color: UI_CONFIG.color.textMuted,
    align: 'left',
  });

  // 金色发光分数
  if (isNewRecord) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,182,72,0.60)';
    ctx.shadowBlur = UI_CONFIG.glow.recordGold;
  }
  ui.drawText(ctx, String(maxScore), cardInnerRight, row2Y, {
    fontSize: UI_CONFIG.font.scoreLG,
    color: highScoreColor,
    align: 'right',
    weight: 'bold',
  });
  if (isNewRecord) ctx.restore();

  // NEW! 徽章
  if (isNewRecord) {
    const badgeText = 'NEW!';
    const badgeFontSize = UI_CONFIG.font.badge;
    const badgePadX = 6;
    const badgePadY = 3;
    const badgeW = ui.measureText(ctx, badgeText, badgeFontSize, '700') + badgePadX * 2;
    const badgeH = badgeFontSize + badgePadY * 2;
    const scoreW = ui.measureText(ctx, String(maxScore), UI_CONFIG.font.scoreLG, 'bold');
    const badgeX = cardInnerRight - scoreW - 8 - badgeW;
    const badgeY = row2Y - badgeH / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(138,127,209,0.50)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = UI_CONFIG.color.accentPurple;
    ctx.beginPath();
    const r = badgeH / 2;
    ctx.moveTo(badgeX + r, badgeY);
    ctx.lineTo(badgeX + badgeW - r, badgeY);
    ctx.arc(badgeX + badgeW - r, badgeY + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(badgeX + r, badgeY + badgeH);
    ctx.arc(badgeX + r, badgeY + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ui.drawText(ctx, badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2, {
      fontSize: badgeFontSize,
      color: '#FFFFFF',
      weight: '700',
    });
  }

  // ── 发现新形态横幅 ──
  const newLevel = data.newlyUnlockedLevel;
  if (newLevel != null) {
    const bannerGap = UI_CONFIG.spacing.cardGap;
    const bannerH = UI_CONFIG.size.newFormBannerHeight;
    const bannerY = cursorY + cardH + bannerGap;
    const bannerX = padX;
    const bannerW = W - padX * 2;

    // 金色发光毛玻璃卡片
    ctx.save();
    ctx.shadowColor = 'rgba(255,182,72,0.28)';
    ctx.shadowBlur = 24;
    ui.drawGlassCard(ctx, bannerX, bannerY, bannerW, bannerH, {
      radius: UI_CONFIG.radius.cardScore,
      borderColor: 'rgba(255,182,72,0.30)',
    });
    ctx.restore();

    // 左侧等级圆点
    const dotR = 20;
    const dotCX = bannerX + 16 + dotR;
    const dotCY = bannerY + bannerH / 2 - 4;
    const dotColor = getLevelColor(newLevel);

    ctx.save();
    ctx.shadowColor = dotColor + '99';
    ctx.shadowBlur = 14;
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(dotCX, dotCY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 右侧文字
    const textLeft = dotCX + dotR + 14;
    const enName = getLevelNameEn(newLevel);
    const zhName = getLevelNameZh(newLevel);

    ui.drawText(ctx, '发现新形态', textLeft, bannerY + 24, {
      fontSize: UI_CONFIG.font.cardLabel,
      color: UI_CONFIG.color.accentGoldSoft,
      align: 'left',
    });

    ctx.save();
    ctx.shadowColor = 'rgba(255,216,135,0.50)';
    ctx.shadowBlur = 14;
    ui.drawText(ctx, 'Lv.' + newLevel + ' ' + enName + ' ' + zhName, textLeft, bannerY + 46, {
      fontSize: UI_CONFIG.font.cardTitle,
      color: UI_CONFIG.color.accentGold,
      align: 'left',
      weight: '600',
    });
    ctx.restore();

    // 底部小字
    ui.drawText(ctx, zhName + ' · 新形态解锁', bannerX + bannerW / 2, bannerY + bannerH - 10, {
      fontSize: UI_CONFIG.font.hintXs,
      color: UI_CONFIG.color.textMuted,
    });

    cursorY += bannerH + bannerGap;
  }

  // ── 详情区 ──
  cursorY += cardH + 18;
  const detailLeft = padX + 8;
  const detailRight = W - padX - 8;
  const detailRowH = 32;

  const details = [
    { label: '核心等级', value: 'Lv.' + maxLevel + ' ' + levelName, valueColor: UI_CONFIG.color.accentCyan },
    { label: '最高连锁', value: '--', valueColor: UI_CONFIG.color.textPrimary },
    { label: '合成次数', value: '--', valueColor: UI_CONFIG.color.textPrimary },
  ];

  for (let i = 0; i < details.length; i++) {
    const rowY = cursorY + detailRowH * i + detailRowH / 2;

    ui.drawText(ctx, details[i].label, detailLeft, rowY, {
      fontSize: UI_CONFIG.font.cardLabel,
      color: UI_CONFIG.color.textMuted,
      align: 'left',
    });
    ui.drawText(ctx, details[i].value, detailRight, rowY, {
      fontSize: UI_CONFIG.font.cardLabel,
      color: details[i].valueColor,
      align: 'right',
    });

    // 行间虚线（最后一行不画）
    if (i < details.length - 1) {
      const lineY = cursorY + detailRowH * (i + 1);
      ctx.save();
      ctx.strokeStyle = UI_CONFIG.color.borderSoft;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(detailLeft, lineY);
      ctx.lineTo(detailRight, lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── 按钮区 ──
  const btnH = UI_CONFIG.size.buttonPrimaryHeight;
  const btnMaxW = UI_CONFIG.size.buttonPrimaryMaxWidth;
  const shareW = UI_CONFIG.size.shareSquareWidth;
  const gap = UI_CONFIG.spacing.cardGap;
  const btnW = Math.min(btnMaxW, W - padX * 2);

  const secondaryBtnY = H - padBottom - btnH;
  const primaryBtnY = secondaryBtnY - gap - btnH;
  const primaryBtnX = (W - btnW) / 2;

  // 主按钮 "重新开始"
  ui.drawPrimaryButton(ctx, primaryBtnX, primaryBtnY, btnW, btnH, '重新开始');

  // 次要按钮 "返回主页" + 分享按钮
  const secondaryW = btnW - shareW - gap;
  const secondaryX = primaryBtnX;
  const shareX = secondaryX + secondaryW + gap;

  ui.drawSecondaryButton(ctx, secondaryX, secondaryBtnY, secondaryW, btnH, '返回主页');

  // 分享按钮（描边方块占位）
  ui.drawSecondaryButton(ctx, shareX, secondaryBtnY, shareW, btnH, '分享');

  gameOverButtons = {
    restart: { x: primaryBtnX, y: primaryBtnY, w: btnW, h: btnH },
    home:    { x: secondaryX, y: secondaryBtnY, w: secondaryW, h: btnH },
    share:   { x: shareX, y: secondaryBtnY, w: shareW, h: btnH },
  };
}

function isGameOverBtnHit(tx, ty, key) {
  if (!gameOverButtons || !gameOverButtons[key]) return false;
  const b = gameOverButtons[key];
  return ui.isPointInRect(tx, ty, b.x, b.y, b.w, b.h);
}

function handleHome() {
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
  console.log('[状态] 切换到 paused');
}

function handleResume() {
  if (gameState !== 'paused') return;
  gameState = 'playing';
  input.isPaused = false;
  pauseDialogButtons = null;
  console.log('[状态] 从 paused 恢复到 playing');
}

/**
 * 绘制暂停弹窗（遮罩 + 毛玻璃卡片 + 状态 + 三按钮）
 */
function drawPauseDialog() {
  const W = screenWidth;
  const H = screenHeight;

  // 半透明遮罩
  ctx.fillStyle = UI_CONFIG.color.bgOverlay;
  ctx.fillRect(0, 0, W, H);

  // 卡片尺寸与位置
  const padX = UI_CONFIG.spacing.screenPaddingX;
  const cardW = W - padX * 2;
  const cardH = 290;
  const cardX = padX;
  const cardY = (H - cardH) / 2;

  ui.drawGlassCard(ctx, cardX, cardY, cardW, cardH, {
    radius: UI_CONFIG.radius.dialog,
    fillColor: UI_CONFIG.color.glassCardDense,
    borderColor: UI_CONFIG.color.borderGlass,
  });

  // 标题
  const titleY = cardY + 40;
  ui.drawText(ctx, '游戏暂停', W / 2, titleY, {
    fontSize: UI_CONFIG.font.screenTitle,
    color: UI_CONFIG.color.textPrimary,
    weight: '600',
  });

  // 状态行 1：当前分数
  const row1Y = titleY + 40;
  ui.drawText(ctx, '当前分数  ' + score.total, W / 2, row1Y, {
    fontSize: UI_CONFIG.font.cardTitle,
    color: UI_CONFIG.color.textSecondary,
  });

  // 状态行 2：核心等级
  const row2Y = row1Y + 28;
  const lvName = getLevelNameZh(board.core.level);
  ui.drawText(ctx, '核心等级  Lv.' + board.core.level + ' ' + lvName, W / 2, row2Y, {
    fontSize: UI_CONFIG.font.cardTitle,
    color: UI_CONFIG.color.accentCyan,
  });

  // 按钮区
  const btnH = UI_CONFIG.size.buttonPrimaryHeight;
  const btnW = cardW - 40;
  const btnX = cardX + 20;
  const gap = UI_CONFIG.spacing.cardGap;

  const resumeBtnY = row2Y + 36;
  ui.drawPrimaryButton(ctx, btnX, resumeBtnY, btnW, btnH, '继续游戏');

  const restartBtnY = resumeBtnY + btnH + gap;
  ui.drawSecondaryButton(ctx, btnX, restartBtnY, btnW, btnH, '重新开始');

  const homeBtnY = restartBtnY + btnH + gap;
  ui.drawSecondaryButton(ctx, btnX, homeBtnY, btnW, btnH, '返回主页');

  pauseDialogButtons = {
    resume:  { x: btnX, y: resumeBtnY, w: btnW, h: btnH },
    restart: { x: btnX, y: restartBtnY, w: btnW, h: btnH },
    home:    { x: btnX, y: homeBtnY, w: btnW, h: btnH },
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
  lastGameResult = null;
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

requestAnimationFrame(gameLoop);
