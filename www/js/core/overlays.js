/* 覆盖层公共工具：暗底、面板、关闭钮、角色面板（镇/山/洞共用） */
(function () {
  /* 通用面板；角色面板内容更多，单独用一块更高的面板，
     并把"离开"按钮放到面板外，避免压住属性行。 */
  var PANEL = { x: 56, y: 24, w: 368, h: 224 };
  /* 角色面板从底栏进入，底部要让出 28px 的功能栏 —— 所以比通用面板更扁一点 */
  var CHAR_PANEL = { x: 44, y: 6, w: 392, h: 232 };

  /* 角色面板的四个子页签（v0.11.0）。
     以前「角色」一页把立绘/境界/灵根/属性/功法/称号全挤在一起，密度高但**细看不了**：
     灵根只显示一行"金·木·水"，看不出系数与相克；境界只显示当前一个，
     看不出自己在「四界十九境」里的位置。现在拆成四页。
     几何导出给契约用（写死在契约里就等于没钉住）。 */
  var CHAR_TABS = [
    { id: 'overview', n: '总览' },
    { id: 'linggen', n: '灵根' },
    { id: 'attr', n: '属性' },
    { id: 'realm', n: '境界' }
  ];
  var TAB_W = 58, TAB_GAP = 4, TAB_H = 20;
  var TAB_Y = CHAR_PANEL.y + 5;
  /* 右端让开右上角的关闭钮（宽 22 + 6 边距 + 8 缝） */
  var TAB_X0 = CHAR_PANEL.x + CHAR_PANEL.w - 6 - 22 - 8 - (CHAR_TABS.length * TAB_W + (CHAR_TABS.length - 1) * TAB_GAP);

  var O = {
    PANEL: PANEL,
    CHAR_PANEL: CHAR_PANEL,
    CHAR_TABS: CHAR_TABS,
    /* 子页签几何：契约要用（写死在契约里等于没钉住） */
    CHAR_TAB_GEOM: { w: TAB_W, gap: TAB_GAP, h: TAB_H, y: TAB_Y, x0: TAB_X0 },

    dim: function (x) {
      x.fillStyle = 'rgba(5,7,12,0.70)';
      x.fillRect(0, 0, 480, 272);
    },

    frame: function (x, title, rect) {
      this.dim(x);
      G.UI.frame(x, rect || PANEL, title, { paper: true });
    },

    /* 覆盖层统一路由：各探索场景的 renderOverlay 先调它，返回 true = 已处理。
       顺序：功能面板（角色/功法/秘术/任务/储物/成就）→ 天道页（设置/界域难度/界门）
       → 场景自有页（对话/商店/珠内空间…）。
       为什么收成一处：面板清单以后还会加，散在五个场景里改，漏一处就是"点了没反应"。 */
    route: function (x, scene) {
      if (this.isPanel && this.isPanel(scene.overlay)) return this.renderPanel(x, scene);
      if (G.TianDao && G.TianDao.isMenuOverlay(scene.overlay)) {
        G.TianDao.renderOverlay(x, scene);
        return true;
      }
      return false;
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

    /* 角色面板：现在走底栏面板通道（底栏自己会画，再点「角色」页签即收起） */
    openChar: function (scene) {
      this.openPanel(scene, 'char');
    },

    /* 突破：小境界直接升；大境界扣丹后进心魔战。
       原先只写在 town.js 的珠内空间里 —— 拆到底栏「功法」页后，**任何地图**都能突破，
       所以逻辑搬到这里（口径只有一份，两处调用不会漂）。
       mapId 取当前场景名：心魔战打完要回到"你刚才站的那张图"。 */
    doBreak: function (scene) {
      var save = G.game.save;
      var mapId = G.game.sceneName;
      var r = G.Player.breakthrough(save);
      if (r.ok) {
        G.game.toast('突破成功 —— ' + r.info.n);
        this.openPanel(scene, 'skills');
        return;
      }
      if (r.big) {
        var b = G.Player.startBigBreak(save);
        if (!b.ok) { G.game.toast(b.reason); this.openPanel(scene, 'skills'); return; }
        G.game.toast('「' + b.pill + '」已服下……问心魔劫起');
        scene.clearOverlay();
        G.game.changeScene('battle', { script: 'heartDemon', mapId: mapId });
        return;
      }
      G.game.toast(r.reason);
      this.openPanel(scene, 'skills');
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

    /* 分节小标题：**唯一实现**在这里，panels.js 的 sec 只是转发 ——
       两处各写一份的话，改个颜色/字号就会漂。 */
    sec: function (x, sx, sy, t) {
      G.UI.text(x, { x: sx, y: sy }, t, 11.5, G.UI.C.gold);
    },

    /* 次要属性格：标签 + 右对齐数值（无图标，两列排） */
    statCell: function (x, sx, sy, label, val, col, w) {
      G.UI.text(x, { x: sx, y: sy }, label, 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: sx + (w == null ? 80 : w), y: sy - 0.5 },
        String(val), 11.5, col || G.UI.C.text, 'right');
    },

    /* ===== 角色面板：四子页分发（v0.11.0）=====
       标题改成**左置**，把顶部那条带子让给子页签 + 右上角关闭钮；
       内容区仍从 P.y+36 起，所以「总览」页的排版与旧版逐像素一致。 */
    renderChar: function (x, scene) {
      var save = G.game.save;
      var P = CHAR_PANEL;
      var tab = (scene && scene.charTab) || 'overview';
      this.dim(x);
      G.UI.frame(x, P, null, { paper: true });
      G.UI.textOut(x, { x: P.x + 14, y: P.y + 8 }, '角 色', 14, G.UI.C.goldHi);
      G.UI.divider(x, 240, P.y + 30, P.w - 56, 'rgba(216,183,104,0.18)');
      if (tab === 'linggen') { this.charLinggen(x, save); return; }
      if (tab === 'attr') { this.charAttr(x, save); return; }
      if (tab === 'realm') { this.charRealm(x, save); return; }
      this.charOverview(x, save);
    },

    /* ---- ① 总览：立绘 / 境界 / 简版属性 / 功法 / 称号（原「角色」页内容）---- */
    charOverview: function (x, save) {
      var st = G.Player.computeStats(save);
      var P = CHAR_PANEL;

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
    },

    /* ---- ② 灵根 ----
       灵根决定四件事：普攻属性（首元素）、功法匹配加成（同属 ×1.2）、
       打坐收益（按首元素系数）、灵石回收加成。旧版只显示"金·木·水"一行，
       玩家看不出自己灵根强弱 —— 这里把系数与相克关系摊开。 */
    charLinggen: function (x, save) {
      var P = CHAR_PANEL, LX = P.x + 14, RX = P.x + 206;
      var lg = save.linggen || { kind: '五行', elems: ['无'], coef: {}, stoneBonus: 0 };
      var elems = (lg.elems && lg.elems.length) ? lg.elems : ['无'];
      var coef = lg.coef || {};
      var COL = (G.Data.elem && G.Data.elem.color) || {};
      var coefOf = function (e) { return coef[e] != null ? coef[e] : 1; };

      O.sec(x, LX, P.y + 38, '灵 根');
      G.UI.textOut(x, { x: P.x + P.w - 38, y: P.y + 39 },
        '类型　' + (lg.kind || '五行'), 11, G.UI.C.goldHi, 'right');

      /* 元素卡：大字属性 + 该属性的灵气系数 */
      var cw = 52, ch = 38, gp = 8;
      elems.forEach(function (e, i) {
        var cx = LX + i * (cw + gp), cy = P.y + 54;
        G.UI.rr(x, { x: cx, y: cy, w: cw, h: ch }, 4);
        x.fillStyle = 'rgba(216,183,104,0.12)'; x.fill();
        x.lineWidth = 1; x.strokeStyle = 'rgba(216,183,104,0.45)'; x.stroke();
        G.UI.text(x, { x: cx + cw / 2, y: cy + 4 }, e, 16, COL[e] || G.UI.C.text, 'center');
        G.UI.text(x, { x: cx + cw / 2, y: cy + 25 }, '×' + coefOf(e), 9.5,
          G.UI.C.textDim, 'center');
      });

      /* 明细（左列） */
      O.sec(x, LX, P.y + 100, '灵根明细');
      [
        ['普攻属性', elems[0] + '（首灵根）'],
        ['打坐收益', '×' + coefOf(elems[0]) + ' / 分钟'],
        ['灵石加成', lg.stoneBonus ? '+' + Math.round(lg.stoneBonus * 100) + '%' : '无'],
        ['功法匹配', '同属功法 ×1.2']
      ].forEach(function (r, i) {
        var ry = P.y + 116 + i * 16;
        G.UI.text(x, { x: LX, y: ry }, r[0], 10.5, G.UI.C.textDim);
        G.UI.text(x, { x: LX + 68, y: ry }, r[1], 10.5, G.UI.C.text);
      });

      /* 五行相克环（右列）：金→木→土→水→火，火复克金。
         箭头**矢量画** —— 不用 '→' 字符（字体回退会出豆腐块，同 panels.js 的 mark）。 */
      O.sec(x, RX, P.y + 100, '五行相克');
      var WX = ['金', '木', '土', '水', '火'];
      var mw = 24, mh = 22, ag = 12, my = P.y + 116;
      WX.forEach(function (e, i) {
        var mx = RX + i * (mw + ag);
        var on = elems.indexOf(e) >= 0;
        G.UI.rr(x, { x: mx, y: my, w: mw, h: mh }, 3);
        x.fillStyle = on ? 'rgba(216,183,104,0.16)' : 'rgba(9,12,20,0.72)'; x.fill();
        x.lineWidth = 1;
        x.strokeStyle = on ? 'rgba(216,183,104,0.6)' : 'rgba(216,183,104,0.2)'; x.stroke();
        G.UI.text(x, { x: mx + mw / 2, y: my + 5 }, e, 12, COL[e] || G.UI.C.text, 'center');
        if (i < WX.length - 1) {
          var ax = mx + mw + 1.5, ax2 = mx + mw + ag - 1.5, acy = my + mh / 2;
          x.save();
          x.strokeStyle = 'rgba(216,183,104,0.5)'; x.lineWidth = 1; x.lineCap = 'round';
          x.beginPath(); x.moveTo(ax, acy); x.lineTo(ax2 - 2.4, acy); x.stroke();
          x.fillStyle = 'rgba(216,183,104,0.6)';
          x.beginPath(); x.moveTo(ax2, acy); x.lineTo(ax2 - 3.2, acy - 2.2);
          x.lineTo(ax2 - 3.2, acy + 2.2); x.closePath(); x.fill();
          x.restore();
        }
      });
      G.UI.text(x, { x: RX, y: my + mh + 4 }, '火 复克 金，循环相制', 10, G.UI.C.textDim);

      /* 底部：四象与系数表。三行都短 ——
         合成长行会**顶出面板右沿**（横向越界契约原先只看左端 t.x，抓不到右端，v0.11.0 已补）。 */
      O.sec(x, LX, P.y + 178, '四 象');
      G.UI.text(x, { x: LX, y: P.y + 196 },
        '光暗互克 · 光暗克风雷 · 风雷不相克 · 四象皆克五行', 10.5, G.UI.C.textDim);
      G.UI.text(x, { x: LX, y: P.y + 209 },
        '五行系数：单 1.5 / 双 1.2 / 三 1.0 / 四 0.8 / 五 0.6', 10, G.UI.C.textDim);
      G.UI.text(x, { x: LX, y: P.y + 222 },
        '四象系数：光暗 2.5 / 风雷 2.0 · 四象克五行 ×1.5', 10, G.UI.C.textDim);
    },

    /* ---- ③ 属性 ----
       数值只有五个来源（角色成长设计：境界成长 + 功法 ×(1+天赋%+出身%) + 仙躯），
       旧版只给结果数字，玩家看不出"为什么是这个数"。这里把各层加成摊开。 */
    charAttr: function (x, save) {
      var P = CHAR_PANEL, LX = P.x + 14;
      var st = G.Player.computeStats(save);
      var gl = save.globalLevel || 1;
      var meta = G.game.meta || {};
      var bk = (meta.perfusion && meta.perfusion.body) || 0;
      var hb = G.Player.hellBonusPct(meta);
      var sp = G.Player.secretPct(save);
      var te = st.te || {}, we = st.we || {};
      var pc = function (v) { return (v > 0 ? '+' : '') + Math.round((v || 0) * 100) + '%'; };
      /* 只列**真的生效**的那几项；一层全为 0 就显示"无" ——
         否则满屏「攻 0% 防 0% 血 0% 速 0%」会把有效信息淹掉。 */
      var layer = function (a, f, h, s, extra) {
        var p = [];
        if (a) p.push('攻 ' + pc(a));
        if (f) p.push('防 ' + pc(f));
        if (h) p.push('血 ' + pc(h));
        if (s) p.push('速 ' + pc(s));
        (extra || []).forEach(function (x) { p.push(x); });
        return p.length ? p.join('　') : '无';
      };
      var tExtra = [];
      if (te.c) tExtra.push('暴击 ' + pc(te.c));
      if (te.cd) tExtra.push('暴伤 ' + pc(te.cd));

      O.sec(x, LX, P.y + 38, '属 性');
      G.UI.textOut(x, { x: P.x + P.w - 38, y: P.y + 39 },
        '第 ' + save.life + ' 世', 11, G.UI.C.textDim, 'right');

      /* 三项主属性卡：从 52 加宽到 108 —— 满宽排开，不再挤成一条 */
      var cw2 = 108, gp2 = 20;
      [
        ['atk', '攻击', st.atk, '#e8b0a0'],
        ['hp', '气血', st.maxhp, '#e0a0a0'],
        ['def', '防御', st.def, '#a8c0e0']
      ].forEach(function (r, i) {
        O.statCard(x, { x: LX + i * (cw2 + gp2), y: P.y + 52, w: cw2, h: 46 },
          r[0], r[1], r[2], r[3]);
      });

      /* 派生属性：四项横排 */
      var lifeMax = G.Player.lifespanOf(gl), lifeAge = save.age || 16;
      [
        ['速度', st.spd, G.UI.C.text],
        ['暴击', (st.crit * 100).toFixed(1) + '%', G.UI.C.gold],
        ['暴伤', Math.round(st.critDmg * 100) + '%', G.UI.C.gold],
        ['寿元', lifeAge + '/' + lifeMax,
          lifeAge >= lifeMax * 0.85 ? G.UI.C.danger : G.UI.C.text]
      ].forEach(function (r, i) {
        O.statCell(x, LX + i * 92, P.y + 108, r[0], r[1], r[2], 80);
      });

      G.UI.divider(x, 240, P.y + 130, P.w - 56, 'rgba(216,183,104,0.18)');
      O.sec(x, LX, P.y + 136, '加成来源');

      /* 六行：每一层都是**现算**的，不再重写一份公式（避免与 computeStats 漂移） */
      [
        ['境界成长', '攻 ' + (10 + gl * 2) + '　防 ' + Math.round(5 + gl * 1.5)
          + '　血 ' + (100 + gl * 20) + '　速 ' + (10 + gl * 0.5)],
        ['仙躯灌注', bk > 0 ? (bk + ' 点　攻 +' + (2 * bk) + '　防 +' + bk
          + '　血 +' + (12 * bk) + '　速 +' + bk) : '未灌注'],
        ['天赋 · 出身', layer(te.a, te.f, te.h, te.s, tExtra)],
        ['世界特质', layer(we.a, we.f, we.h, we.s)],
        ['签名秘术', layer(sp.a, sp.f, sp.h, sp.s)],
        ['地狱永久', hb > 0 ? '全属性 ' + pc(hb) : '未获（以地狱难度踏破某界可得）']
      ].forEach(function (r, i) {
        var ry = P.y + 150 + i * 14;
        G.UI.text(x, { x: LX, y: ry }, r[0], 10, G.UI.C.textDim);
        G.UI.textOut(x, { x: P.x + P.w - 14, y: ry }, r[1], 10, G.UI.C.text, 'right');
      });
    },

    /* ---- ④ 境界 ----
       旧版只在总览里显示"当前境界"一个名字，玩家看不出自己在「四界十九境」里的位置，
       也不知道离破境还差多少。这里给当前境界 + 灵气进度 + 全境界总览。 */
    charRealm: function (x, save) {
      var P = CHAR_PANEL, LX = P.x + 14;
      var gl = save.globalLevel || 1;
      var ri = G.Player.realmInfo(gl);
      var bs = G.Player.breakState(save);
      var world = null;
      (G.Player.WORLDS || []).forEach(function (w) {
        if (gl >= w.start && gl <= w.cap) world = w;
      });

      O.sec(x, LX, P.y + 38, '境 界');
      G.UI.textOut(x, { x: P.x + P.w - 38, y: P.y + 39 },
        '第 ' + save.life + ' 世', 11, G.UI.C.textDim, 'right');

      G.UI.textOut(x, { x: LX, y: P.y + 54 }, ri.n, 16, G.UI.C.goldHi);
      G.UI.textOut(x, { x: LX + 130, y: P.y + 58 },
        (world ? world.n : '') + '　全境第 ' + gl + ' 级', 11, G.UI.C.textDim);

      /* 灵气进度：**数值一律排到条的右侧**（绝不压在条上 —— 项目铁律） */
      var pr = bs.need ? Math.min(1, bs.have / bs.need) : 1;
      G.UI.text(x, { x: LX, y: P.y + 80 }, '灵气', 10.5, G.UI.C.textDim);
      G.UI.bar(x, { x: LX + 32, y: P.y + 81, w: 150, h: 8 }, pr,
        bs.ready ? '#f5e3a8' : G.UI.C.qi);
      G.UI.textOut(x, { x: LX + 190, y: P.y + 80 },
        bs.ready ? '可突破' : (bs.have + ' / ' + bs.need), 10.5,
        bs.ready ? G.UI.C.jadeHi : G.UI.C.textDim);
      G.UI.textOut(x, { x: P.x + P.w - 14, y: P.y + 80 },
        '寿元 ' + (save.age || 16) + ' / ' + G.Player.lifespanOf(gl), 10.5,
        G.UI.C.textDim, 'right');

      O.sec(x, LX, P.y + 104, '四界十九境');
      var REALMS = G.Player.REALMS || [], WORLDS = G.Player.WORLDS || [];
      var colW = 91, gy = P.y + 118;
      WORLDS.forEach(function (w, ci) {
        var cx = LX + ci * colW;
        G.UI.text(x, { x: cx, y: gy }, w.n, 10.5, G.UI.C.gold);
        REALMS.filter(function (r) { return r.y0 >= w.start && r.y1 <= w.cap; })
          .forEach(function (r, k) {
            var ry = gy + 18 + k * 14;
            var cur = (gl >= r.y0 && gl <= r.y1);
            var past = gl > r.y1;
            if (cur) {
              G.UI.rr(x, { x: cx - 3, y: ry - 1.5, w: colW - 8, h: 13 }, 3);
              x.fillStyle = 'rgba(216,183,104,0.16)'; x.fill();
            }
            G.UI.text(x, { x: cx, y: ry }, r.n, 10,
              cur ? G.UI.C.goldHi : (past ? G.UI.C.jadeHi : G.UI.C.textDim));
          });
      });
    }
  };

  G.Overlays = O;
})();
