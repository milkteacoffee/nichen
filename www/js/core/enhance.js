/* 装备强化系统（v0.76.0 阶段九）
 *
 * 设计理念：
 *   · 借鉴《想不想修真》：强化+1到+10，每级提升10%属性，失败不损坏装备
 *   · 借鉴《暴走英雄坛》：有趣的文案反馈
 *   · 借鉴《放置江湖》：操作简单直观，立即看到提升
 *
 * 核心机制：
 *   · 强化等级：+0 → +10
 *   · 成功率：+1~+3(90%) → +4~+5(75%) → +6~+7(60%) → +8~+9(40%) → +10(25%)
 *   · 消耗：灵石 + 材料（凡品→玄铁，灵品→精钢，宝品→灵玉）
 *   · 强化效果：每+1级增加10%基础属性
 *   · 失败惩罚：只消耗材料，装备不损坏
 */
(function () {
  /* 强化成功率配置 */
  var SUCCESS_RATE = {
    1: 0.90, 2: 0.90, 3: 0.90,
    4: 0.75, 5: 0.75,
    6: 0.60, 7: 0.60,
    8: 0.40, 9: 0.40,
    10: 0.25
  };

  /* 强化消耗配置（按装备品阶）*/
  var COST_CFG = {
    '凡': { stone: 100, mat: '玄铁', matCnt: 1 },
    '灵': { stone: 500, mat: '精钢', matCnt: 2 },
    '宝': { stone: 2000, mat: '灵玉', matCnt: 3 },
    '锻': { stone: 800, mat: '精钢', matCnt: 2 },
    '道': { stone: 5000, mat: '道纹矿', matCnt: 5 }
  };

  /* 强化消耗随等级递增（每级×1.5） */
  function calcCost(tier, lv) {
    var cfg = COST_CFG[tier] || COST_CFG['凡'];
    var mult = Math.pow(1.5, lv);
    return {
      stone: Math.floor(cfg.stone * mult),
      mat: cfg.mat,
      matCnt: Math.max(1, Math.floor(cfg.matCnt * mult))
    };
  }

  /* 获取装备当前强化等级 */
  function getLevel(save, equipId) {
    save.enhance = save.enhance || {};
    return save.enhance[equipId] || 0;
  }

  /* 设置装备强化等级 */
  function setLevel(save, equipId, lv) {
    save.enhance = save.enhance || {};
    save.enhance[equipId] = lv;
  }

  /* 检查是否可以强化 */
  function canEnhance(save, equipId) {
    var eq = G.Data.equips.byId(equipId);
    if (!eq) return { ok: false, msg: '未知装备' };

    var lv = getLevel(save, equipId);
    if (lv >= 10) return { ok: false, msg: '已达最高强化等级' };

    var cost = calcCost(eq.tier, lv);
    var stone = G.Player.stoneCount(save);
    if (stone < cost.stone) {
      return { ok: false, msg: '灵石不足（需要' + cost.stone + '）' };
    }

    var matCnt = (save.items && save.items[cost.mat]) || 0;
    if (matCnt < cost.matCnt) {
      return { ok: false, msg: cost.mat + '不足（需要' + cost.matCnt + '）' };
    }

    return { ok: true, cost: cost, lv: lv };
  }

  /* 强化成功文案 */
  var SUCCESS_TEXTS = [
    '灵光一闪，强化成功！',
    '法宝嗡鸣，品质提升！',
    '铸炼圆满，威能大增！',
    '天时地利，一举功成！',
    '此番铸炼，恰到好处！'
  ];

  /* 强化失败文案 */
  var FAIL_TEXTS = [
    '铸炼不稳，未能成功……',
    '火候差了一线，未能圆满。',
    '材料融入不顺，可惜了……',
    '差一点就成了，下次定能成功！',
    '炉火飞舞，最终未能成器。'
  ];

  /* 执行强化 */
  function enhance(save, equipId) {
    var check = canEnhance(save, equipId);
    if (!check.ok) return { ok: false, msg: check.msg };

    var cost = check.cost;
    var lv = check.lv;
    var nextLv = lv + 1;
    var rate = SUCCESS_RATE[nextLv] || 0.5;

    /* 扣除消耗 */
    G.Player.spendStone(save, cost.stone);
    save.items = save.items || {};
    save.items[cost.mat] = (save.items[cost.mat] || 0) - cost.matCnt;

    /* 判定成功 */
    var success = G.rng.next() < rate;

    if (success) {
      setLevel(save, equipId, nextLv);
      var text = SUCCESS_TEXTS[Math.floor(G.rng.next() * SUCCESS_TEXTS.length)];
      G.Storage.saveCurrent(save);
      return {
        ok: true,
        success: true,
        lv: nextLv,
        msg: text + '\n强化 +' + lv + ' → +' + nextLv
      };
    } else {
      var text = FAIL_TEXTS[Math.floor(G.rng.next() * FAIL_TEXTS.length)];
      G.Storage.saveCurrent(save);
      return {
        ok: true,
        success: false,
        lv: lv,
        msg: text + '\n强化失败，等级保持 +' + lv
      };
    }
  }

  /* 计算强化后的属性加成 */
  function enhancedFx(equipId, baseFx) {
    var save = G.game.save;
    var lv = getLevel(save, equipId);
    if (lv === 0) return baseFx;

    var mult = 1 + lv * 0.10; /* 每级+10% */
    var enhanced = {};
    Object.keys(baseFx).forEach(function (key) {
      enhanced[key] = baseFx[key] * mult;
    });
    return enhanced;
  }

  /* 获取强化后的装备描述 */
  function enhancedDesc(equipId) {
    var eq = G.Data.equips.byId(equipId);
    if (!eq) return '';

    var lv = getLevel(G.game.save, equipId);
    if (lv === 0) return G.Data.equips.fxDesc(eq);

    var fx = enhancedFx(equipId, eq.fx);
    var parts = [];
    if (fx.a) parts.push('攻击 +' + (fx.a * 100).toFixed(0) + '%');
    if (fx.f) parts.push('防御 +' + (fx.f * 100).toFixed(0) + '%');
    if (fx.h) parts.push('气血 +' + (fx.h * 100).toFixed(0) + '%');
    if (fx.s) parts.push('速度 ' + (fx.s >= 0 ? '+' : '') + (fx.s * 100).toFixed(0) + '%');
    if (fx.c) parts.push('暴击 +' + (fx.c * 100).toFixed(0) + '%');
    if (fx.cd) parts.push('暴伤 +' + (fx.cd * 100).toFixed(0) + '%');
    if (fx.vamp) parts.push('吸血 +' + (fx.vamp * 100).toFixed(0) + '%');

    return parts.join('　') + ' （强化 +' + lv + '）';
  }

  /* 导出接口 */
  G.Enhance = {
    getLevel: getLevel,
    canEnhance: canEnhance,
    enhance: enhance,
    enhancedFx: enhancedFx,
    enhancedDesc: enhancedDesc,
    calcCost: calcCost,
    SUCCESS_RATE: SUCCESS_RATE
  };
})();
