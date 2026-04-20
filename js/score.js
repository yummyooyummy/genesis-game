/**
 * 计分系统
 * 负责分数计算：基础合成分 + Combo 倍率 + 吸附奖励
 * 持久化：历史最高分使用 wx.setStorageSync 保存
 */

const { GAME_CONFIG } = require('./config');

const HIGH_SCORE_KEY = 'genesis_high_score';

class Score {
  constructor() {
    this.total = 0;
    this.combo = 0;             // 当前连锁计数
    this.lastScorePopup = null; // 用于渲染浮动分数
    this.highScore = this._loadHighScore();
  }

  /** 从微信本地存储读取历史最高分 */
  _loadHighScore() {
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) {
        const v = wx.getStorageSync(HIGH_SCORE_KEY);
        return typeof v === 'number' && v > 0 ? v : 0;
      }
    } catch (e) {
      // 存储不可用则回退为 0
    }
    return 0;
  }

  /** 把当前最高分写入本地存储 */
  _saveHighScore() {
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) {
        wx.setStorageSync(HIGH_SCORE_KEY, this.highScore);
      }
    } catch (e) {
      // 存储不可用则忽略
    }
  }

  /** 刷新历史最高分（total > 已存）则保存 */
  _maybeUpdateHighScore() {
    if (this.total > this.highScore) {
      this.highScore = this.total;
      this._saveHighScore();
    }
  }

  /**
   * 合成得分
   * @param {number} newLevel - 合成后的元素等级
   * @param {number} comboCount - 当前 combo 次数（从 1 开始）
   * @returns {number} 本次得分
   */
  addMergeScore(newLevel, comboCount) {
    const { baseMultiplier, comboBase, comboIncrement } = GAME_CONFIG.scoring;
    const baseScore = newLevel * baseMultiplier;
    const multiplier = comboBase + comboIncrement * Math.max(1, comboCount);
    const points = Math.round(baseScore * multiplier);
    this.total += points;
    this.lastScorePopup = {
      points,
      combo: comboCount,
      time: Date.now(),
    };
    this._maybeUpdateHighScore();
    return points;
  }

  /**
   * 吸附升级奖励
   * @param {number} newCoreLevel - 升级后的核心等级
   * @returns {number} 本次奖励分
   */
  addAbsorbScore(newCoreLevel) {
    const points = newCoreLevel * GAME_CONFIG.scoring.absorbMultiplier;
    this.total += points;
    this.lastScorePopup = {
      points,
      combo: 0,
      time: Date.now(),
    };
    this._maybeUpdateHighScore();
    return points;
  }

  /** 重置 combo 计数 */
  resetCombo() {
    this.combo = 0;
  }

  /** 递增 combo 计数并返回当前值 */
  incrementCombo() {
    this.combo += 1;
    return this.combo;
  }

  /** 重置全部（历史最高分不会重置） */
  reset() {
    this.total = 0;
    this.combo = 0;
    this.lastScorePopup = null;
  }
}

module.exports = Score;
