# 万物起源 GENESIS — 开发进度追踪

**每次开发前请先阅读此文件，了解当前状态和待办事项。**

---

## 项目基本信息

- **项目名称：** 万物起源 GENESIS
- **平台：** 微信小游戏
- **技术栈：** 原生 Canvas API + JavaScript（CommonJS 模块）
- **AppID：** wxb749bfbf62a3d6b7
- **设计文档：** GENESIS_GDD_v2.0（2026-04-21 更新）
- **开发流程文档：** GENESIS_DEV_WORKFLOW_v2.0

---

## 文件结构

```
genesis-game/
├── game.js               ← 游戏入口 · 主循环 · 状态管理 · 道具调度 · 存档接入
├── game.json             ← 微信小游戏配置
├── project.config.json   ← 项目配置（AppID 已填入）
├── js/
│   ├── config.js         ← 全局配置（GAME_CONFIG 单例 + 时间/帧辅助）
│   ├── board.js          ← 棋盘数据结构与逻辑
│   ├── renderer.js       ← Canvas 渲染（含道具栏/掉落物/暂停覆盖层/退出按钮）
│   ├── particles.js      ← 粒子效果系统
│   ├── input.js          ← 触摸事件处理（含道具栏/掉落物命中检测）
│   ├── score.js          ← 计分系统
│   ├── items.js          ← 道具系统（库存/掉落/效果/使用动画）
│   └── playerData.js     ← 本地存档（读取/保存/更新/目标生成）
├── design/
│   └── ui_prototype.png  ← 原型图参考
├── images/               ← 空文件夹（后续放 Figma 导出的元素 PNG）
├── docs/plans/           ← 开发计划文档
├── GENESIS_GDD_v2.0
├── GENESIS_DEV_WORKFLOW_v2.0
├── GENESIS_GDD_v1.2.md
├── GENESIS_DEV_WORKFLOW_v1.0.md
└── DEVELOPMENT_STATUS.md ← 本文件
```

---

## 当前开发阶段

**阶段七：存档系统 + UI 调整 — 编码完成 ✅**

在阶段五（道具系统）基础上完成：

**阶段六：游戏调优（5 项）✅**
1. **开局流程** — 初始分裂后自动吸附 1 个 Lv.1，核心升 Lv.2，玩家从 3 个 Lv.1 开始
2. **取消安全期** — 定时分裂计时器开局后立即启动（safePeriodSeconds = 0）
3. **Combo 掉落** — Combo ≥ 2 触发道具掉落（每次连锁仅一次）
4. **核心赠送修复** — 掉落位满时兜底入库 + 改为 Lv.5 起赠送
5. **前摇特效** — 改为核心内部脉冲发光 + 震动（不超出核心范围）

**阶段七：存档 + UI ✅**
1. **本地存档** — `js/playerData.js` 模块（读取/保存/更新/目标生成/清除）
2. **存档接入** — game.js 启动读取、进行中追踪 sessionMaxLevel/objectiveAchieved、结束时更新
3. **UI 样式调整** — 分数区字体/位置、道具栏灰色圆盘样式、核心等级文字、退出按钮

---

## 各模块实现状态

### js/config.js — 全局配置（新增）

| 功能 | 状态 | 说明 |
|------|------|------|
| `GAME_CONFIG` 单例 | ✅ 完成 | 集中所有本轮新增功能的可调参数 |
| `timedSplit.safePeriodSeconds` | ✅ 完成 | 0（已取消安全期） |
| `timedSplit.preSplitWarningSeconds` | ✅ 完成 | 默认 1.5s 前摇 |
| `timedSplit.intervalByLevel` | ✅ 完成 | `'1-3':20, '4-5':15, '6-7':12, '8-10':8` 秒 |
| `initialSplit.count / intervalMs` | ✅ 完成 | 开局分裂数量 4 + 间隔 200ms |
| `interaction.showConnectionLines` | ✅ 完成 | 连接线总开关 |
| `interaction.selectionPulseEnabled` | ✅ 完成 | 选中态脉冲总开关 |
| `mergeAnimation.convergeFrames / popFrames` | ✅ 完成 | 合成动画节奏（18 + 6 = 24 帧） |
| `spawnDistribution` | ✅ 完成 | 合成后分裂的圈层概率（early/mid/late 三阶段，按核心等级切换） |
| `secondsToFrames / msToFrames` | ✅ 完成 | 时长→帧数辅助 |
| `getTimedSplitInterval(coreLevel)` | ✅ 完成 | 按核心等级查表返回秒数 |
| `items.*` | ✅ 完成 | 道具系统全部配置（掉落/清空/升级/暂停/动效参数） |

