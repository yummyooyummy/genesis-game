/**
 * 游戏全局配置
 * 集中管理可调参数，避免在各模块中硬编码。
 * 帧基准：60 fps（1 秒 = 60 帧）。
 */

const TARGET_FPS = 60;

const GAME_CONFIG = {
  // 定时自动分裂
  timedSplit: {
    safePeriodSeconds: 30,        // 游戏开始后的安全期（秒）
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
