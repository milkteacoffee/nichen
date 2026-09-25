/* 转世流程：出身选择 → 灵根推演 → 天赋降世（任务#18） */
(function () {
  var origins = [
    { id: 'farm', n: '农家子弟', d: ['体质 +8', '勇猛 +3'] },
    { id: 'hunter', n: '猎户之子', d: ['勇猛 +5', '灵巧 +6', '伤药 ×2'] },
    { id: 'herb', n: '药铺学徒', d: ['智力 +6', '魅力 +3', '回春丹 ×2'] },
    { id: 'merchant', n: '商贾之家', d: ['魅力 +5', '家境 +8', '灵石 +120'] }
  ];

  var elemInfo = {
    '金': { n: '金', c: '#d8c36a' }, '木': { n: '木', c: '#6fae6f' },
    '水': { n: '水', c: '#5b9fd6' }, '火': { n: '火', c: '#d97448' },
    '土': { n: '土', c: '#b89a5a' }, '光': { n: '光', c: '#f0e0a0' },
    '雷': { n: '雷', c: '#b89ce0' }, '风': { n: '风', c: '#8fc8b8' },
    '暗': { n: '暗', c: '#9c8ab8' }
  };
  var WUXING = ['金', '木', '水', '火', '土'];
  var SIXIANG = ['光', '雷', '风', '暗'];

  function defaultMeta() {
    return {
      lives: 0, xianli: 0, totalXianli: 0,
      perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
      pity: 0, achieve: {},
      heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
      past: []
    };
  }

  var scene = {
    smooth: true,
    step: 'origin',
    originSel: -1,
    linggen: null,
    talentCards: [],
    talentRerollCost: 30,

    enter: function () {
      if (!G.game.meta) {
        G.game.meta = defaultMeta();
        G.Storage.saveMeta(G.game.meta);
      }
      this.step = 'origin'; this.originSel = -1;
      this.linggen = null; this.talentCards = [];
      this._buildButtons();
    },

    _buildButtons: function () {
      var self = this;
      this.buttons = [];
      function back(label, fn) {
        self.buttons.push(new G.UI.Btn({ x: 16, y: 232, w: 86, h: 26, label: label,
          small: true, variant: 'ghost', onClick: fn }));
      }
      function primary(label, fn, disabled) {
        self.buttons.push(new G.UI.Btn({ x: 366, y: 232, w: 98, h: 26, label: label,
          small: true, variant: 'gold', disabled: disabled, onClick: fn }));
      }
      function normal(x, label, fn, disabled) {
        self.buttons.push(new G.UI.Btn({ x: x, y: 232, w: 98, h: 26, label: label,
          small: true, disabled: disabled, onClick: fn }));
      }

      if (this.step === 'origin') {
        back('返回标题', function () { G.game.changeScene('title'); });
        primary('下一步', function () {
          self.step = 'linggen';
          self.rollLinggen();
          self._buildButtons();
        }, this.originSel < 0);
      } else if (this.step === 'linggen') {
        back('上一步', function () { self.step = 'origin'; self._buildButtons(); });
        normal(256, '重随灵根', function () { self.rollLinggen(); });
        primary('锁定灵根', function () {
          self.step = 'talent';
          self.drawTalents();
          self._buildButtons();
        });
      } else {
        back('上一步', function () { self.step = 'linggen'; self._buildButtons(); });
        normal(140, '重随（30仙力）', function () {
          var m = G.game.meta;
          if (m.xianli >= self.talentRerollCost) {
            m.xianli -= self.talentRerollCost;
            G.Storage.saveMeta(m);
            self.drawTalents();
            self._buildButtons();
          }
        }, G.game.meta.xianli < this.talentRerollCost);
        primary('入世', function () { self.finish(); });
      }
    },

    /* ===== 灵根 ===== */
    rollLinggen: function () {
      var rng = G.rng;
      var entries = [];
      function add(elems, w, kind) { entries.push({ elems: elems, w: w, kind: kind }); }
      var i, j, comb;
      /* 五行各组合（权重为类别总权，均摊到组合） */
      function combos(n) {
        var out = [], cur = [];
        (function rec(start) {
          if (cur.length === n) { out.push(cur.slice()); return; }
          for (var k = start; k < WUXING.length; k++) { cur.push(WUXING[k]); rec(k + 1); cur.pop(); }
        })(0);
        return out;
      }
      var wSingle = 7.0 / 5, wDouble = 17.5 / 10, wTriple = 24.5 / 10,
        wFour = 14.0 / 5, wFive = 7.0;
      combos(1).forEach(function (c) { add(c, wSingle, '五行'); });
      combos(2).forEach(function (c) { add(c, wDouble, '五行'); });
      combos(3).forEach(function (c) { add(c, wTriple, '五行'); });
      combos(4).forEach(function (c) { add(c, wFour, '五行'); });
      add(WUXING.slice(), wFive, '五行');
      SIXIANG.forEach(function (e) { add([e], 7.5, '四象'); });

      var pick = entries[rng.weighted(entries)];
      var lg = { kind: pick.kind, elems: pick.elems, coef: {}, stoneBonus: 0 };
      if (pick.kind === '四象') {
        pick.elems.forEach(function (e) {
          lg.coef[e] = (e === '光' || e === '暗') ? 2.5 : 2.0;
          lg.stoneBonus = (e === '光' || e === '暗') ? .25 : .15;
        });
      } else {
        var map = { 1: 1.5, 2: 1.2, 3: 1.0, 4: 0.8, 5: 0.6 };
        var cv = map[pick.elems.length];
        pick.elems.forEach(function (e) { lg.coef[e] = cv; });
        if (pick.elems.indexOf('金') >= 0) lg.stoneBonus = .15;
      }
      this.linggen = lg;
    },

    /* ===== 天赋（无放回抽3，怜悯提升高品质权重） ===== */
    drawTalents: function () {
      var pity = Math.min(.5, (G.game.meta.pity || 0) / 100);
      var base = { '仙': 1, '上': 3, '良': 6, '凡': 10 };
      var w = { '仙': base['仙'], '上': base['上'], '良': base['良'], '凡': base['凡'] };
      var shift = pity * (w['良'] + w['凡']);
      var up = w['仙'] + w['上'];
      w['仙'] += shift * (w['仙'] / up);
      w['上'] += shift * (w['上'] / up);
      w['良'] *= (1 - pity); w['凡'] *= (1 - pity);

      var pool = G.Data.talents.slice();
      var cards = [];
      for (var n = 0; n < 3; n++) {
        var groups = {};
        pool.forEach(function (t) {
          groups[t.t] = groups[t.t] || [];
          groups[t.t].push(t);
        });
        var tiers = Object.keys(groups);
        var tpick = tiers[G.rng.weighted(tiers.map(function (t) { return { w: w[t] }; }))];
        var t = G.rng.pick(groups[tpick]);
        cards.push(t);
        pool.splice(pool.indexOf(t), 1);
      }
      this.talentCards = cards;
    },

    /* ===== 结算：生成当世档 ===== */
    finish: function () {
      var meta = G.game.meta;
      var life = (meta.past.length || 0) + 1;
      var anchor = life === 1;
      var seed = anchor ? 20260924 : (Date.now() & 0x7fffffff);
      var world = G.Data.generateWorld(seed, anchor);

      /* 六维 */
      var six = { '勇猛': 0, '灵巧': 0, '体质': 0, '智力': 0, '魅力': 0, '家境': 0 };
      var items = {}, stone = 50;
      var zeroStone = false;

      /* 出身 */
      var og = origins[this.originSel];
      if (og.id === 'farm') { six['体质'] += 8; six['勇猛'] += 3; }
      if (og.id === 'hunter') { six['勇猛'] += 5; six['灵巧'] += 6; items['伤药'] = 2; }
      if (og.id === 'herb') { six['智力'] += 6; six['魅力'] += 3; items['回春丹'] = 2; }
      if (og.id === 'merchant') { six['魅力'] += 5; six['家境'] += 8; stone += 120; }

      /* 天赋 */
      var talentIds = this.talentCards.map(function (t) { return t.id; });
      this.talentCards.forEach(function (t) {
        var e = t.e || {};
        if (e.six) Object.keys(e.six).forEach(function (k) { six[k] = (six[k] || 0) + e.six[k]; });
        if (e.items) Object.keys(e.items).forEach(function (k) { items[k] = (items[k] || 0) + e.items[k]; });
        if (e.stone) stone += e.stone;
        if (e.zeroStone) zeroStone = true;
      });
      if (zeroStone) stone = 0;

      /* 功法：开局匹配技 + 铁布衫 + 吐纳术，均 1 级 */
      var firstElem = this.linggen.elems[0];
      var skills = {};
      [G.Data.startSkillByElem[firstElem], '铁布衫', '吐纳术'].forEach(function (id) {
        skills[id] = { lv: 1 };
      });
      var equip = [G.Data.startSkillByElem[firstElem]];

      /* 轮回殿灌注：把上一世积累的仙力兑现成开局资源。
         body 不在这里处理——它由 Player.computeStats 直接读 meta.perfusion.body。 */
      var pf = meta.perfusion || {};
      var addQi = (pf.qi || 0) * 120;
      var addPo = (pf.po || 0) * 12;
      var addStone = (pf.stone || 0) * 60;
      var addRescue = pf.rescue || 0;

      var save = {
        life: life, worldSeed: seed, world: world,
        origin: og.id, six: six,
        linggen: this.linggen, talents: talentIds,
        skills: skills, skillEquip: equip,
        items: items, stone: stone + addStone, qi: 100 + addQi, po: addPo,
        globalLevel: 1, age: 1,
        watch: 0, whispers: 0, escapeLeft: 3 + addRescue,
        quest: { step: 'childhood', flags: {} },
        scene: 'childhood', map: null, pos: null,
        chestsOpened: [], bossKilled: false,
        /* 仙力结算与寿元（轮回 v0.4 §3.2 / §4） */
        maxGlobalLevel: 1, bossKills: 0, chronicle: [], _ageTick: 0,
        childhood: { randomDrawn: [], log: [] }
      };

      if (addQi || addPo || addStone || addRescue || (pf.body || 0)) {
        var gains = [];
        if (pf.body) gains.push('仙躯 Lv' + pf.body);
        if (addQi) gains.push('灵气 +' + addQi);
        if (addPo) gains.push('灵力 +' + addPo);
        if (addStone) gains.push('灵石 +' + addStone);
        if (addRescue) gains.push('遁走 +' + addRescue);
        G.game.toast('仙力灌注：' + gains.join('　'));
      }
      G.Storage.saveCurrent(save);
      G.game.save = save;
      /* 新世界的调色板是随机取的（非锚世），地面纹理的缓存键里带调色板 ——
         不预热的话，玩家进第一张地图时要现场烘 10 张 224² 纹理（约 110~145ms），
         表现就是"进图卡一下"。这里提前在后台烘掉：接下来还要走幼年场景
         （读事件文本、点几下），时间足够。 */
      if (G.Art.warmup) G.Art.warmup(world.pal);
      G.game.changeScene('childhood');
    },

    onTap: function (p) {
      if (this.step === 'origin') {
        for (var i = 0; i < origins.length; i++) {
          var r = this._originRect(i);
          if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
            this.originSel = i;
            this._buildButtons();
            break;
          }
        }
      }
    },

    _originRect: function (i) {
      var w = 104, gap = 12, x = gap + i * (w + gap);
      return { x: x, y: 66, w: w, h: 158 };
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      var bg = x.createLinearGradient(0, 0, 0, 272);
      bg.addColorStop(0, '#0c1020'); bg.addColorStop(1, '#141a2e');
      x.fillStyle = bg; x.fillRect(0, 0, 480, 272);

      if (this.step === 'origin') this.renderOrigin(x);
      else if (this.step === 'linggen') this.renderLinggen(x);
      else this.renderTalents(x);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _header: function (x, title, hint) {
      G.UI.text(x, { x: 16, y: 14 }, title, 18, G.UI.C.goldHi);
      G.UI.text(x, { x: 16, y: 40 }, hint, 12, G.UI.C.textDim);
    },

    renderOrigin: function (x) {
      this._header(x, '第 ' + ((G.game.meta.past.length || 0) + 1) + ' 世 · 降世出身',
        '你将以何种身份降生？（出身影响六维与开局之物）');
      for (var i = 0; i < origins.length; i++) {
        var r = this._originRect(i), sel = i === this.originSel;
        G.UI.panel(x, r, sel ? '#20263c' : '#151a2a',
          sel ? G.UI.C.gold : G.UI.C.line);
        G.UI.text(x, { x: r.x + r.w / 2, y: r.y + 16 }, origins[i].n, 16,
          sel ? G.UI.C.goldHi : G.UI.C.text, 'center');
        for (var d = 0; d < origins[i].d.length; d++) {
          G.UI.text(x, { x: r.x + 12, y: r.y + 56 + d * 22 }, origins[i].d[d], 13,
            G.UI.C.textDim);
        }
      }
    },

    renderLinggen: function (x) {
      this._header(x, '天道推演 · 灵根', '灵根决定功法匹配与灵气、灵石加成，可无限重随直至锁定');
      var lg = this.linggen;
      if (!lg) return;

      var r = { x: 60, y: 66, w: 360, h: 130 };
      G.UI.panel(x, r, '#131828');
      G.UI.text(x, { x: r.x + 18, y: r.y + 14 },
        lg.kind === '四象' ? '四象灵根（天灵）' : '五行灵根 · ' +
        ['', '单灵根', '双灵根', '三灵根', '四灵根', '五灵根'][lg.elems.length],
        17, lg.kind === '四象' ? G.UI.C.goldHi : G.UI.C.text);

      /* 属性圆牌 */
      var cx0 = r.x + 30;
      for (var i = 0; i < lg.elems.length; i++) {
        var e = lg.elems[i], info = elemInfo[e];
        var cy = r.y + 58 + i * 0, cxx = cx0 + i * 52;
        x.fillStyle = info.c;
        x.beginPath(); x.arc(cxx, r.y + 62, 17, 0, 6.2832); x.fill();
        x.fillStyle = '#10131f';
        x.font = '16px KaiTi, serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(info.n, cxx, r.y + 63);
      }

      /* 系数 */
      var coefText = lg.elems.map(function (e) {
        return e + '系功法 ×' + lg.coef[e].toFixed(1);
      }).join('　');
      G.UI.text(x, { x: r.x + 18, y: r.y + 92 }, coefText, 12, G.UI.C.textDim);
      var stT = '灵石获取 ' + (lg.stoneBonus > 0 ? '+' + Math.round(lg.stoneBonus * 100) + '%' : '无加成');
      G.UI.text(x, { x: r.x + 18, y: r.y + 110 }, stT, 12, G.UI.C.textDim);
    },

    renderTalents: function (x) {
      var meta = G.game.meta;
      this._header(x, '天道赐福 · 先天禀赋',
        '仙力 ' + meta.xianli + '　｜　可耗 30 仙力重随；怜悯 ' + (meta.pity || 0) + '%');
      var w = 130, gap = 22;
      for (var i = 0; i < this.talentCards.length; i++) {
        var t = this.talentCards[i];
        var r = { x: gap + i * (w + gap), y: 66, w: w, h: 150 };
        var border = { '仙': G.UI.C.gold, '上': '#a98ce0', '良': '#6f9fc8', '凡': '#565b6e' }[t.t];
        G.UI.panel(x, r, '#141927', border);
        G.UI.text(x, { x: r.x + 10, y: r.y + 10 },
          { '仙': '仙品', '上': '上品', '良': '良品', '凡': '凡品' }[t.t], 11, border);
        G.UI.text(x, { x: r.x + r.w / 2, y: r.y + 34 }, t.n, 17,
          t.t === '仙' ? G.UI.C.goldHi : G.UI.C.text, 'center');
        var lines = G.UI.wrap(x, t.d, 12, r.w - 20);
        for (var l = 0; l < lines.length; l++) {
          G.UI.text(x, { x: r.x + 10, y: r.y + 70 + l * 18 }, lines[l], 12, G.UI.C.textDim);
        }
      }
    }
  };

  G.scenes.reincarnation = scene;
})();
