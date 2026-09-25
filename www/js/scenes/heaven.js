/* 天道拦魂：死亡结算之前，天道拦于幽冥之前问话（v2.7）
   最多 3 轮；模型不可用时走模板；结束 → death 结算 */
(function () {
  var CAUSE_NAME = { war: '妖兽仇敌', aged: '寿元耗尽', event: '意外' };

  var scene = {
    smooth: true,
    t: 0,
    stars: [],
    round: 0,
    line: '',
    tw: null,
    busy: false,
    mode: 'presets',          /* presets | free | done */
    freeText: '',

    enter: function () {
      var save = G.game.save, meta = G.game.meta;
      if (!save) { G.game.changeScene('death'); return; }
      G.TianDao.ensure(meta);

      this.t = 0; this.round = 0;
      this.line = ''; this.tw = null;
      this.mode = 'presets'; this.freeText = '';

      this.stars = [];
      for (var i = 0; i < 90; i++) {
        this.stars.push({
          x: G.rng.range(0, 480), y: G.rng.range(0, 272),
          r: G.rng.range(0.5, 1.6), ph: G.rng.range(0, 6.283),
          sp: G.rng.range(1, 5)
        });
      }
      this._ask('deathGate', { cause: CAUSE_NAME[save._cause] || '战乱' });
    },

    exit: function () { G.TianDao.Field.hide(); },

    _ask: function (trigger, extra) {
      var self = this;
      this.busy = true; this.line = ''; this.tw = null;
      this._buildButtons();
      G.TianDao.callModel(trigger, extra, function (e, line) {
        self.busy = false;
        self.line = line;
        self.tw = new G.UI.Typewriter(line, 42);
        self._buildButtons();
      });
    },

    _reply: function (text) {
      G.TianDao.Field.hide();
      this.round += 1;
      this.mode = this.round >= 3 ? 'done' : 'presets';
      if (this.round >= 3) {
        this.busy = false;
        this.line = '去罢。生死簿上，自有你的去处。';
        this.tw = new G.UI.Typewriter(this.line, 42);
        this._buildButtons();
        return;
      }
      this._ask('deathGateReply', { reply: text });
    },

    _useFallback: function () {
      var trigger = this.round === 0 ? 'deathGate' : 'deathGateReply';
      var line = G.TianDao.fallback(trigger, {});
      this.busy = false;
      this.line = line;
      this.tw = new G.UI.Typewriter(line, 42);
      this._buildButtons();
    },

    _finish: function () {
      var meta = G.game.meta;
      if (meta.heaven) {
        meta.heaven.talks = (meta.heaven.talks || 0) + 1;
        G.Storage.saveMeta(meta);
      }
      G.game.changeScene('death');
    },

    _buildButtons: function () {
      var self = this, btns = [];

      if (this.busy) {
        btns.push(new G.UI.Btn({
          x: 190, y: 228, w: 100, h: 26, small: true, variant: 'ghost',
          label: '跳　过', onClick: function () { self._useFallback(); }
        }));
        this.buttons = btns;
        return;
      }
      if (this.mode === 'free') {
        btns.push(new G.UI.Btn({
          x: 350, y: 226, w: 92, h: 26, small: true, variant: 'gold',
          label: '发　送',
          onClick: function () { self._reply(self.freeText || '（无言）'); }
        }));
        this.buttons = btns;
        this._openField();
        return;
      }
      if (this.mode === 'done') {
        btns.push(new G.UI.Btn({
          x: 160, y: 228, w: 160, h: 28, small: true, variant: 'gold',
          label: '入 轮 回', onClick: function () { self._finish(); }
        }));
        this.buttons = btns;
        return;
      }

      btns.push(new G.UI.Btn({
        x: 78, y: 228, w: 100, h: 26, small: true,
        label: '默然叩首',
        onClick: function () { self._reply('（默然叩首，不发一言）'); }
      }));
      btns.push(new G.UI.Btn({
        x: 190, y: 228, w: 100, h: 26, small: true,
        label: '只求长生',
        onClick: function () { self._reply('弟子只求长生，天道可允否？'); }
      }));
      btns.push(new G.UI.Btn({
        x: 302, y: 228, w: 100, h: 26, small: true, variant: 'ghost',
        label: '自由应答',
        onClick: function () {
          self.mode = 'free';
          self.freeText = '';
          self._buildButtons();
        }
      }));
      this.buttons = btns;
    },

    _openField: function () {
      var self = this;
      G.TianDao.Field.focus(
        { x: 40, y: 226, w: 300, h: 26 },
        function () { return self.freeText; },
        function (v) { self.freeText = v; }
      );
    },

    update: function (dt) {
      this.t += dt;
      if (this.tw) this.tw.update(dt);
      for (var i = 0; i < this.stars.length; i++) {
        var s = this.stars[i];
        s.y -= s.sp * dt;
        if (s.y < -2) { s.y = 274; s.x = G.rng.range(0, 480); }
      }
    },

    render: function (x) {
      /* 背景：深靛星河 */
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#05060f');
      g.addColorStop(0.6, '#0a0c1c');
      g.addColorStop(1, '#120f22');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      /* 星子 */
      for (var i = 0; i < this.stars.length; i++) {
        var s = this.stars[i];
        var a = 0.35 + 0.5 * Math.sin(this.t * 2 + s.ph);
        x.fillStyle = 'rgba(220,226,255,' + a.toFixed(3) + ')';
        x.fillRect(s.x, s.y, s.r, s.r);
      }

      /* 缓流云带 */
      x.save();
      x.globalAlpha = 0.10;
      for (var k = 0; k < 3; k++) {
        var yy = 60 + k * 70 + Math.sin(this.t * .4 + k) * 12;
        x.strokeStyle = k === 1 ? '#b9c4f0' : '#8f9ac8';
        x.lineWidth = 14;
        x.beginPath();
        x.moveTo(-40, yy);
        x.bezierCurveTo(140, yy - 40, 320, yy + 40, 520, yy);
        x.stroke();
      }
      x.restore();

      /* 标题 */
      G.UI.textOut(x, { x: 240, y: 16 }, '天　道', 22, G.UI.C.goldHi, 'center',
        'rgba(0,0,0,0.7)', 3.2);
      G.UI.divider(x, 240, 50, 160, 'rgba(216,183,104,0.4)');

      /* 问话（打字机 + 折行居中） */
      if (this.tw) {
        var part = this.tw.part();
        var lines = G.UI.wrap(x, part, 15, 380);
        var y0 = 96;
        lines.forEach(function (l, li) {
          G.UI.textOut(x, { x: 240, y: y0 + li * 24 }, l, 15,
            G.UI.C.text, 'center', 'rgba(0,0,0,0.72)', 2.6);
        });
      }

      if (this.busy) {
        G.UI.text(x, { x: 240, y: 196 }, '天道感应中……', 12,
          G.UI.C.textDim, 'center');
      }

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 110, 240, 136, 320);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    onTap: function () {},

    onKey: function (code) {
      if (code === 'Escape') {
        if (this.busy) this._useFallback();
        else if (this.mode === 'free') { this.mode = 'presets'; G.TianDao.Field.hide(); this._buildButtons(); }
      }
    }
  };

  G.scenes.heaven = scene;
})();
