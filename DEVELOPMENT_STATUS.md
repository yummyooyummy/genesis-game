# 万物起源 GENESIS — 开发进度追踪

**每次开发前请先阅读此文件，了解当前状态和待办事项。**

---

## 项目基本信息

- **项目名称：** 万物起源 GENESIS
- **平台：** 微信小游戏
- **技术栈：** 原生 Canvas API + JavaScript（CommonJS 模块）
- **AppID：** wxb749bfbf62a3d6b7
- **设计文档：** GENESIS_GDD_v1.2.md（内部版本 v1.3，2026-04-19 更新）
- **开发流程文档：** GENESIS_DEV_WORKFLOW_v1.0.md

---

## 文件结构

```
genesis-game/
├── game.js               ← 游戏入口 · 主循环 · 状态管理
├── game.json             ← 微信小游戏配置
├── project.config.json   ← 项目配置（AppID 已填入）
├── js/
│   ├── config.js         ← 全局配置（GAME_CONFIG 单例 + 时间/帧辅助）
│   ├── board.js          ← 棋盘数据结构与逻辑
│   ├── renderer.js       ← Canvas 渲染
│   ├── particles.js      ← 粒子效果系统
│   ├── input.js          ← 触摸事件处理
│   └── score.js          ← 计分系统
├── images/               ← 空文件夹（后续放 Figma 导出的元素 PNG）
├── GENESIS_GDD_v1.2.md
├── GENESIS_DEV_WORKFLOW_v1.0.md
└── DEVELOPMENT_STATUS.md ← 本文件
```

---

## 当前开发阶段

**阶段四：视觉打磨 + 交互重构 — 主要功能编码完成并通过自测 ✅**

在原有阶段三（核心玩法 + UI 原型还原）的基础上完成三项结构性改动：

1. **配置化** — 新增 `js/config.js`，集中管理定时分裂、初始分裂、交互、合成动画四类可调参数
2. **定时自动分裂** — 与"合成后分裂"并行的新分裂机制，随核心等级加速
3. **两步点击交互** — 取代原"一键自动合成最近邻居"，改为"选中 → 点相邻 → 合成"，带连接线、脉冲、合成动画

所有新功能已在微信开发者工具中自测通过。

---

## 各模块实现状态

### js/config.js — 全局配置（新增）

| 功能 | 状态 | 说明 |
|------|------|------|
| `GAME_CONFIG` 单例 | ✅ 完成 | 集中所有本轮新增功能的可调参数 |
| `timedSplit.safePeriodSeconds` | ✅ 完成 | 默认 30s 安全期 |
| `timedSplit.preSplitWarningSeconds` | ✅ 完成 | 默认 1.5s 前摇 |
| `timedSplit.intervalByLevel` | ✅ 完成 | `'1-3':20, '4-5':15, '6-7':12, '8-10':8` 秒 |
| `initialSplit.count / intervalMs` | ✅ 完成 | 开局分裂数量 4 + 间隔 200ms |
| `interaction.showConnectionLines` | ✅ 完成 | 连接线总开关 |
| `interaction.selectionPulseEnabled` | ✅ 完成 | 选中态脉冲总开关 |
| `mergeAnimation.convergeFrames / popFrames` | ✅ 完成 | 合成动画节奏（18 + 6 = 24 帧） |
| `spawnDistribution` | ✅ 完成 | 合成后分裂的圈层概率（early/mid/late 三阶段，按核心等级切换） |
| `secondsToFrames / msToFrames` | ✅ 完成 | 时长→帧数辅助 |
| `getTimedSplitInterval(coreLevel)` | ✅ 完成 | 按核心等级查表返回秒数 |

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
| **核心前摇呼吸环** | ✅ 完成 | `drawCore(…, warningProgress)` 期间叠加暖色（#EF9F27）慢呼吸环；1.5s 完成一次 0→1→0 |
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

### js/score.js — 计分系统

| 功能 | 状态 | 说明 |
|------|------|------|
| 基础合成分 | ✅ 完成 | 等级 × 10 |
| Combo 倍率 | ✅ 完成 | 基础分 × comboCount |
| 吸附奖励 | ✅ 完成 | 新核心等级 × 100 |
| 历史最高分 | ✅ 完成 | `wx.setStorageSync` 持久化（key: `genesis_high_score`） |

---

## 已验证功能（2026-04-20 自测通过）

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
| 11 | 开局 30 秒安全期无定时分裂 | ✅ 通过 |
| 12 | 30 秒后每 N 秒（按核心等级）一次定时分裂 | ✅ 通过 |
| 13 | 前摇 1.5 秒暖色呼吸环 | ✅ 通过 |
| 14 | 定时分裂目标：中/外圈随机空位 | ✅ 通过 |
| 15 | 中/外圈全满时定时分裂跳过，不触发 game over | ✅ 通过 |
| 16 | 合成后分裂（queueSplit）与定时分裂并行独立运行 | ✅ 通过 |
| 17 | 死锁保险（Lv.1 总数 ≥ 2） | ✅ 通过 |
| 18 | 历史最高分持久化 | ✅ 通过 |
| 19 | 游戏结束判定 + "再来一局" | ✅ 通过 |
| 20 | 合成后分裂按核心等级分阶段分布（early 偏中外圈 / mid 偏外圈 / late 偏内圈） | ✅ 通过 |
| 21 | 合成后分裂优先落在同圈层相邻空位 | ✅ 通过 |

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

### 第五阶段：视觉升级与真机测试

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 元素图片贴图 | 中 | Figma 设计 10 级元素 PNG → images/ → drawImage |
| 屏幕震动（combo） | 低 | combo 时屏幕轻微震动 |
| 音效 | 低 | 合成 / 吸附 / 前摇触发音 |
| 真机性能实测 | 高 | 低端机帧率 / 粒子数表现 |
| 数值平衡 | 中 | 定时分裂间隔、安全期长度可能需要微调 |
| `checkAbsorb` bug 修复 | 高 | 见"已知遗留问题"第 1 条 |

### 第六阶段：发布上线

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
| **安全期时长** | 30 秒 | ★ `GAME_CONFIG.timedSplit.safePeriodSeconds` |
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
| 空闲 | 🔓 不锁 |

玩家可在定时分裂的前摇和飞行期间继续选中/合成，动画期间不受打扰。

---

## 模块依赖与文件结构（require 关系）

```
game.js
 ├─ require('./js/board')       → { Board, ELEMENT_COLORS }
 ├─ require('./js/renderer')    → Renderer
 ├─ require('./js/particles')   → Particles
 ├─ require('./js/input')       → Input
 └─ require('./js/score')       → Score

js/board.js
 └─ require('./config')         → { GAME_CONFIG, msToFrames, secondsToFrames, getTimedSplitInterval }

js/renderer.js
 ├─ require('./board')          → { RING_CONFIG, RING_RADIUS_RATIO, ELEMENT_COLORS }
 └─ require('./config')         → { GAME_CONFIG }

js/config.js                    → 无依赖（叶子节点）
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
| Day 11-12 | 真机测试 + 性能优化 + `checkAbsorb` 修复 | 🔲 待开发 |
| Day 13-14 | 发布准备 | 提交审核 | 🔲 待开发 |

---

*最后更新：2026-04-20 · 合成后分裂位置阶段性分布（按核心等级切换圈层偏向 + 优先相邻空位）*
