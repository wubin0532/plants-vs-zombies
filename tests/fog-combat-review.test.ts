import { describe, it, expect } from 'vitest';
import { Engine } from '../src/game/engine';
import { applyControl } from '../src/game/elements';
import { fogActive, foggedAt } from '../src/game/visibility';
import { levels, plants, plantById, recommendCards } from '../src/game/content';
import { cellAt, cellX, cellY } from '../src/game/layout';

const run = (e: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
};
function target(e: Engine, id = 'basic', row = 0, x = 4) {
  e.spawn(id, row, x);
  const z = e.zombies.at(-1)!;
  applyControl(z, 'otherFreeze', 100);
  return z;
}
function shot(e: Engine, type: string, damage = 80, x = 0) {
  const p = e.addPlant(type === 'fire' ? 'pea' : type, 0, x);
  p.timer = 100;
  e.shoot(p, e.zombies[0], damage, type);
}

describe('章节与照明', () => {
  it('第四章全部没有墓碑或末波墓碑伏兵', () => {
    for (let id = 31; id <= 40; id++) {
      const e = new Engine(id, []);
      expect(e.tiles.some(t => t.type === 'grave')).toBe(false);
      e.time = 1e9; e.step(1 / 60);
      expect(e.message).not.toContain('墓碑里爬出了僵尸');
    }
  });
  it('砸罐关全场可见，砸完可在原地种植', () => {
    const e = new Engine(35, []);
    expect(new Set(e.tiles.map(t => `${t.row}:${t.col}`)).size).toBe(e.tiles.length);
    expect(fogActive(e)).toBe(false);
    e.click(0, 5);
    expect(e.tiles.some(t => t.row === 0 && t.col === 5)).toBe(false);
    expect(e.canPlant('pea', 0, 5)).toBe('');
  });
  it('4-1 已能选择路灯花，左右两列上下各一行同一边界揭露', () => {
    expect(plantById.lantern.unlock).toBe(31);
    const e = new Engine(31, []);
    expect(foggedAt(e, 0, 3.49)).toBe(false);
    expect(foggedAt(e, 0, 3.5)).toBe(true);
    const lamp = e.addPlant('lantern', 1, 5);
    expect(foggedAt(e, 0, 7.49)).toBe(false);
    expect(foggedAt(e, 0, 7.5)).toBe(true);
    expect(foggedAt(e, 2, 5)).toBe(false);
    expect(foggedAt(e, 3, 5)).toBe(true);
    lamp.hp = 0;
    expect(foggedAt(e, 0, 5)).toBe(true);
    e.plants = [];
    expect(foggedAt(e, 0, 5)).toBe(true);
  });
  it('三叶草清雾到期恢复，暂停不消耗倒计时', () => {
    const e = new Engine(34, []);
    e.addPlant('blover', 0, 0); run(e, 1.1);
    expect(e.fogClear).toBeGreaterThan(19);
    expect(foggedAt(e, 0, 5)).toBe(false);
    e.paused = true;
    const time = e.time, remaining = e.fogClear;
    run(e, 1);
    expect(e.time).toBe(time); expect(e.fogClear).toBe(remaining);
    e.paused = false; e.fogClear = .1; run(e, .2);
    expect(foggedAt(e, 0, 5)).toBe(true);
  });
  it('暴风雨每八秒闪电揭露一秒，普通关不闪现', () => {
    const e = new Engine(40, []);
    for (const time of [0, .99, 8, 8.99]) { e.time = time; expect(fogActive(e)).toBe(false); }
    for (const time of [1, 7.99, 9]) { e.time = time; expect(fogActive(e)).toBe(true); }
    expect(fogActive(new Engine(31, []))).toBe(true);
  });
  it('六行地图中心与点击格子一致，水路严格为中间两行', () => {
    const e = new Engine(31, []);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) {
      expect(cellAt(cellX(col), cellY(row, 6), 6)).toEqual({ row, col });
      expect(e.water(row)).toBe(row === 2 || row === 3);
    }
  });
  it('所有正常关按实际解锁推荐：经济、持续输出、水路/屋顶底座不丢失', () => {
    for (const l of levels.filter(l => l.mode === 'normal')) {
      const unlocked = plants.filter(p => p.unlock <= l.id).map(p => p.id);
      const rec = recommendCards(l, unlocked, Math.min(10, 6 + Math.floor((l.id - 1) / 10)));
      expect(rec.every(id => unlocked.includes(id))).toBe(true);
      expect(rec.some(id => ['shooter', 'shroom', 'fume', 'lob'].includes(plantById[id].kind))).toBe(true);
      if (l.id > 1) expect(rec.some(id => ['sunflower', 'sunshroom'].includes(id))).toBe(true);
      if (l.rows === 6) expect(rec).toContain('lily');
      if (l.scene === 'roof' && unlocked.includes('pot')) expect(rec).toContain('pot');
      if (l.scene === 'fog') { expect(rec).toContain('lantern'); expect(rec).not.toContain('grave'); }
      if (l.enemies.includes('balloon')) expect(rec.some(id => ['cactus', 'blover'].includes(id))).toBe(true);
    }
  });
});

