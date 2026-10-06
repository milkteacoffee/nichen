# -*- coding: utf-8 -*-
"""E-E：
1) sprites.js 增加 child 立绘（大头短身幼童，芽绿短褐）；
2) arc4.js 第四世·天伦（养子念尘）。"""
import io

# ---- sprites.js ----
p = r'D:\Projects\nichen\www\js\core\sprites.js'
s = io.open(p, encoding='utf-8').read()

# 调色板
a = """      collar: cult ? '#c9a2a6' : (girl ? '#f0d8d0' : '#e6ddc2'),
      belt: girl ? '#8a5a72' : '#5a4632', shoe: '#2c2a30'
    };"""
b = """      collar: cult ? '#c9a2a6' : (girl ? '#f0d8d0' : '#e6ddc2'),
      belt: girl ? '#8a5a72' : '#5a4632', shoe: '#2c2a30'
    };
    if (kind === 'child') {
      pal.hair = '#332a22';
      pal.robe = '#5f8f6d'; pal.robeDark = '#426b50';
      pal.collar = '#e9e2c6'; pal.belt = '#6a5a3a';
    }"""
assert s.count(a) == 1
s = s.replace(a, b)

# child 部件（插在 npcParts 前）
a = "  function npcParts(kind, pal) {"
child_fn = """  function childParts(pal) {
    /* 幼童：头大、身短、腿短（16×24 画布内，整体比成人矮一截）。 */
    var P = [];
    function add(x, y, w, h, c, extra) {
      var o = { x: x, y: y, w: w, h: h, c: c };
      if (extra) for (var k in extra) o[k] = extra[k];
      P.push(o);
    }
    /* 头（偏大） */
    add(3.6, 3.0, 8.8, 7.0, pal.skin);
    add(2.8, 1.6, 10.4, 3.2, pal.hair);
    add(2.8, 3.6, 1.8, 3.6, pal.hair);
    add(11.4, 3.6, 1.8, 3.6, pal.hair);
    add(3.6, 8.2, 8.8, 1.6, pal.skinSh);
    add(5.8, 6.0, 1.3, 1.4, '#201d28');
    add(9.0, 6.0, 1.3, 1.4, '#201d28');
    add(5.5, 5.2, 1.8, 0.6, pal.hair);
    add(8.7, 5.2, 1.8, 0.6, pal.hair);
    /* 身（短褐） */
    add(6.8, 9.6, 2.4, 1.2, pal.skinSh);
    add(4.8, 10.4, 6.4, 1.7, pal.collar);
    add(3.6, 11.2, 8.8, 5.0, pal.robe);
    add(4.0, 11.2, 1.1, 4.8, A.shade(pal.robe, 0.14));
    add(10.9, 11.2, 1.4, 4.8, pal.robeDark);
    add(3.6, 14.8, 8.8, 1.6, pal.belt);
    add(3.6, 14.8, 8.8, 0.5, A.shade(pal.belt, 0.22));
    /* 短腿 */
    add(4.2, 16.4, 3.2, 2.6, pal.robeDark);
    add(8.6, 16.4, 3.2, 2.6, pal.robe);
    add(4.0, 18.8, 3.4, 1.8, pal.shoe);
    add(8.6, 18.8, 3.4, 1.8, pal.shoe);
    /* 小手 */
    add(2.6, 11.8, 1.7, 4.2, pal.robe);
    add(2.6, 15.6, 1.5, 1.5, pal.skin);
    add(11.7, 11.8, 1.7, 4.2, pal.robeDark);
    add(11.9, 15.6, 1.5, 1.5, pal.skin);
    return P;
  }

  function npcParts(kind, pal) {"""
assert s.count(a) == 1
s = s.replace(a, child_fn)

# npcParts 入口分流
a = """  function npcParts(kind, pal) {
    var P = [];"""
b = """  function npcParts(kind, pal) {
    if (kind === 'child') return childParts(pal);
    var P = [];"""
assert s.count(a) == 1
s = s.replace(a, b)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('sprites child added')