### game.js — 游戏入口

| 功能 | 状态 | 说明 |
|------|------|------|
| Canvas 初始化 | ✅ 完成 | dpr 适配、逻辑像素坐标系 |
| 模块实例化 | ✅ 完成 | Board / Renderer / Particles / Input / Score |
| requestAnimationFrame 主循环 | ✅ 完成 | update → render 每帧执行 |
| 游戏状态管理 | ✅ 完成 | playing / gameover 两种状态 |
| **两步点击调度** | ✅ 完成 | `handleSlotTap` 分 4 种情况（选中 / 取消 / 合成 / 切换） |
| **合成动画调度** | ✅ 完成 | `performMerge` 启动动画；`handleMergeBurst` 中点回调；`handleMergeComplete` 递归连锁 + 吸附 + 分裂 |
| 吸附逻辑调度 | ✅ 完成 | `handleAbsorb` 递归检查多个同级元素 |
| 重新开始 | ✅ 完成 | `handleRestart` 重置所有模块状态 |
| 装饰粒子生成 | ✅ 完成 | 每 30 帧为有元素的格子生成装饰粒子 |
| 分裂队列驱动 | ✅ 完成 | 每帧调用 `board.updateSplits()` 推进队列与飞行动画 |
| **定时分裂驱动** | ✅ 完成 | 每帧调用 `board.updateTimedSplit()` 推进安全期/前摇/发射 |
| **合成动画驱动** | ✅ 完成 | 每帧调用 `board.updateMergeAnimations()` 推进聚合/弹出 |
| 死锁保险 | ✅ 完成 | 合成后若 Lv.1 含飞行/队列 < 2 个 → 自动补分裂 |
| 飞行尾迹粒子 | ✅ 完成 | 每帧为每个飞行元素撒 spawnTrail 粒子 |
| 输入屏蔽 | ✅ 完成 | `board.inputLocked` 仅在初始 4 次分裂 / 合成动画期间锁输入；合成后分裂不锁 |
| Game-over 判定 | ✅ 完成 | 棋盘满 + 无队列/飞行/合成动画时触发 |
| 棋盘尺寸（原型版） | ✅ 完成 | `screenWidth × 0.445` |
| 棋盘垂直居中 | ✅ 完成 | 在分数区和底部栏之间居中 |
| **道具系统实例化** | ✅ 完成 | Items 模块实例化、reset 接入、update/render 调度 |
| **道具使用调度** | ✅ 完成 | 道具栏点击 → `items.use()`；清空/升级锁输入 18 帧 |
| **道具掉落触发** | ✅ 完成 | Combo ≥ 2 触发 + 核心 Lv.5+ 升级时随机掉落 |
| **掉落物拾取调度** | ✅ 完成 | 点击悬浮掉落物 → 飞入道具栏 → 库存 +1 |
| **开局自动吸附** | ✅ 完成 | 初始分裂落地后自动吸附 1 个 Lv.1 → 核心升 Lv.2 → 不计分不赠送 |
| **存档接入** | ✅ 完成 | 启动读取 + 进行中追踪 sessionMaxLevel/objectiveAchieved + 结束时更新 |
| **单局结果** | ✅ 完成 | `lastGameResult` 含 score/maxLevel/objective/isNewRecord/newlyUnlockedLevel |

### js/board.js — 棋盘核心逻辑

