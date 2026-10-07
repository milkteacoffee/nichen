/* 终局场景 · 镜花水月（v0.84，《诸世情感与镜花水月主线设计 v1.0》§6）
   ------------------------------------------------------------
   arc6 重塑镜碎之后进入这里，两个结局：
     甲·沉梦：「我不在乎真假，只要和她们在一起」——主动入镜，
        世界渐空色淡，末镜只是逆命珠中一粒不肯熄灭的尘光。
     乙·放手（真结局·逆尘）：以道果与逆命珠为祭，不复活任何人，
        解开牵挂因果、送她们入轮回新生；自碎长生归于尘芥。
   成就记进 meta.endings['dream' | 'release']（跨世）。
   单例：enter() 必须重置全部瞬时状态。
   ============================================================ */
(function () {
  var DREAM = {
    id: 'dream', n: '沉梦',
    title: '终 · 沉梦',
    lines: [
      { pid: null, t: '他走向镜中。' },
      { pid: '__hero', t: '真也好，假也罢……我不走了。' },
      { pid: null, t: '镜里的世界，色彩一日淡过一日，人也一个一个少去。' },
      { pid: 'wanqing', t: '……你为什么，在哭呢？' },
      { pid: null, t: '他不答，只把残影的手，握得更紧。' },
      { pid: null, t: '末了，整个世界只剩一粒尘光，在逆命珠里，不肯熄灭。' }
    ],
    tail: '梦境沉沉，尘光未灭。'
  };

  var RELEASE = {
    id: 'release', n: '放手',
    title: '真结局 · 逆尘',
    lines: [
      { pid: null, t: '他看着镜中人，看了很久很久，忽然笑了。' },
      { pid: '__hero', t: '我明白了。' },
      { pid: null, t: '他以全部道果、以逆命珠为祭——不复活任何人。' },
      { pid: null, t: '他解开缠在她们身上的因果，一缕一缕，尽数斩断。' },
      { pid: null, t: '牵挂的魂魄得了自由，光一样升起，入了轮回，去往新生。' },
      { pid: null, t: '他自碎长生，永绝轮回，化作尘芥。' },
      { pid: null, t: '春日人间。扎平安穗的少女坐在桥头，迎着光。' },
      { pid: null, t: '一个孩子被爷爷扛在肩头，笑闹着跑过。' },
      { pid: null, t: '年轻的夫妇结发携手，笑着从他身边经过——无人识他。' },
      { pid: null, t: '他轻笑，化作飞光。' },
      { pid: null, t: '「我没能把你们带回来……但我让你们，都好好活过了。」' },
      { pid: null, t: '「这一世，我很欢喜。」' }
    ],
    tail: '逆尽尘嚣，还诸世间。'
  };

  var scene = {
    smooth: true,
    t: 0,
    phase: 'menu',       /* menu | play | done */
    rec: null,
    idx: 0,
    line: null,
    motes: [],

    enter: function () {
      var meta = G.game.meta;
      if (!meta) { meta = {}; G.game.meta = meta; }
      if (!meta.endings) meta.endings = {};
      this.phase = 'menu';
      this.rec = null;
      this.idx = 0;
      this.line = null;
      this.t = 0;
      this.motes = [];
      for (var i = 0; i < 46; i++) {
        this.motes.push({
          x: (i * 137.5) % 480, y: (i * 83.7) % 272,
          r: 0.6 + (i % 5) * 0.28, sp: 3 + (i % 7) * 1.6
        });
      }
      this._buildMenu();
    },

    _buildMenu: function () {
      var self = this;
      this.buttons = [
        new G.UI.Btn({
          x: 70, y: 168, w: 150, h: 40, variant: 'frost',
          label: '沉梦入梦',
          onClick: function () { self._choose(DREAM); }
        }),
        new G.UI.Btn({
          x: 260, y: 168, w: 150, h: 40, variant: 'gold',
          label: '放手 · 逆尘',
          onClick: function () { self._choose(RELEASE); }
        })
      ];
    },

    _choose: function (rec) {
      var meta = G.game.meta, save = G.game.save;
      this.rec = rec;
      this.phase = 'play';
      this.idx = 0;
      this.buttons = [];
      meta.endings[rec.id] = { life: save ? save.life : 0, t: this.t };
      if (meta.progress && meta.progress.story) meta.progress.story.ending = rec.id;
      if (save) {
        save.ending = rec.id;
        G.Player.chronicle(save, 'ending_' + rec.id, '结局 · ' + rec.n);
      }
      G.Storage.saveMeta(meta);
      if (save) G.Storage.saveCurrent(save);
      var selfE = this, eShots = G.CineLib && G.CineLib.forEnding(rec.id);
      if (eShots) G.Cutscene.play(eShots, function () { selfE._nextLine(); });
      else this._nextLine();
    },

    _nextLine: function () {
      var rec = this.rec;
      if (this.idx >= rec.lines.length) {
        this.phase = 'done';
        this.line = null;
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
        return;
      }
      var b = rec.lines[this.idx++];
      var name = b.pid === '__hero' ? '他'
        : (b.pid === 'wanqing' ? '残影' : null);
      this.line = {
        pid: b.pid, name: name,
        tw: new G.UI.Typewriter(b.t, 26)
      };
    },

    onTap: function () {
      if (this.phase !== 'play') return;
      if (this.line && !this.line.tw.done) { this.line.tw.show(); return; }
      this._nextLine();
    },

    update: function (dt) {
      this.t += dt;
      if (this.line && this.line.tw) this.line.tw.update(dt);
      for (var i = 0; i < this.motes.length; i++) {
        var m = this.motes[i];
        m.y -= m.sp * dt;
        if (m.y < -3) { m.y = 275; m.x = (m.x + 97) % 480; }
      }
    },

    render: function (x) {
      var rec = this.rec;
      /* 底色随结局走向：沉梦=冷墨蓝；放手=由冷转暖（按进度）。 */
      var warm = rec ? rec.id === 'release' : false;
      var p = rec && this.phase !== 'menu'
        ? Math.min(1, this.idx / rec.lines.length) : 0;
      var top = warm ? this._mix('#0a0d16', '#1c1a14', p) : '#05070d';
      var mid = warm ? this._mix('#0a0d16', '#242018', p) : '#0a0d16';
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, top);
      g.addColorStop(0.55, mid);
      g.addColorStop(1, top);
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      for (var i = 0; i < this.motes.length; i++) {
        var m = this.motes[i];
        var tw = 0.3 + 0.35 * Math.sin(this.t * 2 + i);
        var tint = warm ? '240,228,200' : '226,238,255';
        x.fillStyle = 'rgba(' + tint + ',' + tw.toFixed(3) + ')';
        x.fillRect(m.x, m.y, m.r * 2, m.r * 2);
      }

      if (this.phase === 'menu') {
        G.UI.textOut(x, { x: 240, y: 66 }, '镜花水月', 30, '#e8e2d2', 'center', 'rgba(0,0,0,0.8)', 5);
        x.fillStyle = 'rgba(216,183,104,0.35)';
        x.fillRect(140, 102, 200, 1);
        G.UI.text(x, { x: 240, y: 124 }, '到手的团圆，是镜中花、水中月。', 12.5, '#cfc8b8', 'center');
        G.UI.text(x, { x: 145, y: 220 }, '留在梦里，与残影相守', 10.5, '#aebfd2', 'center');
        G.UI.text(x, { x: 335, y: 220 }, '斩断因果，放她们新生', 10.5, '#e0c896', 'center');
      } else if (rec) {
        var col = rec.id === 'release' ? '#ecdcb8' : '#cdd8e6';
        G.UI.textOut(x, { x: 240, y: 46 }, rec.title, 22, col, 'center', 'rgba(0,0,0,0.8)', 4);
        if (this.line) this._renderLine(x, this.line);
        if (this.phase === 'done') {
          G.UI.text(x, { x: 240, y: 200 }, rec.tail, 12, col, 'center');
        }
      }

      var vg = x.createRadialGradient(240, 136, 110, 240, 136, 320);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _renderLine: function (x, ln) {
      /* 居中半屏字幕，无对话框（结局留白）。 */
      var part = ln.tw.part();
      var lines = G.UI.wrapCJK ? G.UI.wrapCJK(part, 13, 360, 2) : [part];
      var y0 = 132 - (lines.length - 1) * 11;
      var col = this.rec.id === 'release' ? '#e6dcc6' : '#d2dce8';
      lines.forEach(function (l, i) {
        G.UI.textOut(x, { x: 240, y: y0 + i * 22 }, l, 13.5, col, 'center', 'rgba(0,0,0,0.85)', 3);
      });
      if (ln.name) G.UI.text(x, { x: 240, y: 106 }, '— ' + ln.name + ' —', 10, '#9aa4b4', 'center');
      if (ln.tw.done) G.UI.text(x, { x: 240, y: 178 }, '点击继续', 8.5, '#8a94a4', 'center');
    },

    _mix: function (h1, h2, p) {
      function hx(h) {
        return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      }
      var a = hx(h1), b = hx(h2);
      var c = a.map(function (v, i) {
        return Math.round(v + (b[i] - v) * p);
      });
      return 'rgb(' + c.join(',') + ')';
    }
  };

  G.scenes.ending = scene;
})();