# ---- arc4.js ----
arc4 = r'''/* 第四世 · 天伦〔亲情·子女〕
   《诸世情感与镜花水月主线设计 v1.0》§4 第四世
   养子念尘天赋惊人；三次天妒被分寿元、割道果挡下，终因「与轮回者
   因果太深」被列为必除变量，围剿中自愿赴死。执念自此成形。 */
G.Arcs.register({
  id: 'arc4',
  n: '天伦',
  theme: 'manor',

  cast: [
    { pid: 'nianchen', name: '念尘', rel: '养子', kind: 'child',
      note: '冬夜山门外捡回的婴孩，天赋惊人，是他捧在手心长大的孩子。', status: '安' }
  ],
  sprites: {
    nianchen: { sys: 'npc', kind: 'child' }
  },

  intro: [
    { pid: null, t: '第四世，他在一座山庄定居，年近不惑，道心已如枯井。' },
    { pid: null, t: '那年冬，他在山门外捡回一个冻得只剩一口气的婴孩。' },
    { pid: '__hero', t: '从今往后，你就叫念尘。' },
    { pid: null, t: '他把自己小时候没得到过的，都想给这孩子。' }
  ],

  daily: {
    spots: [
      { id: 'nc_sp', x: 240, y: 196, pid: 'nianchen', label: '陪念尘',
        beats: [
          { t: '他手把手教子儿认字，念尘举着写歪的字，献宝似的捧到他面前。' },
          { t: '父子俩在院里练拳，孩子人小，学得却比谁都快。' },
          { t: '夜里孩子怕雷，钻进他被窝，小手攥着他的衣襟睡熟。' }
        ],
        pool: [
          '他把最大的那颗灵果，偷偷塞进孩子手里。',
          '孩子骑在他肩头，笑说以后要比爹爹还厉害。'
        ] }
    ],
    need: { nianchen: 3 },
    advance: '天妒降世'
  },

  crisis: {
    nodes: [
      { k: 'line', pid: null, t: '天道的眼，落在了孩子身上。' },
      { k: 'line', pid: null, t: '第一次天妒，他分出十年寿元，替孩子挡了。' },
      { k: 'line', pid: null, t: '第二次，他割下一枚道果，又挡了。' },
      { k: 'line', pid: null, t: '第三次……围山的重重天光里，他怀里的道果，只剩最后一枚。' },
      { k: 'choice', q: '围剿已至，你当如何？', options: [
        { t: '再割道果，与天争命',
          fx: function (save) { save.arc.flags.guo = 1; },
          then: '最后一枚道果掷向天劫，天光晃了晃，又聚了起来，比先前更盛。' },
        { t: '送孩子从密道走',
          fx: function (save) { save.arc.flags.flee = 1; },
          then: '他把孩子往密道里推，孩子却站住了，一步也不肯再走。' },
        { t: '独自迎战代行者',
          fx: function (save) { save.arc.flags.fight = 1; },
          then: '他提剑迎上天光，身后的孩子，却轻轻喊了一声：爹。' }
      ] },
      { k: 'line', pid: 'nianchen', t: '爹……您护了我一世。这一次，让我自己走吧。' },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.flee; },
        then: '“听话！”孩子却笑了，踮脚替他擦去嘴角的血：爹，我长大了呀。',
        else: '孩子走过来，像小时候那样，把小手放进他掌心，轻轻握了握。' },
      { k: 'death', pid: 'nianchen', t: '孩子自己走出山庄，走进重重天光里，再没回头——一声脆响，像什么东西，在他道心里裂开。' },
      { k: 'line', pid: null, t: '他跪在空荡荡的山庄，一夜白头。' },
      { k: 'line', pid: '__hero', t: '我连一个孩子……都护不住。求长生，何用？' }
    ]
  },

  loss: [
    { pid: null, t: '他在山庄后，埋了一只孩子小时候玩的木剑。' },
    { pid: '__hero', t: '爷爷，师父，师兄，阿蘅……念尘……' },
    { pid: '__hero', t: '我偏要逆这天道。我偏要把你们，一个一个，都带回来。' },
    { pid: null, t: '执念，在他心底，生了根。' }
  ],

  fated: [
    { pid: 'nianchen', text: '被列为必除变量，围剿中自愿赴死。', status: '亡故' }
  ],
  regret: {
    pid: 'nianchen', name: '念尘', item: '小木剑',
    words: '爹，让我自己走吧。'
  },
  lossCta: '离庄……',
  deathCause: 'siege'
});
'''
io.open(r'D:\Projects\nichen\www\js\data\arc4.js', 'w', encoding='utf-8', newline='').write(arc4)
print('arc4 written')
