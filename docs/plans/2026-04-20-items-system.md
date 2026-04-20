# 道具系统实现计划（阶段五·第一块）

**目标：** 新增三个道具（清空 / 升级 / 暂停），通过 combo 连锁和核心升级产生，玩家手动拾取后存入底部道具栏，点击使用。

**架构：** 新增 `js/items.js` 模块（状态机 + 逻辑），`renderer.js` 扩展三组绘制函数（道具栏、掉落物、道具视觉反馈），`game.js` 作为编排层把 combo/核心升级事件接到 items，`input.js` 增加道具栏/掉落物的命中检测。

**技术栈：** 沿用现有 Canvas + CommonJS + 配置驱动（`GAME_CONFIG.items`）。

---

## 对你 8 个问题的回答

### 1. 道具系统放在哪个模块？

**新建 `js/items.js`，作为独立模块。** 理由：
- 状态（库存、掉落物、暂停计时器）集中在一处，便于 reset/序列化
- 效果函数（clear/upgrade/pause）放进去，`game.js` 只负责触发和回调
- 与 `particles.js` / `score.js` 的职责边界一致

配套改动：
- `js/renderer.js` 加三组绘制函数（`drawItemBar`、`drawDrops`、`drawPauseOverlay`）
- `js/input.js` 加两个新的命中区（道具栏槽位、悬浮掉落物）
- `js/board.js` 只加一个字段 `timedSplitPauseFramesRemaining` 用于暂停道具冻结 `timedSplitScheduledFrame`
- `js/config.js` 加 `GAME_CONFIG.items` 分组

### 2. 掉落物的数据结构

```js
// items.drops = 最多 2 个（左右固定位）
{
  type: 'clear' | 'upgrade' | 'pause',
  slot: 'left' | 'right',     // 固定占左或右
  phase: 'flyIn' | 'floating' | 'blinking',
  phaseFrame: 0,               // 当前 phase 已走帧数
  startX, startY,              // flyIn 起点（触发源：合成中点或核心）
  targetX, targetY,            // flyIn/floating 的目标位置（由 slot 决定）
  // 拾取时（点击悬浮中的道具）切换到 flyToInventory：
  pickingUp: false,
  pickupFrame: 0,
  pickupTargetSlot: 0|1|2,     // 对应 inventory 的槽位索引
}
```

左右位坐标固定，由 `centerY + boardRadius + offsetY` 计算一次。

### 3. 道具栏的 UI 渲染方式

**Canvas 画，不引 DOM。** 理由：
- 微信小游戏 DOM 支持有限，全 Canvas 一致性好
- 已有 `drawCoreLevelUI`、`drawScoreUI` 的模式可复用
- 图标用几何图形（见问题 8），几十行代码就能画完

道具栏位于核心等级文字上方，三个槽位水平居中排列，每槽位 = 圆形图标 + 右侧 "×N"。命中检测在 `input.js` 里增加 `_hitTestItemBar`。

### 4. "最靠近满的圈"的准确定义

```js
// 每圈"真实空位"数 = level===null && !reserved
const emptyByRing = {
  inner: count(inner && empty && !reserved),  // 总共 6
  mid:   count(mid   && empty && !reserved),  // 总共 12
  outer: count(outer && empty && !reserved),  // 总共 18
};
// 选 empty 最少的；并列时按 inner > mid > outer（内圈更关键）
```

额外规则：如果选中的圈没有任何 Lv.1 可清（全是高级），fallback 到次近满且有 Lv.1 的圈；都没有就视为无效使用，**库存不扣减**，给一个"无效"提示粒子。

### 5. 暂停道具的计时器暂停机制

**冻结 `timedSplitScheduledFrame` 相对 `gameFrame` 的差值。** 做法：

```js
// board.updateTimedSplit 开头加：
if (this.timedSplitPauseFramesRemaining > 0) {
  this.timedSplitPauseFramesRemaining -= 1;
  // 让 scheduledFrame 跟着 gameFrame 前进，保证"剩余帧"不变
  if (this.timedSplitScheduledFrame !== null) {
    this.timedSplitScheduledFrame += 1;
  }
  this.timedSplitWarningProgress = 0;  // 暂停期间不显示前摇
  this.gameFrame += 1;
  return;
}
```

效果：暂停期间前摇、触发、粒子全部冻结；解除后从原剩余时间继续倒数。
不影响 `updateSplits`（合成后分裂 + 初始分裂 + 队列）。

### 6. 暂停期间再次使用的叠加

