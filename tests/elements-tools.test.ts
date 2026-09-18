import { describe, it, expect } from 'vitest';
import { Engine } from '../src/game/engine';
import { applyControl } from '../src/game/elements';
import { initial, validateSave } from '../src/store';
import { plantById } from '../src/game/content';
const run = (e: Engine, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60); };
const enemy = (e: Engine, row = 2, x = 5, id = 'basic') => {
  e.spawn(id, row, x);
  const z = e.zombies.at(-1)!;
  z.hp = z.max = 2000;
  z.armor = 0;
  return z;
};

describe('冰电反应', () => {
  it('基础数值与第 1-8 关解锁', () => {
    expect(plantById.arc).toMatchObject({ cost: 225, hp: 300, cooldown: 7.5, damage: 40, interval: 1.4, unlock: 8 });
  });
  it('一次满额反应造成 170 总伤害（同排至多 3 目标传导），消耗主目标冰冻但不消耗次级目标状态', () => {
    const e = new Engine(8, []), a = enemy(e);
    const group = [enemy(e, 2, 4), enemy(e, 2, 5.5), enemy(e, 2, 6)];
    applyControl(a, 'iceFreeze', 4); applyControl(a, 'iceSlow', 10);
    for (const z of group) applyControl(z, 'iceSlow', 10);
    e.electricHit(a, 20);
    expect(a.hp).toBe(1920); expect(a.freeze).toBe(0); expect(a.slow).toBe(0);
    expect(group.map(z => z.hp)).toEqual([1970, 1970, 1970]);
    expect(group.every(z => z.iceSlow === 10)).toBe(true);
    expect(e.reactions).toBe(1);
    expect(e.effects.filter(fx => fx.type === 'conduction')).toHaveLength(3);
  });
  it('传导只沿同一排：跨排与超范围不传导，同排按距离取至多 3 个', () => {
    const e = new Engine(8, []), a = enemy(e);
    const group = [enemy(e, 2, 4), enemy(e, 2, 4.5), enemy(e, 2, 6), enemy(e, 2, 6.5)];
    const off = [enemy(e, 0, 5), enemy(e, 1, 5), enemy(e, 2, 7.01)];
    applyControl(a, 'iceSlow', 10); e.electricHit(a, 20);
    // 同排 ≤2 格内最近 3 个（x4.5、x4、x6）各受 30；第 4 个 x6.5 超出名额
    expect(group.map(z => z.hp)).toEqual([1970, 1970, 1970, 2000]);
    expect(off.every(z => z.hp === 2000)).toBe(true);
  });
  it('主目标被基础伤害杀死也能传导，多个电源不重复消费同一冰系状态', () => {
    const e = new Engine(8, []), a = enemy(e), b = enemy(e, 2, 6);
    a.hp = 10; applyControl(a, 'iceSlow', 5);
    e.electricHit(a, 20); e.electricHit(a, 20);
    expect(b.hp).toBe(1970); expect(e.reactions).toBe(1);
    const c = enemy(e, 2, 5); applyControl(c, 'iceSlow', 5);
    e.electricHit(c, 20); e.electricHit(c, 20);
    expect(c.hp).toBe(1900); expect(e.reactions).toBe(2);
  });
  it('伤害依次由护甲吸收，不穿甲', () => {
    const e = new Engine(8, []), a = enemy(e), b = enemy(e, 2, 6);
    a.armor = 100; b.armor = 200;
    applyControl(a, 'iceSlow', 5); e.electricHit(a, 20);
    expect(a.hp).toBe(2000); expect(a.armor).toBe(20);
    expect(b.hp).toBe(2000); expect(b.armor).toBe(170);
  });
  it('黄油、天气不能触发反应，消耗冰系后保留其余控制', () => {
    const e = new Engine(8, []), z = enemy(e);
    applyControl(z, 'otherFreeze', 3); applyControl(z, 'weatherSlow', 5);
    e.electricHit(z, 20); expect(e.reactions).toBe(0);
    applyControl(z, 'iceFreeze', 4); applyControl(z, 'iceSlow', 10);
    run(e, 1); e.electricHit(z, 20);
    expect(z.freeze).toBeCloseTo(2); expect(z.slow).toBeCloseTo(4);
  });
  it('冰系状态到期后不再触发', () => {
    const e = new Engine(8, []), z = enemy(e);
    applyControl(z, 'iceSlow', 0.2); run(e, 0.4); e.electricHit(z, 20);
    expect(e.reactions).toBe(0);
  });
  it.each(['flying', 'underground', 'ally'] as const)('排除 %s 主目标与传导目标', field => {
    const e = new Engine(8, []), z = enemy(e), a = enemy(e, 2, 6);
    z[field] = true; applyControl(z, 'iceSlow', 5);
    e.electricHit(z, 20); expect(z.hp).toBe(2000);
    applyControl(a, 'iceSlow', 5); e.electricHit(a, 20); expect(z.hp).toBe(2000);
  });
  it('潜水隐藏目标免疫，露出攻击时可以被击中', () => {
    const e = new Engine(21, []), z = enemy(e, 2, 5, 'snorkel');
    applyControl(z, 'iceSlow', 5); e.electricHit(z, 20); expect(z.hp).toBe(2000);
    z.action = 'eat'; e.electricHit(z, 20); expect(z.hp).toBe(1920);
  });
  it('电弧花实际攻击同排前方，冰冻射手实际子弹附带可反应的减速', () => {
    const e = new Engine(8, []);
    e.addPlant('snowpea', 2, 0); const p = e.addPlant('arc', 2, 1); p.timer = 2;
    const a = enemy(e, 2, 3), b = enemy(e, 2, 4), behind = enemy(e, 2, 0);
    behind.freeze = 20;
    run(e, 2.1);
    expect(e.reactions).toBeGreaterThan(0); expect(b.hp).toBeLessThan(2000);
    expect(behind.hp).toBe(2000); expect(a.hp).toBeLessThan(1980);
  });
  it('寒冰菇冻结可触发冰电', () => {
    const e = new Engine(11, []), z = enemy(e);
    e.addPlant('ice', 0, 0); run(e, 1.2); e.electricHit(z, 20);
    expect(e.reactions).toBe(1);
  });
});

