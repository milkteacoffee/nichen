/* 标题画面：月夜远山、层雾落英、水墨标题 */
(function () {
  var title = {
    smooth: true,
    bg: null, mist: [], petals: [], t: 0, about: false,

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

      /* v0.12.0 去掉"闪烁星"：底图已从夜景换成宣纸水墨（白天），星点与主题矛盾。
         `this.mist` 仍在，但渲染改成**墨色晕染**（见 render 的注释）。 */
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
      /* 题牌列在**左侧**：右侧竖排标题 + 朱印要占掉 x≈350..470 一整条。 */
      var x = 40, w = 158, h = 32, y = 96, gap = 10;

      function add(label, variant, fn) {
        self.buttons.push(new G.UI.Btn({
          x: x, y: y, w: w, h: h, label: label, variant: variant, onClick: fn
        }));
        y += h + gap;
      }
      if (hasSave) add('继续当世', 'ink', function () {
        G.game.save = G.Storage.loadCurrent();
        G.game.toast('读档成功');
        G.game.changeScene(G.game.save.scene || 'town');
      });
      /* 主操作走 `inkGold`（宣纸金框）：纸面上不该出现 default 的亮金渐变块 —— 那是墨玉体系的材质。 */
      add(hasMeta ? '转世重修' : '新游戏', 'inkGold', function () {
        G.game.changeScene(hasMeta ? 'reincarnation' : 'difficulty');
      });
      if (hasMeta) add('轮回殿', 'ink', function () { G.game.changeScene('hall'); });

      this.buttons.push(new G.UI.Btn({
        x: 40, y: 236, w: 136, h: 22, small: true, variant: 'ink',
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
      /* 素材优先（`bg.title` 整张替换，出图规格见 www/assets/README.md） */
      var im = G.Assets.img('bg.title');
      if (im) { this.bg = im; return; }

      /* v0.12.0：**水墨宣纸**（参考《烟雨江湖》的主界面）。
         旧版是"月夜远山"的深色夜景 —— 与游戏内的墨玉 UI 同源，但缺辨识度。
         现在换成浅底水墨：宣纸暖米色 + 三层墨色远山 + 淡日 + 前景松枝，
         标题竖排在右、题牌菜单在左。
         ⚠️ 噪声一律用 `G.Art.rnd(固定种子)`，**不要用 `G.rng`** ——
         全局 rng 是时间播种的，在它上面多取几个随机数会推移序列，
         把靠它跑出来的回归基线一起带歪。 */
      var K = 2, W = 480 * K, H = 272 * K;
      var c = G.Assets.makeCanvas(W, H), x = c.getContext('2d');
      x.scale(K, K);
      var r = G.Art.rnd(20260926);

      /* ① 宣纸底 */
      var paper = x.createLinearGradient(0, 0, 0, 272);
      paper.addColorStop(0, '#f4ecda');
      paper.addColorStop(0.40, '#eae0c8');
      paper.addColorStop(0.72, '#dbcdad');
      paper.addColorStop(1, '#c6b492');
      x.fillStyle = paper; x.fillRect(0, 0, 480, 272);

      /* 纸纤维：短横线 + 细点。纯平色会读成"没画完" */
      for (var i = 0; i < 1100; i++) {
        var fx = r() * 480, fy = r() * 272, fw = 2 + r() * 10;
        x.globalAlpha = 0.025 + r() * 0.05;
        x.fillStyle = r() < 0.5 ? '#8a7a58' : '#fffaf0';
        x.fillRect(fx, fy, fw, 0.7);
      }
      x.globalAlpha = 1;

      /* ② 淡日（水墨里的"留白点"）：日轮 + 大范围暖晕 */
      var sx = 352, sy = 64;
      var halo = x.createRadialGradient(sx, sy, 8, sx, sy, 126);
      halo.addColorStop(0, 'rgba(255,240,200,0.52)');
      halo.addColorStop(0.40, 'rgba(255,232,180,0.15)');
      halo.addColorStop(1, 'rgba(255,232,180,0)');
      x.fillStyle = halo;
      x.beginPath(); x.arc(sx, sy, 126, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(253,242,210,0.94)';
      x.beginPath(); x.arc(sx, sy, 21, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(210,186,138,0.20)';
      [[-6, -5, 4], [5, 4, 5], [-1, 7, 3]].forEach(function (p) {
        x.beginPath(); x.arc(sx + p[0], sy + p[1], p[2], 0, 6.2832); x.fill();
      });

      /* ③ 三层远山（越近墨越浓）。山脊用二次曲线，山顶要"软" */
      function ridge(baseY, amp, step, top, bot, alpha, phase) {
        var pts = [];
        for (var px = -24; px <= 504; px += step) {
          var yy = baseY + (r() - .5) * 2 * amp + Math.sin(px * .016 + phase) * amp * .85;
          pts.push({ x: px, y: yy });
        }
        x.save();
        x.globalAlpha = alpha;
        var g = x.createLinearGradient(0, baseY - amp * 2.4, 0, 272);
        g.addColorStop(0, top);
        g.addColorStop(1, bot);
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(-24, 272);
        x.lineTo(pts[0].x, pts[0].y);
        for (var i2 = 0; i2 < pts.length - 1; i2++) {
          var qx = (pts[i2].x + pts[i2 + 1].x) / 2, qy = (pts[i2].y + pts[i2 + 1].y) / 2;
          x.quadraticCurveTo(pts[i2].x, pts[i2].y, qx, qy);
        }
        var last = pts[pts.length - 1];
        x.quadraticCurveTo(last.x, last.y, 504, last.y);
        x.lineTo(504, 272); x.closePath(); x.fill();
        x.restore();
      }
      ridge(146, 15, 36, 'rgba(126,138,152,0.40)', 'rgba(126,138,152,0.06)', 0.9, 0.7);
      ridge(176, 19, 30, 'rgba(76,88,106,0.56)', 'rgba(76,88,106,0.10)', 0.92, 2.6);
      ridge(208, 21, 25, 'rgba(40,46,58,0.84)', 'rgba(26,30,40,0.34)', 0.96, 4.7);

      /* ④ 云雾：横过山腰的白色晕染（水墨的"破墨"） */
      for (var cb = 0; cb < 6; cb++) {
        var cy = 150 + cb * 15 + r() * 12;
        var cw = 150 + r() * 220, cx0 = -60 + r() * 400;
        var cg = x.createLinearGradient(cx0, 0, cx0 + cw, 0);
        cg.addColorStop(0, 'rgba(255,252,244,0)');
        cg.addColorStop(.5, 'rgba(255,252,244,' + (0.16 + r() * 0.16).toFixed(3) + ')');
        cg.addColorStop(1, 'rgba(255,252,244,0)');
        x.fillStyle = cg;
        x.beginPath();
        x.ellipse(cx0 + cw / 2, cy, cw / 2, 4 + r() * 8, 0, 0, 6.2832);
        x.fill();
      }

      /* ⑤ 水岸：底部一道墨色横带 + 几笔水纹 */
      var wg = x.createLinearGradient(0, 232, 0, 272);
      wg.addColorStop(0, 'rgba(28,32,42,0)');
      wg.addColorStop(0.55, 'rgba(28,32,42,0.34)');
      wg.addColorStop(1, 'rgba(20,23,31,0.62)');
      x.fillStyle = wg; x.fillRect(0, 232, 480, 40);
      x.strokeStyle = 'rgba(250,246,236,0.30)';
      x.lineWidth = 1; x.lineCap = 'round';
      for (var wv = 0; wv < 9; wv++) {
        var wy = 240 + r() * 26, wx = r() * 380, ww = 40 + r() * 90;
        x.beginPath();
        x.moveTo(wx, wy);
        x.quadraticCurveTo(wx + ww / 2, wy - 2.4, wx + ww, wy);
        x.stroke();
      }

      /* ⑥ 前景松枝（左上角，浓墨）：一笔枝干 + 几簇针叶。
         压在标题/菜单之上会挡字，所以只占左上角 150×90 的范围。 */
      x.save();
      x.strokeStyle = 'rgba(24,26,34,0.92)';
      x.lineCap = 'round';
      x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(-6, 6); x.quadraticCurveTo(46, 26, 96, 18); x.stroke();
      x.lineWidth = 2.2;
      x.beginPath(); x.moveTo(30, 20); x.quadraticCurveTo(44, 40, 40, 62); x.stroke();
      x.beginPath(); x.moveTo(72, 20); x.quadraticCurveTo(92, 32, 104, 52); x.stroke();
      /* 针叶：短促的放射笔触，每簇 7 根 */
      function needles(nx, ny, dir, len) {
        for (var k = 0; k < 7; k++) {
          var a = dir + (k - 3) * 0.30;
          x.lineWidth = 1.1;
          x.beginPath();
          x.moveTo(nx, ny);
          x.lineTo(nx + Math.cos(a) * len, ny + Math.sin(a) * len);
          x.stroke();
        }
      }
      needles(40, 60, 1.5, 13);
      needles(102, 50, 0.6, 13);
      needles(96, 18, 0.2, 12);
      needles(12, 12, 0.35, 12);
      x.restore();

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

      /* 云雾：横过山腰的**墨色**晕染。
         旧版是夜雾（冷白），换到米色宣纸上等于没画 —— 浅底上只有深色才读得出"在动"。 */
      for (var m2 = 0; m2 < this.mist.length; m2++) {
        var mm = this.mist[m2];
        var a = Math.min(0.42, mm.a * 2.4);
        var g = x.createLinearGradient(mm.x, 0, mm.x + mm.w, 0);
        g.addColorStop(0, 'rgba(58,66,84,0)');
        g.addColorStop(.5, 'rgba(58,66,84,' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(58,66,84,0)');
        x.fillStyle = g;
        x.beginPath();
        x.ellipse(mm.x + mm.w / 2, mm.y, mm.w / 2, mm.h, 0, 0, 6.2832);
        x.fill();
      }

      /* 落英：纸上用**淡墨粉**（原珠光白在米色纸上完全看不见） */
      for (var p3 = 0; p3 < this.petals.length; p3++) {
        var pe3 = this.petals[p3];
        x.save();
        x.globalAlpha = .58;
        x.translate(pe3.x, pe3.y);
        x.rotate(pe3.rot);
        x.fillStyle = '#b98d97';
        x.beginPath();
        x.ellipse(0, 0, pe3.size, pe3.size * .58, 0, 0, 6.2832);
        x.fill();
        x.fillStyle = 'rgba(255,252,246,0.45)';
        x.beginPath();
        x.ellipse(-pe3.size * 0.2, -pe3.size * 0.15, pe3.size * 0.4, pe3.size * 0.22, 0, 0, 6.2832);
        x.fill();
        x.restore();
      }
      x.globalAlpha = 1;

      /* ===== 右侧竖排标题 =====
         题牌菜单占左列 x 40..198，标题必须让到右列（见 _buildMenu 的注释）。
         字号 50 + 行距 60：两字竖排占 38..148，下面是墨线 / 副题 / 朱印，到 222 收住。 */
      var TX = 404;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '50px "LXGW WenKai", KaiTi, serif';
      x.lineJoin = 'round';
      /* 先描一圈**浅色**：宣纸吸水，墨会往外洇出一圈浅边 —— 反过来用浅色描边最像。
         （旧版是深色描边，那是给夜景打光用的，在纸上会变成"描了黑边的贴纸"。） */
      x.lineWidth = 4;
      x.strokeStyle = 'rgba(255,250,238,0.66)';
      x.strokeText('逆', TX, 62);
      x.strokeText('尘', TX, 122);
      var tg = x.createLinearGradient(0, 38, 0, 148);
      tg.addColorStop(0, '#43331c');
      tg.addColorStop(0.5, '#261c10');
      tg.addColorStop(1, '#3d2e1a');
      x.shadowColor = 'rgba(216,183,104,0.30)';
      x.shadowBlur = 10;
      x.fillStyle = tg;
      x.fillText('逆', TX, 62);
      x.fillText('尘', TX, 122);
      x.shadowBlur = 0;

      /* 标题下墨线：两端淡出（一笔扫过，不是"一根规整的横杠"） */
      var lg = x.createLinearGradient(TX - 34, 0, TX + 34, 0);
      lg.addColorStop(0, 'rgba(60,48,30,0)');
      lg.addColorStop(.5, 'rgba(60,48,30,0.62)');
      lg.addColorStop(1, 'rgba(60,48,30,0)');
      x.fillStyle = lg;
      x.fillRect(TX - 34, 152, 68, 1.2);

      /* 副题 */
      x.font = '11px "LXGW WenKai", KaiTi, serif';
      x.fillStyle = 'rgba(70,58,40,0.80)';
      x.fillText('万界轮回 · 微尘逆命', TX, 168);

      /* 朱印 */
      x.fillStyle = '#9c3a32';
      x.beginPath(); x.arc(TX, 206, 15, 0, 6.2832); x.fill();
      x.strokeStyle = 'rgba(250,242,228,0.55)';
      x.lineWidth = 1;
      x.beginPath(); x.arc(TX, 206, 12.6, 0, 6.2832); x.stroke();
      x.font = '15px KaiTi, serif';
      x.fillStyle = '#f8efdd';
      x.fillText('逆', TX, 207);

      /* 暗角：**暖褐**（冷黑会把宣纸压成"脏纸"），且比夜景那版轻得多 */
      var vg = x.createRadialGradient(240, 136, 130, 240, 136, 330);
      vg.addColorStop(0, 'rgba(40,32,20,0)');
      vg.addColorStop(1, 'rgba(40,32,20,0.30)');
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
        '引擎：HTML5 Canvas + Capacitor 6',
        '本版内容：四界二十八区 · 探图 · 回合制战斗 · 十五副本',
        '美术：程序化高保真画面，支持素材整包替换',
        '存档：本机本地保存，无云端、无内购'
      ];
      /* 折行 + 收紧行距：面板内宽只有 264，而「本版内容」那条有 24 个字符位
         （≈2 行），所以**不能按行数写死 y** —— 改一句文案就会静默顶到关闭按钮
         （按钮固定在 y=206，正文越界是静默的）。
         预算：起点 74 + 行距 19，**最多 7 行** → 末行底 ≈ 200，给按钮留 6px 缝。
         文案里只有「本版内容」会折成 2 行，其余必须保持单行（引擎那条特意去掉了
         「（离线单机）」，否则也会折 → 8 行越界）。 */
      var tx = r.x + 24, tw = r.w - 48, ly = r.y + 46;
      for (var i = 0; i < lines.length; i++) {
        G.UI.wrap(x, lines[i], 12, tw).forEach(function (row) {
          G.UI.text(x, { x: tx, y: ly }, row, 12, G.UI.C.text);
          ly += 19;
        });
      }
    }
  };

  G.scenes.title = title;
})();