```js
// 使用暂停道具时：
board.timedSplitPauseFramesRemaining += secondsToFrames(GAME_CONFIG.items.pauseItemDurationMs / 1000);
```

直接 `+=`，不重置。剩 5s 再用一次 → 5+15 = 20s。顶部倒计时文字同步更新。

### 7. 道具使用期间是否锁定输入

| 道具 | 锁输入 | 原因 |
|------|--------|------|
| 清空 | 🔒 锁 300ms（动画期间） | 避免和消散动效冲突 |
| 升级 | 🔒 锁 300ms | 避免和进化闪光冲突 |
| 暂停 | 🔓 不锁 | 玩家需要继续正常玩 |

**道具点击的前置条件**：`!board.inputLocked && !board.mergeFlowLocked`。换言之，合成/吸附/合成后流程期间不可点击道具图标。

### 8. 掉落物图标是否用几何图形占位

**是，用几何图形。** 具体：
- 清空（扫除）：同心螺旋圈 + 朝外放射的小点
- 升级（加速）：向上三角箭头 + 两侧竖线
- 暂停（控制）：两条竖条（暂停符号）外面套一圈光晕

配色：
- 清空：暖金 `#EF9F27`（与核心前摇环同色系，"清理"感）
- 升级：绿松 `#5DCAA5`（与 Lv.5 Cell 同色系，"进化"感）
- 暂停：冷紫 `#7F77DD`（与高级核心/Galaxy 同色系，"时间"感）

---

## 文件结构

```
js/
├── config.js       ← 新增 GAME_CONFIG.items 分组（+ ~30 行）
├── board.js        ← 加暂停字段 + updateTimedSplit 暂停分支（+ ~10 行）
├── items.js        ← 新文件：库存/掉落/效果（~300 行）
├── renderer.js     ← 加 drawItemBar / drawDrops / drawPauseOverlay（+ ~150 行）
├── input.js        ← 加 _hitTestItemBar / _hitTestDrop（+ ~40 行）
├── particles.js    ← 不变
└── score.js        ← 不变

game.js             ← 实例化 items，在 gameLoop / handleMergeBurst / handleMergeComplete 接入（+ ~50 行）
DEVELOPMENT_STATUS.md ← 最后一步更新
```

---

## 任务分解（按你建议的 Step 1-7 展开）

每步完成后在微信开发者工具自测 → 通过后 commit。

---

### Task 1：基础脚手架

**Files:**
- Modify: `js/config.js` — 加 `GAME_CONFIG.items` 分组
- Create: `js/items.js` — 骨架 + 库存状态 + reset()
- Modify: `game.js` — 实例化 items、接入 reset

- [ ] **1.1** `js/config.js` 加以下字段：
```js
items: {
  dropDurationMs: 10000,
  blinkDurationMs: 5000,
  flyInMs: 500,
  flyToInventoryMs: 400,
  comboTriggerCount: 5,
  coreLevelForGift: 7,
  clearItemTargetLevel: 1,
  upgradeItemCount: 3,
  upgradeItemMaxSourceLevel: 5,
  pauseItemDurationMs: 15000,
  pauseItemAffectsMerge: false,
  pauseItemAffectsTimed: true,
  pauseItemBlinkAtSeconds: 3,
  itemUseAnimFrames: 18,        // 清空/升级使用后输入锁帧数
  dropFlySpawnOffsetY: 0.92,    // 掉落位 y = centerY + boardRadius * 此值
  dropFlySpawnOffsetX: 0.58,    // 掉落位 x = centerX ± boardRadius * 此值
}
```

- [ ] **1.2** 创建 `js/items.js`：
```js
const { GAME_CONFIG, msToFrames, secondsToFrames } = require('./config');

const ITEM_TYPES = ['clear', 'upgrade', 'pause'];

class Items {
  constructor() {
    this.inventory = { clear: 0, upgrade: 0, pause: 0 };
    this.drops = [];                 // 最多 2 个悬浮掉落物
    this.useAnim = null;             // { type, frame, totalFrames, targets }
    this.pauseCountdownFrames = 0;   // 暂停剩余帧（由 board 冻结调度，这里只用于 UI 倒计时文字）
  }
  reset() {
    this.inventory = { clear: 0, upgrade: 0, pause: 0 };
    this.drops = [];
    this.useAnim = null;
    this.pauseCountdownFrames = 0;
  }
  // 后续 Task 3-6 填充 use / spawnDrop / pickupDrop / update 等
}

module.exports = { Items, ITEM_TYPES };
```

