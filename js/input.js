/**
 * 触摸事件处理
 * 负责：触摸监听、Canvas 坐标缩放转换、命中检测
 * 使用微信小游戏 wx.onTouchStart API
 */

/** 触摸容差（像素） */
const TOUCH_TOLERANCE = 10;

class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} dpr - 设备像素比
   * @param {Function} onSlotTap - 点击格子回调 (slot)
   * @param {Function} onRestartTap - 点击重新开始回调 ()
   */
  constructor(canvas, dpr, onSlotTap, onRestartTap) {
    this.canvas = canvas;
    this.dpr = dpr;
    this.onSlotTap = onSlotTap;
    this.onRestartTap = onRestartTap;

    /** @type {Board} */
    this.board = null;

    /** @type {Renderer} */
    this.renderer = null;

    /** 游戏是否结束 */
    this.isGameOver = false;

    this._bindEvents();
  }

  /**
   * 注入 board 和 renderer 引用
   */
  setReferences(board, renderer) {
    this.board = board;
    this.renderer = renderer;
  }

  /** 绑定触摸事件（微信小游戏 API） */
  _bindEvents() {
    wx.onTouchStart((e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        // 微信小游戏 touch 坐标就是逻辑像素，无需转换 clientX
        this._handleTouch(touch.clientX, touch.clientY);
      }
    });
  }

  /**
   * 处理触摸
   * @param {number} x - 逻辑像素坐标 x
   * @param {number} y - 逻辑像素坐标 y
   */
  _handleTouch(x, y) {
    // 游戏结束时只检测重新开始按钮
    if (this.isGameOver) {
      if (this.renderer && this.renderer.isRestartBtnHit(x, y)) {
        this.onRestartTap();
      }
      return;
    }

    // 正常游戏：命中检测
    if (!this.board) return;
    const hitSlot = this._hitTest(x, y);
    if (hitSlot) {
      this.onSlotTap(hitSlot);
    }
  }

  /**
   * 命中检测：找到触摸位置最近的有元素的格子
   * @param {number} x - 逻辑像素坐标 x
   * @param {number} y - 逻辑像素坐标 y
   * @returns {object|null} 命中的格子，或 null
   */
  _hitTest(x, y) {
    let closestSlot = null;
    let closestDist = Infinity;

    for (const slot of this.board.slots) {
      if (slot.level === null) continue; // 跳过空位

      const pos = this.board.getSlotPosition(slot);
      const dx = x - pos.x;
      const dy = y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = this.board.getElementRadius(slot.level) + TOUCH_TOLERANCE;

      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        closestSlot = slot;
      }
    }

    return closestSlot;
  }
}

module.exports = Input;
