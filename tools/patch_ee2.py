# -*- coding: utf-8 -*-
"""E-E2：arc5.js 第五世·薪火（收徒结义，传承埋种）。"""
import io

arc5 = r'''/* 第五世 · 薪火〔友情 + 师生·传承〕
   《诸世情感与镜花水月主线设计 v1.0》§4 第五世
   收徒守一、与散修景炎结义，把功法、复活志与诸世记忆传下去；
   大劫中两人战死，道统与逆命珠微光再传——传承比占有式复活
   更接近不朽，为「放手」埋下种子。 */
G.Arcs.register({
  id: 'arc5',
  n: '薪火',
  theme: 'dojo',

  cast: [
    { pid: 'shouye', name: '守一', rel: '弟子', kind: 'disciple',
      note: '开山首徒，赤诚刻苦，承他功法与诸世记忆。', status: '安' },
    { pid: 'jingyan', name: '景炎', rel: '结义兄弟', kind: 'sworn',
      note: '游历四方的散修，与他结义共守道统，豪迈洒脱。', status: '安' }
  ],
  sprites: {
    shouye: { sys: 'npc', kind: 'default' },
    jingyan: { sys: 'npc', kind: 'keeper' }
  },

  intro: [
    { pid: null, t: '第五世，他已是一方道统的开山祖师，白发苍苍。' },
    { pid: null, t: '他忽然不想再只护住谁了——他想把火，传下去。' },
    { pid: 'shouye', t: '弟子守一，愿拜入师尊门下！' },
    { pid: 'jingyan', t: '景炎一介散修，愿与道兄结义，共守此道。' }
  ],

  daily: {
    spots: [
      { id: 'sy_sp', x: 108, y: 196, pid: 'shouye', label: '教守一',
        beats: [
          { t: '他把一生功法，一招一式，拆给弟子看。' },
          { t: '他给弟子讲诸世旧事，讲那些没能护住的人——弟子红了眼眶。' },
          { t: '弟子奉茶，他接过，恍惚看见年轻时师兄的影子。' }
        ],
        pool: [
          '师徒二人在灯下校注功法，直到天明。',
          '弟子把他讲的每一个字，都工工整整记下。'
        ] },
      { id: 'jy_sp', x: 372, y: 196, pid: 'jingyan', label: '寻景炎',
        beats: [
          { t: '两人对坐论道三日三夜，忽有顿悟，抚掌大笑。' },
          { t: '结义那夜，共饮一碗酒，都说此道不孤。' },
          { t: '景炎把游历所得的一枚古符，拍在他手心。' }
        ],
        pool: [
          '老友携酒来访，一壶酒，半生话。',
          '两人并肩立在山门前，看云起，云落。'
        ] }
    ],
    need: { shouye: 3, jingyan: 3 },
    advance: '大劫降临'
  },

  crisis: {
    nodes: [
      { k: 'line', pid: null, t: '大劫如期而至。这一次，他没有慌——火，已经传下去了。' },
      { k: 'line', pid: null, t: '代行者声冷如万古寒冰：传「逆命」之道，罪加一等。' },
      { k: 'choice', q: '劫至，你当如何？', options: [
        { t: '令弟子携功法先走',
          fx: function (save) { save.arc.flags.send = 1; },
          then: '功法封入弟子识海，他把人推向山后——弟子一步三回头。' },
        { t: '与结义兄弟共抗天劫',
          fx: function (save) { save.arc.flags.together = 1; },
          then: '两道身影并肩迎劫，景炎笑骂：痛快！' },
        { t: '以己身引劫，成全道统',
          fx: function (save) { save.arc.flags.self = 1; },
          then: '他独自引动全部劫雷，白发在风里猎猎作响。' }
      ] },
      { k: 'line', pid: 'jingyan', t: '道兄，你教的道……我替你看着。' },
      { k: 'death', pid: 'jingyan', t: '景炎笑着撞进劫云，替他拦下大半天威，尸骨无存。' },
      { k: 'line', pid: 'shouye', t: '师尊……弟子记住了。' },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.send; },
        then: '弟子远远跪了三个头，把他的话，一个字一个字，刻进心里。',
        else: '弟子从血泊里爬起，接过他手里那卷功法，抱得很紧。' },
      { k: 'death', pid: 'shouye', t: '守一把功法与逆命珠的微光，转交给更年轻的师弟，含笑而逝。' },
      { k: 'line', pid: null, t: '火，从他手里传到另一双手上，又传了下去。' },
      { k: 'line', pid: '__hero', t: '原来……一个人会朽，道，不会。' },
      { k: 'line', pid: null, t: '他望着山门前的星火，第一次对「复活」二字，生出一丝动摇。' }
    ]
  },

  loss: [
    { pid: null, t: '大劫过后，道统还在，弟子的弟子，已在晨课。' },
    { pid: '__hero', t: '守一，景炎……你们看，火，没灭。' },
    { pid: null, t: '他坐在空荡荡的讲经堂，听着山下朗朗的诵经声，坐了很久。' }
  ],

  fated: [
    { pid: 'jingyan', text: '撞入劫云拦下天威，尸骨无存。', status: '亡故' },
    { pid: 'shouye', text: '传道于师弟后，力竭含笑而逝。', status: '亡故' }
  ],
  regret: {
    pid: 'shouye', name: '守一', item: '传道玉简',
    words: '师尊，弟子记住了。'
  },
  lossCta: '别道统……',
  deathCause: 'lineage'
});
'''
io.open(r'D:\Projects\nichen\www\js\data\arc5.js', 'w', encoding='utf-8', newline='').write(arc5)
print('arc5 written')
