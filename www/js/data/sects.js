/* 宗门与散修体系数据 —— 《逆尘》宗门与散修体系设计 v1.0 §3
 *
 * 21 个宗门：凡界 9（5 小 + 4 大）+ 灵界 7 + 仙界 5；**道界无宗门**（玩家可自创）。
 *
 * 字段：
 *   id      宗门 id
 *   n       宗门名
 *   world   所在界
 *   size    'small' | 'big'（big = 跨界定点，灵界有总部、仙界有道场）
 *   region  所在区域 id（见 data/regions.js）
 *   elem    专精五行
 *   tier    可授功法的最高品阶（凡/灵/宝/仙）
 *   trial   入门试炼类型（'duel' 对决 / 'task' 跑腿 / 'gather' 采集 / 'escort' 护送）
 *   skills  本门功法池（id 见 data/skills.js，标了 src:'sect'）
 *   parent  大宗的根 id（分部指向山门/总部）
 *   desc    一句话说明
 */
(function () {
  function S(o) { return o; }

  var LIST = [
    /* ===== 凡界 · 5 小宗门 ===== */
    S({ id: 'qxj', n: '青溪剑馆', world: 'fan', size: 'small', region: 'fan1', elem: '金',
        tier: '凡', trial: 'duel', skills: ['青溪剑诀', '流云三叠'],
        desc: '青溪镇上开馆授徒的小剑馆，教的是最扎实的入门剑式。' }),
    S({ id: 'lxb', n: '落霞镖局', world: 'fan', size: 'small', region: 'fan4', elem: '土',
        tier: '凡', trial: 'escort', skills: ['铁镖护体', '镖行千里'],
        desc: '半宗门半商帮，走镖也教拳，最讲一个"信"字。' }),
    S({ id: 'yhy', n: '幽篁药庐', world: 'fan', size: 'small', region: 'fan6', elem: '木',
        tier: '凡', trial: 'gather', skills: ['百草回春', '药王真解'],
        desc: '竹谷深处的药修小庐，采药炼丹，救人亦自保。' }),
    S({ id: 'hyg', n: '火云观', world: 'fan', size: 'small', region: 'fan9', elem: '火',
        tier: '凡', trial: 'duel', skills: ['火云咒', '焚天诀'],
        desc: '地火谷中的道观，修的是最刚猛的一路火法。' }),
    S({ id: 'cwl', n: '翠微猎户盟', world: 'fan', size: 'small', region: 'fan2', elem: '土',
        tier: '凡', trial: 'gather', skills: ['猎兽诀', '御兽同心'],
        desc: '翠微山的猎户结社，与山中的妖兽打了一辈子交道。' }),

    /* ===== 凡界 · 4 大宗门（山门）===== */
    S({ id: 'txjz', n: '太虚剑宗', world: 'fan', size: 'big', region: 'fan4', elem: '金',
        tier: '凡', trial: 'duel', skills: ['太虚剑意', '万剑归宗'],
        desc: '天下剑修之首，凡界立山门，灵界设总部，仙界有道场。' }),
    S({ id: 'dxg', n: '丹霞谷', world: 'fan', size: 'big', region: 'fan4', elem: '火',
        tier: '凡', trial: 'gather', skills: ['丹霞吐纳', '九转丹经'],
        desc: '丹道第一脉，谷中丹炉千年不熄。' }),
    S({ id: 'xtzz', n: '玄天阵宗', world: 'fan', size: 'big', region: 'fan8', elem: '土',
        tier: '凡', trial: 'task', skills: ['小周天阵', '玄天困阵'],
        desc: '以阵入道，一寸山河一寸阵。' }),
    S({ id: 'wssz', n: '万兽山庄', world: 'fan', size: 'big', region: 'fan6', elem: '土',
        tier: '凡', trial: 'gather', skills: ['兽血诀', '万兽朝宗'],
        desc: '御兽一脉祖庭，庄中豢养的妖兽比弟子还多。' }),

    /* ===== 灵界 · 7 ===== */
    S({ id: 'txjz_ling', n: '太虚剑宗·灵界总部', world: 'ling', size: 'big', region: 'ling5',
        parent: 'txjz', elem: '金', tier: '灵', trial: 'duel',
        skills: ['太虚剑意', '万剑归宗'], desc: '太虚剑宗在灵界的根本之地，剑冢万剑朝宗。' }),
    S({ id: 'dxg_ling', n: '丹霞谷·灵界总部', world: 'ling', size: 'big', region: 'ling2',
        parent: 'dxg', elem: '火', tier: '灵', trial: 'gather',
        skills: ['丹霞吐纳', '九转丹经'], desc: '丹霞谷灵界总部，水府之畔立炉，以寒泉养丹。' }),
    S({ id: 'xtzz_ling', n: '玄天阵宗·灵界总部', world: 'ling', size: 'big', region: 'ling4',
        parent: 'xtzz', elem: '土', tier: '灵', trial: 'task',
        skills: ['小周天阵', '玄天困阵'], desc: '玄天阵宗灵界总部，古堡残垣下埋着上古大阵。' }),
    S({ id: 'wssz_ling', n: '万兽山庄·灵界总部', world: 'ling', size: 'big', region: 'ling1',
        parent: 'wssz', elem: '土', tier: '灵', trial: 'gather',
        skills: ['兽血诀', '万兽朝宗'], desc: '万兽山庄灵界总部，雷泽荒原上放牧着雷兽群。' }),
    S({ id: 'lzm', n: '雷泽散人盟', world: 'ling', size: 'small', region: 'ling1', elem: '水',
        tier: '灵', trial: 'task', skills: ['雷泽引气', '雷泽怒涛'],
        desc: '灵界散修结成的盟会，不问出身，只认本事。' }),
    S({ id: 'yhjz', n: '云海剑冢·守冢一脉', world: 'ling', size: 'small', region: 'ling5', elem: '金',
        tier: '灵', trial: 'duel', skills: ['守冢剑式', '冢中枯骨'],
        desc: '守着云海剑冢的一脉剑修，不与外门往来。' }),
    S({ id: 'hysf', n: '寒渊水府·鲛族', world: 'ling', size: 'small', region: 'ling2', elem: '水',
        tier: '灵', trial: 'gather', skills: ['鲛绡歌', '寒渊怒啸'],
        desc: '寒渊水府中的鲛人一族，以歌入道，性冷而排外。' }),

    /* ===== 仙界 · 5 ===== */
    S({ id: 'txjz_xian', n: '太虚剑宗·仙界道场', world: 'xian', size: 'big', region: 'xian8',
        parent: 'txjz', elem: '金', tier: '仙', trial: 'duel',
        skills: ['太虚剑意', '万剑归宗'], desc: '太虚剑宗仙界道场，剑意直通九霄。' }),
    S({ id: 'dxg_xian', n: '丹霞谷·兜率天宫', world: 'xian', size: 'big', region: 'xian3',
        parent: 'dxg', elem: '火', tier: '仙', trial: 'gather',
        skills: ['丹霞吐纳', '九转丹经'], desc: '丹道祖庭，兜率天宫中的那口炉，炼的是仙丹。' }),
    S({ id: 'xtzz_xian', n: '玄天阵宗·天枢阁', world: 'xian', size: 'big', region: 'xian8',
        parent: 'xtzz', elem: '土', tier: '仙', trial: 'task',
        skills: ['小周天阵', '玄天困阵'], desc: '阵道祖庭，天规碑上刻的其实是阵图。' }),
    S({ id: 'wssz_xian', n: '万兽山庄·蟠桃园', world: 'xian', size: 'big', region: 'xian5',
        parent: 'wssz', elem: '土', tier: '仙', trial: 'gather',
        skills: ['兽血诀', '万兽朝宗'], desc: '御兽祖庭，蟠桃园里养的仙兽不比仙桃少。' }),
    S({ id: 'tmty', n: '南天门天兵营', world: 'xian', size: 'small', region: 'xian1', elem: '光',
        tier: '仙', trial: 'duel', skills: ['天兵列阵', '天门敕令'],
        desc: '天庭正军，只收仙界修士，最讲规矩。' })
  ];

  var index = {};
  LIST.forEach(function (s) { index[s.id] = s; });

  G.Data = G.Data || {};
  G.Data.sects = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    ofWorld: function (w) {
      return LIST.filter(function (s) { return s.world === w; });
    },
    /* 该宗门的根宗门 id（分部指向山门/总部；本身是根则返回自己） */
    rootOf: function (id) {
      var s = index[id];
      return s ? (s.parent || s.id) : null;
    },
    /* 玩家能否"入"这个宗门：境界门槛由调用方另判，这里只判界与身份 */
    isBig: function (id) { var s = index[id]; return !!(s && s.size === 'big'); },
    /* 同一根宗门下的所有分部（含山门/总部/道场），用于"复门"与授权判定 */
    familyOf: function (id) {
      var root = this.rootOf(id);
      return LIST.filter(function (s) { return (s.parent || s.id) === root; });
    }
  };
})();
