/**
 * 游戏全局配置
 * 集中管理可调参数，避免在各模块中硬编码。
 * 帧基准：60 fps（1 秒 = 60 帧）。
 */
// UI 设计 tokens 来自 design/design_tokens.json

const TARGET_FPS = 60;

const GAME_CONFIG = {
  // 定时自动分裂
  timedSplit: {
    safePeriodSeconds: 5,         // 游戏开始后的安全期（秒）— 0 表示立即启动定时分裂
    preSplitWarningSeconds: 1.5,  // 分裂前摇动效时长（秒）
    intervalByLevel: {
      '1-3': 5,   // 核心 Lv.1-3 时的定时分裂间隔（秒）
      '4-5': 8,
      '6-7': 8,
      '8-10': 8,
    },
  },
  // 开局连续分裂
  initialSplit: {
    count: 4,                     // 开局分裂数量
    intervalMs: 450,              // 每个之间间隔（毫秒）
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
    comboTriggerCount: 2,         // combo 达到此次数触发一次掉落
    coreLevelForGift: 5,          // 核心升到该等级起开始赠送（含本级）

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

const UI_CONFIG = {
  // 屏幕尺寸（基准）
  screen: {
    // 设计稿基准宽度（px）
    baseWidth: 390,
    // 设计稿基准高度（px）
    baseHeight: 844,
  },

  // 颜色
  color: {
    // 深层背景色（页面最底层）
    bgDeep: '#050818',
    // 中层背景色（渐变/过渡层）
    bgMid: '#0A0E27',
    // 半透明遮罩（弹层/浮层背景）
    bgOverlay: 'rgba(10,14,39,0.65)',
    // 玻璃卡片底色（常规透明度）
    glassCard: 'rgba(30,40,80,0.55)',
    // 玻璃卡片底色（高密度透明度）
    glassCardDense: 'rgba(30,40,80,0.70)',
    // 玻璃边框（强调态）
    borderGlass: 'rgba(74,90,158,0.50)',
    // 玻璃边框（弱化态）
    borderSoft: 'rgba(74,90,158,0.30)',
    // 主文字颜色
    textPrimary: '#E8ECFF',
    // 次级文字颜色
    textSecondary: '#C8D0F0',
    // 弱提示文字颜色
    textMuted: '#8891B8',
    // 主紫色强调
    accentPurple: '#8A7FD1',
    // 浅紫色强调（高亮/悬浮）
    accentPurpleLight: '#B4A5FF',
    // 青色强调（科技感元素）
    accentCyan: '#7BD0E0',
    // 金色强调（高价值信息）
    accentGold: '#FFB648',
    // 柔和金色（辅助高亮）
    accentGoldSoft: '#FFD887',
    // 成功态颜色
    successGreen: '#5ECB95',
    // 失败/警告态颜色
    errorPink: '#FF6B9D',
  },

  // 15 级粒子配色（图鉴用）
  codexColors: [
    '#7BD0E0', '#72C4DF', '#6AB6DE', '#7AA5DC', '#8A95D8',
    '#9A8AD4', '#A582D1', '#AF7ECD', '#B97BC9', '#C379C3',
    '#CA78BD', '#D177B5', '#B4A5FF', '#C8B8FF', '#FFD887',
  ],
  // 英文图鉴等级名称（按 1-15 级）
  codexNames: [
    'Quark', 'Proton', 'Atom', 'Molecule', 'Cell',
    'Organism', 'Land', 'Planet', 'Star', 'Galaxy',
    'Nebula', 'Cluster', 'Supercluster', 'Cosmos', 'Singularity',
  ],
  // 中文图鉴等级名称（按 1-15 级）
  codexNamesZh: [
    '夸克', '质子', '原子', '分子', '细胞',
    '生物', '大陆', '行星', '恒星', '星系',
    '星云', '星团', '超星系团', '宇宙', '奇点',
  ],

  // 字号（px）
  font: {
    // 首页 Logo 主标题字号
    heroLogo: 42,
    // 首页副标题字号
    heroSubtitle: 12,
    // 页面主标题字号
    screenTitle: 26,
    // 超大分数字号
    scoreXL: 40,
    // 大分数字号
    scoreLG: 26,
    // 中分数字号
    scoreMD: 22,
    // 行内分数字号
    scoreInline: 15,
    // 卡片头部大标题字号
    cardHeadline: 24,
    // 卡片标题字号
    cardTitle: 15.5,
    // 卡片标签字号
    cardLabel: 13,
    // 卡片小标签字号
    cardLabelSmall: 12,
    // 正文字号
    body: 13,
    // 小正文字号
    bodySmall: 12,
    // 提示文字字号
    hint: 12,
    // 超小提示字号
    hintXs: 11,
    // 徽章字号
    badge: 10,
    // 页脚等宽数字字号
    footerMono: 11,
    // 主按钮文字字号
    buttonPrimary: 15,
    // 次按钮文字字号
    buttonSecondary: 14,
    // 元信息行内字号
    metaInline: 11.5,
  },

  // 圆角（px）
  radius: {
    // 小圆角（标签/小按钮）
    sm: 6,
    // 中圆角（常规容器）
    md: 10,
    // 玻璃卡片圆角
    cardGlass: 14,
    // 分数卡片圆角
    cardScore: 16,
    // 弹窗圆角
    dialog: 20,
    // 主按钮圆角
    button: 14,
    // 胶囊圆角（极大圆角）
    capsule: 999,
  },

  // 间距
  spacing: {
    // 极小间距
    xs: 4,
    // 小间距
    sm: 6,
    // 中小间距
    md: 8,
    // 中间距
    lg: 10,
    // 中大间距
    xl: 12,
    // 大间距
    xxl: 14,
    // 超大间距 1
    '3xl': 16,
    // 超大间距 2
    '4xl': 18,
    // 超大间距 3
    '5xl': 22,
    // 超大间距 4
    '6xl': 26,
    // 超大间距 5
    '7xl': 32,
    // 屏幕左右内边距
    screenPaddingX: 28,
    // 屏幕顶部内边距
    screenPaddingTop: 92,
    // 屏幕底部内边距
    screenPaddingBottom: 36,
    // 卡片间隙
    cardGap: 10,
  },

  // 组件尺寸
  size: {
    // 首页主行星直径
    heroPlanet: 200,
    // 紧凑布局主行星直径
    heroPlanetCompact: 160,
    // 主按钮高度
    buttonPrimaryHeight: 48,
    // 主按钮最大宽度
    buttonPrimaryMaxWidth: 312,
    // 分享方形按钮宽度
    shareSquareWidth: 54,
    // 分享方形按钮高度
    shareSquareHeight: 48,
    // 小图鉴点直径
    codexDotSize: 14,
    // 小图鉴点间距
    codexDotGap: 5,
    // 新形态横幅高度
    newFormBannerHeight: 82,
  },

  // 发光 / 阴影强度（Canvas shadowBlur 值，非 CSS）
  glow: {
    // 图鉴点发光强度
    codexDot: 14,
    // 首页标题发光强度
    heroTitle: 30,
    // 纪录金色高亮发光强度
    recordGold: 16,
    // 主按钮发光强度
    buttonPrimary: 20,
    // 卡片柔和阴影强度
    cardSoft: 40,
  },

  // 动画时长（ms）
  duration: {
    // 新形态横幅入场时长
    bannerIn: 360,
    // 漂浮动画周期
    floaty: 6000,
    // 图鉴点脉冲周期
    codexPulse: 2200,
    // 开关切换时长
    toggle: 160,
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

function getLevelColor(level) {
  if (level <= 15) return UI_CONFIG.codexColors[level - 1];
  return '#FFD700';
}

function getLevelNameZh(level) {
  if (level <= 15) return UI_CONFIG.codexNamesZh[level - 1];
  const overflow = level - 15;
  if (overflow === 1) return '超越';
  return '超越' + '+'.repeat(overflow - 1);
}

function getLevelNameEn(level) {
  if (level <= 15) return UI_CONFIG.codexNames[level - 1];
  const overflow = level - 15;
  if (overflow === 1) return 'Transcend';
  return 'Transcend' + '+'.repeat(overflow - 1);
}

module.exports = {
  GAME_CONFIG,
  TARGET_FPS,
  UI_CONFIG,
  secondsToFrames,
  msToFrames,
  getTimedSplitInterval,
  getLevelColor,
  getLevelNameZh,
  getLevelNameEn,
};