- [ ] **1.3** `game.js` 顶部 require，实例化，reset 中调用 `items.reset()`：
```js
const { Items } = require('./js/items');
const items = new Items();
```
并在 `handleRestart` 末尾加 `items.reset();`

- [ ] **1.4** 微信开发者工具启动游戏，应无任何可见变化；commit：
```
feat(items): 道具系统骨架 — config/items.js/实例化
```

---

### Task 2：道具栏 UI（全灰，数量 ×0）

**Files:**
- Modify: `js/renderer.js` — `drawItemBar(items, coreLevelUIYTop)`
- Modify: `game.js` — 在 `drawCoreLevelUI` 前调用

- [ ] **2.1** `renderer.js` 加 `drawItemBar(items)`：
  - 位置：`this.height - 90`（核心等级文字是 `height - 40`，道具栏放在其上 50px）
  - 3 个圆形槽位水平居中，间隔 90px，半径 26px
  - 每槽底色 `rgba(255,255,255,0.06)`，边框 `rgba(255,255,255,0.15)`
  - 图标（Task 2.2 先画占位空心圆，2.4 再替换为几何图形）
  - 右下角数量 `×N`，白色 12px，数量 0 时灰 `rgba(255,255,255,0.3)`
  - 返回每槽的中心坐标数组 `[{type,x,y,r}, ...]` 存到 `renderer.itemBarSlots`（供命中检测用）

- [ ] **2.2** 占位图标：每槽画一个空心圆（先验证定位）

- [ ] **2.3** `game.js` 在 `renderer.drawCoreLevelUI(...)` 之前调用 `renderer.drawItemBar(items);`

- [ ] **2.4** 替换为正式几何图标：
  - clear: 三圈半径递减的弧线（270° 弧，旋转偏移 0/60/120°）
  - upgrade: 向上三角 + 底部两条竖线
  - pause: 两条竖条（宽 3、间距 5、高 12）外套半透明光晕

- [ ] **2.5** 自测：屏幕底部能看到 3 个灰色图标，数量都是 ×0；commit：
```
feat(items): 道具栏 UI — 3 个几何图标 + 数量显示
```

---

### Task 3：调试加道具按钮

**Files:**
- Modify: `js/renderer.js` — 加 `drawDebugButton()`（只在 DEBUG 模式下画）
- Modify: `js/input.js` — `_hitTestDebugBtn`
- Modify: `game.js` — 接入

- [ ] **3.1** `game.js` 顶部加常量：
```js
const DEBUG_ITEMS = true; // 上线前改 false
```

- [ ] **3.2** `renderer.drawDebugButton()`：屏幕左下角画一个 "+1 ITEM" 按钮（40×40 px），保存坐标到 `renderer.debugBtn`

- [ ] **3.3** `input.js` 在 `_handleTouch` 中，gameover 之外的分支前加：
```js
if (DEBUG_ITEMS && this.renderer.isDebugBtnHit(x, y)) {
  this.onDebugTap();
  return;
}
```
（需扩展构造函数 callback）

- [ ] **3.4** `game.js` `handleDebugTap`：给三种道具各 +1

- [ ] **3.5** 自测：点击调试按钮 → 3 个道具数量都变成 ×1，颜色变亮；commit：
```
feat(items): 调试按钮给道具 + 数量变化驱动图标色阶
```

---

### Task 4：实现清空道具效果

**Files:**
- Modify: `js/items.js` — `use(type, board, particles)`、`_useClear`
- Modify: `js/input.js` — `_hitTestItemBar`
- Modify: `js/renderer.js` — `drawItemUseBurst`（屏幕边缘脉冲）
- Modify: `game.js` — 把 items 引用注入 input；点击处理

- [ ] **4.1** `items.use(type, board, particles)` 主入口：
  - 前置：`inventory[type] > 0 && !board.inputLocked && !board.mergeFlowLocked`
  - 扣库存 + 分派到具体函数

- [ ] **4.2** `_useClear(board, particles)`：
  1. 按 Task 答案 4 找"最靠近满 + 有 Lv.1"的圈
  2. 该圈所有 `level === 1 && !reserved && !mergeAnimating` 的 slot：
     - `slot.level = null`
     - 每个 slot 位置喷一圈粒子（消散）
  3. 启动 `useAnim = { type:'clear', frame:0, totalFrames:18 }`
  4. `board.inputLocked = true`（动画期间）；动画结束解锁（通过 update）