| 功能 | 状态 | 说明 |
|------|------|------|
| 37 格初始化 | ✅ 完成 | 内圈6 + 中圈12 + 外圈18，baseAngle 均匀分布；每格含 `reserved` / `mergeAnimating` |
| 圈层旋转 | ✅ 完成 | 内/外圈顺时针，中圈逆时针；速度由 `rotationSpeeds` 控制 |
| 同圈相邻判定 | ✅ 完成 | slotIndex 差值 1 或首尾相接 |
| 跨圈相邻判定 | ✅ 完成 | 实时角度差 < 较大圈层单格角度 × 0.5 |
| 核心相邻判定 | ✅ 完成 | 内圈始终与核心相邻（内部逻辑用；不用于连接线） |
| 初始分裂队列 | ✅ 完成 | 开局排队 4 次分裂（可配），每隔 12 帧触发 |
| 合成后分裂 | ✅ 完成 | `_findEmptyForMergeSplit`：按核心等级查 `spawnDistribution` 加权随机选圈层，圈内优先相邻空位；不锁输入 |
| **定时自动分裂** | ✅ 完成 | `updateTimedSplit` + `_fireTimedSplit`；安全期→前摇→中/外圈随机空位；中/外圈都满则跳过 |
| **前摇进度 `timedSplitWarningProgress`** | ✅ 完成 | 0..1，渲染器用它画暖色呼吸环 |
| 死锁保险队列 | ✅ 完成 | `countLevel1Incoming()` 含棋盘+飞行+队列 |
| 分裂位置算法（合成后） | ✅ 完成 | `_findEmptyForMergeSplit`：按核心等级查 early/mid/late 阶段 → 加权随机选圈层 → 圈内优先相邻空位 → 空圈层按 rate 降序 fallback |
| 飞行元素系统 | ✅ 完成 | 所有来源（初始/合成后/定时）共用同一个 `flyingElements[]` |
| 目标槽位预定 | ✅ 完成 | 飞行期间 `slot.reserved=true` |
| 核心脉冲状态 | ✅ 完成 | `corePulse` 计时器，分裂瞬间 15 帧 |
| **两步合成 — 选中状态** | ✅ 完成 | `board.selectedSlot` + `selectSlot` / `clearSelection` |
| **两步合成 — 相邻连接线邻居** | ✅ 完成 | `getNeighborsForConnection` 返回最多 4 个（内 3 / 中 4 / 外 3） |
| **两步合成 — 相邻查找辅助** | ✅ 完成 | `_findAlignedInRing` 找跨圈角度最近者 |
| **Combo 最近相邻** | ✅ 完成 | `findNearestAdjacentSameLevel` 供连锁递归使用 |
| **合成动画 — 启动** | ✅ 完成 | `startMergeAnimation(slotA, slotB)` 推入队列并锁输入 |
| **合成动画 — 推进/完成** | ✅ 完成 | `updateMergeAnimations(onBurst, onComplete)` 每帧 +1，聚合/弹出/写回 |
| **合成动画 — 渲染状态** | ✅ 完成 | `getMergeAnimationState` 返回两元素/新元素的插值位置与缩放 |
| **输入锁精细化** | ✅ 完成 | `_recomputeInputLock` 仅初始分裂未完成或合成动画进行中才锁 |
| 棋盘已满判定 | ✅ 完成 | 所有 slots 的 level 都不为 null |
| 元素半径计算 | ✅ 完成 | 8 + level × 1.2 px |
| 元素颜色表 | ✅ 完成 | 10 级颜色（附录见 GDD） |
| **暂停道具冻结字段** | ✅ 完成 | `timedSplitPauseFramesRemaining` — 暂停期间每帧 +1 scheduledFrame，冻结前摇 |

### js/renderer.js — Canvas 渲染

