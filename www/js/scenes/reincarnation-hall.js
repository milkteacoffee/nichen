/* 轮回殿：轮回档案 + 仙躯灌注（消耗仙力，永久增益下一世） */
(function () {
  var MAXLV = 10;

  /* key 与 meta.perfusion 的字段一一对应；body 已被 Player.computeStats 消费，
     其余四项在 reincarnation.finish() 里折算为开局资源。 */
  var PERFUSE = [
    { key: 'body', n: '仙躯', d: '攻防气血速度', apply: '每级 攻+2 防+1 气血+12 速度+1' },
    { key: 'qi', n: '灵息', d: '开局灵气', apply: '每级 开局灵气 +120' },
    { key: 'po', n: '魂力', d: '开局灵力', apply: '每级 开局灵力 +12' },
    { key: 'stone', n: '财禄', d: '开局灵石', apply: '每级 开局灵石 +60' },
    { key: 'rescue', n: '遁法', d: '遁走次数', apply: '每级 开局遁走次数 +1' }
  ];

  function costOf(lv) { return 20 + lv * 18; }

  var scene = {
    smooth: true,
    t: 0,
    hint: '',

    enter: function () {
      if (!G.game.meta) {
        G.game.meta = {
          lives: 0, xianli: 0, totalXianli: 0,
          perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
          pity: 0, achieve: {},
          heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
          past: []
        };
        G.Storage.saveMeta(G.game.meta);
      }
      var m = G.game.meta;
      if (!m.perfusion) m.perfusion = { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 };
      if (!m.past) m.past = [];
      if (!m.achieve) m.achieve = {};
      if (typeof m.xianli !== 'number') m.xianli = 0;
      this.t = 0;
      this.hint = '';
      this._build();
    },

    _build: function () {
      var self = this, m = G.game.meta;
      var btns = [];
      var y0 = 116, step = 21;

      PERFUSE.forEach(function (row, i) {
        var lv = m.perfusion[row.key] || 0;
        var cost = costOf(lv);
        var full = lv >= MAXLV;
        var can = !full && m.xianli >= cost;
        var b = new G.UI.Btn({
          x: 24, y: y0 + i * step, w: 272, h: 19, small: true,
          disabled: !can, label: '',
          onClick: function () {
            if (full) { self.hint = row.n + ' 已至圆满。'; return; }
            if (m.xianli < cost) { self.hint = '仙力不足，尚缺 ' + (cost - m.xianli) + ' 点。'; return; }
            m.xianli -= cost;
            m.perfusion[row.key] = lv + 1;
            G.Storage.saveMeta(m);
            self.hint = row.n + ' 提升至 Lv' + (lv + 1) + '　' + row.apply;
            self._build();
          }
        });
        /* 自定义行内排版：左名 / 中描述 / 等级点 / 右价 */
        b.render = function (xx) {
          G.UI.Btn.prototype.render.call(this, xx);
          var dis = this.disabled;
          if (dis) { xx.save(); xx.globalAlpha = 0.5; }
          G.UI.text(xx, { x: this.x + 10, y: this.y + 4 }, row.n, 12, G.UI.C.text);
          G.UI.text(xx, { x: this.x + 44, y: this.y + 5 }, row.d, 10, G.UI.C.textDim);
          for (var k = 0; k < MAXLV; k++) {
            xx.fillStyle = k < lv ? G.UI.C.gold : 'rgba(255,255,255,0.13)';
            xx.fillRect(this.x + 124 + k * 7, this.y + 8.5, 5, 3);
          }
          G.UI.text(xx, { x: this.x + this.w - 10, y: this.y + 4 },
            full ? '圆满' : (cost + ' 仙力'), 11,
            full ? G.UI.C.goldHi : (can ? G.UI.C.gold : G.UI.C.danger), 'right');
          if (dis) xx.restore();
        };
        btns.push(b);
      });

      btns.push(new G.UI.Btn({
        x: 366, y: 232, w: 98, h: 26, small: true, variant: 'gold',
        label: '转世重修', onClick: function () { G.game.changeScene('reincarnation'); }
      }));
      btns.push(new G.UI.Btn({
        x: 16, y: 232, w: 86, h: 26, small: true, variant: 'ghost',
        label: '返回标题', onClick: function () { G.game.changeScene('title'); }
      }));
      this.buttons = btns;
    },

    update: function (dt) { this.t += dt; },

    /* 背景：素材优先（bg.hall），缺省走程序化 */
    _bg: function () {
      var im = G.Assets.img('bg.hall');
      if (im) return im;
      if (this._bgc) return this._bgc;
      var o = G.Art.cv(480, 272), bx = o.x;
      var g = bx.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#080c18');
      g.addColorStop(0.6, '#0d1326');
      g.addColorStop(1, '#141a2e');
      bx.fillStyle = g; bx.fillRect(0, 0, 480, 272);
      var halo = bx.createRadialGradient(240, 20, 10, 240, 20, 220);
      halo.addColorStop(0, 'rgba(120,160,220,0.14)');
      halo.addColorStop(1, 'rgba(120,160,220,0)');
      bx.fillStyle = halo; bx.fillRect(0, 0, 480, 272);
      this._bgc = o.c;
      return o.c;
    },

    render: function (x) {
      var m = G.game.meta;

      x.drawImage(this._bg(), 0, 0, 480, 272);

      /* 缓慢流动的光尘 */
      for (var i = 0; i < 22; i++) {
        var px = (i * 97 % 480) + Math.sin(this.t * 0.5 + i) * 12;
        var py = (i * 53 % 272 + this.t * 9) % 272;
        x.fillStyle = 'rgba(180,205,245,' + (0.06 + 0.05 * Math.sin(this.t + i)).toFixed(3) + ')';
        x.fillRect(px, py, 1.4, 1.4);
      }

      /* 标题 */
      G.UI.textOut(x, { x: 16, y: 10 }, '轮 回 殿', 19, G.UI.C.goldHi);
      /* 提示直接占用副标题行，避免和底部按钮抢位置 */
      G.UI.text(x, { x: 16, y: 36 },
        this.hint || '真灵不灭，仙力长存。以仙力灌注仙躯，可携往下一世。',
        11.5, this.hint ? G.UI.C.jadeHi : G.UI.C.textDim);

      /* 档案条 */
      G.UI.panel(x, { x: 16, y: 52, w: 448, h: 30 }, '#131828',
        'rgba(216,183,104,0.30)', 4, { paper: false, shadow: false });
      G.UI.text(x, { x: 30, y: 61 }, '轮回', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 62, y: 57 }, String(m.lives || 0), 15, G.UI.C.text);
      G.UI.text(x, { x: 118, y: 61 }, '世', 11, G.UI.C.textDim);
      G.UI.icon(x, 'stone', 166, 67, 7);
      G.UI.text(x, { x: 178, y: 61 }, '可用仙力', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 250, y: 57 }, String(m.xianli || 0), 15, G.UI.C.goldHi);
      G.UI.text(x, { x: 298, y: 61 }, '累计仙力', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 364, y: 57 }, String(m.totalXianli || 0), 15, G.UI.C.textDim);
      /* 右对齐到面板内边距（x=424 左对齐会顶出 448 宽的面板边框） */
      G.UI.text(x, { x: 448, y: 61 }, '仙躯 Lv' + (m.perfusion.body || 0), 11,
        G.UI.C.jadeHi, 'right');

      /* 仙躯灌注（分区标题放在面板内部，避免压在边框上） */
      G.UI.frame(x, { x: 16, y: 88, w: 288, h: 134 }, null, { paper: true });
      G.UI.text(x, { x: 28, y: 94 }, '仙 躯 灌 注', 12, G.UI.C.gold);
      var ach = G.Player.ACHIEVE.filter(function (a) { return m.achieve[a.id]; }).length;
      G.UI.textOut(x, { x: 292, y: 96 }, '成就 ' + ach + '/' + G.Player.ACHIEVE.length,
        10.5, ach ? G.UI.C.jadeHi : G.UI.C.textDim, 'right');
      G.UI.divider(x, 160, 111, 264, 'rgba(216,183,104,0.28)');

      /* 前世名录 */
      G.UI.frame(x, { x: 312, y: 88, w: 152, h: 134 }, null, { paper: true });
      G.UI.text(x, { x: 324, y: 94 }, '前 世 名 录', 12, G.UI.C.gold);
      G.UI.divider(x, 388, 111, 130, 'rgba(216,183,104,0.28)');
      var past = m.past.slice(-4).reverse();
      if (!past.length) {
        G.UI.text(x, { x: 328, y: 120 }, '尚无前世', 11.5, G.UI.C.textDim);
      }
      past.forEach(function (p, i) {
        var yy = 120 + i * 25;
        G.UI.text(x, { x: 328, y: yy }, '第 ' + p.life + ' 世', 11.5, G.UI.C.text);
        G.UI.text(x, { x: 328, y: yy + 12 }, p.realm + ' · ' + p.age + ' 岁', 9.5, G.UI.C.textDim);
        G.UI.text(x, { x: 452, y: yy + 2 }, '+' + p.xianli, 11, G.UI.C.gold, 'right');
      });

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 130, 240, 136, 330);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.50)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    }
  };

  G.scenes.hall = scene;
})();