- [ ] **4.3** `items.update(board)` 每帧调用：
  - 推进 `useAnim.frame`
  - 结束时清 `useAnim`，恢复 `board._recomputeInputLock()`

- [ ] **4.4** `input.js` 加 `_hitTestItemBar(x,y)` 遍历 `renderer.itemBarSlots`
- [ ] **4.5** `game.js` `handleSlotTap` 之前：先检查道具栏命中 → 调 `items.use(type, board, particles)`

- [ ] **4.6** `renderer.drawItemUseBurst(items, w, h)`：清空动画期间屏幕四边画暖色光晕（`rgba(239,159,39,α)`），α 随 frame 呈 0→0.3→0 抛物线

- [ ] **4.7** 自测：用调试按钮给清空 +3；开局玩几步放些 Lv.1 到某圈；点清空图标 → 最满的圈的 Lv.1 消失 + 粒子爆发 + 屏幕边缘暖光一闪；commit：
```
feat(items): 清空道具 — 最密集圈层的 Lv.1 消散
```

---

### Task 5：实现升级道具效果

**Files:**
- Modify: `js/items.js` — `_useUpgrade`
- Modify: `js/renderer.js` — upgrade 动效可复用 `_drawElement` 白色高亮层

- [ ] **5.1** `_useUpgrade(board, particles)`:
  1. 候选池 = `slots.filter(s => s.level >= 1 && s.level <= GAME_CONFIG.items.upgradeItemMaxSourceLevel && !s.mergeAnimating && !s.reserved)`
  2. 洗牌取前 N（`upgradeItemCount`，不足则全部）
  3. 对每个：
     - `slot.level += 1`
     - 在 slot 位置喷该新等级 primary/secondary 色粒子
     - 标记 `slot._upgradeFlashFrame = 18`（渲染器读这个做白光闪一下）
  4. useAnim 同上，锁输入 18 帧

- [ ] **5.2** `renderer.drawSlots` 在画完元素后，若 `slot._upgradeFlashFrame > 0`：
  - 叠一层白色半透明（`rgba(255,255,255, flash/18 * 0.8)`）同位置的圆
  - 每帧 `_upgradeFlashFrame -= 1`（由 `items.update` 或直接 renderer 驱动）

- [ ] **5.3** 升级后连锁判定：看每个被升级的 slot 是否与相邻同级可合成 → 如果是，启动 `board.startMergeAnimation`。
  - 注意：多个可合成时按出现顺序处理，但其中一个被合成后会失效，用类似 `findNearestAdjacentSameLevel` + 去重。
  - 升级带出的合成视作新 combo 链：`score.resetCombo()` + `score.incrementCombo()`，通过 `performMerge` 的同一路径复用。

- [ ] **5.4** 自测：给升级 +3，场上有几个 Lv.1-3，点升级 → 随机 3 个 +1，周身闪白光；若刚好形成相邻同级，紧接着自动合成动画；commit：
```
feat(items): 升级道具 — 随机 3 个 Lv.1-5 +1 并触发连锁
```

---

### Task 6：实现暂停道具效果 + UI

**Files:**
- Modify: `js/board.js` — 加 `timedSplitPauseFramesRemaining` + updateTimedSplit 分支
- Modify: `js/items.js` — `_usePause` + `update` 推进 pauseCountdownFrames
- Modify: `js/renderer.js` — `drawPauseOverlay`（核心波纹 + 屏幕紫光 + 倒计时文字）

- [ ] **6.1** `board.js`：
  - 构造函数加 `this.timedSplitPauseFramesRemaining = 0;`
  - `reset()` 里清零
  - `updateTimedSplit` 开头按问题 5 的答案加分支

- [ ] **6.2** `items._usePause(board)`：
  ```js
  const frames = msToFrames(GAME_CONFIG.items.pauseItemDurationMs);
  board.timedSplitPauseFramesRemaining += frames;
  this.pauseCountdownFrames = board.timedSplitPauseFramesRemaining;
  // 不锁输入
  // 启动一次"静止波纹"动效（useAnim = { type:'pauseStart', frame:0, totalFrames:24 }）
  ```

- [ ] **6.3** `items.update(board)` 暂停期间：
  - `pauseCountdownFrames = board.timedSplitPauseFramesRemaining`（镜像即可，board 是 source of truth）

