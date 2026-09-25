/* 属性克制矩阵（灵根系统修订与主循环切片 v0.3 §4）
   ─ 五行内部：金克木、木克土、土克水、水克火、火克金 → 1.5 / 0.75
   ─ 四象克五行：四象 → 五行 ×1.5；五行 → 四象 ×0.75
   ─ 四象内部：光暗互克、光暗克风雷、风雷不相克
   ─ 无属性：恒 ×1.0，不享受匹配
   口诀：光暗相互克、光暗克风雷、风雷不相克、四象皆克五行。 */
(function () {
  var WX = ['金', '木', '水', '火', '土'];
  var SX = ['光', '雷', '风', '暗'];

  /* 五行相克：key 克 value */
  var BEATS = { 金: '木', 木: '土', 土: '水', 水: '火', 火: '金' };

  /* 四象内部 4×4 */
  var SXT = {
    光: { 光: 1.0, 雷: 1.5, 风: 1.5, 暗: 1.5 },
    雷: { 光: 0.75, 雷: 1.0, 风: 1.0, 暗: 0.75 },
    风: { 光: 0.75, 雷: 1.0, 风: 1.0, 暗: 0.75 },
    暗: { 光: 1.5, 雷: 1.5, 风: 1.5, 暗: 1.0 }
  };

  function isWX(e) { return WX.indexOf(e) >= 0; }
  function isSX(e) { return SX.indexOf(e) >= 0; }

  /* 攻击方属性 → 防御方属性 的伤害系数 */
  function coef(a, d) {
    if (!a || !d || a === '无' || d === '无') return 1.0;
    var aw = isWX(a), dw = isWX(d);
    if (aw && dw) {
      if (BEATS[a] === d) return 1.5;
      if (BEATS[d] === a) return 0.75;
      return 1.0;
    }
    var as = isSX(a), ds = isSX(d);
    if (as && ds) return SXT[a][d];
    if (as && dw) return 1.5;     /* 四象克五行 */
    if (aw && ds) return 0.75;    /* 五行被四象克 */
    return 1.0;
  }

  /* 战斗日志文案 */
  function label(c) {
    if (c > 1.2) return '　克制！';
    if (c < 0.9) return '　被克。';
    return '';
  }

  /* 属性配色（角色面板 / 功法列表共用） */
  var COLOR = {
    金: '#e8d3a0', 木: '#a7e29a', 水: '#a9d4f2', 火: '#ffb07a', 土: '#d8c08a',
    光: '#f6eec8', 雷: '#c9b0ff', 风: '#9ee8d4', 暗: '#c08ad0', 无: '#8f95a6'
  };

  G.Data = G.Data || {};
  G.Data.elem = {
    coef: coef, label: label, color: COLOR,
    WX: WX, SX: SX, isWX: isWX, isSX: isSX
  };
})();
