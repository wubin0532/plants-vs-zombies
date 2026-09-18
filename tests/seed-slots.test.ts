import { expect, it } from "vitest";
import {
  BASE_SEED_SLOTS,
  MAX_SEED_SLOTS,
  MAX_SEED_SLOT_PURCHASES,
  seedSlotPriceFor,
  totalSeedSlots,
} from "../src/store";

it("卡槽只由商店扩容决定：基础 6、上限 10，不再随章节免费增加", () => {
  expect(BASE_SEED_SLOTS).toBe(6);
  expect(MAX_SEED_SLOTS).toBe(10);
  expect(MAX_SEED_SLOT_PURCHASES).toBe(4);
  expect(totalSeedSlots(0)).toBe(6);
  expect(totalSeedSlots(1)).toBe(7);
  expect(totalSeedSlots(4)).toBe(10);
  // 旧存档可能存着更多次数，超过上限要截断而不是继续放大。
  expect(totalSeedSlots(9)).toBe(10);
  expect(totalSeedSlots(-3)).toBe(6);
});

it("扩容价格逐级递增，第 4 次后满级价格保持", () => {
  const prices = [0, 1, 2, 3].map((n) => seedSlotPriceFor(n));
  expect(prices).toEqual([600, 1400, 2800, 4800]);
  for (let i = 1; i < prices.length; i++)
    expect(prices[i]).toBeGreaterThan(prices[i - 1]);
  expect(seedSlotPriceFor(4)).toBe(4800);
  expect(seedSlotPriceFor(99)).toBe(4800);
});