| 功能 | 状态 | 说明 |
|------|------|------|
| 暗色背景 | ✅ 完成 | #0a0a1a |
| 三层轨道线 | ✅ 完成 | 半透明白色圆环 |
| 空位标记 | ✅ 完成 | 5px 半透明白色小圆点 |
| 元素绘制 | ✅ 完成 | 径向渐变圆 + 外发光 + 边框 |
| 元素标签 | ✅ 完成 | 只显示等级数字 |
| 核心绘制 | ✅ 完成 | 24px 径向渐变 + 外发光 + "Lv.N" 文字 |
| 核心脉冲 | ✅ 完成 | 分裂瞬间放大 +25% + 发光增强 |
| **核心前摇特效** | ✅ 完成 | `drawCore(…, warningProgress)` 核心内部脉冲发光 + 震动（≤2px），严格不超出核心范围 |
| **选中态连接线** | ✅ 完成 | `drawConnectionLines`：4 个几何邻居；同级+相邻→亮色粗线（元素副色），否则暗灰细线；每帧重算 |
| **选中态高亮** | ✅ 完成 | `drawSelectionHighlight`：外发光 + 元素脉冲缩放（1.0↔1.15，周期 60 帧）+ 白色高亮环 |
| **合成动画绘制** | ✅ 完成 | `drawMergeAnimations`：聚合阶段双元素向中点滑动+缩小；弹出阶段新元素 0.5→1.2→1.0 缩放从中点回到 slotA |
| **drawSlots 跳过选中/动画 slot** | ✅ 完成 | 由选中/合成动画专用函数接管 |
| 飞行元素绘制 | ✅ 完成 | `drawFlyingElements` 沿路径插值，尺寸 0.3→1.0 缩放入场 |
| 分数 UI（原型版） | ✅ 完成 | 左上角大号分数 + 皇冠 + 金色历史最高分 |
| 核心等级 UI（原型版） | ✅ 完成 | 底部居中："核心等级 \| Lv.{n} {name}" |
| Combo 提示 | ✅ 完成 | combo ≥ 2 时显示 "COMBO x{n}!" |
| 浮动得分 | ✅ 完成 | 1.5 秒渐隐上浮 |
| 游戏结束界面 | ✅ 完成 | 遮罩 + 等级 + 分数 + "再来一局"按钮 |
| **道具栏绘制** | ✅ 完成 | `drawItemBar`：3 个几何图标槽位 + 数量 ×N + 有/无道具色阶 |
| **掉落物绘制** | ✅ 完成 | `drawDrops`：flyIn 拖尾 / floating 呼吸缩放 / blinking 快闪 / pickingUp 飞入道具栏 |
| **暂停覆盖层** | ✅ 完成 | `drawPauseOverlay`：核心波纹 + 紫色屏幕光晕 + 倒计时文字 + 临近结束闪烁 |
| **道具使用光效** | ✅ 完成 | `drawItemUseBurst`：清空暖金 / 升级绿松屏幕边缘脉冲 |
| **升级闪白** | ✅ 完成 | 被升级元素叠白色半透明层 18 帧渐隐 |
| **退出按钮** | ✅ 完成 | `drawExitButton`：右下角方框+箭头图标，#888888（暂无功能） |

### js/particles.js — 粒子系统

| 功能 | 状态 | 说明 |
|------|------|------|
| 合成爆发粒子 | ✅ 完成 | `spawn()` 在合成中点位置生成 |
| 吸附尾迹粒子 | ✅ 完成 | `spawnTrail()` 沿径向路径生成 |
| 装饰粒子 | ✅ 完成 | `spawnDecoration()` 元素周围漂浮 |
| 粒子更新 | ✅ 完成 | 位移 + 速度衰减 0.97 + 透明度衰减 |
| 200 上限控制 | ✅ 完成 | `MAX_PARTICLES = 200` |

### js/input.js — 触摸处理

| 功能 | 状态 | 说明 |
|------|------|------|
| `wx.onTouchStart` 监听 | ✅ 完成 | 微信小游戏触摸 API |
| 命中检测 | ✅ 完成 | 距离判定，触摸容差 10px，跳过 `level===null` 和 `reserved` 格 |
| 游戏结束按钮检测 | ✅ 完成 | `isRestartBtnHit()` |
| **两步交互集成** | ✅ 完成 | input.js 本身无变化，命中 slot 后直接交给 game.js 的 `handleSlotTap` 做两步判定 |
| **道具栏命中检测** | ✅ 完成 | `_hitTestItemBar`：遍历 `renderer.itemBarSlots`，命中后调 `items.use()` |
| **掉落物命中检测** | ✅ 完成 | `_hitTestDrop`：遍历 `items.drops`，floating/blinking 阶段可点击拾取 |
| **调试按钮命中** | ✅ 完成 | `isDebugBtnHit`：DEBUG_ITEMS=true 时左下角 +1 ALL 按钮（已关闭） |

### js/score.js — 计分系统

| 功能 | 状态 | 说明 |
|------|------|------|
| 基础合成分 | ✅ 完成 | 等级 × 10 |
| Combo 倍率 | ✅ 完成 | 基础分 × comboCount |
| 吸附奖励 | ✅ 完成 | 新核心等级 × 100 |
| 历史最高分 | ✅ 完成 | `wx.setStorageSync` 持久化（key: `genesis_high_score`） |

### js/items.js — 道具系统（新增）