describe('溅射与护甲', () => {
  it.each(['melon', 'winter', 'fire'])('%s 溅射排除飞行、地下、友军和死亡目标', type => {
    const e = new Engine(11, []);
    target(e); const air = target(e, 'balloon', 1), underground = target(e, 'digger', 1);
    const ally = target(e, 'basic', 1); ally.ally = true;
    const dead = target(e, 'basic', 1); dead.hp = 0;
    shot(e, type); run(e, 1);
    expect(air.hp).toBe(air.max); expect(underground.hp).toBe(underground.max);
    expect(ally.hp).toBe(ally.max); expect(dead.hp).toBe(0);
    if (type === 'winter') { expect(air.iceSlow ?? 0).toBe(0); expect(underground.iceSlow ?? 0).toBe(0); }
  });
  it.each(['melon', 'winter'])('%s 直击与溅射都越过铁门而不越过头盔，仍可命中潜水', type => {
    const e = new Engine(11, []);
    const main = target(e, 'screen'), door = target(e, 'screen', 1);
    const helmet = target(e, 'bucket', 1), diver = target(e, 'snorkel', 1);
    shot(e, type); run(e, 1);
    expect(main.hp).toBe(main.max - 80); expect(main.armor).toBe(main.maxArmor);
    expect(door.hp).toBeCloseTo(door.max - 80 / 3); expect(door.armor).toBe(door.maxArmor);
    expect(helmet.hp).toBe(helmet.max); expect(helmet.armor).toBeCloseTo(helmet.maxArmor - 80 / 3);
    expect(diver.hp).toBeLessThan(diver.max);
  });
  it('烟雾不攻击隐藏潜水者，露出时恢复攻击', () => {
    const e = new Engine(31, []); const z = target(e, 'snorkel', 2);
    const p = e.addPlant('fume', 2, 2); p.timer = 0;
    e.step(1 / 60); expect(z.hp).toBe(z.max);
    z.action = 'eat'; p.timer = 0; e.step(1 / 60); expect(z.hp).toBeLessThan(z.max);
  });
});

describe('冰火与冰电', () => {
  it.each([1, 2])('%i 株火炬分别将冰豌豆转换为普通豌豆/火球', count => {
    const e = new Engine(11, []), z = target(e);
    e.addPlant('torch', 0, 1);
    if (count === 2) e.addPlant('torch', 0, 2);
    shot(e, 'snowpea', 20); run(e, 1);
    expect(z.hp).toBe(z.max - (count === 1 ? 20 : 40)); expect(z.iceSlow ?? 0).toBe(0);
  });
  it('反向弹丸按行进顺序经过两株火炬', () => {
    const e = new Engine(11, []), z = target(e, 'basic', 0, 1);
    e.addPlant('torch', 0, 2); e.addPlant('torch', 0, 3);
    shot(e, 'snowpea', 20, 5); run(e, 1);
    expect(z.hp).toBe(z.max - 40);
  });
  it('火焰直击和溅射清除冰控，保留黄油和天气控制', () => {
    const e = new Engine(11, []), main = target(e), side = target(e, 'basic', 1);
    for (const z of [main, side]) { applyControl(z, 'iceFreeze', 200); applyControl(z, 'iceSlow', 20); applyControl(z, 'weatherSlow', 5); }
    shot(e, 'fire', 40); run(e, 1);
    for (const z of [main, side]) {
      expect(z.iceFreeze).toBe(0); expect(z.iceSlow).toBe(0);
      expect(z.freeze).toBeCloseTo(99); expect(z.slow).toBeCloseTo(4);
    }
  });
  it('火爆辣椒解除存活重甲目标冰控，普通爆炸不会', () => {
    const e = new Engine(11, []), z = target(e);
    z.hp = 5000; applyControl(z, 'iceFreeze', 200); applyControl(z, 'iceSlow', 200);
    e.blast(4, 0, 1, 10); expect(z.iceSlow).toBe(200);
    e.addPlant('jalapeno', 0, 0); run(e, 1.1);
    expect(z.hp).toBe(3190); expect(z.iceFreeze).toBe(0); expect(z.iceSlow).toBe(0); expect(z.freeze).toBeGreaterThan(98);
  });
  it('先融冰再电击不爆发，重新施冰后遵守单目标冷却', () => {
    const e = new Engine(11, []), z = target(e); z.hp = 2000;
    applyControl(z, 'iceSlow', 10); shot(e, 'fire', 40); run(e, 1);
    e.electricHit(z, 20); expect(e.reactions).toBe(0);
    applyControl(z, 'iceSlow', 10); e.electricHit(z, 20); expect(e.reactions).toBe(1);
    applyControl(z, 'iceSlow', 10); e.electricHit(z, 20); expect(e.reactions).toBe(1); expect(z.iceSlow).toBe(10);
  });
});
