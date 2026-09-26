/* 底部功能栏 + 六个常驻面板（v0.8.0）
 *
 * 背景：这六项（角色/功法/秘术/任务/储物/成就）原先全塞在「菜单」二级页里，
 * 每次要点两下才能到，而且是"探索途中最高频的操作"。现在拆出来常驻底栏、一键直达；
 * 「菜单」这一页随之删除 —— 顶栏右上角只剩「设置」（天道模型 / 界域难度 / 关于）。
 *
 * 三条约束：
 *   ① 底栏高度 = Explore.BOT_H，探索场景的 onTap 靠它挡掉误触（同 HUD_H 的道理）；
 *   ② 面板内**也画底栏**，六个面板可直接互相切换，不必先退回探索；
 *   ③ 新增面板只改这里的 PANELS 表 + 一个 draw 函数，路由不用动
 *      （各场景的 renderOverlay 统一走 G.Overlays.isPanel / renderPanel）。
 */
(function () {
  /* 内容面板：底栏占 y 244..272，所以面板底边收到 240 为止 */
  var P = { x: 12, y: 26, w: 456, h: 212 };
  var BAR_Y = 244, BAR_H = 28;

  var WN = { fan: '凡界', ling: '灵界', xian: '仙界', dao: '道界' };
  var ST_NAME = { '麻': '麻痹', '毒': '中毒', '烧': '灼烧', '封': '封印' };

  /* 道具说明：battle.js 的 CONSUM 只管战斗内消耗，杂货铺的 SHOP_ITEMS 只管在售，
     两边都不全。这里是"背包视角"的唯一说明表。 */
  var ITEM_D = {
    '回春丹': '回复四成气血',
    '大还丹': '回复七成五气血',
    '聚气散': '灵气 +500',
    '醒神散': '解除异常状态',
    '解毒丹': '解除中毒',
    '甘霖丹': '解除灼烧',
    '舒筋丹': '解除麻痹',
    '解封符': '解除封印',
    '淬体突破丹': '大境界突破所需',
    '妖丹': '杂货铺回收，15 灵石 / 枚'
  };
  /* 可在面板里直接使用的道具（战斗外的即时收益） */
  var ITEM_USE = {
    '回春丹': { heal: 0.40 }, '大还丹': { heal: 0.75 }, '聚气散': { qi: 500 }
  };

  /* M0 主线链：与 town/field/cave/battle 里的判定一一对应。
     改任务链时**两处都要改** —— 这里只是给玩家看的文案，不做判定。 */
  var QUEST = {
    'm0-1': { t: '拜入药铺', d: '往翠微山打赢一头妖兽，再回镇复命', f: 'won1', fd: '已胜一场' },
    'm0-2': { t: '雪夜山神庙', d: '入翠微山破庙，取回那件东西', f: 'templeDone', fd: '已得逆命珠' },
    'm0-3': { t: '珠内点化', d: '入逆命珠内空间打坐，消化机缘', f: 'dream', fd: '已受点化' },
    'm0-4': { t: '破境备丹', d: '修至淬体九段，回镇向沈伯取淬体突破丹', f: 'gotBreakPill', fd: '已得丹' },
    'm0-5': { t: '赤牙洞 · 狼王', d: '修至炼气三重，入赤牙洞斩赤炎狼王', f: null, fd: '' },
    'free': { t: '逍遥世间', d: '主线已了，可四处历练、刷秘境、寻界门飞升', f: null, fd: '' }
  };
  var QUEST_ORDER = ['m0-1', 'm0-2', 'm0-3', 'm0-4', 'm0-5', 'free'];

  /* ============================================================
     底栏
     ============================================================ */
  var PANELS = [
    { id: 'char', n: '角色' },
    { id: 'skills', n: '功法' },
    { id: 'secrets', n: '秘术' },
    { id: 'quest', n: '任务' },
    { id: 'bag', n: '储物' },
    { id: 'achieve', n: '成就' }
  ];

  var IDS = {};
  PANELS.forEach(function (p) { IDS[p.id] = 1; });

  /* 底栏按钮：六个等宽页签。active 传当前面板 id 时该项高亮。 */
  function barBtns(scene, active) {
    var w = 75, gap = 3, x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
    return PANELS.map(function (p, i) {
      var on = (p.id === active);
      return new G.UI.Btn({
        x: Math.round(x0 + i * (w + gap)), y: BAR_Y + 3, w: w, h: BAR_H - 6,
        small: true, variant: 'tab', active: on, label: p.n,
        onClick: function () {
          /* 点当前页 = 收起（回到探索），省一个"关闭"按钮 */
          if (on) { scene.clearOverlay(); return; }
          G.Overlays.openPanel(scene, p.id);
        }
      });
    });
  }

  function renderBar(x, active) {
    x.fillStyle = 'rgba(7,9,15,0.94)';
    x.fillRect(0, BAR_Y, 480, 272 - BAR_Y);
    x.fillStyle = 'rgba(216,183,104,0.20)';
    x.fillRect(0, BAR_Y, 480, 0.8);
    var w = 75, gap = 3, x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
    PANELS.forEach(function (p, i) {
      if (p.id !== active) return;
      x.fillStyle = 'rgba(216,183,104,0.75)';
      x.fillRect(Math.round(x0 + i * (w + gap)) + 5, BAR_Y + 2, w - 10, 1.4);
    });
  }

  /* 角色面板的子页签（总览 / 灵根 / 属性 / 境界）——排在标题带右侧，
     给右上角的关闭钮留出位置（几何来自 overlays.js，单一真相源）。 */
  function buildCharTabs(btns, scene) {
    var g = G.Overlays.CHAR_TAB_GEOM;
    var cur = scene.charTab || 'overview';
    G.Overlays.CHAR_TABS.forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: g.x0 + i * (g.w + g.gap), y: g.y, w: g.w, h: g.h,
        small: true, variant: 'subtab', active: cur === t.id, label: t.n,
        onClick: function () {
          scene.charTab = t.id;
          G.Overlays.openPanel(scene, 'char');
        }
      }));
    });
  }

  function openPanel(scene, id) {
    if (!IDS[id]) return;
    var prev = scene.overlay;
    scene.overlay = id;
    /* 角色面板有子页签：**从别处切进来**时回到「总览」，
       面板内点页签（prev 已是 char）则保留当前子页 —— 否则每次点页签都跳回总览。 */
    if (id === 'char' && prev !== 'char') scene.charTab = 'overview';
    var btns = [];
    if (id === 'skills') buildSkills(btns, scene);
    if (id === 'bag') buildBag(btns, scene);
    if (id === 'char') buildCharTabs(btns, scene);
    barBtns(scene, id).forEach(function (b) { btns.push(b); });
    /* 关闭钮：六个面板统一加（含角色面板，它的面板矩形不同，故取各自的外框）。 */
    btns.push(closeBtn(scene, id === 'char' ? G.Overlays.CHAR_PANEL : P));
    scene.buttons = btns;
  }

  /* ============================================================
     通用壳
     ============================================================ */
  /* 关闭钮：面板右上角一个**矢量**叉（v0.11.0）。
     以前只有"再点一次当前页签"这一种收起方式，等于没有可见的关闭入口 ——
     玩家在面板里找不到出口（截图反馈）。底栏页签的"点自己收起"保留，两条路都能走。 */
  var CLOSE = { w: 22, h: 20 };

  function closeBtn(scene, R) {
    return new G.UI.Btn({
      x: R.x + R.w - 6 - CLOSE.w, y: R.y + 5, w: CLOSE.w, h: CLOSE.h,
      small: true, variant: 'ghost', glyph: 'close',
      onClick: function () { scene.clearOverlay(); }
    });
  }

  function shell(x, title, right) {
    G.Overlays.dim(x);
    G.UI.frame(x, P, null, { paper: true });
    G.UI.textOut(x, { x: P.x + 14, y: P.y + 6 }, title, 15, G.UI.C.goldHi);
    /* 右栏数值**必须让开关闭钮**（钮占 P.x+P.w-28 .. P.x+P.w-6）——
       原先右端贴到 P.x+P.w-14，正好压在钮上（panels.bounds.contract 会报"文字压在按钮上"）。 */
    if (right) G.UI.textOut(x, { x: P.x + P.w - 38, y: P.y + 9 }, right, 11, G.UI.C.textDim, 'right');
    G.UI.divider(x, 240, P.y + 30, P.w - 56, 'rgba(216,183,104,0.18)');
  }

  /* 分节小标题：**实现统一在 overlays.js**（`G.Overlays.sec`），这里只转发 ——
     两处各写一份的话，改个颜色/字号就会漂。 */
  function sec(x, sx, sy, t) {
    G.Overlays.sec(x, sx, sy, t);
  }

  function empty(x, sx, sy, t) {
    G.UI.text(x, { x: sx, y: sy }, t, 12, G.UI.C.textDim);
  }

  /* 状态标记（完成 / 进行中 / 未开始）：一律**矢量绘制**。
     ⚠ 不要改回 '✓' / '▶' 这类字符：字体是系统回退（工程里没有 @font-face），
     缺字会渲染成空心方框（豆腐块），而且换机器/换浏览器表现不一致 ——
     这种"看着像占位符"的失败是静默的，截图里才发现。
     cy 传**文字行的垂直中心**（G.UI.text 的 y 是 top，故调用处写 y + 字号/2）。 */
  function mark(x, cx, cy, state) {
    if (state === 'done') {
      x.save();
      x.strokeStyle = G.UI.C.jadeHi; x.lineWidth = 1.5; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(cx - 2.8, cy); x.lineTo(cx - 0.9, cy + 2.2); x.lineTo(cx + 3.0, cy - 2.6);
      x.stroke(); x.restore(); return;
    }
    if (state === 'now') {
      x.save(); x.fillStyle = G.UI.C.goldHi;
      x.beginPath();
      x.moveTo(cx - 2.4, cy - 3.2); x.lineTo(cx + 2.8, cy); x.lineTo(cx - 2.4, cy + 3.2);
      x.closePath(); x.fill(); x.restore(); return;
    }
    x.save(); x.fillStyle = G.UI.C.textDim;
    x.beginPath(); x.arc(cx, cy, 1.3, 0, 6.2832); x.fill(); x.restore();
  }

  /* ============================================================
     一、功法（境界 / 突破 / 功法精进）
     ============================================================ */
  function buildSkills(btns, scene) {
    var save = G.game.save;
    var bs = G.Player.breakState(save);
    btns.push(new G.UI.Btn({
      x: P.x + P.w - 152, y: P.y + 40, w: 138, h: 24, small: true,
      variant: bs.ready ? 'gold' : 'default',
      label: bs.big ? '突破 · 问心魔劫' : '突破 · ' + (bs.next ? bs.next.n : '已至绝顶'),
      disabled: !bs.ready,
      onClick: function () { G.Overlays.doBreak(scene); }
    }));

    Object.keys(save.skills).slice(0, 5).forEach(function (id, i) {
      var sd = G.Data.skills[id] || { n: id };
      var lv = save.skills[id].lv;
      var cost = G.Player.skillCost(sd, lv);
      btns.push(new G.UI.Btn({
        x: P.x + P.w - 96, y: P.y + 94 + i * 21, w: 82, h: 19, small: true,
        label: '精进 ' + cost, disabled: save.po < cost,
        onClick: function () {
          save.po -= cost; save.skills[id].lv += 1;
          G.Storage.saveCurrent(save);
          G.game.toast(sd.n + ' 精进至 Lv' + save.skills[id].lv);
          G.Overlays.openPanel(scene, 'skills');
        }
      }));
    });
  }

  function drawSkills(x) {
    var save = G.game.save;
    var st = G.Player.computeStats(save);
    var bs = G.Player.breakState(save);
    var ri = G.Player.realmInfo(save.globalLevel);
    shell(x, '功　法', '灵力 ' + Math.floor(save.po));

    /* 境界与突破 */
    sec(x, P.x + 14, P.y + 44, '境 界');
    G.UI.textOut(x, { x: P.x + 60, y: P.y + 38 }, ri.n, 15, G.UI.C.goldHi);
    var pr = bs.need ? Math.min(1, bs.have / bs.need) : 1;
    G.UI.text(x, { x: P.x + 14, y: P.y + 62 }, '灵气', 10.5, G.UI.C.textDim);
    G.UI.bar(x, { x: P.x + 44, y: P.y + 63, w: 108, h: 7 }, pr,
      bs.ready ? '#f5e3a8' : G.UI.C.qi);
    G.UI.textOut(x, { x: P.x + 158, y: P.y + 62 },
      bs.ready ? '可突破' : (bs.have + ' / ' + bs.need), 10.5,
      bs.ready ? G.UI.C.jadeHi : G.UI.C.textDim);

    /* 功法列表（表头在 y+82，数据从 y+96 起 —— 两者绝不能压在一起） */
    sec(x, P.x + 14, P.y + 80, '功 法');
    G.UI.text(x, { x: P.x + 200, y: P.y + 82 }, '属性', 10, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 262, y: P.y + 82 }, '等级', 10, G.UI.C.textDim);
    var ids = Object.keys(save.skills);
    if (!ids.length) empty(x, P.x + 14, P.y + 96, '尚无功法');
    ids.slice(0, 5).forEach(function (id, i) {
      var sd = G.Data.skills[id];
      var lv = save.skills[id].lv;
      var y = P.y + 96 + i * 21;
      G.UI.text(x, { x: P.x + 14, y: y }, sd ? sd.n : id, 12,
        sd && sd.tier === '仙' ? G.UI.C.goldHi : G.UI.C.text);
      if (sd) {
        G.UI.text(x, { x: P.x + 200, y: y + 1 }, sd.elem, 10.5,
          (G.Data.elem && G.Data.elem.color[sd.elem]) || G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 262, y: y }, 'Lv' + lv, 11, G.UI.C.textDim);
      }
    });

    /* 属性速览（右侧空列） */
    var sy = P.y + 100;
    [['攻击', st.atk], ['防御', st.def], ['气血', st.maxhp], ['速度', st.spd]]
      .forEach(function (r, i) {
        G.UI.text(x, { x: P.x + 300, y: sy + i * 17 }, r[0], 10.5, G.UI.C.textDim);
        G.UI.textOut(x, { x: P.x + 340, y: sy + i * 17 }, String(r[1]), 10.5, G.UI.C.text, 'right');
      });

    G.UI.text(x, { x: P.x + 14, y: P.y + 196 },
      '「精进」消耗灵力（战斗所得）；大境界需先服突破丹。', 10, G.UI.C.textDim);
  }

  /* ============================================================
     二、秘术
     ============================================================ */
  function secretDesc(id, grade) {
    var e = G.Data.dungeons.SECRET_EFFECTS[id];
    if (!e) return '—';
    var g = grade || 1;
    var pct = function (v) { return Math.round(v * g * 100) + '%'; };
    if (e.cat === '圣') {
      var parts = [];
      if (e.atk) parts.push('攻击 +' + pct(e.atk));
      if (e.def) parts.push('防御 +' + pct(e.def));
      if (e.hp) parts.push('气血 +' + pct(e.hp));
      if (e.spd) parts.push('速度 +' + pct(e.spd));
      return '圣术 · ' + parts.join('　');
    }
    if (e.cat === '神') {
      if (e.vamp) return '神术 · 攻击吸血 ' + pct(e.vamp);
      if (e.kurong) return '神术 · ' + Math.round(e.kurong.chance * 100) + '% 枯荣（每层 −'
        + Math.round(e.kurong.pct * 100) + '%，至多 ' + e.kurong.max + ' 层）';
      if (e.zhuxie) return '神术 · ' + Math.round(e.zhuxie * 100) + '% 概率诛邪（驱散增益）';
      if (e.mangshan) return '神术 · 芒山聚灵（每回合回灵 ×' + e.mangshan + '）';
      if (e.startShield) return '神术 · 开场护盾 ' + pct(e.startShield);
      return '神术';
    }
    if (e.cat === '仙') {
      var c = e.cast || {};
      if (c.target === 'self') {
        return '仙术 · 每场一次：回复自身 ' + Math.round((c.healSelf || 0) * 100) + '% 气血';
      }
      return '仙术 · 每场一次：' + (c.target === 'all' ? '全体' : '单体') + ' '
        + Math.round((c.mult || 0) * 100) + '% 威力'
        + (c.status ? '（' + (ST_NAME[c.status.t] || c.status.t) + ' '
          + Math.round(c.status.chance * 100) + '%）' : '');
    }
    return '—';
  }

  function drawSecrets(x) {
    var save = G.game.save;
    var Dg = G.Data.dungeons;
    var all = Object.keys(Dg.SECRETS);
    var have = save.secrets || {};
    var owned = all.filter(function (id) { return have[id]; });
    shell(x, '秘　术', '已习 ' + owned.length + ' / ' + all.length);

    if (!owned.length) {
      empty(x, P.x + 14, P.y + 44, '尚未习得任何秘术。');
      G.UI.text(x, { x: P.x + 14, y: P.y + 66 },
        '通关秘境（第 5 关或第 9 关）可得该秘境的签名秘术，', 10.5, G.UI.C.textDim);
      G.UI.text(x, { x: P.x + 14, y: P.y + 82 },
        '品阶随所得界域提升：凡品 1 → 灵品 1.5 → 仙品 2 → 道品 2.5。', 10.5, G.UI.C.textDim);
      return;
    }
    owned.slice(0, 7).forEach(function (id, i) {
      var y = P.y + 44 + i * 23;
      var g = Dg.gradeOf(save, id);
      var e = Dg.SECRET_EFFECTS[id] || {};
      var catCol = e.cat === '仙' ? G.UI.C.goldHi
        : (e.cat === '神' ? G.UI.C.jadeHi : G.UI.C.text);
      G.UI.text(x, { x: P.x + 14, y: y }, Dg.SECRETS[id], 12, catCol);
      G.UI.text(x, { x: P.x + 122, y: y + 1 }, '品阶 ' + g, 10, G.UI.C.gold);
      G.UI.text(x, { x: P.x + 186, y: y + 1 }, secretDesc(id, g), 10.5, G.UI.C.textDim);
    });
    if (owned.length > 7) {
      G.UI.text(x, { x: P.x + 14, y: P.y + 206 }, '……另有 ' + (owned.length - 7) + ' 项', 10, G.UI.C.textDim);
    }
  }

  /* ============================================================
     三、任务
     ============================================================ */
  function drawQuest(x) {
    var save = G.game.save;
    var q = save.quest || { step: 'free', flags: {} };
    var cur = QUEST[q.step] || QUEST.free;
    shell(x, '任　务', cur.t);

    var idx = QUEST_ORDER.indexOf(q.step);
    if (idx < 0) idx = QUEST_ORDER.length - 1;

    /* 当前目标 */
    sec(x, P.x + 14, P.y + 42, '当前目标');
    G.UI.text(x, { x: P.x + 14, y: P.y + 60 }, cur.t, 13.5, G.UI.C.goldHi);
    var dl = G.UI.wrap(x, cur.d, 11.5, P.w - 32);
    dl.forEach(function (l, i) {
      G.UI.text(x, { x: P.x + 14, y: P.y + 80 + i * 18 }, l, 11.5, G.UI.C.text);
    });

    /* 链条：**6 步（含 free）必须整条落在面板内**。
       起点由上面目标文案的**实际折行数**推出来（写死会让加一句话就顶穿面板下沿），
       行距 15 → 末行底 ≈ 236，面板底 238，刚好收住。
       注：面板底 = P.y + P.h = 238，链条最多 6 行；改长 QUEST_ORDER 会越界，
       由 smoke 的 panels.bounds.contract 兜住（越界是静默的，不会报错）。 */
    var sy = P.y + 80 + dl.length * 18 + 10;
    var ry = sy + 16;
    sec(x, P.x + 14, sy, '主线进程');
    QUEST_ORDER.forEach(function (id, i) {
      var s = QUEST[id];
      var y = ry + i * 15;
      var state = i < idx ? 'done' : (i === idx ? 'now' : 'todo');
      mark(x, P.x + 18, y + 5.5, state);
      var col = state === 'done' ? G.UI.C.jadeHi
        : (state === 'now' ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.text(x, { x: P.x + 30, y: y }, s.t, 10.5, col);
      var flag = s.f && q.flags && q.flags[s.f];
      if (flag && s.fd) G.UI.text(x, { x: P.x + 150, y: y }, s.fd, 10, G.UI.C.jadeHi);
    });

    G.UI.text(x, { x: P.x + 260, y: ry }, '提示', 11, G.UI.C.gold);
    G.UI.text(x, { x: P.x + 260, y: ry + 18 }, '点地面行走，点人与门交互。', 10, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 260, y: ry + 34 }, '境界满可突破；秘境在底栏「角色」', 10, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 260, y: ry + 50 }, '左侧面板里看属性与功法。', 10, G.UI.C.textDim);
  }

  /* ============================================================
     四、储物
     ============================================================ */
  function buildBag(btns, scene) {
    var save = G.game.save, items = save.items || {};
    var ids = Object.keys(items).filter(function (k) { return items[k] > 0; });
    ids.forEach(function (k, i) {
      if (!ITEM_USE[k]) return;
      btns.push(new G.UI.Btn({
        x: P.x + P.w - 92, y: P.y + 44 + i * 22, w: 78, h: 19, small: true,
        label: '使用', disabled: !canUse(k),
        onClick: function () { useItem(scene, k); }
      }));
    });
  }

  function canUse(k) {
    var save = G.game.save;
    var u = ITEM_USE[k];
    if (!u) return false;
    if (u.heal) {
      var st = G.Player.computeStats(save);
      return save.hp < st.maxhp;
    }
    if (u.qi) return true;
    return false;
  }

  function useItem(scene, k) {
    var save = G.game.save;
    var u = ITEM_USE[k];
    if (!u || !save.items[k]) return;
    if (u.heal) {
      var st = G.Player.computeStats(save);
      if (save.hp >= st.maxhp) { G.game.toast('气血已满'); return; }
      save.hp = Math.min(st.maxhp, Math.round(save.hp + st.maxhp * u.heal));
      G.game.toast(k + '　气血回复');
    } else if (u.qi) {
      save.qi = (save.qi || 0) + u.qi;
      G.game.toast(k + '　灵气 +' + u.qi);
    }
    save.items[k] -= 1;
    if (save.items[k] <= 0) delete save.items[k];
    G.Storage.saveCurrent(save);
    G.Overlays.openPanel(scene, 'bag');
  }

  function drawBag(x) {
    var save = G.game.save, items = save.items || {};
    var ids = Object.keys(items).filter(function (k) { return items[k] > 0; });
    shell(x, '储　物', '灵石 ' + (save.stone || 0));

    if (!ids.length) {
      empty(x, P.x + 14, P.y + 44, '囊中空空。');
      G.UI.text(x, { x: P.x + 14, y: P.y + 66 },
        '杂货铺可购丹药；妖丹可回收换灵石。', 10.5, G.UI.C.textDim);
      return;
    }
    ids.slice(0, 8).forEach(function (k, i) {
      var y = P.y + 44 + i * 22;
      G.UI.text(x, { x: P.x + 14, y: y }, k, 12, G.UI.C.text);
      G.UI.textOut(x, { x: P.x + 132, y: y + 1 }, '×' + items[k], 11, G.UI.C.gold, 'right');
      G.UI.text(x, { x: P.x + 148, y: y + 1 }, ITEM_D[k] || '—', 10.5, G.UI.C.textDim);
    });
  }

  /* ============================================================
     五、成就
     ============================================================ */
  /* 成就：**两列**排布。
     单列 9 行 × 21px 会从 P.y+44 一路排到 238（= 面板底），
     既顶穿下沿、又正好压在底部「称号」行上（218）—— 两列 5 行 × 26px 收在 194 以内。
     每格两行：① 标记 + 名称 + 仙力（右对齐）；② 说明。 */
  function drawAchieve(x) {
    var m = G.game.meta || {};
    var got = m.achieve || {};
    var ALL = G.Player.ACHIEVE || [];
    var A = ALL.slice(0, 10);                    /* 两列 × 5 行 = 10 格 */
    var n = ALL.filter(function (a) { return got[a.id]; }).length;
    shell(x, '成　就', '已达成 ' + n + ' / ' + ALL.length);

    var colW = Math.floor((P.w - 34) / 2);       /* 左右各留 14，中间 6 缝 */
    var rowH = 26, y0 = P.y + 42;
    A.forEach(function (a, i) {
      var cx = P.x + 14 + (i % 2) * (colW + 6);
      var cy = y0 + Math.floor(i / 2) * rowH;
      var ok = !!got[a.id];
      mark(x, cx + 4, cy + 6.5, ok ? 'done' : 'todo');
      G.UI.text(x, { x: cx + 14, y: cy }, a.n, 11, ok ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.textOut(x, { x: cx + colW, y: cy + 1 },
        (ok ? '已得 ' : '') + '+' + a.xianli + ' 仙力', 10,
        ok ? G.UI.C.gold : G.UI.C.textDim, 'right');
      G.UI.text(x, { x: cx + 14, y: cy + 13 }, a.d, 9.5,
        ok ? G.UI.C.text : G.UI.C.textDim);
    });
    if (ALL.length > A.length) {
      G.UI.text(x, { x: P.x + 14, y: y0 + 5 * rowH }, '……另有 ' + (ALL.length - A.length) + ' 项', 10,
        G.UI.C.textDim);
    }

    var ty = P.y + P.h - 20;
    G.UI.divider(x, 240, ty - 8, P.w - 28, 'rgba(216,183,104,0.18)');
    var titles = (m.titles && m.titles.length) ? m.titles.join(' · ') : '无';
    G.UI.text(x, { x: P.x + 14, y: ty }, '称号', 11, G.UI.C.textDim);
    /* 右端让开右上角关闭钮（同 shell 的道理） */
    G.UI.textOut(x, { x: P.x + P.w - 38, y: ty - 0.5 }, titles, 11,
      m.titles && m.titles.length ? G.UI.C.goldHi : G.UI.C.textDim, 'right');
  }

  /* ============================================================
     分发
     ============================================================ */
  var DRAW = {
    /* 角色面板要读 scene.charTab（子页签），所以把 scene 透传下去 */
    char: function (x, scene) { G.Overlays.renderChar(x, scene); },
    skills: drawSkills,
    secrets: drawSecrets,
    quest: drawQuest,
    bag: drawBag,
    achieve: drawAchieve
  };

  function renderPanel(x, scene) {
    var fn = DRAW[scene.overlay];
    if (!fn) return false;
    fn(x, scene);
    renderBar(x, scene.overlay);
    return true;
  }

  G.Overlays.PANELS = PANELS;
  G.Overlays.PANEL_RECT = P;
  G.Overlays.BAR_Y = BAR_Y;
  G.Overlays.BAR_H = BAR_H;
  G.Overlays.isPanel = function (name) { return !!IDS[name]; };
  G.Overlays.barBtns = barBtns;
  G.Overlays.renderBar = renderBar;
  G.Overlays.openPanel = openPanel;
  G.Overlays.renderPanel = renderPanel;
  G.Overlays.secretDesc = secretDesc;
})();