- [ ] **6.4** `renderer.drawPauseOverlay(items, board, centerX, centerY)`：
  - 条件：`board.timedSplitPauseFramesRemaining > 0`
  - 核心周围慢速旋转波纹：3 圈 `ctx.arc`，相位差 120°，半径随 sin 呼吸
  - 屏幕四边淡紫色光晕（类似清空的暖色屏幕边框，颜色 `rgba(127,119,221,α)`）
  - 屏幕顶部中央文字 `⏸ 时间锁定 ${Math.ceil(frames/60)}s`
  - 剩余 `≤ pauseItemBlinkAtSeconds × 60` 帧时：文字变红 `#FF5555`，波纹频率加倍
  - 解除瞬间（上帧 >0 本帧 =0）：核心 `corePulse = 15`，粒子爆发

- [ ] **6.5** 自测：
  - 给暂停 +2，开局等 30s 安全期过后，定时分裂前摇出现时按下 → 前摇呼吸冻结、波纹包裹核心、顶部显示 14s 倒数
  - 再按一次 → 数字变大（~28s）
  - 剩 3s 文字变红 + 波纹快闪
  - 解除 → 波纹消失 + 核心脉冲
  - commit：
```
feat(items): 暂停道具 — 冻结定时分裂 + 倒计时/波纹/叠加
```

---

### Task 7：掉落物系统（悬浮 / 拾取）

**Files:**
- Modify: `js/items.js` — `spawnDrop(type, sourceX, sourceY)`、`pickupDrop`、`updateDrops`
- Modify: `js/renderer.js` — `drawDrops`
- Modify: `js/input.js` — `_hitTestDrop`
- Modify: `game.js` — 把两个固定掉落位坐标算好传入

- [ ] **7.1** `items.spawnDrop(type, sourceX, sourceY, targetPositions)`:
  - 选槽：左/右都空随机；一侧有则选另一侧；两侧都有则覆盖 `phase==='blinking'` 且 `phaseFrame` 最大的那个
  - 构造 drop 对象入 `this.drops`，phase='flyIn'，phaseFrame=0，totalFrames=msToFrames(flyInMs)

- [ ] **7.2** `items.updateDrops(board)`:
  - flyIn 阶段：phaseFrame++；到点切 'floating'，重置 phaseFrame
  - floating 阶段：phaseFrame 对比 `dropDurationMs`，到点切 'blinking'
  - blinking 阶段：phaseFrame 对比 `blinkDurationMs`，到点从 drops 移除
  - pickup 中（`pickingUp: true`）：推进 pickupFrame，到点 +1 库存，触发拾取脉冲动效

- [ ] **7.3** `renderer.drawDrops(items, board)`:
  - flyIn: 沿路径插值，带粒子拖尾（复用 `particles.spawnTrail`）
  - floating: 图标 + 呼吸缩放（1.0↔1.1，周期 60 帧）+ 周围粒子围绕（每 6 帧喷一个 decoration）
  - blinking: 透明度 sin-wave 快闪（频率 3Hz）
  - pickingUp: 沿路径飞向对应道具栏槽位，缩放到 0.4

- [ ] **7.4** `input.js` 加 `_hitTestDrop(x, y)`：遍历 `items.drops`，floating/blinking 阶段可点；命中后 `items.pickupDrop(drop, renderer.itemBarSlots)`

- [ ] **7.5** `game.js` 把两个掉落位坐标算好（基于 `centerX/centerY/boardRadius`）。在 gameLoop update 阶段：`items.updateDrops(board);`。在 render 阶段：`renderer.drawDrops(items, board);`

- [ ] **7.6** 调试按钮加另一组（或改为 3 个调试键）：分别手动触发三种掉落。
- [ ] **7.7** 自测：触发掉落 → 飞向左/右位 → 悬浮 10s → 快闪 5s → 消失；悬浮时点击 → 飞进道具栏 → 数量 +1 + 脉冲；commit：
```
feat(items): 掉落物悬浮/快闪/拾取 + 粒子拖尾
```

---

### Task 8：Combo 5 次触发掉落

**Files:**
- Modify: `game.js` — `performMerge` 和 `handleMergeComplete` 中检查 combo

- [ ] **8.1** 在 `handleMergeComplete` 里 `score.incrementCombo()` 之后（或 `performMerge` 起始处）：
  ```js
  if (score.combo === GAME_CONFIG.items.comboTriggerCount) {
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    // 触发位置：用最近一次合成的中点（posA/posB 中点）
    items.spawnDrop(type, midX, midY, dropTargetPositions);
  }
  ```
  需要把 midX/midY 从 `handleMergeBurst` 存到一个 `lastBurstPos` 供 `handleMergeComplete` 用。

