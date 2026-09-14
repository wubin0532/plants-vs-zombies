export type PlantDef = {
  id: string;
  name: string;
  cost: number;
  hp: number;
  cooldown: number;
  unlock: number;
  color: string;
  kind: string;
  desc: string;
  damage?: number;
  interval?: number;
  upgrade?: string;
};
const p = (
  id: string,
  name: string,
  cost: number,
  kind: string,
  unlock: number,
  color: string,
  desc: string,
  extra: Partial<PlantDef> = {},
): PlantDef => ({
  id,
  name,
  cost,
  kind,
  unlock,
  color,
  desc,
  hp: 300,
  cooldown: 7.5,
  ...extra,
});
export const plants: PlantDef[] = [
  p(
    "pea",
    "豌豆射手",
    100,
    "shooter",
    1,
    "#79bd43",
    "向前发射豌豆，守住所在的一行。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "sunflower",
    "向日葵",
    50,
    "sun",
    2,
    "#f5bd42",
    "定期生产 25 点阳光，是庭院的经济支柱。",
  ),
  p(
    "cherry",
    "樱桃炸弹",
    150,
    "bomb",
    3,
    "#e85b55",
    "短暂引爆后消灭周围九宫格的僵尸。",
    { cooldown: 50 },
  ),
  p(
    "wallnut",
    "坚果墙",
    50,
    "wall",
    4,
    "#c68a4a",
    "用结实的外壳保护身后的植物。",
    { hp: 5000, cooldown: 30 },
  ),
  p(
    "potato",
    "土豆地雷",
    25,
    "mine",
    6,
    "#bc9365",
    "埋下后需要 14 秒准备，接触僵尸时爆炸。",
    { cooldown: 30 },
  ),
  p(
    "snowpea",
    "寒冰射手",
    175,
    "shooter",
    7,
    "#7ecada",
    "冰豌豆造成伤害，并让僵尸减速。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "chomper",
    "大嘴花",
    150,
    "chomp",
    8,
    "#9d65bc",
    "咬合时吞噬敌人，厚实茎叶更耐打，随后需要时间消化。",
    { hp: 450 },
  ),
  p(
    "repeater",
    "双发射手",
    200,
    "shooter",
    9,
    "#48955b",
    "连续射出两颗豌豆。",
    { damage: 40, interval: 1.4 },
  ),
  p(
    "puff",
    "小喷菇",
    0,
    "shroom",
    11,
    "#c29be0",
    "免费的小蘑菇，攻击距离为三格。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "sunshroom",
    "阳光菇",
    25,
    "sun",
    12,
    "#e4c779",
    "先生产少量阳光，成长后生产更多。",
  ),
  p(
    "fume",
    "大喷菇",
    75,
    "fume",
    13,
    "#a67bbd",
    "喷出穿透烟雾，同时伤害前方近处的敌人。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "grave",
    "墓碑吞噬者",
    75,
    "grave",
    14,
    "#897e9b",
    "移除一块墓碑，腾出种植空间。",
  ),
  p(
    "hypno",
    "魅惑菇",
    75,
    "hypno",
    16,
    "#e6a3cc",
    "让吃下它的僵尸转身攻击同伴。",
    { cooldown: 30 },
  ),
  p(
    "scaredy",
    "胆小菇",
    25,
    "shroom",
    17,
    "#c7a37a",
    "远程射击，但敌人靠近时会躲起来。",
    { damage: 20, interval: 1.4 },
  ),
  p("ice", "寒冰菇", 75, "ice", 18, "#9ed4e7", "冻结全场僵尸，随后持续减速。", {
    cooldown: 50,
  }),
  p(
    "doom",
    "毁灭菇",
    125,
    "doom",
    19,
    "#725980",
    "大范围爆炸，并留下暂时不能种植的坑。",
    { cooldown: 50 },
  ),
  p(
    "lily",
    "睡莲",
    25,
    "base",
    21,
    "#72b958",
    "种在水面，为陆生植物提供支撑。",
  ),
  p("squash", "窝瓜", 50, "squash", 22, "#a4b864", "压扁靠近它的僵尸。", {
    cooldown: 30,
  }),
  p(
    "three",
    "三线射手",
    325,
    "shooter",
    23,
    "#70aa53",
    "同时攻击所在行与相邻两行。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "kelp",
    "缠绕海草",
    25,
    "kelp",
    24,
    "#4f9c81",
    "在水中将接近的僵尸拖下水。",
    { cooldown: 30 },
  ),
  p(
    "jalapeno",
    "火爆辣椒",
    125,
    "jalapeno",
    26,
    "#ef6b40",
    "用烈焰清空一整行的僵尸与冰道。",
    { cooldown: 50 },
  ),
  p(
    "spike",
    "地刺",
    100,
    "spike",
    27,
    "#b89c72",
    "持续伤害走过的僵尸，并扎破车辆。",
    { damage: 20, interval: 1 },
  ),
  p(
    "torch",
    "火炬树桩",
    175,
    "torch",
    28,
    "#bb7146",
    "把穿过的普通豌豆变成伤害更高的火球。",
  ),
  p(
    "tallnut",
    "高坚果",
    125,
    "wall",
    29,
    "#ae7849",
    "更耐打，还能拦住撑杆与海豚跳跃。",
    { hp: 10000, cooldown: 30 },
  ),
  p(
    "sea",
    "海蘑菇",
    0,
    "shroom",
    31,
    "#b49de3",
    "直接种在水面，攻击附近的僵尸。",
    { damage: 20, interval: 1.4, cooldown: 30 },
  ),
  p("lantern", "路灯花", 25, "light", 32, "#f4cb56", "照亮浓雾中的一片区域。", {
    cooldown: 30,
  }),
  p(
    "cactus",
    "仙人掌",
    125,
    "shooter",
    33,
    "#8aba65",
    "发射尖刺，能够击落气球僵尸。",
    { damage: 20, interval: 1.4 },
  ),
  p(
    "blover",
    "三叶草",
    100,
    "blover",
    34,
    "#8dc789",
    "吹走气球僵尸，并暂时驱散浓雾。",
  ),
  p(
    "split",
    "裂荚射手",
    125,
    "shooter",
    36,
    "#96b362",
    "同时照顾前方与后方的敌人。",
    { damage: 20, interval: 1.4 },
  ),
  p("star", "杨桃", 125, "star", 37, "#e9bf49", "向周围多个方向发射星星。", {
    damage: 20,
    interval: 1.4,
  }),
  p(
    "pumpkin",
    "南瓜头",
    125,
    "armor",
    38,
    "#e39b3e",
    "套在其他植物外面提供额外保护。",
    { hp: 5000, cooldown: 30 },
  ),
  p(
    "magnet",
    "磁力菇",
    100,
    "magnet",
    39,
    "#d97579",
    "吸走附近僵尸的金属装备。",
  ),
  p(
    "cabbage",
    "卷心菜投手",
    100,
    "lob",
    41,
    "#9bb962",
    "抛射卷心菜，适合屋顶战斗。",
    { damage: 40, interval: 2.8 },
  ),
  p("pot", "花盆", 25, "base", 42, "#be7d55", "在屋顶上为植物提供种植位置。"),
  p(
    "kernel",
    "玉米投手",
    100,
    "lob",
    43,
    "#e6c96a",
    "抛射玉米粒，偶尔用黄油定住僵尸。",
    { damage: 20, interval: 2.8 },
  ),
  p("coffee", "咖啡豆", 75, "coffee", 44, "#8c6151", "唤醒白天睡着的蘑菇。"),
  p(
    "garlic",
    "大蒜",
    50,
    "garlic",
    46,
    "#e2d6ad",
    "让啃食它的陆地僵尸换到相邻路线。",
  ),
  p(
    "umbrella",
    "叶子保护伞",
    100,
    "umbrella",
    47,
    "#90b978",
    "保护周围植物免受蹦极与篮球攻击。",
  ),
  p(
    "marigold",
    "金盏花",
    50,
    "coin",
    48,
    "#eab761",
    "定期产出金币，累计在本地收藏记录。",
    { cooldown: 30 },
  ),
  p(
    "melon",
    "西瓜投手",
    300,
    "lob",
    49,
    "#78a359",
    "投出西瓜，对附近僵尸造成溅射伤害。",
    { damage: 80, interval: 2.8 },
  ),
  p(
    "gatling",
    "机枪射手",
    250,
    "shooter",
    51,
    "#5b9157",
    "种在双发射手上，每轮四连发。",
    { damage: 80, interval: 1.4, upgrade: "repeater", cooldown: 50 },
  ),
  p(
    "twin",
    "双子向日葵",
    150,
    "sun",
    51,
    "#edb751",
    "升级向日葵，每次产生双份阳光。",
    { upgrade: "sunflower", cooldown: 50 },
  ),
  p(
    "gloom",
    "忧郁菇",
    150,
    "gloom",
    51,
    "#8570ac",
    "升级大喷菇，攻击周围全部敌人。",
    { upgrade: "fume", damage: 80, interval: 1.9, cooldown: 50 },
  ),
  p(
    "cattail",
    "香蒲",
    225,
    "homing",
    51,
    "#bd9f78",
    "升级睡莲，追踪任意路线和空中的目标。",
    { upgrade: "lily", damage: 40, interval: 1.4, cooldown: 50 },
  ),
  p(
    "winter",
    "冰西瓜",
    200,
    "lob",
    51,
    "#81bccc",
    "升级西瓜投手，溅射伤害并群体减速。",
    { upgrade: "melon", damage: 80, interval: 2.8, cooldown: 50 },
  ),
  p(
    "goldmagnet",
    "吸金磁",
    50,
    "coin",
    51,
    "#d9b553",
    "升级磁力菇，自动收集场上的金币。",
    { upgrade: "magnet", cooldown: 50 },
  ),
  p(
    "spikerock",
    "地刺王",
    125,
    "spike",
    51,
    "#9ba2a0",
    "升级地刺，造成双倍伤害并承受多次碾压。",
    { upgrade: "spike", hp: 900, damage: 40, interval: 1, cooldown: 50 },
  ),
  p(
    "cob",
    "玉米加农炮",
    500,
    "cannon",
    51,
    "#b6a459",
    "占用相邻两株玉米投手，点击后选择轰炸位置。",
    { upgrade: "kernel", hp: 600, cooldown: 50 },
  ),
  p(
    "imitater",
    "模仿者",
    0,
    "imitater",
    51,
    "#b5b3a0",
    "选卡时指定一种基础植物，获得独立冷却的副本。",
  ),
];
export const plantById = Object.fromEntries(
  plants.map((p) => [p.id, p]),
) as Record<string, PlantDef>;
export type ZombieDef = {
  id: string;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  color: string;
  desc: string;
  tip: string;
  counters: string[];
};
const z = (
  id: string,
  name: string,
  hp: number,
  speed: number,
  armor: number,
  desc: string,
  tip: string,
  counters: string[] = [],
  color = "#8faaa0",
): ZombieDef => ({ id, name, hp, speed, armor, desc, tip, counters, color });
export const zombies: ZombieDef[] = [
  z("basic", "普通僵尸", 200, 10, 0, "慢慢走来，啃食面前的植物。", "没有特殊能力，一株射手就能稳稳挡住。"),
  z("flag", "旗帜僵尸", 200, 13, 0, "举旗带领一大波僵尸进攻。", "旗帜出现预示大波进攻，提前检查每行火力。"),
  z("cone", "路障僵尸", 200, 10, 370, "路障提供额外保护。", "打碎路障后就和普通僵尸一样，集中火力即可。"),
  z("pole", "撑杆僵尸", 400, 27, 0, "跨过遇到的第一株矮植物。", "只会跨一次；高坚果能直接拦下这一跳。", ["tallnut"]),
  z("bucket", "铁桶僵尸", 260, 10, 1350, "铁桶非常坚固，但会被磁力菇吸走。", "磁力菇能吸走铁桶，让它立刻变脆。", ["magnet"]),
  z("paper", "读报僵尸", 200, 10, 150, "报纸破掉后，会愤怒地加速。", "报纸一破就会狂奔，提前在后方备好坚果。"),
  z(
    "screen",
    "铁栅门僵尸",
    260,
    10,
    1350,
    "铁门抵挡直射攻击，烟雾与投掷能越过它。",
    "大喷菇的烟雾和投手的抛物线都能越过铁门。",
    ["fume", "gloom", "cabbage", "kernel", "melon", "winter"],
  ),
  z("football", "橄榄球僵尸", 300, 29, 1700, "移动快，护甲也很厚。", "寒冰射手减速，磁力菇吸走护甲。", ["magnet", "snowpea"]),
  z("dancer", "舞王僵尸", 500, 12, 0, "定期召唤伴舞僵尸。", "优先消灭舞王，伴舞就不会继续出现。"),
  z("backup", "伴舞僵尸", 200, 12, 0, "跟随舞王从附近加入战斗。", "挡住舞王，伴舞就不再增援。"),
  z("ducky", "鸭子救生圈僵尸", 200, 11, 0, "乘着泳圈进入水路。", "会在水路出现，别忘了在睡莲上布置火力。", ["kelp"]),
  z("snorkel", "潜水僵尸", 200, 15, 0, "潜水时躲避普通直射攻击。", "投手类植物能直接打中潜水的它。", ["cabbage", "kernel", "melon", "winter", "kelp"]),
  z("zomboni", "冰车僵尸", 1650, 16, 0, "碾压植物并留下不能种植的冰道。", "地刺能扎破冰车；火爆辣椒可以清除冰道。", ["spike", "spikerock", "jalapeno"]),
  z("bobsled", "雪橇僵尸小队", 800, 25, 0, "沿着冰道快速推进。", "清除冰道后，雪橇小队就失去了速度。", ["jalapeno"]),
  z("dolphin", "海豚骑士僵尸", 400, 34, 0, "快速游动，跳过第一株矮植物。", "高坚果能拦住它的跳跃。", ["tallnut"]),
  z("jack", "玩偶匣僵尸", 340, 18, 0, "随身的盒子可能爆炸并摧毁附近植物。", "尽快远程消灭，别让它走进植物阵中。"),
  z("balloon", "气球僵尸", 200, 12, 0, "飞过普通植物，需要防空能力应对。", "仙人掌能击落气球，三叶草可以直接吹走。", ["cactus", "blover", "cattail"]),
  z("digger", "矿工僵尸", 270, 25, 0, "钻到庭院左侧后向右啃食。", "裂荚射手能向后攻击；磁力菇能吸走矿镐。", ["split", "magnet"]),
  z("pogo", "跳跳僵尸", 400, 22, 0, "不断跳过矮植物，磁力菇能吸走跳杆。", "磁力菇吸走跳杆后就只能步行。", ["magnet"]),
  z("yeti", "雪人僵尸", 1350, 14, 0, "只在通关重玩时出现，停留后逃离。", "停留片刻就会逃跑，集中火力速战速决。"),
  z("bungee", "蹦极僵尸", 450, 0, 0, "从空中落下，偷走一株植物。", "叶子保护伞能挡下它的偷袭。", ["umbrella"]),
  z("catapult", "投石车僵尸", 850, 11, 0, "远处投篮，接近后碾压植物。", "叶子保护伞挡篮球；地刺能扎破它的车。", ["umbrella", "spike", "spikerock"]),
  z("garg", "巨人僵尸", 3800, 10, 0, "砸毁植物，半血时抛出小鬼。", "半血时会抛出小鬼，留好樱桃炸弹应对落点。", ["cherry", "jalapeno", "doom"]),
  z("imp", "小鬼僵尸", 200, 20, 0, "体型小，移动迅速。", "会被抛到防线中段，提前在那里布置火力。"),
  z("boss", "僵王博士", 24000, 0, 0, "召唤僵尸、砸击并发射冰火球。", "寒冰菇熄灭火球，火爆辣椒融化冰球。", ["ice", "jalapeno"]),
  z(
    "ladder",
    "扶梯僵尸",
    600,
    21,
    650,
    "架梯越过坚果和南瓜，磁力菇可以吸走梯子。",
    "磁力菇能吸走梯子；梯子架好后其他僵尸也会利用。",
    ["magnet"],
  ),
];
export const zombieById = Object.fromEntries(
  zombies.map((z) => [z.id, z]),
) as Record<string, ZombieDef>;
export const worlds = [
  {
    name: "晴日庭院",
    subtitle: "阳光正好，守住你的草坪",
    scene: "day",
    color: "#83a754",
  },
  {
    name: "月下墓园",
    subtitle: "夜色降临，蘑菇们醒来了",
    scene: "night",
    color: "#7775a6",
  },
  {
    name: "夏日泳池",
    subtitle: "水花背后，新的访客来了",
    scene: "pool",
    color: "#66a8af",
  },
  {
    name: "迷雾后院",
    subtitle: "点亮夜色，看清前方",
    scene: "fog",
    color: "#729591",
  },
  {
    name: "红瓦屋顶",
    subtitle: "最后一道防线，就在这里",
    scene: "roof",
    color: "#c08367",
  },
];
export type Level = {
  id: number;
  label: string;
  world: number;
  stage: number;
  scene: string;
  rows: number;
  enemies: string[];
  count: number;
  interval: number;
  mode:
    "normal" | "conveyor" | "bowling" | "whack" | "vases" | "storm" | "boss";
};
export const levels: Level[] = Array.from({ length: 50 }, (_, i) => {
  const id = i + 1,
    world = Math.floor(i / 10),
    stage = (i % 10) + 1;
  let enemies = ["basic"];
  if (id >= 3) enemies.push("cone");
  if (id >= 6) enemies.push("pole");
  if (id >= 8) enemies.push("bucket");
  if (world === 1)
    enemies = [
      "basic",
      "cone",
      ...(stage >= 2 ? ["paper"] : []),
      ...(stage >= 3 ? ["screen"] : []),
      ...(stage >= 6 ? ["football"] : []),
      ...(stage >= 8 ? ["dancer"] : []),
    ];
  if (world === 2)
    enemies = [
      "basic",
      "cone",
      "bucket",
      "ducky",
      ...(stage >= 3 ? ["snorkel"] : []),
      ...(stage >= 5 ? ["zomboni"] : []),
      ...(stage >= 7 ? ["dolphin"] : []),
      ...(stage >= 8 ? ["bobsled"] : []),
    ];
  if (world === 3)
    enemies = [
      "basic",
      "cone",
      "bucket",
      "ducky",
      ...(stage >= 2 ? ["jack"] : []),
      ...(stage >= 3 ? ["balloon"] : []),
      ...(stage >= 6 ? ["digger"] : []),
      ...(stage >= 8 ? ["pogo"] : []),
    ];
  if (world === 4)
    enemies = [
      "basic",
      "cone",
      "bucket",
      "bungee",
      ...(stage >= 2 ? ["ladder"] : []),
      ...(stage >= 3 ? ["catapult"] : []),
      ...(stage >= 6 ? ["garg"] : []),
    ];
  let mode: Level["mode"] = stage === 10 ? "conveyor" : "normal";
  if (id === 5) mode = "bowling";
  if (id === 15) mode = "whack";
  if (id === 35) mode = "vases";
  if (id === 40) mode = "storm";
  if (id === 45) {
    mode = "conveyor";
    enemies = ["bungee", "basic", "bucket"];
  }
  if (id === 50) mode = "boss";
  return {
    id,
    label: `${world + 1}-${stage}`,
    world,
    stage,
    scene: worlds[world].scene,
    rows: world === 2 || world === 3 ? 6 : 5,
    enemies,
    count: 8 + stage * 2 + world * 5,
    interval: Math.max(3, 9 - stage * 0.3 - world * 0.65),
    mode,
  };
});
export const isNight = (scene: string) => scene === "night" || scene === "fog";
export const isMushroom = (id: string) =>
  [
    "puff",
    "sunshroom",
    "fume",
    "hypno",
    "scaredy",
    "ice",
    "doom",
    "sea",
    "magnet",
    "gloom",
  ].includes(id);