| 功能 | 状态 | 说明 |
|------|------|------|
| 库存管理 | ✅ 完成 | `inventory = { clear, upgrade, pause }`，reset 清零 |
| 掉落物状态机 | ✅ 完成 | flyIn → floating → blinking → 消失；pickingUp → 飞入道具栏 |
| `spawnDrop(type, srcX, srcY, targets)` | ✅ 完成 | 左/右槽位分配，两侧都有时覆盖最老的 blinking |
| `pickupDrop(drop, barSlots)` | ✅ 完成 | 切换到 pickingUp 阶段，飞入对应道具栏槽位 |
| `use(type, board, particles)` | ✅ 完成 | 前置检查（库存 > 0 + 不在锁定中）→ 分派到具体效果 |
| `_useClear(board, particles)` | ✅ 完成 | 最密集圈层 Lv.1 消散 + fallback + 无效提示 |
| `_useUpgrade(board, particles)` | ✅ 完成 | 随机 3 个 Lv.1-5 +1 + 闪白 + 连锁合成判定 |
| `_usePause(board)` | ✅ 完成 | 冻结定时分裂 15s，可叠加（`+=`） |
| `update(board)` | ✅ 完成 | 推进 useAnim / pauseCountdown / upgradeFlash |
| `updateDrops()` | ✅ 完成 | 推进所有掉落物的阶段帧计数 |

### js/playerData.js — 本地存档（新增）

| 功能 | 状态 | 说明 |
|------|------|------|
| `loadPlayerData()` | ✅ 完成 | 从 `wx.getStorageSync` 读取，损坏/不存在时返回默认值，结果缓存 |
| `savePlayerData(data)` | ✅ 完成 | 写入 `wx.setStorageSync`，同步更新缓存 |
| `updateAfterGame(result)` | ✅ 完成 | 合并本局结果，更新 maxScore/maxLevel/totalGames/unlockedLevels，返回 `{ isNewRecord, newlyUnlockedLevel }` |
| `getCurrentGoal()` | ✅ 完成 | maxLevel≤3 返回 3；20% 返回 maxLevel（挑战）；80% 返回 maxLevel-1（舒适区） |
| `clearPlayerData()` | ✅ 完成 | 清除存档 + 缓存（调试用） |
| 存储 key | ✅ 完成 | `genesis_player_data` |

---

## 已验证功能（2026-04-21 自测通过）

| # | 功能 | 验证结果 |
|---|------|----------|
| 1 | 两步点击合成（相邻+同级） | ✅ 通过 |
| 2 | 两步点击切换选中（不相邻或不同级） | ✅ 通过 |
| 3 | 选中后再点同一格取消 | ✅ 通过 |
| 4 | 选中态发光环 + 脉冲呼吸 | ✅ 通过 |
| 5 | 4 条连接线（内圈 3 / 中圈 4 / 外圈 3）随旋转实时更新 | ✅ 通过 |
| 6 | 连接线高亮/暗淡根据同级+相邻判定 | ✅ 通过 |
| 7 | 合成动画（聚合 → 爆发 → 弹出） | ✅ 通过 |
| 8 | Combo 连锁（每步都动画） | ✅ 通过 |
| 9 | 跨圈相邻合成 | ✅ 通过 |
| 10 | 吸附升级 | ✅ 通过 |
| 11 | 定时分裂无安全期，开局后立即启动计时器 | ✅ 通过 |
| 12 | 每 N 秒（按核心等级）一次定时分裂 | ✅ 通过 |
| 13 | 前摇 1.5 秒核心内部脉冲发光 + 震动（不超出核心范围） | ✅ 通过 |
| 14 | 定时分裂目标：中/外圈随机空位 | ✅ 通过 |
| 15 | 中/外圈全满时定时分裂跳过，不触发 game over | ✅ 通过 |
| 16 | 合成后分裂（queueSplit）与定时分裂并行独立运行 | ✅ 通过 |
| 17 | 死锁保险（Lv.1 总数 ≥ 2） | ✅ 通过 |
| 18 | 历史最高分持久化 | ✅ 通过 |
| 19 | 游戏结束判定 + "再来一局" | ✅ 通过 |
| 20 | 合成后分裂按核心等级分阶段分布（early 偏中外圈 / mid 偏外圈 / late 偏内圈） | ✅ 通过 |
| 21 | 合成后分裂优先落在同圈层相邻空位 | ✅ 通过 |
| 22 | 道具栏 UI 显示（3 个几何图标 + 数量） | ✅ 通过 |
| 23 | 清空道具 — 最密集圈层 Lv.1 消散 + 粒子爆发 + 屏幕暖光 | ✅ 通过 |
| 24 | 清空道具 — 无 Lv.1 时 fallback 到其他圈 / 全无则不扣库存 | ✅ 通过 |
| 25 | 升级道具 — 随机 3 个 Lv.1-5 +1 + 闪白 | ✅ 通过 |
| 26 | 升级道具 — 升级后形成相邻同级自动触发连锁合成 | ✅ 通过 |
| 27 | 暂停道具 — 冻结定时分裂 + 核心波纹 + 倒计时 | ✅ 通过 |
| 28 | 暂停道具 — 叠加使用（剩余时间累加） | ✅ 通过 |
| 29 | 暂停道具 — 剩余 ≤3s 文字变红 + 波纹加速 | ✅ 通过 |
| 30 | 掉落物 flyIn → floating → blinking → 消失全流程 | ✅ 通过 |
| 31 | 掉落物点击拾取 → 飞入道具栏 → 库存 +1 | ✅ 通过 |
| 32 | Combo ≥ 2 触发随机道具掉落（每次连锁仅一次） | ✅ 通过 |
| 33 | 核心 Lv.5+ 升级赠送随机道具掉落（掉落位满时兜底入库） | ✅ 通过 |
| 34 | 合成/吸附锁定期间道具栏不可点击 | ✅ 通过 |
| 35 | 开局自动吸附 1 个 Lv.1 → 核心升 Lv.2 → 场上剩 3 个 Lv.1 | ✅ 通过 |
| 36 | 本地存档读取/保存/更新（playerData.js） | ✅ 通过 |
| 37 | 游戏结束时存档自动更新（isNewRecord / newlyUnlockedLevel） | ✅ 通过 |
| 38 | 单局目标生成（getCurrentGoal） | ✅ 通过 |
| 39 | 重启后 session 变量重置 + 新目标生成 | ✅ 通过 |

