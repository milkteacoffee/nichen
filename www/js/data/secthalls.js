/* 宗门山门（室内场景）—— 凡界 9 宗门各一间
 *
 * 用户口径：「凡界不是有 9 个宗门吗，五个小宗门，四个大宗门吗，一并孵化完成」。
 *
 * 做法：给每个**凡界**宗门建一张 30×17 的室内图（正好一屏），
 *   场景名 `sect_<宗门id>`，`md.sectId` 记住是哪一门、`md.back` 记住出门回哪张图。
 *   室内四件功能：
 *     · 拜师台 → 拜入本门（开试炼战）
 *     · 传功殿 → 以贡献兑换本门功法
 *     · 贡献堂 → 门派商店
 *     · 香案   → 打坐（复用洞府的打坐）
 *
 * ⚠️ **只做凡界的 9 个**：灵界/仙界的 8 个总部要等各自区域的场景成熟后再挂，
 *    否则会挂到"区域本身还没做细"的地方（用户已确认先做凡界）。
 * ⚠️ 地图形状照抄 `town_home` 的约定：30×17、门开在下边墙正中、spawn 是门内侧一格。
 */
(function () {
  /* 家具布局（四件功能 + 装饰）。与 town_home 同风格：y 从 3 起摆（顶部 0—2 行被 HUD 盖）。
     ⚠️ **左缘 x < 7 是禁区**：左侧任务追踪栏展开时会盖住那一片（第一版把「传功殿」
        摆在 x=4，截图里整块被追踪栏压住 —— 功能还在、玩家看不见）。
        ⚠️ 同理右侧 x > 24 会被 HUD 资源格压到，功能件一律放中间。 */
  function hallFurn() {
    return [
      { id: 'learn', kind: 'shelf', x: 8, y: 3, w: 3, h: 2, act: 'learn', label: '传功殿' },
      { id: 'altar', kind: 'vessel', x: 14, y: 3, w: 2, h: 2, act: 'join', label: '拜师台' },
      { id: 'shop', kind: 'table', x: 20, y: 3, w: 3, h: 2, act: 'shop', label: '贡献堂' },
      { id: 'incense', kind: 'cushion', x: 14, y: 8, w: 2, h: 2, act: 'rest', label: '香案' },
      { id: 'screen', kind: 'screen', x: 11, y: 3, w: 3, h: 1 },
      { id: 'screen2', kind: 'screen', x: 17, y: 3, w: 3, h: 1 },
      { id: 'lanternL', kind: 'lantern', x: 8, y: 8, w: 1, h: 2 },
      { id: 'lanternR', kind: 'lantern', x: 21, y: 8, w: 1, h: 2 },
      { id: 'shelfL', kind: 'shelf', x: 8, y: 12, w: 3, h: 1 },
      { id: 'shelfR', kind: 'shelf', x: 19, y: 12, w: 3, h: 1 },
      { id: 'crateL', kind: 'crate', x: 12, y: 13, w: 1, h: 1 },
      { id: 'crateR', kind: 'crate', x: 17, y: 13, w: 1, h: 1 },
      { id: 'jar', kind: 'jar', x: 15, y: 13, w: 1, h: 1 }
    ];
  }

  /* 只给凡界宗门建（见文件头说明） */
  var FAN = null;
  function build() {
    if (!G.Data.sects) return;
    FAN = G.Data.sects.ofWorld('fan');
    FAN.forEach(function (s) {
      var id = 'sect_' + s.id;
      /* 出门回哪张图：优先区域的 `map`（手写图 town/field/cave），否则用区域 id 本身 */
      var reg = G.Data.regions && G.Data.regions.byId ? G.Data.regions.byId(s.region) : null;
      var back = (reg && reg.map) || s.region;
      G.Data.maps[id] = {
        id: id, w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
        label: s.n,
        sectId: s.id, back: back,
        spawn: { x: 15, y: 14 },
        furn: hallFurn(),
        exits: [{ x0: 14, x1: 15, y: 16, to: back, spawn: null, label: '出门' }]
      };
    });
  }

  G.Data = G.Data || {};
  G.Data.sectHalls = {
    build: build,
    /* 某宗门的山门场景名（灵界/仙界宗门返回 null —— 还没做） */
    sceneOf: function (sectId) {
      var s = G.Data.sects && G.Data.sects.byId(sectId);
      if (!s || s.world !== 'fan') return null;
      return 'sect_' + s.id;
    },
    /* 某区域里的**全部**山门（供 regiongen 挂结构体用）。
       ⚠️ 返回数组而不是单个 —— 落霞镇（fan4）同时有落霞镖局 / 太虚剑宗 / 丹霞谷三家，
          只取第一家会让另外两门在凡界"查无此地"。 */
    gatesOfRegion: function (regionId) {
      if (!FAN) build();
      return FAN.filter(function (x) { return x.region === regionId; })
        .map(function (x) {
          return { sectId: x.id, name: x.n + ' · 山门', to: 'sect.' + x.id + '.gate' };
        });
    }
  };
})();
