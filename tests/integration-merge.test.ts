import { it, expect } from 'vitest';
import { Engine } from '../src/game/engine';
import { applyControl } from '../src/game/elements';
import { initial, validateSave } from '../src/store';

it('真实黄油命中不触发冰电，冰电消耗冰冻后仍保留黄油定身', () => {
  const e = new Engine(8, []);
  const p = e.addPlant('kernel', 2, 1); p.timer = 100;
  e.spawn('basic', 2, 2);
  const z = e.zombies[0]; z.hp = z.max = 2000;
  e.shoot(p, z, 40, 'butter');
  for (let i = 0; i < 25; i++) e.step(1 / 60);
  expect(z.otherFreeze).toBeGreaterThan(0);
  e.electricHit(z, 20);
  expect(e.reactions).toBe(0);
  applyControl(z, 'iceSlow', 5);
  e.electricHit(z, 20);
  expect(e.reactions).toBe(1);
  expect(z.freeze).toBe(z.otherFreeze);
  expect(z.freeze).toBeGreaterThan(0);
});

it('连发队列未出膛时不能移植，完成后恢复，失败不扣次数', () => {
  const e = new Engine(8, []);
  const p = e.addPlant('repeater', 2, 1); p.timer = 100;
  e.spawn('bucket', 2, 4);
  e.shoot(p, e.zombies[0], 20, undefined, { delay: .15 });
  e.selectTool(); e.toolSource = p.uid;
  expect(e.toolTargetReason(1, 1)).toContain('连发');
  expect(e.toolUses).toBe(3);
  for (let i = 0; i < 12; i++) e.step(1 / 60);
  expect(e.toolTargetReason(1, 1)).toBe('');
});

it('存档同时保留已购槽位和教学记录，旧版本不丢进度', () => {
  const save = validateSave({ ...initial(), unlocked: 42, completed: Array.from({ length: 41 }, (_, i) => i + 1), coins: 678, seedSlots: 2, tutorialSeen: ['ice-electric'] });
  expect(save).toMatchObject({ unlocked: 42, coins: 678, seedSlots: 2, tutorialSeen: ['ice-electric'] });
  const { seedSlots, tutorialSeen, ...old } = save;
  expect(validateSave(old)).toMatchObject({ unlocked: 42, coins: 678, seedSlots: 0, tutorialSeen: [] });
});