---

## 已知遗留问题 / 可优化项

| # | 问题 | 建议修复阶段 |
|---|------|--------------|
| 1 | `board.checkAbsorb` 扫描所有 slot 而非仅刚合成的结果 — 首次合成后可能把棋盘上其他同级 Lv.1 元素也一并吸附，导致核心等级异常快速跃迁 | 阶段五 bug 修复 |
| 2 | GDD 附录 Lv.1 Quark 主色 `#AFA9EC` 与代码 `#9B8FE2` 不一致；代码为准 | 阶段五（或 GDD 附录更新） |
| 3 | Lv.1 Quark 主色被 Stage 3 期间从 `#AFA9EC` 改为 `#9B8FE2`，如需按 GDD 原色可改回 | 视设计决定 |
| 4 | 元素贴图（Figma → images/）尚未接入，当前全部代码绘制 | 阶段五视觉升级（可选） |
| 5 | 真机触摸精度尚未在多种屏幕尺寸上测试 | 阶段五 |

---

## 待开发功能（后续阶段）

### 第八阶段：界面系统（P2-P6）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 游戏结束界面 | P2 | 毛玻璃遮罩 + 本局/最高分 + 破纪录特效 + 重新开始/返回主页 |
| 开始界面 | P3 | 星球插图 + 标题 + 成就区（最高分/等级/局数）+ 开始按钮 |
| 暂停弹窗 | P4 | 退出按钮触发 → 暂停旋转+计时器 → 继续/重新开始/返回主页 |
| 单局目标系统 | P5 | 动态目标 + 达成横幅（顶部下滑 5s 自动收起）|
| 完整页面流转 | P6 | 开始→游戏→暂停→结束→开始 |

### 第九阶段：视觉升级 + UI 配置化

| 功能 | 优先级 | 说明 |
|------|--------|------|
| UI_CONFIG 参数配置化 | 高 | 棋盘/分数/道具栏/核心等级等 UI 参数提取到配置对象 |
| 冷色调宇宙色板 | 中 | GDD v2.0 新元素颜色表（淡紫→金白渐变） |
| `checkAbsorb` bug 修复 | 高 | 见"已知遗留问题"第 1 条 |
| 真机性能实测 | 高 | 低端机帧率 / 粒子数表现 |

### 第十阶段：发布上线

| 事项 | 优先级 | 说明 |
|------|--------|------|
| 软著申请 | 高 | 尽早申请，审批周期 1-3 个月 |
| 游戏截图 | 中 | 至少 3 张 |
| 提交审核 | — | 审核通常 1-3 个工作日 |

---

## 关键技术参数速查