describe('移植', () => {
  const setup = () => { const e = new Engine(8, []); e.selectTool(); return e; };
  it('主植物与保护壳整体移动，保留编号、血量、冷却、消化和梯子', () => {
    const e = setup(), p = e.addPlant('chomper', 0, 0), shell = e.addPlant('pumpkin', 0, 0);
    p.hp = 100; p.timer = 12; p.digest = 12; p.age = 35; p.ladder = true; shell.hp = 123;
    const snapshot = { ...p };
    e.useTool(0, 0); expect(e.toolUses).toBe(3); expect(e.useTool(1, 1)).toBe(true);
    expect(p).toEqual({ ...snapshot, row: 1, col: 1 });
    expect(shell).toMatchObject({ row: 1, col: 1, hp: 123 }); expect(e.toolUses).toBe(2);
    expect(e.plantsLost).toBe(0);
  });
  it('移动地雷不重置准备进度，升级植物不用重新提供升级素材', () => {
    const e = setup(), mine = e.addPlant('potato', 0, 0); mine.age = 13;
    e.useTool(0, 0); e.useTool(1, 1); run(e, 1.1); expect(mine.ready).toBe(true);
    const p = e.addPlant('gatling', 0, 0); e.selectTool(); e.useTool(0, 0);
    expect(e.useTool(1, 2)).toBe(true); expect(p.id).toBe('gatling');
  });
  it('水路需要睡莲，底座留在原地；屋顶需要花盆', () => {
    const e = new Engine(21, []), p = e.addPlant('arc', 0, 0);
    e.selectTool(); e.useTool(0, 0); expect(e.useTool(2, 1)).toBe(false);
    e.addPlant('lily', 2, 1); expect(e.useTool(2, 1)).toBe(true);
    e.selectTool(); e.useTool(2, 1); expect(e.useTool(0, 1)).toBe(true);
    expect(e.at(2, 1, 'base')?.id).toBe('lily'); expect(p.row).toBe(0);
    const roof = new Engine(41, []); roof.addPlant('arc', 0, 0); roof.selectTool(); roof.useTool(0, 0);
    expect(roof.useTool(0, 5)).toBe(false); roof.addPlant('pot', 0, 5);
    expect(roof.useTool(0, 5)).toBe(true); expect(roof.at(0, 0, 'base')?.id).toBe('pot');
  });
  it('占用、障碍、非法坐标与取消都不扣次数', () => {
    const e = setup(); e.addPlant('pea', 0, 0); e.addPlant('pumpkin', 0, 1);
    e.tiles.push({ row: 0, col: 2, type: 'ice', life: 5 });
    e.useTool(0, 0);
    for (const col of [-1, 0, 1, 2, 9, NaN]) expect(e.useTool(0, col)).toBe(false);
    expect(e.toolUses).toBe(3); e.cancelSelection(); expect(e.toolSource).toBe(0);
  });
  it('选择后植物死亡或进入绑定动作，执行前重新校验', () => {
    const e = setup(), p = e.addPlant('chomper', 0, 0);
    e.useTool(0, 0); p.chomp = { target: 1, elapsed: 0, hit: false };
    expect(e.useTool(1, 1)).toBe(false); p.chomp = undefined; p.hp = 0;
    expect(e.useTool(1, 1)).toBe(false); expect(e.toolUses).toBe(3);
  });
  it.each(['cob', 'cherry', 'ice', 'squash'])('拒绝移动 %s', id => {
    const e = setup(); e.addPlant(id, 0, 0); e.useTool(0, 0);
    expect(e.toolSource).toBe(0); expect(e.toolUses).toBe(3);
  });
  it('暂停与次数耗尽不能使用，重开恢复次数', () => {
    const e = setup(); e.addPlant('pea', 0, 0); e.useTool(0, 0);
    e.paused = true; expect(e.useTool(1, 1)).toBe(false); e.paused = false;
    for (let i = 0; i < 3; i++) { e.selected = 'tool'; e.toolSource = e.plants[0].uid; expect(e.useTool(1, i + 1)).toBe(true); }
    e.selectTool(); expect(e.selected).toBe(''); expect(e.toolUses).toBe(0);
    expect(new Engine(8, []).toolUses).toBe(3);
  });
});

