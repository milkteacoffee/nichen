/* 死亡结算（轮回转世 v0.4 §3 / §4）：
   死因 + 享年 → 一世走马灯 → 仙力入账明细 → 写入轮回档案 → 入轮回殿 */
(function () {
  var MAX_CHRONICLE = 8;          /* 走马灯最多 8 条（§3.3） */

  var scene = {
    smooth: true,
    t: 0,
    rec: null,
    embers: [],

    enter: function () {
      var save = G.game.save || {};
      var meta = G.game.meta;
      if (!meta) {
        meta = {
          lives: 0, xianli: 0, totalXianli: 0,
          perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
          pity: 0, achieve: {},
          heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
          past: []
        };
        G.game.meta = meta;
      }
      if (!meta.perfusion) meta.perfusion = { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 };
      if (!meta.past) meta.past = [];
      if (!meta.achieve) meta.achieve = {};

      var gl = save.maxGlobalLevel || save.globalLevel || 1;
      var age = save.age || 16;
      /* 六维已整体删除：账目改记「最终攻击」，它是玩家真正感知到的强度指标 */
      var st = G.Player.computeStats(save);
      var ri = G.Player.realmInfo(gl);
      var stone = save.stone || 0;
      var boss = !!save.bossKilled;

      /* 仙力结算（v0.4 §4）：明细由 Player.xianliOf 统一产出，
         它同时负责把 meta.achieve 的一次性成就标为已发放。 */
      var d = G.Player.xianliOf(save, meta);
      var xianli = d.total;

      var life = (meta.past.length || 0) + 1;
      var rec = {
        life: life, age: age, realm: ri.n, level: gl,
        atk: st.atk, maxhp: st.maxhp, stone: stone, boss: boss,
        xianli: xianli, detail: d, cause: d.cause, causeName: d.causeName,
        chronicle: (save.chronicle || []).slice(-MAX_CHRONICLE),
        at: Date.now()
      };
      this.rec = rec;
      this.t = 0;

      meta.lives = (meta.lives || 0) + 1;
      meta.xianli = (meta.xianli || 0) + xianli;
      meta.totalXianli = (meta.totalXianli || 0) + xianli;

      /* 跨世记忆：本世摘要压入天道记忆（v2.7，最近 30 世；
         状态包只取最近 10 条）；注视值累计入总账 */
      var hv = meta.heaven;
      hv.memory = hv.memory || [];
      hv.memory.push({
        life: rec.life, realm: rec.realm, level: rec.level, cause: rec.causeName
      });
      if (hv.memory.length > 30) hv.memory.shift();
      hv.watchTotal = (hv.watchTotal || 0) + (save.watch || 0);

      meta.past.push(rec);
      if (meta.past.length > 60) meta.past.shift();
      G.Storage.saveMeta(meta);

      /* 当世档到此为止 */
      G.Storage.clearCurrent();
      G.game.save = null;

      /* 余烬 */
      this.embers = [];
      for (var i = 0; i < 28; i++) {
        this.embers.push({
          x: G.rng.range(0, 480), y: G.rng.range(-40, 272),
          v: G.rng.range(9, 28), r: G.rng.range(0.7, 2.0),
          ph: G.rng.range(0, 6.283), a: G.rng.range(0.25, 0.75)
        });
      }

      this.buttons = [
        new G.UI.Btn({
          x: 366, y: 232, w: 98, h: 26, small: true, variant: 'gold',
          label: '入轮回殿', onClick: function () { G.game.changeScene('hall'); }
        }),
        new G.UI.Btn({
          x: 16, y: 232, w: 86, h: 26, small: true, variant: 'ghost',
          label: '返回标题', onClick: function () { G.game.changeScene('title'); }
        })
      ];
    },

    update: function (dt) {
      this.t += dt;
      for (var i = 0; i < this.embers.length; i++) {
        var e = this.embers[i];
        e.y -= e.v * dt;
        e.x += Math.sin(this.t * 1.4 + e.ph) * 9 * dt;
        if (e.y < -10) { e.y = 282; e.x = G.rng.range(0, 480); }
      }
    },

    /* 背景：素材优先（bg.death），缺省走程序化 */
    _bg: function () {
      var im = G.Assets.img('bg.death');
      if (im) return im;
      if (this._bgc) return this._bgc;
      var o = G.Art.cv(480, 272), bx = o.x;
      var g = bx.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#06070d');
      g.addColorStop(0.62, '#0d0a12');
      g.addColorStop(1, '#1a0d12');
      bx.fillStyle = g; bx.fillRect(0, 0, 480, 272);
      var glow = bx.createRadialGradient(240, 250, 20, 240, 250, 220);
      glow.addColorStop(0, 'rgba(180,60,50,0.22)');
      glow.addColorStop(1, 'rgba(180,60,50,0)');
      bx.fillStyle = glow; bx.fillRect(0, 0, 480, 272);
      this._bgc = o.c;
      return o.c;
    },

    render: function (x) {
      var rec = this.rec;
      if (!rec) return;

      x.drawImage(this._bg(), 0, 0, 480, 272);

      /* 余烬 */
      for (var i = 0; i < this.embers.length; i++) {
        var e = this.embers[i];
        var a = e.a * (0.55 + 0.45 * Math.sin(this.t * 2.2 + e.ph));
        x.fillStyle = 'rgba(224,150,96,' + a.toFixed(3) + ')';
        x.beginPath(); x.arc(e.x, e.y, e.r, 0, 6.2832); x.fill();
      }

      /* 标题 + 死因 */
      G.UI.textOut(x, { x: 240, y: 10 }, '一 世 终 结', 23, '#f0dcae', 'center', 'rgba(0,0,0,0.75)', 3.4);
      G.UI.divider(x, 240, 38, 200, 'rgba(216,183,104,0.45)');
      var aged = rec.cause === 'aged';
      G.UI.text(x, { x: 240, y: 42 },
        rec.causeName + '　·　享年 ' + rec.age + ' 岁', 12,
        aged ? G.UI.C.goldHi : G.UI.C.textDim, 'center');

      /* 左栏：一世账目 */
      var L = { x: 16, y: 58, w: 200, h: 148 };
      G.UI.frame(x, L, null, { paper: true });
      G.UI.text(x, { x: L.x + 12, y: L.y + 9 }, '一 世 账 目', 11.5, G.UI.C.gold);
      G.UI.divider(x, L.x + L.w / 2, L.y + 26, L.w - 24, 'rgba(216,183,104,0.28)');

      var ly = L.y + 32;
      function kv(yy, k, v, col) {
        G.UI.text(x, { x: L.x + 12, y: yy }, k, 11.5, G.UI.C.textDim);
        G.UI.textOut(x, { x: L.x + L.w - 12, y: yy - 0.5 }, v, 12.5,
          col || G.UI.C.text, 'right');
      }
      /* 行距 20（原 23）：多出的第六行放「称号」，地狱通关该界的永久所得（缺口 G15） */
      kv(ly, '转世之数', '第 ' + rec.life + ' 世', G.UI.C.goldHi);
      kv(ly + 20, '陨落境界', rec.realm);
      kv(ly + 40, '最终攻击', String(rec.atk));
      kv(ly + 60, '遗留灵石', String(rec.stone));
      kv(ly + 80, '斩杀首领', rec.boss ? '已斩' : '未斩',
        rec.boss ? G.UI.C.gold : G.UI.C.textDim);
      var titles = (G.game.meta && G.game.meta.titles) || [];
      kv(ly + 100, '称　　号', titles.length ? titles.join('·') : '—',
        titles.length ? G.UI.C.goldHi : G.UI.C.textDim);

      /* 右栏：仙力入账明细（§4 逐项） */
      var R = { x: 232, y: 58, w: 232, h: 148 };
      G.UI.frame(x, R, null, { paper: true });
      G.UI.text(x, { x: R.x + 12, y: R.y + 9 }, '仙 力 入 账', 11.5, G.UI.C.gold);
      G.UI.divider(x, R.x + R.w / 2, R.y + 26, R.w - 24, 'rgba(216,183,104,0.28)');

      var d = rec.detail;
      var rows = [
        ['境界仙力', '10 × L' + rec.level, d.realm],
        ['功法仙力', '2 × Σ功法等级', d.skill],
        ['击杀仙力', '30 × ' + Math.round(d.kill / 30) + ' 次', d.kill],
        ['年岁仙力', '（' + rec.age + '−15）× 2', d.age],
        ['轮回成就', d.achieveList.length ? '共 ' + d.achieveList.length + ' 项' : '—', d.achieve]
      ];
      var ry = R.y + 32;
      rows.forEach(function (r) {
        G.UI.text(x, { x: R.x + 12, y: ry }, r[0], 11, G.UI.C.text);
        G.UI.text(x, { x: R.x + 60, y: ry + 1 }, fit(x, r[1], 9, 126), 9, G.UI.C.textDim);
        G.UI.textOut(x, { x: R.x + R.w - 12, y: ry - 1 }, '+' + r[2], 11.5,
          r[2] > 0 ? G.UI.C.text : G.UI.C.textDim, 'right');
        ry += 13;
      });
      G.UI.divider(x, R.x + R.w / 2, ry + 1, R.w - 24, 'rgba(216,183,104,0.22)');

      /* 轮回成就逐项列出（明细行只放数量，名字放这里才写得下） */
      if (d.achieveList.length) {
        G.UI.text(x, { x: R.x + 12, y: ry + 5 },
          fit(x, d.achieveList.map(function (a) { return a.n; }).join('·'), 8.5, 208),
          8.5, G.UI.C.gold);
      }

      /* 合计行贴住面板内底：标签 12px、数字 20px，数字顶对齐在 ry+20 */
      var tail = '此生所悟' + (d.mul !== 1 ? '（善终 ×' + d.mul.toFixed(1) + '）' : '');
      G.UI.text(x, { x: R.x + 12, y: ry + 24 }, tail, 12, G.UI.C.textDim);
      G.UI.textOut(x, { x: R.x + R.w - 12, y: ry + 20 }, '+' + d.total, 20,
        G.UI.C.goldHi, 'right', 'rgba(0,0,0,0.7)', 3);

      /* 一世走马灯（§3.3，8 条以内）：最多两行，按「大事」为断点换行，末行截断补省略号 */
      var ch = rec.chronicle || [];
      if (ch.length) {
        var SEP = '　·　';
        var parts = ch.map(function (c) { return c.t + '岁 ' + c.s; });
        x.font = G.UI.F(10);
        var lines = [], cur = '';
        parts.forEach(function (p) {
          var cand = cur ? cur + SEP + p : p;
          if (cur && x.measureText(cand).width > 452) { lines.push(cur); cur = p; }
          else cur = cand;
        });
        if (cur) lines.push(cur);
        if (lines.length > 2) {
          lines = lines.slice(0, 2);
          var last = lines[1];
          while (last.length > 1 && x.measureText(last + '…').width > 452) {
            last = last.slice(0, -1);
          }
          lines[1] = last + '…';
        }
        var cy = lines.length > 1 ? 205 : 211;
        lines.forEach(function (l, i) {
          G.UI.text(x, { x: 240, y: cy + i * 12 }, l, 10, G.UI.C.textDim, 'center');
        });
      }

      /* 暗角 */
      var vg = x.createRadialGradient(240, 136, 110, 240, 136, 320);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.62)');
      x.fillStyle = vg; x.fillRect(0, 0, 480, 272);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    }
  };

  /* 按可用宽度截断文本（超长时补省略号），避免文字压出面板 */
  function fit(x, str, size, maxW) {
    x.font = G.UI.F(size);
    if (x.measureText(str).width <= maxW) return str;
    var s = str;
    while (s.length > 1 && x.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  G.scenes.death = scene;
})();
