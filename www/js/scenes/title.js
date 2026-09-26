/* 标题画面：仙穹云海、流云落英、竖排仙题 */
(function () {
  var title = {
    smooth: true,
    bg: null, mist: [], petals: [], t: 0, about: false, ach: false,

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

      /* ⚠️ 这里的 `G.rng` 调用**条数不能改**：全局 rng 是时间播种的，多取一次
         就会把之后的序列整体推移，把靠它跑出来的回归基线一起带歪。
         所以改视觉只调参数范围/颜色，**不要加删 for 的循环次数**。 */
      this.mist = [];
      for (var m = 0; m < 6; m++) {
        this.mist.push({ x: G.rng.range(-120, 480), y: G.rng.range(146, 226),
          w: G.rng.range(200, 340), h: G.rng.range(9, 17),
          a: G.rng.range(.07, .14), sp: G.rng.range(5, 13) });
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
      /* 回到主菜单就收起成就页（`enter` 与「关闭」都走这里，一处收口） */
      this.ach = false;
      this.buttons = [];
      var hasSave = G.Storage.hasCurrent(), hasMeta = G.Storage.hasMeta();
      /* 题牌列在**左侧**：右侧竖排标题 + 朱印要占掉 x≈350..470 一整条。 */
      /* 步长 42 → 36：v0.15.0 菜单从 3 项加到 4 项，原步长下第 4 项会压到「关于」上 */
      var x = 40, w = 158, h = 28, y = 88, gap = 8;

      function add(label, variant, fn) {
        self.buttons.push(new G.UI.Btn({
          x: x, y: y, w: w, h: h, label: label, variant: variant, onClick: fn
        }));
        y += h + gap;
      }
      if (hasSave) add('继续当世', 'frost', function () {
        G.game.save = G.Storage.loadCurrent();
        G.game.toast('读档成功');
        G.game.changeScene(G.game.save.scene || 'town');
      });
      /* 主操作走 `frostGold`（云雾玉牌·金）：云海底上不该出现 default 的墨玉渐变块 ——
         那是 HUD 体系的材质，压在云海背景上会读成"贴上去的补丁"。 */
      add(hasMeta ? '转世重修' : '新游戏', 'frostGold', function () {
        G.game.changeScene(hasMeta ? 'reincarnation' : 'difficulty');
      });
      if (hasMeta) add('轮回殿', 'frost', function () { G.game.changeScene('hall'); });
      /* 成就移出游戏内（v0.15.0，用户口径"放到游戏外面的新建游戏界面"）：
         它与**设备绑定、跨世只发一次**，属于账号级信息，放在开局界面最合适。
         无 meta 时也能进（看空列表 + 设备标识），不必先有存档。 */
      add('成就 · 称号', 'frost', function () { self._openAch(); });

      this.buttons.push(new G.UI.Btn({
        x: 40, y: 236, w: 136, h: 22, small: true, variant: 'frost',
        label: '关于 · ' + G.VERSION,
        onClick: function () { self._openAbout(); }
      }));

      if (!this.bg) this._buildBackground();
    },

    _openAch: function () {
      var self = this;
      this.ach = true;
      this.about = false;
      this.buttons = [
        new G.UI.Btn({ x: 190, y: 240, w: 100, h: 22, small: true, variant: 'frostGold',
          label: '关闭', onClick: function () {
            self.ach = false; self._buildMenu();
          } })
      ];
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

      /* v0.13.0：**仙穹云海**。
         v0.12.0 做过一版浅底宣纸水墨，与修仙世界观不符（凡俗纸墨），已废弃。
         现在是：深青紫仙穹 + 仙月 + 从云海里探出的远峰 + 多层流云 + 前景云气。
         ⚠️ 噪声一律用 `G.Art.rnd(固定种子)`，**不要用 `G.rng`** ——
         全局 rng 是时间播种的，在它上面多取几个随机数会推移序列，
         把靠它跑出来的回归基线一起带歪。 */
      var K = 2, W = 480 * K, H = 272 * K;
      var c = G.Assets.makeCanvas(W, H), x = c.getContext('2d');
      x.scale(K, K);
      var r = G.Art.rnd(20260926);

      /* ① 仙穹：深青紫渐变（顶近墨，中靛蓝，下转青灰 —— 云海反射的天光） */
      var sky = x.createLinearGradient(0, 0, 0, 272);
      sky.addColorStop(0, '#060a17');
      sky.addColorStop(0.34, '#101a38');
      sky.addColorStop(0.62, '#1a2750');
      sky.addColorStop(0.84, '#243357');
      sky.addColorStop(1, '#2d3a58');
      x.fillStyle = sky; x.fillRect(0, 0, 480, 272);

      /* ② 星：稀疏细星。仙穹不是凡间夜空，不要满天 */
      for (var i = 0; i < 90; i++) {
        var sx2 = r() * 480, sy2 = r() * 148;
        x.globalAlpha = 0.20 + r() * 0.60;
        x.fillStyle = r() < 0.22 ? '#cfe6ff' : '#e8f0ff';
        var big = r() < 0.10;
        x.fillRect(sx2, sy2, big ? 1.6 : 1, big ? 1.6 : 1);
      }
      x.globalAlpha = 1;

      /* ③ 仙月：大月轮 + 青白光晕（悬在云海之上，画面唯一的高亮源）。
         ⚠️ 月心必须让开竖排标题（TX=404）—— 压在字上会把「逆」糊掉；
         现在放在 318，月轮右缘 350，与标题左缘（≈379）留 29px 缝。 */
      var mx = 318, my = 58, mr = 32;
      var halo = x.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4.6);
      halo.addColorStop(0, 'rgba(206,232,255,0.26)');
      halo.addColorStop(0.42, 'rgba(150,196,246,0.10)');
      halo.addColorStop(1, 'rgba(150,196,246,0)');
      x.fillStyle = halo;
      x.beginPath(); x.arc(mx, my, mr * 4.6, 0, 6.2832); x.fill();
      var mg = x.createRadialGradient(mx - 10, my - 12, 3, mx, my, mr);
      mg.addColorStop(0, '#fdfdff');
      mg.addColorStop(0.62, '#e2ecfb');
      mg.addColorStop(1, '#b9cce6');
      x.fillStyle = mg;
      x.beginPath(); x.arc(mx, my, mr, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(150,172,200,0.20)';
      [[-9, -7, 6], [8, 5, 7.5], [-3, 10, 4], [13, -10, 3.4]].forEach(function (p) {
        x.beginPath(); x.arc(mx + p[0], my + p[1], p[2], 0, 6.2832); x.fill();
      });

      /* ④ 远峰（仙山）：从云海里探出来的剪影，越远越淡越青。
         山脊用二次曲线，山顶要"软" —— 尖角会读成"锯齿"，不像云海里的仙山。 */
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
      ridge(150, 17, 34, 'rgba(96,132,190,0.34)', 'rgba(96,132,190,0.05)', 0.85, 0.7);
      ridge(178, 20, 28, 'rgba(56,84,140,0.52)', 'rgba(56,84,140,0.08)', 0.90, 2.6);
      ridge(206, 22, 23, 'rgba(26,42,78,0.86)', 'rgba(16,26,50,0.42)', 0.95, 4.7);

      /* ⑤ 云海：下半部的多层流云（冷白青）—— 「腾云驾雾」的主体。
         两端淡出的椭圆做云带，再整体压一层冷光渐变给"体积"，
         只画云带的话会读成几道白线、不像云。 */
      for (var cb = 0; cb < 14; cb++) {
        var cy = 168 + cb * 7.6 + r() * 8;
        var cw = 190 + r() * 300, cx0 = -110 + r() * 470;
        var ca = 0.055 + r() * 0.10;
        var cg = x.createLinearGradient(cx0, 0, cx0 + cw, 0);
        cg.addColorStop(0, 'rgba(198,226,255,0)');
        cg.addColorStop(.5, 'rgba(198,226,255,' + ca.toFixed(3) + ')');
        cg.addColorStop(1, 'rgba(198,226,255,0)');
        x.fillStyle = cg;
        x.beginPath();
        x.ellipse(cx0 + cw / 2, cy, cw / 2, 5 + r() * 11, 0, 0, 6.2832);
        x.fill();
      }
      var sea = x.createLinearGradient(0, 196, 0, 272);
      sea.addColorStop(0, 'rgba(150,190,240,0.04)');
      sea.addColorStop(0.55, 'rgba(168,204,246,0.13)');
      sea.addColorStop(1, 'rgba(120,158,208,0.07)');
      x.fillStyle = sea; x.fillRect(0, 196, 480, 76);

      /* ⑥ 前景云气：左下角一团浓云，压住画面重心（标题在右、菜单在左，都不挡） */
      for (var f = 0; f < 5; f++) {
        var fx = -30 + f * 34 + r() * 22, fy = 250 + r() * 16;
        var fg = x.createRadialGradient(fx, fy, 4, fx, fy, 64 + r() * 36);
        fg.addColorStop(0, 'rgba(206,232,255,0.14)');
        fg.addColorStop(1, 'rgba(206,232,255,0)');
        x.fillStyle = fg;
        x.beginPath(); x.arc(fx, fy, 104, 0, 6.2832); x.fill();
      }

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

      /* 流云：横过云海的**冷白**晕染。
         深色云海上只有亮色才读得出"在动" —— 与旧版（浅底宣纸用墨色）正好相反，
         改材质时这类"前景色与底色互换"的地方最容易漏。 */
      for (var m2 = 0; m2 < this.mist.length; m2++) {
        var mm = this.mist[m2];
        var a = Math.min(0.30, mm.a * 2.0);
        var g = x.createLinearGradient(mm.x, 0, mm.x + mm.w, 0);
        g.addColorStop(0, 'rgba(206,232,255,0)');
        g.addColorStop(.5, 'rgba(206,232,255,' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(206,232,255,0)');
        x.fillStyle = g;
        x.beginPath();
        x.ellipse(mm.x + mm.w / 2, mm.y, mm.w / 2, mm.h, 0, 0, 6.2832);
        x.fill();
      }

      /* 落英：云海上用**淡青白**花瓣（深底上要用亮色） */
      for (var p3 = 0; p3 < this.petals.length; p3++) {
        var pe3 = this.petals[p3];
        x.save();
        x.globalAlpha = .66;
        x.translate(pe3.x, pe3.y);
        x.rotate(pe3.rot);
        x.fillStyle = '#dcecfb';
        x.beginPath();
        x.ellipse(0, 0, pe3.size, pe3.size * .58, 0, 0, 6.2832);
        x.fill();
        x.fillStyle = 'rgba(255,255,255,0.55)';
        x.beginPath();
        x.ellipse(-pe3.size * 0.2, -pe3.size * 0.15, pe3.size * 0.4, pe3.size * 0.22, 0, 0, 6.2832);
        x.fill();
        x.restore();
      }
      x.globalAlpha = 1;

      /* ===== 右侧竖排标题 =====
         题牌菜单占左列 x 40..198，标题必须让到右列（见 _buildMenu 的注释）。
         字号 50 + 行距 60：两字竖排占 38..148，下面是云光线 / 副题 / 朱印，到 222 收住。 */
      var TX = 404;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '50px "LXGW WenKai", KaiTi, serif';
      x.lineJoin = 'round';
      /* 先描一圈**深色**：深色云海上要用暗边把字"托"出来（宣纸那版是反过来的 ——
         浅底要浅描边、深底要深描边，这条与上面流云是同一条规律）。 */
      x.lineWidth = 5;
      x.strokeStyle = 'rgba(6,12,26,0.80)';
      x.strokeText('逆', TX, 62);
      x.strokeText('尘', TX, 122);
      var tg = x.createLinearGradient(0, 38, 0, 148);
      tg.addColorStop(0, '#ffffff');
      tg.addColorStop(0.45, '#d8ecff');
      tg.addColorStop(1, '#8fc4ea');
      x.shadowColor = 'rgba(150,220,255,0.62)';
      x.shadowBlur = 20;
      x.fillStyle = tg;
      x.fillText('逆', TX, 62);
      x.fillText('尘', TX, 122);
      x.shadowBlur = 0;

      /* 标题下云光线：两端淡出（一笔扫过，不是"一根规整的横杠"） */
      var lg = x.createLinearGradient(TX - 34, 0, TX + 34, 0);
      lg.addColorStop(0, 'rgba(176,216,255,0)');
      lg.addColorStop(.5, 'rgba(176,216,255,0.62)');
      lg.addColorStop(1, 'rgba(176,216,255,0)');
      x.fillStyle = lg;
      x.fillRect(TX - 34, 152, 68, 1.2);

      /* 副题 */
      x.font = '11px "LXGW WenKai", KaiTi, serif';
      x.fillStyle = 'rgba(190,214,242,0.86)';
      x.fillText('万界轮回 · 微尘逆命', TX, 168);

      /* 朱印：冷色画面里唯一的一点暖红，做视觉锚点 */
      x.fillStyle = '#9c3a32';
      x.beginPath(); x.arc(TX, 206, 15, 0, 6.2832); x.fill();
      x.strokeStyle = 'rgba(250,242,228,0.55)';
      x.lineWidth = 1;
      x.beginPath(); x.arc(TX, 206, 12.6, 0, 6.2832); x.stroke();
      x.font = '15px KaiTi, serif';
      x.fillStyle = '#f8efdd';
      x.fillText('逆', TX, 207);

      /* 暗角：**冷青黑**（暖褐会把云海压成"脏雾"），比夜景那版轻一些 */
      var vg = x.createRadialGradient(240, 136, 130, 240, 136, 330);
      vg.addColorStop(0, 'rgba(4,8,20,0)');
      vg.addColorStop(1, 'rgba(4,8,20,0.46)');
      x.fillStyle = vg;
      x.fillRect(0, 0, 480, 272);

      if (this.ach) this._renderAch(x);
      if (this.about) this._renderAbout(x);
      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    /* 成就页（v0.15.0）：**在游戏外**渲染（用户口径"放到游戏外面的新建游戏界面"）。
       绘制实现留在 `panels.js`（`G.Overlays.drawAchieve`，单一实现），这里只负责
       压暗 + 调用 —— 复制一份到 title.js 的话，两处的列宽/行距迟早分叉。
       面板矩形用的是五面板的 FRAME（{12,26,456,212}），所以这一页与游戏内其它页同款。 */
    _renderAch: function (x) {
      if (!G.game.meta) G.game.meta = { achieve: {}, titles: [] };
      G.Overlays.drawAchieve(x);
    },

    _renderAbout: function (x) {
      x.fillStyle = 'rgba(4,6,12,0.76)';
      x.fillRect(0, 0, 480, 272);
      var r = { x: 84, y: 28, w: 312, h: 206 };
      G.UI.frame(x, r, '关 于', { tex: true });
      var lines = [
        '游戏：逆尘　　当前版本：' + G.VERSION,
        '类型：2D 回合制 · 万界轮回 Roguelite',
        /* 主角身份（v0.15.0 定稿）：现代穿越者、无金手指、每世随机 ——
           写进关于页是为了**把红线摆在明面上**：后续内容不得引入系统/戒指/器灵类金手指。 */
        '主角：穿越者，无金手指，每世随机',
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