describe('特殊模式与存档', () => {
  it('保龄球冰球低伤减速、电球触发，换排不重置球状态', () => {
    const e = new Engine(5, []); e.conveyor = ['snowpea', 'arc'];
    expect(e.plant('snowpea', 1, 4)).toBe(true);
    const z = enemy(e, 1, 4.25); run(e, 0.05);
    expect(z.hp).toBe(1980); expect(z.iceSlow).toBeGreaterThan(0);
    const b = e.bowls[0], hit = [...b.hit], x = b.x;
    e.selectTool(); e.selectBowl(b.uid);
    const targetRow = b.row === 0 ? 1 : b.row - 1;
    expect(e.useTool(targetRow, 4)).toBe(true); expect(b.hit).toEqual(hit); expect(b.x).toBe(x);
    expect(e.plant('arc', 1, 4)).toBe(true); run(e, 0.05); expect(e.reactions).toBe(1);
  });
  it('滚球换排拒绝跨两排与已经离场的球', () => {
    const e = new Engine(5, []); e.conveyor = ['wallnut']; e.plant('wallnut', 2, 4);
    const b = e.bowls[0]; e.selectTool(); e.selectBowl(b.uid);
    expect(e.useTool(0, 4)).toBe(false); b.x = 9.1;
    expect(e.useTool(1, 4)).toBe(false); expect(e.toolUses).toBe(3);
  });
  it('双锤共享冷却，切换不能绕过；紧急冰冻无伤害且范围有限', () => {
    const e = new Engine(15, []), z = enemy(e), far = enemy(e, 0, 5);
    e.hitZombie(z.uid); expect(z.hp).toBe(1980);
    e.selectHammer('electric'); e.hitZombie(z.uid); expect(z.hp).toBe(1980);
    run(e, 0.4); e.hitZombie(z.uid); expect(z.hp).toBe(1830); expect(e.reactions).toBe(1);
    e.selectTool(); expect(e.useTool(2, 5)).toBe(true);
    expect(z.hp).toBe(1830); expect(z.freeze).toBe(3); expect(far.freeze).toBe(0); expect(e.toolUses).toBe(2);
  });
  it('标记罐必定提供组合且只能领取一次，供卡不是无限自动获得', () => {
    const e = new Engine(35, []); expect(e.conveyor).toHaveLength(0);
    expect(e.tiles.filter(t => t.reward)).toHaveLength(2);
    e.click(0, 4); e.click(1, 4); e.click(1, 4);
    expect(e.conveyor).toEqual(['snowpea', 'arc']); run(e, 10);
    expect(e.conveyor).toEqual(['snowpea', 'arc']); expect(e.spawned).toBe(0);
    expect(e.plant('arc', 2, 0)).toBe(false);
  });
  it.each([10, 20, 30, 40, 45, 50])('第 %i 关卡池保留原卡并加入冰电', id => {
    const e = new Engine(id, ['pea', 'cherry']); const seen = new Set<string>();
    for (let i = 0; i < 300; i++) { e.conveyor = []; e.addBelt(); seen.add(e.conveyor[0]); }
    expect(seen.has('snowpea')).toBe(true); expect(seen.has('arc')).toBe(true);
    if (id === 50) for (const card of ['ice', 'jalapeno', 'pot', 'cabbage']) expect(seen.has(card)).toBe(true);
    else expect(seen.has('pea')).toBe(true);
  });
  it('首领本体不受冰电反应影响', () => {
    const e = new Engine(50, []), z = enemy(e, 1, 8); e.bossDown = 10;
    const hp = e.bossHp; applyControl(z, 'iceFreeze', 3); e.electricHit(z, 20);
    expect(e.bossHp).toBe(hp); expect(e.reactions).toBe(1);
  });
  it('旧存档补教学记录，不改变已完成关卡、金币及解锁', () => {
    const old: Record<string, unknown> = { ...initial(), completed: [1, 2, 3, 4, 5, 6, 7], unlocked: 8, coins: 321 };
    delete old.tutorialSeen; const save = validateSave(old);
    expect(save.tutorialSeen).toEqual([]); expect(save.unlocked).toBe(8); expect(save.coins).toBe(321);
    expect(save.completed).toEqual(old.completed);
  });
});
