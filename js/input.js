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
   * @param {Function} [onItemTap] - 点击道具栏图标回调 (type:'clear'|'upgrade'|'pause')
   * @param {Function} [onDropTap] - 点击悬浮掉落物回调 (drop)
   */
  constructor(canvas, dpr, onSlotTap, onRestartTap, onItemTap, onDropTap) {
    this.canvas = canvas;
    this.dpr = dpr;
    this.onSlotTap = onSlotTap;
    this.onRestartTap = onRestartTap;
    this.onItemTap = onItemTap || null;
    this.onDropTap = onDropTap || null;

    /** @type {Board} */
    this.board = null;

    /** @type {Renderer} */
    this.renderer = null;

    /** @type {import('./items').Items} */
    this.items = null;

    /** 游戏是否结束 */
    this.isGameOver = false;

    /** 是否暂停 */
    this.isPaused = false;

    /** 是否在菜单界面 */
    this.isMenu = true;

    /** 是否在 intro 转场中（锁死所有输入） */
    this.isIntro = false;

    /** 菜单触摸回调 */
    this.onMenuTouch = null;

    /** 暂停弹窗触摸回调 */
    this.onPausedTouch = null;

    /** 点击暂停按钮回调 */
    this.onPauseTap = null;

    this._bindEvents();
  }

  /**
   * 注入 board、renderer、items 引用
   */
  setReferences(board, renderer, items) {
    this.board = board;
    this.renderer = renderer;
    this.items = items || null;
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
    if (this.isIntro) return;

    if (this.isMenu) {
      if (this.onMenuTouch) {
        this.onMenuTouch(x, y);
      }
      return;
    }

    if (this.isPaused) {
      if (this.onPausedTouch) {
        this.onPausedTouch(x, y);
      }
      return;
    }

    if (this.isGameOver) {
      if (this.onGameOverTouch) {
        this.onGameOverTouch(x, y);
      }
      return;
    }

    // 暂停按钮命中（优先级最高）
    if (this.onPauseTap && this.renderer && this.renderer.pauseBtnPos) {
      const btn = this.renderer.pauseBtnPos;
      const dx = x - btn.x;
      const dy = y - btn.y;
      if (dx * dx + dy * dy <= btn.r * btn.r) {
        this.onPauseTap();
        return;
      }
    }




    // 调试：快速加道具
    if (this.onDebugItemTap) {
      const LS = require('./layoutScale');
      const dbx = LS.dx(335), dby = LS.dy(60), dbr = LS.ds(24);
      const ddx = x - dbx, ddy = y - dby;
      if (ddx * ddx + ddy * ddy <= dbr * dbr) {
        this.onDebugItemTap();
        return;
      }
    }

    // 悬浮掉落物命中（优先于道具栏和棋盘）
    if (this.onDropTap && this.items) {
      const drop = this._hitTestDrop(x, y);
      if (drop) {
        this.onDropTap(drop);
        return;
      }
    }

    // 道具栏命中（优先于棋盘格子命中）
    if (this.onItemTap) {
      const itemType = this._hitTestItemBar(x, y);
      if (itemType) {
        GameGlobal.itemPressState = {
          type: itemType,
          pressedAt: Date.now(),
        };
        this.onItemTap(itemType);
        return;
      }
    }

    // 正常游戏：命中检测
    if (!this.board) return;
    const hitSlot = this._hitTest(x, y);
    if (hitSlot) {
      this.onSlotTap(hitSlot);
    }
  }

  /**
   * 道具栏命中检测：遍历 renderer.itemBarSlots，返回命中的道具类型
   * @param {number} x
   * @param {number} y
   * @returns {'clear'|'upgrade'|'pause'|null}
   */
  _hitTestItemBar(x, y) {
    if (!this.renderer || !this.renderer.itemBarSlots) return null;
    for (const slot of this.renderer.itemBarSlots) {
      const dx = x - slot.x;
      const dy = y - slot.y;
      const r = slot.r + TOUCH_TOLERANCE;
      if (dx * dx + dy * dy <= r * r) {
        return slot.type;
      }
    }
    return null;
  }

  /**
   * 掉落物命中检测：floating/blinking 阶段可点击
   * @param {number} x
   * @param {number} y
   * @returns {object|null}
   */
  _hitTestDrop(x, y) {
    if (!this.items) return null;
    for (const drop of this.items.drops) {
      if (drop.pickingUp) continue;
      if (drop.phase !== 'floating' && drop.phase !== 'blinking') continue;
      const dx = x - drop.targetX;
      const dy = y - drop.targetY;
      const r = 24 + TOUCH_TOLERANCE;
      if (dx * dx + dy * dy <= r * r) return drop;
    }
    return null;
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
