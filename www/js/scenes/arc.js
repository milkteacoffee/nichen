/* 命定之世 · Arc 场景（《诸世情感与镜花水月主线设计 v1.0》）
   ------------------------------------------------------------
   通用剧本场景，驱动 save.arc 状态机：
     intro（开场）→ daily（相处热点·积累共同记忆）→ crisis（天道布局·可干预）
     → loss（失去）→ complete → die / ending。
   背景按 def.theme 程序化绘制（reef/sect/cottage/manor/dojo/mirror），
   立绘走 Sprites（npc/beast/hero），皆可后期替换。
   ============================================================ */
(function () {
  var VW = 480, VH = 272;
  var DLG = { x: 20, y: 180, w: 440, h: 78 };

  var scene = {
    t: 0,
    line: null,          /* {pid,name,t,tw} */
    _after: null,        /* 对话结束后的回调 */
    _spotRects: [],
    _bgc: null,
    rain: [],

    enter: function () {
      var save = G.game.save, meta = G.game.meta;
      var def = G.Arcs.byId(save.arc.id);
      this._def = def;
      this.t = 0; this.line = null; this._after = null;
      this._bgc = null;
      /* 雨丝（crisis 用） */
      this.rain = [];
      for (var i = 0; i < 48; i++) {
        this.rain.push({ x: G.rng.range(0, VW), y: G.rng.range(0, VH), v: G.rng.range(160, 260), l: G.rng.range(6, 12) });
      }
      this._sayIntro();
    },
    exit: function () { this.line = null; },

    def: function () { return this._def; },
    arc: function () { return G.game.save.arc; },

    /* ===== 对话 ===== */
    _say: function (pid, t, after) {
      var name = this._nameOf(pid);
      this.line = { pid: pid, name: name, t: t, tw: new G.UI.Typewriter(t, 26) };
      this._after = after || null;
      this._rebuildButtons();
    },
    _nameOf: function (pid) {
      if (!pid) return '';
      if (pid === '__hero') return '你';
      var c = (this._def.cast || []).filter(function (x) { return x.pid === pid; })[0];
      if (c) return c.name;
      var b = G.game.meta.bonds[pid];
      return b ? b.name : pid;
    },
    _advanceLine: function () {
      var f = this._after;
      this.line = null; this._after = null;
      if (f) f();
      else this._rebuildButtons();
    },

    /* ===== 阶段：intro ===== */
    _sayIntro: function () {
      var self = this, def = this._def, arc = this.arc();
      arc.phase = 'intro';
      var list = def.intro || [];
      function nxt() {
        if (arc.step >= list.length) {
          arc.phase = 'daily'; arc.step = 0;
          self._rebuildButtons();
          return;
        }
        var b = list[arc.step++];
        if (typeof b === 'string') b = { pid: null, t: b };
        self._say(b.pid, b.t, nxt);
      }
      nxt();
    },

    /* ===== 阶段：daily ===== */
    _spotAt: function (p) {
      for (var i = 0; i < this._spotRects.length; i++) {
        var r = this._spotRects[i];
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.spot;
      }
      return null;
    },
    _tapSpot: function (spot) {
      var self = this, save = G.game.save, meta = G.game.meta;
      var beat = G.Arcs.dailyBeat(save, meta, spot);
      G.Storage.saveCurrent(save);
      this._say(spot.pid, beat.t, function () { self._rebuildButtons(); });
    },
    _toCrisis: function () {
      var self = this, arc = this.arc();
      arc.phase = 'crisis'; arc.node = 0;
      G.Storage.saveCurrent(G.game.save);
      this._crisisNext();
    },

    /* ===== 阶段：crisis ===== */
    _crisisNext: function () {
      var self = this, def = this._def, arc = this.arc();
      var nodes = def.crisis && def.crisis.nodes;
      function go() {
        if (!nodes || arc.node >= nodes.length) {
          arc.phase = 'loss'; arc.loss = 0;
          self._lossNext();
          return;
        }
        var n = nodes[arc.node++];
        if (n.k === 'line') self._say(n.pid, n.t, go);
        else if (n.k === 'death') self._say(n.pid, n.t, go);
        else if (n.k === 'choice') {
          self.line = { pid: null, name: '', t: n.q, tw: new G.UI.Typewriter(n.q, 26) };
          self._after = function () { self._choiceButtons(n, go); };
          self._rebuildButtons();
        } else if (n.k === 'stat') {
          var save = G.game.save, ok = true;
          if (n.glm) ok = (save.globalLevel || 1) >= n.glm;
          if (n.atk) ok = G.Player.computeStats(save).atk >= n.atk;
          self._say(n.pid || null, ok ? n.then : n.else, go);
        } else if (n.k === 'call') {
          try { n.fx(G.game.save, G.game.meta); } catch (e) {}
          go();
        }
      }
      go();
    },
    _choiceButtons: function (node, go) {
      this.line = null;
      this._pendingChoice = { node: node, go: go };
      this._rebuildButtons();
    },
    _pickChoice: function (option) {
      var self = this, save = G.game.save, meta = G.game.meta;
      var text = G.Arcs.runOption(save, meta, option);
      this._pendingChoice = null;
      G.Storage.saveCurrent(save);
      this._say(null, text, this._pendingGo);
    },

    /* ===== 阶段：loss ===== */
    _lossNext: function () {
      var self = this, def = this._def, arc = this.arc();
      var list = def.loss || [];
      function go() {
        if (arc.loss >= list.length) {
          /* 收场：落定命数/信物/遗憾 */
          G.Arcs.complete(G.game.save, G.game.meta);
          G.Storage.saveCurrent(G.game.save);
          G.Storage.saveMeta(G.game.meta);
          arc.phase = 'end';
          self._rebuildButtons();
          return;
        }
        var b = list[arc.loss++];
        if (typeof b === 'string') b = { pid: null, t: b };
        self._say(b.pid, b.t, go);
      }
      go();
    },

    /* ===== 按钮装配 ===== */
    _rebuildButtons: function () {
      var save = G.game.save, arc = save.arc, def = this._def, self = this;
      this.buttons = [];
      this._spotRects = [];

      if (this.line) return;            /* 对话中不挂按钮（点击推进） */

      if (arc.phase === 'daily') {
        (def.daily.spots || []).forEach(function (sp) {
          var r = { x: sp.x - 34, y: sp.y - 14, w: 68, h: 22, spot: sp };
          self._spotRects.push(r);
        });
        if (G.Arcs.needMet(save, def)) {
          this.buttons.push(new G.UI.Btn({
            x: 368, y: 240, w: 96, h: 24, small: true, variant: 'gold',
            label: (def.daily.advance || '入夜歇息'),
            onClick: function () { self._toCrisis(); }
          }));
        }
      } else if (arc.phase === 'end') {
        var cta = def.lossCta || '闭上双眼';
        this.buttons.push(new G.UI.Btn({
          x: 198, y: 232, w: 84, h: 26, small: true, variant: 'gold',
          label: cta,
          onClick: function () {
            if (def.endFlow) G.game.changeScene('ending');
            else G.game.die(def.deathCause || 'war');
          }
        }));
      }

      /* 抉择选项 */
      if (this._pendingChoice) {
        var opts = this._pendingChoice.node.options || [];
        var n = opts.length, w = Math.min(200, 130 + n * 0);
        var startX = 240 - (n * (w + 12) - 12) / 2;
        opts.forEach(function (op, i) {
          var ok = G.Arcs.optionOk(save, op);
          self.buttons.push(new G.UI.Btn({
            x: startX + i * (w + 12), y: 150, w: w, h: 24, small: true,
            variant: ok ? 'default' : 'ghost',
            disabled: !ok,
            label: op.t,
            onClick: function () {
              self._pendingGo = self._pendingChoice.go;
              self._pickChoice(op);
            }
          }));
        });
      }
    },

    onTap: function (p) {
      if (this.line) {
        if (!this.line.tw.done) this.line.tw.show();
        else this._advanceLine();
        return;
      }
      if (this.arc().phase === 'daily') {
        var sp = this._spotAt(p);
        if (sp) this._tapSpot(sp);
      }
    },
    onKey: function (k) {
      if (k === 'Enter' && this.line) {
        if (!this.line.tw.done) this.line.tw.show();
        else this._advanceLine();
      }
    },

    update: function (dt) {
      this.t += dt;
      if (this.line && !this.line.tw.done) this.line.tw.update(dt);
      if (this.arc().phase === 'crisis' || this.arc().phase === 'loss') {
        for (var i = 0; i < this.rain.length; i++) {
          var r = this.rain[i];
          r.y += r.v * dt; r.x -= 60 * dt;
          if (r.y > VH) { r.y = -10; r.x = G.rng.range(0, VW + 40); }
        }
      }
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      var def = this._def, arc = this.arc();
      x.drawImage(this._bg(def, arc.phase !== 'daily'), 0, 0, VW, VH);

      if (arc.phase === 'daily') this._renderSpots(x);
      if (arc.phase === 'crisis' || arc.phase === 'loss') this._renderRain(x);

      this._renderHeader(x, def, arc);

      if (arc.phase === 'daily' && !this.line) this._renderMem(x, def, arc);
      if (this.line) this._renderDialog(x, this.line);

      /* 暗角 */
      var vg = x.createRadialGradient(240, 130, 110, 240, 130, 320);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      x.fillStyle = vg; x.fillRect(0, 0, VW, VH);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _renderHeader: function (x, def, arc) {
      var PHASE_N = { intro: '开场', daily: '日常', crisis: '惊变', loss: '失去', end: '终' };
      x.save();
      x.fillStyle = 'rgba(8,10,18,0.62)';
      G.UI.rr(x, 8, 8, 150, 24, 4); x.fill();
      G.UI.text(x, { x: 16, y: 14 }, def.n, 12, G.UI.C.goldHi);
      G.UI.text(x, { x: 16, y: 26 }, '第 ' + G.game.save.life + ' 世 · ' + (PHASE_N[arc.phase] || ''), 9, G.UI.C.textDim);
      x.restore();
    },

    _renderMem: function (x, def, arc) {
      var need = def.daily.need || {};
      var keys = Object.keys(need);
      x.save();
      x.fillStyle = 'rgba(8,10,18,0.6)';
      G.UI.rr(x, 8, 236, 250, 28, 4); x.fill();
      /* 横排显示 */
      var xx = 16;
      keys.forEach(function (pid) {
        var have = arc.mem[pid] || 0, n2 = need[pid];
        var name = (G.game.meta.bonds[pid] || {}).name || pid;
        var s2 = name + ' ' + have + '/' + n2;
        G.UI.text(x, { x: xx, y: 250 }, s2, 10, have >= n2 ? G.UI.C.gold : G.UI.C.textDim);
        x.font = G.UI.F(10);
        xx += x.measureText(s2).width + 14;
      });
      x.restore();
    },

    _renderSpots: function (x) {
      for (var i = 0; i < this._spotRects.length; i++) {
        var r = this._spotRects[i], sp = r.spot;
        x.save();
        x.fillStyle = 'rgba(10,13,22,0.78)';
        x.strokeStyle = 'rgba(216,183,104,0.75)';
        x.lineWidth = 1;
        G.UI.rr(x, r.x, r.y, r.w, r.h, 4); x.fill(); x.stroke();
        G.UI.text(x, { x: r.x + r.w / 2, y: r.y + 7 }, sp.label || '相处', 10.5, G.UI.C.goldHi, 'center');
        G.UI.text(x, { x: r.x + r.w / 2, y: r.y + 17 }, '点击相处', 8, G.UI.C.textDim, 'center');
        x.restore();
      }
    },

    _renderRain: function (x) {
      x.save();
      x.strokeStyle = 'rgba(170,190,230,0.35)';
      x.lineWidth = 1;
      x.beginPath();
      for (var i = 0; i < this.rain.length; i++) {
        var r = this.rain[i];
        x.moveTo(r.x, r.y); x.lineTo(r.x - 3, r.y + r.l);
      }
      x.stroke();
      x.restore();
    },

    _renderDialog: function (x, ln) {
      var self = this;
      x.save();
      /* 立绘 */
      if (ln.pid) {
        var sp = (this._def.sprites || {})[ln.pid];
        var img = null;
        try {
          if (sp && sp.sys === 'npc') img = G.Sprites.npc(sp.kind);
          else if (sp && sp.sys === 'beast') img = G.Sprites.beast(sp.kind);
          else if (ln.pid === '__hero') img = G.Sprites.heroFrames()[0];
        } catch (e) { img = null; }
        var pw = 0;
        if (img) {
          /* 立绘按目标高度自适应（npc 精灵烘焙尺寸较大，不能直接 ×3） */
          var targetH = 96;
          var sc = sp && sp.scale ? Math.min(sp.scale, targetH / img.height) : targetH / img.height;
          pw = img.width * sc;
          x.drawImage(img, DLG.x + 8, DLG.y - img.height * sc + 6, pw, img.height * sc);
        }
      }
      /* 框 */
      x.fillStyle = 'rgba(8,11,20,0.92)';
      x.strokeStyle = 'rgba(216,183,104,0.6)';
      x.lineWidth = 1;
      G.UI.rr(x, DLG.x, DLG.y, DLG.w, DLG.h, 6); x.fill(); x.stroke();
      if (ln.name) {
        x.fillStyle = 'rgba(216,183,104,0.16)';
        G.UI.rr(x, DLG.x + 10, DLG.y - 11, 76, 20, 4); x.fill();
        x.strokeStyle = 'rgba(216,183,104,0.6)'; x.stroke();
        G.UI.text(x, { x: DLG.x + 48, y: DLG.y - 1 }, ln.name, 11, G.UI.C.goldHi, 'center');
      }
      var tx0 = DLG.x + 14 + (pw ? pw + 8 : 0);
      var part = ln.tw.part();
      var lines = G.UI.wrap(x, part, 12.5, DLG.x + DLG.w - 12 - tx0);
      lines.slice(0, 3).forEach(function (l, i) {
        G.UI.text(x, { x: tx0, y: DLG.y + 20 + i * 18 }, l, 12.5, G.UI.C.text);
      });
      if (ln.tw.done) G.UI.text(x, { x: DLG.x + DLG.w - 12, y: DLG.y + DLG.h - 12 }, '点击继续', 8.5, G.UI.C.textDim, 'right');
      x.restore();
    },

    /* ===== 程序化背景（按主题，缓存） ===== */
    _bg: function (def, dark) {
      var key = def.id + (dark ? '_d' : '_l');
      if (this._bgc && this._bgc.key === key) return this._bgc.c;
      var o = G.Art.cv(VW, VH), bx = o.x;
      var theme = def.theme || 'reef';
      this._paint[theme] ? this._paint[theme](bx, dark) : this._paint.reef(bx, dark);
      this._bgc = { key: key, c: o.c };
      return o.c;
    },

    _paint: {
      /* 通用：天/月 */
      sky: function (bx, top, mid, dark) {
        var g = bx.createLinearGradient(0, 0, 0, 200);
        g.addColorStop(0, top); g.addColorStop(1, mid);
        bx.fillStyle = g; bx.fillRect(0, 0, VW, 200);
        /* 月 */
        bx.fillStyle = dark ? 'rgba(232,226,200,0.85)' : 'rgba(246,240,220,0.9)';
        bx.beginPath(); bx.arc(392, 46, 16, 0, 6.2832); bx.fill();
        bx.fillStyle = top;
        bx.beginPath(); bx.arc(386, 42, 14, 0, 6.2832); bx.fill();
      },
      window: function (bx, x, y, w, h, lit) {
        bx.fillStyle = lit ? 'rgba(255,196,104,0.95)' : 'rgba(40,46,60,1)';
        bx.fillRect(x, y, w, h);
        bx.fillStyle = 'rgba(0,0,0,0.5)'; bx.fillRect(x + w / 2 - 0.5, y, 1, h);
      },

      reef: function (bx, dark) {
        scene._paint.sky(bx, dark ? '#0b1020' : '#274060', dark ? '#182842' : '#5d7fa6', dark);
        /* 海 */
        var sea = bx.createLinearGradient(0, 150, 0, VH);
        sea.addColorStop(0, dark ? '#132238' : '#3d5d86');
        sea.addColorStop(1, dark ? '#0a1424' : '#27405f');
        bx.fillStyle = sea; bx.fillRect(0, 150, VW, VH - 150);
        /* 浪纹 */
        bx.strokeStyle = dark ? 'rgba(150,180,220,0.18)' : 'rgba(220,236,250,0.35)';
        for (var i = 0; i < 5; i++) {
          bx.beginPath();
          for (var x = 0; x <= VW; x += 12) bx.lineTo(x, 168 + i * 22 + Math.sin(x / 26 + i) * 2);
          bx.stroke();
        }
        /* 礁石 */
        bx.fillStyle = dark ? '#0d1320' : '#2a3346';
        [[40, 178, 34], [420, 196, 46], [250, 210, 26]].forEach(function (r) {
          bx.beginPath(); bx.ellipse(r[0], r[1], r[2], r[2] * 0.5, 0, 0, 6.283); bx.fill();
        });
        /* 高脚屋 */
        bx.strokeStyle = dark ? '#1a2030' : '#4a3d2e'; bx.lineWidth = 3;
        bx.beginPath(); bx.moveTo(150, 150); bx.lineTo(150, 210); bx.moveTo(230, 150); bx.lineTo(230, 210); bx.stroke();
        bx.fillStyle = dark ? '#141a28' : '#5a4632';
        bx.fillRect(132, 118, 116, 38);
        bx.beginPath(); bx.moveTo(124, 120); bx.lineTo(190, 96); bx.lineTo(256, 120); bx.closePath(); bx.fill();
        scene._paint.window(bx, 150, 128, 20, 16, true);
        scene._paint.window(bx, 196, 128, 20, 16, !dark);
        /* 小船 */
        bx.fillStyle = dark ? '#10162a' : '#46382a';
        bx.beginPath(); bx.arc(330, 226, 18, Math.PI, 0); bx.fill();
      },

      sect: function (bx, dark) {
        scene._paint.sky(bx, dark ? '#0c1020' : '#33445e', dark ? '#1a2438' : '#6880a0', dark);
        /* 山层 */
        var cols = dark ? ['#161e30', '#12192a', '#0d1322'] : ['#54637e', '#43516a', '#35415a'];
        for (var i = 0; i < 3; i++) {
          bx.fillStyle = cols[i];
          bx.beginPath();
          bx.moveTo(0, 150 + i * 30);
          for (var x = 0; x <= VW; x += 40) bx.lineTo(x, 120 + i * 30 + Math.sin(x / 90 + i) * 18);
          bx.lineTo(VW, VH); bx.lineTo(0, VH); bx.closePath(); bx.fill();
        }
        /* 殿顶 */
        bx.fillStyle = dark ? '#1a2234' : '#5a4a3a';
        bx.fillRect(176, 128, 128, 40);
        bx.beginPath(); bx.moveTo(164, 130); bx.lineTo(240, 92); bx.lineTo(316, 130); bx.closePath(); bx.fill();
        bx.fillStyle = dark ? '#0e1422' : '#4a3c2e';
        bx.fillRect(190, 140, 100, 28);
        scene._paint.window(bx, 206, 144, 22, 18, true);
        scene._paint.window(bx, 252, 144, 22, 18, dark);
        /* 石阶 */
        bx.fillStyle = dark ? '#141b2c' : '#4c5870';
        for (var s = 0; s < 6; s++) bx.fillRect(210 - s * 4, 172 + s * 12, 60 + s * 8, 8);
        /* 松 */
        bx.fillStyle = dark ? '#101a28' : '#2e4438';
        [[96, 176], [384, 184]].forEach(function (p) {
          for (var k = 0; k < 3; k++) {
            bx.beginPath(); bx.moveTo(p[0], p[1] - k * 16);
            bx.lineTo(p[0] - 18 + k * 4, p[1] + 6 - k * 16);
            bx.lineTo(p[0] + 18 - k * 4, p[1] + 6 - k * 16); bx.closePath(); bx.fill();
          }
        });
      },

      cottage: function (bx, dark) {
        scene._paint.sky(bx, dark ? '#120f1e' : '#3c4a62', dark ? '#201a30' : '#7084a4', dark);
        /* 地面 */
        bx.fillStyle = dark ? '#181420' : '#4d5648'; bx.fillRect(0, 170, VW, VH - 170);
        /* 院墙 */
        bx.fillStyle = dark ? '#1c1826' : '#6a6258';
        bx.fillRect(0, 150, VW, 14); bx.fillRect(0, 150, 10, 122); bx.fillRect(470, 150, 10, 122);
        /* 屋 */
        bx.fillStyle = dark ? '#221c2e' : '#6e543c'; bx.fillRect(150, 116, 150, 56);
        bx.beginPath(); bx.moveTo(138, 118); bx.lineTo(225, 84); bx.lineTo(312, 118); bx.closePath(); bx.fill();
        scene._paint.window(bx, 168, 128, 28, 22, true);
        bx.fillStyle = dark ? '#14101e' : '#46362a'; bx.fillRect(244, 132, 34, 40);
        /* 桃树 */
        bx.fillStyle = dark ? '#241c20' : '#4a3c2c'; bx.fillRect(86, 132, 6, 52);
        bx.fillStyle = dark ? '#2a2030' : '#7a8a5a';
        bx.beginPath(); bx.arc(89, 124, 22, 0, 6.283); bx.fill();
        bx.fillStyle = dark ? 'rgba(200,140,170,0.5)' : 'rgba(240,180,200,0.8)';
        for (var p = 0; p < 8; p++) { bx.beginPath(); bx.arc(76 + (p * 13) % 30, 112 + (p * 17) % 22, 2, 0, 6.283); bx.fill(); }
        /* 井 */
        bx.fillStyle = dark ? '#1a1c28' : '#5a5c66'; bx.fillRect(352, 156, 30, 26);
        bx.fillStyle = '#0a0c14'; bx.fillRect(356, 150, 22, 8);
      },

      manor: function (bx, dark) {
        scene._paint.sky(bx, dark ? '#140e18' : '#444a5e', dark ? '#241820' : '#788094', dark);
        bx.fillStyle = dark ? '#1a141c' : '#565a52'; bx.fillRect(0, 168, VW, VH - 168);
        /* 大堂 */
        bx.fillStyle = dark ? '#241a24' : '#6e5240'; bx.fillRect(140, 104, 200, 70);
        bx.beginPath(); bx.moveTo(126, 106); bx.lineTo(240, 66); bx.lineTo(354, 106); bx.closePath(); bx.fill();
        scene._paint.window(bx, 168, 120, 26, 22, true);
        scene._paint.window(bx, 286, 120, 26, 22, true);
        bx.fillStyle = dark ? '#160f18' : '#4a362a'; bx.fillRect(226, 134, 28, 40);
        /* 台阶 */
        bx.fillStyle = dark ? '#181420' : '#5c6068';
        for (var s = 0; s < 5; s++) bx.fillRect(176 - s * 8, 176 + s * 8, 128 + s * 16, 6);
        /* 红灯笼 */
        bx.fillStyle = 'rgba(200,60,50,0.9)';
        bx.beginPath(); bx.ellipse(112, 128, 7, 9, 0, 0, 6.283); bx.fill();
        bx.beginPath(); bx.ellipse(368, 128, 7, 9, 0, 0, 6.283); bx.fill();
      },

      dojo: function (bx, dark) {
        scene._paint.sky(bx, dark ? '#0e1218' : '#3a4a52', dark ? '#1a2226' : '#6a8084', dark);
        bx.fillStyle = dark ? '#141a1a' : '#4d5a48'; bx.fillRect(0, 168, VW, VH - 168);
        /* 茅亭 */
        bx.fillStyle = dark ? '#1c2422' : '#6a5a42';
        bx.beginPath(); bx.moveTo(140, 110); bx.lineTo(240, 72); bx.lineTo(340, 110); bx.closePath(); bx.fill();
        bx.strokeStyle = dark ? '#222a28' : '#5a4a36'; bx.lineWidth = 4;
        [[160, 110, 190], [320, 110, 190]].forEach(function (p) {
          bx.beginPath(); bx.moveTo(p[0], p[1]); bx.lineTo(p[0], p[2]); bx.stroke();
        });
        /* 木桩 */
        bx.fillStyle = dark ? '#221c1a' : '#5a4632';
        [120, 240, 360].forEach(function (x) { bx.fillRect(x - 3, 158, 6, 40); });
        /* 竹 */
        bx.strokeStyle = dark ? '#1a2620' : '#3e5a40'; bx.lineWidth = 3;
        bx.beginPath(); bx.moveTo(60, 210); bx.lineTo(60, 120); bx.moveTo(430, 214); bx.lineTo(432, 116); bx.stroke();
      },

      mirror: function (bx, dark) {
        var g = bx.createLinearGradient(0, 0, 0, VH);
        g.addColorStop(0, '#0a0e1c'); g.addColorStop(0.5, '#121a30'); g.addColorStop(1, '#080c18');
        bx.fillStyle = g; bx.fillRect(0, 0, VW, VH);
        /* 大月 */
        var rg = bx.createRadialGradient(240, 96, 10, 240, 96, 120);
        rg.addColorStop(0, 'rgba(240,236,220,0.95)'); rg.addColorStop(1, 'rgba(240,236,220,0)');
        bx.fillStyle = rg; bx.beginPath(); bx.arc(240, 96, 60, 0, 6.283); bx.fill();
        /* 水面反月 */
        bx.fillStyle = 'rgba(220,228,240,0.12)';
        bx.fillRect(200, 150, 80, VH - 150);
        for (var i = 0; i < 8; i++) {
          bx.fillStyle = 'rgba(220,228,240,' + (0.16 - i * 0.015) + ')';
          bx.fillRect(196 - i * 4, 160 + i * 14, 88 + i * 8, 6);
        }
        /* 浮片 */
        bx.fillStyle = 'rgba(180,200,230,0.25)';
        for (var k = 0; k < 10; k++) {
          var x = (k * 73) % VW, y = 60 + (k * 47) % 150;
          bx.save(); bx.translate(x, y); bx.rotate(k);
          bx.fillRect(-4, -4, 8, 8); bx.restore();
        }
      }
    }
  };

  G.scenes.arc = scene;
})();
