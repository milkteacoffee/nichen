/* 青溪镇：探索引擎包装，建筑门触发覆盖层 */
(function () {
  /* 药铺的丹货（v0.17.0）：用户口径「药铺点击无法、没有购买界面」——
     原来药铺柜台只挂对话（`act:'shenbo'`），全游戏只有刘记杂货一家商店。
     现在药铺有自己的丹货清单；**沈伯的对话入口保留在面板里**（M0/M1 任务线要靠它）。
     两家的货**故意不重叠**：药铺卖丹、杂货卖符与功法 —— 玩家才会两边都跑。 */
  var APOTHECARY_ITEMS = [
    { id: '回春丹', n: '回春丹', price: 30, d: '回复 35% 气血' },
    { id: '大还丹', n: '大还丹', price: 90, d: '回复 75% 气血' },
    { id: '聚气散', n: '聚气散', price: 60, d: '灵气 +500' },
    { id: '醒神散', n: '醒神散', price: 40, d: '解除异常状态' },
    { id: '解毒丹', n: '解毒丹', price: 20, d: '解除中毒' },
    { id: '甘霖丹', n: '甘霖丹', price: 20, d: '解除灼烧' },
    { id: '舒筋丹', n: '舒筋丹', price: 20, d: '解除麻痹' },
    { id: '解封符', n: '解封符', price: 25, d: '解除封印' },
    { id: '淬体突破丹', n: '淬体突破丹', price: 200, d: '淬体九段破境所需' }
  ];

  var SHOP_ITEMS = [
    { id: '回春丹', n: '回春丹', price: 30, d: '回复35%气血' },
    { id: '解毒丹', n: '解毒丹', price: 20, d: '解除中毒' },
    { id: '甘霖丹', n: '甘霖丹', price: 20, d: '解除灼烧' },
    { id: '舒筋丹', n: '舒筋丹', price: 20, d: '解除麻痹' },
    { id: '解封符', n: '解封符', price: 25, d: '解除封印' },
    { id: '回春诀', n: '《回春诀》', price: 180, d: '治疗功法', skill: true },
    { id: '淬体突破丹', n: '淬体突破丹', price: 200, d: '突破所需' }
  ];
  var SP = { x: 50, y: 16, w: 380, h: 238 };

  var hooks = {};

  hooks.menu = function (scene) { G.TianDao.openSettings(scene); };

  /* 天道面板的点击/按键转发（输入框失焦、Esc 关闭） */
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  /* 门 → 对应室内地图（镇内三栋房子都能走进去） */
  hooks.onInteract = function (o, scene) {
    if (o.type !== 'door') return;
    /* 屋门映射读地图数据（maps.js: town.doors）—— 探索场景的「路引」寻路也读同一份 */
    var doors = (scene.map && scene.map.md && scene.map.md.doors) || {};
    var to = doors[o.id];
    if (!to) { G.game.toast('门锁着，推不开'); return; }
    scene._transition({ to: to, spawn: G.Data.maps[to].spawn });
  };

  /* ============================================================
     NPC：站桩对话（探图 v0.2 §NPC —— 有任务挂标记，无任务聊 1-2 句风味台词）
     覆盖层名 → 台词内容。台词由 G.Overlays.dialog 渲染（立绘 + 名牌 + 自动折行）。
     ============================================================ */
  /* 支线（内容型）：一个 NPC 一条支线，台词随进度变。
     `DIALOGS` 支持**函数式条目**（渲染处会 `d(save)`），正好用来按 step 出不同台词。
     ⚠️ 函数拿不到 scene，所以当前在谈哪条支线靠模块级 `_sideCur` 传递
       —— 同时只可能开一个对话覆盖层，够用。 */
  var _sideCur = null;
  var SIDE_NPC = { washer: '浣衣妇', woodman: '老樵夫', market: '刘掌柜' };
  var SIDE_PORTRAIT = { washer: 'villager', woodman: 'villager', market: 'keeper' };

  var DIALOGS = {
    shenbo1: {
      title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo',
      lines: [
        '“你既在我药铺学徒，”',
        '“总不能不识山中险恶。”',
        '“从镇口往南上翠微山，打赢一头妖兽，”',
        '“便算出师第一步。”'
      ]
    },
    shenboIdle: function (save) {
      var t;
      if (save.quest.step === 'm0-2') t = '“雪夜将至，山神庙……去看看吧。”';
      else if (save.quest.step === 'm0-3') t = '“得了机缘，便好生消化，莫要声张。”';
      else t = '“修行在己，好生努力。”';
      return { title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo', lines: [t] };
    },
    dream: function (save) {
      return {
        title: (save.world.vessel || '逆命珠') + ' · 珠内梦境',
        name: '尘逆残影', portrait: 'demon',
        lines: [
          '尘逆残影立于星河之下，回身看你。',
          '“逆命珠内一日，世上不过一瞬。”',
          '“此间灵气充足，先化开再说。”'
        ],
        reward: '灵气 +2500'
      };
    },
    sideq: function (save) {
      var SQ = G.Data.sideQuests;
      var q = SQ && SQ.byId(_sideCur);
      if (!q) return { title: '青溪镇', name: '镇民', portrait: 'villager', lines: ['……'] };
      var step = SQ.stepOf(save, q.id);
      var lines;
      if (step === 0) lines = [q.intro];
      else if (step >= 3) lines = [q.out];
      else lines = [q.steps[step - 1].d, '（' + q.steps[step - 1].hint + '）'];
      return {
        title: '青溪镇 · 支线', name: SIDE_NPC[q.giver] || '镇民',
        portrait: SIDE_PORTRAIT[q.giver] || 'villager', lines: lines
      };
    },

    chatWasher: {
      title: '青溪镇 · 井边', name: '浣衣妇', portrait: 'villager',
      lines: ['“这井水甜，比山泉还养人。”', '“后山近来不太平，”', '“莫要一个人往深处走。”']
    },
    chatWoodman: {
      title: '青溪镇 · 院外', name: '老樵夫', portrait: 'villager',
      lines: ['“柴砍得再多，也砍不过命。”', '“破庙那头的风，夜里听着不像风。”']
    },

    /* ===== M1 主线（《M1 剧情与内容设计 v1.0》§4）=====
       排版约束：dialog 的台词列从 y≈81 起、每行 20，底部按钮在 214。
       所以**每段台词最多 5 个折行**（81 + 5×20 + 4×3 ≈ 193 < 214）。
       写长了会压到按钮上，而且这是静默的 —— 加台词前先数行。 */
    m1_1: {
      title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo',
      lines: [
        '沈伯接过妖丹，只看一眼，脸色骤变。',
        '“这丹里有血引——狼王是他们放养的东西。”',
        '“你杀了它，血煞教迟早循来。”',
        '“镇上多了个生面孔，去摸摸他的底。”'
      ]
    },
    /* 赠的那本功法是随机的 → 文案要现算。技能 id 存在 q.flags.oldDebtSkill 上，
       不放场景属性：场景是单例，靠它传值一旦漏清就是"上辈子的功法名"。 */
    m1_3: function (save) {
      var d = {
        title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo',
        lines: [
          '沈伯沉默良久。',
          '“我年轻时是越国散修，筑基那夜遭人暗算，毁了道基。”',
          '“外堂执事至少筑基修为——你若不筑基，全镇都得死。”'
        ]
      };
      var sk = save.quest && save.quest.flags && save.quest.flags.oldDebtSkill;
      if (sk && G.Data.skills[sk]) d.reward = '习得《' + G.Data.skills[sk].n + '》';
      return d;
    },
    m1_4: {
      title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo',
      lines: [
        '“筑基丹郡城才有货，刘掌柜能替你调。”',
        '“若嫌贵，凑齐妖丹三枚、灵石六百，”',
        '“我连夜给你开一炉。”'
      ]
    },
    m1_5: {
      title: '青溪镇 · 夜', name: '沈伯', portrait: 'shenbo',
      lines: [
        '夜半，镇外火把次第亮起，梆子敲得又急又乱。',
        '“他们来了 —— 外堂执事，筑基修为。”',
        '“镇民被围在镇口。他们逼的，是我。”',
        '“走。去镇外据点，别让火烧进镇里。”'
      ]
    },
    m1_7: {
      title: '刘记杂货', name: '刘掌柜', portrait: 'keeper',
      lines: [
        '“血煞教不会只来一个执事。”',
        '“你留在青溪镇，只会给镇子招祸。”',
        '“沿官道往西北八百里，是云州城 ——”',
        '“坊市、宗门收徒，都在那儿。”'
      ],
      reward: '灵石 +200　回城符 ×3'
    },
    probe1: {
      title: '青溪镇 · 刘记门前', name: '行脚商', portrait: 'cultist',
      lines: [
        '“客官好面相，一看便是修道之人。”',
        '你盯着他的手：虎口厚茧，是常年握刀的手。',
        '“血煞教的人，不该来青溪镇。”'
      ]
    },
    marketHint: {
      title: '刘记杂货 · 刘掌柜', name: '刘掌柜', portrait: 'keeper',
      lines: ['“这些天镇上来了生面孔，”', '“出手阔绰得反常。”']
    },
    /* 抉择 1 的情境文案（选项按钮由 openChoice1 建） */
    choice1: {
      title: '抉择 · 血煞教探子', name: '血煞教探子', portrait: 'cultist',
      lines: [
        '探子跌坐在地，捂着胸口看你。',
        '“杀了我，外堂只会派更多人来。”',
        '“放我走，我欠你一条命。”'
      ],
      note: '此选择记入因果，影响血夜之战。'
    }
  };

  /* ============================================================
     M1 主线工具
     ============================================================ */

  /* 旧存档兼容：M1 之前斩狼王把 step 写成 'free'（= 主线已了），
     M1 起改成 'm1-1'。这里就地归一化一次，后面的判定只认 m1-1。
     幂等、无副作用 —— 每次进镇跑一遍没有代价。 */
  function normStep(save) {
    var q = save.quest;
    if (q && q.step === 'free' && save.bossKilled) q.step = 'm1-1';
    return q ? q.step : 'free';
  }

  /* m1-3 赠功法：从沈伯旧藏池里挑一本灵阶功法。
     优先给**与主角灵根同属性**的（设计 §4 m1-3），同属性有多本就随机；
     一本都没匹配上就全池随机。已习得的排除在外，除非池子已被学空。 */
  function grantLingSkill(save) {
    var pool = (G.Data.shenBoPool || []).slice();
    var own = save.skills || {};
    var fresh = pool.filter(function (id) { return !own[id]; });
    if (!fresh.length) fresh = pool;
    var elems = (save.linggen && save.linggen.elems) || [];
    var matched = fresh.filter(function (id) {
      var sd = G.Data.skills[id];
      return sd && elems.indexOf(sd.elem) >= 0;
    });
    var pick = G.rng.pick(matched.length ? matched : fresh);
    if (!pick) return null;
    if (!own[pick]) save.skills[pick] = { lv: 1 };
    return pick;
  }

  /* m1-4 门槛（设计 §4）：炼气六段 = gl 15 */
  var M1_4_GATE = 15;
  /* m1-5 门槛（设计 §4）：炼气九段圆满 = gl 18 */
  var M1_5_GATE = 18;

  /* 抉择 1：三个选项各自记因果，然后统一推进到 m1-3。
     因果写在 save.karma（本世内有效）与 chronicle（跨世走马灯）。 */
  function openChoice1(scene) {
    var save = G.game.save, q = save.quest;
    var P = G.Overlays.PANEL;
    /* 三条按钮必须**各自错开 y**：全建在同一个 y 会完全重叠，
       点哪一条都是最后建的那条（命中测试按数组顺序，第一个矩形就吃掉了）。 */
    var OPTS = [
      { kind: 'kill', karma: 'cultistKill', v: 'danger',
        label: '杀了他 · 永绝后患', line: '探子死于镇外，血煞教外堂震怒' },
      { kind: 'spare', karma: 'cultistSpare', v: 'ghost',
        label: '放他走 · 别再踏上青溪镇', line: '你放走了血煞教探子「阿七」' },
      { kind: 'hand', karma: 'cultistHand', v: 'default',
        label: '交给沈伯处置', line: '探子被囚于沈家柴房' }
    ];
    var btns = OPTS.map(function (o, i) {
      return new G.UI.Btn({
        x: P.x + 14, y: 176 + i * 24, w: P.w - 28, h: 20, small: true,
        variant: o.v, label: o.label,
        onClick: function () {
          q.flags.probe = o.kind;
          q.step = 'm1-3';
          save.karma = save.karma || {};
          save.karma[o.karma] = true;
          G.Player.chronicle(save, 'probe:' + o.kind, o.line);
          G.Storage.saveCurrent(save);
          G.game.toast(o.line);
          scene.clearOverlay();
          /* 任务转 m1-3 后探子就不该还在镇上了 ——
             但地图只在 enter() 时构建，覆盖层一收不会重建，他会**继续站在那里**，
             直到玩家出镇再回来。这里就地重铺一次地图。 */
          if (scene.map) scene.map = G.MapGen.buildMap(save, 'town');
        }
      });
    });
    scene.setOverlay('choice1', btns);
  }

  function openChat(scene, key) {
    scene.setOverlay(key, [
      new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
        label: '知道了', onClick: function () { scene.clearOverlay(); } })
    ]);
  }

  /* 支线对话（内容型）：按 step 出「接下 / 交付 / 知道了」。
     返回 false = 该 NPC 现在没有支线可谈（已完成），调用方退回普通闲聊。 */
  function sideTalk(scene, npcId) {
    var SQ = G.Data.sideQuests;
    if (!SQ) return false;
    var q = SQ.byGiver(npcId);
    if (!q) return false;
    var save = G.game.save;
    SQ.tick(save);
    var step = SQ.stepOf(save, q.id);
    if (step >= 3) return false;                 /* 做完了 → 回到普通闲聊 */
    _sideCur = q.id;
    var ack = function () {
      return new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
        label: '知道了', onClick: function () { scene.clearOverlay(); } });
    };
    var btns = [];
    if (step === 0) {
      btns.push(new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold',
        label: '接下', onClick: function () {
          SQ.accept(save, q); G.game.toast('接下支线：' + q.n); scene.clearOverlay();
        } }));
      btns.push(new G.UI.Btn({ x: 70, y: 214, w: 100, h: 24, small: true, variant: 'ghost',
        label: '再说', onClick: function () { scene.clearOverlay(); } }));
    } else if (step === 2 && SQ.canTurnIn(save, q)) {
      btns.push(new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold',
        label: '交付', onClick: function () {
          var r = SQ.turnIn(save, q);
          if (r.ok) { G.game.toast('了却一桩：' + q.n); G.game.toast(r.text); }
          else G.game.toast('无法交付：' + r.reason);
          scene.clearOverlay();
        } }));
      btns.push(new G.UI.Btn({ x: 70, y: 214, w: 100, h: 24, small: true, variant: 'ghost',
        label: '再说', onClick: function () { scene.clearOverlay(); } }));
    } else {
      btns.push(ack());
    }
    scene.setOverlay('sideq', btns);
    return true;
  }

  /* ===== 外堂探子（m1-2）=====
     两句试探 → 点破 → 撕破脸开打。打完由 battle 写 flags.probeWin，
     回镇时 hooks.enter 弹抉择 1（所以这里只负责把玩家送进战斗）。 */
  function talkProbe(scene) {
    var save = G.game.save, q = save.quest;
    if (q.step !== 'm1-2') { G.game.toast('“客官，看看山货？”'); return; }
    scene.setOverlay('probe1', [
      new G.UI.Btn({
        x: 190, y: 214, w: 100, h: 24, small: true, variant: 'danger',
        label: '点破他',
        onClick: function () {
          scene.clearOverlay();
          G.game.changeScene('battle', { script: 'probe', mapId: 'town' });
        }
      })
    ]);
  }

  var NPC_ACTS = {
    shenbo: function (scene) { shenBo(scene); },
    market: function (scene) { openMarket(scene); },
    probe: function (scene) { talkProbe(scene); },
    'chat.washer': function (scene) {
      if (sideTalk(scene, 'washer')) return;
      openChat(scene, 'chatWasher');
    },
    'chat.woodman': function (scene) {
      if (sideTalk(scene, 'woodman')) return;
      openChat(scene, 'chatWoodman');
    },
    market: function (scene) {
      /* ⚠️ **主线优先**：m1-4（取筑基丹货源）与 m1-7（离乡道别）都挂在刘掌柜身上，
         支线插到前面会把这两拍整条吞掉（实测：m1-7 的「道别」被支线抢走，
         m1.quest / m1.bloodnight 两条契约同时红）。所以主线拍内不走支线。 */
      var q2 = G.game.save.quest;
      var mainBeat = (q2.step === 'm1-4' || q2.step === 'm1-7');
      if (!mainBeat && sideTalk(scene, 'market')) return;
      openMarket(scene);
    }
  };

  function onNpc(npc, scene) {
    var fn = NPC_ACTS[npc.act];
    if (fn) { fn(scene); return; }
    G.game.toast(npc.name + '　没有说话');
  }

  /* 头顶任务标记：！有话可接 / ？可交付，无任务不挂 */
  function npcMark(npc) {
    var save = G.game.save, q = save.quest;
    var step = normStep(save);
    if (npc.act === 'probe') return step === 'm1-2' ? '!' : null;
    if (npc.act === 'market') {
      /* m1-4：刘掌柜手上有筑基丹的货源（到门槛才挂，免得低境界时给空头指引） */
      if (step === 'm1-4' && !q.flags.foundPill
        && (save.globalLevel || 1) >= M1_4_GATE) return '?';
      /* m1-7：离乡 —— 与刘掌柜道别（M1 收束） */
      if (step === 'm1-7') return '!';
      return null;
    }
    if (npc.act !== 'shenbo') return null;
    if (q.step === 'm0-1') return q.flags.won1 ? '?' : '!';
    if (q.step === 'm0-4' && save.globalLevel >= 9 && !q.flags.gotBreakPill) return '?';
    /* —— M1 —— */
    if (step === 'm1-1') return '!';                       /* 辨丹 */
    if (step === 'm1-3') return '?';                       /* 旧账 */
    if (step === 'm1-4' && !q.flags.foundPill
      && (save.globalLevel || 1) >= M1_4_GATE) return '?';  /* 旧方开炉 */
    if (step === 'm1-5' && (save.globalLevel || 1) >= M1_5_GATE) return '!';  /* 血夜 */
    return null;
  }

  hooks.onNpc = onNpc;
  hooks.npcMark = npcMark;

  /* 回镇收口：探子战打赢了就把抉择 1 摆上来。
     为什么放这里而不是战斗里 —— 战斗只负责"打完了"，抉择卡的版式、按钮、
     因果写入全属于镇子这一侧；塞进 battle 等于把两套 UI 体系缝在一起。 */
  hooks.enter = function (scene) {
    var save = G.game.save;
    if (!save || !save.quest) return;
    var q = save.quest;

    /* 旧档自救（v0.18.1）：早先版本的"抉择 1"只写了 flags.probe、**没有推进任务步**，
       于是玩家永久卡在 m1-2 —— 追踪栏一直显示「✓ 处置探子」、行脚商一直站在镇上、
       反复点他也只会得到一句"客官，看看山货？"（因为 talkProbe 要求 step==='m1-2'
       才开打，而抉择又因为 !flags.probe 不成立而不再弹）。玩家感受就是"任务一直重复"。
       这里按旗标补一次推进，**修的是玩家手里的档**，不是新档。 */
    if (q.step === 'm1-2' && q.flags.probe) {
      q.step = 'm1-3';
      G.Storage.saveCurrent(save);
    }

    if (G.Data.sideQuests) G.Data.sideQuests.tick(save);   /* 支线：条件达成则 1 → 2 */
    if (q.step === 'm1-2' && q.flags.probeWin && !q.flags.probe) openChoice1(scene);
  };

  /* ===== 沈家小院 ===== */
  /* 打坐（蒲团）：灵气 + 年龄推进（轮回 v0.4 §3.2） */
  function restOnBed(scene) {
    var save = G.game.save, st = G.Player.computeStats(save);
    save.hp = st.maxhp;
    G.Storage.saveCurrent(save);
    G.game.toast('榻上安歇，气血全复');
  }
  function meditateOnCushion(scene) {
    var save = G.game.save;
    var g = G.Player.meditate(save, 120);
    var yrs = G.Player.agePush(save, 'meditate', 120);
    G.game.toast('灵气 +' + g + (yrs ? '　岁月 +' + yrs : ''));
  }

  /* 突破入口：口径统一在 G.Overlays.doBreak（底栏「功法」页也调它）。
     珠内空间这里只是"另一个入口"，不另写一份规则。 */
  function doBreak(scene) {
    G.Overlays.doBreak(scene);
  }

  function openCult(scene) {
    var save = G.game.save, q = save.quest, btns = [];

    /* m0-3 珠内梦境：首次进入演一段、赠 2500 灵气，任务推进到 m0-4 */
    if (q.step === 'm0-3' && !q.flags.dream) {
      save.qi = (save.qi || 0) + 2500;
      q.flags.dream = true;
      q.step = 'm0-4';
      G.Player.chronicle(save, 'dream', '珠内空间，梦境点化');
      G.Storage.saveCurrent(save);
      scene.setOverlay('dream', [
        new G.UI.Btn({ x: 190, y: 216, w: 100, h: 24, small: true, variant: 'gold',
          label: '醒来', onClick: function () { openCult(scene); } })
      ]);
      return;
    }

    var bs = G.Player.breakState(save);
    btns.push(new G.UI.Btn({
      x: SP.x + SP.w - 152, y: 58, w: 134, h: 26,
      small: true, variant: bs.ready ? 'gold' : 'default',
      label: bs.big ? '突破 · 问心魔劫' : '突破 · ' + bs.next.n,
      disabled: !bs.ready,
      onClick: function () { doBreak(scene); }
    }));

    Object.keys(save.skills).forEach(function (id, i) {
      var sd = G.Data.skills[id], lv = save.skills[id].lv;
      var cost = G.Player.skillCost(sd, lv);
      btns.push(new G.UI.Btn({
        x: SP.x + SP.w - 110, y: 104 + i * 26, w: 92, h: 20,
        small: true, label: '修炼 ' + cost + '力',
        disabled: save.po < cost,
        onClick: function () {
          save.po -= cost; save.skills[id].lv += 1;
          G.Storage.saveCurrent(save);
          G.game.toast(sd.n + ' 精进至 Lv' + save.skills[id].lv);
          openCult(scene);
        }
      }));
    });
    btns.push(G.Overlays.closeBtn(scene, 216));
    scene.setOverlay('cult', btns);
  }

  /* ===== 沈伯 ===== */
  /* 沈伯这条线的对话按钮都长一个样（「知道了」），抽出来省得抄错坐标 */
  function ack(scene, label, variant) {
    return new G.UI.Btn({
      x: 190, y: 214, w: 100, h: 24, small: true,
      variant: variant || 'gold', label: label || '知道了',
      onClick: function () { scene.clearOverlay(); }
    });
  }

  function shenBo(scene) {
    var save = G.game.save, q = save.quest;
    var step = normStep(save);

    /* —— m1-1 归镇辨丹 —— */
    if (step === 'm1-1') {
      q.flags.bloodDan = true;
      q.step = 'm1-2';
      G.Player.chronicle(save, 'bloodDan', '狼王妖丹内藏血引，血煞教放养');
      G.Storage.saveCurrent(save);
      /* 这里**不要**再 toast —— toast 落在 y≈226，正好压住对话框底部的「知道了」，
         而台词最后一句说的就是同一件事（"镇上多了个生面孔，去摸摸他的底"）。 */
      scene.setOverlay('m1_1', [ack(scene)]);
      return;
    }
    /* —— m1-3 沈伯旧账：赠一本灵阶功法 —— */
    if (step === 'm1-3') {
      q.flags.oldDebt = true;
      q.step = 'm1-4';
      var got = grantLingSkill(save);
      if (got) q.flags.oldDebtSkill = got;
      G.Player.chronicle(save, 'oldDebt', '沈伯自述来历，赠旧藏功法'
        + (got ? '《' + G.Data.skills[got].n + '》' : ''));
      G.Storage.saveCurrent(save);
      scene.setOverlay('m1_3', [ack(scene)]);
      return;
    }
    /* —— m1-4 筑基筹备：沈伯旧方（妖丹×3 + 灵石 600）—— */
    if (step === 'm1-4') {
      if (q.flags.foundPill) {
        scene.setOverlay('shenboIdle', [ack(scene)]);
        return;
      }
      if ((save.globalLevel || 1) < M1_4_GATE) {
        G.game.toast('沈伯：火候未到，先修到炼气六段再说');
        return;
      }
      var hasDan = (save.items['妖丹'] || 0) >= 3 && (save.stone || 0) >= 600;
      var btns = [
        new G.UI.Btn({
          x: 150, y: 214, w: 180, h: 24, small: true,
          variant: hasDan ? 'gold' : 'default', disabled: !hasDan,
          label: hasDan ? '沈伯开炉 · 妖丹×3 + 灵石 600'
            : '需 妖丹×3 + 灵石 600',
          onClick: function () {
            save.items['妖丹'] -= 3;
            if (!save.items['妖丹']) delete save.items['妖丹'];
            save.stone -= 600;
            finishPill(scene, save, q, '沈伯连夜开炉。三十年没动过丹炉了。');
          }
        })
      ];
      scene.setOverlay('m1_4', btns);
      return;
    }
    /* —— m1-5 血夜：入夜演出 → 血煞外堂据点 —— */
    if (step === 'm1-5') {
      if ((save.globalLevel || 1) < M1_5_GATE) {
        G.game.toast('沈伯：血煞教的人快到了 —— 你得先修到炼气九段圆满');
        return;
      }
      /* 演出链：对话 → 点「入夜」→ 镇景压暗（explore.startNight）→ 自动进 bloodhall。
         红雾的计时与切图由 explore 负责，这里只递一个 {to, spawn}。 */
      scene.setOverlay('m1_5', [new G.UI.Btn({
        x: 170, y: 214, w: 140, h: 24, small: true, variant: 'danger', label: '入夜 · 赴据点',
        onClick: function () {
          G.Player.chronicle(save, 'bloodNightGo', '血夜，你走向镇外据点');
          G.Storage.saveCurrent(save);
          scene.clearOverlay();
          scene.startNight({
            to: 'bloodhall',
            spawn: { x: G.Data.maps.bloodhall.spawn.x, y: G.Data.maps.bloodhall.spawn.y }
          });
        }
      })]);
      return;
    }

    if (q.step === 'm0-1' && !q.flags.won1) {
      scene.setOverlay('shenbo1', [
        new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
          variant: 'gold', label: '知道了',
          onClick: function () { scene.clearOverlay(); } })
      ]);
      return;
    }
    if (q.step === 'm0-1' && q.flags.won1) {
      save.stone += 50; q.step = 'm0-2';
      G.game.toast('灵石 +50；雪夜可去山神庙');
      scene.clearOverlay();
      return;
    }
    if (q.step === 'm0-4' && save.globalLevel >= 9 && !q.flags.gotBreakPill) {
      save.items['淬体突破丹'] = (save.items['淬体突破丹'] || 0) + 1;
      save.stone += 200;
      q.flags.gotBreakPill = true;
      G.game.toast('沈伯赠你淬体突破丹，灵石 +200');
      scene.clearOverlay();
      return;
    }
    /* 没事可谈 → **开门做生意**（v0.17.0）。
       原来这里弹 `shenboIdle`（一句风味台词），而药铺**全游戏没有购买界面**
       —— 用户口径「药铺点击无法，药铺怎么没有购买界面」。
       沈伯本来就是药铺掌柜，站到柜台前没剧情可演时自然就该是买丹界面。
       ⚠️ 风味台词不丢：面板里留了「与沈伯闲聊」按钮。
       ⚠️ 也**不能**把柜台动作直接改成 `apothecary` —— 那会把上面所有任务分支吞掉
       （M0/M1 主线全靠沈伯这条线，吞了就直接卡死）。 */
    openApothecary(scene);
  }

  /* 取得筑基丹 → m1-4 收口（设计 §4）。
     拿到丹就转 m1-5（血夜）：m1-5 的门槛是"炼气九段圆满 + 持筑基丹"，
     丹是硬前置，所以这里推步不会把玩家卡在一个做不到的目标上。 */
  function finishPill(scene, save, q, line) {
    save.items['筑基丹'] = (save.items['筑基丹'] || 0) + 1;
    q.flags.foundPill = true;
    q.step = 'm1-5';
    G.Player.chronicle(save, 'foundPill', '得筑基丹');
    G.Storage.saveCurrent(save);
    G.game.toast('得「筑基丹」' + (line ? '　' + line : ''));
    scene.clearOverlay();
  }

  /* ===== 刘记杂货 =====
     列表与行距**只有一份**（marketList / rowY），建造与渲染都读它 ——
     以前建造写 `50 + i*21`、渲染写 `SP.y+34+i*21`，两处各写一遍，
     加一行货就必然对不齐（而且是对不齐在静默里）。

     行距 21 → 20 是为了 m1-4 那一行「筑基丹订购」腾位置：
     8 行货 + 妖丹回收 = 9 行，按 21 排会顶到「离开」按钮上（实测重叠 4px）。
     按 20 排：末行 210、底边 228，离开挪到 232 才收得下。 */
  var ROW_H = 20, ROW_Y0 = 50;
  function rowY(i) { return ROW_Y0 + i * ROW_H; }

  /* 本趟进店该摆哪些货。m1-4 且未得丹、且到门槛 → 多一行筑基丹。 */
  function marketList(save) {
    var q = save.quest, step = normStep(save);
    var list = SHOP_ITEMS.slice();
    if (step === 'm1-4' && !q.flags.foundPill && (save.globalLevel || 1) >= M1_4_GATE) {
      /* 第 2 世起涨价（设计 §4）：轮回让开局宽裕，价格跟着走 */
      var life = (G.game.meta && G.game.meta.life) || save.life || 1;
      list.push({ id: '筑基丹', n: '筑基丹', price: life >= 2 ? 1200 : 1000,
        d: '破境筑基所需', m1: true });
    }
    return list;
  }

  function openMarket(scene) {
    var save = G.game.save, q = save.quest, btns = [];
    var step = normStep(save);

    /* m1-2 起刘记多一句闲谈（设计 §4 m1-1）：只在第一次开口时演，之后直接开店 ——
       每次进店都弹一遍对话框会把买东西变成两下点击，纯粹是折腾。 */
    if (step === 'm1-2' && !q.flags.marketHint) {
      q.flags.marketHint = true;
      G.Storage.saveCurrent(save);
      scene.setOverlay('marketHint', [
        new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold',
          label: '看看货', onClick: function () { openMarket(scene); } })
      ]);
      return;
    }

    /* m1-7 离乡（M1 收束）：与刘掌柜道别 → 赠盘缠与回城符 → m1done。
       道别之后**不再开店**：这一趟是告别，不是购物。 */
    if (step === 'm1-7') {
      scene.setOverlay('m1_7', [new G.UI.Btn({
        x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold', label: '收下',
        onClick: function () {
          save.stone += 200;
          save.items['回城符'] = (save.items['回城符'] || 0) + 3;
          q.flags.leaveTown = true;
          q.step = 'm1done';
          /* M2 解锁：写进 meta.story（跨世保留），M1 只落一个"已解锁"的戳。 */
          var meta = G.game.meta || (G.game.meta = {});
          meta.story = meta.story || {};
          meta.story.unlocked = meta.story.unlocked || [];
          if (meta.story.unlocked.indexOf('M2') < 0) meta.story.unlocked.push('M2');
          G.Player.chronicle(save, 'leaveTown', '辞青溪镇，往云州城去');
          G.Storage.saveCurrent(save);
          G.game.toast('灵石 +200　回城符 ×3　M2 · 云州城 已解锁');
          scene.clearOverlay();
        }
      })]);
      return;
    }

    var list = marketList(save);
    list.forEach(function (it, i) {
      var owned = it.skill && save.skills[it.id];
      btns.push(new G.UI.Btn({
        x: SP.x + SP.w - 76, y: rowY(i), w: 60, h: 18,
        small: true, variant: it.m1 ? 'gold' : 'default',
        label: owned ? '已习得' : (it.m1 ? '订购' : '购买'),
        disabled: save.stone < it.price || owned,
        onClick: function () {
          save.stone -= it.price;
          if (it.skill) save.skills[it.id] = { lv: 1 };
          else if (it.m1) { finishPill(scene, save, q, '刘掌柜：郡城调来的货，不赚你钱。'); return; }
          else save.items[it.id] = (save.items[it.id] || 0) + 1;
          openMarket(scene);
        }
      }));
    });
    /* 卖妖丹 */
    btns.push(new G.UI.Btn({
      x: SP.x + SP.w - 76, y: rowY(list.length), w: 60, h: 18,
      small: true, label: '卖妖丹', disabled: !save.items['妖丹'],
      onClick: function () {
        save.items['妖丹'] -= 1;
        if (!save.items['妖丹']) delete save.items['妖丹'];
        save.stone += 15;
        openMarket(scene);
      }
    }));
    btns.push(new G.UI.Btn({
      x: 190, y: 232, w: 100, h: 20, small: true,
      label: '离开', onClick: function () { scene.clearOverlay(); }
    }));
    scene.setOverlay('market', btns);
  }

  /* ===== 药铺（v0.17.0 新增）=====
     与刘记杂货**共用同一套列表/行距/渲染**（`rowY` + `overlay === 'shop'` 分支），
     只有货单不同 —— 两套各写一份的话，加一味药就要改四处（建造/渲染/行距/按钮）。 */
  function openApothecary(scene) {
    var save = G.game.save, btns = [];
    APOTHECARY_ITEMS.forEach(function (it, i) {
      btns.push(new G.UI.Btn({
        x: SP.x + SP.w - 76, y: rowY(i), w: 60, h: 18,
        small: true, label: '购买',
        disabled: save.stone < it.price,
        onClick: function () {
          save.stone -= it.price;
          save.items[it.id] = (save.items[it.id] || 0) + 1;
          G.Storage.saveCurrent(save);
          G.game.toast(it.n + ' ×1　灵石 −' + it.price);
          openApothecary(scene);
        }
      }));
    });
    /* 沈伯的风味台词入口：原来它是"无话可说"时的兜底弹窗，
       现在开店成了兜底，这句台词收进店里当一个按钮（内容一点没丢）。 */
    btns.push(new G.UI.Btn({
      x: SP.x + 18, y: rowY(APOTHECARY_ITEMS.length) + 4, w: 96, h: 20, small: true,
      label: '与沈伯闲聊',
      onClick: function () { scene.setOverlay('shenboIdle', [ack(scene)]); }
    }));
    btns.push(new G.UI.Btn({
      x: 190, y: 232, w: 100, h: 20, small: true,
      label: '离开', onClick: function () { scene.clearOverlay(); }
    }));
    scene.setOverlay('apothecary', btns);
  }

  hooks.renderOverlay = function (x, scene) {
    var save = G.game.save;
    if (G.Overlays.route(x, scene)) return;
    /* 抉择卡：版式与 dialog 同源，只是底部留给竖排选项按钮（选项由 openChoice1 建） */
    if (scene.overlay === 'choice1') {
      G.Overlays.choice(x, DIALOGS.choice1);
      return;
    }
    /* 对话类覆盖层统一走 dialog（立绘 + 名牌 + 折行台词） */
    var d = DIALOGS[scene.overlay];
    if (d) {
      G.Overlays.dialog(x, typeof d === 'function' ? d(save) : d);
      return;
    }
    if (scene.overlay === 'cult') {
      var bs = G.Player.breakState(save);
      G.Overlays.dim(x);
      G.UI.frame(x, SP, save.world.vessel + ' · 珠内空间', { tex: true });
      G.UI.text(x, { x: SP.x + 18, y: 44 },
        '境界 ' + G.Player.realmInfo(save.globalLevel).n
          + '　灵气 ' + bs.have + ' / ' + bs.need, 12, G.UI.C.text);
      G.UI.textOut(x, { x: SP.x + SP.w - 18, y: 44 },
        '灵力 ' + Math.floor(save.po), 12, G.UI.C.text, 'right');
      G.UI.text(x, { x: SP.x + 18, y: 64 }, bs.reason || '气机圆融，可破境矣', 11,
        bs.ready ? G.UI.C.gold : G.UI.C.textDim);

      G.UI.text(x, { x: SP.x + 18, y: 92 }, '功 法', 11.5, G.UI.C.gold);
      G.UI.divider(x, SP.x + SP.w / 2, 99, SP.w - 36);
      Object.keys(save.skills).forEach(function (id, i) {
        var sd = G.Data.skills[id];
        var y = 108 + i * 26;
        G.UI.text(x, { x: SP.x + 18, y: y },
          (sd ? sd.n : id) + ' · Lv' + save.skills[id].lv, 12, G.UI.C.text);
        if (sd) {
          G.UI.text(x, { x: SP.x + 152, y: y + 1 }, sd.elem, 10,
            G.Data.elem.color[sd.elem] || G.UI.C.textDim);
        }
      });
    } else if (scene.overlay === 'market' || scene.overlay === 'apothecary') {
      /* 两家店**共用一套渲染**（只有标题与货单不同）—— 见 openApothecary 的注释。 */
      var isApo = scene.overlay === 'apothecary';
      G.Overlays.dim(x);
      G.UI.panel(x, SP, '#141927');
      G.UI.text(x, { x: SP.x + 18, y: SP.y + 10 },
        isApo ? '药铺 · 沈记' : '刘记杂货', 16, G.UI.C.goldHi);
      G.UI.text(x, { x: SP.x + SP.w - 18, y: SP.y + 12 },
        '灵石 ' + save.stone, 13, G.UI.C.text, 'right');
      if (isApo) {
        APOTHECARY_ITEMS.forEach(function (it, i) {
          var ay = rowY(i);
          G.UI.text(x, { x: SP.x + 18, y: ay }, it.n, 12, G.UI.C.text);
          G.UI.text(x, { x: SP.x + 120, y: ay }, it.d, 11, G.UI.C.textDim);
          G.UI.text(x, { x: SP.x + SP.w - 92, y: ay },
            it.price + ' 灵石', 11, G.UI.C.gold, 'right');
        });
      } else {
        /* 列表与行距必须与 openMarket 读同一份（marketList / rowY），否则货名会串行 */
        var list = marketList(save);
        list.forEach(function (it, i) {
          var y = rowY(i);
          G.UI.text(x, { x: SP.x + 18, y: y }, it.n, 12,
            it.m1 ? G.UI.C.goldHi : G.UI.C.text);
          G.UI.text(x, { x: SP.x + 120, y: y }, it.d, 11, G.UI.C.textDim);
          G.UI.text(x, { x: SP.x + SP.w - 92, y: y },
            it.price + ' 灵石', 11, G.UI.C.gold, 'right');
        });
        var y = rowY(list.length);
        G.UI.text(x, { x: SP.x + 18, y: y }, '妖丹回收', 12, G.UI.C.text);
        G.UI.text(x, { x: SP.x + SP.w - 92, y: y },
          '15 灵石', 11, G.UI.C.gold, 'right');
      }
    }
  };

  G.scenes.town = G.Explore.create('town', hooks);

  /* ============================================================
     室内场景：三栋房屋共用一套壳（同样的菜单 / 覆盖层渲染），
     只有"家具动作表"不同。
     ============================================================ */
  function makeInterior(mapId, acts) {
    return G.Explore.create(mapId, {
      menu: function (scene) { G.TianDao.openSettings(scene); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      onInteract: function (o, scene) {
        if (o.type !== 'furn') return;
        var fn = acts[o.act];
        if (fn) { fn(scene); return; }
        G.game.toast(o.label ? (o.label + '　没什么可做的') : '没什么可做的');
      },
      /* 室内也站人：药铺柜台后是沈伯、杂货铺柜台后是刘掌柜。
         和家具动作分开走 —— 点人也行、点柜台也行，两条路都通。 */
      onNpc: onNpc,
      npcMark: npcMark,
      renderOverlay: hooks.renderOverlay
    });
  }

  /* 珠内空间：拿到逆命珠之前里面空空如也（等价于旧版 home 面板的 gated） */
  function useVessel(scene) {
    var q = G.game.save.quest;
    if (q.step === 'm0-1' || q.step === 'm0-2') {
      G.game.toast('珠中空空如也，尚无气机可引');
      return;
    }
    openCult(scene);
  }

  G.scenes.town_home = makeInterior('town_home', {
    rest: restOnBed,
    meditate: meditateOnCushion,
    cult: useVessel
  });
  G.scenes.town_shop = makeInterior('town_shop', {
    /* 柜台一条路：有剧情先演剧情、没剧情才开店（见 shenBo 的兜底分支）。
       ⚠️ 不要拆成"柜台=商店 / 沈伯=对话"两个动作 —— 沈伯站在柜台之后，
       玩家够不到他本人，拆开就会把 M0/M1 的主线对话整条吞掉。 */
    shenbo: function (scene) { shenBo(scene); }
  });
  G.scenes.town_market = makeInterior('town_market', {
    market: function (scene) { openMarket(scene); }
  });
})();
