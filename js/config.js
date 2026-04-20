/**
 * 游戏全局配置
 * 集中管理可调参数，避免在各模块中硬编码。
 * 帧基准：60 fps（1 秒 = 60 帧）。
 */

const TARGET_FPS = 60;

const GAME_CONFIG = {
  // 定时自动分裂
  timedSplit: {
    safePeriodSeconds: 0,         // 游戏开始后的安全期（秒）— 0 表示立即启动定时分裂
    preSplitWarningSeconds: 1.5,  // 分裂前摇动效时长（秒）
    intervalByLevel: {
      '1-3': 20,   // 核心 Lv.1-3 时的定时分裂间隔（秒）
      '4-5': 15,
      '6-7': 12,
      '8-10': 8,
    },
  },
  // 开局连续分裂
  initialSplit: {
    count: 4,                     // 开局分裂数量
    intervalMs: 400,              // 每个之间间隔（毫秒）
  },
  // 交互
  interaction: {
    showConnectionLines: true,    // 是否显示连接线
    selectionPulseEnabled: true,  // 是否启用选中态脉冲
  },
  // 合成动画
  mergeAnimation: {
    convergeFrames: 18,           // 两元素向中点聚合（帧）
    popFrames: 6,                 // 新元素从 0.5× 放大到 1.0×（帧）
  },
  // 合成后流程（合成动画结束后的各阶段时长）
  mergeFlow: {
    newElementPauseMs: 500,       // 新元素停留展示
    absorbAnimMs: 600,            // 吸附飞行动画
    coreUpgradeBurstMs: 500,      // 核心升级爆发
    recoveryMs: 100,              // 恢复过渡
  },
  // 计分
  scoring: {
    baseMultiplier: 5,            // 基础分 = 等级 × 此值
    comboBase: 1,                 // combo 倍率基数
    comboIncrement: 0.5,          // 每次连锁增加的倍率
    absorbMultiplier: 20,         // 吸附奖励 = 新核心等级 × 此值
  },
  // 合成后分裂位置分布（按核心等级分阶段）
  spawnDistribution: {
    early: { innerRate: 0, midRate: 0.7, outerRate: 0.3 },
    mid:   { innerRate: 0.1, midRate: 0.4, outerRate: 0.5 },
    late:  { innerRate: 0.5, midRate: 0.2, outerRate: 0.3 },
    earlyUntilCoreLevel: 3,       // Lv.1-3 用 early
    midUntilCoreLevel: 6,         // Lv.4-6 用 mid；Lv.7+ 用 late
  },
  // 道具系统
  items: {
    // 通用
    dropDurationMs: 10000,        // 悬浮持续时间
    blinkDurationMs: 5000,        // 即将消失时的快闪持续时间
    flyInMs: 500,                 // 触发源 → 掉落位的飞行时长
    flyToInventoryMs: 400,        // 悬浮物 → 道具栏的拾取飞行时长
    comboTriggerCount: 5,         // combo 多少次触发一次掉落
    coreLevelForGift: 7,          // 核心升到该等级起开始赠送（含本级）

    // 清空道具
    clearItemTargetLevel: 1,      // 清除的目标元素等级

    // 升级道具
    upgradeItemCount: 3,          // 随机选几个元素
    upgradeItemMaxSourceLevel: 5, // 可被选中的最高等级（Lv.1-5）

    // 暂停道具
    pauseItemDurationMs: 15000,   // 单次锁定时长
    pauseItemAffectsMerge: false, // 是否冻结合成后分裂（false = 不影响）
    pauseItemAffectsTimed: true,  // 是否冻结定时分裂（true = 冻结）
    pauseItemBlinkAtSeconds: 3,   // 剩余几秒开始闪烁警告

    // 使用动效
    itemUseAnimFrames: 18,        // 清空/升级使用后输入锁帧数
    dropSlotOffsetY: 0.92,        // 掉落位 y = centerY + boardRadius * 此值
    dropSlotOffsetX: 0.58,        // 掉落位 x = centerX ± boardRadius * 此值
  },
};

/** 秒转帧 */
function secondsToFrames(seconds) {
  return Math.round(seconds * TARGET_FPS);
}

/** 毫秒转帧 */
function msToFrames(ms) {
  return Math.round((ms / 1000) * TARGET_FPS);
}

/**
 * 根据核心当前等级获取定时分裂间隔（秒）
 * 范围键形如 '1-3' | '4-5' | '6-7' | '8-10'
 * @param {number} coreLevel
 * @returns {number} 间隔秒数
 */
function getTimedSplitInterval(coreLevel) {
  const table = GAME_CONFIG.timedSplit.intervalByLevel;
  for (const range in table) {
    const [lo, hi] = range.split('-').map(Number);
    if (coreLevel >= lo && coreLevel <= hi) return table[range];
  }
  // fallback：找不到匹配时用第一个
  const firstKey = Object.keys(table)[0];
  return table[firstKey];
}

module.exports = {
  GAME_CONFIG,
  TARGET_FPS,
  secondsToFrames,
  msToFrames,
  getTimedSplitInterval,
};
