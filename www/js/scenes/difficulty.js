/* 难度选择：新游戏 → 三难度卡片 → 写入 meta.progress.difficulty → 转世 */
(function () {
  var CARDS = [
    { id: 'normal', n: '普　通', col: '#2f6b46', lineCol: '#4a3a1c',
      lines: ['Boss 气血 / 攻击 ×1.0　资源 ×1.0', '适合初次踏入修行之路'] },
    { id: 'hard', n: '困　难', col: '#e0b868', lineCol: '#c4cad8',
      lines: ['Boss 气血 ×1.35 / 攻击 ×1.25　资源 ×0.8', '稀有掉落 ×1.5，杀劫更险'] },
    { id: 'hell', n: '地　狱', col: '#d86a5a', lineCol: '#c4cad8',
      lines: ['Boss 气血 ×1.8 / 攻击 ×1.55　资源 ×0.6', 'Boss 技能冷却 −1，稀有 ×2'] }
  ];

  var scene = {
    smooth: true,
    rects: [],

    enter: function () {
      var self = this;
      this.rects = [];
      this.buttons = [];
      var x = 60, w = 360, h = 48, y = 62, gap = 10;
      CARDS.forEach(function (c) {
        var r = { x: x, y: y, w: w, h: h };
        self.rects.push(r);
        (function (card, rect) {
          self.buttons.push(new G.UI.Btn({
            x: rect.x, y: rect.y, w: rect.w, h: rect.h,
            variant: card.id === 'normal' ? 'gold' : 'default',
            label: '',
            onClick: function () { self._choose(card.id); }
          }));
        })(c, r);
        y += h + gap;
      });
      this.buttons.push(new G.UI.Btn({
        x: 10, y: 240, w: 90, h: 22, small: true, variant: 'ghost',
        label: '返回', onClick: function () { G.game.changeScene('title'); }
      }));
    },

    _choose: function (id) {
      var meta = G.Storage.loadMeta();
      if (!meta) meta = {
        lives: 0, xianli: 0, totalXianli: 0,
        perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
        progress: G.Storage.defaultProgress(),
        pity: 0, achieve: {},
        heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
        past: []
      };
      meta.progress = meta.progress || G.Storage.defaultProgress();
      meta.progress.difficulty = id;
      G.Storage.saveMeta(meta);
      G.game.meta = meta;
      G.game.toast('已择难度：' + (G.Data.dungeons.DIFF[id].n));
      G.game.changeScene('reincarnation');
    },

    render: function (x) {
      /* 背景：暗夜深空（复用标题底的简化版） */
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#070b16');
      g.addColorStop(1, '#141a2c');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      /* 先画按钮（卡片填充），再在其上叠文字，否则填充会盖住文字 */
      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);

      G.UI.textOut(x, { x: 240, y: 28 }, '择 一 道 难 度', 22,
        '#f0e2b0', 'center', 'rgba(6,8,14,0.7)', 3);
      G.UI.textOut(x, { x: 240, y: 50 }, '难度一经择定，本轮轮回沿用；可于轮回殿再改',
        10.5, '#8f95a6', 'center');

      for (var i = 0; i < CARDS.length; i++) {
        var c = CARDS[i], r = this.rects[i];
        G.UI.text(x, { x: r.x + 18, y: r.y + 6 }, c.n, 15, c.col);
        for (var l = 0; l < c.lines.length; l++) {
          G.UI.text(x, { x: r.x + 18, y: r.y + 25 + l * 12 }, c.lines[l],
            10, c.lineCol);
        }
      }
    }
  };

  G.scenes.difficulty = scene;
})();
