# -*- coding: utf-8 -*-
"""E-F：arc6.js 终世·道界（修至道祖，招魂→凝魄→重塑，镜碎）。"""
import io

arc6 = r'''/* 终世 · 道界〔复活之路三阶〕
   《诸世情感与镜花水月主线设计 v1.0》§4 第六世 / §5 复活三阶
   修至道祖，真获逆转生死之能：招魂（冷残影）→ 凝魄（夺生人/
   天地/道果，一人圆满另一人替死）→ 重塑（「完整复活」实为
   天道温柔陷阱，复活者在你没看时停住，问「你为什么在哭」）。
   endFlow：收场后进入两结局选择。 */
G.Arcs.register({
  id: 'arc6',
  n: '道界',
  theme: 'mirror',
  endFlow: true,

  cast: [],
  sprites: {
    jiang: { sys: 'npc', kind: 'elder' },
    wanqing: { sys: 'npc', kind: 'girl' },
    xuanjizi: { sys: 'npc', kind: 'elder' },
    changgeng: { sys: 'npc', kind: 'keeper' },
    aheng: { sys: 'npc', kind: 'girl' },
    nianchen: { sys: 'npc', kind: 'child' },
    shouye: { sys: 'npc', kind: 'default' },
    jingyan: { sys: 'npc', kind: 'keeper' }
  },

  intro: [
    { pid: null, t: '终世。他历遍诸界，终于在道则尽头，修至道祖。' },
    { pid: null, t: '一念可令星辰倒转，一手可触轮回之门——他真的，拿到了逆转生死之能。' },
    { pid: '__hero', t: '百世了……我终于，可以接你们回家。' },
    { pid: null, t: '道祖殿前，九面招魂镜齐齐亮起。' }
  ],

  /* 日常相位复用为「招魂」：残影可对话，魂火是冷的、重复生前话。 */
  daily: {
    spots: [
      { id: 'jh_sp', x: 108, y: 196, pid: 'jiang', label: '招爷爷',
        beats: [
          { t: '烟一样的人影在招魂台上聚了聚，是爷爷的模样，魂火却是冷的。' },
          { t: '残影转过身，重复着生前的话：阿尘，药……要趁热……' }
        ] },
      { id: 'wq_sp', x: 372, y: 196, pid: 'wanqing', label: '招晚晴',
        beats: [
          { t: '少女的影子在镜光里聚起，眉目依旧，只是没有影子。' },
          { t: '“阿尘哥，”她笑着重复，“等我……回来呀。”' }
        ] }
    ],
    need: { jiang: 2, wanqing: 2 },
    advance: '招魂已成'
  },

  /* 惊变相位复用为「凝魄 → 重塑」。 */
  crisis: {
    nodes: [
      { k: 'line', pid: null, t: '残影终究是残影。他翻遍道藏，找到「凝魄」之法——' },
      { k: 'line', pid: null, t: '补全一魂，要从活人身上，夺等量的魂。' },
      { k: 'choice', q: '凝魄需夺，你当如何？', options: [
        { t: '以战俘生魂补全',
          fx: function (save) { save.arc.flags.hun = 1; },
          then: '十恶不赦的战俘生魂没入残影，人影凝实了些——他别开了眼。' },
        { t: '割此方天地灵机',
          fx: function (save) { save.arc.flags.tian = 1; },
          then: '千里灵机倒灌入魂，那一方天地，自此寸草不生。' },
        { t: '以自身道果补全',
          fx: function (save) { save.arc.flags.dao = 1; },
          then: '他连割三枚道果，残影有了温度，他自己的气息，却萎了下去。' }
      ] },
      { k: 'branch',
        if: function (save) { return !!save.arc.flags.dao; },
        then: '他咳着血笑：值得……都值得。',
        else: '一个被夺了魂的战俘倒在镜前，另一片天地，正在枯死。' },
      { k: 'line', pid: null, t: '补全那夜，爷爷忽然说起别人的记忆：我那未过门的妻……他怔住——那不是爷爷的生平。' },
      { k: 'line', pid: null, t: '他知道，这还不是「她们」。可他已经，停不下来了。' },
      { k: 'line', pid: null, t: '最后一步——重塑。倾尽诸世积蓄，他要把所有人，完整地接回来。' },
      { k: 'line', pid: '__hero', t: '回来吧……都回来吧。' },
      { k: 'line', pid: null, t: '镜光大盛，招魂台前，一道又一道身影，活生生地站了起来。' },
      { k: 'line', pid: null, t: '爷爷，晚晴，师父，师兄，阿蘅，念尘，守一，景炎……都在。' },
      { k: 'line', pid: null, t: '他喜极而泣。' },
      { k: 'line', pid: null, t: '直到他转身去斟茶的那一刻——身后的笑声，停了。' },
      { k: 'line', pid: 'wanqing', t: '……你为什么，在哭呢？' },
      { k: 'line', pid: null, t: '镜面，无声裂开一道细纹。' }
    ]
  },

  loss: [
    { pid: null, t: '他一个一个看去。她们会笑，会说话，会唤他的名字——' },
    { pid: null, t: '可在他看不见的地方，她们会忽然停住，像上了锈的机关。' },
    { pid: '__hero', t: '天道……你连这个，都不肯给真的吗。' },
    { pid: null, t: '云幕深处，那只冷眼，第一次像在「悲悯」。' },
    { pid: null, t: '镜花水月——到了手的团圆，仍是镜中花，水中月。' }
  ],

  lossCta: '抉择……'
});
'''
io.open(r'D:\Projects\nichen\www\js\data\arc6.js', 'w', encoding='utf-8', newline='').write(arc6)
print('arc6 written')
