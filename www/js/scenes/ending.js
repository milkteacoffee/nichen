/* 三结局场景（v0.63.0，用户「三结局场景」）
   ------------------------------------------------------------
   道祖境九关尽过（章节链第十章读完）→ 进这里。
   三条结局由 **道心 `save.daoHeart`** 唯一分水岭决定（见 `data/chapters.js: endingOf`）：
     ≥ +4 证道 / -3..+3 化凡 / ≤ -4 逆天。
   成就记进 `meta.endings[<id>]`（**跨世**）—— 轮回殿的「前世经历」会列出来。
   ⚠️ 场景是**单例**：`enter()` 必须显式重置自己的瞬时状态（这里是 `t` / `rec`）。
   ============================================================ */
(function () {
  var scene = {
    smooth: true,
    t: 0,
    rec: null,
    motes: [],

    enter: function () {
      var save = G.game.save || {};
      var meta = G.game.meta;
      if (!meta) { meta = {}; G.game.meta = meta; }
      if (!meta.endings) meta.endings = {};

      var e = (G.Data.Chapters && G.Data.Chapters.endingOf)
        ? G.Data.Chapters.endingOf(save) : null;
      if (!e) {
        /* 兜底：没有章节数据时也要能进（不该发生，但白屏比兜底难查得多） */
        e = { id: 'fan', n: '化凡', gl: '玉', lines: ['路走到了尽头。'], tail: '化凡' };
      }
      this.rec = e;
      this.t = 0;
      this.motes = [];
      /* 星尘：确定性相位（按序号取模），不用随机数 —— 截图与契约才钉得住 */
      for (var i = 0; i < 46; i++) {
        this.motes.push({
          x: (i * 137.5) % 480, y: (i * 83.7) % 272,
          r: 0.6 + (i % 5) * 0.28, sp: 3 + (i % 7) * 1.6
        });
      }

      meta.endings[e.id] = true;
      if (save) {
        save.ending = e.id;              /* 本世的结局（走马灯/档案要看） */
        G.Player.chronicle(save, 'ending_' + e.id, '结局 · ' + e.n);
        if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      }
      if (G.Storage && G.Storage.saveMeta) G.Storage.saveMeta(meta);

      var self = this;
      this.buttons = [
        new G.UI.Btn({
          x: 150, y: 224, w: 84, h: 24, small: true, variant: 'gold',
          label: '入轮回殿', onClick: function () { G.game.changeScene('hall'); }
        }),
        new G.UI.Btn({
          x: 246, y: 224, w: 84, h: 24, small: true, variant: 'frost',
          label: '返回标题', onClick: function () { G.game.changeScene('title'); }
        })
      ];
      void self;
    },

    update: function (dt) {
      this.t += dt;
      for (var i = 0; i < this.motes.length; i++) {
        var m = this.motes[i];
        m.y -= m.sp * dt;
        if (m.y < -3) { m.y = 275; m.x = (m.x + 97) % 480; }
      }
    },

    render: function (x) {
      var e = this.rec || { n: '化凡', gl: '玉', lines: [], tail: '' };
      /* 底：极深的墨蓝，比死亡页更"空" */
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#05070d');
      g.addColorStop(0.55, '#0a0d16');
      g.addColorStop(1, '#05070d');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      /* 星尘（相位取 this.t，不用 Math.random —— 契约与截图要可复现） */
      for (var i = 0; i < this.motes.length; i++) {
        var m = this.motes[i];
        var tw = 0.35 + 0.35 * Math.sin(this.t * 2 + i);
        x.fillStyle = 'rgba(226,238,255,' + tw.toFixed(3) + ')';
        x.fillRect(m.x, m.y, m.r * 2, m.r * 2);
      }

      /* 结局之色：证道金 / 化凡玉 / 逆天血 */
      var COL = { zheng: '#f0d79a', fan: '#bfe0d2', ni: '#e0908a' };
      var col = COL[e.id] || '#d8d2c0';

      G.UI.textOut(x, { x: 240, y: 58 }, '终 · ' + e.n, 30, col, 'center', 'rgba(0,0,0,0.8)', 5);
      x.fillStyle = 'rgba(216,183,104,0.35)';
      x.fillRect(140, 100, 200, 1);

      var y = 122;
      (e.lines || []).forEach(function (l) {
        var ls = G.UI.wrapCJK ? G.UI.wrapCJK(l, 13, 372, 2) : [l];
        ls.forEach(function (w) {
          G.UI.text(x, { x: 240, y: y }, w, 13, '#d8d2c0', 'center');
          y += 21;
        });
        y += 4;
      });

      G.UI.text(x, { x: 240, y: 202 }, e.tail || '', 11.5, col, 'center');

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 110, 240, 136, 320);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.66)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    }
  };

  G.scenes.ending = scene;
})();
