/**
 * 万物起源 GENESIS — 本地存档系统
 *
 * 使用微信小游戏 wx.setStorageSync / wx.getStorageSync 持久化玩家数据。
 * 所有函数通过 module.exports 导出，game.js 按需引入调用。
 */

const STORAGE_KEY = 'genesis_player_data';

/** 默认存档（新玩家 / 存档损坏时的兜底值） */
function _defaultData() {
  return {
    maxScore: 0,
    maxLevel: 1,
    totalGames: 0,
    unlockedLevels: [1],
  };
}

/** 模块级缓存，避免重复读 storage */
let _cache = null;

/**
 * 读取存档。不存在或损坏时返回默认值。
 * 首次调用后结果缓存到 _cache，后续直接返回缓存。
 */
function loadPlayerData() {
  if (_cache) return _cache;
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && typeof raw === 'object' && Array.isArray(raw.unlockedLevels)) {
      _cache = Object.assign(_defaultData(), raw);
      return _cache;
    }
  } catch (e) {
    // 存档损坏或读取失败，静默降级
  }
  _cache = _defaultData();
  return _cache;
}

/**
 * 保存存档到本地 storage，同时更新缓存。
 * @param {object} data - 完整的存档对象
 */
function savePlayerData(data) {
  _cache = data;
  try {
    wx.setStorageSync(STORAGE_KEY, data);
  } catch (e) {
    // 写入失败（存储空间不足等），静默忽略
  }
}

/**
 * 游戏结束时调用，合并本局结果到存档并持久化。
 * @param {{ score: number, maxLevelReached: number }} result
 * @returns {{ isNewRecord: boolean, newlyUnlockedLevel: number|null }}
 */
function updateAfterGame(result) {
  const data = loadPlayerData();

  const isNewRecord = result.score > data.maxScore;
  if (isNewRecord) data.maxScore = result.score;

  // 更新历史最高核心等级 + 解锁记录
  let newlyUnlockedLevel = null;
  if (result.maxLevelReached > data.maxLevel) {
    data.maxLevel = result.maxLevelReached;
  }
  for (let lv = 1; lv <= result.maxLevelReached; lv++) {
    if (!data.unlockedLevels.includes(lv)) {
      data.unlockedLevels.push(lv);
      newlyUnlockedLevel = lv; // 返回最高的新解锁等级
    }
  }
  data.unlockedLevels.sort((a, b) => a - b);

  data.totalGames += 1;

  savePlayerData(data);
  return { isNewRecord, newlyUnlockedLevel };
}

/**
 * 清除存档（调试用）。同时清空缓存。
 */
function clearPlayerData() {
  _cache = null;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    // 静默忽略
  }
}

module.exports = {
  loadPlayerData,
  savePlayerData,
  updateAfterGame,
  clearPlayerData,
};
