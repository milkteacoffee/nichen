/* 战斗场景 v3：侧视回合制（我方左 / 敌方右，1v1~1v3）
   ─ 有效速度定序（含麻痹 ×0.7）→ 指令 → 目标 → 演出 → 结算
   ─ 状态系统按战斗规格 v0.2 §8 真生效；蓄力技提前一回合预告（§9）
   ─ 奖励按经济表 v0.2 §4；剧情分支 killer / wolfKing / heartDemon */
(function () {
  var HERO_POS = { x: 122, y: 158, s: 58 };
  /* 出战灵兽站位：主角左后侧，略小 */
  var BEAST_POS = { x: 68, y: 168, s: 46 };

  /* 敌方槽位：索引 0 = 前排（离主角最近），越靠后越远 */
  var E_SLOTS = [
    { x: 300, y: 172, s: 54 },
    { x: 366, y: 150, s: 54 },
    { x: 424, y: 134, s: 46 }
  ];
  var SOLO_SLOT = { x: 356, y: 152, s: 58 };
  var BOSS_SLOT = { x: 356, y: 148, s: 72 };
  /* 多敌站位：由近及远的一条斜线（近 = 离主角近 = 前排，v0.2 §5）。
     纵向间距必须大于名牌高度（24），否则相邻两只的名牌会叠在一起。 */
  var MULTI_SLOTS = [
    { x: 268, y: 178, s: 52 },
    { x: 364, y: 148, s: 54 },
    { x: 448, y: 116, s: 46 }
  ];

  var MAX_E = 3;

  /* 物种 → 程序化立绘键。**统一放在 `G.Data.SPECIES_SPRITE`**（enemies.js），
     因为地图上的明雷（explore.js）也要用它取同一张图 —— 只有一份真相源，
     才能保证"地图上看到哪只"与"进战斗打哪只"长相一致。 */
  var SPECIES_SPRITE = G.Data.SPECIES_SPRITE;
  /* 灵兽物种 id → 程序化战斗图（无专用图时的兜底） */
  var BEAST_UNIT_SPRITE = {
    b_qingwenshe: 'snake', b_bilinmang: 'snake', b_qingjiao: 'snake',
    b_chiyanlang: 'wolf', b_chiyanlangwang: 'wolfking', b_shujing: 'tree',
    b_chiyanshi: 'wolf', b_leishou: 'wolf', b_shihunfu: 'bloodbat',
    b_leizeju: 'wolf', b_tianma: 'wolf', b_pixiu: 'wolf',
    b_qilin: 'wolf', b_jinchidapeng: 'wolf', b_hundunshou: 'wolf'
  };

  /* ⚠️ 功法主动槽上限（原 `SKILL_SLOTS`）v0.69.0 已收敛到 `G.Player.ACTIVE_SLOTS` ——
     面板的激发按钮与这里的装配必须读同一个数，两处各写一份迟早分叉。 */
  /* 逃跑：每场最多尝试次数（战斗规格 v0.2 §10） */
  var MAX_FLEE = 3;

  /* 思考倒计时（v0.11.2）：玩家每个回合 30s 不点动作 → 自动「攻击」打前排。 */
  /* 受击红色剪影（v0.18.0）：把立绘烘成整块红的剪影，主角挨打时叠上去。
     按 sprite **缓存** —— 每帧现烘一次全尺寸画布会直接掉帧。 */
  var _hitSil = null, _hitSilSrc = null;
  function hitSilhouette(spr) {
    if (_hitSilSrc === spr && _hitSil) return _hitSil;
    var o = G.Art.cv(spr.width, spr.height), cx = o.x;
    cx.drawImage(spr, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = '#ff4a3a';
    cx.fillRect(0, 0, spr.width, spr.height);
    _hitSilSrc = spr; _hitSil = o.c;
    return o.c;
  }

  /* 思考倒计时（v0.11.2 建；v0.17.0 由 30s 收到 15s —— 用户口径「缩短到 15 秒」）。
     到点自动替玩家出手（攻击前排），见 _tickCmd。 */
  var CMD_TIMER = 15;

  /* 战斗按钮变体：「墨玉」底色但**无投影 + 1px 细描边**，比 default 干净一半（线框感砍掉）。 */
  var BATTLE_BG = 'rgba(20,24,36,0.78)';
  var BATTLE_LINE = 'rgba(168,180,210,0.32)';
  var BATTLE_LINE_HI = 'rgba(216,183,104,0.55)';

  /* ============================================================
     战斗背景主题表（v0.12.0）
     ------------------------------------------------------------
     背景按**战场所属地形/界域**选主题，而不是一张通用夜景。
     取值优先级（见 _bgKey）：
       ① params.bg（显式指定，剧情战可用）
       ② 来源地图 md.ground（cave / bloodcave / floor / town / 其它）
       ③ 所在界（fan / ling / xian / dao）
     每个主题有两个来源，**素材优先**：
       · G.Assets.img('bg.battle.<key>') —— 逻辑名见 assets-build.py 的 SIZES
       · 没有素材就走下面这张表程序化生成（缺图不会变成黑屏）
     feat 是绘制件清单，按顺序叠加。新增主题 = 加一行表 + 在 _bgFeature 里加分支。
     ⚠️ 背景是**缓存**的（this.bg），缓存键必须带上主题名 ——
        战斗场景是单例，不换键就会出现"换了个战场还是上一张背景"。
     ============================================================ */
  var BG_THEME = {
    /* 野外月夜（默认）：青蓝夜空 + 两层远山 + 月 */
    night: { sky: ['#0a0e1e', '#161d34', '#242b44'], ridge: ['#131a2c', '#0c1220'],
      ground: ['#22283c', '#0d1018'], edge: 'rgba(216,183,104,0.16)',
      feat: ['stars', 'moon', 'ridge'] },
    /* 镇内：屋脊剪影 + 暖灯 */
    town: { sky: ['#080b16', '#131a30', '#232c4a', '#333d60'], ridge: ['#1a2036', '#111726'],
      ground: ['#2c2d3a', '#12141c'], edge: 'rgba(216,183,104,0.20)',
      feat: ['stars', 'moon', 'roof'] },
    /* 洞窟：岩壁 + 钟乳 + 冷色矿光 */
    cave: { sky: ['#0b0d11', '#15181e', '#1e2128', '#262a32'], ridge: ['#20232a', '#171a20'],
      ground: ['#2b2d35', '#121316'], edge: 'rgba(143,214,232,0.18)',
      feat: ['stalactite', 'torch'] },
    /* 血煞据点：暗红洞窟 + 血色雾 */
    blood: { sky: ['#150508', '#24070a', '#330b0c', '#401312'], ridge: ['#2c0b0d', '#1a0506'],
      ground: ['#351110', '#160505'], edge: 'rgba(232,132,106,0.26)',
      feat: ['stalactite', 'torch'] },
    /* 石殿（道则回廊 / 室内秘境）：列柱 + 火盆 */
    hall: { sky: ['#0c0e16', '#171b28', '#232a3a', '#30374b'], ridge: ['#242a3a', '#171c28'],
      ground: ['#2f3342', '#14161e'], edge: 'rgba(216,183,104,0.24)',
      feat: ['pillar', 'torch'] },
    /* 灵界：青碧灵光 + 浮云 */
    ling: { sky: ['#05131b', '#0b2532', '#154351', '#1f5f6a'], ridge: ['#123a44', '#0a262e'],
      ground: ['#1c4a52', '#0a1e24'], edge: 'rgba(143,240,216,0.22)',
      feat: ['stars', 'cloud', 'ridge'] },
    /* 仙界：金霞云海 */
    xian: { sky: ['#1b1307', '#302309', '#4d390d', '#6f5113'], ridge: ['#3b2d11', '#251d09'],
      ground: ['#4b3b15', '#1f1708'], edge: 'rgba(255,217,138,0.30)',
      feat: ['cloud', 'ridge'] },
    /* 道界：虚空星河 */
    dao: { sky: ['#060612', '#0d0d24', '#16163a', '#212150'], ridge: ['#181840', '#0e0e28'],
      ground: ['#22224a', '#0c0c20'], edge: 'rgba(200,184,255,0.28)',
      feat: ['stars', 'cloud', 'void'] }
  };

  /* ============================================================
     背景绘制件（v0.12.0）
     ------------------------------------------------------------
     签名统一 (x, T, rnd)：x = 逻辑坐标 2D 上下文（480×272 已 scale(K)），
     T = 当前主题，rnd = 确定性随机源（由 _bg 按主题名播种）。
     ⚠️ 全部必须**确定性**：用传入的 rnd 而不是 Math.random / 时间。
        否则每次进战斗背景都在变，玩家读成"闪屏"（G26 同族：随机要问种子是谁给的）。
     新增件 = 在这里加一个键 + 在 BG_THEME 的 feat 里引用。
     ============================================================ */
  var BG_FEAT = {
    /* 星点 */
    stars: function (x, T, rnd) {
      for (var i = 0; i < 90; i++) {
        var sx = rnd() * 480, sy = rnd() * 170;
        var big = rnd() < 0.14;
        x.globalAlpha = 0.18 + rnd() * 0.68;
        x.fillStyle = '#dfe6fa';
        x.fillRect(sx, sy, big ? 1.6 : 0.9, big ? 1.6 : 0.9);
      }
      x.globalAlpha = 1;
    },

    /* 月（含柔光） */
    moon: function (x, T, rnd) {
      var mx = 392, my = 52, mr = 28;
      var mg = x.createRadialGradient(mx, my, 4, mx, my, mr * 1.9);
      mg.addColorStop(0, 'rgba(246,238,214,0.28)');
      mg.addColorStop(1, 'rgba(246,238,214,0)');
      x.fillStyle = mg;
      x.beginPath(); x.arc(mx, my, mr * 1.9, 0, 6.2832); x.fill();
      x.fillStyle = '#f0e6c8';
      x.beginPath(); x.arc(mx, my, 15, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.07)';
      x.beginPath(); x.arc(mx - 5, my - 5, 3.4, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(mx + 5, my + 5, 2.4, 0, 6.2832); x.fill();
    },

    /* 两层远山 */
    ridge: function (x, T, rnd) {
      function layer(baseY, amp, col, phase) {
        var rr = G.Art.rnd(Math.round(baseY * 31 + phase * 977));
        x.fillStyle = col;
        x.beginPath();
        x.moveTo(0, 272);
        var pts = [];
        for (var px = 0; px <= 480; px += 24) {
          pts.push({
            x: px,
            y: baseY + Math.sin(px * 0.014 + phase) * amp + (rr() - 0.5) * amp * 1.2
          });
        }
        x.lineTo(pts[0].x, pts[0].y);
        for (var i = 0; i < pts.length - 1; i++) {
          var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
          x.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        x.lineTo(480, 272); x.closePath(); x.fill();
      }
      layer(150, 16, T.ridge[0], 0.6);
      layer(172, 20, T.ridge[1], 2.4);
    },

    /* 镇内屋脊剪影：一排高低错落的屋顶 + 暖窗 */
    roof: function (x, T, rnd) {
      var hx = -10;
      while (hx < 490) {
        var w = 34 + rnd() * 26;
        var top = 138 + rnd() * 20;
        x.fillStyle = T.ridge[0];
        x.beginPath();
        x.moveTo(hx, 178);
        x.lineTo(hx, top + 8);
        x.lineTo(hx + w * 0.5, top);          /* 屋脊尖 */
        x.lineTo(hx + w, top + 8);
        x.lineTo(hx + w, 178);
        x.closePath(); x.fill();
        /* 檐口暗线 */
        x.fillStyle = 'rgba(0,0,0,0.30)';
        x.fillRect(hx, top + 7, w, 1.4);
        /* 暖窗（两盏） */
        if (rnd() < 0.55) {
          x.fillStyle = 'rgba(232,192,122,0.55)';
          x.fillRect(hx + w * 0.30, top + 20, 4, 5);
        }
        if (rnd() < 0.35) {
          x.fillStyle = 'rgba(232,192,122,0.40)';
          x.fillRect(hx + w * 0.62, top + 30, 4, 5);
        }
        hx += w + 2 + rnd() * 5;
      }
      x.fillStyle = T.ridge[1];
      x.fillRect(0, 168, 480, 10);
    },

    /* 洞窟：顶部垂石 + 两侧岩柱 */
    stalactite: function (x, T, rnd) {
      x.fillStyle = T.ridge[0];
      for (var i = 0; i < 26; i++) {
        var sx = rnd() * 480, w = 8 + rnd() * 20, h = 16 + rnd() * 46;
        x.beginPath();
        x.moveTo(sx - w / 2, 0);
        x.lineTo(sx + w / 2, 0);
        x.lineTo(sx, h);
        x.closePath(); x.fill();
      }
      /* 两侧岩壁 */
      [0, 1].forEach(function (side) {
        var bx = side ? 480 : 0;
        x.fillStyle = T.ridge[1];
        x.beginPath();
        x.moveTo(bx, 0);
        var px = bx;
        for (var y = 0; y <= 178; y += 22) {
          px += (rnd() - 0.5) * 12;
          x.lineTo(px, y);
        }
        x.lineTo(bx, 178);
        x.closePath(); x.fill();
      });
    },

    /* 火把（左右各一）：暖光 + 跳动的焰 */
    torch: function (x, T, rnd) {
      [86, 394].forEach(function (tx) {
        var ty = 128;
        var g = x.createRadialGradient(tx, ty, 2, tx, ty, 62);
        g.addColorStop(0, 'rgba(255,176,92,0.34)');
        g.addColorStop(0.5, 'rgba(226,120,60,0.13)');
        g.addColorStop(1, 'rgba(226,120,60,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(tx, ty, 62, 0, 6.2832); x.fill();
        /* 木柄 */
        x.fillStyle = '#3a2c1e';
        x.fillRect(tx - 1.4, ty, 2.8, 44);
        /* 焰：外焰 + 内焰 */
        x.fillStyle = 'rgba(240,140,60,0.92)';
        x.beginPath();
        x.moveTo(tx - 4.2, ty);
        x.quadraticCurveTo(tx, ty - 16, tx + 4.2, ty);
        x.closePath(); x.fill();
        x.fillStyle = 'rgba(255,232,170,0.95)';
        x.beginPath();
        x.moveTo(tx - 2, ty - 1);
        x.quadraticCurveTo(tx, ty - 9, tx + 2, ty - 1);
        x.closePath(); x.fill();
      });
    },

    /* 石殿列柱 */
    pillar: function (x, T, rnd) {
      for (var i = 0; i < 4; i++) {
        var px = 34 + i * 138;
        var g = x.createLinearGradient(px, 0, px + 26, 0);
        g.addColorStop(0, T.ridge[1]);
        g.addColorStop(0.45, T.ridge[0]);
        g.addColorStop(1, T.ridge[1]);
        x.fillStyle = g;
        x.fillRect(px, 16, 26, 162);
        /* 柱头 / 柱础 */
        x.fillStyle = T.ridge[0];
        x.fillRect(px - 5, 12, 36, 7);
        x.fillRect(px - 5, 170, 36, 8);
      }
      /* 地面反光 */
      x.fillStyle = 'rgba(216,183,104,0.05)';
      x.fillRect(0, 150, 480, 28);
    },

    /* 云带（灵/仙/道） */
    cloud: function (x, T, rnd) {
      for (var i = 0; i < 5; i++) {
        var cy = 120 + i * 14 + rnd() * 8;
        var cw = 140 + rnd() * 180, ch = 8 + rnd() * 10;
        var cx0 = rnd() * 480;
        var g = x.createRadialGradient(cx0, cy, 1, cx0, cy, cw / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.09)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.beginPath(); x.ellipse(cx0, cy, cw / 2, ch, 0, 0, 6.2832); x.fill();
      }
    },

    /* 虚空涟漪（道界） */
    void: function (x, T, rnd) {
      x.save();
      x.strokeStyle = T.edge;
      x.lineWidth = 1.1;
      for (var i = 0; i < 4; i++) {
        x.globalAlpha = 0.5 - i * 0.1;
        x.beginPath();
        x.ellipse(240, 120, 70 + i * 46, 26 + i * 17, 0, 0, 6.2832);
        x.stroke();
      }
      x.restore();
    }
  };

  /* 消耗品（丹药治疗 = 目标最大 HP × 百分比） */
  var CONSUM = {
    '回春丹': { heal: 0.40, d: '回复四成气血' },
    '大还丹': { heal: 0.75, d: '回复七成五气血' },
    '聚气散': { qi: 500, d: '灵气 +500' },
     '醒神散': { cure: true, d: '解除异常状态' },
    '解毒丹': { cure: true, d: '解除异常状态' },
    '解封符': { cure: true, d: '解除封印控制' },
    '道纹丹': { heal: 0.60, d: '回复六成气血' }
  };
  /* 妖囊收服系数（《御兽 v0.2》§2） */
  var CAPTURE_BAGS = { '木囊': 1.0, '玄囊': 1.5, '宝囊': 2.0 };
  /* 野外敌人 species（中文名）→ 灵兽物种 id；人形/Boss 不在此列即不可收服 */
  var CAPTURABLE = {
    '青纹蛇': 'b_qingwenshe', '赤炎狼': 'b_chiyanlang', '树精': 'b_shujing',
    '赤眼豕': 'b_chiyanshi', '雷兽': 'b_leishou'
  };

  var scene = {
    smooth: true,
    params: null,
    mapId: 'field',

    /* ===== 生命周期 ===== */
    enter: function (params) {
      this.params = params || {};
      this.mapId = this.params.mapId || 'field';
      this.bg = null;
      this._bgFor = null;              /* 背景主题缓存键（见 _bg：不带键会沿用上一张） */
      this.round = 1;
      this.cue = []; this.cueDone = null;
      this.floaters = [];
      this.logs = [];
      this.shake = 0;
      this.lunge = {}; this.lungeT = {};
      this.flash = {};
      this.chargeMark = {};
      this.miss = {};                 /* 连续失手计数（命中保底） */
      this.auto = false;
      this.over = false;
      this.t = 0;
      this.pSkill = null;
      this.pTarget = null;
      this.fleeTries = 0;
      this.summonDone = false;
      this.enraged = false;
      /* 思考倒计时（v0.17.0 起 15s）：每回合玩家不点动作 → 自动选「攻击」打前排；
         自动战斗中不计时（auto 自己跑）；非 command 阶段（已出手/等待）也暂停。 */
      this.cmdTimer = CMD_TIMER;

      /* v0.76.0 连击系统（阶段二）：3秒内连续攻击累加combo，伤害+1%/combo（上限50%） */
      this.comboCount = 0;        // 当前连击数
      this.comboTimer = 0;        // 连击倒计时（秒）
      this.comboBest = 0;         // 本场最高连击
      this.COMBO_TIMEOUT = 3.0;   // 连击超时时间（秒）
      this.COMBO_MAX_BONUS = 0.5; // 最大加成50%

      /* v0.76.0 副本评级统计（阶段二） */
      this.battleStartTime = performance.now();  // 战斗开始时间
      this.damageTaken = 0;       // 累计受击次数
      this.itemsUsed = 0;         // 使用药剂次数

      this._initUnits();
      if (this.params.script === 'heartDemon') {
        this._log('服下突破丹，气机冲关——心魔现前。');
        this._log('心魔（' + G.Player.realmInfo(this.es[0].level).n + '）：照见的是你自己。');
      } else if (this.es.length > 1) {
        this._log('遭遇 ' + this.es.map(function (e) { return e.name; }).join('、'));
      } else {
        this._log('遭遇 ' + this.es[0].name + '（' + G.Player.realmInfo(this.es[0].level).n + '）');
      }
      this._log('请选择行动。');
      this.phase = 'command';
      this._buildCommand();
    },

    _initUnits: function () {
      var save = G.game.save;
      var st = G.Player.computeStats(save);

      /* 我方主动技（v0.69.0 激活制）：**只取 `save.skillEquip` 里已激发的功法**。
         ⚠️ 用户新需求覆盖旧设计 —— 归档《战斗系统修订 v2.1》§2 原写"所有已学功法
           在每场战斗均可使用（无装配上限）"，用户明确改成「可学多本、**单本激发**」。
         取数一律走 `Player.equippedIds`（它内含 canUseSkill 过滤），
         不在战斗里重写一遍门禁 —— 面板显示与这里必须同源。
         槽位上限 3 由 `Player.ACTIVE_SLOTS` 给（面板按钮读同一个常量）。 */
      var atkSkills = [], healSkills = [];
      var equipped = (G.Player.equippedIds ? G.Player.equippedIds(save) : [])
        .slice(0, G.Player.ACTIVE_SLOTS || 3);
      equipped.forEach(function (id) {
        var sd = G.Data.skills[id];
        if (!sd) return;
        /* 法力消耗随**功法等级**涨（v0.14.0）：装配时算一次挂在技能条目上，
           结算与按钮禁用读同一个数 —— 每处各算一遍必然漂。 */
        var lv = (save.skills[id] && save.skills[id].lv) || 1;
        var cost = G.Player.manaCost(sd, lv);
        /* 九重进度系数（v0.69.0）：prog 只在**玩家侧**乘（敌方 skill 是即时构造的，
           没有 prog）。挂在条目上，面板显示与结算读同一个数。 */
        var pc = G.Player.progCoef ? G.Player.progCoef(lv) : 1;
        if (sd.kind === '攻击' && sd.mult) {
          atkSkills.push({ id: id, n: sd.n, mult: +(sd.mult * pc).toFixed(3), cd: sd.cd || 0, cdLeft: 0,
            hit: sd.hit, elem: sd.elem, status: sd.status, target: sd.target, kind: 'atk',
            lv: lv, progCoef: pc, cost: cost });
        } else if (sd.active) {
          healSkills.push({ id: id, n: sd.active.n, mult: 0, heal: +(sd.active.heal * pc).toFixed(3),
            cd: sd.active.cd || 0, cdLeft: 0, hit: sd.active.hit, elem: sd.elem, kind: 'heal',
            lv: lv, progCoef: pc, cost: cost });
        }
      });
      /* 主动槽为空时的兜底普攻：**不耗法力**（耗了就会出现"一点法力都没有时只能站着"的死局）。
         注意这不是"没激发功法"的惩罚 —— 普攻本来就一直存在（指令区的「攻击」）。 */
      var skills = atkSkills.concat(healSkills).slice(0, G.Player.ACTIVE_SLOTS || 3);
      /* 未激发功法时的默认（v0.75.0，用户口径「没有激发，进入战斗会默认选择第一本
         等级最高的功法」）：激发上限已收成 1 本，但玩家可能一本都没激发 ——
         空白技能栏会让人以为"学了功法不能用"（正是 v0.69.0 修过的那类静默）。
         这里补一本**等级最高**的顶上；`defaultSkillId` 是唯一挑选口径。 */
      if (!skills.length && G.Player.defaultSkillId) {
        var dft = G.Player.defaultSkillId(save);
        if (dft) {
          var dd = G.Data.skills[dft];
          var dlv = (save.skills[dft] && save.skills[dft].lv) || 1;
          var dpc = G.Player.progCoef ? G.Player.progCoef(dlv) : 1;
          if (dd && dd.kind === '攻击' && dd.mult) {
            skills.push({ id: dft, n: dd.n, mult: +(dd.mult * dpc).toFixed(3), cd: dd.cd || 0,
              cdLeft: 0, hit: dd.hit, elem: dd.elem, status: dd.status, target: dd.target,
              kind: 'atk', lv: dlv, progCoef: dpc, cost: G.Player.manaCost(dd, dlv) });
          } else if (dd && dd.active) {
            skills.push({ id: dft, n: dd.active.n, mult: 0, heal: +(dd.active.heal * dpc).toFixed(3),
              cd: dd.active.cd || 0, cdLeft: 0, hit: dd.active.hit, elem: dd.elem,
              kind: 'heal', lv: dlv, progCoef: dpc, cost: G.Player.manaCost(dd, dlv) });
          }
        }
      }
      if (!skills.length) {
        skills.push({ id: 'basic', n: '凝气拳', mult: 1.0, cd: 0, cdLeft: 0,
          elem: st.attackElem, kind: 'atk', lv: 1, progCoef: 1, cost: 0 });
      }

      this.p = {
        name: '陆尘', side: 'left',
        level: save.globalLevel,
        maxhp: st.maxhp, hp: Math.max(1, save.hp),
        /* 法力：**每场开战回满**（战斗内资源，不落盘）。
           落盘会让玩家在探索时被"没蓝"卡住，且要额外处理打坐/休息回蓝 —— 收益为零。 */
        mpMax: st.mpMax, mp: st.mpMax,
        atk: st.atk, def: st.def, spd: st.spd,
        crit: st.crit, critDmg: st.critDmg,
        elem: st.attackElem, im: st.im,
        skills: skills, buffs: { atk: 0, turns: 0 },
        guard: false, statuses: {}, shield: 0
      };
      /* 已装备法宝（武器/防具/饰品 —— 用户口径「戒指」指的就是饰品那一槽）：
         存一份给绘制用。**法宝的数值加成早就进 computeStats 了**（equipFx），
         这里只是把它**显示出来** —— 此前战斗界面完全不体现"我穿了三件什么"，
         玩家换了法宝只能去角色面板看，战斗中感受不到（纯静默的表现层缺失）。
         数组**按 SLOTS 定长**（空槽为 null）：位置恒定，玩家一眼就知道哪格空着；
         过滤空槽会让饰品"漂"到第一格，反而看不懂。 */
      this.equippedList = [];
      var eqp = save.equip || {};
      G.Data.equips.SLOTS.forEach(function (sl) {
        var eid = eqp[sl];
        /* ⚠️ 必须**定长**（空槽推 null），不能\"有才推\" —— 否则穿了武器+饰品时
           会画成两格，玩家读不出\"我缺的是防具\"，而且位置会随装备变化跳动。
           定长后 1~3 件位置恒定，与面板法宝子页的三槽一一对应。 */
        this.equippedList.push(eid ? G.Data.equips.byId(eid) : null);
      }, this);
      this._applySecretPassives();

      /* 敌方：脚本分支优先，其次参数里的敌群/单敌 */
      var p = this.params, list;
      if (p.script === 'killer') list = [G.Data.makeKiller()];
      else if (p.script === 'wolfKing') {
        list = [G.Data.makeWolfKing(save.world && save.world.names ? save.world.names.beastKing : null)];
      } else if (p.script === 'heartDemon') {
        /* 问心魔劫按**任务步**分派（M0 的炼气破境 / M1 的筑基破境共用同一条 script）：
           · 默认 = M0 心魔（makeHeartDemon）
           · m1-6 = 筑基心魔劫，**强化版** makeHeartDemon2（开局召心魔残影，设计 §5.3）
           不分派的话，M1 玩家筑基时会被拖回 M0 的心魔面板（弱一档），
           而且胜利分支里那句硬编码的 step='m0-5' 会把整条 M1 主线打回去。 */
        var hdQ = save.quest;
        if (hdQ && hdQ.step === 'm1-6') {
          list = [G.Data.makeHeartDemon2({
            level: save.globalLevel, maxhp: st.maxhp,
            atk: st.atk, def: st.def, spd: st.spd
          })];
        } else {
          list = [G.Data.makeHeartDemon({
            level: save.globalLevel, maxhp: st.maxhp,
            atk: st.atk, def: st.def, spd: st.spd
          })];
        }
      } else if (p.script === 'tribulation') {
        /* 天劫镜像（v0.75.0，用户口径）：面板**逐项等于主角**，技能 =
           主角已学功法里**随机一本、按九重满级**编译（"随机激发一本九重的功法"）。
           为什么把 lv 钉成 36：用户原话要的是"九重"；若照搬主角当前 lv，
           天劫会跟着玩家一起弱，镜像就失去"越级试炼"的意义。 */
        var tPool = [];
        Object.keys(save.skills || {}).forEach(function (id) {
          var sd2 = G.Data.skills[id];
          if (!sd2) return;
          if (G.Player.canUseSkill && !G.Player.canUseSkill(save, id)) return;
          if (sd2.kind === '攻击' && sd2.mult) {
            tPool.push({ id: id, n: sd2.n, mult: +(sd2.mult * G.Player.progCoef(36)).toFixed(3),
              cd: sd2.cd || 0, hit: sd2.hit, elem: sd2.elem, status: sd2.status,
              target: sd2.target, kind: 'atk' });
          } else if (sd2.active) {
            tPool.push({ id: id, n: sd2.active.n, mult: 0,
              heal: +(sd2.active.heal * G.Player.progCoef(36)).toFixed(3),
              cd: sd2.active.cd || 0, hit: sd2.active.hit, elem: sd2.elem, kind: 'heal' });
          }
        });
        list = [G.Data.makeTribulation({
          level: save.globalLevel, maxhp: st.maxhp,
          atk: st.atk, def: st.def, spd: st.spd, skills: tPool
        })];
      } else if (p.script === 'probe') {
        /* M1 §4 m1-2：外堂探子撕下伪装。L = 本世 gl+1，上限 17
           （设计明写"上限 17" —— 别让高境界玩家把这场的等级抬到荒谬）。 */
        list = [G.Data.makeEnemy('血煞教徒', Math.min(68, (save.globalLevel || 1) + 1), '血煞教探子')];
      } else if (p.script === 'sectTrial') {
        /* 宗门入门试炼（《宗门与散修体系设计 v1.0》S2）：一场切磋。
           用人形敌人换名；等级取主角 gl−2（过得去但不白给）。 */
        list = [G.Data.makeEnemy('血煞教徒',
          Math.max(1, (save.globalLevel || 1) - 2), '试炼傀儡')];
      } else if (p.script === 'xuemian') {
        /* M1 §4 m1-5：执事「血面」。面板**固定 L19**（设计 §5.3），不随主角成长 ——
           这是剧情战，靠沈伯燃命 + 主角补刀收场，不是数值对拼。
           抉择 2 = 护沈伯先走时沈伯已缠斗过一阵 → 血面带伤开局（bossHpPct）。 */
        var xm = G.Data.makeXuemian();
        if (p.bossHpPct) {
          xm.maxhp = Math.max(1, Math.round(xm.maxhp * p.bossHpPct));
          xm.hp = xm.maxhp;
        }
        list = [xm];
      } else if (p.enemies && p.enemies.length) list = p.enemies.slice();
      else list = [p.enemy || G.Data.makeEnemy('青纹蛇', 3, '青纹蛇')];

      this.es = list.slice(0, MAX_E);
      this.es.forEach(function (e, i) {
        e.key = 'E' + i;
        e.hp = e.maxhp;
        e.buffs = e.buffs || { atk: 0, turns: 0 };
        e.guard = false;
        e.statuses = e.statuses || {};
        e.im = e.im || [];
        e.charge = null;
        e.shield = e.shield || 0;
        e._phDone = {};
        e.skills = e.skills || [];
        e.skills.forEach(function (s) { if (s.cdLeft == null) s.cdLeft = 0; });
      });

      /* 出战灵兽（《灵兽 v1.1》§5）：取 beastTeam 首位，自主行动的友方单位 */
      this.beast = null;
      var yb = (G.Formations && G.Formations.has(save, 'yushou')) ? 1.2 : 1;
      var bUid0 = save.beastTeam && save.beastTeam[0];
      if (bUid0 != null) {
        var bInd0 = G.Beasts.byUid(save, bUid0);
        if (bInd0 && G.Data.beasts.canBattle(bInd0.id) && bInd0.gl <= (save.globalLevel || 1)) {
          var bDsp0 = G.Data.beasts.byId(bInd0.id), bCst0 = G.Beasts.combatStat(bInd0);
          this.beast = {
            name: bInd0.name, side: 'left', isBeast: true,
            species: bDsp0.n, artKey: bDsp0.id, sprite: BEAST_UNIT_SPRITE[bDsp0.id] || 'snake',
            level: bInd0.gl, maxhp: Math.round(bCst0.hp * yb), hp: Math.round(bCst0.hp * yb),
            atk: Math.round(bCst0.atk * yb), def: Math.round(bCst0.def * yb), spd: bCst0.spd,
            crit: 0.05, critDmg: 1.5, elem: bDsp0.elem, im: [],
            skills: [], buffs: { atk: 0, turns: 0 }, guard: false,
            statuses: {}, shield: 0, charge: null, _indUid: bInd0.uid
          };
        }
      }

      /* ===== B4 骑乘作战（《灵兽 v1.1》§6.4）===== */
      this.mount = null; this._mountDown = false; this._mountBonus = null;
      this._chargeUsed = false; this._cavalryFirst = false;
      var rUid = save.riding && save.riding.uid;
      if (rUid != null) {
        var rInd = G.Beasts.byUid(save, rUid);
        if (rInd && G.Data.beasts.canRide(rInd)) {
          var rSp = G.Data.beasts.byId(rInd.id);
          if (rSp.role === 'both') {
            /* 战骑：人车一体（若同时占独立出战位，骑乘优先；一体时不单独行动） */
            this.beast = null;
            var rCst = G.Beasts.combatStat(rInd);
            this.mount = {
              name: rInd.name, level: rInd.gl, artKey: rSp.id,
              maxhp: Math.round(rCst.hp * yb), hp: Math.round(rCst.hp * yb), atk: Math.round(rCst.atk * yb), def: Math.round(rCst.def * yb),
              sprite: BEAST_UNIT_SPRITE[rSp.id] || 'snake', _indUid: rInd.uid
            };
            /* ① 主人得灵兽 20% 攻防血 */
            var mBH = Math.round(rCst.hp * 0.2 * yb), mBA = Math.round(rCst.atk * 0.2 * yb),
                mBD = Math.round(rCst.def * 0.2 * yb);
            this.p.maxhp += mBH; this.p.hp += mBH;
            this.p.atk += mBA; this.p.def += mBD;
            this._mountBonus = { hp: mBH, atk: mBA, def: mBD };
            this._cavalryFirst = true;
          } else {
            /* 普通坐骑：阵前自动下马，保留第 1 回合冲锋红利 */
            G.Beasts.dismount(save);
            this._cavalryFirst = true;
            this._log('坐骑在阵前止步，你翻身下马，借势冲锋。');
          }
        }
      }

      this._layout();
      this._resetTrackers();
    },

    /* 按敌人数与 Boss 存在与否分配站位；召唤后重排。
       单敌：站中景（Boss 略大）。多敌：排成一条由近及远的斜线，
       最末一只为「后排」，其余为「前排」——对应 v0.2 §5「双方均分前后排」。 */
    _layout: function () {
      var es = this.es, n = es.length;
      if (n === 1) {
        es[0].pos = es[0].boss ? BOSS_SLOT : SOLO_SLOT;
        es[0].front = true;
        return;
      }
      for (var i = 0; i < n; i++) {
        var e = es[i];
        var base = MULTI_SLOTS[Math.min(i, MULTI_SLOTS.length - 1)];
        /* Boss 在多敌中仍保持体型优势，位置沿用所在槽 */
        e.pos = e.boss ? { x: base.x, y: base.y - 8, s: Math.max(base.s, 62) } : base;
        e.front = i < n - 1;
      }
    },

    _resetTrackers: function () {
      var self = this;
      this.shown = {};
      this.lunge = {}; this.lungeT = {}; this.flash = {}; this.chargeMark = {};
      this._keys().forEach(function (k) {
        var u = self._unit(k);
        self.shown[k] = u.hp;
        self.lunge[k] = 0; self.lungeT[k] = 0; self.flash[k] = 0; self.chargeMark[k] = null;
      });
    },

    /* ===== 秘术·战斗被动（神术）初始化 =====
       血海=全局吸血 / 诛邪=命中概率封印 / 枯荣=受击回血次数 / 四象=开局护盾 */
    _applySecretPassives: function () {
      var save = G.game.save, Dg = G.Data.dungeons, p = this.p;
      p.shield = 0; p._secretVamp = 0; p._zhuxie = 0;
      p._kurongLeft = 0; p._kurong = null; p._mangshan = 0; p._secretUsed = {};
      var secs = save.secrets || {};
      Object.keys(secs).forEach(function (id) {
        var ef = Dg.secretEffectById(id);
        if (!ef) return;
        var g = Dg.gradeOf(save, id);
        if (ef.vamp) p._secretVamp += ef.vamp * g;
        if (ef.zhuxie) p._zhuxie = Math.max(p._zhuxie, ef.zhuxie);
        if (ef.kurong) {
          p._kurongLeft = Math.max(p._kurongLeft, ef.kurong.max);
          p._kurong = { chance: ef.kurong.chance, pct: ef.kurong.pct * g };
        }
        if (ef.mangshan) p._mangshan = Math.max(p._mangshan, Math.round(ef.mangshan * g));
        if (ef.startShield) {
          p.shield = Math.max(p.shield, Math.round(p.maxhp * ef.startShield * g));
        }
      });
    },

    /* ===== 单位寻址 ===== */
    _keys: function () {
      var ks = ['P'];
      if (this.beast) ks.push('B');
      for (var i = 0; i < this.es.length; i++) ks.push('E' + i);
      return ks;
    },
    _unit: function (key) {
      if (!key) return null;
      if (key === 'P') return this.p;
      if (key === 'B') return this.beast;
      if (key === 'M') return this.mount;
      var i = parseInt(String(key).slice(1), 10);
      if (isNaN(i)) return null;
      return this.es[i] || null;
    },
    _pos: function (key) {
      if (key === 'P') return HERO_POS;
      if (key === 'B') return BEAST_POS;
      if (key === 'M') return { x: HERO_POS.x + 6, y: HERO_POS.y + 14, s: HERO_POS.s + 14 };
      var u = this._unit(key);
      return (u && u.pos) || SOLO_SLOT;
    },
    _aliveEs: function () {
      var a = [];
      for (var i = 0; i < this.es.length; i++) if (this.es[i].hp > 0) a.push(this.es[i]);
      return a;
    },
    /* 我方存活单位（敌方全体技的目标；未来扩展队友时在此归并） */
    _alivePlayer: function () {
      var a = [];
      if (this.p.hp > 0) a.push(this.p);
      if (this.beast && this.beast.hp > 0) a.push(this.beast);
      return a;
    },

    /* ===== 指令区（v0.3 §10 裁剪；v0.69.0 用户口径「取消独立防御」→ 攻击 / 功法 / 道具 / 逃跑 / 自动） =====
       为什么去掉「防御」：玩家现在有**三个主动功法槽**（`Player.ACTIVE_SLOTS`），
       防御型功法（铁布衫/磐石功…）走 `computeStats` 直接抬 DEF，
       再挂一个独立「防御」按钮等于给同一条思路开两个口子 ——
       玩家要么点它、要么装防御功法，两者互相稀释。
       指令收敛到 5 个（3+2 布局）。`guard` 减伤机制**保留**（伤害结算仍认
       `def.guard`，供未来的防御类主动技/ Boss 阶段使用），只是玩家侧不再有独立入口。 */
    _buildCommand: function () {
      var self = this;
      var labels = ['攻击', '功法', '道具', '逃跑', '自动'];
      var btns = [];
      labels.forEach(function (lb, i) {
        var col = i % 3, row = Math.floor(i / 3);
        var b = new G.UI.Btn({
          x: 14 + col * 152, y: 208 + row * 32, w: 142, h: 28,
          small: true,
          variant: i === 0 ? 'gold' : (lb === '逃跑' ? 'danger' : 'battle'),
          label: lb,
          onClick: function () { self._cmd(lb, this); }
        });
        b._key = lb;
        btns.push(b);
      });
      this.buttons = btns;
      /* 基准指令按钮留一份（v0.11.2）：功法/道具下拉要从**这一份**重建，
         不能拿 this.buttons 过滤 —— 否则「功法 → 道具」连点会把两个下拉叠在一起。 */
      this._cmdBtns = btns.slice();
      this._dropRect = null;
      this.cmdTimer = CMD_TIMER;  /* 进入 command 阶段重置（v0.11.2） */
      this._syncCmdState();
    },

    _syncCmdState: function () {
      for (var i = 0; i < this.buttons.length; i++) {
        var b = this.buttons[i];
        if (!b._key) continue;
        if (b._key === '逃跑') {
          b.disabled = this._noFlee() || this.fleeTries >= MAX_FLEE;
          b.label = this.fleeTries >= MAX_FLEE ? '逃跑(尽)' : '逃跑';
        }
        if (b._key === '自动') b.label = this.auto ? '自动中' : '自动';
        /* 功法按钮：一条都放不出来时标「(乏)」（法力或冷却）。
           按钮**不置灰** —— 点开下拉能看到每一条各自的"冷却/法力不足"原因，
           直接禁用等于把唯一的信息来源也关掉了。 */
        if (b._key === '功法') {
          var ok = false;
          for (var k = 0; k < this.p.skills.length; k++) {
            var s = this.p.skills[k];
            if (s.cdLeft <= 0 && this.p.mp >= (s.cost || 0)) { ok = true; break; }
          }
          b.label = ok ? '功法' : '功法(乏)';
        }
      }
    },

    /* Boss / 剧情战 / 心魔战禁用逃跑（v0.2 §10）。
       显式 noFlee 优先：M1 据点的连战节点是**普通敌群**（没有 script、也没有 boss 标记），
       但同样是"剧情战不可逃"—— 靠 script 兜底的话这里会漏。 */
    _noFlee: function () {
      if (this.params.noFlee) return true;
      if (this.params.script) return true;
      for (var i = 0; i < this.es.length; i++) if (this.es[i].boss) return true;
      return false;
    },

    _cmd: function (lb) {
      var self = this;
      if (lb === '攻击') { this._pickTarget(null); return; }
      if (lb === '功法') {
        if (this.p.statuses['封']) { this._log('封印未解，功法无从施展。'); return; }
        this._openSkill(); return;
      }
      if (lb === '道具') { this._openItem(); return; }
      if (lb === '逃跑') {
        if (this._noFlee()) { this._log('此战避无可避。'); return; }
        if (this.fleeTries >= MAX_FLEE) { this._log('已被缠住，走不脱了。'); return; }
        this.fleeTries += 1;
        /* 成功率 = 我方均速 ÷ (我方均速 + 敌方均速)，下限 10%、上限 90% */
        var my = this._effSpd(this.p);
        var alive = this._aliveEs();
        var sum = 0;
        for (var i = 0; i < alive.length; i++) sum += this._effSpd(alive[i]);
        var en = alive.length ? sum / alive.length : 0;
        var ch = en <= 0 ? 0.9 : my / (my + en);
        ch = Math.max(0.10, Math.min(0.90, ch));
        if (Math.random() < ch) {
          this._log('你抽身而退。');
          this._cut([[0.5, function () { self._leave(); }]]);
        } else {
          this._log('逃走失败！（第 ' + this.fleeTries + '/' + MAX_FLEE + ' 次）');
          this._playerAction(null, this._aliveEs()[0].key);
        }
        return;
      }
      if (lb === '自动') { this.auto = !this.auto; this._syncCmdState(); return; }
    },

    _openSkill: function () {
      var self = this;
      var entries = [];
      this.p.skills.slice(0, 4).forEach(function (sk) {
        entries.push({ kind: 'skill', sk: sk });
      });
      var Dg = G.Data.dungeons, save = G.game.save;
      Object.keys(save.secrets || {}).forEach(function (id) {
        var ef = Dg.secretEffectById(id);
        if (ef && ef.cat === '仙') entries.push({ kind: 'secret', id: id, ef: ef });
      });
      /* 下拉上限 5 条（v0.11.2 改：原 8 条改成上浮下拉，再多就顶到顶栏） */
      entries = entries.slice(0, 5);

      /* 下拉挂的位置 = 功法按钮正上方（功法按钮已被替换为「关闭」） */
      var x0 = 14 + 1 * 152, y0 = 208 - entries.length * 22 - 2, w = 142;

      var dropdown = [];
      entries.forEach(function (en, i) {
        var y = y0 + i * 22;
        if (en.kind === 'skill') {
          var sk = en.sk, ready = sk.cdLeft <= 0;
          /* 法力不足 = 不可用（v0.14.0）。与冷却**分开判、合并显示** ——
             两条原因都要能一眼看出来，否则玩家只看到"按钮灰着"会以为是 bug。 */
          var poor = self.p.mp < (sk.cost || 0);
          var ec = sk.elem && sk.elem !== '无' ? '　' + sk.elem : '';
          var tail = sk.cdLeft > 0 ? '（冷却 ' + sk.cdLeft + '）'
            : (sk.cost > 0 ? '（法力 ' + sk.cost + '）' : '');
          dropdown.push(new G.UI.Btn({
            x: x0, y: y, w: w, h: 20, small: true, disabled: !ready || poor,
            variant: 'battle',
            label: sk.n + ec + tail,
            sub: poor ? '法力不足 ' + self.p.mp + '/' + sk.cost : null,
            subFs: 9, subColor: '#e08a7a',
            onClick: function () {
              if (sk.kind === 'heal') { self._playerAction(sk, 'P'); return; }
              self._pickTarget(sk);
            }
          }));
        } else {
          var used = self.p._secretUsed[en.id];
          dropdown.push(new G.UI.Btn({
            x: x0, y: y, w: w, h: 20, small: true, disabled: !!used,
            variant: 'gold',
            label: Dg.SECRETS[en.id] + (used ? '（已用）' : '　秘术'),
            onClick: function () { self._castSecret(en.id); }
          }));
        }
      });
      /* 关闭按钮占原 功法 按钮位置（点击回到 command 阶段） */
      dropdown.push(new G.UI.Btn({
        x: x0, y: 208, w: w, h: 28, small: true, variant: 'battle', label: '关闭',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      /* 下拉排在数组前面（hit-test 优先：buttons[0] 是第一条主动技），
         后跟其余指令按钮。视觉无冲突：下拉 y 96..186 vs 指令 y 208..268。
         基准取 `_cmdBtns`（不是 this.buttons）—— 连点「功法→道具」不会叠两个下拉。 */
      var rest = (this._cmdBtns || this.buttons).filter(function (b) { return b._key !== '功法'; });
      this.buttons = dropdown.concat(rest);
      /* 下拉背板矩形（渲染时铺一层不透明底，否则日志文字会透出来） */
      this._dropRect = { x: x0 - 3, y: y0 - 3, w: w + 6, h: 236 - (y0 - 3) };
      this.phase = 'skill';
    },

    /* 施放仙术主动秘术：按 cast.target 路由（self 治疗 / single 选目标 / all 直接出手）。
       数值随品阶 grade；每场每道限一次。 */
    _castSecret: function (id) {
      var self = this, Dg = G.Data.dungeons, save = G.game.save;
      var ef = Dg.secretEffectById(id), c = ef.cast, grade = Dg.gradeOf(save, id);
      this.p._secretUsed[id] = true;

      var sk = {
        n: Dg.SECRETS[id], elem: c.elem || '无', kind: 'atk',
        _secret: true
      };
      if (c.mult) sk.mult = +(c.mult * grade).toFixed(2);
      if (c.status) sk.status = c.status;
      if (c.pierce) sk.pierce = c.pierce;

      if (c.target === 'self') {
        sk.kind = 'healSelf';
        sk.healSelf = +(c.healSelf * grade).toFixed(2);
        this._playerAction(sk, 'P');
        return;
      }
      sk.target = c.target === 'all' ? '全体' : (c.target || 'single');
      if (sk.target === '全体') {
        var alive = this._aliveEs();
        if (!alive.length) { this._victory(); return; }
        this._playerAction(sk, alive[0].key);
        return;
      }
      this._pickTarget(sk);
    },

    _openItem: function () {
      var self = this;
      var save = G.game.save;
      var names = Object.keys(save.items || {}).filter(function (k) {
        return (CONSUM[k] || CAPTURE_BAGS[k]) && save.items[k] > 0;
      }).slice(0, 8);
      if (!names.length) { this._log('囊中并无可用之物。'); return; }

      /* 下拉挂在 道具 按钮正上方（道具按钮已被替换为「关闭」），与功法下拉同一形态（v0.11.2） */
      var x0 = 14 + 2 * 152, y0 = 208 - names.length * 22 - 2, w = 142;
      var dropdown = [];
      names.forEach(function (nm, i) {
        dropdown.push(new G.UI.Btn({
          x: x0, y: y0 + i * 22, w: w, h: 20, small: true, variant: 'battle',
          label: nm + ' ×' + save.items[nm],
          onClick: function () { if (CAPTURE_BAGS[nm]) self._useBag(nm); else self._useItem(nm); }
        }));
      });
      dropdown.push(new G.UI.Btn({
        x: x0, y: 208, w: w, h: 28, small: true, variant: 'battle', label: '关闭',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      var rest = (this._cmdBtns || this.buttons).filter(function (b) { return b._key !== '道具'; });
      this.buttons = dropdown.concat(rest);
      this._dropRect = { x: x0 - 3, y: y0 - 3, w: w + 6, h: 236 - (y0 - 3) };
      this.phase = 'item';
    },

    /* 目标选择：单敌自动锁定；多敌进入选目标浮层。
       技能若写死 target='前排'/'后排'，则只在该行内选（该行为空时退回全体存活）；
       M0 玩家功法无「全体」技，故不在此处理全体（v0.2 §6.2）。 */
    _pickTarget: function (sk) {
      var alive = this._aliveEs();
      if (!alive.length) return;
      var pool = alive;
      var row = sk && sk.target;
      if (row === '前排' || row === '后排') {
        var f = alive.filter(function (e) { return row === '前排' ? e.front : !e.front; });
        if (f.length) pool = f;
      }
      if (pool.length === 1) { this._playerAction(sk, pool[0].key); return; }
      var self = this, btns = [];
      pool.forEach(function (e, i) {
        btns.push(new G.UI.Btn({
          x: 22 + (i % 2) * 218, y: 58 + Math.floor(i / 2) * 26, w: 206, h: 24,
          small: true,
          label: e.name + (e.front ? '·前排' : '·后排') + '　'
            + Math.max(0, Math.round(e.hp)) + '/' + e.maxhp,
          onClick: function () { self._playerAction(sk, e.key); }
        }));
      });
      btns.push(new G.UI.Btn({
        x: 190, y: 164, w: 100, h: 22, small: true, variant: 'ghost', label: '返回',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      this.buttons = btns;
      this.phase = 'target';
    },

    _useItem: function (nm) {
      var self = this, save = G.game.save;
      var it = CONSUM[nm];
      save.items[nm] -= 1;
      if (save.items[nm] <= 0) delete save.items[nm];
      G.Storage.saveCurrent(save);
      this.pSkill = { n: nm, kind: 'item' };
      this.pTarget = 'P';
      this.phase = 'exec';
      this.buttons = [];
      var steps = [];
      if (it.heal) {
        var amt = Math.round(this.p.maxhp * it.heal);
        steps.push([0.35, function () {
          self._heal('P', amt);
          self._log('服下 ' + nm + '，回复 ' + amt + ' 气血。');
        }]);
      } else if (it.qi) {
        save.qi = (save.qi || 0) + it.qi;
        steps.push([0.3, function () { self._log('服下 ' + nm + '，灵气 +' + it.qi + '。'); }]);
      } else {
        steps.push([0.3, function () { self.p.statuses = {}; self._log('服下 ' + nm + '，异常尽解。'); }]);
      }
      this._cut(steps, function () { self._resolve(); });
    },

    /* ===== 妖囊收服（design B3 第一块，《御兽 v0.2》§2） ===== */
    _useBag: function (nm) {
      var self = this;
      var alive = this._aliveEs();
      if (!alive.length) { this._log('已无可收服之敌。'); return; }
      var btns = [];
      alive.forEach(function (e) {
        var can = !!CAPTURABLE[e.species] && !e.boss;
        btns.push(new G.UI.Btn({
          x: 22, y: 58 + (btns.length) * 26, w: 206, h: 24, small: true,
          label: e.name + '　' + Math.max(0, Math.round(e.hp)) + '/' + e.maxhp + (can ? '' : '·不可收服'),
          disabled: !can,
          onClick: function () { self._doCapture(e.key, nm); }
        }));
      });
      btns.push(new G.UI.Btn({
        x: 190, y: 164, w: 100, h: 22, small: true, variant: 'ghost', label: '返回',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      this.buttons = btns; this.phase = 'target';
    },
    _doCapture: function (targetKey, nm) {
      var self = this, save = G.game.save, meta = G.game.meta || {};
      var tgt = this._unit(targetKey);
      var speciesId = tgt && CAPTURABLE[tgt.species];
      var back = function () { self.phase = 'command'; self._buildCommand(); };
      if (!tgt || !speciesId || tgt.boss) {
        this._log('此非可收服之兽。'); this._cut([[0.4, function () {}]], back); return;
      }
      if (save.beasts.length >= G.Data.beasts.CAP) {
        this._log('兽栏已满，收服不得。'); this._cut([[0.4, function () {}]], back); return;
      }
      var stc = 1.0, sm = { '毒': 1.1, '烧': 1.1, '封': 1.2, '麻': 1.3, '睡': 1.5 };
      Object.keys(tgt.statuses || {}).forEach(function (k) { if (sm[k]) stc = Math.max(stc, sm[k]); });
      var bg = CAPTURE_BAGS[nm];
      var miss = 1 - tgt.hp / tgt.maxhp;
      var rate = Math.max(0.06 * bg * stc, 0.30 * miss * bg * stc);
      rate = Math.min(0.95, Math.max(0.01, rate));
      save.items[nm] = (save.items[nm] || 0) - 1;
      if (save.items[nm] <= 0) delete save.items[nm];
      var ok = Math.random() < rate;
      var steps = [[0.35, function () {
        self._log('你掷出「' + nm + '」，妖囊将 ' + tgt.name + ' 罩住……');
      }]];
      if (ok) {
        var first = !(meta.bestiary && meta.bestiary[speciesId]);
        var gl = tgt.level, mGl = G.Data.beasts.matureGl(speciesId);
        var stage = (mGl == null || gl >= mGl) ? 'adult' : 'young';
        var res = G.Beasts.add(save, speciesId, { gl: gl, stage: stage });
        if (res.ok) {
          tgt.hp = 0; tgt._captured = true;
          steps.push([0.4, function () {
            self.shake = 3;
            self._log('妖囊三晃 —— 收服成功！' + res.beast.name + ' 入了兽栏。');
            if (first) {
              save.stone = (save.stone || 0) + 50;
              self._log('图鉴首录「' + G.Data.beasts.byId(speciesId).n + '」，灵石 +50。');
            }
          }]);
        } else {
          steps.push([0.3, function () { self._log(res.reason + '，妖囊空耗。'); }]);
        }
      } else {
        steps.push([0.4, function () { self._log(tgt.name + ' 奋力挣破妖囊，跌了出来！'); }]);
      }
      this._cut(steps, function () {
        G.Storage.saveCurrent(save);
        self.pSkill = { n: nm, kind: 'item' };
        self.pTarget = 'P';
        self._resolve();
      });
    },

    /* ===== 行动流程 =====
       一回合 = 我方 + 存活敌方的有效速度归并排序 → 各自"行动开始结算" → 出手 → 回合结束 */
    _effSpd: function (u, order) {
      var v = (u.spd || 0) * (u.statuses && u.statuses['麻'] ? 0.7 : 1);
      /* B4 骑兵：仅排序时加先手权重，显示数字走基础速度 */
      if (order !== false && u === this.p && this.round === 1 && this._cavalryFirst) v += 100000;
      return v;
    },

    _playerAction: function (skill, targetKey) {
      this.pSkill = skill;
      this.pTarget = targetKey || 'P';
      this._resolve();
    },

    _resolve: function () {
      var self = this;
      this.phase = 'exec';
      this.buttons = [];
      this._dropRect = null;

      var actors = [{ key: 'P', u: this.p }];
      if (this.beast && this.beast.hp > 0) actors.push({ key: 'B', u: this.beast });
      this.es.forEach(function (e, i) {
        if (e.hp > 0) actors.push({ key: 'E' + i, u: e });
      });
      actors.sort(function (a, b) {
        return self._effSpd(b.u) - self._effSpd(a.u);
      });

      var i = 0;
      function next() {
        if (self.over) return;
        if (self.p.hp <= 0) { self._defeat(); return; }
        if (!self._aliveEs().length) { self._victory(); return; }
        if (i >= actors.length) { self._endRound(); return; }
        var a = actors[i++];
        var u = a.u;
        if (u.hp <= 0) { next(); return; }

        /* Boss 阶段技：血量过线时召唤 / 狂暴 */
        if (u.boss) self._bossPhase(u);

        /* 行动开始：先结算 DOT，再判睡眠；DOT 致死则跳过本回合行动 */
        var canAct = self._tickStatus(u, a.key);
        if (u.hp <= 0) { next(); return; }
        if (!canAct) { next(); return; }

        if (a.key === 'B') {
          var btgt = self._unit(self._beastTargetKey());
          if (!btgt) { next(); return; }
          self._act(u, btgt, 'B', btgt.key, self._beastPick(u), next);
        } else if (a.key === 'P') {
          var sk = self.pSkill;
          self.pSkill = null;
          if (sk && (sk.kind === 'item' || sk.kind === 'guard')) {
            self._cut([[0.12, function () {}]], next);
            return;
          }
          var tgt = self._unit(self.pTarget);
          if (!tgt || tgt.hp <= 0) {
            var alive = self._aliveEs();
            if (!alive.length) { self._victory(); return; }
            tgt = alive[0];
          }
          /* 法力扣除（v0.14.0）：在**真正出手那一刻**扣，不在点按钮时扣 ——
             点技能还会经过选目标（`_pickTarget`），中途可能取消；
             提前扣就会出现"取消也扣蓝"。 */
          if (sk && sk.cost > 0) {
            self.p.mp = Math.max(0, self.p.mp - sk.cost);
            self._float('P', '法力 -' + sk.cost, '#9ab8ff');
          }
          /* B4 冲阵：首轮第一次出手 1.5×（先手已在排序里保证） */
          var chargeSk = sk;
          if (self.mount && !self._chargeUsed && self.round === 1
            && (!sk || sk.kind === 'atk' || sk.mult != null)) {
            chargeSk = {};
            if (sk) { for (var kc in sk) chargeSk[kc] = sk[kc]; }
            chargeSk.mult = (sk && sk.mult != null ? sk.mult : 1) * 1.5;
            self._chargeUsed = true;
            self._log('战马冲阵，势如奔雷！');
          }
          self._act(self.p, tgt, 'P', tgt.key, chargeSk, next);
        } else {
          var etK = self._enemyTargetKey();
          self._act(u, self._unit(etK), a.key, etK, self._enemyPick(u), next);
        }
      }
      next();
    },

    /* Boss 血量阈值技：有 phases 配置走通用引擎，否则退回 M0 狼王写死逻辑。 */
    _bossPhase: function (boss) {
      if (boss.phases && boss.phases.length) { this._genericPhases(boss); return; }
      this._wolfPhases(boss);
    },

    /* 通用阶段：每条 phase 血量过线一次（done 标记挂在单位上，各 Boss 独立）。 */
    _genericPhases: function (boss) {
      for (var i = 0; i < boss.phases.length; i++) {
        var ph = boss.phases[i];
        if (boss._phDone[i]) continue;
        if (boss.hp > 0 && boss.hp <= boss.maxhp * ph.trig) {
          boss._phDone[i] = true;
          this._runPhase(boss, ph);
        }
      }
    },

    _runPhase: function (boss, ph) {
      var self = this, n;
      if (ph.kind === 'summon') {
        n = Math.min(MAX_E - this.es.length, ph.n || 1);
        for (var i = 0; i < n; i++) {
          this._addEnemy(G.Data.dungeons.makeSummon(ph.spec, boss.level));
        }
        this._log(boss.name + ' 召来「' + ph.spec.name + '」×' + n + '！');
      } else if (ph.kind === 'clone') {
        n = Math.min(MAX_E - this.es.length, ph.n || 2);
        for (var j = 0; j < n; j++) this._addEnemy(this._makeClone(boss, ph.pct || .45));
        this._log(boss.name + ' 分裂出影身 ×' + n + '！');
      } else if (ph.kind === 'enrage') {
        boss._rage = (boss._rage || 1) * (1 + (ph.atk || 0));
        if (ph.cdCut) ph.cdCut.forEach(function (c) {
          boss.skills.forEach(function (s) {
            if (s && c.match && s.n.indexOf(c.match) >= 0) s.cd = c.cd;
          });
        });
        this._log(boss.name + ' 凶性大发，攻势暴涨 ' + Math.round((ph.atk || 0) * 100) + '%！');
      } else if (ph.kind === 'heal') {
        var amt = Math.round(boss.maxhp * (ph.pct || .2));
        this._heal(boss.key, amt);
        this._log(boss.name + ' 运转玄功，回复 ' + amt + ' 气血！');
      } else if (ph.kind === 'ally') {
        /* 同伴牺牲（M1 §4 m1-5 沈伯燃命）：**不新增战斗单位** —— 沈伯不是可操作单位，
           他只是"一次重创 + 两句话"。做成 Boss 的阶段（血量过线触发一次），
           与 summon/enrage/heal 同一套引擎，不引入新的战斗框架。
           ⚠️ 伤害**必须留 1 血**：设计写的是"重创血面后由主角补刀"，
           这里若把血面打死，_victory 的结算就绕过了（战斗会卡在没有敌人的状态）。 */
        var dm = Math.round(boss.maxhp * (ph.pct || .35));
        this._hurt(boss.key, dm, 1);
        this.shake = Math.max(this.shake, 1);
        this._log('“' + (ph.line || '这一把老骨头，总算还有用。') + '”');
        this._log((ph.name || '同伴') + '引燃残存道基 —— ' + boss.name + ' 被重创！');
      }
    },

    _makeClone: function (boss, pct) {
      function r(v) { return Math.max(1, Math.round(v * pct)); }
      var hp = r(boss.maxhp);
      return {
        name: boss.name + '·影', species: boss.species, artKey: null, sprite: boss.sprite,
        level: boss.level, maxhp: hp, hp: hp,
        atk: r(boss.atk), def: r(boss.def), spd: boss.spd,
        elem: boss.elem, boss: false,
        skills: boss.skills.map(function (s) { return JSON.parse(JSON.stringify(s)); }),
        phases: [], shield: 0, buffs: { atk: 0, turns: 0 },
        guard: false, statuses: {}, im: [], charge: null
      };
    },

    /* 战中增员：补全字段 → 入列 → 重排 → 初始化演出追踪。 */
    _addEnemy: function (u) {
      u.key = 'E' + this.es.length;
      u.hp = (u.hp != null) ? u.hp : u.maxhp;
      u.buffs = u.buffs || { atk: 0, turns: 0 };
      u.guard = false; u.statuses = u.statuses || {}; u.im = u.im || [];
      u.charge = null; u.shield = u.shield || 0; u._phDone = {};
      u.skills = u.skills || [];
      u.skills.forEach(function (s) { if (s.cdLeft == null) s.cdLeft = 0; });
      this.es.push(u);
      this._layout();
      this.shown[u.key] = u.hp;
      this.lunge[u.key] = 0; this.lungeT[u.key] = 0;
      this.flash[u.key] = 0; this.chargeMark[u.key] = null;
    },

    /* M0 狼王：<50% 召唤群狼（仅 1 次）；<30% 烈焰风暴 CD 缩短 */
    _wolfPhases: function (boss) {
      if (!this.summonDone && boss.hp > 0 && boss.hp < boss.maxhp * 0.5) {
        this.summonDone = true;
        if (this.es.length < MAX_E) {
          var w = G.Data.makeEnemy('赤炎狼', 5, '群狼');
          this._addEnemy(w);
          this._log(boss.name + ' 仰首长嗥，呼唤群狼！');
        }
      }
      if (!this.enraged && boss.hp > 0 && boss.hp < boss.maxhp * 0.3) {
        this.enraged = true;
        boss.skills.forEach(function (s) {
          if (/风暴/.test(s.n)) s.cd = 3;
        });
        this._log(boss.name + ' 双目赤红，狂暴了——大招愈发频繁！');
      }
    },

    /* 出战灵兽目标：优先打前排，无前排则打任意存活敌人 */
    _beastTargetKey: function () {
      var alive = this._aliveEs();
      if (!alive.length) return null;
      var front = alive.filter(function (e) { return e.front; });
      var t = (front[0] || alive[0]);
      return t.key;
    },
    /* 灵兽选招：约三成使出属性扑击（1.35 倍），否则普攻（1.0 倍）；不耗法力 */
    _beastPick: function (u) {
      if (Math.random() < 0.3)
        return { kind: 'atk', mult: 1.35, elem: u.elem, n: u.name + '扑击' };
      return { kind: 'atk', mult: 1.0, elem: u.elem, n: u.name + '攻击' };
    },
    /* 敌方单体目标：灵兽在场时约三成转火灵兽，其余打主角 */
    _enemyTargetKey: function () {
      if (this.beast && this.beast.hp > 0 && Math.random() < 0.3) return 'B';
      return 'P';
    },

    /* 敌方选招：蓄力技先预告一回合，次回合才真正打出（给玩家防御窗口） */
    _enemyPick: function (u) {
      if (u.charge) {
        var ready = u.charge;
        u.charge = null;
        ready.cdLeft = ready.cd || 2;
        return ready;
      }
      /* B4 绊马/束兽：对阵骑兵时，人形敌偶有绊马索 */
      if (this.mount && !this._mountDown
        && /教徒|修士|傀儡|天兵|杀手|执事|弟子|守卫/.test(u.name)
        && Math.random() < 0.18) {
        return { n: '绊马索', elem: '无', kind: 'snare' };
      }
      var usable = u.skills.filter(function (s) { return s.cdLeft <= 0; });
      if (usable.length && Math.random() < 0.55) {
        var s = usable[Math.floor(Math.random() * usable.length)];
        s.cdLeft = s.cd || 2;
        if (s.charge) {
          u.charge = s;
          return { n: '蓄力', mult: 0, elem: '无', kind: 'charge', _src: s.n };
        }
        return s;
      }
      return { n: '攻击', mult: 1.0, elem: u.elem || '无', kind: 'atk' };
    },

    _act: function (atk, def, aKey, dKey, skill, done) {
      var self = this;
      skill = skill || { n: '攻击', mult: 1.0, elem: atk.elem || '无', kind: 'atk' };
      var steps = [];

      if (skill.kind === 'charge') {
        var src = skill._src || '绝技';
        steps.push([0.30, function () {
          self.chargeMark[aKey] = src;
          self._log(atk.name + ' 气机暴涨，正在蓄力「' + src + '」！');
        }]);
        steps.push([0.28, function () {
          self._log('—— 下回合务必守御或速攻。');
        }]);
        this._cut(steps, done);
        return;
      }

      if (skill.kind === 'snare') {
        steps.push([0.3, function () {
          self._log(atk.name + ' 抖出「' + skill.n + '」！');
          if (self.mount && !self._mountDown) {
            self._float('P', '束兽', '#d8b888');
            self._forceDismount('坐骑被绊马索缠住，你被迫下马！');
          } else self._log('—— 却无马可绊。');
        }]);
        steps.push([0.2, function () {}]);
        this._cut(steps, done);
        return;
      }

      if (skill.kind === 'shield') {
        steps.push([0.30, function () {
          var amt = Math.round(atk.maxhp * (skill.pct || .15));
          atk.shield = Math.min(atk.maxhp, (atk.shield || 0) + amt);
          self._float(aKey, '护盾', '#9ac8ff');
          self._log(atk.name + ' 凝出护盾，可吸收 ' + amt + ' 点伤害。');
        }]);
        steps.push([0.25, function () {}]);
        this._cut(steps, done);
        return;
      }

      if (skill.kind === 'status') {
        steps.push([0.18, function () {
          self._log(atk.name + ' 施展「' + skill.n + '」！');
          self.lungeT[aKey] = aKey === 'P' ? 34 : -30;
        }]);
        steps.push([0.26, function () {
          self.lungeT[aKey] = 0;
          var mkey = aKey + '|' + skill.n;
          var streak = self.miss[mkey] || 0;
          var hit = Math.max(5, skill.hit == null ? 100 : skill.hit);
          if (streak < 2 && Math.random() * 100 > hit) {
            self.miss[mkey] = streak + 1;
            self._log('—— 落空了。');
            return;
          }
          self.miss[mkey] = 0;
          if (skill.status) {
            var chance = skill.status.chance || 0;
            if (def.level != null && atk.level != null && def.level > atk.level + 20) chance *= .5;
            if (Math.random() < chance) self._applyStatus(def, dKey, skill.status.t);
          }
        }]);
        this._cut(steps, done);
        return;
      }

      if (skill.buff) {
        steps.push([0.3, function () {
          atk.buffs.atk = skill.buff.atk; atk.buffs.turns = skill.buff.turns;
          self._log(atk.name + ' 气势暴涨，攻势提升！');
        }]);
        steps.push([0.3, function () {}]);
        this._cut(steps, done);
        return;
      }
      if (skill.healSelf) {
        var amt = Math.round(atk.maxhp * skill.healSelf);
        steps.push([0.35, function () {
          self._heal(aKey, amt);
          self._log(atk.name + ' 汲取草木精元，回复 ' + amt + '。');
        }]);
        steps.push([0.35, function () {}]);
        this._cut(steps, done);
        return;
      }

      steps.push([0.18, function () {
        if (skill.n !== '攻击' && skill.n !== '普通攻击') self._log(atk.name + ' 施展「' + skill.n + '」！');
        else self._log(atk.name + ' 发起攻击。');
        self.lungeT[aKey] = aKey === 'P' ? 34 : -30;
      }]);
      steps.push([0.26, function () {
        self.lungeT[aKey] = 0;
        if (skill.charge) self.chargeMark[aKey] = null;   /* 蓄力已释放 */

        /* 命中（单体）：技能自带命中率，下限 5%；连续失手两次后第三次保底命中。
           全体技改为逐目标判定（见下），跳过此处的整段失手计数。 */
        var isAll = skill.target === '全体';
        var mkey = aKey + '|' + (skill.n || '攻击');
        var streak = self.miss[mkey] || 0;
        var hit = Math.max(5, skill.hit == null ? 100 : skill.hit);
        if (!isAll) {
          if (streak < 2 && Math.random() * 100 > hit) {
            self.miss[mkey] = streak + 1;
            self._log('—— 落空了。');
            return;
          }
          if (streak >= 2) self._log('（连失两度，此番必中）');
          self.miss[mkey] = 0;
        }

        if (skill.kind === 'heal' && skill.heal) {
          /* 技能治疗 = 施法者 ATK × 倍率 × 浮动 × 暴击系数（v0.2 §6.3） */
          var hv = atk.atk * skill.heal * (0.9 + Math.random() * 0.2);
          var hc = Math.random() < (atk.crit || 0.05);
          if (hc) hv *= (atk.critDmg || 1.5);
          hv = Math.max(1, Math.round(hv));
          self._heal(aKey, hv);
          self._log('灵光回流，回复 ' + hv + ' 气血。' + (hc ? ' 会心！' : ''));
          return;
        }

        /* 目标列表：全体技打对方全部存活单位，否则只打选定目标 */
        var targets;
        if (isAll) {
          var pool = aKey === 'P'
            ? self._aliveEs().map(function (e) { return { u: e, key: e.key }; })
            : self._alivePlayer().map(function (u) { return { u: u, key: u.isBeast ? 'B' : 'P' }; });
          targets = pool;
        } else targets = [{ u: def, key: dKey }];

        var totalHp = 0;
        /* 多段攻击（M1 §5.2 疾风九刃）：hits 段独立结算，每段各自判定暴击 / 克制 / 浮动。
           ⚠️ 只在**单体技**上生效 —— 全体技 × 多段没有设计需求，且会让逐目标日志爆掉。 */
        var segs = isAll ? 1 : Math.max(1, skill.hits || 1);
        targets.forEach(function (t) {
          if (!t.u || t.u.hp <= 0) return;
          /* 全体技逐目标命中（无 hit 字段默认必中） */
          if (isAll) {
            var hh = Math.max(5, skill.hit == null ? 100 : skill.hit);
            if (Math.random() * 100 > hh) { self._log(atk.name + ' 攻向 ' + t.u.name + '，却落空了。'); return; }
          }
          for (var si = 0; si < segs; si++) {
            if (t.u.hp <= 0) break;
            var r = self._calc(atk, t.u, skill);
            var hpDmg = self._impact(t.key, r, skill.elem);
            /* 技能爆发：按**功法属性**上色（普攻只有刀光，技能才出扩散环） */
            self._fx('burst', t.key, {
              col: (G.Data.elem && G.Data.elem.color && G.Data.elem.color[skill.elem]) || '#e8f0ff'
            });
            totalHp += hpDmg;
            var extra = G.Data.elem.label(r.ec);
            if (r.crit) extra = ' 会心一击！' + extra;
            self._log(atk.name + ' 命中 ' + t.u.name + '，造成 ' + hpDmg + ' 点伤害。'
              + (segs > 1 ? '（第 ' + (si + 1) + '/' + segs + ' 段）' : '') + extra);

            /* 附加状态与诛邪封印**只在最后一段判定一次** ——
               否则多段会把控制概率叠成近似必中（设计上多段只加伤害，不加控制）。 */
            if (si < segs - 1) continue;
            if (skill.status) {
              var chance = skill.status.chance || 0;
              if (t.u.level != null && atk.level != null && t.u.level > atk.level + 20) chance *= 0.5;
              if (Math.random() < chance) self._applyStatus(t.u, t.key, skill.status.t);
            }
            if (aKey === 'P' && atk._zhuxie && t.u.hp > 0
              && Math.random() < atk._zhuxie) {
              self._applyStatus(t.u, t.key, '封');
            }
          }
        });

        /* 吸血：技能自带 vamp + 玩家「血海神术」全局吸血，按实际气血伤害回复 */
        var vampRate = (skill.vamp || 0) + (aKey === 'P' ? (atk._secretVamp || 0) : 0);
        /* 副本内临时增益「噬血」（每层三选一）：主角专属 */
        if (aKey === 'P' && G.Player.dungeonBuffFx) {
          vampRate += G.Player.dungeonBuffFx(G.game.save).vamp || 0;
        }
        if (vampRate > 0 && totalHp > 0) {
          var vh = Math.round(totalHp * vampRate);
          if (vh > 0) { self._heal(aKey, vh); self._log(atk.name + ' 汲取气血，回复 ' + vh + '。'); }
        }
      }]);
      this._cut(steps, done);
    },

    /* 施加状态：免疫则免疫；重复附加刷新时长；封印打断蓄力（v0.2 §8.1 / §9） */
    _applyStatus: function (u, key, t) {
      if ((u.im || []).indexOf(t) >= 0) {
        this._log(u.name + ' 体质特异，「' + t + '」不侵！');
        return;
      }
      var dur = t === '封' ? 2 : (t === '睡' ? 1 + Math.floor(Math.random() * 2) : 3);
      u.statuses[t] = dur;
      this._float(key, t, '#c8a8e8');
      this._log(u.name + ' 陷入「' + t + '」！');
      if (t === '封' && u.charge) {
        u.charge.cdLeft = Math.max(1, Math.ceil((u.charge.cd || 2) / 2));
        u.charge = null;
        this.chargeMark[key] = null;
        this._log('—— ' + u.name + ' 蓄力被打断！');
      }
    },

    /* 伤害 = (攻×倍率×增益×狂暴 − 防×0.55×(1−破防)) × 属性克制 × 浮动 × 守御 × 暴击 × 连击加成 */
    _calc: function (atk, def, skill) {
      var mult = skill.mult == null ? 1 : skill.mult;
      var buff = 1 + (atk.buffs && atk.buffs.atk || 0);
      var rage = atk._rage || 1;
      var defTerm = def.def * 0.55;
      if (skill.pierce) defTerm *= (1 - skill.pierce);
      /* 聚煞阵：玩家首回合攻击 +25%（《四大技艺 v1.0》§3.5） */
      var jusha = (atk === this.p && this.round === 1
        && G.Formations && G.Formations.has(G.game.save, 'jusha')) ? 0.25 : 0;
      var base = Math.max(1, atk.atk * mult * buff * rage * (1 + jusha) - defTerm);
      var ec = G.Data.elem.coef(skill.elem, def.elem);
      base *= ec;
      /* v0.76.0 连击加成：每combo +1%伤害，上限50% */
      var comboBonus = Math.min(this.COMBO_MAX_BONUS, this.comboCount * 0.01);
      base *= (1 + comboBonus);
      var guard = def.guard ? 0.55 : 1;
      var v = base * (0.9 + Math.random() * 0.2) * guard;
      var crit = Math.random() < (atk.crit || 0.05);
      if (crit) v *= (atk.critDmg || 1.5);
      return { dmg: Math.max(1, Math.round(v)), crit: crit, ec: ec };
    },

    /* 行动开始结算（v0.2 §8.1）：中毒 5% 最大气血（可致死）、
       灼烧 8% 当前气血（保底 1 血）、睡眠禁止行动。
       返回该单位本回合能否行动。 */
    _tickStatus: function (u, key) {
      var self = this, canAct = true;
      if (u.statuses['睡']) {
        canAct = false;
        this._log(u.name + ' 沉眠未醒，无法行动。');
      }
      ['毒', '烧'].forEach(function (k) {
        if (!u.statuses[k]) return;
        var d = Math.max(1, Math.round(k === '毒' ? u.maxhp * 0.05 : u.hp * 0.08));
        u.hp = k === '烧' ? Math.max(1, u.hp - d) : Math.max(0, u.hp - d);
        self._float(key, '-' + d, k === '烧' ? '#ff9a5a' : '#a8e07a');
        self._log(u.name + ' 受「' + k + '」侵蚀，损失 ' + d + '。');
      });
      Object.keys(u.statuses).forEach(function (k) {
        u.statuses[k] -= 1;
        if (u.statuses[k] <= 0) delete u.statuses[k];
      });
      return canAct;
    },

    _endRound: function () {
      /* 冷却与增益递减 */
      var self = this;
      [this.p].concat(this.es).forEach(function (u) {
        u.skills.forEach(function (s) { if (s.cdLeft > 0) s.cdLeft -= 1; });
        if (u.buffs && u.buffs.turns > 0) {
          u.buffs.turns -= 1;
          if (u.buffs.turns <= 0) u.buffs.atk = 0;
        }
        u.guard = false;
      });
      this._cavalryFirst = false;
      /* 芒山聚灵：每回合回复灵力（写回 save.po） */
      var save = G.game.save;
      if (this.p._mangshan) {
        save.po = (save.po || 0) + this.p._mangshan;
        this._float('P', '灵力 +' + this.p._mangshan, '#9ad0ff');
      }
      /* 法力回复（v0.14.0）：每回合固定回 MP_REGEN 点，上限封顶。
         只有主角回 —— 敌人走 `_enemyPick` 的 cd 体系，不引入第二套资源。 */
      if (this.p.mpMax) {
        var before = this.p.mp;
        this.p.mp = Math.min(this.p.mpMax, this.p.mp + G.Player.MP_REGEN);
        if (this.p.mp > before) {
          this._float('P', '法力 +' + (this.p.mp - before), '#9ab8ff');
        }
      }
      this.pSkill = null;
      this.round += 1;
      this.cmdTimer = CMD_TIMER;  /* 新回合重置思考倒计时（v0.11.2） */
      this._log('—— 第 ' + this.round + ' 回合 ——');
      this.phase = 'command';
      this._buildCommand();
      if (this.auto) {
        this._cut([[0.35, function () {
          var k = self._autoTargetKey();
          if (k) self._playerAction(null, k);
        }]]);
      }
    },

    /* 自动战斗选目标：普攻「前排 70% / 后排 30%」（v0.2 §6.2） */
    _autoTargetKey: function () {
      var alive = this._aliveEs();
      if (!alive.length) return null;
      if (alive.length === 1) return alive[0].key;
      var front = [], back = [];
      alive.forEach(function (e) { (e.front ? front : back).push(e); });
      var pool = (front.length && (!back.length || Math.random() < 0.7)) ? front : back;
      if (!pool.length) pool = alive;
      return pool[Math.floor(Math.random() * pool.length)].key;
    },

    /* ===== 演出效果 ===== */
    _cut: function (steps, done) {
      this.cue = steps.map(function (s) { return { t: s[0], fn: s[1] }; });
      this.cueDone = done || null;
    },

    _impact: function (key, r, elem) {
      this.flash[key] = 1;
      /* 受击后退（v0.54.0）：远离攻击者方向的短促位移，update 中弹回 */
      if (!this.knock) this.knock = {};
      this.knock[key] = (key === 'P') ? -7 : 7;
      /* 暴击顿帧（90ms）：整个演出短暂冻结，压出命中重量 */
      if (r.crit) this.hitStop = Math.max(this.hitStop || 0, 0.09);

      /* v0.76.0 打击感强化：顿帧+震屏（使用全局系统） */
      if (G.game) {
        var isHero = (key === 'P');
        var intensity = r.crit ? 0.8 : (isHero ? 0.5 : 0.3);
        var pauseDur = r.crit ? 80 : 50;
        G.game.pauseGame(pauseDur);
        G.game.cameraShake(intensity, 200);
      }

      var u = this._unit(key);
      if (!u) return 0;
      var dmg = r.dmg;

      /* v0.76.0 连击累加：只有攻击敌人且造成伤害才累加 */
      if (dmg > 0 && key !== 'P') {
        this.comboCount++;
        this.comboTimer = this.COMBO_TIMEOUT;
        this.comboBest = Math.max(this.comboBest, this.comboCount);
      }

      /* 护盾池优先吸收；吸收完才扣气血 */
      if (u.shield > 0) {
        var ab = Math.min(u.shield, dmg);
        u.shield -= ab; dmg -= ab;
        if (ab > 0) this._float(key, '护盾 -' + ab, '#9ac8ff');
      }
      /* B4 骑乘作战：坐骑承担 20% 伤害（独立 HP），归零强制下马 */
      if (key === 'P' && this.mount && !this._mountDown && dmg > 0) {
        var shareD = Math.round(dmg * 0.2);
        dmg -= shareD;
        this.mount.hp = Math.max(0, this.mount.hp - shareD);
        this._float('M', '-' + shareD, '#bfe3ff');
        if (this.mount.hp <= 0) this._forceDismount('坐骑力竭，翻身落马！');
      }
      u.hp = Math.max(0, u.hp - dmg);

      /* v0.76.0 评级统计：主角受伤累计 */
      if (key === 'P' && dmg > 0) {
        this.damageTaken = (this.damageTaken || 0) + 1;
      }

      /* 睡眠：受直接气血伤害即醒（DOT 不醒，护盾全挡也不醒，v0.2 §8.1） */
      if (dmg > 0 && u.statuses && u.statuses['睡']) {
        delete u.statuses['睡'];
        this._log(u.name + ' 受创惊醒！');
      }
      /* 枯荣神术：玩家受直接伤害后概率回 maxHP 的一定比例，每场限次 */
      if (key === 'P' && dmg > 0 && u._kurong && u._kurongLeft > 0
        && Math.random() < u._kurong.chance) {
        u._kurongLeft -= 1;
        var kh = Math.round(u.maxhp * u._kurong.pct);
        this._heal(key, kh);
        this._log('枯荣轮转，受创反生，回复 ' + kh + ' 气血。');
      }
      /* v0.76.0 伤害数字：暴击红色放大 */
      if (dmg > 0) this._float(key, '-' + dmg, r.crit ? '#ff4a3a' : '#ffd8d0', r.crit);
      else this._float(key, '格挡', '#9ac8ff');
      /* 命中特效（v0.54.0）：五行技能走对应色爆发，普攻走刀光；暴击统一金色 */
      var ELEM_FX_COL = { '金': '#ffd870', '木': '#8fd878', '水': '#7ab8ff', '火': '#ff8a5a', '土': '#e0b878', '雷': '#c89aff' };
      var ecol = elem ? ELEM_FX_COL[elem] : null;
      if (ecol) this._fx('burst', key, { col: r.crit ? '#ffd45a' : ecol });
      else this._fx('slash', key, { col: r.crit ? '#ffd45a' : '#e8f0ff' });
      this.shake = r.crit ? 7 : 3;
      return dmg;
    },

    _heal: function (key, amt) {
      var u = this._unit(key);
      if (!u) return;
      u.hp = Math.min(u.maxhp, u.hp + amt);
      this._float(key, '+' + amt, '#8fe0a0');
    },

    /* 无来源伤害（剧情演出用，例：沈伯燃命重创血面）。
       min 是**保命下限** —— 演出不该替玩家补刀，见 _runPhase 的 ally 分支。 */
    _hurt: function (key, amt, min, isCrit) {
      var u = this._unit(key);
      if (!u) return;
      u.hp = Math.max(min == null ? 0 : min, u.hp - amt);

      /* v0.76.0 打击感强化：顿帧+震屏 */
      if (G.game) {
        var isHero = (key === 'P');
        var intensity = isCrit ? 0.8 : (isHero ? 0.4 : 0.3);
        var pauseDur = isCrit ? 80 : 50;
        G.game.pauseGame(pauseDur);
        G.game.cameraShake(intensity, 200);
      }

      /* 伤害数字：暴击红色放大 */
      var color = isCrit ? '#ff4a3a' : '#ff9a7a';
      var size = isCrit ? 1.3 : 1.0;
      this._float(key, '-' + amt, color, true, size);
    },

    /* B4 骑乘作战：画人车一体的坐骑（在主角之前画，主角叠在其上） */
    _drawMount: function (x) {
      var m = this.mount;
      if (!m) return;
      var pos = this._pos('M');
      var spr = G.Sprites.beastResolve(m.artKey, m.sprite || 'snake');
      x.save();
      x.fillStyle = 'rgba(0,0,0,0.40)';
      x.beginPath();
      x.ellipse(pos.x, pos.y + 2, pos.s * 0.34, pos.s * 0.10, 0, 0, 6.2832);
      x.fill();
      x.drawImage(spr, Math.round(pos.x - pos.s / 2), Math.round(pos.y - pos.s), pos.s, pos.s);
      x.restore();
    },

    /* B4 强制下马：移除坐骑、收回 20% 加成、存档下马 */
    _forceDismount: function (why) {
      if (!this.mount || this._mountDown) return;
      this._mountDown = true;
      var b = this._mountBonus || { hp: 0, atk: 0, def: 0 };
      this.p.atk -= b.atk; this.p.def -= b.def;
      this.p.maxhp -= b.hp;
      this.p.hp = Math.max(1, Math.min(this.p.hp, this.p.maxhp));
      this.mount = null;
      G.Beasts.dismount(G.game.save);
      if (why) this._log(why);
    },

    /* ===== 打击特效（v0.30.0）=====
       用户口径：「战斗画面，是不是可以做特效了，普通攻击的特效，技能的特效加动画之类的」。
       战斗**已经有**伤害数字（`_float`）与受击白闪（`flash`）——缺的是**动作层**：
       刀光、技能爆发、元素色。这里补一层轻量的弧光/扩散环（零出图）。
       ⚠️ 时间源一律 `dt`（帧推进），**不用 `performance.now()`** —— 截图与契约要钉得住。
       ⚠️ 特效挂在**单位的 key** 上（'P' / 'E0'…），位置每帧用 `_pos(key)` 现取 ——
          存屏幕坐标会在镜头抖动/换位后错位。 */
    _fx: function (kind, key, opt) {
      opt = opt || {};
      if (!this._fxs) this._fxs = [];
      /* 上限保护：连击/多段时别把列表撑爆 */
      if (this._fxs.length > 24) this._fxs.shift();
      this._fxs.push({
        kind: kind, key: key, t: 0,
        dur: opt.dur || (kind === 'burst' ? 0.42 : 0.22),
        col: opt.col || '#e8f0ff', r: opt.r || 0
      });
    },
    _tickFx: function (dt) {
      if (!this._fxs || !this._fxs.length) return;
      for (var i = this._fxs.length - 1; i >= 0; i--) {
        this._fxs[i].t += dt;
        if (this._fxs[i].t >= this._fxs[i].dur) this._fxs.splice(i, 1);
      }
    },
    _drawFx: function (x) {
      if (!this._fxs || !this._fxs.length) return;
      for (var i = 0; i < this._fxs.length; i++) {
        var f = this._fxs[i];
        var pos = this._pos(f.key);
        if (!pos) continue;
        var k = Math.min(1, f.t / f.dur);
        x.save();
        if (f.kind === 'slash') {
          /* 刀光：从右上到左下的弧，快速划过并淡出 */
          var a = 1 - k;
          x.globalAlpha = a * 0.9;
          x.strokeStyle = f.col; x.lineWidth = 3 * a + 1; x.lineCap = 'round';
          x.beginPath();
          x.arc(pos.x, pos.y - 26, 30, -0.9 + k * 1.2, 0.7 + k * 1.2);
          x.stroke();
        } else if (f.kind === 'burst') {
          /* 技能爆发：扩散环 + 六向飞散的火花，按**功法属性**上色 */
          x.globalAlpha = (1 - k) * 0.85;
          x.strokeStyle = f.col; x.lineWidth = 2.5;
          x.beginPath(); x.arc(pos.x, pos.y - 26, 8 + k * 42, 0, 6.2832); x.stroke();
          x.fillStyle = f.col;
          for (var j = 0; j < 6; j++) {
            var ang = j * 1.047 + f.r, rr = 10 + k * 40;
            x.fillRect(pos.x + Math.cos(ang) * rr - 1.5,
              pos.y - 26 + Math.sin(ang) * rr - 1.5, 3, 3);
          }
        }
        x.restore();
      }
    },

    _float: function (key, txt, col, big, scale) {
      var pos = this._pos(key);
      this.floaters.push({
        x: pos.x + (Math.random() - 0.5) * 18,
        /* 起点压低、上浮距离缩短：原来会一路飘进名牌血条面板里 */
        y: pos.y - pos.s * 0.40,
        txt: txt, col: col || '#fff', t: 0, big: !!big, rise: 24,
        scale: scale || 1.0  // v0.76.0 暴击放大
      });
    },

    _log: function (s) {
      this.logs.push(s);
      if (this.logs.length > 40) this.logs.shift();
    },

    /* 战利品：**同时**进战斗日志与全局战利品浮层（v0.17.0）。
       用户口径：「去掉战斗胜利的弹窗……可以弹出本次战斗获取的物品，特殊物品有特效，
       但是不能遮挡地图，可以弹出 3 秒左右，字体小一点点，不要有框，纯文字」。
       战斗日志是"留在这一场里可回看"的，浮层是"跨场景可见的 3 秒提示"——
       两者用途不同，所以都要写，不能只留一个。
       `special`（功法 / 秘术 / 碎片 / 称号）走金色 + 呼吸辉光。 */
    _loot: function (s, special) {
      this._log(s);
      G.game.loot(s, special);
    },

    /* ===== 结算 ===== */
    _victory: function () {
      var save = G.game.save;
      if (!this.keepHp) save.hp = Math.max(1, this.p.hp);
      var p = this.params;

      /* 公共记账：每场战斗耗岁 1/10 岁（轮回 v0.4 §3.2）+ 本世最高境界 */
      G.Player.agePush(save, 'battle', 1);
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel || 1);
      /* 出战灵兽参战一场：亲密度 +2、修为 +20（《灵兽 v1.1》§5/§8） */
      if (this.beast && this.beast._indUid != null) {
        var vInd = G.Beasts.byUid(save, this.beast._indUid);
        if (vInd) {
          vInd.bond = Math.min(100, vInd.bond + 2);
          vInd.xp += 20;
          while (vInd.gl < ((G.Player.MAX_GL) || 171) && vInd.xp >= G.Beasts.need(vInd.gl)) {
            vInd.xp -= G.Beasts.need(vInd.gl); vInd.gl += 1;
            vInd.skills = G.Data.beasts.skillsAtGl(vInd.id, vInd.gl);
          }
        }
      }

      /* 野外击杀计数（v0.38.0）：散修线「云游四方」要"斩妖二十只"。
         ⚠️ 只算**野外遭遇**（无 script、非副本）—— 剧情战与秘境不该算"云游"。
         ⚠️ 放在 `_victory` 的最前面，任何分支 return 之前都能记上。 */
      if (!p.script && !p.dungeon && !p.enemies) save.wildKills = (save.wildKills || 0) + 1;

      /* m0-1 沈伯教学：进山打赢 1 场（v0.3 §主线任务表）→ 回镇找沈伯领灵石 50 并解锁 m0-2。
         此前 won1 全项目无人写入，m0-1 → m0-2 直接断链、主线永久卡死。 */
      if (!p.script && save.quest && save.quest.step === 'm0-1') save.quest.flags.won1 = true;

      if (p.script === 'killer') {
        save.stone += 100; save.qi += 1000;
        save.quest.flags.templeDone = true;
        save.quest.flags.vessel = true;
        save.quest.step = 'm0-3';
        G.Player.chronicle(save, 'vessel', '山神庙得' + (save.world.vessel || '逆命珠'));
        /* 天道注视 +10（v2.7） */
        if (G.TianDao) G.TianDao.notify('vessel');
        this._loot('灵石 +100　灵气 +1000');
        this._log('杀手倒地。你握着那枚器物，只觉心口发烫。');
        /* 打斗就发生在庙里 → 打完了还站在庙里，而不是被丢回山道 */
        this._finish(true, 'field_temple');
        return;
      }

      if (p.script === 'heartDemon') {
        var info = G.Player.winBigBreak(save);
        save.qi += 300;                       /* 突破成功即奖励（经济表 §4 心魔行） */
        this.keepHp = true;                   /* 突破已回满气血，勿被战斗残血覆盖 */
        G.Player.chronicle(save, 'heartDemon', '问心破魔，入' + info.n);
        /* 问道（v0.20.0）：破**大境**成功后自动问一次 —— 每个境一次，可赏可罚。
           用户口径：「天道赐福属于问道其中的一种……突破之后可能是奖励也可能是惩罚」。 */
        var ask = G.Player.askDao(save, G.game.meta);
        if (ask) this._loot('问道 · ' + ask.text, ask.k === 'good');
        /* 任务步按破境来源分派：M1 筑基 → m1-7 离乡；M0 炼气 → m0-5 赤牙洞。 */
        if (save.quest.step === 'm1-6') {
          save.quest.flags.based = true;
          save.quest.step = 'm1-7';
          this._log('心魔溃散！道基初成——' + info.n + '。');
          this._log('灵气 +300　下一步：去刘记与掌柜道别。');
        } else {
          save.quest.step = 'm0-5';
          this._log('心魔溃散！丹田一震，气机贯通——' + info.n + '。');
          this._log('灵气 +300　下一步：修至炼气三段，再探赤牙洞。');
        }
        this._finish(true, 'town');
        return;
      }

      /* 天劫镜像胜（v0.75.0）：**打过天劫才破镜完成**（用户口径）。
         与心魔同一结算出口（winBigBreak），差别只在文案与记录键 ——
         两条路都是"大境界 +1"，不能各写一套升境逻辑（必然漂）。 */
      if (p.script === 'tribulation') {
        var infoT = G.Player.winBigBreak(save);
        save.qi += 300;
        this.keepHp = true;
        G.Player.chronicle(save, 'tribulation', '渡过天劫，入' + infoT.n);
        var askT = G.Player.askDao(save, G.game.meta);
        if (askT) this._loot('问道 · ' + askT.text, askT.k === 'good');
        /* 任务步与心魔胜**同源分派**：M1 筑基→m1-7；M0 炼气→m0-5。
           ⚠️ 两处各写一遍必然分叉（改了一处漏另一处）—— 所以这里逐字对齐。 */
        if (save.quest.step === 'm1-6') {
          save.quest.flags.based = true;
          save.quest.step = 'm1-7';
          this._log('劫云散去！道基初成——' + infoT.n + '。');
          this._log('灵气 +300　下一步：去刘记与掌柜道别。');
        } else {
          save.quest.step = 'm0-5';
          this._log('劫云散去，气机贯通——' + infoT.n + '。');
          this._log('灵气 +300　下一步：修至炼气三段，再探赤牙洞。');
        }
        this._finish(true, 'town');
        return;
      }

      if (p.script === 'sectTrial') {
        /* 试炼通过 → 正式入门。**转阵营的统一入口是 `Player.switchCult`** ——
           面板与战斗都调它，不各写一份（两份"废功"迟早分叉）。 */
        var sid = p.sectId;
        var nSw = G.Player.switchCult(save, true, sid);
        var sc2 = G.Data.sects && G.Data.sects.byId(sid);
        this._loot('试炼通过 —— 拜入「' + (sc2 ? sc2.n : '宗门') + '」', true);
        this._loot('散修功法废功 ×' + nSw + '　贡献 0', false);
        G.Storage.saveCurrent(save);
        this._finish(true, p.mapId || 'town');
        return;
      }

      if (p.script === 'probe') {
        /* M1 §4 m1-2：只记"打赢了"，**不在这里推进任务步** ——
           抉择 1（杀/放/交）要回镇才弹，任务转 m1-3 由那一步完成。
           场景是单例、battle 又马上切回 town，所以用 flag 交接而不是场景状态。 */
        save.quest.flags.probeWin = true;
        this._log('探子跌坐在地，指缝间渗出血来。');
        this._finish(true, 'town');
        return;
      }

      if (p.script === 'xuemian') {
        /* M1 §4 m1-5：血夜落幕。沈伯已燃命重创血面（阶段 ally 干的），
           这里只做"补刀 + 结算"。任务步**不在这里推** —— 遗言演出与转 m1-6
           交给 bloodhall 场景的 enter（场景单例，用 flag 交接）。 */
        save.stone += 400; save.qi += 2000;
        save.items['妖丹'] = (save.items['妖丹'] || 0) + 2;
        save.bossKilled2 = true;
        save.bossKills = (save.bossKills || 0) + 1;   /* 仙力结算按次计（v0.4 §4） */
        var drop2 = G.rng.pick(G.Data.skillDropPoolLing || G.Data.skillDropPool);
        if (!save.skills[drop2]) save.skills[drop2] = { lv: 1 };
        /* 新学的功法**顺手激发**（v0.69.0）：改成激发制之后，只写 save.skills
           而不进技能栏，玩家会看到"学了新功法但战斗里没有它"。
           槽满时 autoEquip 静默失败 —— 三个槽该由玩家自己编排，不自动顶掉。 */
        var eqd2 = G.Player.autoEquip(save, drop2);
        save.quest.flags.bloodNight = true;
        save.quest.flags.elderDead = true;
        G.Player.chronicle(save, 'bloodNight', '血夜，沈伯殁');
        if (G.TianDao) G.TianDao.notify('boss');
        this._loot('灵石 +400　灵气 +2000　妖丹 ×2');
        this._loot('习得功法《' + G.Data.skills[drop2].n + '》' + (eqd2 ? '（已激发）' : ''), true);
        this._log('血面跪倒，眼里的红光散了。');
        this._finish(true, 'bloodhall');
        return;
      }

      if (p.script === 'wolfKing') {
        save.stone += 500; save.qi += 3000;
        save.items['妖丹'] = (save.items['妖丹'] || 0) + 3;
        save.bossKilled = true;
        save.bossKills = (save.bossKills || 0) + 1;   /* 仙力结算按次计（v0.4 §4） */
        /* M1 起主线不再终结于 'free'：斩狼王 → m1-1 归镇辨丹（《M1 设计 v1.0》§3） */
        save.quest.step = 'm1-1';
        var drop = G.rng.pick(G.Data.skillDropPool);
        if (!save.skills[drop]) save.skills[drop] = { lv: 1 };
        var eqd1 = G.Player.autoEquip(save, drop);
        G.Player.chronicle(save, 'wolfKing', '手刃赤炎狼王');
        /* 天道注视 +8（v2.7，统一走 notify；可能触发低语） */
        if (G.TianDao) G.TianDao.notify('boss');
        this._loot('灵石 +500　灵气 +3000　妖丹 ×3');
        this._loot('习得功法《' + G.Data.skills[drop].n + '》' + (eqd1 ? '（已激发）' : ''), true);
        this._finish(true, 'cave');
        return;
      }

      /* 副本战：杂兵/精英走通用收益，Boss 关由副本场景结算；打完回副本场景推进。 */
      if (p.dungeon) {
        var dg = p.dungeon;
        /* 道界试炼（缺口 U4）：没有「关卡序列」这一套 —— 一场定胜负，
           奖励与进境全部由副本场景的 _afterDaoBattle 结算，这里只回场。 */
        if (dg.dao) {
          G.Storage.saveCurrent(save);
          this._finishDungeon();
          return;
        }
        var darch = G.Data.dungeons.archById(dg.archId);
        var dtype = G.Data.dungeons.stageType(darch, dg.stage);
        if (dtype === 'trash' || dtype === 'elite') {
          var dr = G.Player.rates(save);
          var dlg = save.linggen || { elems: ['无'], coef: {} };
          var dlgCoef = (dlg.coef && dlg.coef[(dlg.elems && dlg.elems[0]) || '无']) || 1;
          var dqi = 0, dpo = 0, dst = 0, dcut = false;
          this.es.forEach(function (e) {
            var L = e.level;
            var gap = ((save.globalLevel || 1) - L) > 20 ? .5 : 1;
            if (gap < 1) dcut = true;
            dqi += Math.round(80 * L * dlgCoef * (1 + (dr.qi || 0)) * gap * G.Player.realmQiCoef(L));
            /* v0.76.0 灵力×2：副本灵力从8×L提升到16×L */
            dpo += Math.round(16 * L * (1 + (dr.po || 0)) * gap);
            dst += Math.round(6 * L * (1 + (dr.st || 0)) * gap);
          });
          save.qi = (save.qi || 0) + dqi;
          save.po = (save.po || 0) + dpo; save.stone += dst;
          this._loot('战利：灵气 +' + dqi + '　灵力 +' + dpo + '　灵石 +' + dst
            + (dcut ? '（境界压制，收益减半）' : ''));
        }
        var spDrops = G.Gather.rollDrops(save, this.es, { elite: dtype === 'elite' });
        spDrops.forEach((function (self) { return function (g) { self._loot('拾得「' + g.item + '」×' + g.n, true); }; })(this));
        G.Storage.saveCurrent(save);
        this._finishDungeon();
        return;
      }

      /* 普通遭遇（v0.67.0 经济重设，用户第 28 / 30 点）：
         · **不给灵气** —— 用户口径「取消打怪升级获取灵气…升级人物角色只能通过
           闭关打坐来获取灵气值和灵力值」。灵气由此**只有闭关一个来源**（外加剧情任务）。
         · 只给**材料**（下面的 rollDrops）+ **一点点灵力** + **1~5 下品灵石**
           （用户原话「打野怪只会获得 1~5 个下品灵石」）。
         · 灵石**不随 L 放大** —— 否则高等级刷怪又变成印钞机。用户口径是
           「灵石主要靠接宗门任务和散修联盟的任务」，野外只该是零钱。
         · **道界例外**（境界 v3.2 §10.3）：道界不流通灵石，野外所得折算为**道晶**。
         ⚠️ 这里**故意不再消耗 `G.Player.rates`** —— 收益已与灵根/加成脱钩；
           灵根的作用改由**闭关收益**体现（见 `gametime.js: meditateGain`）。 */
      var po = 0, st = 0, cut = false;
      this.es.forEach(function (e) {
        var L = e.level;
        var gap = ((save.globalLevel || 1) - L) > 20 ? 0.5 : 1;
        if (gap < 1) cut = true;
        /* v0.76.0 灵力×2：原"只给一点点(1×L)"提升为2×L，缓解功法精进成本过高问题 */
        po += Math.max(1, Math.round(2 * L * gap));
        /* 灵石：每只固定 1~5 下品（不随 L 放大） */
        st += G.rng.int(1, 5);
      });
      save.po = (save.po || 0) + po;
      var aw = G.Player.activeWorldId(G.game.meta);
      /* 野外刷怪：功法碎片**一定几率**掉落（v0.14.0，用户口径："野外刷怪有一定几率"）。
         品阶按**当前所在界**定（`activeWorldId` 是"当前界"的唯一真相源）；
         逐只判定 —— 群刷收益略高，但单只 6% 不会失控。
         副本杂兵不走这里（它们的碎片在副本通关结算里给），避免同一次战斗双份。 */
      var shardTier = (G.Data.tierByWorld || {})[aw] || '凡';
      var shardItem = (G.Data.shardByTier || {})[shardTier];
      var shardGot = 0;
      if (shardItem) {
        /* 掉率 v0.75.0：0.06 → 0.025（用户口径「功法非常难获得」）。
           旧 6% 时一场 L=10 的战斗期望 0.6 片，10 片参悟一本 ≈ 17 场就有新功法 ——
           功法成了路边货（参考凡人修仙传：一本粗浅功法都要抢破头）。
           新 2.5% → 约 40 场一本，且野外战斗本来就不给灵气（v0.67.0），
           玩家必须**权衡**"刷碎片"还是"闭关修炼"，而不是无脑刷。 */
        this.es.forEach(function () { if (G.rng.next() < 0.025) shardGot += 1; });
        if (shardGot > 0) {
          save.items = save.items || {};
          save.items[shardItem] = (save.items[shardItem] || 0) + shardGot;
        }
      }
      if (aw === 'dao') {
        var dcr = G.Data.dungeons.daoCrystalDrop(G.Data.dungeons.diffOf(G.game.meta, 'dao'));
        save.daoCrystal = (save.daoCrystal || 0) + dcr;
        this._loot('战利：灵力 +' + po + '　道晶 +' + dcr);
      } else {
        save.stone += st;
        this._loot('战利：灵力 +' + po + '　灵石 +' + st
          + (cut ? '（境界压制）' : ''));
      }
      if (shardGot > 0) this._loot('拾得「' + shardItem + '」×' + shardGot, true);
      var spDrops2 = G.Gather.rollDrops(save, this.es, { dao: aw === 'dao' });
      spDrops2.forEach(function (g) { this._loot('拾得「' + g.item + '」×' + g.n, true); }, this);
      G.Storage.saveCurrent(save);
      this._finish(true, this.mapId);
    },

    _defeat: function () {
      var save = G.game.save;
      /* 问心魔劫：不降级、不死亡；突破丹已耗、灵气保留 80%，回镇可再购丹重试 */
      if (this.params.script === 'heartDemon') {
        var left = G.Player.loseBigBreak(save);
        /* 心魔劫失败不是死亡：重伤脱出，保留两成半气血 */
        this.p.hp = Math.max(1, Math.round(this.p.maxhp * 0.25));
        save.hp = this.p.hp;
        this.keepHp = true;
        this._log('心魔未破……你从梦魇中跌落。灵气散逸，余 ' + left + '。');
        this._log('突破丹已耗，可再购一枚，重头再来。');
        this._finish(false, 'town', true);
        return;
      }
      /* 天劫镜像败（v0.75.0）：与心魔同样"不是死亡"—— 天劫是试炼，不是处决。
         破镜丹已耗、灵气保留 80%，回镇可重炼一枚再来。 */
      if (this.params.script === 'tribulation') {
        var leftT = G.Player.loseBigBreak(save);
        this.p.hp = Math.max(1, Math.round(this.p.maxhp * 0.25));
        save.hp = this.p.hp;
        this.keepHp = true;
        this._log('天劫未渡……劫雷散尽，你自云中坠落。灵气散逸，余 ' + leftT + '。');
        this._log('破境丹已耗，可再炼一枚，重头再来。');
        this._finish(false, 'town', true);
        return;
      }
      save.hp = 0;
      save._cause = 'war';                /* 死因：战死（轮回 v0.4 §3.1） */
      G.Storage.saveCurrent(save);
      this._log('你力竭倒下……');
      this._finish(false, null);
    },

    _leave: function () {
      var save = G.game.save;
      save.hp = Math.max(1, this.p.hp);
      G.Storage.saveCurrent(save);
      this._finish(true, this.mapId);
    },

    /* 副本战胜利：回副本场景（由其推进关卡 / 发 Boss 奖励） */
    _finishDungeon: function () {
      this.over = true;
      this.buttons = [];
      this.phase = 'result';
      var save = G.game.save;
      save.hp = Math.max(1, this.p.hp);

      /* v0.76.0 评级数据保存到dungeonRun */
      var run = save.dungeonRun;
      if (run) {
        var battleTime = (performance.now() - this.battleStartTime) / 1000;
        run.battleTime = (run.battleTime || 0) + battleTime;
        run.totalDamage = (run.totalDamage || 0) + this.damageTaken;
        run.totalItems = (run.totalItems || 0) + this.itemsUsed;
        run.bestCombo = Math.max(run.bestCombo || 0, this.comboBest);
      }

      this._cut([[0.9, function () {
        /* 不再 toast「战斗胜利」—— 结算画面本身已经明示（用户口径） */
        G.game.changeScene('dungeon', { fromBattle: true });
      }]]);
    },

    _finish: function (win, target, soft) {
      this.over = true;
      this.buttons = [];
      this.phase = 'result';
      var save = G.game.save;
      if (!this.keepHp) save.hp = Math.max(win ? 1 : 0, this.p.hp);

      this.resultT = 0;
      this.resultWin = win;
      this.resultTarget = target;
      /* 必须走 _cut：update() 消费的是 {t, fn} 对象，直接赋 [t, fn] 数组会让
         c.t 变 undefined → 演出永不结束 → 死亡时卡死在结算画面。 */
      this._cut([[0.9, function () {
        if (win) {
          G.game.changeScene(target || 'field', { returned: true });
        } else if (soft) {
          G.game.toast('心魔未破');
          G.game.changeScene(target || 'town', { returned: true });
        } else {
          G.game.die(save._cause || 'war');
        }
      }]]);
    },

    /* ===== 更新 ===== */
    update: function (dt) {
      this.t += dt;
      if (this.hitStop > 0) { this.hitStop -= dt; return; }
      var k = Math.min(1, dt * 11);
      var self = this;
      this._keys().forEach(function (key) {
        self.lunge[key] = (self.lunge[key] || 0)
          + ((self.lungeT[key] || 0) - (self.lunge[key] || 0)) * k;
        self.flash[key] = Math.max(0, (self.flash[key] || 0) - dt * 3.2);
        if (self.knock) self.knock[key] = (self.knock[key] || 0) + ((0) - (self.knock[key] || 0)) * k;
      });
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 22);
      this._tickFx(dt);

      /* 血条追赶 */
      var sp = dt * 140;
      this._keys().forEach(function (key) {
        var u = self._unit(key);
        if (!u) return;
        if (self.shown[key] == null) self.shown[key] = u.hp;
        var d = u.hp - self.shown[key];
        if (Math.abs(d) <= sp) self.shown[key] = u.hp;
        else self.shown[key] += Math.sign(d) * sp;
      });

      for (var i = this.floaters.length - 1; i >= 0; i--) {
        var f = this.floaters[i];
        f.t += dt;
        if (f.t > 1.05) this.floaters.splice(i, 1);
      }

      /* v0.76.0 连击倒计时：超时清零 */
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) {
          this.comboCount = 0;
        }
      }

      /* 思考倒计时（v0.11.2）：仅在 command 阶段、未开自动、未结束 时计 */
      if (!this.over && !this.auto && this.phase === 'command') {
        this.cmdTimer = Math.max(0, this.cmdTimer - dt);
        if (this.cmdTimer <= 0) {
          /* 超时自动选「攻击」打前排（同 _autoTargetKey 思路） */
          var k = self._autoTargetKey();
          if (k) {
            self._log('（思考超时，自动出手）');
            self._playerAction(null, k);
          }
        }
      }

      /* 演出队列 */
      if (this.cue.length) {
        var c = this.cue[0];
        c.t -= dt;
        if (c.t <= 0) {
          this.cue.shift();
          if (c.fn) c.fn();
          if (!this.cue.length && this.cueDone) {
            var d2 = this.cueDone; this.cueDone = null; d2();
          }
        }
        return;
      }
      if (this.cueDone) {
        var d3 = this.cueDone; this.cueDone = null; d3();
      }
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      x.save();
      if (this.shake > 0.2) {
        x.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      }
      x.drawImage(this._bg(), 0, 0, 480, 272);
      x.restore();

      /* 后排先画，前排后画；主角最后（始终在最上层） */
      for (var i = this.es.length - 1; i >= 0; i--) this._drawUnit(x, 'E' + i);
      if (this.mount) this._drawMount(x);
      if (this.beast) this._drawUnit(x, 'B');
      this._drawUnit(x, 'P');
      /* 打击特效画在**单位之后**（刀光/爆发要盖在立绘上） */
      this._drawFx(x);

      this._drawTopBar(x);
      this._drawFloaters(x);
      this._drawLog(x);

      /* 选择目标（target）仍是全屏面板；功法/物品现在是按钮上方的下拉框，不需要全屏暗罩。 */
      if (this.phase === 'target') {
        x.fillStyle = 'rgba(4,6,12,0.52)';
        x.fillRect(0, 0, 480, 272);
        var title = '选择目标';
        G.UI.frame(x, { x: 12, y: 34, w: 456, h: 176 }, title, { tex: true });
        var hint = '选择攻击对象（前排更近、后排更远）';
        G.UI.text(x, { x: 240, y: 196 }, hint, 10.5, G.UI.C.textDim, 'center');
      }
      /* 功法/道具下拉的背板：铺一层不透明底，否则底下的战斗日志文字会透出来（截图里很花） */
      if ((this.phase === 'skill' || this.phase === 'item') && this._dropRect) {
        var dr = this._dropRect;
        x.fillStyle = 'rgba(10,13,22,0.94)';
        G.UI.rr(x, dr, 4);
        x.fill();
        x.strokeStyle = 'rgba(216,183,104,0.28)';
        x.lineWidth = 0.9;
        x.stroke();
      }

      if (this.phase === 'result') {
        x.fillStyle = 'rgba(4,6,12,0.55)';
        x.fillRect(0, 0, 480, 272);
        G.UI.textOut(x, { x: 240, y: 116 }, this.resultWin ? '战 斗 胜 利' : '力 竭 倒 下',
          30, this.resultWin ? '#f5e3a8' : '#c75450', 'center', 'rgba(0,0,0,0.8)', 4);
      }

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
      /* 已装备法宝常显（v0.69.0）：**必须画在按钮之后** —— 它占的是指令区
         「取消防御」后空出来的那格（318,240），按钮先渲染会把图标压掉。 */
      this._drawEquip(x);

      /* v0.76.0 连击HUD：右上角显示Combo计数 */
      if (this.comboCount > 0) {
        var color = this.comboCount >= 30 ? '#ff4a3a' :
                    this.comboCount >= 15 ? '#f5e3a8' : '#eae6da';
        x.save();
        x.textAlign = 'right';
        x.textBaseline = 'top';
        x.font = G.UI.F(this.comboCount >= 30 ? 18 : 16);
        x.strokeStyle = 'rgba(8,8,14,0.85)';
        x.lineWidth = 3;
        x.lineJoin = 'round';
        x.strokeText('Combo: ' + this.comboCount, 470, 10);
        x.fillStyle = color;
        x.fillText('Combo: ' + this.comboCount, 470, 10);

        // 倒计时进度条
        var progress = this.comboTimer / this.COMBO_TIMEOUT;
        x.fillStyle = 'rgba(245,227,168,0.3)';
        x.fillRect(390, 30, 80 * progress, 3);
        x.restore();
      }
    },

    /* 本场战斗的背景主题名（表见 BG_THEME）。
       取值优先级：显式 params.bg → 来源地图的地面类型 → 所在界。 */
    _bgKey: function () {
      var p = this.params || {};
      if (p.bg && BG_THEME[p.bg]) return p.bg;
      var md = (G.Data.maps && G.Data.maps[this.mapId]) || {};
      var g = md.ground;
      if (g === 'bloodcave') return 'blood';
      if (g === 'cave') return 'cave';
      if (g === 'floor') return 'hall';
      if (g === 'town') return 'town';
      var wid = 'fan';
      try { wid = G.Player.activeWorldId(G.game.meta) || 'fan'; } catch (e) { wid = 'fan'; }
      if (wid === 'ling') return 'ling';
      if (wid === 'xian') return 'xian';
      if (wid === 'dao') return 'dao';
      return 'night';
    },

    _bg: function () {
      var key = this._bgKey();
      /* ⚠️ 缓存键必须带上主题名：战斗场景是**单例**，只判 `if (this.bg)`
         会出现"换了个战场、背景还是上一张"。 */
      if (this.bg && this._bgFor === key) return this.bg;

      var T = BG_THEME[key] || BG_THEME.night;
      var K = 2, W = 480 * K, H = 272 * K;
      var c = G.Assets.makeCanvas(W, H), x = c.getContext('2d');
      x.scale(K, K);

      /* ① 素材优先（逻辑名 bg.battle.<key>，尺寸登记见 assets-build.py）。
            有图就整张铺上，程序化件全部跳过 —— 但**地面与台座照旧程序化**，
            因为台座位置依赖本场敌人槽位，素材里不可能预烘焙。 */
      var im = G.Assets.img('bg.battle.' + key);
      var rnd = G.Art.rnd(key.charCodeAt(0) * 7919 + key.length * 131);

      if (im) {
        x.drawImage(im, 0, 0, 480, 272);
      } else {
        /* 天幕：把主题的色标均分到 0..210 */
        var sky = x.createLinearGradient(0, 0, 0, 210);
        T.sky.forEach(function (col, i) {
          sky.addColorStop(i / Math.max(1, T.sky.length - 1), col);
        });
        x.fillStyle = sky; x.fillRect(0, 0, 480, 272);

        T.feat.forEach(function (f) { BG_FEAT[f](x, T, rnd); });

        /* 地面：所有主题共用同一套"地平线在 178"的版式，
           保证立绘脚底 / 台座 / 日志面板的位置在任何战场都一致。 */
        var gg = x.createLinearGradient(0, 178, 0, 272);
        gg.addColorStop(0, T.ground[0]);
        gg.addColorStop(1, T.ground[1]);
        x.fillStyle = gg; x.fillRect(0, 178, 480, 94);
        x.fillStyle = T.edge;
        x.fillRect(0, 177.4, 480, 0.8);
      }

      /* 台座：主角 1 个，敌方按槽位各 1 个 */
      x.drawImage(G.Art.arena(150, 44), 122 - 75, 148, 150, 44);
      var seen = {};
      this.es.forEach(function (e) {
        var p = e.pos || SOLO_SLOT;
        var kk = Math.round(p.x) + ':' + Math.round(p.y);
        if (seen[kk]) return;
        seen[kk] = 1;
        var w = e.boss ? 168 : 150;
        x.drawImage(G.Art.arena(w, 44), p.x - w / 2, p.y - 10, w, 44);
      });

      this.bg = c;
      this._bgFor = key;
      return c;
    },

    _drawUnit: function (x, key) {
      var isP = key === 'P';
      var u = this._unit(key);
      if (!u) return;
      if (u._captured) return;
      var pos = this._pos(key);
      var lunge = this.lunge[key] || 0;
      var knock = (this.knock && this.knock[key]) || 0;
      var cx = pos.x + lunge + knock;
      var by = pos.y;
      var s = pos.s;

      var spr;
      if (isP) spr = G.Sprites.heroBattle();
      else if (u.species === '心魔' && G.Sprites.heartDemon) spr = G.Sprites.heartDemon();
      else spr = G.Sprites.beastResolve(u.artKey,
        u.sprite || SPECIES_SPRITE[u.species] || 'snake');
      if (!isP && u.boss) s = Math.max(s, 72);

      /* 已倒下：只留一个淡影，不再画立绘与名牌 */
      if (u.hp <= 0) {
        x.save();
        x.globalAlpha = 0.18;
        x.fillStyle = '#000';
        x.beginPath();
        x.ellipse(cx, by + 2, s * 0.30, s * 0.09, 0, 0, 6.2832);
        x.fill();
        x.restore();
        return;
      }

      x.save();
      /* 影子 */
      x.fillStyle = 'rgba(0,0,0,0.40)';
      x.beginPath();
      x.ellipse(cx, by + 2, s * 0.34, s * 0.10, 0, 0, 6.2832);
      x.fill();

      /* 待机呼吸（v0.54.0）：原地时极轻微起伏；前冲/受击/后退时不叠加 */
      var sway = (Math.abs(lunge) < 1 && Math.abs(knock) < 1 && (this.flash[key] || 0) < 0.25)
        ? Math.sin(this.t * 2.6 + (isP ? 0 : 1.4)) : 0;
      if (sway) x.translate(0, sway);

      /* 单位 */
      x.drawImage(spr, Math.round(cx - s / 2), Math.round(by - s), s, s);

      /* 命中闪光（v0.18.0 起**主角走红色**）。
         用户口径："战斗界面主角应该是红色受击的动画帧"。
         ⚠️ 不能靠 `globalCompositeOperation='lighter'` 直接加色 —— 那是**提亮**，
         出来的是白色；敌我共用同一段代码，主角挨打也会变白。
         改用"把立绘烘成整块红的剪影再叠上去"；剪影按 sprite **缓存**（每帧现烘会掉帧）。 */
      var fl = this.flash[key] || 0;
      if (fl > 0.02) {
        if (key === 'P') {
          x.globalAlpha = Math.min(1, fl * 0.9);
          x.drawImage(hitSilhouette(spr), Math.round(cx - s / 2), Math.round(by - s), s, s);
          x.globalAlpha = 1;
        } else {
          x.globalAlpha = fl * 0.75;
          x.globalCompositeOperation = 'lighter';
          x.drawImage(spr, Math.round(cx - s / 2), Math.round(by - s), s, s);
          x.globalCompositeOperation = 'source-over';
          x.globalAlpha = 1;
        }
      }

      /* 状态角标：放在脚下而不是头顶——头顶那一段被名牌血条面板压住，
         打上状态后玩家根本看不到。 */
      var sts = Object.keys(u.statuses || {});
      sts.forEach(function (t, i) {
        var col = { '毒': '#7ac05a', '烧': '#e0603c', '麻': '#e0c040', '睡': '#8f93a3', '封': '#9a7ae0' }[t] || '#aaa';
        x.fillStyle = 'rgba(8,10,18,0.75)';
        x.fillRect(cx - s / 2 + 1 + i * 9, by + 1, 10, 10);
        x.fillStyle = col;
        x.fillRect(cx - s / 2 + 2 + i * 9, by + 2, 8, 8);
        x.font = G.UI.F(8);
        x.fillStyle = '#12141f';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(t, cx - s / 2 + 6 + i * 9, by + 6);
      });

      /* 蓄力预告：贴在名牌面板下沿，避免与血条重叠 */
      var chg = this.chargeMark[key];
      if (chg) {
        var cw = 96, cx0 = Math.max(8, Math.min(480 - cw - 8, cx - cw / 2));
        var pulse = 0.55 + 0.45 * Math.sin(this.t * 7);
        x.fillStyle = 'rgba(60,12,16,0.86)';
        x.fillRect(cx0, by - s - 4, cw, 15);
        x.strokeStyle = 'rgba(255,140,110,' + pulse.toFixed(2) + ')';
        x.lineWidth = 1;
        x.strokeRect(cx0 + 0.5, by - s - 3.5, cw - 1, 14);
        x.font = G.UI.F(9.5);
        x.fillStyle = '#ffcfa8';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('蓄力 · ' + chg, cx0 + cw / 2, by - s + 3.5);
      }
      x.restore();

      /* 名牌 + 血条（+ 主角多一条法力条）：多敌时收窄，避免互相压住；Boss 留宽一点放得下全名。
         主角名牌**加高 10px** 放法力条（v0.14.0）—— 面板向上长，不往下压（下方是台座与地面）。 */
      var bw = this.es.length > 1 && !isP ? (u.boss ? 96 : 84) : 100;
      var bx = Math.max(8, Math.min(480 - bw - 8, cx - bw / 2));
      var hasMp = !!(isP && u.mpMax);
      var ph = hasMp ? 34 : 24;
      var byy = by - s - 26 - (ph - 24);

      G.UI.panel(x, { x: bx, y: byy, w: bw, h: ph }, 'rgba(12,15,24,0.86)',
        isP ? 'rgba(216,183,104,0.55)' : (u.isBeast ? 'rgba(120,170,190,0.55)' : 'rgba(199,84,80,0.6)'), 3, { shadow: false });
      x.font = G.UI.F(10);
      x.textAlign = 'left'; x.textBaseline = 'top';
      var hpTxt = Math.max(0, Math.round(this.shown[key] == null ? u.hp : this.shown[key]))
        + '/' + u.maxhp;
      var hpW = x.measureText(hpTxt).width;
      /* 名字按可用宽度截断：多敌时名牌窄，长名字会直接压到气血数字上 */
      var nm = String(u.name), avail = bw - 10 - hpW - 5;
      while (nm.length > 1 && x.measureText(nm).width > avail) nm = nm.slice(0, -1);
      x.fillStyle = isP ? '#f5e3a8' : '#e8b0aa';
      x.fillText(nm, bx + 5, byy + 3);
      x.textAlign = 'right';
      x.fillStyle = 'rgba(220,226,240,0.8)';
      x.fillText(hpTxt, bx + bw - 5, byy + 3);
      G.UI.bar(x, { x: bx + 4, y: byy + 15, w: bw - 8, h: 6 },
        u.maxhp ? (this.shown[key] == null ? u.hp : this.shown[key]) / u.maxhp : 0,
        isP ? G.UI.C.hp : '#d24b4b');
      /* 法力条（v0.14.0）：只在主角名牌上画。右侧留 26px 放数字，条子不顶到边。 */
      if (hasMp) {
        var mw = 26;
        G.UI.bar(x, { x: bx + 4, y: byy + 24, w: bw - 8 - mw, h: 5 },
          u.mpMax ? Math.max(0, u.mp) / u.mpMax : 0, '#6f9ad8');
        x.font = G.UI.F(8.5);
        x.textAlign = 'right'; x.textBaseline = 'middle';
        x.fillStyle = 'rgba(180,208,246,0.95)';
        x.fillText(Math.round(u.mp) + '/' + u.mpMax, bx + bw - 5, byy + 26.5);
      }
      /* 护盾条：叠在血条上沿的青色段 */
      if (u.shield > 0) {
        var sw2 = (bw - 8) * Math.min(1, u.shield / u.maxhp);
        x.fillStyle = 'rgba(120,190,255,0.9)';
        x.fillRect(bx + 4, byy + 13, sw2, 2);
      }

      /* 血条残余（白影） */
      var cur = u.maxhp ? Math.max(0, u.hp) / u.maxhp : 0;
      var sh = u.maxhp ? Math.max(0, (this.shown[key] == null ? u.hp : this.shown[key])) / u.maxhp : 0;
      if (sh > cur + 0.005) {
        x.fillStyle = 'rgba(255,255,255,0.55)';
        var w0 = (bw - 8) * cur, w1 = (bw - 8) * sh;
        x.fillRect(bx + 4 + w0, byy + 16, w1 - w0, 4);
      }
    },

    _drawTopBar: function (x) {
      var g = x.createLinearGradient(0, 0, 0, 30);
      g.addColorStop(0, 'rgba(6,8,14,0.86)');
      g.addColorStop(1, 'rgba(6,8,14,0)');
      x.fillStyle = g; x.fillRect(0, 0, 480, 30);

      G.UI.textOut(x, { x: 12, y: 6 }, '第 ' + this.round + ' 回合', 13, '#eae6da');

      /* 思考倒计时（v0.17.0）：**只在顶栏正中留一个大号数字**，不要进度条。
         用户口径：「不要进度条，容易分散玩家注意力，把倒计时放到中间，只要倒计时，
         时间缩短到 15 秒，倒计时到了自动给玩家释放攻击」。
         ⚠️ 进度条已删 —— 它每帧都在变，是画面里唯一"一直在动"的东西，
         比数字本身更抢注意力；数字够用。
         遭遇战标签让到左侧（原来占着正中）。 */
      var p = this.params;
      var label = p.script === 'heartDemon' ? '问心魔劫'
        : this.es[0].boss ? '首领战' : (p.script ? '剧情战' : '遭遇战');
      G.UI.textOut(x, { x: 108, y: 7 }, label, 12, '#8f95a6');

      if (this.phase === 'command' && !this.auto && !this.over) {
        var t = Math.max(0, Math.ceil(this.cmdTimer));
        G.UI.textOut(x, { x: 240, y: 2 }, String(t), 20,
          t <= 5 ? '#e0a080' : '#eae6da', 'center', 'rgba(0,0,0,0.8)', 3.2);
      }

      var alive = this._aliveEs();
      var sumD = 0, fastestD = 0, fastestO = 0;
      for (var i = 0; i < alive.length; i++) {
        var vd = this._effSpd(alive[i], false), vo = this._effSpd(alive[i]);
        sumD += vd;
        if (vd > fastestD) fastestD = vd;
        if (vo > fastestO) fastestO = vo;
      }
      var avg = alive.length ? sumD / alive.length : 0;
      var my = this._effSpd(this.p, false), myO = this._effSpd(this.p);
      var txt = '速度 ' + Math.round(my) + ' : ' + Math.round(avg)
        + (alive.length > 1 ? '(均×' + alive.length + ')' : '')
        + '　' + (myO >= fastestO ? '先手' : '后手');
      G.UI.textOut(x, { x: 468, y: 6 }, this.auto ? '自动战斗中' : txt, 12,
        this.auto ? '#f5e3a8' : (myO >= fastestO ? '#a8dcc4' : '#e0a080'), 'right');
    },

    _drawFloaters: function (x) {
      for (var i = 0; i < this.floaters.length; i++) {
        var f = this.floaters[i];
        var p = f.t / 1.05;
        var alpha = p < 0.75 ? 1 : (1 - (p - 0.75) / 0.25);
        var y = f.y - p * (f.rise || 24);
        /* v0.76.0 暴击放大：基础缩放 × scale参数 */
        var sc = (f.big ? 1 + Math.max(0, 0.5 - p * 1.6) : 1) * (f.scale || 1.0);
        x.save();
        x.globalAlpha = Math.max(0, alpha);
        x.font = G.UI.F(Math.round((f.big ? 20 : 15) * sc));
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round';
        x.lineWidth = 3;
        x.strokeStyle = 'rgba(8,8,14,0.85)';
        x.strokeText(f.txt, f.x, y);
        x.fillStyle = f.col;
        x.fillText(f.txt, f.x, y);
        x.restore();
      }
    },

    /* 已装备法宝的战斗常显（v0.69.0，用户第 11 点「新资源及戒指战斗图标」）。
       挂在指令区**第二行第三格**（318,240，142×28）—— 那是取消「防御」后空出来的格，
       正好横排三个（武器/防具/饰品，含用户点名的"戒指"）。
       为什么不放主角名牌旁：名牌多敌时会收窄、Boss 战还要让位，图标会跟着抖；
       指令区这一格是**固定尺寸的空白**，最稳。
       法宝的数值早在 computeStats 里生效了（equipFx），这里纯粹补**表现层** ——
       此前战斗界面完全不体现穿了什么，玩家换上戒指也只能去角色面板看。 */
    _drawEquip: function (x) {
      var list = this.equippedList || [];
      if (!list.length) return;
      var gx = 318, gy = 240, gw = 142, gh = 28;
      G.UI.panel(x, { x: gx, y: gy, w: gw, h: gh }, 'rgba(12,15,24,0.72)',
        'rgba(216,183,104,0.30)', 3, { shadow: false });
      var cell = gw / 3;                     /* 固定三等分：槽位恒定不跳动 */
      var SZ = 20;
      var SLOTS = G.Data.equips.SLOTS, SLOT_N = G.Data.equips.SLOT_N;
      for (var i = 0; i < SLOTS.length; i++) {
        var e = list[i] || null;
        var ccx = gx + cell * i + cell / 2;
        var icy = gy + (gh - SZ) / 2;
        var r = { x: gx + cell * i, y: gy, w: cell, h: gh };
        /* 槽位分隔线（除第一个）*/
        if (i > 0) {
          x.strokeStyle = 'rgba(216,183,104,0.16)';
          x.lineWidth = 0.8;
          x.beginPath();
          x.moveTo(Math.round(gx + cell * i) + .5, gy + 6);
          x.lineTo(Math.round(gx + cell * i) + .5, gy + gh - 6);
          x.stroke();
        }
        if (e) {
          var ic = G.Art.itemIcon(e.id, SZ);
          if (ic) x.drawImage(ic.c, ccx - SZ / 2 + ic.ox, icy + ic.oy, ic.w, ic.h);
          /* 悬浮说明：法宝名 + 加成（加成文案走数据层 `equips.fxDesc` 唯一口） */
          G.UI.hover(r, { title: e.n + '　· ' + SLOT_N[SLOTS[i]],
            text: (e.d ? e.d + '\n' : '') + G.Data.equips.fxDesc(e) });
        } else {
          /* 空槽：画一个暗虚位，玩家知道"这格还没穿" */
          x.strokeStyle = 'rgba(216,183,104,0.18)';
          x.lineWidth = 0.9;
          x.setLineDash && x.setLineDash([2, 2]);
          G.UI.rr(x, { x: ccx - SZ / 2, y: icy, w: SZ, h: SZ }, 3);
          x.stroke();
          x.setLineDash && x.setLineDash([]);
          G.UI.hover(r, { title: '未装备 · ' + SLOT_N[SLOTS[i]],
            text: '去炼器、做任务或刷怪获取' });
        }
      }
    },

    _drawLog: function (x) {
      G.UI.panel(x, { x: 10, y: 172, w: 460, h: 32 }, 'rgba(10,13,22,0.88)',
        'rgba(216,183,104,0.35)', 4, { tex: true, shadow: false });
      var lines = this.logs.slice(-2);
      for (var i = 0; i < lines.length; i++) {
        var last = i === lines.length - 1;
        G.UI.text(x, { x: 20, y: 178 + i * 14 }, lines[i], 12,
          last ? '#eae6da' : '#8f95a6');
      }
    },

    onKey: function (code) {
      if (code !== 'Space') return;
      if (this.phase !== 'command' && this.phase !== 'target') return;
      var b = this.buttons[0];
      if (b && !b.disabled) { b._p = .14; b.onClick(); }
    }
  };

  G.scenes.battle = scene;

  /* 背景主题表挂场景导出（与 `ASC_PANELS` 同一套约定：**渲染与契约读同一份**）。
     契约要遍历全部主题验证"每个 feat 名都在 BG_FEAT 里有实现" ——
     这类"表里写了个不存在的键名"的错，只在**那个主题真被用到**时才抛，
     不遍历就等于没验。 */
  scene.BG_THEME = BG_THEME;
  scene.BG_FEAT = BG_FEAT;
})();
