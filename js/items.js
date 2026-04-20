/**
 * 道具系统
 * 负责：库存管理、掉落物生命周期（flyIn → floating → blinking）、
 *       三种道具效果（清空 / 升级 / 暂停）的执行与动效推进
 *
 * 触发来源（由 game.js 调度）：
 *   - combo 连锁达到 comboTriggerCount → spawnDrop
 *   - 核心升级到 coreLevelForGift 及以上 → spawnDrop
 *
 * 拾取流程：floating 悬浮 → 玩家点击 → 飞向底部道具栏对应槽位 → 库存 +1
 */

const { GAME_CONFIG, msToFrames } = require('./config');

/** 三种道具类型（顺序即道具栏顺序） */
const ITEM_TYPES = ['clear', 'upgrade', 'pause'];

class Items {
  constructor() {
    /** 库存数量（按类型） */
    this.inventory = { clear: 0, upgrade: 0, pause: 0 };

    /** 屏幕上悬浮/飞行中的掉落物（最多 2 个，对应左右两侧固定位） */
    this.drops = [];

    /**
     * 正在播放的使用动效（清空/升级时锁输入并做屏幕反馈）
     * { type: 'clear'|'upgrade', frame: number, totalFrames: number }
     */
    this.useAnim = null;

    /** 暂停道具剩余帧数（镜像 board.timedSplitPauseFramesRemaining，仅供 UI 读取） */
    this.pauseCountdownFrames = 0;

    /**
     * 使用失败提示（如"该道具暂时无法使用"）
     * { text: string, frame: number, totalFrames: number }
     */
    this.useFailHint = null;
  }

  /** 重置到初始状态（由 game.js 的 handleRestart 调用） */
  reset() {
    this.inventory = { clear: 0, upgrade: 0, pause: 0 };
    this.drops = [];
    this.useAnim = null;
    this.pauseCountdownFrames = 0;
    this.useFailHint = null;
  }

  /** 给某种道具 +N（调试用 / 拾取到位后调用） */
  grant(type, count = 1) {
    if (!ITEM_TYPES.includes(type)) return;
    this.inventory[type] += count;
  }
}

module.exports = { Items, ITEM_TYPES };
