/* 剧情系统（《剧情打磨与天道至恶设计 v1.0》）：
   轮回记忆碎片 · 故人羁绊 · 死亡封印 · 境界触发忆起 · 轮回图鉴 · 主线/结局旗标。
   纯本地、跨世 Meta（存 meta）；全局弹层由 game.js 主循环统一驱动。 */
(function () {

  /* ===== 故人谱（pid → {name,rel,sw(封于第几界 0凡1灵2仙3道),note}） ===== */
  var PEOPLE = [
    { pid: 'jiang',   name: '姜老药师', rel: '爷爷·养父', sw: 0, note: '采药老人，拾婴抚养，授以草药吐纳。' },
    { pid: 'wanqing', name: '晚晴（阿蘅）', rel: '青梅', sw: 0, note: '约好同看山外，那夜被夺魂，生死不见尸。' },
    { pid: 'shenbo',  name: '沈伯', rel: '药铺掌柜·隐世散修', sw: 0, note: '受姜老恩惠，暗中照拂，递来血煞背后另有其人的线索。' },
    { pid: 'aqi',     name: '阿七', rel: '血煞外堂守门人', sw: 0, note: '被裹挟的苦命人，留之或为后世内应。' },
    { pid: 'xuemian', name: '血面', rel: '血煞外堂堂主·眼前仇人', sw: 0, note: '临死狂言：让我们来的……在天上。' },
    { pid: 'agent',   name: '天道代行者', rel: '缉魂仙官·巡游神将·化身', sw: 1, note: '天道借刀之手，逐级现身，逐级揭底。' }
  ];

  /* ===== 记忆碎片（id → {sw 封于界, gl 当世达此 gl 可忆, kind, title, text, chars}） ===== */
  var F = [
    { id: 'f01', sw: 0, gl: 1,   kind: 'event', title: '火光', text: '漫天火光里，一只手把你死死护在怀里；耳畔半句含糊的约定，听不真切。', chars: [] },
    { id: 'f02', sw: 0, gl: 37,  kind: 'thing', title: '草药篓', text: '你想起一只磨得发亮的草药篓，篓沿刻着歪歪的“姜”字。', chars: ['jiang'] },
    { id: 'f03', sw: 0, gl: 37,  kind: 'person', title: '阿蘅', text: '一个名字自尘嚣里浮起——阿蘅。她笑说，要一起去看山外的世界。', chars: ['wanqing'] },
    { id: 'f04', sw: 0, gl: 73,  kind: 'event', title: '那夜的轮廓', text: '黑袍人踏火而来的轮廓渐次清晰，他们不是山贼，行的是你不懂的术法。', chars: [] },
    { id: 'f05', sw: 0, gl: 73,  kind: 'thing', title: '血煞标记', text: '一面血色煞纹的旗。你终于记起——是血煞教。', chars: [] },
    { id: 'f06', sw: 0, gl: 109, kind: 'event', title: '沈伯的暗示', text: '沈伯当年那句没说完的话：“这镇上的水……比你想得深。”', chars: ['shenbo'] },
    { id: 'f07', sw: 0, gl: 109, kind: 'event', title: '在天上', text: '血面倒下去时狂笑：“你以为杀我便完了？让我们来的……在天上！”', chars: ['xuemian'] },
    { id: 'f08', sw: 0, gl: 145, kind: 'person', title: '故人面容·爷爷', text: '神魂初成的刹那，姜老药师的面容清清楚楚——他扑向你的那一瞬，没有半分犹豫。', chars: ['jiang'] },
    { id: 'f09', sw: 0, gl: 145, kind: 'person', title: '故人面容·晚晴', text: '晚晴回首，唇瓣翕动，似在唤你；一道天外之力却将她的魂魄生生抽离。', chars: ['wanqing'] },
    { id: 'f10', sw: 0, gl: 253, kind: 'event', title: '天外冷眼', text: '那夜的云幕之上，垂着一只无悲无喜的冷眼，静静俯瞰这一场杀戮。', chars: [] },
    { id: 'f11', sw: 0, gl: 325, kind: 'thing', title: '法旨虚影', text: '火光深处浮起一道无字法旨，血煞教众见之，如奉纶音。', chars: [] },
    { id: 'f12', sw: 1, gl: 361, kind: 'thing', title: '缉魂法旨', text: '灵界遍传“缉拿异魂”之旨，仙官神将循味追索——那追索的，正是你。', chars: [] },
    { id: 'f13', sw: 1, gl: 361, kind: 'event', title: '魂魄去向', text: '你得知晚晴当年是被“抽魂”，魂魄被天上取去，镇了因果。', chars: ['wanqing'] },
    { id: 'f14', sw: 1, gl: 397, kind: 'event', title: '法旨来自天上', text: '代行者败退时吐露：血煞教那一夜的法旨，来自天上。幕后，是天道。', chars: ['agent'] },
    { id: 'f15', sw: 2, gl: 541, kind: 'event', title: '斩羁绊之谋', text: '前尘尽复：每一世亲友之死并非偶然，是天道为逼你道心崩溃，精准斩断你的牵挂。', chars: [] },
    { id: 'f16', sw: 2, gl: 541, kind: 'event', title: '道心抉择', text: '它不怕你变强，只怕你有人可念。你攥紧拳——斩情独上，还是守念逆天？', chars: [] },
    { id: 'f17', sw: 3, gl: 577, kind: 'thing', title: '逆命珠来历', text: '道界残碑前，逆命珠微鸣：它是这秩序里唯一不属因果之物，也是你轮回的锚。', chars: [] },
    { id: 'f18', sw: 3, gl: 613, kind: 'event', title: '与天道的因果', text: '你终于明白，你与它，自第一世火光起，便只剩一局对弈。', chars: [] }
  ];

  var WORLD_IDX = { fan: 0, ling: 1, xian: 2, dao: 3 };
  var ENDINGS = {
    nitan: '斩天道 · 逆天', butian: '合道 · 补天', guiyin: '归隐 · 守人'
  };

  function fragById(id) { for (var i = 0; i < F.length; i++) if (F[i].id === id) return F[i]; return null; }
  function personById(pid) { for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].pid === pid) return PEOPLE[i]; return null; }

  var Story = {
    F: F, PEOPLE: PEOPLE, ENDINGS: ENDINGS,

    /* ===== 结构初始化 / 迁移 ===== */
    ensure: function (meta) {
      if (!meta) return meta;
      if (!meta.memory) meta.memory = { fragments: {}, recalled: [] };
      var mm = meta.memory;
      mm.fragments = mm.fragments || {};
      mm.recalled = mm.recalled || [];
      if (!meta.bonds) meta.bonds = {};
      if (!meta.progress) meta.progress = {};
      if (!meta.progress.story) {
        meta.progress.story = {
          prologue: false, oath: false, lingTruth: false,
          xianTruth: false, daoFight: 0, ending: null
        };
      }
      var st = meta.progress.story;
      if (st.daoFight == null) st.daoFight = 0;
      return meta;
    },

    /* 新游戏开第一世：序章旗标（剧情入口）。 */
    beginLife: function (meta) {
      this.ensure(meta);
      return meta;
    },

    /* ===== 死亡封印：把本界及之前的碎片/故人封入逆命珠 ===== */
    sealLife: function (meta, save, life) {
      this.ensure(meta);
      save = save || {};
      var wId = (meta.progress && meta.progress.activeWorld) || 'fan';
      var wIdx = WORLD_IDX[wId] == null ? 0 : WORLD_IDX[wId];

      var sealed = 0;
      F.forEach(function (fr) {
        if (fr.sw <= wIdx && !meta.memory.fragments[fr.id]) {
          meta.memory.fragments[fr.id] = {
            id: fr.id, life: life, kind: fr.kind, title: fr.title,
            text: fr.text, atGL: fr.gl, chars: fr.chars.slice()
          };
          sealed++;
        }
      });
      PEOPLE.forEach(function (p) {
        if (p.sw <= wIdx && !meta.bonds[p.pid]) {
          meta.bonds[p.pid] = {
            pid: p.pid, name: p.name, rel: p.rel, firstLife: life,
            status: p.pid === 'wanqing' ? '失魂' : (p.pid === 'jiang' ? '亡故' : '未知'),
            note: p.note, meetings: []
          };
        }
      });

      var st = meta.progress.story;
      if (life === 1) { st.prologue = true; st.oath = true; }
      if (wIdx >= 1) st.lingTruth = true;
      if (wIdx >= 2) st.xianTruth = true;
      return { sealed: sealed, world: wId };
    },

    /* ===== 突破/飞升：达境界则“忆起”，入队列弹层 ===== */
    onBreak: function (meta, save, gl) {
      if (!meta || !meta.memory) return [];
      var got = [];
      var self = this;
      F.forEach(function (fr) {
        if (meta.memory.fragments[fr.id]
          && meta.memory.recalled.indexOf(fr.id) < 0 && fr.gl <= gl) {
          meta.memory.recalled.push(fr.id);
          got.push(fr);
          self._queue.push(fr);
          /* 故人首次清晰 → 记一次重逢 */
          fr.chars.forEach(function (pid) {
            if (meta.bonds[pid] && fr.kind === 'person') {
              meta.bonds[pid].meetings.push({ life: (meta.lives || 0) + 1, gl: gl, outcome: '忆起' });
            }
          });
        }
      });
      return got;
    },

    /* 结局登记 */
    setEnding: function (meta, id) {
      this.ensure(meta);
      if (ENDINGS[id]) meta.progress.story.ending = id;
      return id;
    },

    /* 已忆起碎片（按 gl 排序） */
    recalledList: function (meta) {
      var self = this;
      return (meta.memory.recalled || []).map(fragById).filter(Boolean)
        .sort(function (a, b) { return a.gl - b.gl; });
    },

    /* ===== 全局弹层（忆起 + 图鉴），由 game.js 驱动 ===== */
    _queue: [],
    _cur: null,
    _codex: false,
    _tab: 0,           /* 0 记忆 / 1 故人 */
    _page: 0,

    modalOpen: function () { return !!this._cur || this._codex; },
    openCodex: function () { this.ensure(G.game.meta); this._codex = true; this._page = 0; },
    closeCodex: function () { this._codex = false; },

    onTap: function (p) {
      if (this._cur) { this._advance(); return; }
      if (this._codex) this._codexTap(p);
    },

    _advance: function () {
      if (this._queue.length) { this._cur = { fr: this._queue.shift(), t: 0, hold: 0 }; }
      else this._cur = null;
    },

    update: function (dt) {
      if (!this._cur && this._queue.length) this._cur = { fr: this._queue.shift(), t: 0, hold: 0 };
      if (this._cur) {
        this._cur.t += dt; this._cur.hold += dt;
        if (this._cur.hold > 5.5) this._advance();
      }
    },

    render: function (x) {
      if (this._cur) this._renderRecall(x, this._cur);
      else if (this._codex) this._renderCodex(x);
    },

    _renderRecall: function (x, c) {
      var fr = c.fr;
      var aIn = Math.min(1, c.hold * 4), aOut = Math.min(1, (5.5 - c.hold) * 3);
      var a = Math.min(aIn, aOut);
      x.save();
      x.fillStyle = 'rgba(6,8,14,' + (0.72 * a).toFixed(3) + ')';
      x.fillRect(0, 0, 480, 272);
      var PW = 360, PH = 128, bx0 = 60, by0 = 72;
      x.globalAlpha = a;
      G.UI.panel(x, { x: bx0, y: by0, w: PW, h: PH },
        'rgba(12,15,24,0.95)', 'rgba(216,183,104,0.7)', 5, { tex: true });
      G.UI.text(x, { x: 240, y: by0 + 8 }, '忆　起', 11, G.UI.C.gold, 'center');
      G.UI.divider(x, 240, by0 + 26, PW - 60, 'rgba(216,183,104,0.3)');
      G.UI.text(x, { x: 240, y: by0 + 32 }, fr.title, 15, G.UI.C.goldHi, 'center');
      var lines = G.UI.wrap(x, fr.text, 12, PW - 56);
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: 240, y: by0 + 56 + i * 16 }, l, 12, G.UI.C.text, 'center');
      });
      G.UI.text(x, { x: 240, y: by0 + PH - 18 }, '点击继续', 9, G.UI.C.textDim, 'center');
      x.restore();
    },

    _codexTap: function (p) {
      /* 顶部两个 Tab */
      if (p.y >= 18 && p.y <= 40) {
        if (p.x >= 20 && p.x <= 106) { this._tab = 0; this._page = 0; }
        else if (p.x >= 112 && p.x <= 198) { this._tab = 1; this._page = 0; }
        return;
      }
      /* 翻页 */
      if (p.y >= 228 && p.y <= 250) {
        if (p.x >= 300 && p.x <= 360 && this._page > 0) this._page--;
        if (p.x >= 366 && p.x <= 426) this._page++;
        return;
      }
      /* 关闭 */
      if (p.x >= 32 && p.x <= 96 && p.y >= 228 && p.y <= 250) this.closeCodex();
    },

    _renderCodex: function (x) {
      var meta = G.game.meta; if (!meta) { this.closeCodex(); return; }
      x.save();
      x.fillStyle = 'rgba(6,8,14,0.82)';
      x.fillRect(0, 0, 480, 272);
      var P = { x: 16, y: 12, w: 448, h: 248 };
      G.UI.panel(x, P, 'rgba(14,17,26,0.97)', 'rgba(216,183,104,0.6)', 4, { tex: true });
      G.UI.text(x, { x: 240, y: 16 }, '轮 回 图 鉴', 13, G.UI.C.goldHi, 'center');

      /* Tabs */
      this._tabBtn(x, 20, this._tab === 0, '记 忆');
      this._tabBtn(x, 112, this._tab === 1, '故 人');

      var top = 46, bottom = 224, left = 28, right = 452, innerW = right - left;
      x.save();
      x.beginPath(); x.rect(left - 4, top - 2, innerW + 8, bottom - top + 4); x.clip();

      if (this._tab === 0) {
        var list = this.recalledList(meta);
        var blocks = [], y = top;
        list.forEach(function (fr) {
          var lines = G.UI.wrap(x, fr.text, 11, innerW - 8);
          blocks.push({ fr: fr, lines: lines, h: 15 + lines.length * 13 + 6 });
        });
        var totalH = blocks.reduce(function (s2, b) { return s2 + b.h; }, 0);
        var pages = Math.max(1, Math.ceil(totalH / (bottom - top)));
        if (this._page > pages - 1) this._page = pages - 1;
        if (!list.length) {
          G.UI.text(x, { x: 240, y: 120 }, '尚无忆起的记忆——且去破境，前尘自现。', 11, G.UI.C.textDim, 'center');
        } else {
          var yy = top - this._page * (bottom - top);
          blocks.forEach(function (b) {
            if (yy + b.h > top && yy < bottom) {
              G.UI.text(x, { x: left, y: yy }, b.fr.title, 12, G.UI.C.gold);
              b.lines.forEach(function (l, i) {
                G.UI.text(x, { x: left + 4, y: yy + 15 + i * 13 }, l, 11, G.UI.C.text);
              });
            }
            yy += b.h;
          });
        }
      } else {
        var ids = Object.keys(meta.bonds || {});
        var rowH = 40, availH = bottom - top;
        var perPage = Math.max(1, Math.floor(availH / rowH));
        var pPages = Math.max(1, Math.ceil(ids.length / perPage));
        if (this._page > pPages - 1) this._page = pPages - 1;
        if (this._page < 0) this._page = 0;
        if (!ids.length) {
          G.UI.text(x, { x: 240, y: 120 }, '尚无故人入卷。', 11, G.UI.C.textDim, 'center');
        }
        var shownIds = ids.slice(this._page * perPage, this._page * perPage + perPage);
        var yy2 = top;
        shownIds.forEach(function (pid) {
          var b = meta.bonds[pid];
          G.UI.text(x, { x: left, y: yy2 }, b.name, 12, G.UI.C.goldHi);
          G.UI.text(x, { x: left + 120, y: yy2 + 1 }, b.rel + '　·　' + b.status, 10.5, G.UI.C.textDim);
          var ln = G.UI.wrap(x, b.note, 10.5, innerW - 8);
          ln.forEach(function (l, i) { G.UI.text(x, { x: left + 4, y: yy2 + 16 + i * 12 }, l, 10.5, G.UI.C.text); });
          yy2 += rowH;
        });
      }
      x.restore();

      /* 底部：关闭 + 页码 + 翻页 */
      this._footBtn(x, 32, '关 闭');
      G.UI.text(x, { x: 200, y: 233 }, '第 ' + (this._page + 1) + ' 页', 10, G.UI.C.textDim);
      this._footBtn(x, 300, '上一页');
      this._footBtn(x, 366, '下一页');
      x.restore();
    },

    _tabBtn: function (x, x0, on, label) {
      x.save();
      x.fillStyle = on ? 'rgba(216,183,104,0.22)' : 'rgba(20,24,36,0.9)';
      x.strokeStyle = on ? 'rgba(216,183,104,0.8)' : 'rgba(120,130,150,0.4)';
      x.lineWidth = 1;
      x.fillRect(x0, 18, 86, 22); x.strokeRect(x0 + 0.5, 18.5, 85, 21);
      G.UI.text(x, { x: x0 + 43, y: 23 }, label, 11, on ? G.UI.C.gold : G.UI.C.textDim, 'center');
      x.restore();
    },
    _footBtn: function (x, x0, label) {
      x.save();
      x.fillStyle = 'rgba(28,32,46,0.95)';
      x.strokeStyle = 'rgba(216,183,104,0.55)';
      x.lineWidth = 1;
      x.fillRect(x0, 228, 60, 22); x.strokeRect(x0 + 0.5, 228.5, 59, 21);
      G.UI.text(x, { x: x0 + 30, y: 233 }, label, 10, G.UI.C.text, 'center');
      x.restore();
    }
  };

  G.Story = Story;
})();
