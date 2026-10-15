/* NPC 好感养成（G2，对标烟雨江湖，v2.15.7）
 *
 * 重要 NPC（城镇关键人物、可结缘者）有好感度，初始「陌生」：
 *   陌生(0) → 熟识(≥10) → 信任(≥25) → 亲密(≥45)
 * 提升途径：完成其支线（turnIn 自动 +）、赠送喜好物品、对话选择。
 * 每到一档解锁专属内容（道具/法宝/身法/服务提示），给一次（幂等）。
 * 部分 NPC 互斥（mutex）：与一方亲密后，另一方的线关闭（正魔/道侣取舍）。
 *
 * 存储：save.aff = { <npcId>: 好感值 }；save.affGot = { <npcId:tier>: true }（已发奖励）。
 * ⚠️ 不复活原则：所有「似曾相识/前世幻影」仅为情感文案，不提供复活路径。
 */
(function () {
  var D = window.G.Data || (window.G.Data = {});

  /* 档位（阈值 + 名称） */
  var TIERS = [
    { id: 0, n: '陌生', min: 0 },
    { id: 1, n: '熟识', min: 10 },
    { id: 2, n: '信任', min: 25 },
    { id: 3, n: '亲密', min: 45 }
  ];

  /* 可养成 NPC 定义。
     likes: { 道具名: 每次赠送增加好感 }
     mutex: 互斥 NPC id（与本 NPC 亲密后，对方关闭；反之亦然）
     unlock: { 1: 熟识, 2: 信任, 3: 亲密 } —— 每项 { t:类型, 内容 }
       · {t:'line', s:文案}             仅一段专属对话（提示/传闻）
       · {t:'item', id:道具, n:数量}     给道具（含法宝 eq_）
       · {t:'shenfa', k:'water'...}      教身法秘术
     greet: 每个档位的见面问候（可选，丰富对话） */
  var NPC = {
    washer: {
      name: '浣衣妇', likes: { '回春丹': 8 },
      greet: [
        '“……衣服洗得再干净，也洗不回人。”',
        '“你是个好的，常来河边坐坐。”',
        '“我把你当自家人看，有难处尽管开口。”',
        '“唉，若我那孩儿还在，也该有你这般大了。”'
      ],
      unlock: {
        1: { t: 'line', s: '她压低声音：“……车马行的老周，年轻时跑过商，外头的路他门儿清。”' },
        2: { t: 'item', id: 'eq_yupei', n: 1 },
        3: { t: 'item', id: 'eq_hulu', n: 1 }
      }
    },
    woodman: {
      name: '老樵夫', likes: { '回春丹': 8 },
      greet: [
        '“山里的柴，砍不完；山里的命，说不准。”',
        '“后生，认得路比啥都强。”',
        '“你这娃儿，我信得过。”',
        '“砍了一辈子柴，就剩这点压箱底的东西了。”'
      ],
      unlock: {
        1: { t: 'line', s: '他指着西边：“翠微山的蛇，雨后最凶——避着点草窠。”' },
        2: { t: 'item', id: '解封符', n: 2 },
        3: { t: 'item', id: 'eq_xuanwu', n: 1 }
      }
    },
    market: {
      name: '刘掌柜', likes: { '妖丹': 10 },
      greet: [
        '“买卖买卖，买的卖的都得活。”',
        '“常来啊，给你留着好货。”',
        '“你这主顾，我给你最实在的价。”',
        '“账册翻烂了，就你这笔最干净。”'
      ],
      unlock: {
        1: { t: 'line', s: '他拨了拨算盘：“妖丹这东西，越多越值钱——我收。”' },
        2: { t: 'item', id: '大还丹', n: 2 },
        3: { t: 'item', id: 'eq_ruyi', n: 1 }
      }
    },
    peddler: {
      name: '行脚商', likes: { '妖丹': 8 },
      greet: [
        '“走南闯北，图个新鲜。”',
        '“嘿，你这人有点意思。”',
        '“信得过你，给你看个稀罕。”',
        '“跑了半辈子，这点宝贝就托付给识货的。”'
      ],
      unlock: {
        1: { t: 'line', s: '他神秘兮兮：“……乱葬岗夜里，别往深处走。”' },
        2: { t: 'item', id: '聚气散', n: 2 },
        3: { t: 'item', id: 'eq_tongjing', n: 1 }
      }
    },
    coachman: {
      name: '车马夫', likes: { '回春丹': 6 },
      greet: [
        '“车轮滚滚，都是赶路的苦命人。”',
        '“要去哪儿？给你算便宜点。”',
        '“老主顾了，票给你留着。”',
        '“跑了一辈子车，这点门道都给你。”'
      ],
      unlock: {
        1: { t: 'line', s: '他拍了拍车辕：“……落霞镇的界门，得道行够了才让过。”' },
        2: { t: 'item', id: '回城符', n: 2 },
        3: { t: 'shenfa', k: 'chasm' }
      }
    },
    ferryman: {
      name: '老船夫', likes: { '回春丹': 6 },
      greet: [
        '“水能载舟，也能送人。”',
        '“坐船啊？给你算实在价。”',
        '“风浪里，我信你这娃儿。”',
        '“渡了一辈子人，最后渡渡你。”'
      ],
      unlock: {
        1: { t: 'line', s: '他望着水面：“……水底下的东西，别盯着看。”' },
        2: { t: 'item', id: '回城符', n: 1 },
        3: { t: 'shenfa', k: 'water' }
      }
    }
  };

  /* 工具：当前存档 */
  function save() { return window.G.game && window.G.game.save; }

  /* 好感值（默认 0） */
  function valueOf(s, id) {
    s = s || save();
    if (!s || !s.aff) return 0;
    return s.aff[id] || 0;
  }

  /* 档位 id（0..3） */
  function tierOf(s, id) {
    var v = valueOf(s, id);
    var t = 0;
    for (var i = 0; i < TIERS.length; i++) { if (v >= TIERS[i].min) t = i; }
    return t;
  }

  function tierName(s, id) { return TIERS[tierOf(s, id)].n; }

  /* 是否可养成 NPC */
  function isNPC(id) { return !!NPC[id]; }

  /* 互斥：id 是否被关闭（与它的互斥 NPC 已达亲密） */
  function isClosed(s, id) {
    var def = NPC[id];
    if (!def || !def.mutex) return false;
    return tierOf(s, def.mutex) >= 3;
  }

  /* 增加好感（返回 {from,to,up:是否升档}）。会自动补发档位奖励。 */
  function add(s, id, delta) {
    s = s || save();
    if (!s || !NPC[id]) return { from: 0, to: 0, up: false };
    s.aff = s.aff || {};
    var before = tierOf(s, id);
    s.aff[id] = Math.max(0, (s.aff[id] || 0) + delta);
    var after = tierOf(s, id);
    /* 补发跨越的档位奖励 */
    for (var t = before + 1; t <= after; t++) grantUnlock(s, id, t);
    return { from: before, to: after, up: after > before };
  }

  /* 给某档解锁内容（幂等：affGot 记录）。返回发放描述（供 toast）。 */
  function grantUnlock(s, id, t) {
    var def = NPC[id];
    if (!def || !def.unlock || !def.unlock[t]) return null;
    s.affGot = s.affGot || {};
    var key = id + ':' + t;
    if (s.affGot[key]) return null;
    var u = def.unlock[t];
    var desc = null;
    if (u.t === 'item') {
      s.items = s.items || {};
      s.items[u.id] = (s.items[u.id] || 0) + (u.n || 1);
      var nm = window.G.Player && window.G.Player.itemName ? window.G.Player.itemName(u.id) : u.id;
      desc = def.name + ' 赠你「' + nm + '」';
    } else if (u.t === 'shenfa') {
      if (window.G.Data.dungeons && window.G.Data.dungeons.grantShenfa) {
        window.G.Data.dungeons.grantShenfa(s, u.k);
        var sf = window.G.Data.dungeons.SHENFA_OF[u.k];
        desc = def.name + ' 传你身法「' + sf.n + '」';
      }
    } else if (u.t === 'line') {
      desc = null;                 /* 对话型，见面时自然显示，不发 toast */
    }
    s.affGot[key] = true;
    return desc;
  }

  /* 赠送喜好物品（供好感面板调用）。返回 {ok,msg}。 */
  function gift(scene, id, item) {
    var s = save();
    var def = NPC[id];
    if (!s || !def) return { ok: false, msg: '无可赠之人' };
    if (isClosed(s, id)) return { ok: false, msg: '已无缘' };
    var gain = def.likes[item];
    if (!gain) return { ok: false, msg: '对方不喜好此物' };
    if (!s.items || !(s.items[item] > 0)) return { ok: false, msg: '你没有「' + item + '」' };
    /* 扣道具 */
    s.items[item] -= 1;
    if (s.items[item] <= 0) delete s.items[item];
    var r = add(s, id, gain);
    if (window.G.Storage && window.G.Storage.saveCurrent) window.G.Storage.saveCurrent(s);
    if (r.up) {
      var tn = TIERS[r.to].n;
      window.G.game.toast('与 ' + def.name + ' 的关系升至「' + tn + '」', 2.4);
      var d = grantUnlock(s, id, r.to);
      if (d) window.G.game.toast(d, 2.6);
    } else {
      window.G.game.toast(def.name + ' 好感 +' + gain, 1.6);
    }
    return { ok: true, up: r.up };
  }

  /* ===== 好感面板（overlay 'affinity'） =====
     展示某 NPC 的当前档位、好感进度、可赠喜好物品按钮。 */
  var PANEL = { x: 40, y: 30, w: 400, h: 212 };

  function open(scene, id) {
    var s = save();
    if (!s || !NPC[id]) return;
    _cur = id;
    build(scene);
  }

  var _cur = null;

  function build(scene) {
    var id = _cur, s = save();
    var def = NPC[id];
    var P = PANEL;
    var btns = [];
    /* 可赠物品：每个喜好物一个按钮（显示持有数） */
    var likes = Object.keys(def.likes);
    likes.forEach(function (item, i) {
      var owned = (s.items && s.items[item]) || 0;
      btns.push(new window.G.UI.Btn({
        x: P.x + 24 + i * 120, y: P.y + 150, w: 110, h: 26, small: true,
        variant: owned > 0 ? 'gold' : 'default',
        label: '赠 ' + item + '（' + owned + '）',
        disabled: owned <= 0,
        onClick: function () {
          var r = gift(scene, id, item);
          if (r.ok) build(scene); else if (r.msg) window.G.game.toast(r.msg, 1.8);
        }
      }));
    });
    /* 关闭 */
    btns.push(new window.G.UI.Btn({
      x: P.x + P.w / 2 - 50, y: P.y + P.h - 4, w: 100, h: 22, small: true,
      label: '告　辞', onClick: function () { scene.clearOverlay(); }
    }));
    scene.setOverlay('affinity', btns);
  }

  /* 面板正文绘制（由 explore overlay 渲染调用） */
  function renderPanel(x, scene) {
    var id = _cur, s = save();
    if (!id || !NPC[id]) return;
    var def = NPC[id];
    var P = PANEL;
    var t = tierOf(s, id), v = valueOf(s, id);
    /* 暗化遮罩 + 面板框（与其它 overlay 一致） */
    if (window.G.Overlays && window.G.Overlays.dim) window.G.Overlays.dim(x);
    window.G.UI.frame(x, P, def.name + ' · ' + TIERS[t].n, { tex: true });
    /* 好感进度条（到下一档） */
    var barX = P.x + 40, barY = P.y + 40, barW = P.w - 80, barH = 10;
    var lo = TIERS[t].min, hi = t < 3 ? TIERS[t + 1].min : TIERS[t].min;
    var frac = t < 3 ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 1;
    x.fillStyle = 'rgba(0,0,0,0.4)';
    x.fillRect(barX, barY, barW, barH);
    x.fillStyle = '#c9a86a';
    x.fillRect(barX, barY, Math.round(barW * frac), barH);
    x.strokeStyle = 'rgba(255,240,210,0.35)'; x.lineWidth = 1;
    x.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
    x.font = window.G.UI.F(11);
    x.fillStyle = '#b8a888';
    x.textAlign = 'left';
    x.fillText(t < 3 ? ('好感 ' + v + ' / ' + hi + '（' + Math.round(frac * 100) + '%）') : '好感已圆满 · ' + v,
      barX, barY + barH + 14);
    /* 见面问候（当前档位）—— 动态计算行高，避免与解锁文案重叠 */
    x.font = window.G.UI.F(13);
    x.fillStyle = '#d8c8a8';
    var greet = def.greet ? def.greet[t] : null;
    var greetN = 0;
    var contentY = P.y + 80;
    if (greet) {
      var lines = window.G.UI.wrap(x, greet, 13, P.w - 60);
      greetN = lines.length;
      for (var i = 0; i < lines.length; i++)
        x.fillText(lines[i], P.x + 30, contentY + i * 17);
    }
    /* 若本档有 line 型解锁，显示它（排在问候之后） */
    if (def.unlock && def.unlock[t] && def.unlock[t].t === 'line') {
      var ul = def.unlock[t].s;
      var ulLines = window.G.UI.wrap(x, ul, 12, P.w - 60);
      x.fillStyle = '#a8c0c0';
      var ulY = contentY + greetN * 17 + 8;
      for (var u = 0; u < ulLines.length; u++)
        x.fillText(ulLines[u], P.x + 30, ulY + u * 16);
    }
    x.textAlign = 'left';
  }

  /* 导出 */
  D.Affinity = {
    TIERS: TIERS,
    NPC: NPC,
    isNPC: isNPC,
    isClosed: isClosed,
    valueOf: valueOf,
    tierOf: tierOf,
    tierName: tierName,
    add: add,
    gift: gift,
    grantUnlock: grantUnlock,
    open: open,
    renderPanel: renderPanel,
    PANEL: PANEL
  };
})();
