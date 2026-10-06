# -*- coding: utf-8 -*-
"""E-D：arc3.js 第三世·道侣（阿蘅 = 晚晴一魂碎片）。"""
import io

arc3 = r'''/* 第三世 · 道侣〔爱情〕
   《诸世情感与镜花水月主线设计 v1.0》§4 第三世
   阿蘅是晚晴散落的一魂碎片；天道以她为心魔破绽，她主动替应心劫而亡。
   连心结/替身法宝挡得下第一次，挡不住这一世。 */
G.Arcs.register({
  id: 'arc3',
  n: '道侣',
  theme: 'cottage',

  cast: [
    { pid: 'aheng', name: '阿蘅', rel: '道侣', kind: 'lover',
      note: '桥头卖花姑娘，晚晴散落的一魂碎片；初见便觉似曾相识。', status: '安' }
  ],
  sprites: {
    aheng: { sys: 'npc', kind: 'girl' }
  },

  intro: [
    { pid: null, t: '第三世，他落在一处依山傍水的小镇外。' },
    { pid: null, t: '桥头卖花的姑娘抬头看见他，忽然怔住——公子，我们……是不是在哪里见过？' },
    { pid: 'aheng', t: '我叫阿蘅。' },
    { pid: null, t: '他袖中那半截平安穗，无风自动。' }
  ],

  daily: {
    spots: [
      { id: 'ah_sp', x: 240, y: 196, pid: 'aheng', label: '寻阿蘅',
        beats: [
          { t: '她教他编平安穗，两人的手在灯下碰在一起，都红了耳根。' },
          { t: '他劈柴，她烧火，一锅寻常的灵米饭，吃得满屋都是暖意。' },
          { t: '结发那夜，她把自己的一缕发，轻轻系进了他的穗子里。' }
        ],
        pool: [
          '两人在河边放灯，两盏灯上，写着同一个愿。',
          '她靠在他肩头，听他讲些记不全的旧事，听着听着便笑了。'
        ] }
    ],
    need: { aheng: 3 },
    advance: '心劫将起'
  },

  crisis: {
    nodes: [
      { k: 'line', pid: null, t: '渡劫那夜，九重雷云压顶。他忽然懂了天道的恶毒——' },
      { k: 'line', pid: null, t: '他心里最软的那块，是她。' },
      { k: 'line', pid: 'aheng', t: '阿蘅却笑了，伸手替他理好衣襟：我来。' },
      { k: 'choice', q: '心劫将起，你当如何？', options: [
        { t: '结连心结，替她挡劫',
          fx: function (save) { save.arc.flags.heart = 1; },
          then: '劫雷透过连心结落在他身上，一口血喷出——她扑过来，满眼是泪。' },
        { t: '以替身法宝代她一次',
          fx: function (save) { save.arc.flags.sub = 1; },
          then: '替身法宝碎作齑粉，他还来不及欢喜，云幕深处又落下一重劫。' },
        { t: '独自硬抗',
          fx: function (save) { save.arc.flags.alone = 1; },
          then: '他咬牙硬抗，她却轻轻从他身后走了出去，拦不住。' }
      ] },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.heart; },
        then: '“傻子，”她哭着笑，“两个人的劫，哪有让一个人受的道理。”',
        else: '她回头望他，目光温柔得像白鹿礁那年的海。' },
      { k: 'line', pid: 'aheng', t: '这一世……我很欢喜。' },
      { k: 'death', pid: 'aheng', t: '她替他应下了心劫，魂火在他怀里，一点点冷了。' },
      { k: 'line', pid: null, t: '他抱着她坐了一整夜。袖中的平安穗，与她发间那一缕，结在了一起。' },
      { k: 'line', pid: null, t: '他终于认了出来——白鹿礁的晚晴，这一世的阿蘅，是同一个人。' }
    ]
  },

  loss: [
    { pid: '__hero', t: '晚晴……阿蘅……' },
    { pid: '__hero', t: '不管你碎成多少片，不管要多少世——我都要把你找回来。' },
    { pid: null, t: '他把她的一缕发，编进平安穗，贴身收着。' }
  ],

  fated: [
    { pid: 'aheng', text: '替他应下心劫，魂散而亡。', status: '亡故' }
  ],
  regret: {
    pid: 'aheng', name: '阿蘅', item: '一缕发',
    words: '这一世，我很欢喜。'
  },
  tokens: { pingsui: 1 },
  lossCta: '渡劫……',
  deathCause: 'heart'
});
'''
io.open(r'D:\Projects\nichen\www\js\data\arc3.js', 'w', encoding='utf-8', newline='').write(arc3)
print('arc3 written')
