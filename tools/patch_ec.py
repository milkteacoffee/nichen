# -*- coding: utf-8 -*-
"""E-C 准备：
1) arc.js：crisis 增加 branch 节点（按 save 状态分支台词）；
2) 覆盖 arc2.js：第二世·山门完整内容。"""
import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:60])
        s = s.replace(a, b)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)

patch(r'D:\Projects\nichen\www\js\scenes\arc.js', [
("""        } else if (n.k === 'stat') {""",
"""        } else if (n.k === 'branch') {
          self._say(n.pid || null, n.if(G.game.save) ? n.then : n.else, go);
        } else if (n.k === 'stat') {"""),
])

arc2 = r'''/* 第二世 · 山门〔师生 + 同门〕
   《诸世情感与镜花水月主线设计 v1.0》§4 第二世
   师父玄玑子捡他回山、师兄裴长庚同食同练；天道以「窝藏轮回孽障」
   遣代行者问罪——师父为斩因果自散修为而亡、师兄断后战死。
   抉择可改死法与遗言，改不了结局。 */
G.Arcs.register({
  id: 'arc2',
  n: '山门',
  theme: 'sect',

  cast: [
    { pid: 'xuanjizi', name: '玄玑子', rel: '师父', kind: 'teacher',
      note: '宗门长老，雪夜将他捡回山门，待之如子；早知其命带轮回劫。', status: '安' },
    { pid: 'changgeng', name: '裴长庚', rel: '师兄', kind: 'friend',
      note: '大师兄，同食同练，总把灵米先拨半碗给他。', status: '安' }
  ],
  sprites: {
    xuanjizi: { sys: 'npc', kind: 'elder' },
    changgeng: { sys: 'npc', kind: 'keeper' }
  },

  intro: [
    { pid: null, t: '再睁眼，是在一座云气缭绕的山门前。' },
    { pid: 'xuanjizi', t: '你这孩子，命里带着劫……也罢，随我回山吧。' },
    { pid: 'changgeng', t: '师弟！师父给你取了道名，往后你就住我隔壁。' },
    { pid: null, t: '晨钟暮鼓，春去秋来。师兄总把刚出锅的灵米，先拨半碗给他。' }
  ],

  daily: {
    spots: [
      { id: 'xj_sp', x: 108, y: 196, pid: 'xuanjizi', label: '陪师父',
        beats: [
          { t: '师父在蒲团上讲经，讲到要紧处，抬手在他眉心轻轻一点。' },
          { t: '他替师父研墨，看师父批完一摞同门的功课。' },
          { t: '夜半师父独坐观星，见他来，只道：你的劫……比旁人重些。' }
        ],
        pool: [
          '师父把自己那盏温着的灵茶，默默推给了他。',
          '经阁里，师徒二人一坐，就是一整日。'
        ] },
      { id: 'cg_sp', x: 372, y: 196, pid: 'changgeng', label: '寻师兄',
        beats: [
          { t: '师兄陪他在演武场对练，输了的，请吃灵果。' },
          { t: '两人偷藏了一壶酒，在屋脊上喝到月上中天。' },
          { t: '师兄把一件新炼的护身法袍，随手塞给了他。' }
        ],
        pool: [
          '“师弟，走，下山看热闹去！”',
          '师兄揽着他的肩，笑说以后要一起飞升。'
        ] }
    ],
    need: { xuanjizi: 3, changgeng: 3 },
    advance: '劫云压山'
  },

  crisis: {
    nodes: [
      { k: 'line', pid: null, t: '那一日，山门外的云，忽然不流了。' },
      { k: 'line', pid: 'xuanjizi', t: '该来的……终究是来了。' },
      { k: 'line', pid: null, t: '天光裂开，一名持尺的白衣代行者步出，声如寒铁：玄玑子，你窝藏轮回孽障，可知罪？' },
      { k: 'choice', q: '劫压山门，你当如何？', options: [
        { t: '劝师父暂避',
          fx: function (save) { save.arc.flags.warn = 1; },
          then: '他拽着师父的衣袖，师父却轻轻摇头：避得过今日，避不过因果。' },
        { t: '挡在师父身前',
          fx: function (save) { save.arc.flags.shield = 1; },
          then: '他站了出去，代行者垂目看他一眼，像看一粒尘。' },
        { t: '求代行者留情',
          fx: function (save) { save.arc.flags.beg = 1; },
          then: '他叩首求恳，代行者面无表情：法旨无私情。' }
      ] },
      { k: 'line', pid: null, t: '云幕深处，那只冷眼又垂了下来，无悲无喜。' },
      { k: 'line', pid: 'xuanjizi', t: '师父笑了笑，抬手按在他头顶——活下去。别回头。' },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.warn; },
        then: '“师父……”“傻孩子，”他望着山门，“我守了它四百年，也该……还了。”',
        else: '师父最后看了他一眼，目光很暖，像看自家的孩子。' },
      { k: 'death', pid: 'xuanjizi', t: '师父转身，一身修为如潮倒卷，撞向代行者——满山的云，烧成了白。' },
      { k: 'line', pid: null, t: '他用自己，替他斩尽了这一世的因果。' },
      { k: 'line', pid: 'changgeng', t: '师弟，走！' },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.shield; },
        then: '他想再扑回去，师兄却头也不回：听话！活下去，替我看看山外！',
        else: '师兄提剑挡在山门前，背影和师父当年，一模一样。' },
      { k: 'death', pid: 'changgeng', t: '师兄把他往后一推，独自断后，半步未退——剑光灭时，他听见师兄最后一声笑，很轻。' }
    ]
  },

  loss: [
    { pid: null, t: '山火过后，他在两具渐渐冷透的人身旁，跪了很久很久。' },
    { pid: '__hero', t: '师父，师兄……' },
    { pid: '__hero', t: '我记着。我会活下去——连你们的份，一起活下去。' },
    { pid: null, t: '他在山门外立了一座无字的坟，转身下山。' }
  ],

  fated: [
    { pid: 'xuanjizi', text: '为斩因果、瞒天劫，自散修为撞向代行者而亡。', status: '亡故' },
    { pid: 'changgeng', text: '山门断后，独战代行者，战死。', status: '亡故' }
  ],
  regret: {
    pid: 'xuanjizi', name: '玄玑子', item: '半卷讲经手稿',
    words: '活下去。别回头。'
  },
  lossCta: '下山……',
  deathCause: 'sect'
});
'''
io.open(r'D:\Projects\nichen\www\js\data\arc2.js', 'w', encoding='utf-8', newline='').write(arc2)
print('arc2 written')
