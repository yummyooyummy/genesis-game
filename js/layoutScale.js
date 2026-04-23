/**
 * 设计基准尺寸（Claude Design JSON 规格）
 */
const DESIGN_WIDTH = 375;
const DESIGN_HEIGHT = 812;

/**
 * LayoutScale - 坐标/尺寸缩放工具
 *
 * 基于设备 screenWidth × screenHeight 做缩放
 * (canvas 逻辑像素 === screenWidth × screenHeight)
 */
const LayoutScale = {
  screenWidth: 375,
  screenHeight: 812,
  scaleX: 1,
  scaleY: 1,
  scaleMin: 1,

  init(screenWidth, screenHeight) {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.scaleX = screenWidth / DESIGN_WIDTH;
    this.scaleY = screenHeight / DESIGN_HEIGHT;
    this.scaleMin = Math.min(this.scaleX, this.scaleY);
  },

  // 设计稿 x 坐标 → 设备坐标
  dx(designX) {
    return designX * this.scaleX;
  },

  // 设计稿 y 坐标 → 设备坐标
  dy(designY) {
    return designY * this.scaleY;
  },

  // 尺寸等比缩放（用于圆形等需要保持比例的元素）
  ds(designSize) {
    return designSize * this.scaleMin;
  },

  // 字号缩放（用 scaleMin 保证不拉扁）
  df(designFontSize) {
    return designFontSize * this.scaleMin;
  },
};

module.exports = LayoutScale;
