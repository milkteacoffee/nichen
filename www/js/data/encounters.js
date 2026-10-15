/* ============================================================
   随机奇遇 · 百世游（对标《烟雨江湖》「江湖奇遇」，G1）
   ------------------------------------------------------------
   与「主线插曲·机缘 StoryEvents」的区别：
     · StoryEvents 是**一次性、固定（境界/地图/主线）触发**，看过永不复现；
     · 本模块是**走路随机、无固定地点、每日按种子刷新序列、可重复**的奇遇 ——
       每一世、每一日都可能遇到，是探索路上的"意外惊喜"。
   机制（对齐烟雨「每日 5 点刷新随机序列、概率极低、紫色感叹号」）：
     · 以**游戏日**为单位做计划：种子 = worldSeed + ':enc:' + 当日序号（防 SL，可复现）。
     · 每日按概率决定：无 / 普通(白) / 稀有(紫) / 罕见(金)，并从符合当前世界与境界的
       事件池里随机选一条；再随机一个"触发步数"（14–42 步野外行走）。
     · 走到步数 → 头顶弹出对应颜色「!」→ 展开事件（有取舍、有奖惩、可能死）。
     · 当日没走够 / 地形不合 / 飞过去了，该奇遇作废（不强行补发）。
   奖惩复用既有系统：stone / qi / po / items / 死（dead 走 G.game.die）。
   ⚠️ 与 StoryEvents 同一条铁律：含 dead 的选项必须在文案写清代价，且每条至少留一条活路。
   ============================================================ */
