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
  /* 面板版式（v0.14.0 参考《烟雨江湖》的卷轴式）：
     外框**左缘留一条竖排标题带**，内容区整体右移 BAND_W。
     ⚠️ 两个矩形别混：
        · `FRAME` 是外框（也是导出给契约的 PANEL_RECT —— 越界判据按外框算）；
        · `P` 是**内容区**（各面板都按 `P.x + N` / `P.y + N` 定位）。
        把 FRAME 当 P 用，所有面板内容会整体右移 34px；
        把 P 当 FRAME 用，外框会缩到内容区（左缘那条带子就露不出来）。 */
  var FRAME = { x: 12, y: 26, w: 456, h: 212 };
  var BAND_W = 34;
  var P = { x: FRAME.x + BAND_W, y: FRAME.y, w: FRAME.w - BAND_W, h: FRAME.h };
  /* 角色组的**功法/秘术**两页与其余子页共用同一个外框（CHAR_PANEL）。
     原先它们用五面板的 FRAME（456×212），比 CHAR_PANEL（392×232）更宽更矮，
     玩家在「境界」与「功法」之间切换时会看到面板忽宽忽窄（截图反馈）。 */
  var SP = G.Overlays.CHAR_BODY;
  var BAR_Y = 244, BAR_H = 28;

  /* 左缘竖排标题带矩形（五面板这一条）。**绘制实现统一在 overlays.js**
     （`G.Overlays.titleBand`）—— 角色面板那条也调它，两处各画一份必然漂。 */
  var BAND = { x: FRAME.x + 6, y: FRAME.y + 8, w: BAND_W - 12, h: FRAME.h - 16 };

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
    '回城符': '返回已到过的城镇（M2 用）',
    '淬体突破丹': '大境界突破所需',
    '筑基丹': '炼气圆满破境筑基所需',
    '妖丹': '杂货铺回收，15 灵石 / 枚',
    /* 功法碎片（v0.14.0）：副本通关与野外刷怪掉落，集满 10 片在「功法」页参悟 */
    '凡品功法碎片': '10 片可在「功法」页参悟一本凡阶功法',
    '灵品功法碎片': '10 片可在「功法」页参悟一本灵阶功法',
    '宝品功法碎片': '10 片可在「功法」页参悟一本宝阶功法'
  };
  /* 可在面板里直接使用的道具（战斗外的即时收益） */
  var ITEM_USE = {
    '回春丹': { heal: 0.40 }, '大还丹': { heal: 0.75 }, '聚气散': { qi: 500 }
  };

  /* 道具图标逻辑名（v0.19.0）：中文道具名 → `item.<id>`。
     取图见 art.js: A.itemIcon（素材优先，缺图按前缀走程序化兜底）。
     新增道具时**两处都要加**：这里的映射 + assets-build.py 的 SIZES。 */
  var ITEM_ICON_ID = {
    '回春丹': 'pill_huichun', '大还丹': 'pill_dahuan', '聚气散': 'pill_juqi',
    '醒神散': 'pill_xingshen', '解毒丹': 'pill_jiedu', '甘霖丹': 'pill_ganlin',
    '舒筋丹': 'pill_shujin', '淬体突破丹': 'pill_cuiti', '筑基丹': 'pill_zhuji',
    '解封符': 'talisman_jiefeng', '回城符': 'talisman_huicheng',
    '妖丹': 'mat_yaodan',
    '凡品功法碎片': 'shard_fan', '灵品功法碎片': 'shard_ling', '宝品功法碎片': 'shard_bao',
    '灵石': 'stone'
  };

  /* M0 主线链：与 town/field/cave/battle 里的判定一一对应。
     改任务链时**两处都要改** —— 这里只是给玩家看的文案，不做判定。 */
  /* 主线表。
     · t / d   标题与目标文案（任务面板与左侧追踪栏共用）
     · f / fd  进度旗标与"已完成"短标
     · g       路引目标 { map, x, y, who } —— 探索场景左侧追踪栏据此画箭头与距离。
               map 是**场景 id**（town / town_shop / field_temple / cave …），
               跨图时追踪栏沿出口与屋门做一次 BFS 找下一跳（见 explore.js: _routeTo）。
               x / y 是格坐标，仅同图时用来算方位与距离；who 是目标显示名。
     · g2      旗标 f 已置位后改用的目标（例：m0-1 打赢一场后要回镇找沈伯）
     · subs    子任务清单 [{ t, f? }]：给了 f 就按旗标判完成，没给只作提示
     路引是**纯提示**，不参与任何判定 —— 删掉 g 只影响显示，不会卡住任务。 */
  var QUEST = {
    'm0-1': { t: '拜入药铺', d: '往翠微山打赢一头妖兽，再回镇复命', f: 'won1', fd: '已胜一场',
      g: { map: 'field', x: 24, y: 32, who: '翠微山 · 前坡' },
      g2: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm0-2': { t: '雪夜山神庙', d: '入翠微山破庙，取回那件东西', f: 'templeDone', fd: '已得逆命珠',
      g: { map: 'field_temple', x: 15, y: 6, who: '山神庙 · 神台' } },
    'm0-3': { t: '珠内点化', d: '入逆命珠内空间打坐，消化机缘', f: 'dream', fd: '已受点化',
      g: { map: 'town_home', x: 14, y: 5, who: '逆命珠（沈家小院）' } },
    'm0-4': { t: '破境备丹', d: '修至淬体九段，回镇向沈伯取淬体突破丹', f: 'gotBreakPill', fd: '已得丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      subs: [{ t: '修至淬体九段' }, { t: '取淬体突破丹', f: 'gotBreakPill' }] },
    'm0-5': { t: '赤牙洞 · 狼王', d: '修至炼气三重，入赤牙洞斩赤炎狼王', f: null, fd: '',
      g: { map: 'cave', x: 16, y: 7, who: '赤牙洞 · 狼王' },
      subs: [{ t: '修至炼气三重' }, { t: '斩赤炎狼王' }] },
    'free': { t: '逍遥世间', d: '狼王已诛，可四处历练、刷秘境、寻界门飞升', f: null, fd: '', g: null },
    /* —— M1 主线（《M1 剧情与内容设计 v1.0》§3/§4）—— */
    'm1-1': { t: '归镇辨丹', d: '把狼王妖丹交给沈伯过目', f: 'bloodDan', fd: '已辨丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm1-2': { t: '外堂探子', d: '镇上来了生面孔，去摸摸他的底', f: 'probe', fd: '已处置',
      g: { map: 'town', x: 25, y: 16, who: '行脚商（刘记旁）' },
      subs: [{ t: '在镇上找到行脚商' }, { t: '处置探子', f: 'probe' }] },
    'm1-3': { t: '沈伯旧账', d: '回药铺，听沈伯讲他的来历', f: 'oldDebt', fd: '已闻旧事',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm1-4': { t: '筑基筹备', d: '修至炼气九段圆满，并取得筑基丹', f: 'foundPill', fd: '已得丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      subs: [{ t: '修至炼气九段' }, { t: '取得筑基丹', f: 'foundPill' }] },
    'm1-5': { t: '血夜', d: '血煞外堂围镇，回药铺与沈伯商议', f: 'bloodNight', fd: '血夜已了',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      g2: { map: 'bloodhall', x: 15, y: 6, who: '血煞外堂 · 血面' },
      subs: [{ t: '入夜 · 血煞外堂' }, { t: '斩执事血面', f: 'bloodNight' }] },
    'm1-6': { t: '筑基心魔劫', d: '血夜后回小院，在逆命珠前服丹筑基', f: 'based', fd: '已筑基',
      g: { map: 'town_home', x: 14, y: 5, who: '逆命珠（沈家小院）' } },
    'm1-7': { t: '离乡', d: '与刘掌柜道别，往云州城去', f: 'leaveTown', fd: '已辞乡',
      g: { map: 'town_market', x: 8, y: 5, who: '刘掌柜（刘记杂货）' } },
    'm1done': { t: '云州在望', d: 'M1 已了，可继续历练、刷秘境、寻界门飞升', f: null, fd: '', g: null }
  };
  var QUEST_ORDER = ['m0-1', 'm0-2', 'm0-3', 'm0-4', 'm0-5', 'free',
    'm1-1', 'm1-2', 'm1-3', 'm1-4', 'm1-5', 'm1-6', 'm1-7', 'm1done'];

  /* ============================================================
     底栏
     ============================================================ */
  /* 底栏五功能（v0.15.0 重构）：
     · **功法 / 秘术并入角色面板的子页**（用户口径："把功法、秘术放到角色面板里面"）——
       仍是独立的面板实现，只是不进底栏；
     · **成就移到游戏外**（开局界面，与设备绑定、跨世只发一次）；
     · 新增 **洞府**（炼丹 / 炼器 / 阵法 / 灵兽）与 **地图**（四界区域导航）。 */
  var PANELS = [
    { id: 'char', n: '角色' },
    { id: 'quest', n: '任务' },
    { id: 'bag', n: '储物' },
    { id: 'sect', n: '宗门' },
    { id: 'cave', n: '洞府' },
    { id: 'map', n: '地图' }
  ];

  var IDS = {};
  PANELS.forEach(function (p) { IDS[p.id] = 1; });
  /* 功法/秘术仍是**可路由**的面板（角色子页签要切过去），只是不进底栏 */
  IDS.skills = 1; IDS.secrets = 1;

  /* 底栏按钮：六个等宽页签。active 传当前面板 id 时该项高亮。 */
  function barBtns(scene, active) {
    /* 页签宽按数量现算：v0.15.0 从 6 项变 5 项，写死 75 会挤在中间一小撮 */
    var gap = 3;
    var w = Math.min(92, Math.floor((480 - 16 - (PANELS.length - 1) * gap) / PANELS.length));
    var x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
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
    /* 页签宽按数量现算：v0.15.0 从 6 项变 5 项，写死 75 会挤在中间一小撮 */
    var gap = 3;
    var w = Math.min(92, Math.floor((480 - 16 - (PANELS.length - 1) * gap) / PANELS.length));
    var x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
    PANELS.forEach(function (p, i) {
      if (p.id !== active) return;
      x.fillStyle = 'rgba(216,183,104,0.75)';
      x.fillRect(Math.round(x0 + i * (w + gap)) + 5, BAR_Y + 2, w - 10, 1.4);
    });
  }

  /* 角色面板的子页签（总览 / 灵根 / 属性 / 境界）——排在标题带右侧，
     给右上角的关闭钮留出位置（几何来自 overlays.js，单一真相源）。 */
  function buildCharTabs(btns, scene, frame, reserve) {
    /* ⚠️ 六个子页签**必须用同一份几何**：原先按"是不是五面板外框"决定要不要留位，
       结果「境界」与「功法」两页的页签起点差 100px —— 玩家在组内切页时页签会跳
       （截图反馈的"功法和其他界面长宽不一致"就是这个观感的一部分）。
       现在整组统一：同一个外框（CHAR_PANEL）+ 同一份左侧保留位（给状态文字）。 */
    var g = G.Overlays.charTabGeom(frame || G.Overlays.CHAR_PANEL, reserve);
    /* 当前子页：功法/秘术由 overlay 决定，其余看 scene.charTab */
    var cur = (scene.overlay === 'skills' || scene.overlay === 'secrets')
      ? scene.overlay : (scene.charTab || 'overview');
    G.Overlays.CHAR_TABS.forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: g.x0 + i * (g.w + g.gap), y: g.y, w: g.w, h: g.h,
        small: true, variant: 'subtab', active: cur === t.id, label: t.n,
        onClick: function () {
          scene.charTab = t.id;
          /* keepTab=true：组内切页，别让 openPanel 把刚设的页重置回总览 */
          G.Overlays.openPanel(scene, t.panel || 'char', true);
        }
      }));
    });
    /* 「境界」子页的突破按钮（v0.11.4）：突破是**角色的事**，放在角色面板最顺，
       原先只在功法页与珠内空间各有一个入口，玩家在角色页看着境界却破不了。
       口径统一走 G.Overlays.doBreak，这里不重写规则；破完仍回到「境界」子页。 */
    if (cur === 'realm') {
      var save = G.game.save;
      var bs = G.Player.breakState(save);
      var B = G.Overlays.CHAR_BREAK;
      btns.push(new G.UI.Btn({
        x: B.x, y: B.y, w: B.w, h: B.h, small: true,
        variant: bs.ready ? 'gold' : 'default',
        label: bs.big ? '突破 · 问心魔劫' : '突破 · ' + (bs.next ? bs.next.n : '已至绝顶'),
        disabled: !bs.ready,
        /* keepTab=true：突破完留在「境界」子页，别弹回总览 */
        onClick: function () { G.Overlays.doBreak(scene, 'char', true); }
      }));
    }
  }

  function openPanel(scene, id, keepTab) {
    if (!IDS[id]) return;
    var prev = scene.overlay;
    scene.overlay = id;
    /* 角色组有子页签：**从别处切进来**时回到「总览」。
       ⚠️ 判据是 `keepTab` 这个显式入参，不是"上一个 overlay 属不属角色组" ——
       子页签点击会**先设 charTab 再调 openPanel**，用后者会把刚设好的页重置掉
       （表现：点「属性」跳回「总览」）。调用方最清楚自己是不是在组内切页。 */
    if (id === 'char' && !keepTab) scene.charTab = 'overview';
    /* 功法面板的下拉：从别处切进来时收起（选中的那本保留，换页签回来还是它） */
    if (id === 'skills' && prev !== 'skills') scene.skillOpen = false;
    var btns = [];
    if (id === 'skills') buildSkills(btns, scene);
    if (id === 'quest') buildQuest(btns, scene);
    if (id === 'bag') buildBag(btns, scene);
    if (id === 'cave') buildCave(btns, scene);
    if (id === 'sect') buildSect(btns, scene);
    if (id === 'map') buildMap(btns, scene);
    /* 角色组三个页共用同一条子页签条。外框按当前页取：
       角色页用 CHAR_PANEL，功法/秘术页用五面板的 FRAME（它们的外框不同）。 */
    if (G.Overlays.isCharGroup(id)) {
      buildCharTabs(btns, scene, G.Overlays.CHAR_PANEL, G.Overlays.TAB_RESERVE);
    }
    /* 底栏高亮：功法/秘术属角色组，高亮落在「角色」上（否则进了这两页底栏一个都不亮） */
    barBtns(scene, G.Overlays.isCharGroup(id) ? 'char' : id).forEach(function (b) { btns.push(b); });
    /* 关闭钮：每个面板统一加（角色页的面板矩形不同，故取各自的外框）。 */
    btns.push(closeBtn(scene, G.Overlays.isCharGroup(id) ? G.Overlays.CHAR_PANEL : FRAME));
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

  function shell(x, title, right, opts) {
    opts = opts || {};
    /* 外框/标题带/内容区可覆盖：角色组的**功法/秘术**两页要跟其余四个子页共用
       CHAR_PANEL（见 SP 的注释），其余面板用五面板的 FRAME。 */
    var frame = opts.frame || FRAME;
    var band = opts.band || BAND;
    var p = opts.p || P;
    G.Overlays.dim(x);
    G.UI.frame(x, frame, null, { tex: true });
    G.Overlays.titleBand(x, band, title);
    if (right) {
      if (opts.left) {
        /* 角色组的右上角被**子页签条**占了 → 状态文字改左对齐，让到页签左边。
           （压上去会变成"文字压在按钮上"，panels.bounds.contract 直接报。） */
        G.UI.textOut(x, { x: p.x + 14, y: frame.y + 9 }, right, 11, G.UI.C.textDim);
      } else {
        G.UI.textOut(x, { x: frame.x + frame.w - 38, y: frame.y + 9 }, right, 11,
          G.UI.C.textDim, 'right');
      }
    }
    /* 顶条分隔线：标题已移到左缘竖带，这里只把顶条与正文分开 */
    G.UI.divider(x, p.x + p.w / 2, frame.y + 30, p.w - 42, 'rgba(216,183,104,0.18)');
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
  /* ============================================================
     二、功法（v0.11.4 改版）
     ─ 删掉顶部的「境界 / 灵气进度」整块：境界是角色面板的事，功法面板重复一遍没意义，
       而且原来的「突破」按钮与角色面板「境界」子页的按钮是同一件事、两个入口。
     ─ 列表改成**下拉选择**：头部一行显示当前选中，点开列出全部（等级降序），
       选中后下方展示该功法的效果、面板贡献与「精进」。
       下拉**展开时不再画详情与精进按钮** —— 两者在 y 上是重叠的，
       而按钮数组的语义是"下标小 = 命中优先、下标大 = 画在上层"，重叠时这两条互相打架，
       必有一处点不到。干脆做成互斥的两个状态（真下拉就是这样）。
     ============================================================ */
  var TIER_RANK = { '凡': 1, '灵': 2, '宝': 3, '玄': 4, '地': 5, '天': 6, '仙': 7 };

  /* 等级最高的排最上面。同级按品阶降序，最后按 id ——
     少了最后一层，同级的几本会随 Object.keys 的顺序漂，每次开面板顺序都在跳。 */
  function skillIdsSorted(save) {
    return Object.keys(save.skills).sort(function (a, b) {
      var la = (save.skills[a] && save.skills[a].lv) || 0;
      var lb = (save.skills[b] && save.skills[b].lv) || 0;
      if (lb !== la) return lb - la;
      var ta = TIER_RANK[(G.Data.skills[a] || {}).tier] || 0;
      var tb = TIER_RANK[(G.Data.skills[b] || {}).tier] || 0;
      if (tb !== ta) return tb - ta;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  /* 下拉头 / 下拉行 / 详情区的几何（渲染与契约共用一份） */
  var SK = {
    head: { x: SP.x + 14, y: SP.y + 40, w: SP.w - 28, h: 24 },
    rowH: 21, maxRows: 6,
    infoY: SP.y + 76,
    secY: SP.y + 96,
    effY: SP.y + 112,
    /* 贡献行上移到 154，给下面那排按钮（172..194）与末行提示（200..210）让位 ——
       原先 184 与按钮同一段 y，只是靠 x 错开；加了「参悟」之后两个按钮并排，
       再靠 x 错开会变成"文字压在按钮上"（panels.bounds.contract 会直接报）。
       ⚠️ 提示行 y + 字号必须 ≤ 面板底 238（SP.y=26 → 偏移上限 202）。 */
    contribY: SP.y + 154,
    btn: { x: SP.x + SP.w - 130, y: SP.y + 172, w: 116, h: 22 },
    /* 参悟按钮（v0.14.0）：与「精进」同一行，落在左半段（原本是空白） */
    shardBtn: { x: SP.x + 14, y: SP.y + 172, w: 152, h: 22 },
    hintY: SP.y + 200
  };
  SK.listY = SK.head.y + SK.head.h + 2;

  function selSkillId(scene, save) {
    var ids = skillIdsSorted(save);
    if (!ids.length) return null;
    /* 没选过 / 选中的已被删掉 → 落回第一条（也就是等级最高的那本） */
    if (ids.indexOf(scene.skillSel) < 0) scene.skillSel = ids[0];
    return scene.skillSel;
  }

  /* 该功法的效果说明（按 kind 分支；与 computeStats 的口径对齐） */
  function skillEffects(sd) {
    if (!sd) return ['—'];
    var out = [];
    var tc = G.Data.tierCoef[sd.tier] || 1;
    if (sd.kind === '攻击') {
      out.push('主动 · 伤害 ×' + sd.mult + (sd.hits > 1 ? '（' + sd.hits + ' 段）' : ''));
      var bits = [];
      if (sd.cd > 0) bits.push('冷却 ' + sd.cd + ' 回合');
      if (sd.hit && sd.hit < 100) bits.push('命中 ' + sd.hit + '%');
      if (sd.target) bits.push('目标 ' + sd.target);
      if (bits.length) out.push(bits.join('　'));
      if (sd.status) {
        out.push('附加「' + (ST_NAME[sd.status.t] || sd.status.t) + '」'
          + Math.round(sd.status.chance * 100) + '%');
      }
      if (sd.healSelf) out.push('吸取伤害的 ' + Math.round(sd.healSelf * 100) + '% 回复气血');
      if (sd.heal) out.push('同时回复 ' + Math.round(sd.heal * 100) + '% 气血');
    } else if (sd.kind === '防御') {
      out.push('被动 · 每级 防御 +' + (3 * tc) + '（品阶系数 ×' + tc + '）');
    } else {
      out.push('被动 · 每级 气血 +' + (20 * tc) + '（品阶系数 ×' + tc + '）');
    }
    if (sd.active) {
      out.push('主动「' + sd.active.n + '」：回复 '
        + Math.round(sd.active.heal * 100) + '% 气血，冷却 ' + sd.active.cd + ' 回合');
    }
    return out;
  }

  /* 该功法当前给面板加了多少（**与 computeStats 同一套系数**，不另写一份公式） */
  function skillContrib(sd, lv, save) {
    var coef = (save.linggen && save.linggen.coef) || {};
    var m = (G.Data.tierCoef[sd.tier] || 1)
      * (sd.elem !== '无' && coef[sd.elem] ? 1.2 : 1) * (coef[sd.elem] || 1);
    if (sd.kind === '攻击') return '攻击 +' + Math.round(lv * 5 * m);
    if (sd.kind === '防御') return '防御 +' + Math.round(lv * 3 * m);
    return '气血 +' + Math.round(lv * 20 * m);
  }

  /* 参悟用哪一档碎片（v0.14.0）：
     够数 → 取**够数里最高**的品阶（宝 > 灵 > 凡）；
     都不够 → 取**持有最多**的那档做展示（玩家一眼知道该刷哪一档，而不是看个空按钮）。 */
  function shardPick(save) {
    var order = ['宝', '灵', '凡'];
    var best = G.Player.bestShardTier(save);
    if (best) return { tier: best, ok: true, have: G.Player.shardCount(save, best) };
    var bt = '凡', bh = -1, any = false;
    order.forEach(function (t) {
      var n = G.Player.shardCount(save, t);
      if (n > 0) any = true;
      if (n > bh) { bh = n; bt = t; }
    });
    /* 一片都没有 → 一律显示「凡品」：玩家最先掉的就是它。
       不这么做的话，三档都是 0 时会显示「宝品（0/10）」—— 新号看着莫名其妙。 */
    if (!any) bt = '凡';
    return { tier: bt, ok: false, have: Math.max(0, bh) };
  }

  function buildSkills(btns, scene) {
    var save = G.game.save;
    var ids = skillIdsSorted(save);
    if (!ids.length) return;
    var sel = selSkillId(scene, save);
    var sd = G.Data.skills[sel] || { n: sel, tier: '凡', elem: '无', kind: '仙术' };
    var lv = save.skills[sel].lv;
    var cost = G.Player.skillCost(sd, lv);

    /* 展开时先把列表压进数组 —— 下标小 = 命中优先，列表要盖住下面的一切 */
    if (scene.skillOpen) {
      ids.slice(0, SK.maxRows).forEach(function (id, i) {
        var d = G.Data.skills[id] || { n: id, elem: '无', tier: '凡' };
        var l = save.skills[id].lv;
        btns.push(new G.UI.Btn({
          x: SK.head.x, y: SK.listY + i * SK.rowH, w: SK.head.w, h: SK.rowH - 1,
          small: true,
          variant: id === sel ? 'gold' : 'battle',
          label: d.n + '　Lv' + l + '　' + (d.elem || '无') + '　' + (d.tier || '凡') + '阶',
          onClick: function () {
            scene.skillSel = id; scene.skillOpen = false;
            G.Overlays.openPanel(scene, 'skills');
          }
        }));
      });
    } else {
      btns.push(new G.UI.Btn({
        x: SK.btn.x, y: SK.btn.y, w: SK.btn.w, h: SK.btn.h, small: true,
        variant: save.po >= cost ? 'gold' : 'default',
        label: '精进 ' + cost + ' 灵力', disabled: save.po < cost,
        onClick: function () {
          save.po -= cost; save.skills[sel].lv += 1;
          G.Storage.saveCurrent(save);
          G.game.toast(sd.n + ' 精进至 Lv' + save.skills[sel].lv);
          G.Overlays.openPanel(scene, 'skills');
        }
      }));
      /* 参悟（v0.14.0）：碎片 → 功法。与「精进」并排（灵力 vs 碎片，两条成长线）。
         展开列表时**不建**这个按钮 —— 列表要盖住下方，留着它会与列表区重叠。 */
      var sp = shardPick(save);
      btns.push(new G.UI.Btn({
        x: SK.shardBtn.x, y: SK.shardBtn.y, w: SK.shardBtn.w, h: SK.shardBtn.h,
        small: true, variant: sp.ok ? 'gold' : 'default',
        label: '参悟 · ' + sp.tier + '品（' + sp.have + '/' + G.Data.shardCost + '）',
        disabled: !sp.ok,
        onClick: function () {
          var r = G.Player.inscribe(save, sp.tier);
          if (!r.ok) { G.game.toast(r.reason); return; }
          G.Storage.saveCurrent(save);
          G.game.toast(r.learned
            ? '参悟得「' + r.name + '」'
            : '「' + r.name + '」精进至 Lv' + r.lv);
          G.Overlays.openPanel(scene, 'skills');
        }
      }));
    }

    /* 下拉头放最后：它只与"列表"相邻（不重叠），与详情区也不重叠。
       当前选中的功法名**写进按钮自己的 label**（而不是在按钮上另画一行字）——
       另画的话会与按钮居中的 label 叠字，panels.bounds.contract 会直接报。 */
    btns.push(new G.UI.Btn({
      x: SK.head.x, y: SK.head.y, w: SK.head.w, h: SK.head.h, small: true,
      variant: scene.skillOpen ? 'gold' : 'default',
      label: scene.skillOpen
        ? '收起列表'
        : sd.n + '　Lv' + lv + '　（共 ' + ids.length + ' 本）',
      onClick: function () {
        scene.skillOpen = !scene.skillOpen;
        G.Overlays.openPanel(scene, 'skills');
      }
    }));
  }

  function drawSkills(x, scene) {
    var save = G.game.save;
    shell(x, '功　法', '灵力 ' + Math.floor(save.po),
      { left: true, frame: G.Overlays.CHAR_PANEL, band: G.Overlays.CHAR_BAND, p: SP });
    var ids = skillIdsSorted(save);

    if (!ids.length) {
      empty(x, SP.x + 14, SP.y + 60, '尚无功法 —— 拜师、拾遗、斩首领皆可得。');
      return;
    }
    var sel = selSkillId(scene, save);
    var sd = G.Data.skills[sel] || { n: sel, tier: '凡', elem: '无', kind: '仙术' };
    var lv = save.skills[sel].lv;
    var COL = (G.Data.elem && G.Data.elem.color) || {};

    /* 下拉头：当前功法名与等级由按钮的 label 承担（见 buildSkills），
       这里只补一个**矢量**展开箭头 —— 不用 '▾' 字符（字体回退会出豆腐块）。 */
    var hb = SK.head;
    x.save();
    x.strokeStyle = G.UI.C.gold; x.lineWidth = 1.6; x.lineCap = 'round';
    var ax = hb.x + hb.w - 34, ay = hb.y + hb.h / 2;
    x.beginPath();
    if (scene.skillOpen) { x.moveTo(ax - 4, ay + 2); x.lineTo(ax, ay - 2.4); x.lineTo(ax + 4, ay + 2); }
    else { x.moveTo(ax - 4, ay - 2); x.lineTo(ax, ay + 2.4); x.lineTo(ax + 4, ay - 2); }
    x.stroke();
    x.restore();

    if (scene.skillOpen) {
      /* 展开态：只画列表（详情/精进按钮此时不存在，见文件头说明）。
         列表外框衬一层底，免得文字直接压在面板的回纹上。 */
      var lh = Math.min(ids.length, SK.maxRows) * SK.rowH;
      G.UI.panel(x, { x: hb.x - 2, y: SK.listY - 2, w: hb.w + 4, h: lh + 3 },
        'rgba(8,11,19,0.94)', 'rgba(216,183,104,0.28)', 4, { tex: false, shadow: false });
      var more = ids.length - SK.maxRows;
      if (more > 0) {
        G.UI.textOut(x, { x: hb.x + hb.w - 10, y: SK.listY + lh + 3 },
          '另有 ' + more + ' 本未列出', 10, G.UI.C.textDim, 'right');
      }
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 202 },
        '点一本即可切换；等级最高的排在最上面。', 10, G.UI.C.textDim);
      return;
    }

    /* ---- 收起态：详情 ---- */
    var info = (sd.tier || '凡') + '阶　' + sd.kind
      + '　属性 ' + (sd.elem || '无') + '　等级 Lv' + lv;
    G.UI.text(x, { x: SP.x + 14, y: SK.infoY }, info, 11.5, G.UI.C.text);

    sec(x, SP.x + 14, SK.secY, '效 果');
    skillEffects(sd).slice(0, 3).forEach(function (t, i) {
      G.UI.text(x, { x: SP.x + 14, y: SK.effY + i * 14 }, t, 10.5, G.UI.C.textDim);
    });

    G.UI.text(x, { x: SP.x + 14, y: SK.contribY }, '本功法贡献', 10.5, G.UI.C.textDim);
    G.UI.text(x, { x: SP.x + 84, y: SK.contribY },
      skillContrib(sd, lv, save), 11, COL[sd.elem] || G.UI.C.jadeHi);

    G.UI.text(x, { x: SP.x + 14, y: SK.hintY },
      '「精进」耗灵力；碎片由副本与野外掉落，10 片参悟一本。', 10, G.UI.C.textDim);
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
    shell(x, '秘　术', '已习 ' + owned.length + ' / ' + all.length,
      { left: true, frame: G.Overlays.CHAR_PANEL, band: G.Overlays.CHAR_BAND, p: SP });

    if (!owned.length) {
      empty(x, SP.x + 14, SP.y + 44, '尚未习得任何秘术。');
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 66 },
        '通关秘境（第 5 关或第 9 关）可得该秘境的签名秘术，', 10.5, G.UI.C.textDim);
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 82 },
        '品阶随所得界域提升：凡品 1 → 灵品 1.5 → 仙品 2 → 道品 2.5。', 10.5, G.UI.C.textDim);
      return;
    }
    owned.slice(0, 7).forEach(function (id, i) {
      var y = SP.y + 44 + i * 23;
      var g = Dg.gradeOf(save, id);
      var e = Dg.SECRET_EFFECTS[id] || {};
      var catCol = e.cat === '仙' ? G.UI.C.goldHi
        : (e.cat === '神' ? G.UI.C.jadeHi : G.UI.C.text);
      G.UI.text(x, { x: SP.x + 14, y: y }, Dg.SECRETS[id], 12, catCol);
      G.UI.text(x, { x: SP.x + 122, y: y + 1 }, '品阶 ' + g, 10, G.UI.C.gold);
      G.UI.text(x, { x: SP.x + 186, y: y + 1 }, secretDesc(id, g), 10.5, G.UI.C.textDim);
    });
    if (owned.length > 7) {
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 206 }, '……另有 ' + (owned.length - 7) + ' 项', 10, G.UI.C.textDim);
    }
  }

  /* ============================================================
     三、任务
     ============================================================ */
  /* ============================================================
     任务（v0.20.0 改版）：主线 / 支线分列 + **列表可点** + 右侧详情
     ------------------------------------------------------------
     旧版把整条主线铺成一张**不可点**的清单，玩家只能"看"不能"选"
     （用户口径：「这些任务必须要能点击，选择任务可以查看任务的详情」）。
     现在：左栏是可点列表，点一下 → 右栏出该任务的详情（目标 / 子任务 / 状态 / 提示）。
     ⚠️ 列表行用 `variant:'plain'`（**只登记命中、不画任何像素**），外观仍由本函数自绘 ——
        换成普通按钮它会自己画底板 + 居中 label，和"状态点 + 标题 + 完成标"的版式冲突。
     ============================================================ */
  /* 详情栏宽度必须**够放一行不折的正文**：`G.UI.wrap` 依赖 `measureText`，而
     无头 smoke 的桩返回"长度 × 7"，对中文严重低估 → 桩里根本不折行，
     `panels.bounds.contract` 按真实字宽一算就判越界。真机虽然会折，但把宽度留够
     可以让"真机"和"契约"两个口径一致（少一类假阳性）。 */
  var QP = {
    tabY: P.y + 30, tabW: 64, tabH: 20, tabGap: 6,
    listX: P.x + 14, listW: 150, listY: P.y + 64, rowH: 15, maxRows: 9,
    detX: P.x + 168, detW: P.w - 182, detY: P.y + 64
  };

  /* 支线（**系统型**）：从已有系统派生、可自动判定完成。
     内容型支线（有 NPC、有剧情）留待后续版本 —— 这里先给"长线目标"清单，
     让玩家在任务面板里看得到"除了主线还能干什么"。 */
  var SIDE = [
    { id: 'sd_dungeon', t: '秘境历练', d: '通关任意一个秘境副本。',
      hint: '底栏「角色」→ 秘境，或地图上的秘境裂隙。',
      done: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; } },
    { id: 'sd_skill', t: '功法小成', d: '习得 3 本功法。',
      hint: '副本掉落、野外刷怪、宗门传功皆可。',
      done: function (s) { return Object.keys(s.skills || {}).length >= 3; } },
    { id: 'sd_zhuji', t: '筑基之路', d: '修至筑基境。',
      hint: '破境需破境丹 + 天劫，见角色面板「境界」子页。',
      done: function (s) { return (s.globalLevel || 1) >= 19; } },
    { id: 'sd_cult', t: '道途之择', d: '拜入宗门，或改换门庭一次。',
      hint: '底栏「宗门」。每世只有一次改换门庭的机会。',
      done: function (s) { return s.cult === 'sect' || !!s.cultSwitchUsed; } }
  ];
  function sideDone(s, it) { try { return !!it.done(s); } catch (e) { return false; } }

  /* 左栏此刻**实际显示**的行 —— drawQuest 与 buildQuest 共用这一份，
     两处各算一次窗口必然分叉（点到的行和看到的行对不上）。 */
  function questRows(save, scene) {
    var tab = scene.questTab || 'main';
    if (tab === 'side') {
      /* 内容型支线（`data/sidequests.js`）：有 NPC、有剧情、各记各的进度。
         旧的"系统型"清单已被取代 —— 那一版没有 NPC 也没有剧情，
         玩家在任务面板里看到的是"秘境历练/功法小成"这种目标，不像任务。 */
      var list = (G.Data.sideQuests ? G.Data.sideQuests.list : []);
      return { rows: list.map(function (q) { return { id: q.id, sq: q }; }), win0: 0, total: list.length };
    }
    var q = save.quest || { step: 'free', flags: {} };
    var idx = QUEST_ORDER.indexOf(q.step);
    if (idx < 0) idx = QUEST_ORDER.length - 1;
    var CAP = QP.maxRows;
    var win0 = 0;
    if (QUEST_ORDER.length > CAP) {
      win0 = Math.max(0, Math.min(idx - Math.floor(CAP / 2), QUEST_ORDER.length - CAP));
    }
    var rows = QUEST_ORDER.slice(win0, win0 + CAP).map(function (id, i) {
      return { id: id, gi: win0 + i, s: QUEST[id] };
    });
    return { rows: rows, win0: win0, total: QUEST_ORDER.length };
  }

  function drawQuest(x, scene) {
    var save = G.game.save;
    var q = save.quest || { step: 'free', flags: {} };
    var tab = scene.questTab || 'main';
    var idx = QUEST_ORDER.indexOf(q.step);
    if (idx < 0) idx = QUEST_ORDER.length - 1;
    var view = questRows(save, scene);
    var selId = scene.questSel || (tab === 'main' ? q.step : SIDE[0].id);
    var sel = null, selGi = -1, selSide = null;
    view.rows.forEach(function (r) {
      if (r.id === selId) { sel = r.s; selGi = r.gi; selSide = r.side; }
    });
    if (!sel && view.rows.length) { sel = view.rows[0].s; selSide = view.rows[0].side; }
    if (!sel) return;

    shell(x, '任　务', tab === 'main' ? '主线' : '支线');

    /* ---- 左栏：可点列表 ---- */
    var chev = function (cx, cy, up) {
      x.save(); x.fillStyle = 'rgba(150,158,180,0.75)';
      x.beginPath();
      if (up) { x.moveTo(cx - 3.4, cy + 1.8); x.lineTo(cx + 3.4, cy + 1.8); x.lineTo(cx, cy - 2.0); }
      else { x.moveTo(cx - 3.4, cy - 1.8); x.lineTo(cx + 3.4, cy - 1.8); x.lineTo(cx, cy + 2.0); }
      x.closePath(); x.fill(); x.restore();
    };
    view.rows.forEach(function (r, i) {
      var on = (r.id === selId);
      var done;
      if (r.sq) {
        done = (G.Data.sideQuests.stepOf(save, r.sq.id) >= 3);
      } else {
        done = (r.gi < idx);
      }
      /* 状态点画在按钮**左侧之外**（按钮矩形从 QP.listX 起）——
         行的标签由按钮自己画（见 buildQuest），面板这边只补这个点。
         行文字不在这里画：画了就会判"面板文字压在按钮上"。 */
      mark(x, QP.listX - 8, QP.listY + i * QP.rowH + 2, done ? 'done' : (on ? 'now' : 'todo'));
    });
    if (tab === 'main') {
      if (view.win0 > 0) chev(QP.listX + QP.listW - 10, QP.listY - 8, true);
      if (view.win0 + QP.maxRows < view.total) {
        chev(QP.listX + QP.listW - 10, QP.listY + view.rows.length * QP.rowH - 2, false);
      }
    }

    /* ---- 右栏：详情 ---- */
    var dx = QP.detX, dy = QP.detY;
    G.UI.text(x, { x: dx, y: dy - 16 }, selSide ? '支线' : '主线', 10, G.UI.C.gold);
    G.UI.text(x, { x: dx, y: dy + 2 }, selSide ? selSide.n : sel.t, 13.5, G.UI.C.goldHi);
    var sideDesc = '';
    if (selSide) {
      var st0 = G.Data.sideQuests.stepOf(save, selSide.id);
      sideDesc = st0 === 0 ? selSide.intro
        : selSide.steps[Math.min(st0, 3) - 1].d;
    }
    var dl = G.UI.wrap(x, selSide ? sideDesc : sel.d, 11, QP.detW);
    dl.slice(0, 3).forEach(function (l, i) {
      G.UI.text(x, { x: dx, y: dy + 22 + i * 15 }, l, 11, G.UI.C.text);
    });
    var by = dy + 22 + Math.min(dl.length, 3) * 15 + 8;

    if (selSide) {
      /* 内容型支线：step 0 未接 / 1 进行中 / 2 可交付 / 3 已完成 */
      var SQ = G.Data.sideQuests;
      var st = SQ.stepOf(save, selSide.id);
      var stN = st === 0 ? '未接取' : (st === 1 ? '进行中' : (st === 2 ? '可交付' : '已完成'));
      G.UI.text(x, { x: dx, y: by }, stN, 11,
        st === 3 ? G.UI.C.jadeHi : (st === 2 ? G.UI.C.goldHi : G.UI.C.gold));
      G.UI.text(x, { x: dx, y: by + 20 }, '提示', 10, G.UI.C.gold);
      var hint = st === 0 ? '去镇上找他说说话。'
        : (st >= 3 ? '此桩已了。' : selSide.steps[st - 1].hint);
      G.UI.wrap(x, hint, 10, QP.detW).slice(0, 2).forEach(function (l, i) {
        G.UI.text(x, { x: dx, y: by + 34 + i * 13 }, l, 10, G.UI.C.textDim);
      });
      return;
    }

    /* 主线详情：子任务（有 f 的按旗标判完成）+ 本步状态。
       ⚠️ 纵向预算只有 SP.h - 64 = 168px，而"目标 2 行 + 子任务 2 条 + 状态 + 提示"
       很容易超 —— 所以**去掉单独的「前往」行**（路引已经指了），提示只留一行。 */
    var subs = sel.subs || [];
    if (subs.length) {
      G.UI.text(x, { x: dx, y: by }, '子任务', 10, G.UI.C.gold);
      subs.slice(0, 2).forEach(function (sb, i) {
        var d2 = !!(sb.f && q.flags && q.flags[sb.f]);
        mark(x, dx + 2, by + 18 + i * 15, d2 ? 'done' : 'todo');
        G.UI.text(x, { x: dx + 14, y: by + 14 + i * 15 }, sb.t, 10,
          d2 ? G.UI.C.jadeHi : G.UI.C.text);
      });
      by += 18 + Math.min(subs.length, 2) * 15 + 6;
    }
    var isCur = (view.rows.some(function (r) { return r.id === selId && r.gi === idx; }));
    G.UI.text(x, { x: dx, y: by }, isCur ? '当前进行中'
      : (selGi >= 0 && selGi < idx ? '已完成' : '未开始'),
      10, isCur ? G.UI.C.gold : G.UI.C.textDim);
    G.UI.text(x, { x: dx, y: by + 20 }, '点左侧任一条可查看详情。', 10, G.UI.C.textDim);
  }

  function buildQuest(btns, scene) {
    var save = G.game.save;
    var q = save.quest || { step: 'free', flags: {} };
    var tab = scene.questTab || 'main';
    var selId = scene.questSel || (tab === 'main' ? q.step : SIDE[0].id);

    /* 页签：主线 / 支线 */
    [{ id: 'main', n: '主线' }, { id: 'side', n: '支线' }].forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: QP.listX + i * (QP.tabW + QP.tabGap), y: QP.tabY, w: QP.tabW, h: QP.tabH,
        small: true, variant: 'subtab', active: tab === t.id, label: t.n,
        onClick: function () {
          scene.questTab = t.id;
          scene.questSel = (t.id === 'main') ? q.step : SIDE[0].id;
          G.Overlays.openPanel(scene, 'quest', true);
        }
      }));
    });

    /* 列表行：**真按钮**（自己画左对齐标签）。
       不能用"面板自绘文字 + plain 命中框" —— 两者的矩形必然重叠，
       `panels.bounds.contract` 直接判"文字压在按钮上"。 */
    questRows(save, scene).rows.forEach(function (r, i) {
      var on = (r.id === selId);
      var done = r.sq ? (G.Data.sideQuests.stepOf(save, r.sq.id) >= 3) : (r.gi < idxOf(q.step));
      btns.push(new G.UI.Btn({
        x: QP.listX, y: QP.listY + i * QP.rowH - 5, w: QP.listW, h: QP.rowH - 1,
        small: true, fs: 10.5, lalign: true,
        variant: on ? 'gold' : 'ghost',
        label: r.sq ? r.sq.n : r.s.t,
        onClick: function () {
          scene.questSel = r.id;
          G.Overlays.openPanel(scene, 'quest', true);
        }
      }));
    });
  }
  function idxOf(step) {
    var i = QUEST_ORDER.indexOf(step);
    return i < 0 ? QUEST_ORDER.length - 1 : i;
  }

  /* ============================================================
     四、储物（v0.11.4 改版：分类子页 + 方格陈列 + 悬浮说明）
     ─ 原先是一张平铺列表（名 / 数量 / 说明各一列），功法、秘术、灵石根本进不来，
       玩家看不到"我一共有些什么"。
     ─ 现在按类分页，每类**独立方格**陈列（8 列 × 3 行 = 24 格），指针停在格上出说明。
       各类的数据来源不同（杂项=save.items 平表 / 功法=save.skills / 灵石=save.stone 标量
       / 秘术=save.secrets / 法宝 M2 才有），所以由 bagCells 逐类取。

     ⚠️ 格子的名称与数量**必须由按钮自己画**（label + sub），不能在 drawBag 里另画：
       `panels.bounds.contract` 会判"文字压在按钮上"，而格子**必须**是可点的按钮
       （点格子即使用），面板体再往上画字必然报错。
       renderPanel 不渲染 scene.buttons，所以按钮自己的 label 不进 textSpy。 */
  var BAG_TABS = [
    { id: 'misc', n: '杂项' },
    { id: 'skill', n: '功法' },
    { id: 'stone', n: '灵石' },
    { id: 'treasure', n: '法宝' },
    { id: 'secret', n: '秘术' }
  ];
  /* 方格几何：8 列 × 3 行，格 46 + 缝 6。
     横向 8*46 + 7*6 = 410 ≤ 内容宽 428；纵向 3*46 + 2*6 = 150（84..234，面板底 238）。 */
  var BG = {
    tabY: P.y + 34, tabW: 62, tabH: 20, tabGap: 6,
    x0: P.x + 14, y0: P.y + 58,
    /* 格宽 46 → 44（v0.14.0）：内容区左沿右移 34 后，8 列 46 会顶出外框右沿。
       8×44 + 7×6 = 394 = 内容可用宽，正好收住。改格宽前先算这条。 */
    cell: 44, gap: 6, cols: 8, rows: 3
  };
  BG.cap = BG.cols * BG.rows;

  /* 逐类取格子：{ n 名称, c 数量/等级, d 悬浮说明, use 可使用则填道具名 } */
  function bagCells(tab, save) {
    var out = [];
    if (tab === 'misc') {
      Object.keys(save.items || {}).forEach(function (k) {
        if (!(save.items[k] > 0)) return;
        out.push({ n: k, c: '×' + save.items[k], d: ITEM_D[k] || '—',
          use: ITEM_USE[k] ? k : null, icon: ITEM_ICON_ID[k] || null });
      });
    } else if (tab === 'skill') {
      skillIdsSorted(save).forEach(function (id) {
        var sd = G.Data.skills[id] || { n: id, tier: '凡', kind: '仙术', elem: '无' };
        /* 宗门与散修互斥：不可用的**保留显示**（玩家要看得见"我曾经会"），
           但数量位改成原因、说明里前置【】标注。 */
        var why = G.Player.skillBlockReason ? G.Player.skillBlockReason(save, id) : null;
        out.push({
          n: sd.n, c: why ? '不可用' : ('Lv' + save.skills[id].lv),
          blocked: !!why,
          d: (why ? '【' + why + '】' : '')
            + (sd.tier || '凡') + '阶 · ' + sd.kind + ' · 属性 ' + (sd.elem || '无')
            + '。精进在底栏「功法」页。'
        });
      });
    } else if (tab === 'stone') {
      out.push({
        n: '灵石', c: save.stone || 0, icon: 'stone',
        d: '下品灵石，通用通货。杂货铺买丹药、妖丹回收、秘境与任务奖励都用它。'
      });
    } else if (tab === 'secret') {
      var Dg = G.Data.dungeons;
      Object.keys(save.secrets || {}).forEach(function (id) {
        var lv = save.secrets[id];
        out.push({
          n: (Dg.SECRETS && Dg.SECRETS[id]) || id,
          c: 'Lv' + lv,
          d: secretDesc(id, lv)
        });
      });
    }
    /* treasure（法宝）M2 才做 —— 不产出任何格子，由 drawBag 出空态文案。
       不做"点了没反应"的僵尸格子。 */
    return out;
  }

  function buildBag(btns, scene) {
    var save = G.game.save;
    var tab = scene.bagTab || 'misc';
    BAG_TABS.forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: BG.x0 + i * (BG.tabW + BG.tabGap), y: BG.tabY, w: BG.tabW, h: BG.tabH,
        small: true, variant: 'subtab', active: tab === t.id, label: t.n,
        onClick: function () {
          scene.bagTab = t.id;
          G.Overlays.openPanel(scene, 'bag');
        }
      }));
    });
    bagCells(tab, save).slice(0, BG.cap).forEach(function (c, i) {
      var gx = BG.x0 + (i % BG.cols) * (BG.cell + BG.gap);
      var gy = BG.y0 + Math.floor(i / BG.cols) * (BG.cell + BG.gap);
      var usable = !!c.use && canUse(c.use);
      btns.push(new G.UI.Btn({
        x: gx, y: gy, w: BG.cell, h: BG.cell, small: true, fs: 10.5,
        variant: usable ? 'battle' : 'default',
        /* 可用 → 点即使用；不可用 → passive（外观正常但点不动） */
        passive: !usable, disabled: !usable,
        label: c.n, sub: c.c, icon: c.icon,
        onClick: function () { if (usable) useItem(scene, c.use); }
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

  function drawBag(x, scene) {
    var save = G.game.save;
    var tab = (scene && scene.bagTab) || 'misc';
    shell(x, '储　物', '灵石 ' + (save.stone || 0));

    var cells = bagCells(tab, save);
    /* 格子本体由按钮画（见文件头说明）；这里只画空态文案与"溢出"提示。
       可用格子的边框由 'battle' 变体给，不可用的走 'default'。 */
    if (!cells.length) {
      empty(x, P.x + 14, BG.y0 + 8,
        tab === 'treasure' ? '法宝尚未开放 —— M2 起可自坊市炼制。'
          : tab === 'skill' ? '尚未习得任何功法。'
            : tab === 'secret' ? '尚未获得任何秘术（秘境首通可得）。'
              : '囊中空空。');
      G.UI.text(x, { x: P.x + 14, y: BG.y0 + 32 },
        tab === 'treasure' ? 'M1 阶段法宝不入库，相关天赋与词条先行保留。'
          : '杂货铺可购丹药；妖丹可回收换灵石。', 10.5, G.UI.C.textDim);
      return;
    }
    var more = cells.length - BG.cap;
    if (more > 0) {
      G.UI.textOut(x, { x: P.x + P.w - 14, y: P.y + 38 },
        '另有 ' + more + ' 件未列出', 10, G.UI.C.textDim, 'right');
    }
    /* 悬浮说明：逐格登记。提示条由 game.js 在帧末统一画（见 ui.js 的 hover 说明）。 */
    cells.slice(0, BG.cap).forEach(function (c, i) {
      var gx = BG.x0 + (i % BG.cols) * (BG.cell + BG.gap);
      var gy = BG.y0 + Math.floor(i / BG.cols) * (BG.cell + BG.gap);
      G.UI.hover({ x: gx, y: gy, w: BG.cell, h: BG.cell },
        { title: c.n + '　' + c.c, text: c.d });
    });
  }

  /* ============================================================
     五、成就
     ============================================================ */
  /* 成就：**两列**排布。
     单列 9 行 × 21px 会从 P.y+44 一路排到 238（= 面板底），
     既顶穿下沿、又正好压在底部「称号」行上（218）—— 两列 5 行 × 26px 收在 194 以内。
     每格两行：① 标记 + 名称 + 仙力（右对齐）；② 说明。 */
  /* 成就页（v0.15.0 移到**游戏外**的开局界面；展示一并富化）。
     口径（用户）：成就与**当前设备/用户 id 绑定**，跨世只发一次；
     所以这页读的是 `meta.achieve`（跨世累积），不是当世 save。
     ⚠️ 从「两列 × 5 行 = 10 格」扩到「三列 × 6 行 = 18 格」：
     v0.15.0 把成就从 9 项加到 18 项，原来的 10 格装不下（多出来的只能写"另有 N 项"）。
     三列宽度：内容宽 394，列宽 (394−16)/3 = 126 —— 够放「名称 + 仙力」一行与说明一行。 */
  function drawAchieve(x) {
    var m = G.game.meta || {};
    var got = m.achieve || {};
    var ALL = G.Player.ACHIEVE || [];
    var n = ALL.filter(function (a) { return got[a.id]; }).length;
    var dev = (G.Storage && G.Storage.deviceId) ? G.Storage.deviceId() : '';
    shell(x, '成　就', '已达成 ' + n + ' / ' + ALL.length);
    /* 设备标识：成就是**跟设备走**的（用户口径），所以这页要把它标出来 ——
       否则玩家换机后看到成就"还在"，会以为成就没跟着存档。 */
    G.UI.text(x, { x: P.x + 14, y: P.y + 32 },
      '本机标识 ' + (dev ? dev.slice(0, 12) : '未知') + '　·　成就与设备绑定，跨世只计一次',
      9.5, G.UI.C.textDim);

    var cols = 3, colW = Math.floor((P.w - 28 - (cols - 1) * 8) / cols);
    /* 行距 24 → 22：6 行的末行说明（+12）会与底部称号区叠上（契约抓到过） */
    var rowH = 22, y0 = P.y + 50;
    ALL.slice(0, cols * 6).forEach(function (a, i) {
      var cx = P.x + 14 + (i % cols) * (colW + 8);
      var cy = y0 + Math.floor(i / cols) * rowH;
      var ok = !!got[a.id];
      mark(x, cx + 4, cy + 5.5, ok ? 'done' : 'todo');
      G.UI.text(x, { x: cx + 14, y: cy }, a.n, 10.5, ok ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.textOut(x, { x: cx + colW, y: cy + 1 },
        (ok ? '' : '') + '+' + a.xianli, 9.5, ok ? G.UI.C.gold : G.UI.C.textDim, 'right');
      G.UI.text(x, { x: cx + 14, y: cy + 12 }, a.d, 9,
        ok ? G.UI.C.text : G.UI.C.textDim);
    });

    /* 称号：分列展示（原来只挤在一行里，称号一多就截断成「破狱·凡尘·破狱…」） */
    var ty = P.y + P.h - 26;
    G.UI.divider(x, P.x + P.w / 2, ty - 8, P.w - 28, 'rgba(216,183,104,0.18)');
    var titles = (m.titles && m.titles.length) ? m.titles : [];
    G.UI.text(x, { x: P.x + 14, y: ty }, '称 号', 11, G.UI.C.textDim);
    G.UI.textOut(x, { x: P.x + P.w - 38, y: ty + 0.5 },
      titles.length ? ('共 ' + titles.length + ' 枚') : '尚无', 10, G.UI.C.textDim, 'right');
    G.UI.text(x, { x: P.x + 74, y: ty }, titles.length ? titles.join(' · ') : '无',
      10.5, titles.length ? G.UI.C.goldHi : G.UI.C.textDim);
    if (!titles.length) {
      G.UI.text(x, { x: P.x + 14, y: ty + 14 },
        '以地狱难度踏破任一界可得称号（全属性 +10%，跨世保留）。', 9.5, G.UI.C.textDim);
    }
  }

  /* ============================================================
     洞府（v0.15.0 新增）：炼丹 / 炼器 / 阵法 / 灵兽 四大技艺的入口。
     设计口径（用户）：常见材料在各地图采集、每日刷新；特殊材料刷怪掉落；
     阵法只能从主城/宗门（分布在隐藏区域）交易；灵兽靠捕兽器在小世界捕捉或主线赠予。
     ⚠️ 本版只落地"入口 + 规则说明 + 主动轮回"：四大技艺的**配方与产出**要等
     玩法方向（半开放世界 vs 固定剧情）定稿后再做，避免先写一套再推翻。
     ============================================================ */
  /* ⚠️ 版位算式（改任何一项都要重算整列）：
     副标题 32..43 → 卡片行1 44..90 → 行2 98..144 → 说明 152..162 / 166..176 → 按钮 184..206。
     内容区底 = P.y + P.h - 10 = 228（按钮底 206，留 22px）。
     原来 cardH=54 / y0=40 时副标题被卡片压住、说明被按钮压住 —— 契约两条判据都报过。 */
  var CV = {
    cardW: 191, cardH: 46, gapX: 12, gapY: 8,
    x0: P.x + 14, y0: P.y + 44,
    noteY: P.y + 152,
    btn: { x: P.x + 14, y: P.y + 184, w: 176, h: 22 }
  };
  /* 四大技艺：id / 名 / 载体 / 一句话规则 */
  var ARTS = [
    { id: 'alchemy', n: '炼丹', by: '丹炉', d: '材料各地采集 · 每日刷新' },
    { id: 'forge', n: '炼器', by: '锻台', d: '配方需先识得，方可炼制' },
    { id: 'array', n: '阵法', by: '阵盘', d: '仅主城与宗门可交易' },
    { id: 'beast', n: '灵兽', by: '兽栏', d: '捕兽器捕捉 · 或主线赠予' }
  ];

  function drawCave(x, scene) {
    var save = G.game.save, meta = G.game.meta || {};
    shell(x, '洞府', '第 ' + (save.life || 1) + ' 世');
    G.UI.text(x, { x: P.x + 14, y: P.y + 32 },
      '丹房 · 器坊 · 阵台 · 兽栏', 11, G.UI.C.textDim);
    ARTS.forEach(function (a, i) {
      var col = i % 2, row = Math.floor(i / 2);
      var bx = CV.x0 + col * (CV.cardW + CV.gapX);
      var by = CV.y0 + row * (CV.cardH + CV.gapY);
      G.UI.panel(x, { x: bx, y: by, w: CV.cardW, h: CV.cardH },
        G.UI.C.panelDark, G.UI.C.rule, 4, { tex: false, shadow: false });
      G.UI.textOut(x, { x: bx + 10, y: by + 7 }, a.n, 13, G.UI.C.goldHi);
      G.UI.text(x, { x: bx + 10 + 30, y: by + 10 }, a.by, 10, G.UI.C.textDim);
      G.UI.text(x, { x: bx + 10, y: by + 26 }, a.d, 9.5, G.UI.C.textDim);
      /* 状态一律"未启"，不画假的进度条 —— 有就有，没有就说没有 */
      G.UI.textOut(x, { x: bx + CV.cardW - 10, y: by + 7 }, '未启', 10,
        'rgba(200,160,110,0.85)', 'right');
    });
    G.UI.text(x, { x: P.x + 14, y: CV.noteY },
      '材料采集与四大技艺的配方将在玩法方向定稿后开启。', 10, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 14, y: CV.noteY + 14 },
      '此世若已无望，可主动坐化，早入轮回。', 10, G.UI.C.textDim);
  }

  function buildCave(btns, scene) {
    /* 主动轮回（v0.15.0）：**两步确认**（点一次进入待确认，再点一次才真的走）。
       不弹独立对话框 —— 那要新开一条 overlay 管线，而"按钮自变文案"已经够表达意图，
       且失败面为零（第二次点击就是确认，没有第三个状态）。
       ⚠️ 触发方式与寿终一致：写 `_cause` 后切 death 场景，**复用同一套结算**
       （仙力明细 / 走马灯 / 轮回档案），不另写一份 —— 两份结算必然漂。 */
    var arm = !!scene.endArm;
    btns.push(new G.UI.Btn({
      x: CV.btn.x, y: CV.btn.y, w: CV.btn.w, h: CV.btn.h, small: true,
      variant: 'danger',
      label: arm ? '再点一次 · 确认坐化' : '坐化 · 主动轮回',
      onClick: function () {
        if (!scene.endArm) { scene.endArm = true; G.Overlays.openPanel(scene, 'cave'); return; }
        var save = G.game.save;
        save._cause = 'self';
        G.Storage.saveCurrent(save);
        G.game.changeScene('death');
      }
    }));
    if (arm) {
      btns.push(new G.UI.Btn({
        x: CV.btn.x + CV.btn.w + 8, y: CV.btn.y, w: 88, h: CV.btn.h, small: true,
        variant: 'battle', label: '再想想',
        onClick: function () { scene.endArm = false; G.Overlays.openPanel(scene, 'cave'); }
      }));
    }
  }

  /* ============================================================
     宗门（《宗门与散修体系设计 v1.0》）
     ------------------------------------------------------------
     · 展示当前阵营 / 宗门 / 位阶 / 贡献（散修时为声望，同一字段两用）
     · 列出本门功法池（已学 / 未学）
     · 拜师（散修 → 宗门）：列出**当前界**的宗门，点一个即入
     · 退门（宗门 → 散修）
     · **每世只有一次**转阵营机会；转阵营把原阵营功法**全部废功**
       （保留条目、不可用，`voided`），并自动卸下已装备的废功功法
     ⚠️ S1 只做"入/退"骨架，入门试炼与贡献任务属 S2（设计 §9）。
     ============================================================ */
  var RANK_N = { outer: '外门', inner: '内门', core: '真传' };
  /* 宗门面板版式（内容区 P 为 y 26..238，底栏从 244 起）：
     · 散修态：说明在 y+138，拜师按钮**两行 × 三列**（y+160 / y+188，22 高 → 236 收住）
     · 宗门态：功法池 4 行（y+108 起、行距 15），底部说明 y+172，退门按钮一行 y+184
     ⚠️ 两态行数不同，所以按钮的 y 也分两套 —— 一套到底会让第二排穿进底栏。 */
  var SEC = {
    freeNoteY: P.y + 138,
    rowY: P.y + 160, row2Y: P.y + 188,
    rowW: 124, rowH: 22, rowGap: 6,
    listY: P.y + 108,
    sectNoteY: P.y + 172
  };
  function sectOf(save) {
    if (!G.Data.sects || !save.sectId) return null;
    return G.Data.sects.byId(save.sectId);
  }
  function drawSect(x, scene) {
    var save = G.game.save || {};
    shell(x, '宗门', '第 ' + (save.life || 1) + ' 世');
    var s = sectOf(save);
    var isSect = (save.cult === 'sect');

    G.UI.text(x, { x: P.x + 14, y: P.y + 32 },
      '当前阵营：' + (isSect ? ((s && s.n) || '宗门弟子') : '散修'), 12, G.UI.C.goldHi);
    G.UI.text(x, { x: P.x + 14, y: P.y + 50 },
      isSect ? ('位阶 ' + RANK_N[save.sectRank || 'outer'] + '　贡献 ' + (save.sectRep || 0))
             : ('散修声望 ' + (save.sectRep || 0)), 11, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 14, y: P.y + 70 },
      isSect ? '宗门功法与散修功法互不相通；本门弟子以贡献兑换本门功法。'
             : '散修功法靠副本与野怪自寻；宗门功法与你无缘。', 10, G.UI.C.textDim);

    /* 功法池：宗门态看"本门"（4 行）；散修态底部让给拜师按钮，不铺功法表 */
    if (isSect) {
      G.UI.text(x, { x: P.x + 14, y: P.y + 92 }, '本门功法', 11, G.UI.C.gold);
      var pool = (s && s.skills) || [];
      pool.slice(0, 4).forEach(function (id, i) {
        var sk = G.Data.skills[id];
        if (!sk) return;
        var own = save.skills && save.skills[id];
        var cost = (sk.tier === '灵') ? 150 : 50;
        var st, col;
        if (own && !own.voided) { st = 'Lv' + own.lv; col = G.UI.C.jadeHi; }
        else if (own && own.voided) { st = '已废功 · 需 ' + cost; col = 'rgba(180,120,120,0.9)'; }
        else { st = '未习 · 需 ' + cost + ' 贡献'; col = G.UI.C.textDim; }
        G.UI.text(x, { x: P.x + 22, y: SEC.listY + i * 15 }, sk.n + '　' + st, 10, col);
      });
      G.UI.text(x, { x: P.x + 14, y: SEC.sectNoteY },
        save.cultSwitchUsed ? '此世已改换门庭一次，来世再议。'
                            : '可递退门帖，转为散修（宗门功法将废功）。', 10, G.UI.C.textDim);
    } else {
      G.UI.text(x, { x: P.x + 14, y: SEC.freeNoteY },
        save.cultSwitchUsed ? '此世已改换门庭一次，来世再议。'
                            : '拜入本界任一宗门（散修功法将废功）。', 10, G.UI.C.textDim);
    }
  }

  function buildSect(btns, scene) {
    var save = G.game.save;
    var isSect = (save.cult === 'sect');

    if (!save.cultSwitchUsed) {
      if (!isSect) {
        /* 拜入：列出**当前界**的宗门（大宗门优先），点一个即**开试炼战**（S2）。
           试炼是一场切磋，胜利才算入门；门槛 = 炼气一段（`Player.trialReady`）。 */
        var wid = G.Player.activeWorldId(G.game.meta);
        var list = (G.Data.sects ? G.Data.sects.ofWorld(wid) : []).slice();
        list.sort(function (a, b) {
          return (a.size === 'big' ? 0 : 1) - (b.size === 'big' ? 0 : 1);
        });
        var ready = G.Player.trialReady(save);
        list.slice(0, 6).forEach(function (s, i) {
          var col = i % 3, row = Math.floor(i / 3);
          btns.push(new G.UI.Btn({
            x: P.x + 14 + col * (SEC.rowW + SEC.rowGap),
            y: (row === 0 ? SEC.rowY : SEC.row2Y),
            w: SEC.rowW, h: SEC.rowH, small: true, fs: 11,
            variant: ready ? 'default' : 'ghost',
            label: '拜入 ' + s.n,
            onClick: function () {
              if (!ready) { G.game.toast('修为不足（需炼气一段），先去历练'); return; }
              scene.clearOverlay();
              G.game.changeScene('battle', {
                script: 'sectTrial', mapId: G.game.sceneName, sectId: s.id
              });
            }
          }));
        });
      } else {
        /* 宗门态：本门功法的**兑换**按钮（每门 2 本，落在功法行右侧） */
        var s2 = sectOf(save);
        var pool = (s2 && s2.skills) || [];
        pool.slice(0, 2).forEach(function (id, i) {
          var sk = G.Data.skills[id];
          if (!sk) return;
          var own = save.skills && save.skills[id];
          var cost = (sk.tier === '灵') ? 150 : 50;
          var can = !(own && !own.voided) && (save.sectRep || 0) >= cost;
          btns.push(new G.UI.Btn({
            x: SP.x + SP.w - 74, y: SEC.listY + i * 15 - 6, w: 70, h: 14,
            small: true, fs: 10,
            variant: can ? 'gold' : 'ghost',
            label: can ? '兑换 ' + cost : '贡献不足',
            onClick: function () {
              var r = G.Player.learnSectSkill(save, id);
              G.game.toast(r.ok ? ('习得《' + sk.n + '》　贡献 -' + r.cost)
                : ('无法兑换：' + r.reason));
              if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
            }
          }));
        });
        btns.push(new G.UI.Btn({
          x: P.x + 14, y: P.y + 184, w: 176, h: 22, small: true, variant: 'danger',
          label: '递退门帖 · 转散修',
          onClick: function () {
            var n = G.Player.switchCult(save, false, null);
            G.Storage.saveCurrent(save);
            G.game.toast('退出门墙　宗门功法废功 ×' + n);
            G.Overlays.openPanel(scene, 'sect', true);
          }
        }));
      }
    }
  }

  /* ============================================================
     地图（v0.15.0 新增）：四界区域导航。
     一屏列全 28 区（4 栏 × 最多 9 行）—— 比"翻页列表"更接近半开放世界的地图观感，
     也不依赖素材。当前所在区域高亮；已到过的区域亮，未至的压暗。
     ============================================================ */
  /* ============================================================
     地图（v0.18.0 改「真地图」）：四界各一张**程序化全貌图**。
     ------------------------------------------------------------
     旧版是"四栏区域列表"（用户口径："现在的地图就是列表，不是真的地图"）。
     新版按《烟雨江湖》的观感做：地形走势（山脉 / 河流 / 林地）+ 区域节点 +
     界门标记，一界一屏。
     ⚠️ 底图**必须预渲染缓存**（每界一张）：上百个山脊 / 河流笔触每帧重画会直接掉帧。
     ⚠️ 地形噪点用**固定种子**（由界 id 派生）—— 用全局 `G.rng` 会每帧都变（画面在闪）。
     ============================================================ */
  var MP = {
    tabY: P.y + 32, tabH: 20, tabW: 64, tabGap: 6,
    vx: P.x + 14, vy: P.y + 58, vw: P.w - 28, vh: P.h - 80
  };
  var WORLD_ORDER = ['fan', 'ling', 'xian', 'dao'];
  /* 每界的地形配色与密度 —— 决定"这一界长什么样"（用户口径：按地图特色出图，
     冰谷 / 岩石地各有各的样）。程序化版先用配色 + 密度区分；出图后整张替换。 */
  var WORLD_TERRAIN = {
    fan: { land: '#39461f', land2: '#2b3617', ridge: '#55663a', ridgeHi: '#6d7f4a',
      water: '#3f6274', trees: 22, peaks: 26, snow: 0 },
    ling: { land: '#16303a', land2: '#0f232c', ridge: '#2c5060', ridgeHi: '#3f6b7e',
      water: '#2f7d9c', trees: 12, peaks: 30, snow: 0.5 },
    xian: { land: '#2c2846', land2: '#201d36', ridge: '#544c74', ridgeHi: '#7a6fa0',
      water: '#4a6a8a', trees: 6, peaks: 34, snow: 0.7 },
    dao: { land: '#1c1234', land2: '#120b24', ridge: '#3a2a5c', ridgeHi: '#5a4488',
      water: '#2a2050', trees: 3, peaks: 20, snow: 0.2 }
  };

  /* 世界地图底图（预渲染缓存，键带界 id 与像素尺寸） */
  var mapBg = {};
  function worldMapBg(w, wpx, hpx) {
    var key = w + '|' + wpx + 'x' + hpx;
    if (mapBg[key]) return mapBg[key];
    var T = WORLD_TERRAIN[w] || WORLD_TERRAIN.fan;
    var o = G.Art.cv(wpx, hpx), x = o.x;
    /* 固定种子：同一界每次生成完全一样 */
    var rnd = G.Art.rnd(w.charCodeAt(0) * 7919 + w.length * 131);

    /* ① 底：三段渐变（上远山、中平原、下近地） */
    var g = x.createLinearGradient(0, 0, 0, hpx);
    g.addColorStop(0, T.land2);
    g.addColorStop(0.42, T.land);
    g.addColorStop(1, T.land2);
    x.fillStyle = g; x.fillRect(0, 0, wpx, hpx);

    /* ② 山脉：成组的小三角脊（一组 3~5 座，看起来像山系而不是散点） */
    var groups = Math.max(3, Math.round(T.peaks / 4));
    for (var gi = 0; gi < groups; gi++) {
      var gx = rnd() * wpx, gy = hpx * (0.12 + rnd() * 0.72);
      var cnt = 3 + Math.floor(rnd() * 3);
      for (var k = 0; k < cnt; k++) {
        var mw = 9 + rnd() * 22, mh = 6 + rnd() * 15;
        var mx0 = gx + (k - cnt / 2) * (mw * 0.85) + (rnd() - 0.5) * 8;
        var my0 = gy + (rnd() - 0.5) * 10;
        /* 山脊透明度压一档：地名要能压得住地形，否则整张图像花花绿绿的一团 */
        x.globalAlpha = 0.34 + rnd() * 0.26;
        x.fillStyle = T.ridge;
        x.beginPath();
        x.moveTo(mx0 - mw, my0 + mh); x.lineTo(mx0, my0); x.lineTo(mx0 + mw, my0 + mh);
        x.closePath(); x.fill();
        /* 受光面 */
        x.globalAlpha = 0.20 + rnd() * 0.18;
        x.fillStyle = T.ridgeHi;
        x.beginPath();
        x.moveTo(mx0, my0); x.lineTo(mx0 + mw * 0.55, my0 + mh * 0.72);
        x.lineTo(mx0, my0 + mh * 0.9);
        x.closePath(); x.fill();
        /* 雪线（灵 / 仙 / 道界的山要"冷"） */
        if (T.snow > 0 && rnd() < T.snow) {
          x.globalAlpha = 0.55;
          x.fillStyle = 'rgba(226,238,255,0.85)';
          x.beginPath();
          x.moveTo(mx0, my0); x.lineTo(mx0 + mw * 0.22, my0 + mh * 0.34);
          x.lineTo(mx0 - mw * 0.22, my0 + mh * 0.34);
          x.closePath(); x.fill();
        }
      }
    }
    x.globalAlpha = 1;

    /* ③ 河流：两条横贯的曲线（两端出画，像真的从山里流出去） */
    x.strokeStyle = T.water;
    x.lineCap = 'round';
    x.globalAlpha = 0.85;
    for (var r2 = 0; r2 < 2; r2++) {
      var ry0 = hpx * (0.34 + r2 * 0.30) + (rnd() - 0.5) * 12;
      x.lineWidth = 3.6 - r2 * 0.8;
      x.beginPath();
      x.moveTo(-8, ry0);
      for (var sx0 = -8; sx0 <= wpx + 8; sx0 += 56) {
        x.quadraticCurveTo(sx0 + 28, ry0 + (rnd() - 0.5) * 40, sx0 + 56, ry0 + (rnd() - 0.5) * 26);
      }
      x.stroke();
    }
    x.globalAlpha = 1;

    /* ④ 林地：小圆簇 */
    for (var t = 0; t < T.trees * 3; t++) {
      var tx0 = rnd() * wpx;
      var ty0 = hpx * (0.28 + rnd() * 0.68);
      x.globalAlpha = 0.20 + rnd() * 0.24;
      x.fillStyle = T.ridgeHi;
      x.beginPath(); x.arc(tx0, ty0, 1.6 + rnd() * 2.6, 0, 6.2832); x.fill();
    }
    x.globalAlpha = 1;

    /* ⑤ 暗角：四边压暗，把视线收进画面中间 */
    var vg = x.createRadialGradient(wpx / 2, hpx / 2, Math.min(wpx, hpx) * 0.35,
      wpx / 2, hpx / 2, Math.max(wpx, hpx) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    x.fillStyle = vg; x.fillRect(0, 0, wpx, hpx);

    mapBg[key] = o.c;
    return o.c;
  }

  /* 界的可见性 / 可点性（v0.18.0，用户口径）：
     · 凡界：永远可点；
     · 灵界：**可见但未飞升就置灰**（"表示灵界地图置灰无法点击"）；
     · 仙界：**到过灵界才出现**（没到过则整栏隐藏）；
     · 道界：**地狱难度通关仙界才出现**。
     ⚠️ "隐藏"与"置灰"是两件事：隐藏 = 玩家不知道它存在（仙界 / 道界）；
     置灰 = 知道但去不了（灵界）。两套判据分开写，别合成一个 ——
     合成之后"该藏起来的界"会以灰按钮的形式提前泄底。 */
  function worldGate(meta, w) {
    var p = (meta && meta.progress) || {};
    var ws = p.worlds || {};
    var hell = (meta && meta.hellCleared) || {};
    if (w === 'fan') return { show: true, ok: true };
    if (w === 'ling') return { show: true, ok: !!ws.ling };
    if (w === 'xian') return { show: !!ws.ling, ok: !!ws.xian };
    if (w === 'dao') return { show: !!(ws.xian && (p.daoKey || hell.xian)), ok: !!ws.dao };
    return { show: false, ok: false };
  }

  /* 当前该看哪一界：选了看不了的界就退回凡界（别让"隐藏"的界被选中） */
  function mapWorldOf(scene, meta) {
    var w = scene.mapWorld || G.Player.activeWorldId(meta);
    var g = worldGate(meta, w);
    if (!g.show || !g.ok) w = 'fan';
    scene.mapWorld = w;
    return w;
  }

  function drawMap(x, scene) {
    var save = G.game.save, meta = G.game.meta || {};
    var Rg = G.Data.regions;
    var cur = Rg.regionIdOf ? Rg.regionIdOf(save.map) : null;
    var visited = save.visited || {};
    var w = mapWorldOf(scene, meta);
    var list = Rg.of(w) || [];
    shell(x, '地图', Rg.worldNames[w] || '');

    /* 视口 */
    var V = MP;
    x.drawImage(worldMapBg(w, Math.round(V.vw), Math.round(V.vh)),
      V.vx, V.vy, V.vw, V.vh);
    G.UI.rr(x, { x: V.vx + 0.5, y: V.vy + 0.5, w: V.vw - 1, h: V.vh - 1 }, 4);
    x.strokeStyle = 'rgba(158,206,246,0.42)';
    x.lineWidth = 1; x.stroke();

    /* 区域节点 */
    list.forEach(function (r) {
      var nx = V.vx + r.mx * V.vw, ny = V.vy + r.my * V.vh;
      var isCur = r.id === cur;
      var seen = isCur || !!visited[r.id];
      if (isCur) {
        x.strokeStyle = 'rgba(245,227,168,0.85)';
        x.lineWidth = 1.4;
        x.beginPath(); x.arc(nx, ny, 7, 0, 6.2832); x.stroke();
        x.fillStyle = '#f5e3a8';
        x.beginPath(); x.arc(nx, ny, 3.4, 0, 6.2832); x.fill();
      } else if (seen) {
        x.fillStyle = 'rgba(226,236,252,0.92)';
        x.beginPath(); x.arc(nx, ny, 2.6, 0, 6.2832); x.fill();
      } else {
        x.strokeStyle = 'rgba(150,168,196,0.7)';
        x.lineWidth = 1;
        x.beginPath(); x.arc(nx, ny, 2.6, 0, 6.2832); x.stroke();
      }
      /* 界门标记：节点上方一个菱形（与"区域"本身区分开） */
      if (r.gate) {
        x.fillStyle = '#8fd8f0';
        x.beginPath();
        x.moveTo(nx, ny - 12); x.lineTo(nx + 3.6, ny - 8.2);
        x.lineTo(nx, ny - 4.4); x.lineTo(nx - 3.6, ny - 8.2);
        x.closePath(); x.fill();
      }
      /* 名字：节点下方居中，两端夹住视口（贴边会被裁掉） */
      var fs = isCur ? 10.5 : 9.5;
      x.font = G.UI.F(fs);
      var tw = x.measureText(r.n).width;
      var lx = Math.max(V.vx + tw / 2 + 1, Math.min(V.vx + V.vw - tw / 2 - 1, nx));
      G.UI.textOut(x, { x: lx, y: ny + 5 }, r.n, fs,
        isCur ? G.UI.C.goldHi : (seen ? 'rgba(228,236,248,0.95)' : 'rgba(140,152,176,0.9)'),
        'center', 'rgba(6,10,20,0.9)', 2.2);
    });

    /* 图例 + "还没现世"的界提示 */
    var hint = '金环 = 当前所在　菱形 = 界门';
    if (!worldGate(meta, 'xian').show) hint += '　仙界未现';
    else if (!worldGate(meta, 'dao').show) hint += '　道界未现';
    G.UI.text(x, { x: P.x + 14, y: P.y + P.h - 18 }, hint, 10, G.UI.C.textDim);
  }

  function buildMap(btns, scene) {
    var meta = G.game.meta || {};
    var Rg = G.Data.regions;
    var cur = mapWorldOf(scene, meta);
    /* 只给**可见**的界建按钮（隐藏 = 玩家不知道它存在，不该以灰按钮的形式泄底） */
    var show = WORLD_ORDER.filter(function (w) { return worldGate(meta, w).show; });
    var total = show.length * MP.tabW + (show.length - 1) * MP.tabGap;
    var x0 = P.x + (P.w - total) / 2;
    show.forEach(function (w, i) {
      var gt = worldGate(meta, w);
      btns.push(new G.UI.Btn({
        x: Math.round(x0 + i * (MP.tabW + MP.tabGap)), y: MP.tabY,
        w: MP.tabW, h: MP.tabH, small: true,
        variant: 'subtab', active: cur === w, disabled: !gt.ok,
        label: Rg.worldNames[w],
        onClick: function () {
          scene.mapWorld = w;
          G.Overlays.openPanel(scene, 'map');
        }
      }));
    });
  }
  var DRAW = {
    /* 角色面板要读 scene.charTab（子页签），所以把 scene 透传下去 */
    char: function (x, scene) { G.Overlays.renderChar(x, scene); },
    skills: drawSkills,
    secrets: drawSecrets,
    quest: drawQuest,
    bag: drawBag,
    cave: drawCave,
    sect: drawSect,
    map: drawMap
  };

  function renderPanel(x, scene) {
    var fn = DRAW[scene.overlay];
    if (!fn) return false;
    /* 六面板 = 云海玉牌（深青紫底 + 浅字）。**底栏不在作用域内** —— 它跟 HUD 一样是墨夜，
       两套材质靠这个作用域边界分开，所以 `renderBar` 必须留在外面。 */
    G.UI.mist(function () { fn(x, scene); });
    /* 底栏高亮：功法/秘术属于「角色」组，底栏高亮也要落在角色上 ——
       否则进了功法页底栏一个都不亮，玩家不知道自己在哪。 */
    renderBar(x, G.Overlays.isCharGroup(scene.overlay) ? 'char' : scene.overlay);
    return true;
  }

  /* 左侧追踪栏的**唯一取数口**（探索场景每帧要读）。
     不让 explore.js 自己翻 QUEST 表 —— 表在这个闭包里，外面看不见；
     也避免"两处各判一次当前步"，那种重复迟早会分叉。
     返回：{ id, idx, total, s, flags, guide, upcoming }。
     · guide 已按旗标做过 g → g2 的切换（打赢一场后自动改指回镇）。
     · upcoming 是紧随其后的两步（追踪栏"子任务"的兜底内容）。 */
  G.Overlays.trackInfo = function (save) {
    var q = (save && save.quest) || { step: 'm0-1', flags: {} };
    var step = q.step || 'm0-1';
    var idx = QUEST_ORDER.indexOf(step);
    if (idx < 0) idx = 0;
    var s = QUEST[step] || QUEST[QUEST_ORDER[0]];
    var flags = q.flags || {};
    var done = !!(s.f && flags[s.f]);
    return {
      id: step, idx: idx, total: QUEST_ORDER.length, s: s, flags: flags,
      guide: (done && s.g2) ? s.g2 : (s.g || null),
      upcoming: QUEST_ORDER.slice(idx + 1, idx + 3).map(function (id2) { return QUEST[id2]; })
    };
  };

  G.Overlays.PANELS = PANELS;  G.Overlays.PANEL_RECT = FRAME;
  /* 内容区也导出：契约要判"内容不越出外框"，两处都得拿到 */
  G.Overlays.PANEL_BODY = P;
  G.Overlays.PANEL_BAND = BAND;
  G.Overlays.BAR_Y = BAR_Y;
  G.Overlays.BAR_H = BAR_H;
  G.Overlays.isPanel = function (name) { return !!IDS[name]; };
  /* 成就页移出游戏内（v0.15.0）：底栏不再有它，改由**开局界面**渲染。
     绘制实现仍留在这里（单一实现），只是换个调用方 —— 不复制一份。 */
  G.Overlays.drawAchieve = drawAchieve;
  G.Overlays.CAVE_ARTS = ARTS;
  G.Overlays.MAP_WORLDS = WORLD_ORDER;
  /* 导出给契约：分界的可见性/可点性判据（用户口径的"隐藏 vs 置灰"） */
  G.Overlays.worldGate = worldGate;
  G.Overlays.worldMapBg = worldMapBg;
  G.Overlays.barBtns = barBtns;
  G.Overlays.renderBar = renderBar;
  G.Overlays.openPanel = openPanel;
  G.Overlays.renderPanel = renderPanel;
  G.Overlays.secretDesc = secretDesc;
})();