| 参数 | 值 | 来源 |
|------|-----|------|
| 旋转速度（默认） | 0.004 rad/frame | `js/board.js ROTATION_SPEED` / 实例 `board.rotationSpeeds.{inner,mid,outer}` |
| 旋转方向 | 内/外圈 +1，中圈 -1 | `js/board.js RING_CONFIG[ring].direction` |
| 内圈半径比 | 0.28 | `js/board.js RING_RADIUS_RATIO` |
| 中圈半径比 | 0.52 | `js/board.js RING_RADIUS_RATIO` |
| 外圈半径比 | 0.78 | `js/board.js RING_RADIUS_RATIO` |
| 棋盘半径 | `min(screenWidth × 0.445, (screenHeight-165) × 0.5)` | `game.js` |
| 棋盘中心 Y | `(110 + screenHeight - 55) / 2` | `game.js` |
| 元素半径 | `8 + level × 1.2` px | `js/board.js getElementRadius` |
| 核心半径 | 24px（脉冲时 × 1.25） | `js/renderer.js drawCore` |
| 触摸容差 | 10px | `js/input.js TOUCH_TOLERANCE` |
| 粒子上限 | 200 | `js/particles.js MAX_PARTICLES` |
| 装饰粒子间隔 | 每 30 帧 | `game.js decorationTimer` |
| 跨圈相邻阈值 | 较大圈层单格角度 × 0.5 | `js/board.js isAdjacent` |
| **初始分裂数量** | 4 | ★ `GAME_CONFIG.initialSplit.count` |
| **初始分裂节奏间隔** | 200ms（→ 12 帧） | ★ `GAME_CONFIG.initialSplit.intervalMs` |
| 飞行动画时长 | 18 帧 (~300ms) | `js/board.js FLY_FRAMES` |
| 核心脉冲时长 | 15 帧 | `js/board.js CORE_PULSE_FRAMES` |
| Lv.1 死锁下限 | 2 | `js/board.js DEADLOCK_MIN_LEVEL1` |
| 历史最高分存储 key | `genesis_high_score` | `js/score.js` |
| **安全期时长** | 0 秒（已取消） | ★ `GAME_CONFIG.timedSplit.safePeriodSeconds` |
| **前摇时长** | 1.5 秒 | ★ `GAME_CONFIG.timedSplit.preSplitWarningSeconds` |
| **定时分裂间隔（Lv.1-3）** | 20 秒 | ★ `GAME_CONFIG.timedSplit.intervalByLevel` |
| **定时分裂间隔（Lv.4-5）** | 15 秒 | ★ 同上 |
| **定时分裂间隔（Lv.6-7）** | 12 秒 | ★ 同上 |
| **定时分裂间隔（Lv.8-10）** | 8 秒 | ★ 同上 |
| **连接线总开关** | `true` | ★ `GAME_CONFIG.interaction.showConnectionLines` |
| **选中脉冲总开关** | `true` | ★ `GAME_CONFIG.interaction.selectionPulseEnabled` |
| **合成动画聚合帧** | 18 帧 | ★ `GAME_CONFIG.mergeAnimation.convergeFrames` |
| **合成动画弹出帧** | 6 帧 | ★ `GAME_CONFIG.mergeAnimation.popFrames` |
| **合成后分裂 early 阶段** | Lv.1-3：内 0 / 中 0.7 / 外 0.3 | ★ `GAME_CONFIG.spawnDistribution.early` |
| **合成后分裂 mid 阶段** | Lv.4-6：内 0.1 / 中 0.4 / 外 0.5 | ★ `GAME_CONFIG.spawnDistribution.mid` |
| **合成后分裂 late 阶段** | Lv.7+：内 0.5 / 中 0.2 / 外 0.3 | ★ `GAME_CONFIG.spawnDistribution.late` |
| **道具掉落悬浮时长** | 10 秒 | ★ `GAME_CONFIG.items.dropDurationMs` |
| **道具掉落快闪时长** | 5 秒 | ★ `GAME_CONFIG.items.blinkDurationMs` |
| **道具飞入时长** | 500ms | ★ `GAME_CONFIG.items.flyInMs` |
| **道具拾取飞行时长** | 400ms | ★ `GAME_CONFIG.items.flyToInventoryMs` |
| **Combo 触发掉落次数** | 2 | ★ `GAME_CONFIG.items.comboTriggerCount` |
| **核心赠送道具起始等级** | Lv.5 | ★ `GAME_CONFIG.items.coreLevelForGift` |
| **清空目标等级** | Lv.1 | ★ `GAME_CONFIG.items.clearItemTargetLevel` |
| **升级随机数量** | 3 | ★ `GAME_CONFIG.items.upgradeItemCount` |
| **升级最高源等级** | Lv.5 | ★ `GAME_CONFIG.items.upgradeItemMaxSourceLevel` |
| **暂停锁定时长** | 15 秒 | ★ `GAME_CONFIG.items.pauseItemDurationMs` |
| **暂停闪烁警告秒数** | 3 秒 | ★ `GAME_CONFIG.items.pauseItemBlinkAtSeconds` |
| **道具使用动效帧数** | 18 帧 | ★ `GAME_CONFIG.items.itemUseAnimFrames` |

