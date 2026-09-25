/* 幼年阶段：1-15 岁，天道每年颁布一卡（定数卡 + 随机卡无放回） */
(function () {
  var SIX_KEYS = ['勇猛', '灵巧', '体质', '智力', '魅力'];

  var scene = {
    smooth: true,
    age: 1,
    card: null,
    tw: null,
    seq: null,

    enter: function () {
      var save = G.game.save;
      if (!save) { G.game.changeScene('title'); return; }

      /* 构建 15 年卡序（仅一次） */
      if (!save.childhood || !save.childhood.seq) {
        save.childhood = { seq: this._buildSeq(save), log: [] };
      }
      this.seq = save.childhood.seq;
      this.age = save.age || 1;
      this._showCard();
    },

    _traitIds: function (save) {
      return (save.world && save.world.traits) || [];
    },

    _buildSeq: function (save) {
      var D = G.Data.events;
      var seq = {};
      [1, 5, 10, 15].forEach(function (a) {
        seq[a] = D.fixed[a].id;
      });
      /* 11 个随机年龄，无放回加权抽取 */
      var traitIds = this._traitIds(save);
      var hard = false, good = false;
      traitIds.forEach(function (tid) {
        var t = G.Data.worldTraitById(tid);
        if (t && t.e) {
          if (t.e.eventHard) hard = true;
          if (t.e.eventGood) good = true;
        }
      });
      var pool = D.random.slice();
      var ages = [2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14];
      ages.forEach(function (a) {
        var weights = pool.map(function (c) {
          var w = 1;
          if (c.type === '谶语') w = .7;
          if (hard && c.type === '磨难') w = 1.5;
          if (good && c.type === '磨难') w = .5;
          return w;
        });
        var idx = G.rng.weighted(pool.map(function (c, i) { return { w: weights[i] }; }));
        seq[a] = pool[idx].id;
        pool.splice(idx, 1);
      });
      return seq;
    },

    _findCard: function (id) {
      var D = G.Data.events;
      if (D.fixed[this.age] && D.fixed[this.age].id === id) return D.fixed[this.age];
      for (var i = 0; i < D.random.length; i++) if (D.random[i].id === id) return D.random[i];
      return null;
    },

    _showCard: function () {
      var save = G.game.save;
      this.card = this._findCard(this.seq[this.age]);
      /* 兜底：卡序里没有当前年龄（旧存档、年龄越界、卡池变动）时
         不能直接取 card.text —— 那会让整个场景抛异常白屏。
         这里跳过缺失的年份，走到 15 岁就直接成年。 */
      if (!this.card) {
        if (this.age >= 15) { this._growUp(save); return; }
        this.age += 1;
        save.age = this.age;
        this._showCard();
        return;
      }
      this.tw = new G.UI.Typewriter(this.card.text, 34);
      this.buttons = [];
      G.Storage.saveCurrent(save);
    },

    update: function (dt) {
      if (this.tw && !this.tw.done) this.tw.update(dt);
      if (this.tw && this.tw.done && !this._optsBuilt) this._buildOptions();
    },

    _buildOptions: function () {
      this._optsBuilt = true;
      var self = this;
      this.buttons = [];
      var r = this._cardRect();
      var n = this.card.opts.length;
      var h = 24, gap = 6;
      var totalH = n * h + (n - 1) * gap;
      var y0 = r.y + r.h - totalH - 14;
      this.card.opts.forEach(function (o, i) {
        self.buttons.push(new G.UI.Btn({
          x: r.x + 16, y: y0 + i * (h + gap), w: r.w - 32, h: h,
          label: o.l, small: true, onClick: function () { self._choose(o); }
        }));
      });
    },

    _choose: function (o) {
      var save = G.game.save;
      /* 六维 */
      if (o.six) Object.keys(o.six).forEach(function (k) {
        save.six[k] = (save.six[k] || 0) + o.six[k];
      });
      /* 物品 */
      if (o.items) Object.keys(o.items).forEach(function (k) {
        save.items[k] = (save.items[k] || 0) + o.items[k];
      });
      /* 灵石 */
      if (o.stone) {
        save.stone = Math.max(0, save.stone + o.stone);
      }
      /* 标记/百分比 */
      if (o.flags) o.flags.forEach(function (f) {
        save.quest.flags[f] = true;
        save.bonus = save.bonus || {};
        if (f === '灵气+5%') save.bonus.qi = (save.bonus.qi || 0) + .05;
        if (f === '灵力+5%') save.bonus.po = (save.bonus.po || 0) + .05;
      });
      /* 注视 */
      if (o.watch) save.watch = (save.watch || 0) + o.watch;
      /* 赌斗蛐蛐 */
      if (o.gamble) {
        if (G.rng.next() < .5) { save.stone += 20; G.game.toast('蛐蛐赢了，灵石 +20'); }
        else { save.stone = Math.max(0, save.stone - 10); G.game.toast('蛐蛐输了，灵石 -10'); }
      }

      save.childhood.log.push({ age: this.age, card: this.card.n, choice: o.l });

      if (this.age >= 15) { this._growUp(save); return; }
      this.age += 1;
      save.age = this.age;
      this._optsBuilt = false;
      this._showCard();
    },

    _growUp: function (save) {
      save.age = 16;
      save.scene = 'town'; save.map = 'town';
      save.pos = { x: G.Data.maps.town.spawn.x, y: G.Data.maps.town.spawn.y };
      save.quest.step = 'm0-1';
      /* 仙力结算/寿元所需的当世字段（轮回 v0.4 §3.2 / §4） */
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel || 1);
      save.bossKills = save.bossKills || 0;
      save._ageTick = save._ageTick || 0;
      G.Player.chronicle(save, 'birth', '入世落霞镇');
      G.Storage.saveCurrent(save);
      G.game.changeScene('town');
    },

    onTap: function () {
      if (this.tw && !this.tw.done) this.tw.show();
    },

    _cardRect: function () { return { x: 12, y: 44, w: 300, h: 216 }; },

    render: function (x) {
      var bg = x.createLinearGradient(0, 0, 0, 272);
      bg.addColorStop(0, '#0d1120'); bg.addColorStop(1, '#161c30');
      x.fillStyle = bg; x.fillRect(0, 0, 480, 272);

      /* 顶部：年岁进度 */
      G.UI.text(x, { x: 12, y: 12 }, '第 ' + G.game.save.life + ' 世 · 幼年', 17, G.UI.C.goldHi);
      for (var a = 1; a <= 15; a++) {
        var dx = 150 + (a - 1) * 14;
        x.fillStyle = a < this.age ? G.UI.C.gold : (a === this.age ? G.UI.C.goldHi : '#2a3046');
        x.beginPath(); x.arc(dx, 20, 3, 0, 6.2832); x.fill();
      }
      G.UI.text(x, { x: 372, y: 12 }, this.age + ' 岁', 14, G.UI.C.text);

      /* 主卡 */
      var r = this._cardRect();
      G.UI.panel(x, r, '#131828');
      var typeCol = { '普通': G.UI.C.textDim, '磨难': G.UI.C.danger, '谶语': G.UI.C.gold }[this.card.type];
      G.UI.text(x, { x: r.x + 16, y: r.y + 12 }, this.card.n, 16, G.UI.C.text);
      G.UI.text(x, { x: r.x + r.w - 16, y: r.y + 14 }, this.card.type, 11, typeCol, 'right');

      var shown = this.tw.done ? this.card.text : this.tw.part();
      var lines = G.UI.wrap(x, shown, 14, r.w - 32);
      /* 卡面最多 4 行：再多就会压到下方选项按钮上 */
      var maxLines = 4;
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        var last = lines[maxLines - 1];
        lines[maxLines - 1] = (last.length > 1 ? last.slice(0, -1) : last) + '…';
      }
      for (var l = 0; l < lines.length; l++) {
        G.UI.text(x, { x: r.x + 16, y: r.y + 44 + l * 22 }, lines[l], 14, G.UI.C.text);
      }
      if (!this.tw.done) {
        G.UI.text(x, { x: r.x + r.w - 16, y: r.y + r.h - 20 }, '点击快进', 10, G.UI.C.textDim, 'right');
      }

      /* 右侧：六维与身外物 */
      this.renderSide(x);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    renderSide: function (x) {
      var save = G.game.save;
      var r = { x: 324, y: 44, w: 144, h: 216 };   /* 44..260 */
      G.UI.panel(x, r, '#131828');
      G.UI.text(x, { x: r.x + 12, y: r.y + 10 }, '六维', 13, G.UI.C.gold);
      SIX_KEYS.forEach(function (k, i) {
        G.UI.text(x, { x: r.x + 12, y: r.y + 30 + i * 18 }, k, 12, G.UI.C.textDim);
        G.UI.text(x, { x: r.x + r.w - 12, y: r.y + 30 + i * 18 },
          String(save.six[k] || 0), 12, G.UI.C.text, 'right');
      });
      var y = r.y + 124;
      G.UI.text(x, { x: r.x + 12, y: y }, '灵石 ' + save.stone, 12, G.UI.C.textDim);
      G.UI.text(x, { x: r.x + 12, y: y + 20 }, '物品', 12, G.UI.C.gold);
      var names = Object.keys(save.items), yy = y + 40;
      if (!names.length) {
        G.UI.text(x, { x: r.x + 12, y: yy }, '无', 12, G.UI.C.textDim);
        return;
      }
      /* 面板高度有限：最多列 3 条，多出来的折成"…共 N 种"，避免溢出到屏幕外 */
      var maxRows = 3;
      names.slice(0, maxRows).forEach(function (k, i) {
        if (i === maxRows - 1 && names.length > maxRows) {
          G.UI.text(x, { x: r.x + 12, y: yy }, '…共 ' + names.length + ' 种', 12, G.UI.C.textDim);
        } else {
          G.UI.text(x, { x: r.x + 12, y: yy }, k + ' ×' + save.items[k], 12, G.UI.C.textDim);
        }
        yy += 17;
      });
    }
  };

  G.scenes.childhood = scene;
})();
