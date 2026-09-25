/* 标题画面：月夜远山、层雾落英、水墨标题 */
(function () {
  var title = {
    smooth: true,
    bg: null, mist: [], petals: [], tw: [], t: 0, about: false,

    enter: function () {
      this.about = false;
      this._buildMenu();

      /* 后台预热当前世界的地面纹理，避免首次进镇/进洞时的烘焙顿挫 */
      var pal = null;
      try {
        if (G.Storage.hasCurrent()) pal = G.Storage.loadCurrent().world.pal;
      } catch (e) { pal = null; }
      if (!pal && G.Data.xiang && G.Data.xiang.length) pal = G.Data.xiang[0].pal;
      if (G.Art.warmup) G.Art.warmup(pal);

      this.tw = [];
      for (var i = 0; i < 30; i++) {
        this.tw.push({ x: G.rng.int(10, 460), y: G.rng.int(8, 160),
          p: G.rng.range(0, 6.28), sp: G.rng.range(1, 2.4) });
      }
      this.mist = [];
      for (var m = 0; m < 6; m++) {
        this.mist.push({ x: G.rng.range(-120, 480), y: G.rng.range(140, 220),
          w: G.rng.range(200, 340), h: G.rng.range(12, 22),
          a: G.rng.range(.03, .075), sp: G.rng.range(4, 11) });
      }
      this.petals = [];
      for (var p2 = 0; p2 < 12; p2++) {
        this.petals.push({ x: G.rng.range(0, 480), y: G.rng.range(-30, 272),
          ph: G.rng.range(0, 6.28), sp: G.rng.range(7, 17),
          size: G.rng.range(1.5, 2.7), rot: G.rng.range(0, 6.28),
          rs: G.rng.range(-1.4, 1.4) });
      }
    },

    _buildMenu: function () {
      var self = this;
      this.buttons = [];
      var hasSave = G.Storage.hasCurrent(), hasMeta = G.Storage.hasMeta();
      var x = 330, w = 124, h = 30, y = 96, gap = 9;

      function add(label, variant, fn) {
        self.buttons.push(new G.UI.Btn({
          x: x, y: y, w: w, h: h, label: label, variant: variant, onClick: fn
        }));
        y += h + gap;
      }
      if (hasSave) add('继续当世', 'default', function () {
        G.game.save = G.Storage.loadCurrent();
        G.game.toast('读档成功');
        G.game.changeScene(G.game.save.scene || 'town');
      });
      add(hasMeta ? '转世重修' : '新游戏', 'gold', function () {
        G.game.changeScene('reincarnation');
      });
      if (hasMeta) add('轮回殿', 'ghost', function () { G.game.changeScene('hall'); });

      this.buttons.push(new G.UI.Btn({
        x: 10, y: 238, w: 112, h: 22, small: true, variant: 'ghost',
        label: '关于 · ' + G.VERSION,
        onClick: function () { self._openAbout(); }
      }));

      if (!this.bg) this._buildBackground();
    },

    _openAbout: function () {
      var self = this;
      this.about = true;
      this.buttons = [
        /* 放在正文下方：面板 28..234，正文 6 行到 ~197，按钮 206..230 */
        new G.UI.Btn({ x: 190, y: 206, w: 100, h: 24, small: true, variant: 'gold',
          label: '关闭', onClick: function () {
            self.about = false; self._buildMenu();
          } })
      ];
    },

    _buildBackground: function () {
      /* 素材优先 */
      var im = G.Assets.img('bg.title');
      if (im) { this.bg = im; return; }

      var K = 2, W = 480 * K, H = 272 * K;
      var c = G.Assets.makeCanvas(W, H), x = c.getContext('2d');
      x.scale(K, K);

      /* 夜空 */
      var sky = x.createLinearGradient(0, 0, 0, 250);
      sky.addColorStop(0, '#04060d');
      sky.addColorStop(.5, '#0b1020');
      sky.addColorStop(.82, '#1b2340');
      sky.addColorStop(1, '#2a3153');
      x.fillStyle = sky; x.fillRect(0, 0, 480, 272);

      /* 星云 */
      for (var n = 0; n < 4; n++) {
        var nx = G.rng.range(0, 480), ny = G.rng.range(20, 150);
        var ng = x.createRadialGradient(nx, ny, 4, nx, ny, G.rng.range(60, 130));
        ng.addColorStop(0, 'rgba(120,150,220,0.07)');
        ng.addColorStop(1, 'rgba(120,150,220,0)');
        x.fillStyle = ng;
        x.fillRect(nx - 140, ny - 140, 280, 280);
      }

      /* 星 */
      for (var i = 0; i < 150; i++) {
        var sx = G.rng.int(0, 479), sy = G.rng.int(0, 178);
        var big = G.rng.next() < .13;
        x.globalAlpha = G.rng.range(.22, .92);
        x.fillStyle = '#dfe6fa';
        x.fillRect(sx, sy, big ? 2 : 1, big ? 2 : 1);
      }
      x.globalAlpha = 1;

      /* 月 */
      var mx = 388, my = 58, mr = 28;
      var halo = x.createRadialGradient(mx, my, mr * .5, mx, my, mr * 4.2);
      halo.addColorStop(0, 'rgba(246,238,214,0.26)');
      halo.addColorStop(.45, 'rgba(200,214,250,0.09)');
      halo.addColorStop(1, 'rgba(200,214,250,0)');
      x.fillStyle = halo;
      x.beginPath(); x.arc(mx, my, mr * 4.2, 0, 6.2832); x.fill();
      var mg = x.createRadialGradient(mx - 9, my - 10, 2, mx, my, mr);
      mg.addColorStop(0, '#fdf7e4');
      mg.addColorStop(.7, '#eaddbd');
      mg.addColorStop(1, '#cdbe98');
      x.fillStyle = mg;
      x.beginPath(); x.arc(mx, my, mr, 0, 6.2832); x.fill();
      /* 月面肌理 */
      x.fillStyle = 'rgba(150,140,110,0.16)';
      [[-8, -6, 5], [7, 4, 6.5], [-2, 9, 3.6], [11, -9, 3]].forEach(function (p) {
        x.beginPath(); x.arc(mx + p[0], my + p[1], p[2], 0, 6.2832); x.fill();
      });

      /* 云带 */
      for (var cb = 0; cb < 5; cb++) {
        var cy = 60 + cb * 22 + G.rng.range(-8, 8);
        var cw = G.rng.range(140, 300), cx0 = G.rng.range(-80, 400);
        var cg = x.createLinearGradient(cx0, 0, cx0 + cw, 0);
        cg.addColorStop(0, 'rgba(150,168,210,0)');
        cg.addColorStop(.5, 'rgba(150,168,210,' + G.rng.range(.05, .11) + ')');
        cg.addColorStop(1, 'rgba(150,168,210,0)');
        x.fillStyle = cg;
        x.beginPath();
        x.ellipse(cx0 + cw / 2, cy, cw / 2, G.rng.range(5, 11), 0, 0, 6.2832);
        x.fill();
      }

      /* 三层远山 */
      function ridge(baseY, amp, step, color, phase) {
        var pts = [];
        for (var px = 0; px <= 480; px += step) {
          var yy = baseY + (G.rng.next() - .5) * 2 * amp
            + Math.sin(px * .018 + phase) * amp * .9;
          pts.push({ x: px, y: yy });
        }
        x.fillStyle = color;
        x.beginPath();
        x.moveTo(0, 272);
        x.lineTo(pts[0].x, pts[0].y);
        for (var i2 = 0; i2 < pts.length - 1; i2++) {
          var qx = (pts[i2].x + pts[i2 + 1].x) / 2, qy = (pts[i2].y + pts[i2 + 1].y) / 2;
          x.quadraticCurveTo(pts[i2].x, pts[i2].y, qx, qy);
        }
        var last = pts[pts.length - 1];
        x.quadraticCurveTo(last.x, last.y, 480, last.y);
        x.lineTo(480, 272); x.closePath(); x.fill();
      }
      ridge(182, 14, 30, '#1a2138', 0);
      ridge(206, 19, 26, '#101626', 2.1);
      ridge(232, 21, 22, '#070a13', 4.4);

      /* 前景：崖松剪影 */
      x.fillStyle = '#05070d';
      x.beginPath();
      x.moveTo(0, 272);
      x.lineTo(0, 236);
      x.quadraticCurveTo(30, 226, 58, 238);
      x.quadraticCurveTo(84, 248, 120, 246);
      x.lineTo(120, 272);
      x.closePath(); x.fill();
      /* 松 */
      x.strokeStyle = '#05070d'; x.lineWidth = 2.4; x.lineCap = 'round';
      x.beginPath(); x.moveTo(34, 240); x.quadraticCurveTo(32, 218, 38, 202); x.stroke();
      x.lineWidth = 1.6;
      [[38, 206, 26, 196], [36, 214, 22, 206], [40, 210, 52, 200],
       [38, 220, 54, 212], [34, 224, 20, 218]].forEach(function (b) {
        x.beginPath(); x.moveTo(b[0], b[1]); x.quadraticCurveTo((b[0] + b[2]) / 2, b[3] - 4, b[2], b[3]); x.stroke();
      });

      this.bg = c;
    },

    update: function (dt) {
      this.t += dt;
      for (var i = 0; i < this.mist.length; i++) {
        var m = this.mist[i];
        m.x += m.sp * dt;
        if (m.x - m.w > 480) m.x = -m.w;
      }
      for (var p = 0; p < this.petals.length; p++) {
        var pe = this.petals[p];
        pe.y += pe.sp * dt;
        pe.x += Math.sin(this.t * 1.3 + pe.ph) * 11 * dt + 5 * dt;
        pe.rot += pe.rs * dt;
        if (pe.y > 284) { pe.y = -12; pe.x = G.rng.range(0, 480); }
      }
    },

    render: function (x) {
      x.drawImage(this.bg, 0, 0, 480, 272);

      /* 闪烁星 */
      for (var i = 0; i < this.tw.length; i++) {
        var s = this.tw[i];
        x.globalAlpha = .3 + .6 * Math.abs(Math.sin(this.t * s.sp + s.p));
        x.fillStyle = '#eef2ff';
        x.fillRect(s.x, s.y, 1.2, 1.2);
      }
      x.globalAlpha = 1;

      /* 雾带 */
      for (var m2 = 0; m2 < this.mist.length; m2++) {
        var mm = this.mist[m2];
        var g = x.createLinearGradient(mm.x, 0, mm.x + mm.w, 0);
        g.addColorStop(0, 'rgba(214,224,250,0)');
        g.addColorStop(.5, 'rgba(214,224,250,' + mm.a + ')');
        g.addColorStop(1, 'rgba(214,224,250,0)');
        x.fillStyle = g;
        x.beginPath();
        x.ellipse(mm.x + mm.w / 2, mm.y, mm.w / 2, mm.h, 0, 0, 6.2832);
        x.fill();
      }

      /* 标题 */
      x.textAlign = 'left'; x.textBaseline = 'top';
      x.font = '54px "LXGW WenKai", KaiTi, serif';
      x.lineJoin = 'round';
      x.lineWidth = 5;
      x.strokeStyle = 'rgba(6,8,14,0.7)';
      x.strokeText('逆 尘', 54, 56);
      var tg = x.createLinearGradient(0, 56, 0, 116);
      tg.addColorStop(0, '#fbf0c4');
      tg.addColorStop(.45, '#f0d489');
      tg.addColorStop(1, '#bd9440');
      x.shadowColor = 'rgba(216,183,104,0.6)';
      x.shadowBlur = 18;
      x.fillStyle = tg;
      x.fillText('逆 尘', 54, 56);
      x.shadowBlur = 0;

      /* 标题下金线 */
      var lg = x.createLinearGradient(54, 0, 230, 0);
      lg.addColorStop(0, 'rgba(216,183,104,0.85)');
      lg.addColorStop(1, 'rgba(216,183,104,0)');
      x.fillStyle = lg;
      x.fillRect(56, 120, 176, 1.4);

      /* 副题 */
      x.font = '15px "LXGW WenKai", KaiTi, serif';
      x.fillStyle = 'rgba(214,208,190,0.86)';
      x.fillText('万界轮回，微尘逆命', 58, 130);

      /* 朱印 */
      x.fillStyle = '#9c3a32';
      x.beginPath();
      x.arc(258, 141, 12, 0, 6.2832);
      x.fill();
      x.strokeStyle = 'rgba(246,236,216,0.5)';
      x.lineWidth = 1;
      x.beginPath(); x.arc(258, 141, 10, 0, 6.2832); x.stroke();
      x.font = '14px KaiTi, serif';
      x.fillStyle = '#f6ecd8';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('逆', 258, 142);

      /* 落英 */
      for (var p3 = 0; p3 < this.petals.length; p3++) {
        var pe3 = this.petals[p3];
        x.save();
        x.globalAlpha = .72;
        x.translate(pe3.x, pe3.y);
        x.rotate(pe3.rot);
        x.fillStyle = '#e8d4dc';
        x.beginPath();
        x.ellipse(0, 0, pe3.size, pe3.size * .58, 0, 0, 6.2832);
        x.fill();
        x.fillStyle = 'rgba(255,255,255,0.35)';
        x.beginPath();
        x.ellipse(-pe3.size * 0.2, -pe3.size * 0.15, pe3.size * 0.4, pe3.size * 0.22, 0, 0, 6.2832);
        x.fill();
        x.restore();
      }
      x.globalAlpha = 1;

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 120, 240, 136, 330);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = vg;
      x.fillRect(0, 0, 480, 272);

      if (this.about) this._renderAbout(x);
      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _renderAbout: function (x) {
      x.fillStyle = 'rgba(4,6,12,0.76)';
      x.fillRect(0, 0, 480, 272);
      var r = { x: 84, y: 28, w: 312, h: 206 };
      G.UI.frame(x, r, '关 于', { paper: true });
      var lines = [
        '游戏：逆尘　　当前版本：' + G.VERSION,
        '类型：2D 回合制 · 万界轮回 Roguelite',
        '引擎：HTML5 Canvas + Capacitor 6（离线单机）',
        '本版内容：转世、幼年、青溪镇、探图、战斗、轮回殿',
        '美术：程序化高保真画面，支持素材整包替换',
        '存档：本机本地保存，无云端、无内购'
      ];
      for (var i = 0; i < lines.length; i++) {
        G.UI.text(x, { x: r.x + 24, y: r.y + 52 + i * 21 }, lines[i], 12.5, G.UI.C.text);
      }
    }
  };

  G.scenes.title = title;
})();
