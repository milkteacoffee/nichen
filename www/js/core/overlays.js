/* 覆盖层公共工具：暗底、面板、关闭钮、角色面板（镇/山/洞共用） */
(function () {
  /* 通用面板；角色面板内容更多，单独用一块更高的面板，
     并把"离开"按钮放到面板外，避免压住属性行。 */
  var PANEL = { x: 56, y: 24, w: 368, h: 224 };
  /* 角色面板从底栏进入，底部要让出 28px 的功能栏 —— 所以比通用面板更扁一点。
     v0.14.0：与底栏五面板同一套卷轴版式 —— **左缘一条竖排标题带**，内容区右移。
     ⚠️ `CHAR_PANEL` 是**外框**（导出给契约、四个子页签的几何也按它算）；
        `CHAR_BODY` 才是**内容区**（四个子页的绘制按它定位）。
        把两者混用 → 内容整体右移 30px（静默，只有截图看得出来）。 */
  var CHAR_PANEL = { x: 44, y: 6, w: 392, h: 232 };
  var CHAR_BAND_W = 30;
  var CHAR_BODY = {
    x: CHAR_PANEL.x + CHAR_BAND_W, y: CHAR_PANEL.y,
    w: CHAR_PANEL.w - CHAR_BAND_W, h: CHAR_PANEL.h
  };
  /* 竖排标题带矩形（角色面板这一条）。五面板那条在 panels.js，用同一个绘制函数。 */
  var CHAR_BAND = {
    x: CHAR_PANEL.x + 6, y: CHAR_PANEL.y + 8,
    w: CHAR_BAND_W - 12, h: CHAR_PANEL.h - 16
  };

  /* 角色面板的子页签（v0.11.0 建四页；v0.15.0 扩到六页）。
     v0.15.0：**功法 / 秘术并入角色面板**（用户口径："把功法、秘术放到角色面板里面"）——
     它们仍是**独立的面板实现**（`drawSkills`/`drawSecrets` 的绘制与按钮逻辑一行没动），
     只是从底栏移到了子页签：`panel` 字段说明"这一页切到哪个 overlay"。
     好处是零重构风险：功法页的下拉、参悟、精进全部照旧。 */
  var CHAR_TABS = [
    { id: 'overview', n: '总览', panel: 'char' },
    { id: 'linggen', n: '灵根', panel: 'char' },
    { id: 'attr', n: '属性', panel: 'char' },
    { id: 'realm', n: '境界', panel: 'char' },
    { id: 'skills', n: '功法', panel: 'skills' },
    { id: 'secrets', n: '秘术', panel: 'secrets' }
  ];
  /* 子页签几何**按当前面板的外框算**：角色面板（`CHAR_PANEL`）与五面板（`FRAME`）外框不同，
     而功法/秘术并进角色组之后仍用五面板的外框 —— 写死一份必然有一边错位。
     ⚠️ 六个页签 + 关闭钮必须一起收进外框宽度（窄框要按比例缩页签宽）。 */
  function charTabGeom(frame, reserveLeft) {
    var gap = 4, h = 20;
    var right = frame.x + frame.w - 6 - 22 - 8;      /* 让开右上角关闭钮（22 宽 + 6 边距 + 8 缝） */
    /* 左端留出 `reserveLeft`：功法/秘术页的右上角还要放「灵力 30」这类状态文字，
       页签条压上去会变成"文字压在按钮上"（panels.bounds.contract 直接报）。 */
    var left = frame.x + (reserveLeft || 40);
    var n = CHAR_TABS.length;
    var w = Math.min(58, Math.floor((right - left - (n - 1) * gap) / n));
    var total = n * w + (n - 1) * gap;
    return { w: w, gap: gap, h: h, y: frame.y + 5, x0: right - total };
  }
  var TAB_GEOM = charTabGeom(CHAR_PANEL);
  /* 功法/秘术页（五面板外框）要给左上角的状态文字留位 —— 130px 够放「已习 2 / 15」 */
  var TAB_RESERVE = 130;

  /* 「境界」子页的突破按钮几何：**建钮（panels.buildCharTabs）与挂悬浮说明
     （overlays.charRealm）共用这一份**。两处各写一份必然漂 ——
     漂了的表现是"悬浮说明浮在按钮旁边"而不是按钮上，且完全静默。 */
  var CHAR_BREAK = {
    x: CHAR_PANEL.x + CHAR_PANEL.w - 130, y: CHAR_PANEL.y + 48, w: 116, h: 22
  };

  var O = {
    PANEL: PANEL,
    CHAR_PANEL: CHAR_PANEL,
    CHAR_BODY: CHAR_BODY,
    CHAR_BAND: CHAR_BAND,
    CHAR_TABS: CHAR_TABS,
    CHAR_BREAK: CHAR_BREAK,
    /* 子页签几何：契约要用（写死在契约里等于没钉住）。
       `CHAR_TAB_GEOM` 是角色面板那一份；`charTabGeom(frame)` 供其它外框（功法/秘术）取。 */
    CHAR_TAB_GEOM: TAB_GEOM,
    charTabGeom: charTabGeom,
    TAB_RESERVE: TAB_RESERVE,
    /* 角色组判定：这三个 overlay 都算「角色」页（底栏高亮 / 子页签条按它算） */
    isCharGroup: function (o) { return o === 'char' || o === 'skills' || o === 'secrets'; },

    /* 左缘竖排标题带（v0.14.0，参考《烟雨江湖》的卷轴版式）：
       内嵌窄板 + 竖排大字（一列一字、整列纵向居中）。卷轴感来自
       "窄板 + 上下留白 + 竖排字"，不依赖素材。
       **唯一实现**：六面板（五面板在 panels.js + 角色面板在 renderChar）都调这里 ——
       两处各画一份的话，字号/行距一改就漂，而且漂了只有截图看得出来。 */
    titleBand: function (x, b, title) {
      G.UI.panel(x, b, 'rgba(9,14,26,0.70)', 'rgba(158,206,246,0.32)', 4,
        { tex: false, shadow: false });
      var chars = String(title || '').replace(/[\s　]/g, '').split('');
      if (!chars.length) return;
      var fs = 15, lh = 21;
      var top = b.y + (b.h - chars.length * lh) / 2;
      chars.forEach(function (c, i) {
        G.UI.text(x, { x: b.x + b.w / 2, y: top + i * lh + (lh - fs) / 2 }, c,
          fs, G.UI.C.goldHi, 'center');
      });
    },

    dim: function (x) {
      x.fillStyle = 'rgba(5,7,12,0.70)';
      x.fillRect(0, 0, 480, 272);
    },

    frame: function (x, title, rect) {
      this.dim(x);
      G.UI.frame(x, rect || PANEL, title, { tex: true });
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
      /* 对话框 = 云海玉牌（深青紫底 + 浅字）。**只包住绘制、不包 dim** ——
         dim 是压暗层，在云海作用域里画也无妨，但把它留在外面语义更清楚。 */
      return G.UI.mist(function () {
        G.UI.frame(x, P, opt.title, { tex: true });

        var box = { x: P.x + 14, y: P.y + 32, w: 74, h: 74 };
        /* 立绘底板**刻意用字面暗色**，不走语义色 —— 立绘本身是深色半身像，
           底板必须比面板更暗才读得成"框里嵌了一张像"。语义色会被云海作用域翻转，所以写死。 */
        G.UI.panel(x, box, '#101423', 'rgba(216,183,104,0.35)', 4,
          { tex: false, shadow: false });
        var art = G.Art.portrait(opt.portrait || 'villager');
        if (art) x.drawImage(art.c, box.x, box.y, art.w, art.h);

        var tx = box.x + box.w + 14;                 /* 台词列左端 */
        var tw = P.x + P.w - 18 - tx;                /* 台词列宽 */
        if (opt.name) {
          x.font = G.UI.F(13);
          var nw = x.measureText(opt.name).width + 20;
          G.UI.rr(x, { x: tx, y: box.y - 3, w: nw, h: 19 }, 4);
          x.fillStyle = 'rgba(156,58,50,0.14)'; x.fill();
          x.lineWidth = 1; x.strokeStyle = 'rgba(156,58,50,0.55)'; x.stroke();
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
      });
    },

    /* 抉择卡：M1 §4 起剧情要"选一个，并且记下来"（抉择 1 杀/放/交、抉择 2 护镇/护人）。
       opt = { title, name, portrait, lines:[], note }
       版式与 dialog 同源（立绘 + 名牌 + 折行台词），差别只有：
       ① 底部预留 3 条竖排选项按钮的位置（按钮由调用方建，这里只画框与文案）；
       ② 多一行 note 用来写"这个选择会被记住"之类的提示。
       为什么不让调用方自己拼：抉择卡以后还会加（m1-5），拼一次就会走样一次。 */
    choice: function (x, opt) {
      opt = opt || {};
      var P = this.PANEL;
      this.dim(x);
      /* 抉择卡与对话框**同一套云海材质**（同一个 PANEL 矩形、同一个立绘框、同一个名牌位置），
         两处材质必须一致 —— 否则"先看台词再选"会读成两个界面。 */
      return G.UI.mist(function () {
        G.UI.frame(x, P, opt.title, { tex: true });

        var box = { x: P.x + 14, y: P.y + 32, w: 74, h: 74 };
        /* 立绘底板用 `C.panelDark`（随材质翻转）：立绘是深色半身像，
           底板必须比面板更暗才读得成"框里嵌了一张像"。 */
        G.UI.panel(x, box, G.UI.C.panelDark, G.UI.C.frameBorder, 4,
          { tex: false, shadow: false });
        var art = G.Art.portrait(opt.portrait || 'villager');
        if (art) x.drawImage(art.c, box.x, box.y, art.w, art.h);

        var tx = box.x + box.w + 14;
        var tw = P.x + P.w - 18 - tx;
        if (opt.name) {
          x.font = G.UI.F(13);
          var nw = x.measureText(opt.name).width + 20;
          G.UI.rr(x, { x: tx, y: box.y - 3, w: nw, h: 19 }, 4);
          x.fillStyle = 'rgba(156,58,50,0.14)'; x.fill();
          x.lineWidth = 1; x.strokeStyle = 'rgba(156,58,50,0.55)'; x.stroke();
          G.UI.textOut(x, { x: tx + 10, y: box.y - 0.5 }, opt.name, 13, G.UI.C.goldHi);
        }
        /* 台词先全部折行、**再按剩余高度反推行距**。
           抉择卡的按钮由调用方建（首条落在 y=P.y+150），台词区实际只到那儿为止；
           台词一多折两行就会压到按钮上（按钮是实心色块，压上去直接读不出字）。
           所以这里不写死行距：先算行数，再让行距（必要时连字号）缩到装得下为止。 */
        var fs = 12.5;
        var rows = [];
        (opt.lines || []).forEach(function (l) {
          G.UI.wrap(x, l, fs, tw).forEach(function (row) { rows.push(row); });
        });
        var btnTop = opt.btnTop || (P.y + 146);
        var ly = box.y + (opt.name ? 25 : 0);
        var avail = btnTop - ly - 3;
        if (rows.length * 20 > avail) fs = 11.5;
        var lead = Math.min(20, Math.floor(avail / Math.max(1, rows.length)));
        if (lead < 13) lead = 13;                   /* 下限：再挤就不成行了 */
        rows.forEach(function (row) {
          G.UI.text(x, { x: tx, y: ly }, row, fs, G.UI.C.text);
          ly += lead;
        });
        /* note 挂在台词之后，同样让位给底部按钮 */
        if (opt.note) {
          var ny = Math.min(ly + 5, btnTop - 14);
          G.UI.text(x, { x: P.x + 14, y: ny }, opt.note, 10.5, G.UI.C.textDim);
        }
        return P;
      });
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
    /* 突破的唯一口径（珠内空间 / 角色面板「境界」子页都调它，不各写一份规则）。
       `back` = 结算后回到哪个面板：不传就**收起覆盖层回地图** ——
       以前写死回 'skills'，那是"功法页曾经有突破按钮"时代的产物；
       现在突破按钮在角色面板「境界」子页，回 'skills' 就跳错地方了。 */
    /* back = 突破后回到哪个面板；keepTab = 是否保留该面板的子页签。
       ⚠️ **必须能保留子页签**：境界页点「突破」→ 突破完 → openPanel('char') 会把
       charTab 重置成 'overview'，玩家正看着境界却被弹回总览（截图反馈就是这个）。
       openPanel 的第三参本来就是干这个的，这里只是把它透传出去。 */
    doBreak: function (scene, back, keepTab) {
      var save = G.game.save;
      var mapId = G.game.sceneName;
      var ret = function () {
        if (back) this.openPanel(scene, back, keepTab);
        else scene.clearOverlay();
      }.bind(this);
      var r = G.Player.breakthrough(save);
      if (r.ok) {
        G.game.toast('突破成功 —— ' + r.info.n);
        ret();
        return;
      }
      if (r.big) {
        var b = G.Player.startBigBreak(save);
        if (!b.ok) { G.game.toast(b.reason); ret(); return; }
        G.game.toast('「' + b.pill + '」已服下……问心魔劫起');
        scene.clearOverlay();
        G.game.changeScene('battle', { script: 'heartDemon', mapId: mapId });
        return;
      }
      G.game.toast(r.reason);
      ret();
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

    /* ===== 角色面板：四子页分发（v0.11.0；v0.14.0 换卷轴版式）=====
       标题从"顶部左置"改成**左缘竖排带**（与底栏五面板同一套），
       顶部那条带子只留子页签 + 右上角关闭钮；
       四个子页的绘制一律用 `CHAR_BODY`（内容区），不是 `CHAR_PANEL`（外框）。 */
    renderChar: function (x, scene) {
      var save = G.game.save;
      var tab = (scene && scene.charTab) || 'overview';
      this.dim(x);
      G.UI.frame(x, CHAR_PANEL, null, { tex: true });
      this.titleBand(x, CHAR_BAND, '角色');
      G.UI.divider(x, CHAR_BODY.x + CHAR_BODY.w / 2, CHAR_BODY.y + 30,
        CHAR_BODY.w - 42, 'rgba(216,183,104,0.18)');
      if (tab === 'linggen') { this.charLinggen(x, save); return; }
      if (tab === 'attr') { this.charAttr(x, save); return; }
      if (tab === 'realm') { this.charRealm(x, save); return; }
      this.charOverview(x, save);
    },

    /* ---- ① 总览：立绘 / 境界 / 简版属性 / 功法 / 称号（原「角色」页内容）---- */
    charOverview: function (x, save) {
      var st = G.Player.computeStats(save);
      var P = CHAR_BODY;

      var LX = P.x + 18;              /* 62  */
      var RX = P.x + 206;             /* 250 */
      var LW = 168;                   /* 左栏宽 62..230 */
      var RW = P.x + P.w - 18 - RX;   /* 右栏宽 168 */

      /* ---- 左栏：立绘 + 境界 ---- */
      var ri = G.Player.realmInfo(save.globalLevel);
      var box = { x: LX, y: P.y + 36, w: LW, h: 84 };   /* 44..128 */
      G.UI.panel(x, box, '#101423', 'rgba(216,183,104,0.35)', 4, { tex: false, shadow: false });

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
      /* ⚠️ 称号会越加越多（每界地狱通关一枚），**必须按可用宽截断** ——
         右栏只有 RW 宽（内容区收窄后更窄），写死画到 RX+RW 迟早压到「称号」两字上
         （v0.14.0 内容区右移 30px 后，三枚称号就已经贴到一起了）。 */
      var raw = titles.length ? titles.join('·') : '无';
      var avail = RW - 26 - 6;            /* 让开「称号」两字 + 一点缝 */
      x.font = G.UI.F(11);
      var tstr = raw;
      while (tstr.length > 1 && x.measureText(tstr).width > avail) tstr = tstr.slice(0, -1);
      if (tstr !== raw) tstr = tstr.slice(0, -1) + '…';
      G.UI.textOut(x, { x: RX + RW, y: ty - 0.5 }, tstr, 11,
        titles.length ? G.UI.C.goldHi : G.UI.C.textDim, 'right');
    },

    /* ---- ② 灵根（v0.11.4 改成「九维方块图」）----
       九维 = 五行（金木水火土）+ 四象（光雷风暗），**正好九格**，3×3 摆开。
       每格：属性字 + 该属性的灵气系数 + 底部一根按系数归一的比例条。
       拥有的属性亮起、未拥有的压暗 —— 一眼看出"本世灵根倾向哪几维"。
       旧版是一排只列**已拥有**属性的卡，看不出缺什么，也读不出强弱。

       顺序固定按 NINE 常量，**不按拥有的排**：按拥有的排的话，
       每次轮回灵根一变，格子的位置就全跳了，玩家记不住"金在哪一格"。 */
    charLinggen: function (x, save) {
      var P = CHAR_BODY, LX = P.x + 14;
      var lg = save.linggen || { kind: '五行', elems: ['无'], coef: {}, stoneBonus: 0 };
      var elems = (lg.elems && lg.elems.length) ? lg.elems : ['无'];
      var coef = lg.coef || {};
      var COL = (G.Data.elem && G.Data.elem.color) || {};
      var coefOf = function (e) { return coef[e] != null ? coef[e] : 0; };
      var RX = LX + 160;              /* 右栏起点：九宫格 142 宽 + 18 缝 */
      var CW = 42, GAP = 8;           /* 格 42 + 缝 8 → 九宫格 142×142 */

      O.sec(x, LX, P.y + 38, '灵 根');
      G.UI.textOut(x, { x: P.x + P.w - 38, y: P.y + 39 },
        '类型　' + (lg.kind || '五行'), 11, G.UI.C.goldHi, 'right');

      var NINE = ['金', '木', '水', '火', '土', '光', '雷', '风', '暗'];
      var MAXC = 2.5;                 /* 四象「光暗」2.5 是全系统上界，比例条按它归一 */
      var gy0 = P.y + 48;
      NINE.forEach(function (e, i) {
        var cx = LX + (i % 3) * (CW + GAP);
        var cy = gy0 + Math.floor(i / 3) * (CW + GAP);
        var on = elems.indexOf(e) >= 0;
        var v = coefOf(e);
        G.UI.rr(x, { x: cx, y: cy, w: CW, h: CW }, 4);
        x.fillStyle = on ? 'rgba(216,183,104,0.14)' : 'rgba(9,12,20,0.72)'; x.fill();
        x.lineWidth = 1;
        x.strokeStyle = on ? 'rgba(216,183,104,0.65)' : 'rgba(216,183,104,0.18)';
        x.stroke();
        G.UI.text(x, { x: cx + CW / 2, y: cy + 5 }, e, 14,
          on ? (COL[e] || G.UI.C.text) : G.UI.C.textDim, 'center');
        G.UI.textOut(x, { x: cx + CW / 2, y: cy + 23 }, v ? ('×' + v) : '—', 9.5,
          on ? G.UI.C.goldHi : G.UI.C.textDim, 'center');
        /* 比例条：槽 + 填充（长度 = 系数 / 上界） */
        var bx = cx + 5, bw = CW - 10, by = cy + CW - 8;
        x.fillStyle = 'rgba(255,255,255,0.07)';
        x.fillRect(bx, by, bw, 3.5);
        if (v > 0) {
          x.fillStyle = COL[e] || G.UI.C.gold;
          x.fillRect(bx, by, bw * Math.min(1, v / MAXC), 3.5);
        }
      });
      /* 格下说明：只两行、且**左栏宽度内收得住**（右栏从 RX 起，不能压过去） */
      G.UI.text(x, { x: LX, y: gy0 + 3 * (CW + GAP) + 4 },
        '五行在前 · 四象在后', 10, G.UI.C.textDim);
      G.UI.text(x, { x: LX, y: gy0 + 3 * (CW + GAP) + 18 },
        '条长 = 系数 / 2.5', 10, G.UI.C.textDim);

      /* ---- 右栏 ---- */
      O.sec(x, RX, P.y + 38, '灵根明细');
      [
        ['普攻属性', elems[0] + '（首灵根）'],
        ['打坐收益', '×' + coefOf(elems[0]) + ' / 分钟'],
        ['灵石加成', lg.stoneBonus ? '+' + Math.round(lg.stoneBonus * 100) + '%' : '无'],
        ['功法匹配', '同属功法 ×1.2']
      ].forEach(function (r, i) {
        var ry = P.y + 56 + i * 16;
        G.UI.text(x, { x: RX, y: ry }, r[0], 10.5, G.UI.C.textDim);
        G.UI.text(x, { x: RX + 68, y: ry }, r[1], 10.5, G.UI.C.text);
      });

      /* 五行相克环：金→木→土→水→火，火复克金。
         箭头**矢量画** —— 不用 '→' 字符（字体回退会出豆腐块，同 panels.js 的 mark）。 */
      O.sec(x, RX, P.y + 124, '五行相克');
      var WX = ['金', '木', '土', '水', '火'];
      var mw = 22, mh = 20, ag = 9, my = P.y + 140;
      WX.forEach(function (e, i) {
        var mx = RX + i * (mw + ag);
        var on = elems.indexOf(e) >= 0;
        G.UI.rr(x, { x: mx, y: my, w: mw, h: mh }, 3);
        x.fillStyle = on ? 'rgba(216,183,104,0.16)' : 'rgba(9,12,20,0.72)'; x.fill();
        x.lineWidth = 1;
        x.strokeStyle = on ? 'rgba(216,183,104,0.6)' : 'rgba(216,183,104,0.2)'; x.stroke();
        G.UI.text(x, { x: mx + mw / 2, y: my + 4 }, e, 11.5, COL[e] || G.UI.C.text, 'center');
        if (i < WX.length - 1) {
          var ax = mx + mw + 1, ax2 = mx + mw + ag - 1, acy = my + mh / 2;
          x.save();
          x.strokeStyle = 'rgba(216,183,104,0.5)'; x.lineWidth = 1; x.lineCap = 'round';
          x.beginPath(); x.moveTo(ax, acy); x.lineTo(ax2 - 2.2, acy); x.stroke();
          x.fillStyle = 'rgba(216,183,104,0.6)';
          x.beginPath(); x.moveTo(ax2, acy); x.lineTo(ax2 - 3, acy - 2);
          x.lineTo(ax2 - 3, acy + 2); x.closePath(); x.fill();
          x.restore();
        }
      });
      G.UI.text(x, { x: RX, y: my + mh + 4 }, '火复克金，循环相制', 10, G.UI.C.textDim);

      /* 四象规则：压到右栏底部。**两行都必须短于右栏宽**（204），
         长行会顶出面板右沿 —— 横向越界契约现判两端，抓得到。 */
      O.sec(x, RX, P.y + 180, '四 象');
      G.UI.text(x, { x: RX, y: P.y + 196 },
        '光暗互克 · 风雷不相克', 10, G.UI.C.textDim);
      G.UI.text(x, { x: RX, y: P.y + 209 },
        '四象克五行 · 四象强于五行', 10, G.UI.C.textDim);
    },

    /* ---- ③ 属性 ----
       数值只有五个来源（角色成长设计：境界成长 + 功法 ×(1+天赋%+出身%) + 仙躯），
       旧版只给结果数字，玩家看不出"为什么是这个数"。这里把各层加成摊开。 */
    charAttr: function (x, save) {
      var P = CHAR_BODY, LX = P.x + 14;
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

      /* 三项主属性卡。⚠️ v0.14.0 内容区左沿右移 30px 后这里**漏改了**：
         3×108 + 2×20 = 364 > 可用宽 334 → 第三张卡右沿 452 顶出面板 436（截图里可见）。
         ⚠️ 当时契约没抓到 —— 它只判**文字**，而文字在卡里居中、卡跑出去了文字还在界内。
         现在 `panels.bounds.contract` 加了**框探针**（记录 `G.UI.rr` 的矩形），这类问题一次抓全。
         算式：LX=88 到内容右沿 422，可用 334；取 3×100 + 2×16 = 332。**改卡数/卡宽前先算这条。** */
      var cw2 = 100, gp2 = 16;
      [
        ['atk', '攻击', st.atk, '#e8b0a0'],
        ['hp', '气血', st.maxhp, '#e0a0a0'],
        ['def', '防御', st.def, '#a8c0e0']
      ].forEach(function (r, i) {
        O.statCard(x, { x: LX + i * (cw2 + gp2), y: P.y + 52, w: cw2, h: 46 },
          r[0], r[1], r[2], r[3]);
      });

      /* 派生属性：五项横排（v0.14.0 加「法力」——释放主动技的代价）。
         ⚠️ 内容区右沿 = CHAR_PANEL.x + CHAR_PANEL.w - 14 = 422；LX = CHAR_BODY.x + 14 = 88。
         可用宽 334：4×间距 + 格宽 ≤ 334 → 取 间距 70 / 格宽 64 → 88..432。
         **加第 6 项前必须先算这条不等式**（超了是静默的，只有 panels.bounds 会报）。 */
      var lifeMax = G.Player.lifespanOf(gl), lifeAge = save.age || 16;
      [
        ['速度', st.spd, G.UI.C.text],
        ['法力', st.mpMax, '#8fb8e8'],
        ['暴击', (st.crit * 100).toFixed(1) + '%', G.UI.C.gold],
        ['暴伤', Math.round(st.critDmg * 100) + '%', G.UI.C.gold],
        ['寿元', lifeAge + '/' + lifeMax,
          lifeAge >= lifeMax * 0.85 ? G.UI.C.danger : G.UI.C.text]
      ].forEach(function (r, i) {
        O.statCell(x, LX + i * 70, P.y + 108, r[0], r[1], r[2], 64);
      });

      G.UI.divider(x, 240, P.y + 130, P.w - 56, 'rgba(216,183,104,0.18)');
      O.sec(x, LX, P.y + 136, '加成来源');

      /* 六行：每一层都是**现算**的，不再重写一份公式（避免与 computeStats 漂移） */
      [
        ['境界成长', '攻 ' + (10 + gl * 2) + '　防 ' + Math.round(5 + gl * 1.5)
          + '　血 ' + (100 + gl * 20) + '　速 ' + (10 + gl * 0.5) + '　法 ' + (20 + gl * 2)],
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
      var P = CHAR_BODY, LX = P.x + 14;
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

      /* 破境丹缺失 → **面板里常驻显示去哪拿**（v0.15.0）。
         只弹一次 toast 是不够的：玩家关掉提示就再也看不到（截图反馈的原话是
         "破境失败之后，没有说在哪里可以获取破境丹"）。 */
      if (bs.big && !bs.pillOwned) {
        G.UI.text(x, { x: LX, y: P.y + 94 },
          '缺「' + bs.pill + '」　' + bs.pillHint, 9.5, 'rgba(226,170,120,0.95)');
      }

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

      /* 突破按钮（钮本体在 panels.buildCharTabs 里建）的悬浮说明：
         不可破时把**原因**说清楚（差多少灵气 / 缺哪颗丹），
         省得玩家对着灰按钮猜 —— 原因原先只在点下去的一瞬间用 toast 闪一下。
         几何取 O.CHAR_BREAK，与建钮同源。 */
      G.UI.hover(O.CHAR_BREAK, {
        title: bs.ready ? '可突破' : '突破 · 条件未满足',
        text: bs.ready
          ? (bs.big ? '服下「' + bs.pill + '」，迎问心魔劫。' : '灵气已足，即刻破境。')
          : (bs.reason || '条件未满足')
      });
    }
  };

  G.Overlays = O;
})();
