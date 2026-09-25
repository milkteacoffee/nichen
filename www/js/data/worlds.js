/* 万界轮回：世界相、命名词库、世界特质与生成器（v0.8） */
(function () {
  var xiang = [
    { id: '水泽', n: '江南水泽',
      pal: { ground: '#4a6b42', dark: '#3a5735', grass: '#5fbf5f', water: '#5a9fd6', rock: '#7a7f8a' },
      townSuf: ['镇', '渡', '浦', '塘'], mountainSuf: ['山', '岭'],
      beast: { 青纹蛇: .55, 赤炎狼: .30, 树精: .15 },
      traitBias: ['W1', 'W4'] },
    { id: '群山', n: '苍莽群山',
      pal: { ground: '#3d4a38', dark: '#2f3a2c', grass: '#4f9f4f', water: '#4a8fc6', rock: '#6d727c' },
      townSuf: ['寨', '堡', '驿'], mountainSuf: ['岭', '峰', '崖'],
      beast: { 赤炎狼: .5, 青纹蛇: .25, 树精: .25 },
      traitBias: ['W3', 'W7'] },
    { id: '戈壁', n: '荒原戈壁',
      pal: { ground: '#8a7a52', dark: '#6f6242', grass: '#9a8a62', water: '#5a9fd6', rock: '#9a9080' },
      townSuf: ['堡', '关', '驿', '集'], mountainSuf: ['山', '崖'],
      beast: { 赤炎狼: .4, 树精: .2, 青纹蛇: .4 },
      traitBias: ['W6', 'W14'] },
    { id: '海岛', n: '海岛仙洲',
      pal: { ground: '#5a7a6a', dark: '#486658', grass: '#6fbf8f', water: '#4a9fd6', rock: '#8a909a' },
      townSuf: ['礁', '洲', '汀'], mountainSuf: ['屿', '峰'],
      beast: { 青纹蛇: .45, 树精: .3, 赤炎狼: .25 },
      traitBias: ['W10', 'W11'] },
    { id: '雪域', n: '雪域寒原',
      pal: { ground: '#9aa6b2', dark: '#7e8a96', grass: '#b2bec8', water: '#7ab8e6', rock: '#aab0ba' },
      townSuf: ['川', '泊', '原'], mountainSuf: ['谷', '峰', '山'],
      beast: { 赤炎狼: .45, 青纹蛇: .25, 树精: .3 },
      traitBias: ['W12', 'W13'] }
  ];

  var pools = {
    gj: ['越国', '苍梧国', '云泽国', '北凉', '南诏', '西凉国', '青丘国', '云梦', '朔方郡', '瀚海国'],
    town: ['青溪', '白鹿', '石泉', '桃夭', '暮云', '柳泊', '鹤栖', '横塘', '龙井', '枫林', '渔阳', '稻花'],
    mountain: ['翠微', '栖霞', '苍莽', '雾隐', '青冥', '九嶷', '断龙', '卧虎', '听松', '照胆', '太白'],
    cave: ['赤牙', '黑风', '血牙', '阴风', '乱石', '幽篁', '吞云', '白骨', '朱砂', '水帘'],
    sect: ['栖霞宗', '玄剑门', '丹霞谷', '云水庵', '万法宗', '太乙观', '青冥阁', '药王谷', '御兽山庄', '聚宝楼'],
    elderX: ['沈', '李', '王', '张', '刘', '陈', '赵', '周', '吴'],
    elderN: ['伯', '翁', '德海', '福', '老栓'],
    shopX: ['刘', '王', '孙', '钱', '郑'],
    shopT: ['掌柜', '二娘'],
    snake: ['青纹蛇', '碧鳞蛇', '墨环蛇', '花脊蛇', '白线蛇'],
    wolf: ['赤炎狼', '苍鬃狼', '玄夜狼', '黄毛狼', '雪斑狼'],
    vessel: ['染血骨珠', '墨色玉玦', '残旧木牌', '黯淡玉佩', '黑石念珠', '半枚铜钱', '碎玉片']
  };

  var traits = [
    { id: 'W1', n: '灵气氤氲', e: { qi: .12 }, mutex: 'W2' },
    { id: 'W2', n: '灵气稀薄', e: { qi: -.10, st: .10 }, mutex: 'W1' },
    { id: 'W3', n: '妖兽横行', e: { enemyMul: { hp: .08, atk: .08 }, qi: .10, po: .10 } },
    { id: 'W4', n: '太平景象', e: { eventGood: .5 }, mutex: 'W5' },
    { id: 'W5', n: '多灾多难', e: { eventHard: .5, chest: .20 }, mutex: 'W4' },
    { id: 'W6', n: '矿藏丰饶', e: { st: .15 } },
    { id: 'W7', n: '武道昌盛', e: { a: .06 } },
    { id: 'W8', n: '文气鼎盛', e: { po: .12 } },
    { id: 'W9', n: '瘴气弥漫', e: { he: -.10, enemyElem: { '木': .10 } } },
    { id: 'W10', n: '风雷激荡', e: { eb: { '风': .15, '雷': .15 } } },
    { id: 'W11', n: '长夜无昼', e: { eb: { '暗': .15, '光': -.10 } }, mutex: 'W12' },
    { id: 'W12', n: '烈阳当空', e: { eb: { '光': .15, '火': .15 } }, mutex: 'W11' },
    { id: 'W13', n: '洞天福地', e: { br: -.10 }, mutex: 'W14' },
    { id: 'W14', n: '末法之世', e: { br: .10, st: .20 }, mutex: 'W13' }
  ];

  function uniqName(rng, gan, sufs, used) {
    for (var tries = 0; tries < 20; tries++) {
      var s = rng.pick(gan) + rng.pick(sufs);
      if (used.indexOf(s) < 0) { used.push(s); return s; }
    }
    return rng.pick(gan) + rng.pick(sufs);
  }

  function generateWorld(seed, anchor) {
    var rng = new G.RNG(seed);
    var x, used = [];
    if (anchor) {
      x = xiang[0];
      return {
        seed: seed, anchor: true, xiang: x.id, pal: x.pal, beast: x.beast,
        names: { gj: '越国', town: '青溪镇', mountain: '翠微山', cave: '赤牙洞', sect: '栖霞宗',
          elder: '沈伯', shop: '刘掌柜' },
        vessel: '逆命珠', traits: []
      };
    }
    x = rng.pick(xiang);
    var names = {
      gj: rng.pick(pools.gj),
      town: uniqName(rng, pools.town, x.townSuf, used),
      mountain: uniqName(rng, pools.mountain, x.mountainSuf, used),
      cave: uniqName(rng, pools.cave, ['洞', '窟', '谷', '涧'], used),
      sect: rng.pick(pools.sect),
      elder: rng.pick(pools.elderX) + rng.pick(pools.elderN),
      shop: rng.pick(pools.shopX) + rng.pick(pools.shopT)
    };
    /* 1 特质（M1 扩 2） */
    var t = rng.pick(traits);
    return {
      seed: seed, anchor: false, xiang: x.id, pal: x.pal, beast: x.beast,
      names: names, vessel: rng.pick(pools.vessel), traits: [t.id]
    };
  }

  G.Data = G.Data || {};
  G.Data.xiang = xiang;
  G.Data.namePools = pools;
  G.Data.worldTraits = traits;
  G.Data.worldTraitById = function (id) {
    for (var i = 0; i < traits.length; i++) if (traits[i].id === id) return traits[i];
    return null;
  };
  G.Data.generateWorld = generateWorld;
})();