- [ ] **8.2** 自测：制造一个 5 连 combo（开局生成多个 Lv.1 相邻时容易复现）→ 第 5 次合成瞬间，一个随机道具从合成中点飞向掉落位；commit：
```
feat(items): combo 5 次触发道具掉落
```

---

### Task 9：核心 Lv.7+ 升级赠送

**Files:**
- Modify: `game.js` — `updateMergeFlow` 的 absorb 分支

- [ ] **9.1** 在 `board.doAbsorb(...)` 返回的 `newCoreLevel` 处：
  ```js
  if (newCoreLevel >= GAME_CONFIG.items.coreLevelForGift) {
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    items.spawnDrop(type, centerX, centerY, dropTargetPositions);
  }
  ```

- [ ] **9.2** 自测：手动快速合成到 Lv.7（或临时把 `coreLevelForGift=2` 调试）→ 升级瞬间从核心飞出一个道具；恢复配置后 commit：
```
feat(items): 核心 Lv.7+ 升级赠送道具
```

---

### Task 10：验收 + 移除调试按钮 + 更新文档

- [ ] **10.1** 跑一局完整游戏验证：
  - 初期 combo 5 掉落 → 拾取 → 用掉（清空/升级/暂停各验证一次）
  - 核心升到 Lv.7 → 每级升级都掉落
  - 两个掉落位并存、快闪、消失
  - 暂停叠加
  - 合成-吸附锁定期间点图标无反应
  - 初始分裂期间也不可用

- [ ] **10.2** 把 `DEBUG_ITEMS = true` 改为 `false`（保留按钮代码），commit：
```
chore(items): 关闭调试按钮
```

- [ ] **10.3** 更新 `DEVELOPMENT_STATUS.md`：
  - "当前开发阶段" 更新为阶段五·道具系统完成
  - 模块实现状态加 `js/items.js`
  - 已验证功能加若干条
  - 关键参数速查加 `GAME_CONFIG.items.*`

- [ ] **10.4** 最终 commit + push：
```
docs: 道具系统编码完成 + DEVELOPMENT_STATUS 同步
```

---

## 风险点 / 需要你点头的设计选择

> **测试期重点观察项（2026-04-20 确认）：** 以下 4 项设计选择已按当前方案执行；实际测试中如发现问题，记录下来单独处理，不提前优化。

1. **升级道具触发连锁**：规范写的是"立刻形成相邻同级即触发 combo"。我的实现是升级完立即扫一遍做合成动画。这意味着升级道具可以被用作 combo 放大器（用它升级后触发 5 连 combo，然后又掉落道具）。是 feature 还是 bug？建议：**feature**，符合"进化"主题。
2. **清空道具无 Lv.1 时的处理**（已确认 2026-04-20）：
   - 选定的"最满圈"没有 Lv.1 → **fallback 到其他有 Lv.1 的圈**（按"满度"从高到低依次尝试）
   - 所有圈都没有 Lv.1 → **道具不可使用，不扣库存**，屏幕显示提示文字："该道具暂时无法使用"（1.5s 自动消失）
3. **暂停 UI 文字位置**：我放屏幕顶部中央，`y = 24`。但左上角分数也在那附近。可能需要放在屏幕顶部居中但 `y = 82`（分数块下方）。第一次实现时先按 `y = 82`，视觉上再调。
4. **掉落物点击命中精度**：图标 26px + 10px 容差 = 36px 命中半径。和现有 `TOUCH_TOLERANCE` 一致。
5. **道具栏槽位大小**：我计划 26px 半径，三个槽位中心间隔 90px。若屏幕较窄（< 360 逻辑像素）需缩小。先按 26px 实现，真机看效果再调。

---

## 实现节奏

每个 Task 一次 commit，共 10 个 commit。估时：
- Task 1-3（脚手架/UI/调试）：合计约 1 小时
- Task 4（清空）：约 1 小时
- Task 5（升级）：约 1.5 小时（含连锁逻辑）
- Task 6（暂停）：约 2 小时（含波纹/倒计时）
- Task 7（掉落/拾取）：约 2 小时
- Task 8-9（触发）：约 0.5 小时
- Task 10（验收）：约 0.5 小时

总计约 8-9 小时编码，适合分 2-3 个 session 完成。

---

**请确认此计划，我再开始 Task 1。有任何要调整的地方直接说。**
