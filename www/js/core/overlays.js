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

    /* 对话覆盖层：立绘 + 名牌 + 台词。
       opt = { title, name, portrait, lines:[], reward }
       立绘框 74×74 固定在面板内左上角，台词列在它右侧并按 UI.wrap 自动折行；
       reward 挂在台词下方（自适应位置，不会顶到面板底边的按钮）。
       立绘走 G.Art.portrait(key)：装了 portrait.<key> 素材用素材，否则程序化半身像。 */
    dialog: function (x, opt) {
      opt = opt || {};
      var P = this.PANEL;
      this.dim(x);
      G.UI.frame(x, P, opt.title, { paper: true });

      var box = { x: P.x + 14, y: P.y + 32, w: 74, h: 74 };
      G.UI.panel(x, box, '#101423', 'rgba(216,183,104,0.35)', 4,
        { paper: false, shadow: false });
      var art = G.Art.portrait(opt.portrait || 'villager');
      if (art) x.drawImage(art.c, box.x, box.y, art.w, art.h);

      var tx = box.x + box.w + 14;                 /* 台词列左端 */
      var tw = P.x + P.w - 18 - tx;                /* 台词列宽 */
      if (opt.name) {
        x.font = G.UI.F(13);
        var nw = x.measureText(opt.name).width + 20;
        G.UI.rr(x, { x: tx, y: box.y - 3, w: nw, h: 19 }, 4);
        x.fillStyle = 'rgba(216,183,104,0.16)'; x.fill();
        x.lineWidth = 1; x.strokeStyle = 'rgba(216,183,104,0.45)'; x.stroke();
        G.UI.textOut(x, { x: tx + 10, y: box.y - 0.5 }, opt.name, 13, G.UI.C.goldHi);
      }
      var ly = box.y + (opt.name ? 25 : 0);
      (opt.lines || []).forEach(function (l) {
        G.UI.wrap(x, l, 13, tw).forEach(function (row) {
          G.UI.text(x, { x: tx, y: ly }, row, 13, G.UI.C.text);
          ly += 21;
        });
        ly += 4;
      });
      if (opt.reward) {
        G.UI.textOut(x, { x: tx, y: ly + 4 }, opt.reward, 15, G.UI.C.goldHi);
      }
      return P;
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

    /* 主属性卡：图标 + 标签在上、数值在下，横排三张。
       角色只有 攻击 / 气血 / 防御 三项主属性，摊成卡片一眼就读得出来 ——
       塞进列表里它们和速度/暴击长得一模一样，玩家根本分不清哪个是"命根子"。 */
    statCard: function (x, s, icon, label, val, col) {
      G.UI.rr(x, s, 4);
      x.fillStyle = 'rgba(9,12,20,0.72)'; x.fill();
      x.lineWidth = 1; x.strokeStyle = 'rgba(216,183,104,0.26)'; x.stroke();
      G.UI.icon(x, icon, s.x + s.w / 2, s.y + 10, 5.8);
      G.UI.text(x, { x: s.x + s.w / 2, y: s.y + 18 }, label, 10.5, G.UI.C.textDim, 'center');
      G.UI.textOut(x, { x: s.x + s.w / 2, y: s.y + 30 }, String(val), 14.5, col, 'center');
    },

    /* 次要属性格：标签 + 右对齐数值（无图标，两列排） */
    statCell: function (x, sx, sy, label, val, col, w) {
      G.UI.text(x, { x: sx, y: sy }, label, 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: sx + (w == null ? 80 : w), y: sy - 0.5 },
        String(val), 11.5, col || G.UI.C.text, 'right');
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

      /* 立绘框：74×74，与 G.Art.portrait 的逻辑尺寸一致 —— 1:1 绘制。
         一律走 portrait：装了 portrait.luchen 用素材，否则程序化半身像；
         素材路径是等比"内含"缩放、整图居中、绝不裁切（曾把 40×40 战斗立绘按
         102×102 硬塞进来再 clip，框里只剩脸和领口，读不出"这是谁"）。 */
      var ib = { x: box.x + 5, y: box.y + 5, w: 74, h: 74 };
      var art = G.Art.portrait('luchen');
      if (art) x.drawImage(art.c, ib.x, ib.y, art.w, art.h);
      var tx = box.x + 86;            /* 148 */
      G.UI.textOut(x, { x: tx, y: box.y + 7 }, ri.n, 14, G.UI.C.goldHi);
      G.UI.divider(x, tx + 40, box.y + 29, 76);
      G.UI.text(x, { x: tx, y: box.y + 37 }, '第 ' + save.life + ' 世', 11, G.UI.C.textDim);
      G.UI.text(x, { x: tx, y: box.y + 53 }, '灵根', 11, G.UI.C.textDim);
      var lg = save.linggen;
      G.UI.textOut(x, { x: tx, y: box.y + 66 }, lg.elems.join('·'), 11.5, G.UI.C.jadeHi);

      /* ---- 左栏：属性 ----
         三项主属性走卡片（攻击/气血/防御），其余四项走两列小格。
         数值列必须留够宽度——「16/120」这类长数值会把标签压住（曾出现「寿元」被压成乱码）。 */
      var sy = P.y + 130;             /* 138 */
      G.UI.text(x, { x: LX, y: sy }, '属 性', 11.5, G.UI.C.gold);
      [
        ['atk', '攻击', st.atk, '#e8b0a0'],
        ['hp', '气血', st.maxhp, '#e0a0a0'],
        ['def', '防御', st.def, '#a8c0e0']
      ].forEach(function (r, i) {
        O.statCard(x, { x: LX + i * 58, y: sy + 12, w: 52, h: 46 }, r[0], r[1], r[2], r[3]);
      });

      /* 次要属性：2×2（速度/暴击 · 寿元/暴伤） */
      var s2 = P.y + 200;             /* 208 */
      G.UI.divider(x, LX + LW / 2, s2 - 8, LW);
      O.statCell(x, LX, s2, '速度', st.spd, G.UI.C.text, 80);
      O.statCell(x, LX + 92, s2, '暴击', (st.crit * 100).toFixed(1) + '%', G.UI.C.gold, 76);
      /* 寿元（轮回 v0.4 §3.2）：年龄 / 该境界上限，逼近上限转红 */
      var lifeMax = G.Player.lifespanOf(save.globalLevel);
      var lifeAge = save.age || 16;
      O.statCell(x, LX, s2 + 16, '寿元', lifeAge + '/' + lifeMax,
        lifeAge >= lifeMax * 0.85 ? G.UI.C.danger : G.UI.C.text, 80);
      O.statCell(x, LX + 92, s2 + 16, '暴伤', Math.round(st.critDmg * 100) + '%', G.UI.C.gold, 76);

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

      /* 称号：地狱难度通关该界所得（破狱·凡尘 / 灵渊 / 仙穹），**跨世保留**。
         以前只有 meta.titles 记着、界面上没有任何展示位，玩家"拿了但看不见"（缺口 G15）。
         固定在右栏底部，不随功法条数浮动。 */
      var titles = (G.game.meta && G.game.meta.titles) || [];
      var ty = P.y + P.h - 22;
      G.UI.divider(x, RX + RW / 2, ty - 8, RW, 'rgba(216,183,104,0.22)');
      G.UI.text(x, { x: RX, y: ty }, '称号', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: RX + RW, y: ty - 0.5 },
        titles.length ? titles.join('·') : '无', 11,
        titles.length ? G.UI.C.goldHi : G.UI.C.textDim, 'right');
    }
  };

  G.Overlays = O;
})();
