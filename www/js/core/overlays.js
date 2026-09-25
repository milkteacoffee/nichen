/* 覆盖层公共工具：暗底、面板、关闭钮、角色面板（镇/山/洞共用） */
(function () {
  /* 通用面板；角色面板内容更多，单独用一块更高的面板，
     并把"离开"按钮放到面板外，避免压住属性行。 */
  var PANEL = { x: 56, y: 24, w: 368, h: 224 };
  var CHAR_PANEL = { x: 44, y: 8, w: 392, h: 234 };

  var O = {
    PANEL: PANEL,
    CHAR_PANEL: CHAR_PANEL,

    dim: function (x) {
      x.fillStyle = 'rgba(5,7,12,0.70)';
      x.fillRect(0, 0, 480, 272);
    },

    frame: function (x, title, rect) {
      this.dim(x);
      G.UI.frame(x, rect || PANEL, title, { paper: true });
    },

    closeBtn: function (scene, y) {
      return new G.UI.Btn({
        x: 190, y: y == null ? 218 : y, w: 100, h: 24, small: true, variant: 'ghost',
        label: '离开', onClick: function () { scene.clearOverlay(); }
      });
    },

    openChar: function (scene) {
      scene.setOverlay('char', [this.closeBtn(scene, 246)]);
    },

    /* 属性行：图标 + 标签 + 数值（w = 数值右对齐位置相对 sx 的偏移） */
    statRow: function (x, sx, sy, icon, label, val, col, w) {
      G.UI.icon(x, icon, sx + 6, sy + 6, 6);
      G.UI.text(x, { x: sx + 16, y: sy }, label, 11.5, G.UI.C.textDim);
      G.UI.textOut(x, { x: sx + (w == null ? 118 : w), y: sy - 0.5 },
        String(val), 12.5, col || G.UI.C.text, 'right');
    },

    renderChar: function (x) {
      var save = G.game.save, st = G.Player.computeStats(save);
      var P = CHAR_PANEL;
      this.frame(x, '角 色', P);

      var LX = P.x + 18;              /* 62  */
      var RX = P.x + 206;             /* 250 */
      var LW = 168;                   /* 左栏宽 62..230 */
      var RW = P.x + P.w - 18 - RX;   /* 右栏宽 168 */

      /* ---- 左栏：立绘 + 境界 ---- */
      var ri = G.Player.realmInfo(save.globalLevel);
      var box = { x: LX, y: P.y + 36, w: LW, h: 84 };   /* 44..128 */
      G.UI.panel(x, box, '#101423', 'rgba(216,183,104,0.35)', 4, { paper: false, shadow: false });

      /* 立绘框：74×74。之前把 40×40 的战斗立绘按 102×102 硬塞进来再 clip，
         框只留中心一块 —— 玩家只看到脸和领口，读不出"这是谁"。
         现在一律等比"内含"（contain）缩放、整图居中，绝不裁切。 */
      var ib = { x: box.x + 5, y: box.y + 5, w: 74, h: 74 };
      var pt = G.Assets.img('portrait.luchen');
      if (pt) {
        var iw = pt.naturalWidth || pt.width, ih = pt.naturalHeight || pt.height;
        var s = Math.min(ib.w / iw, ib.h / ih);
        var dw = iw * s, dh = ih * s;
        x.drawImage(pt, ib.x + (ib.w - dw) / 2, ib.y + (ib.h - dh) / 2, dw, dh);
      } else {
        /* 程序化头像：主角战斗立绘（40×40 逻辑，含接地阴影）整图铺进框内 */
        var hero = G.Sprites.beast('hero');
        x.drawImage(hero, ib.x, ib.y, ib.w, ib.h);
      }
      var tx = box.x + 86;            /* 148 */
      G.UI.textOut(x, { x: tx, y: box.y + 7 }, ri.n, 14, G.UI.C.goldHi);
      G.UI.divider(x, tx + 40, box.y + 29, 76);
      G.UI.text(x, { x: tx, y: box.y + 37 }, '第 ' + save.life + ' 世', 11, G.UI.C.textDim);
      G.UI.text(x, { x: tx, y: box.y + 53 }, '灵根', 11, G.UI.C.textDim);
      var lg = save.linggen;
      G.UI.textOut(x, { x: tx, y: box.y + 66 }, lg.elems.join('·'), 11.5, G.UI.C.jadeHi);

      /* ---- 左栏：属性（两列，避免与右栏功法重叠） ---- */
      var sy = P.y + 130;             /* 138 */
      G.UI.text(x, { x: LX, y: sy }, '属 性', 11.5, G.UI.C.gold);
      var rows = [
        ['atk', '攻击', st.atk, '#e8b0a0'],
        ['def', '防御', st.def, '#a8c0e0'],
        ['hp', '气血', st.maxhp, '#e0a0a0'],
        ['spd', '速度', st.spd, '#a8dcdc']
      ];
      rows.forEach(function (r, i) {
        O.statRow(x, LX, sy + 14 + i * 15, r[0], r[1], r[2], r[3], 84);
      });
      /* 右半列：标签左端 LX+92，数值右端 LX+LW。
         数值列必须留够宽度——「46/800」这类长数值会把标签压住（曾出现「寿元」被压成乱码）。 */
      G.UI.text(x, { x: LX + 92, y: sy + 14 }, '暴击', 11.5, G.UI.C.textDim);
      G.UI.textOut(x, { x: LX + LW, y: sy + 13.5 },
        (st.crit * 100).toFixed(1) + '%', 12, G.UI.C.gold, 'right');

      /* 寿元（轮回 v0.4 §3.2）：年龄 / 该境界上限，逼近上限转红 */
      var lifeMax = G.Player.lifespanOf(save.globalLevel);
      var lifeAge = save.age || 16;
      G.UI.text(x, { x: LX + 92, y: sy + 29 }, '寿元', 11.5, G.UI.C.textDim);
      G.UI.textOut(x, { x: LX + LW, y: sy + 28.5 }, lifeAge + '/' + lifeMax, 11,
        lifeAge >= lifeMax * 0.85 ? G.UI.C.danger : G.UI.C.text, 'right');

      /* ---- 左栏：六维 ---- */
      var s2 = P.y + 204;             /* 212 */
      G.UI.text(x, { x: LX, y: s2 }, '六 维', 11, G.UI.C.gold);
      var six = ['勇猛', '灵巧', '体质', '智力', '魅力'];
      six.forEach(function (k, i) {
        var cx = LX + i * 34;
        G.UI.text(x, { x: cx, y: s2 + 14 }, k[0], 11, G.UI.C.textDim);
        G.UI.textOut(x, { x: cx + 12, y: s2 + 13.5 }, String(save.six[k] || 0), 11.5, G.UI.C.text);
      });

      /* ---- 右栏：功法 ---- */
      G.UI.text(x, { x: RX, y: P.y + 36 }, '功 法', 11.5, G.UI.C.gold);
      G.UI.divider(x, RX + RW / 2, P.y + 43, RW);
      var ids = Object.keys(save.skills), yy = P.y + 54;
      if (!ids.length) {
        G.UI.text(x, { x: RX, y: yy }, '尚无功法', 11.5, G.UI.C.textDim);
      }
      ids.slice(0, 8).forEach(function (id) {
        var sd = G.Data.skills[id];
        var lv = save.skills[id].lv;
        G.UI.textOut(x, { x: RX, y: yy }, sd ? sd.n : id, 12,
          sd && sd.tier === '仙' ? G.UI.C.goldHi : G.UI.C.text);
        if (sd) {
          G.UI.text(x, { x: RX + RW - 34, y: yy + 1 }, sd.elem, 10,
            (G.Data.elem && G.Data.elem.color[sd.elem]) || G.UI.C.textDim);
        }
        G.UI.text(x, { x: RX + RW, y: yy + 1 }, 'Lv' + lv, 11, G.UI.C.textDim, 'right');
        yy += 19;
      });
    }
  };

  G.Overlays = O;
})();
