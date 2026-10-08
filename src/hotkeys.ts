/**
 * 战斗卡槽与数字键的唯一映射来源：卡面显示的编号就是按下去生效的键，
 * 避免「徽标算式」和「键盘处理算式」各写一份而漂移。
 */
/** 卡槽序号 → 键位标签：0..8 → "1".."9"，9 → "0"（第 10 张，卡槽上限是 10）。 */
export const seedHotkeyLabel = (index: number) => String((index + 1) % 10);
/** 数字键 → 卡槽序号；不是 0-9 返回 -1。 */
export const seedHotkeyIndex = (key: string) =>
  /^[0-9]$/.test(key) ? (key === "0" ? 9 : Number(key) - 1) : -1;