★ = 本轮改动引入的配置项，在 `js/config.js` 中可调。

---

## 输入锁机制（重要行为说明）

`board.inputLocked` 由 `_recomputeInputLock()` 每帧重算，遵循：

| 场景 | 锁状态 |
|------|--------|
| 开局 4 次初始分裂尚未全部落地 | 🔒 锁 |
| 合成动画进行中（含 combo 连锁每一步） | 🔒 锁 |
| 合成后分裂（queueSplit + 飞行中） | 🔓 不锁 |
| 定时自动分裂（前摇 + 飞行） | 🔓 不锁 |
| 道具使用动画期间（清空/升级 18 帧） | 🔒 锁 |
| 暂停道具使用 | 🔓 不锁 |
| 空闲 | 🔓 不锁 |

玩家可在定时分裂的前摇和飞行期间继续选中/合成，暂停道具使用后也不锁输入。

---

## 模块依赖与文件结构（require 关系）

```
game.js
 ├─ require('./js/board')       → { Board, ELEMENT_COLORS }
 ├─ require('./js/renderer')    → Renderer
 ├─ require('./js/particles')   → Particles
 ├─ require('./js/input')       → Input
 ├─ require('./js/score')       → Score
 ├─ require('./js/items')       → { Items, ITEM_TYPES }
 ├─ require('./js/config')      → { GAME_CONFIG, msToFrames }
 └─ require('./js/playerData')  → { loadPlayerData, getCurrentGoal, updateAfterGame, ... }

js/board.js
 └─ require('./config')         → { GAME_CONFIG, msToFrames, secondsToFrames, getTimedSplitInterval }

js/renderer.js
 ├─ require('./board')          → { RING_CONFIG, RING_RADIUS_RATIO, ELEMENT_COLORS }
 └─ require('./config')         → { GAME_CONFIG }

js/items.js
 └─ require('./config')         → { GAME_CONFIG, msToFrames, secondsToFrames }

js/playerData.js                → 无依赖（使用 wx.getStorageSync / wx.setStorageSync）
js/config.js                    → 无依赖（叶子节点，含 GAME_CONFIG + UI_CONFIG）
js/particles.js                 → 无依赖
js/input.js                     → 无依赖
js/score.js                     → 无依赖
```

---

## 开发节奏参考

| 天数 | 阶段 | 目标 | 状态 |
|------|------|------|------|
| Day 1 | 环境搭建 | 安装所有工具 | ✅ 完成 |
| Day 2-3 | 项目创建 | 框架生成，棋盘显示并旋转 | ✅ 完成 |
| Day 4-7 | 核心玩法 | 分裂、合成、吸附、combo 全部编码完成 | ✅ 完成 |
| Day 8-10 | 视觉打磨 + 交互重构 | 配置化 / 定时分裂 / 两步点击 / 合成动画 / 连接线 | ✅ 完成并自测通过 |
| Day 11 | 道具系统 | 清空/升级/暂停三种道具 + 掉落/拾取 + combo/核心升级触发 | ✅ 完成 |
| Day 12 | 游戏调优 | 开局流程/取消安全期/Combo≥2掉落/核心Lv.5+赠送/前摇特效 | ✅ 完成 |
| Day 13 | 存档 + UI | playerData.js + 存档接入 + UI 样式调整 + UI_CONFIG 设计 tokens | ✅ 完成 |
| Day 14-15 | 界面系统 | 结束界面/开始界面/暂停弹窗/目标系统 | 🔲 待开发 |
| Day 16-17 | 视觉升级 | UI_CONFIG 接入/冷色调色板/checkAbsorb 修复/真机测试 | 🔲 待开发 |
| Day 18-19 | 发布准备 | 提交审核 | 🔲 待开发 |

---

*最后更新：2026-04-21 · 存档系统完成 + 游戏调优 5 项 + UI 样式调整 + UI_CONFIG 设计 tokens*
