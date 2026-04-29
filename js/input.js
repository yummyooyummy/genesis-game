/**
 * 触摸事件处理
 * 负责：触摸监听、Canvas 坐标缩放转换、命中检测
 * 使用微信小游戏 wx.onTouchStart API
 */

/** 触摸容差（像素） */
const TOUCH_TOLERANCE = 14;

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

    /** 暂停弹窗按钮回调 */
    this._onPauseResume = null;
    this._onPauseRestart = null;
    this._onPauseHome = null;

    /** 游戏结束按钮回调 */
    this._onGameOverRestart = null;
    this._onGameOverHome = null;
    this._onGameOverShare = null;

    /** 点击暂停按钮回调 */
    this.onPauseTap = null;

    /** 按钮边界引用（由 game.js 每帧更新） */
    this._menuButtons = null;
    this._pauseDialogButtons = null;
    this._gameOverButtons = null;

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
    this._lastTouchPos = null;

    wx.onTouchStart((e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;
        this._lastTouchPos = { x, y };
        this._handleTouch(x, y);
      }
    });

    wx.onTouchMove((e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        this._lastTouchPos = { x: touch.clientX, y: touch.clientY };
      }
    });

    wx.onTouchEnd((e) => {
      const ct = e.changedTouches && e.changedTouches[0];
      const pos = ct
        ? { x: ct.clientX, y: ct.clientY }
        : this._lastTouchPos;
      this._handleTouchEnd(pos);
      this._lastTouchPos = null;
    });

    wx.onTouchCancel(() => {
      this._handleTouchCancel();
      this._lastTouchPos = null;
    });
  }

  /**
   * 检测坐标命中了哪个按钮（返回按钮 ID 字符串或 null）
   */
  _hitTestButton(x, y) {
    const ui = require('./uiHelpers');

    if (this.isMenu) {
      if (this._menuButtons && this._menuButtons.start) {
        const b = this._menuButtons.start;
        if (ui.isPointInRect(x, y, b.x, b.y, b.w, b.h)) return 'menu_start';
      }
      return null;
    }

    if (this.isPaused) {
      const pb = this._pauseDialogButtons;
      if (pb) {
        if (ui.isPointInRect(x, y, pb.resume.x, pb.resume.y, pb.resume.w, pb.resume.h)) return 'pause_resume';
        if (ui.isPointInRect(x, y, pb.restart.x, pb.restart.y, pb.restart.w, pb.restart.h)) return 'pause_restart';
        if (ui.isPointInRect(x, y, pb.home.x, pb.home.y, pb.home.w, pb.home.h)) return 'pause_home';
      }
      return null;
    }

    if (this.isGameOver) {
      const gb = this._gameOverButtons;
      if (gb) {
        if (gb.restart && ui.isPointInRect(x, y, gb.restart.x, gb.restart.y, gb.restart.w, gb.restart.h)) return 'gameover_restart';
        if (gb.home && ui.isPointInRect(x, y, gb.home.x, gb.home.y, gb.home.w, gb.home.h)) return 'gameover_home';
        if (gb.share && ui.isPointInRect(x, y, gb.share.x, gb.share.y, gb.share.w, gb.share.h)) return 'gameover_share';
      }
      return null;
    }

    // playing 状态：暂停按钮
    if (this.renderer && this.renderer.pauseBtnPos) {
      const btn = this.renderer.pauseBtnPos;
      const dx = x - btn.x;
      const dy = y - btn.y;
      if (dx * dx + dy * dy <= btn.r * btn.r) return 'pause_btn';
    }

    return null;
  }

  /**
   * 处理触摸按下
   */
  _handleTouch(x, y) {
    if (this.isIntro) return;

    // 检测是否命中了带反馈的按钮
    const btnId = this._hitTestButton(x, y);
    if (btnId) {
      GameGlobal.buttonPressState = {
        id: btnId,
        phase: 'down',
        downAt: Date.now(),
        upAt: 0,
      };
      return;
    }

    // 以下是不带按钮反馈的交互（道具栏、棋盘、调试等）
    if (this.isMenu || this.isPaused || this.isGameOver) return;

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
   * 处理触摸松开
   */
  _handleTouchEnd(pos) {
    const s = GameGlobal.buttonPressState;
    if (!s || s.phase !== 'down') return;

    if (!pos) {
      s.phase = 'cancel';
      return;
    }

    const hitId = this._hitTestButton(pos.x, pos.y);
    if (hitId === s.id) {
      s.phase = 'releasing';
      s.upAt = Date.now();
      this._fireButtonAction(s.id);
    } else {
      s.phase = 'cancel';
    }
  }

  /**
   * 处理触摸取消
   */
  _handleTouchCancel() {
    const s = GameGlobal.buttonPressState;
    if (s && s.phase === 'down') {
      s.phase = 'cancel';
    }
  }

  /**
   * 触发按钮的实际 click 逻辑
   */
  _fireButtonAction(id) {
    const V2_IDS = ['menu_start', 'gameover_restart', 'pause_restart'];
    if (V2_IDS.includes(id)) {
      GameGlobal.AudioManager.playSFX('button_V2');
    } else {
      GameGlobal.AudioManager.playSFX('button');
    }

    switch (id) {
      case 'menu_start':
        if (this.onMenuTouch) this.onMenuTouch(id);
        break;
      case 'pause_btn':
        if (this.onPauseTap) this.onPauseTap();
        break;
      case 'pause_resume':
        if (this._onPauseResume) this._onPauseResume();
        break;
      case 'pause_restart':
        if (this._onPauseRestart) this._onPauseRestart();
        break;
      case 'pause_home':
        if (this._onPauseHome) this._onPauseHome();
        break;
      case 'gameover_restart':
        if (this._onGameOverRestart) this._onGameOverRestart();
        break;
      case 'gameover_home':
        if (this._onGameOverHome) this._onGameOverHome();
        break;
      case 'gameover_share':
        if (this._onGameOverShare) this._onGameOverShare();
        break;
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
