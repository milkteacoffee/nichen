/* 轮回殿：轮回档案 + 仙躯灌注（消耗仙力，永久增益下一世）
 * 2026-09-26 增「飞升台」视图（缺口 U2 的正式入口 + U3 的展示位；设计 v3.2 §10.3 / v1.1 §2.5）：
 *   · 左列选**下一世主界**（未解锁置灰并显条件；三枚碎片齐才现道界）；
 *   · 右列调**每界难度**（普通→困难→地狱，与菜单「界域难度」共用 Player.cycleWorldDiff）；
 *   · 底部显示道之钥匙碎片与已得称号。
 * 两处难度入口共用同一份逻辑，菜单那处是"世内便捷入口"，此处是**正式入口**。
 * v0.9.0：道界（dao）行**不再是「未开放」** —— 道则回廊九关已落地（缺口 U4），
 *   有钥匙即可选为下一世主界（入世即准圣一重 gl145）。 */
(function () {
  var MAXLV = 10;
  var LIVES_PER = 4;              /* 前世经历每页几条 */

  /* key 与 meta.perfusion 的字段一一对应；body 已被 Player.computeStats 消费，
     其余四项在 reincarnation.finish() 里折算为开局资源。 */
  var PERFUSE = [
    { key: 'body', n: '仙躯', d: '攻防气血速度', apply: '每级 攻+2 防+1 气血+12 速度+1' },
    { key: 'qi', n: '灵息', d: '开局灵气', apply: '每级 开局灵气 +120' },
    { key: 'po', n: '魂力', d: '开局灵力', apply: '每级 开局灵力 +12' },
    { key: 'stone', n: '财禄', d: '开局灵石', apply: '每级 开局灵石 +60' },
    { key: 'rescue', n: '遁法', d: '遁走次数', apply: '每级 开局遁走次数 +1' }
  ];

  var WN = { fan: '凡界', ling: '灵界', xian: '仙界', dao: '道界' };
  var WORDER = ['fan', 'ling', 'xian', 'dao'];
  var DN = { normal: '普通', hard: '困难', hell: '地狱' };
  var UNLOCK_HINT = {
    ling: '需通关凡界第 5 秘境',
    xian: '需通关灵界第 5 秘境',
    dao: '需集齐三枚道之钥匙碎片'
  };

  function costOf(lv) { return 20 + lv * 18; }

  /* 金底按钮上的文字色 —— 与 G.UI.Btn 里 `variant:'gold'` 的标签同色。
     金底上再画亮金（goldHi）会糊成一片（选中行 / 地狱难度行都踩过）。 */
  var ON_GOLD = '#241a06';

  /* 飞升台两个分区面板的矩形。**渲染与契约共用这一份**（导出为 ASC_PANELS）——
     以前契约里写死 h=116，改了渲染它照样绿，等于没钉住（反例验证漏过一次）。
     高度必须收在 116 以内：底部还要留出「碎片/称号」信息行（y=208）与底栏按钮（y=232）。 */
  var ASC_L = { x: 16, y: 88, w: 228, h: 116 };
  var ASC_R = { x: 252, y: 88, w: 212, h: 116 };
  var ASC_INFO_Y = 208;              /* 碎片 / 称号 / 下一世 那一行的 y */
  var ASC_FOOT_Y = 232;              /* 底栏按钮的 y（信息行必须在其之上） */

  var scene = {
    smooth: true,
    t: 0,
    hint: '',
    view: 'perfuse',              /* 'perfuse' 仙躯灌注 / 'ascend' 飞升台 / 'lives' 前世经历 */
    page: 0,                      /* 前世经历视图的翻页（每页 6 世） */

    /* 飞升台版式（渲染与契约共用；契约用它判"信息行有没有落进面板里"） */
    ASC_PANELS: [ASC_L, ASC_R],
    ASC_INFO_Y: ASC_INFO_Y,
    ASC_FOOT_Y: ASC_FOOT_Y,

    enter: function () {
      if (!G.game.meta) {
        G.game.meta = {
          lives: 0, xianli: 0, totalXianli: 0,
          perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
          pity: 0, achieve: {},
          heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
          past: []
        };
        G.Storage.saveMeta(G.game.meta);
      }
      var m = G.game.meta;
      if (!m.perfusion) m.perfusion = { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 };
      if (!m.past) m.past = [];
      if (!m.achieve) m.achieve = {};
      if (!m.titles) m.titles = [];
      if (!m.progress) m.progress = {};
      if (typeof m.xianli !== 'number') m.xianli = 0;
      if (G.Storage.stampDevice) { G.Storage.stampDevice(m); G.Storage.saveMeta(m); }
      this.t = 0;
      this.hint = '';
      this.view = 'perfuse';
      this.page = 0;
      this._build();
    },

    /* ===== 界域状态（飞升台用） ===== */
    _unlocked: function (m, w) {
      if (w === 'fan') return true;
      var pr = (m && m.progress) || {};
      if (w === 'dao') return !!pr.daoKey;
      return !!(pr.worlds && pr.worlds[w]);
    },
    _curWorld: function (m) { return G.Player.activeWorldId(m); },
    _diffOf: function (m, w) {
      var pr = (m && m.progress) || {};
      return ((pr.worldDiff || {})[w]) || pr.difficulty || 'normal';
    },
    _shards: function (m) {
      var d = ((m && m.progress) || {}).daoShards || {};
      return ['fan', 'ling', 'xian'].filter(function (k) { return d[k]; }).length;
    },

    /* ===== 按钮构建 ===== */
    _build: function () {
      this.buttons = [];
      if (this.view === 'ascend') this._buildAscend();
      else if (this.view === 'lives') this._buildLives();
      else this._buildPerfuse();
      this._buildFooter();
    },

    /* 前世经历视图：只放翻页 */
    _buildLives: function () {
      var self = this;
      var n = (G.game.meta.past || []).length;
      var pages = Math.max(1, Math.ceil(n / LIVES_PER));
      if (this.page > pages - 1) this.page = pages - 1;
      if (this.page < 0) this.page = 0;
      var y = 226;
      this.buttons.push(new G.UI.Btn({
        x: 28, y: y, w: 64, h: 20, small: true, variant: 'ghost', label: '‹ 上一页',
        disabled: this.page <= 0,
        onClick: function () { self.page -= 1; self._build(); }
      }));
      this.buttons.push(new G.UI.Btn({
        x: 100, y: y, w: 64, h: 20, small: true, variant: 'ghost', label: '下一页 ›',
        disabled: this.page >= pages - 1,
        onClick: function () { self.page += 1; self._build(); }
      }));
    },

    _buildPerfuse: function () {
      var self = this, m = G.game.meta;
      var y0 = 116, step = 21;

      PERFUSE.forEach(function (row, i) {
        var lv = m.perfusion[row.key] || 0;
        var cost = costOf(lv);
        var full = lv >= MAXLV;
        var can = !full && m.xianli >= cost;
        var b = new G.UI.Btn({
          x: 24, y: y0 + i * step, w: 272, h: 19, small: true,
          disabled: !can, label: '',
          onClick: function () {
            if (full) { self.hint = row.n + ' 已至圆满。'; return; }
            if (m.xianli < cost) { self.hint = '仙力不足，尚缺 ' + (cost - m.xianli) + ' 点。'; return; }
            m.xianli -= cost;
            m.perfusion[row.key] = lv + 1;
            G.Storage.saveMeta(m);
            self.hint = row.n + ' 提升至 Lv' + (lv + 1) + '　' + row.apply;
            self._build();
          }
        });
        /* 自定义行内排版：左名 / 中描述 / 等级点 / 右价 */
        b.render = function (xx) {
          G.UI.Btn.prototype.render.call(this, xx);
          var dis = this.disabled;
          if (dis) { xx.save(); xx.globalAlpha = 0.5; }
          G.UI.text(xx, { x: this.x + 10, y: this.y + 4 }, row.n, 12, G.UI.C.text);
          G.UI.text(xx, { x: this.x + 44, y: this.y + 5 }, row.d, 10, G.UI.C.textDim);
          for (var k = 0; k < MAXLV; k++) {
            xx.fillStyle = k < lv ? G.UI.C.gold : 'rgba(255,255,255,0.13)';
            xx.fillRect(this.x + 124 + k * 7, this.y + 8.5, 5, 3);
          }
          G.UI.text(xx, { x: this.x + this.w - 10, y: this.y + 4 },
            full ? '圆满' : (cost + ' 仙力'), 11,
            full ? G.UI.C.goldHi : (can ? G.UI.C.gold : G.UI.C.danger), 'right');
          if (dis) xx.restore();
        };
        this.buttons.push(b);
      }, this);
    },

    /* 飞升台：左列选下一世主界 / 右列调各界难度 */
    _buildAscend: function () {
      var self = this, m = G.game.meta;
      var pr = m.progress;
      var sel = pr.nextWorld || null;

      WORDER.forEach(function (w, i) {
        var unlocked = self._unlocked(m, w);
        var y = 110 + i * 22;

        /* —— 左：下一世主界（再点一次取消，交回天道抽定） —— */
        var chosen = (sel === w);
        var cur = (self._curWorld(m) === w);
        var lb = new G.UI.Btn({
          x: 28, y: y, w: 200, h: 20, small: true, label: '',
          variant: chosen ? 'gold' : (unlocked ? 'default' : 'ghost'),
          onClick: function () {
            if (!unlocked) { G.game.toast(WN[w] + '尚未解锁（' + UNLOCK_HINT[w] + '）'); return; }
            pr.nextWorld = chosen ? null : w;
            G.Storage.saveMeta(m);
            self.hint = pr.nextWorld
              ? ('下一世自' + WN[w] + '入世（起始 ' + G.Player.realmInfo(G.Player.worldById(w).start).n + '）')
              : '下一世由天道抽定';
            self._build();
          }
        });
        lb.render = function (xx) {
          G.UI.Btn.prototype.render.call(this, xx);
          var dis = !unlocked;
          if (dis) { xx.save(); xx.globalAlpha = 0.5; }
          var onGold = chosen && !dis;
          xx.fillStyle = onGold ? 'rgba(36,26,6,0.55)' : 'rgba(216,183,104,0.35)';
          xx.fillRect(this.x + 9, this.y + 8, 5, 5);
          G.UI.text(xx, { x: this.x + 22, y: this.y + 3.5 }, WN[w], 12,
            onGold ? ON_GOLD : (dis ? G.UI.C.textDim : G.UI.C.text));
          var tag = !unlocked ? '未解锁' : (chosen ? '下一世' : (cur ? '当前' : '可选'));
          G.UI.text(xx, { x: this.x + this.w - 10, y: this.y + 4 }, tag, 10,
            !unlocked ? G.UI.C.danger : (onGold ? ON_GOLD : G.UI.C.textDim), 'right');
          if (dis) xx.restore();
        };
        self.buttons.push(lb);

        /* —— 右：该界难度（点一下轮换，立即生效） —— */
        var dn = DN[self._diffOf(m, w)];
        var rb = new G.UI.Btn({
          x: 264, y: y, w: 188, h: 20, small: true, label: '',
          disabled: !unlocked,
          variant: self._diffOf(m, w) === 'hell' ? 'gold' : 'default',
          onClick: function () {
            var next = G.Player.cycleWorldDiff(m, w);
            if (!next) { G.game.toast(WN[w] + '尚未解锁，无法调整难度'); return; }
            self.hint = WN[w] + '天道难度 → ' + DN[next];
            self._build();
          }
        });
        rb.render = function (xx) {
          G.UI.Btn.prototype.render.call(this, xx);
          var dis = this.disabled;
          if (dis) { xx.save(); xx.globalAlpha = 0.5; }
          var onGold = !dis && dn === '地狱';
          G.UI.text(xx, { x: this.x + 12, y: this.y + 3.5 }, WN[w], 12,
            dis ? G.UI.C.textDim : (onGold ? ON_GOLD : G.UI.C.text));
          G.UI.text(xx, { x: this.x + this.w - 10, y: this.y + 4 },
            dis ? '—' : dn, 11.5,
            dis ? G.UI.C.textDim : (onGold ? ON_GOLD : G.UI.C.jadeHi), 'right');
          if (dis) xx.restore();
        };
        self.buttons.push(rb);
      });
    },

    /* 三个视图直接平铺成页签 —— 用一颗"切换"按钮轮换看不出还有第三页 */
    _buildFooter: function () {
      var self = this;
      var V = [
        { id: 'perfuse', n: '仙躯灌注' },
        { id: 'ascend', n: '飞升台' },
        { id: 'lives', n: '前世经历' }
      ];
      this.buttons.push(new G.UI.Btn({
        x: 16, y: 232, w: 78, h: 26, small: true, variant: 'ghost',
        label: '返回标题', onClick: function () { G.game.changeScene('title'); }
      }));
      V.forEach(function (v, i) {
        self.buttons.push(new G.UI.Btn({
          x: 100 + i * 82, y: 232, w: 78, h: 26, small: true,
          variant: self.view === v.id ? 'gold' : 'default',
          label: v.n,
          onClick: function () {
            if (self.view === v.id) return;
            self.view = v.id; self.hint = ''; self.page = 0; self._build();
          }
        }));
      });
      this.buttons.push(new G.UI.Btn({
        x: 366, y: 232, w: 98, h: 26, small: true, variant: 'gold',
        label: '转世重修', onClick: function () { G.game.changeScene('reincarnation'); }
      }));
    },

    update: function (dt) { this.t += dt; },

    /* 背景：素材优先（bg.hall），缺省走程序化 */
    _bg: function () {
      var im = G.Assets.img('bg.hall');
      if (im) return im;
      if (this._bgc) return this._bgc;
      var o = G.Art.cv(480, 272), bx = o.x;
      var g = bx.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#080c18');
      g.addColorStop(0.6, '#0d1326');
      g.addColorStop(1, '#141a2e');
      bx.fillStyle = g; bx.fillRect(0, 0, 480, 272);
      var halo = bx.createRadialGradient(240, 20, 10, 240, 20, 220);
      halo.addColorStop(0, 'rgba(120,160,220,0.14)');
      halo.addColorStop(1, 'rgba(120,160,220,0)');
      bx.fillStyle = halo; bx.fillRect(0, 0, 480, 272);
      this._bgc = o.c;
      return o.c;
    },

    render: function (x) {
      var m = G.game.meta;

      x.drawImage(this._bg(), 0, 0, 480, 272);

      /* 缓慢流动的光尘 */
      for (var i = 0; i < 22; i++) {
        var px = (i * 97 % 480) + Math.sin(this.t * 0.5 + i) * 12;
        var py = (i * 53 % 272 + this.t * 9) % 272;
        x.fillStyle = 'rgba(180,205,245,' + (0.06 + 0.05 * Math.sin(this.t + i)).toFixed(3) + ')';
        x.fillRect(px, py, 1.4, 1.4);
      }

      /* 标题 */
      G.UI.textOut(x, { x: 16, y: 10 }, '轮 回 殿', 19, G.UI.C.goldHi);
      /* 提示直接占用副标题行，避免和底部按钮抢位置 */
      G.UI.text(x, { x: 16, y: 36 },
        this.hint || (this.view === 'ascend'
          ? '真灵不灭。此处定下一世入世之界，亦可调各界天道难度。'
          : (this.view === 'lives'
            ? '天道录你每一世的行止。翻页可阅旧世经历。'
            : '真灵不灭，仙力长存。以仙力灌注仙躯，可携往下一世。')),
        11.5, this.hint ? G.UI.C.jadeHi : G.UI.C.textDim);

      /* 档案条（三视图共用；末格随视图切换） */
      G.UI.panel(x, { x: 16, y: 52, w: 448, h: 30 }, '#131828',
        'rgba(216,183,104,0.30)', 4, { paper: false, shadow: false });
      G.UI.text(x, { x: 30, y: 61 }, '轮回', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 62, y: 57 }, String(m.lives || 0), 15, G.UI.C.text);
      G.UI.text(x, { x: 118, y: 61 }, '世', 11, G.UI.C.textDim);
      G.UI.icon(x, 'stone', 166, 67, 7);
      G.UI.text(x, { x: 178, y: 61 }, '可用仙力', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 250, y: 57 }, String(m.xianli || 0), 15, G.UI.C.goldHi);
      G.UI.text(x, { x: 298, y: 61 }, '累计仙力', 11, G.UI.C.textDim);
      G.UI.textOut(x, { x: 364, y: 57 }, String(m.totalXianli || 0), 15, G.UI.C.textDim);
      /* 右对齐到面板内边距（x=424 左对齐会顶出 448 宽的面板边框） */
      G.UI.text(x, { x: 448, y: 61 },
        this.view === 'ascend'
          ? ('碎片 ' + this._shards(m) + '/3')
          : (this.view === 'lives'
            ? ('记录 ' + (m.past || []).length + ' 世')
            : ('仙躯 Lv' + (m.perfusion.body || 0))),
        11, G.UI.C.jadeHi, 'right');

      if (this.view === 'ascend') this._renderAscend(x);
      else if (this.view === 'lives') this._renderLives(x);
      else this._renderPerfuse(x);

      /* 本机标识：一眼看出"这个档是哪台设备/哪个浏览器写的"。
         换机、换浏览器、清过缓存之后，旧记录会带着别的 dev 号，便于对照排查。 */
      var dev = m.device || {};
      var here = G.Storage.deviceId ? G.Storage.deviceId() : '';
      var mine = !dev.id || dev.id === here;
      G.UI.text(x, { x: 16, y: 260 },
        '本机 ' + (dev.id || here || '—') + '　·　浏览器 ' + (dev.browser || '—')
        + (mine ? '' : '　·　当前非本档设备'), 9,
        mine ? G.UI.C.textDim : G.UI.C.danger);

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 130, 240, 136, 330);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.50)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    /* ===== 仙躯灌注视图 ===== */
    _renderPerfuse: function (x) {
      var m = G.game.meta;

      /* 仙躯灌注（分区标题放在面板内部，避免压在边框上） */
      G.UI.frame(x, { x: 16, y: 88, w: 288, h: 134 }, null, { paper: true });
      G.UI.text(x, { x: 28, y: 94 }, '仙 躯 灌 注', 12, G.UI.C.gold);
      var ach = G.Player.ACHIEVE.filter(function (a) { return m.achieve[a.id]; }).length;
      G.UI.textOut(x, { x: 292, y: 96 }, '成就 ' + ach + '/' + G.Player.ACHIEVE.length,
        10.5, ach ? G.UI.C.jadeHi : G.UI.C.textDim, 'right');
      G.UI.divider(x, 160, 111, 264, 'rgba(216,183,104,0.28)');

      /* 前世名录 */
      G.UI.frame(x, { x: 312, y: 88, w: 152, h: 134 }, null, { paper: true });
      G.UI.text(x, { x: 324, y: 94 }, '前 世 名 录', 12, G.UI.C.gold);
      G.UI.divider(x, 388, 111, 130, 'rgba(216,183,104,0.28)');
      var past = m.past.slice(-4).reverse();
      if (!past.length) {
        G.UI.text(x, { x: 328, y: 120 }, '尚无前世', 11.5, G.UI.C.textDim);
      }
      past.forEach(function (p, i) {
        var yy = 120 + i * 25;
        G.UI.text(x, { x: 328, y: yy }, '第 ' + p.life + ' 世', 11.5, G.UI.C.text);
        G.UI.text(x, { x: 328, y: yy + 12 }, p.realm + ' · ' + p.age + ' 岁', 9.5, G.UI.C.textDim);
        G.UI.text(x, { x: 452, y: yy + 2 }, '+' + p.xianli, 11, G.UI.C.gold, 'right');
      });
    },

    /* ===== 飞升台视图 ===== */
    _renderAscend: function (x) {
      var m = G.game.meta;
      var pr = m.progress || {};

      /* 左：下一世主界 */
      G.UI.frame(x, ASC_L, null, { paper: true });
      G.UI.text(x, { x: 28, y: 94 }, '下 一 世 主 界', 12, G.UI.C.gold);
      G.UI.divider(x, 130, 111, 204, 'rgba(216,183,104,0.28)');

      /* 右：界域难度（正式入口；菜单里那处是世内便捷入口） */
      G.UI.frame(x, ASC_R, null, { paper: true });
      G.UI.text(x, { x: 264, y: 94 }, '界 域 难 度', 12, G.UI.C.gold);
      G.UI.divider(x, 358, 111, 188, 'rgba(216,183,104,0.28)');

      /* 底部一行：碎片 / 称号 / 下一世落点。
         位置必须落在两个面板**下沿之外**（面板到 y=204 为止）——
         以前画在 y=212，正好压在面板的下沿花角上（39 号截图可见）。
         称号最多 3 个（破狱·凡尘/灵渊/仙穹），再多就截断，免得撞上右对齐的落点。 */
      var sel = pr.nextWorld;
      var shards = this._shards(m);
      var titles = (m.titles && m.titles.length) ? m.titles.join('·') : '无';
      var info = '道之钥匙碎片 ' + shards + '/3　称号 ' + titles;
      if (info.length > 44) info = info.slice(0, 43) + '…';
      G.UI.text(x, { x: 20, y: ASC_INFO_Y }, info, 10,
        shards >= 3 ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.text(x, { x: 448, y: ASC_INFO_Y },
        sel ? ('下一世：' + WN[sel]) : '下一世：天道抽定', 10,
        sel ? G.UI.C.gold : G.UI.C.textDim, 'right');
    },

    /* ===== 前世经历视图 =====
       天道"记录每一世经历"的落地：数据早就在 meta.past[] 里（death.js 每世压一条，
       chronicle 是那一世的走马灯），此前**界面上没有任何地方能看**，等于白记。
       这里按页倒序翻，每世一行摘要 + 一行走马灯，并标出记录来源设备。 */
    _renderLives: function (x) {
      var m = G.game.meta;
      var past = m.past || [];
      var pages = Math.max(1, Math.ceil(past.length / LIVES_PER));
      if (this.page > pages - 1) this.page = pages - 1;
      if (this.page < 0) this.page = 0;

      G.UI.frame(x, { x: 16, y: 88, w: 448, h: 134 }, null, { paper: true });
      G.UI.text(x, { x: 28, y: 94 }, '前 世 经 历', 12, G.UI.C.gold);
      G.UI.textOut(x, { x: 448, y: 96 },
        '第 ' + (this.page + 1) + ' / ' + pages + ' 页', 10, G.UI.C.textDim, 'right');
      G.UI.divider(x, 240, 111, 424, 'rgba(216,183,104,0.28)');

      if (!past.length) {
        G.UI.text(x, { x: 32, y: 130 }, '尚无前世。走完这一世，天道自会记下。', 12, G.UI.C.textDim);
        return;
      }
      var here = G.Storage.deviceId ? G.Storage.deviceId() : '';
      var end = past.length - this.page * LIVES_PER;
      var slice = past.slice(Math.max(0, end - LIVES_PER), end).reverse();
      slice.forEach(function (p, i) {
        var y = 120 + i * 26;
        var same = !p.dev || !here || p.dev === here;
        G.UI.text(x, { x: 32, y: y }, '第 ' + p.life + ' 世', 11.5, G.UI.C.goldHi);
        G.UI.text(x, { x: 94, y: y + 1 },
          p.realm + ' · ' + p.age + ' 岁 · ' + (p.causeName || '—'), 10.5, G.UI.C.text);
        G.UI.textOut(x, { x: 448, y: y + 1 }, '+' + p.xianli + ' 仙力', 10.5, G.UI.C.gold, 'right');
        /* 走马灯：太长的截断，避免糊到面板边上 */
        var line = (p.chronicle || []).map(function (c) { return c.s; }).join(' · ') || '（无载）';
        if (line.length > 52) line = line.slice(0, 51) + '…';
        G.UI.text(x, { x: 94, y: y + 12 }, line, 9, G.UI.C.textDim);
        /* 记录来源设备：不是本机写的就标红，换机后一眼能分清 */
        G.UI.textOut(x, { x: 448, y: y + 13 }, p.dev || '—', 8.5,
          same ? G.UI.C.textDim : G.UI.C.danger, 'right');
      });
    }
  };

  G.scenes.hall = scene;
})();