(function () {
  function has(save, name) { return ((save.items || {})[name] || 0) > 0; }
  function take(save, name) {
    save.items[name] = (save.items[name] || 0) - 1;
    if (save.items[name] <= 0) delete save.items[name];
  }
  function addItem(save, name, n) {
    save.items[name] = (save.items[name] || 0) + (n || 1);
  }

  /* ============================ 事件池 ============================ */
  var POOL = [
    /* ---------- 普通（白）：日常、凡人、小取舍 ---------- */
    { id: 'ec_pouch', rarity: 'common', title: '路 遗 布 囊',
      lines: ['山道上躺着一个粗布囊，沾着泥，里头隐约有几十文钱与半块干饼。',
        '远处，一个樵夫模样的人正弯腰在草丛里翻找，神色焦急。'],
      choices: [
        { t: '呼喊归还', run: function (s) {
          s.po = (s.po || 0) + 6;
          return '你喊住那人，把布囊递还。他千恩万谢。你心头一暖，灵力 +6。'; } },
        { t: '收起钱囊', run: function (s) {
          s.stone = (s.stone || 0) + 40;
          return '你把布囊揣进怀里走开。几十文钱不多，可那樵夫的背影你记了一路。'; } }
      ] },

    { id: 'ec_hare', rarity: 'common', title: '伤 兔',
      lines: ['一只野兔被猎人的夹子夹住了后腿，见你靠近，吓得浑身发抖，却挣扎不脱。',
        '它的毛皮完整，兔肉也能果腹。'],
      choices: [
        { t: '掰开夹子放生', run: function (s) {
          s.po = (s.po || 0) + 5;
          return '你掰开夹子，野兔一瘸一拐地钻进草丛。灵力 +5。'; } },
        { t: '拎走加餐', run: function (s) {
          addItem(s, '兽皮', 1);
          return '你拎起野兔。乱世里，心软的人活不长——你这样告诉自己。'; } }
      ] },

    { id: 'ec_fruit', rarity: 'common', title: '野 果 林',
      lines: ['一片无人打理的野果林，果子红得透亮，挂着晨露。',
        '其中几株颜色格外鲜艳，却隐隐有股说不清的气味。'],
      choices: [
        { t: '摘寻常果子', run: function (s) {
          s.qi = (s.qi || 0) + 60;
          return '你挑了些寻常果子吃了，清甜解渴，精神一振。灵气 +60。'; } },
        { t: '贪那鲜艳的', run: function (s) {
          s.hp = Math.max(1, Math.round(s.hp * 0.7));
          return '那果子竟有微毒！你上吐下泻，气血亏了三成。'; } }
      ] },

    { id: 'ec_scholar', rarity: 'common', title: '落 难 书 生',
      lines: ['一个书生盘缠被劫，坐在路边唉声叹气，说要进京赶考，却连买饼的钱都没了。',
        '他见你气度不凡，连连作揖。'],
      choices: [
        { t: '赠些盘缠', run: function (s) {
          s.stone = (s.stone || 0) - 30; s.po = (s.po || 0) + 6;
          return '你赠他灵石应急。书生含泪记下你的名姓，说他日必报。灵力 +6。'; } },
        { t: '拂袖而去', run: function () {
          return '你不是救苦救难的菩萨。修仙路上，凡人的事管不完。'; } }
      ] },

    { id: 'ec_well', rarity: 'common', title: '路 畔 古 井',
      lines: ['一口古井，井沿长满青苔，井水清冽，倒映着天光。',
        '井壁上似乎刻着几行被岁月磨平的小字。'],
      choices: [
        { t: '取井水饮', run: function (s) {
          s.qi = (s.qi || 0) + 80;
          return '井水甘冽，入腹竟有一丝暖意，灵气 +80。'; } },
        { t: '细看井壁刻字', run: function (s) {
          s.po = (s.po || 0) + 7;
          return '刻字是前人留下的一句静心口诀，你默默记下。灵力 +7。'; } }
      ] },

    { id: 'ec_peddler', rarity: 'common', title: '神 秘 货 郎',
      lines: ['一个货郎挑着担子，笑眯眯地拦住你：“客观，我这有件‘盲货’，五十灵石，买不买？”',
        '他掀开一角，只看得出是个木盒，瞧不清里头。'],
      choices: [
        { t: '花五十灵石买下', run: function (s) {
          if ((s.stone || 0) < 50) return '你摸了摸钱袋，灵石不够，货郎挑着担子走了。';
          s.stone -= 50;
          var r = G.rng.next();
          if (r < 0.4) { addItem(s, '聚灵珠', 1); return '木盒里竟是一枚聚灵珠！你捡了个漏。'; }
          if (r < 0.75) { s.stone += 70; return '盒里是几块品相不错的灵石，算下来还小赚。'; }
          return '盒里只有一块普通石头。货郎早已不见踪影，你自认晦气。'; } },
        { t: '不买', run: function () {
          return '你疑心是骗局，摇头走开。天上不会掉馅饼。'; } }
      ] },

    { id: 'ec_temple', rarity: 'common', title: '破 庙 避 雨',
      lines: ['天降骤雨，你躲进一座山神庙，庙中已有个老乞丐，正烤着一只不知什么的山鼠。',
        '他抬眼瞧你，拍了拍身旁的干草。'],
      choices: [
        { t: '与他分食烤火', run: function (s) {
          s.po = (s.po || 0) + 6; s.qi = (s.qi || 0) + 70;
          return '你俩分着吃了那点东西，老乞丐说了好些山野怪谈。雨停时，你心里难得一暖。'; } },
        { t: '独自守在角落', run: function (s) {
          s.qi = (s.qi || 0) + 40;
          return '你抱剑守在角落调息，等雨停。灵气 +40。'; } }
      ] },

    { id: 'ec_river', rarity: 'common', title: '河 边 老 翁',
      lines: ['河边一个老翁垂钓，鱼篓里却空空如也。他望着你笑：“小友，老朽饿了一日了。”',
        '你囊中还有半张饼。'],
      choices: [
        { t: '分饼给他', run: function (s) {
          s.po = (s.po || 0) + 6;
          return '你把饼分了一半。老翁吃罢，指着上游说那里有株老药，算是谢礼。灵力 +6。'; } },
        { t: '自顾自走', run: function () {
          return '你自身难保，顾不上一个素不相识的老翁。'; } }
      ] },

    /* ---------- 稀有（紫）：机缘、风险、修行相关 ---------- */
    { id: 'ec_dwelling', rarity: 'rare', title: '前 人 遗 庐',
      lines: ['山壁上一道阵法遮掩的裂缝，里头是一间前人留下的闭关庐，案上积着灰，摆着一卷手札。',
        '庐外隐隐有禁制残留，似乎挡着什么。'],
      choices: [
        { t: '静心参读手札', run: function (s) {
          s.qi = (s.qi || 0) + 1200; addItem(s, '凡品功法碎片', 3);
          return '手札记载着前人的修行心得，你参悟半日，受益匪浅，灵气 +1200。'; } },
        { t: '翻找储物之处', run: function (s) {
          s.stone = (s.stone || 0) + 300;
          return '你在暗格里翻出一笔灵石，手札却已被虫蛀毁，再读不得了。'; } }
      ] },

    { id: 'ec_stele', rarity: 'rare', title: '残 碑',
      lines: ['荒野中立着半截断碑，碑上的纹路似字非字，看上一眼，竟心神微荡。',
        '碑前散落着几具早已腐朽的骸骨。'],
      choices: [
        { t: '盘膝参悟', run: function (s) {
          s.qi = (s.qi || 0) + 1500;
          return '你依着碑文调息，似有所悟，灵气 +1500。那几具骸骨，或许是参悟失败的前人。'; } },
        { t: '心生警退', run: function (s) {
          s.po = (s.po || 0) + 10;
          return '你察觉这碑邪性，不敢久留，转身便走。灵力 +10。'; } }
      ] },

    { id: 'ec_duel', rarity: 'rare', title: '散 修 斗 法',
      lines: ['两名散修正在林间斗得你死我活，灵光四溅，脚边落着一个无人看管的储物袋。',
        '他们都已负伤，一时谁也没注意到你。'],
      choices: [
        { t: '趁乱取走储物袋', run: function (s) {
          s.stone = (s.stone || 0) + 450;
          return '你趁两人缠斗，悄悄拎走储物袋，里头灵石不少。背后的斗法声渐弱，你不敢回头。'; } },
        { t: '出声喝止', run: function (s) {
          s.po = (s.po || 0) + 12;
          return '你一声断喝，两人惊觉有第三方，各自罢手，恶狠狠地瞪你一眼后离去。灵力 +12。'; } },
        { t: '远远绕开', run: function () {
          return '你绕了一大圈。这种是非，沾上就是因果。'; } }
      ] },

    { id: 'ec_cub', rarity: 'rare', title: '灵 兽 幼 崽',
      lines: ['一只幼兽蜷在树根下，后腿染血，一双眼睛湿漉漉地望着你。',
        '它气息不凡，显然是种灵物，可成年的母兽或许就在附近。'],
      choices: [
        { t: '包扎后放生', run: function (s) {
          s.po = (s.po || 0) + 14;
          return '你替它包扎伤口放它离去。幼兽走出几步回头望你，似是记下了你的气息。'; } },
        { t: '带在身边', run: function (s) {
          var gl = s.globalLevel || 1;
          var wid = G.Player.worldOfGL(gl).id;
          var pets = [], any = [];
          G.Data.beasts.list.forEach(function (sp) {
            if (sp.world !== wid || sp.role === 'boss') return;
            if (sp.role === 'pet' || sp.role === 'battle' || sp.role === 'both') pets.push(sp.id);
            any.push(sp.id);
          });
          var pool = pets.length ? pets : any;
          if (pool.length && G.Beasts && G.Beasts.add) {
            var id = pool[Math.floor(G.rng.next() * pool.length)];
            var r = G.Beasts.add(s, id);
            if (r.ok) return '你将它带在身边照料，它一路跟着你，成了你的灵兽（' +
              G.Data.beasts.byId(id).n + '）。';
          }
          s.po = (s.po || 0) + 8;
          return '它挣扎着不肯跟你，一瘸一拐地逃了。你只得作罢。'; } }
      ] },

    { id: 'ec_wounded', rarity: 'rare', title: '重 伤 道 人',
      lines: ['一个道人倒在血泊里，气息奄奄，见你来，颤抖着解下一枚玉简：“替我……毁掉它，别让它落入旁人之手。”',
        '那玉简灵光流转，显然不是凡物。'],
      choices: [
        { t: '依言毁掉玉简', run: function (s) {
          s.po = (s.po || 0) + 14;
          return '你当着他的面震碎玉简，道人含笑而逝。灵力 +14。'; } },
        { t: '留下玉简', run: function (s) {
          s.qi = (s.qi || 0) + 1000;
          return '你收起玉简，道人死死盯着你，咽了气。那玉简里的东西，你还没敢细看。'; } }
      ] },

    /* ---------- 罕见（金）：大机缘 / 大凶险 ---------- */
    { id: 'ec_rift', rarity: 'epic', title: '秘 境 裂 缝',
      lines: ['半空凭空裂开一道金色缝隙，灵气如潮水般涌出，隐约可见里头是一处未被踏足的秘境。',
        '裂缝正在缓缓合拢，灵气浓得几乎化作实质。'],
      choices: [
        { t: '冒险闯入', run: function (s) {
          var r = G.rng.next();
          if (r < 0.55) { s.qi = (s.qi || 0) + 4000; addItem(s, '千年灵芝', 1);
            return '你在秘境合拢前抢出一株千年灵药，灵气 +4000。'; }
          if (r < 0.85) { s.stone = (s.stone || 0) + 1500;
            return '你在秘境中胡乱抓了一把，是一袋品相上佳的灵石，也算不虚此行。'; }
          s.hp = Math.max(1, Math.round(s.hp * 0.25));
          return '裂缝合拢得太快，你被乱流绞中，险些陨落，拼死才逃出来。'; } },
        { t: '不敢冒进', run: function (s) {
          s.po = (s.po || 0) + 12;
          return '你看着裂缝合拢消散。机缘与凶险并存，你选择了稳妥。灵力 +12。'; } }
      ] },

    { id: 'ec_daostone', rarity: 'epic', title: '道 韵 奇 石',
      lines: ['一块奇石静静躺在溪底，表面流转着难言的纹路，靠近它，连周遭灵气都变得温顺。',
        '石上有一道古老禁制，稍触即有反震。'],
      choices: [
        { t: '以神识温养禁制', run: function (s) {
          s.qi = (s.qi || 0) + 3500;
          return '你小心翼翼温养许久，禁制渐消，奇石入怀，似含一缕道韵。灵气 +3500。'; } },
        { t: '强取', run: function (s) {
          s.hp = Math.max(1, Math.round(s.hp * 0.4));
          return '禁制反震，你被震得气血翻涌，奇石却沉入溪底，再寻不见了。'; } }
      ] },

    /* ---------- 高界专属（按世界过滤）---------- */
    { id: 'ec_tide', rarity: 'rare', world: 'ling', title: '灵 潮',
      lines: ['天地间忽然响起嗡鸣，浓郁的灵气化作肉眼可见的潮汐，自远方涌来。',
        '这是灵界才有的景象，灵潮过境，修士若能借势修炼，事半功倍。'],
      choices: [
        { t: '就地借潮修炼', run: function (s) {
          s.qi = (s.qi || 0) + 3000;
          return '你盘膝借灵潮之势，灵气 +3000，周身毛孔尽数张开。'; } },
        { t: '趁潮采集灵物', run: function (s) {
          s.stone = (s.stone || 0) + 800;
          return '灵潮催熟了不少灵物，你趁势采集，收获颇丰。'; } }
      ] },

    { id: 'ec_feast', rarity: 'epic', world: 'xian', title: '仙 宴 遗 丹',
      lines: ['云海深处，一座不知荒废了多少岁月的仙宴台上，玉盘里静静躺着一枚金光流转的丹药。',
        '丹香四溢，闻上一口便觉神清气爽，可丹侧却伏着几具枯骨。'],
      choices: [
        { t: '叩首后取丹', run: function (s) {
          s.qi = (s.qi || 0) + 6000;
          return '你先向仙宴台行礼，那丹药竟自行飞起落入你掌心，灵气 +6000。'; } },
        { t: '直接伸手去拿', run: function (s) {
          s.hp = Math.max(1, Math.round(s.hp * 0.3));
          return '丹旁禁制骤起，你被震飞出去，险些道基受损。那几具枯骨便是前车之鉴。'; } }
      ] },

    { id: 'ec_daorhy', rarity: 'epic', world: 'dao', title: '道 则 碎 片',
      lines: ['道界虚空之中，一缕游离的道则碎片缓缓漂浮，似在喃喃自语，说着天地初开的道理。',
        '它太过深奥，强行参悟，恐被道则反噬。'],
      choices: [
        { t: '远远聆听感悟', run: function (s) {
          s.qi = (s.qi || 0) + 8000;
          return '你不敢近前，只远远聆听，竟也有所悟，灵气 +8000。'; } },
        { t: '伸手抓取', run: function (s) {
          s.hp = Math.max(1, Math.round(s.hp * 0.5));
          return '道则碎片在你掌中炸开，那是天地初开的伟力，你被震得神魂俱颤。'; } }
      ] }
  ];

  /* ============================ 每日计划 ============================ */
  var RARITY_COLOR = { common: '#d8d2c0', rare: '#b87aff', epic: '#ffcf5a' };
  var RARITY_NAME = { common: '普通', rare: '稀有', epic: '罕见' };

  function dayIndex(save) {
    return Math.floor(((save && save.gt) || 0) / G.Time.MIN_PER_DAY);
  }

  /* 当日符合 世界 / 境界 / 稀有度 的事件列表 */
  function eligible(save, rarity) {
    var gl = save.globalLevel || 1;
    var wid = G.Player.worldOfGL(gl).id;
    var out = [];
    for (var i = 0; i < POOL.length; i++) {
      var e = POOL[i];
      if (e.rarity !== rarity) continue;
      if (e.world && e.world !== wid) continue;
      if (e.minGl != null && gl < e.minGl) continue;
      if (e.maxGl != null && gl > e.maxGl) continue;
      out.push(e);
    }
    return out;
  }

  /* 为某游戏日生成计划：{ ev, atStep } 或 null（当日无奇遇）。确定性。 */
  function planFor(save, day) {
    var rng = new G.RNG(G.RNG.hash(String(save.worldSeed) + ':enc:' + day));
    var r = rng.next();
    var rarity = null;
    if (r < 0.03) rarity = 'epic';
    else if (r < 0.13) rarity = 'rare';
    else if (r < 0.55) rarity = 'common';
    if (!rarity) return null;
    var list = eligible(save, rarity);
    if (!list.length) {
      /* 该稀有度当日无符合事件 → 退回普通池；仍无则当日无奇遇 */
      list = eligible(save, 'common');
      if (!list.length) return null;
    }
    var ev = list[rng.int(0, list.length - 1)];
    return { ev: ev, atStep: rng.int(14, 42) };
  }

  function ensure(save) {
    if (!save.enc) save.enc = { day: null, steps: 0, plan: null, fired: false };
    var day = dayIndex(save);
    if (save.enc.day !== day) {
      save.enc.day = day;
      save.enc.steps = 0;
      save.enc.fired = false;
      save.enc.plan = planFor(save, day);
    }
    return save.enc;
  }

  /* ============================ 行走触发 ============================ */
  /* 每走一格（野外、非飞行）调用一次 */
  function tickStep(scene) {
    var save = G.game.save;
    if (!save || scene._encPop || scene._encEv) return;
    var st = ensure(save);
    if (!st.plan || st.fired) return;
    st.steps += 1;
    if (st.steps >= st.plan.atStep) {
      st.fired = true;
      /* 先弹「!」感叹号（0.7s），再展开事件 —— 对齐烟雨的头顶提示 */
      scene._encPop = { t: 0.7, t0: 0.7, color: RARITY_COLOR[st.plan.ev.rarity] };
      G.Storage.saveCurrent(save);
    }
  }

  /* 感叹号弹出期间的推进（explore.update 中调用，在移动逻辑之前） */
  function tickPop(scene, dt) {
    if (!scene._encPop) return false;
    scene._encPop.t -= dt;
    if (scene._encPop.t <= 0) {
      var st = ensure(G.game.save);
      var ev = st.plan.ev;
      scene._encPop = null;
      show(scene, ev);
    }
    return true;
  }

  /* 画头顶「!」（在世界/角色层，随玩家位置，须在世界变换内调用） */
  function drawPop(x, scene) {
    if (!scene._encPop || !scene.map) return;
    var pp = scene._pxDraw();
    var p = scene._proj(pp.x, pp.y);
    var k = 1 - scene._encPop.t / scene._encPop.t0;          /* 0→1 */
    var bob = Math.sin(k * Math.PI) * 4;
    var y = p.y - 30 - bob;
    x.save();
    x.font = 'bold 16px sans-serif';
    x.textAlign = 'center';
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.7)';
    x.strokeText('!', p.x, y);
    x.fillStyle = scene._encPop.color;
    x.fillText('!', p.x, y);
    x.restore();
  }

  /* ============================ 事件展开 ============================ */
  function show(scene, ev) {
    scene._encEv = ev;
    scene._encResult = null;
    scene._encDead = false;
    var n = ev.choices.length;
    var bw = Math.min(116, Math.floor((400 - (n - 1) * 10) / n));
    var x0 = 240 - (n * bw + (n - 1) * 10) / 2;
    var btns = ev.choices.map(function (c, i) {
      return new G.UI.Btn({
        x: Math.round(x0 + i * (bw + 10)), y: 196, w: bw, h: 38, small: true,
        variant: i === 0 ? 'gold' : (c.dead ? 'battle' : 'default'), label: c.t,
        onClick: function () {
          var r = c.run(G.game.save);
          scene._encDead = !!c.dead;
          G.Storage.saveCurrent(G.game.save);
          _showResult(scene, r);
        }
      });
    });
    scene.setOverlay('encounter', btns);
  }

  function _showResult(scene, r) {
    scene._encResult = r;
    var dead = scene._encDead;
    scene.buttons = [
      new G.UI.Btn({ x: 190, y: 210, w: 100, h: 24, small: true,
        variant: dead ? 'battle' : 'ghost',
        label: dead ? '……' : '知道了',
        onClick: function () {
          scene._encEv = null; scene._encResult = null;
          scene.clearOverlay();
          if (dead && G.game.die) { G.game.die('event'); return; }
        } })
    ];
  }

  /* ============================ 渲染 ============================ */
  function render(x, scene) {
    var ev = scene._encEv;
    if (!ev) return;
    G.Overlays.dim(x);
    var P = { x: 40, y: 40, w: 400, h: 188 };
    G.UI.frame(x, P, ev.title, { tex: true });
    /* 稀有度色条（左侧一条，直观区分白/紫/金） */
    x.fillStyle = RARITY_COLOR[ev.rarity];
    x.fillRect(P.x + 6, P.y + 14, 3, P.h - 28);
    /* 「奇遇 · 稀有度」小标签 */
    G.UI.text(x, { x: P.x + P.w - 70, y: P.y + 12 }, '奇遇 · ' + RARITY_NAME[ev.rarity],
      11, RARITY_COLOR[ev.rarity]);
    if (scene._encResult) {
      var rl = G.UI.wrap(x, scene._encResult, 12.5, P.w - 60);
      rl.forEach(function (l, i) {
        G.UI.text(x, { x: P.x + 30, y: P.y + 80 + i * 22 }, l, 12.5, '#e2d8be');
      });
    } else {
      var y = P.y + 44;
      ev.lines.forEach(function (l) {
        var ls = G.UI.wrap(x, l, 12.5, P.w - 56);
        ls.forEach(function (w) {
          G.UI.text(x, { x: P.x + 28, y: y }, w, 12.5, '#d8d2c0');
          y += 21;
        });
        y += 5;
      });
    }
  }

  /* ============================ 导出 ============================ */
  G.Data = G.Data || {};
  G.Data.Encounters = {
    pool: POOL,
    rarityColor: RARITY_COLOR,
    planFor: function (save, day) { return planFor(save, day); },
    ensure: ensure,
    tickStep: tickStep,
    tickPop: tickPop,
    drawPop: drawPop,
    render: render
  };
})();
