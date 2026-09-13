# 玩法调研与实现差异

调研日期：2026-09-13。参照经典初代，不采用二代升级数值或重制版独有模式。

| 资料                                                                                                     | 用途                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [EA 官方说明](https://akamai.cdn.ea.com/eadownloads/u/f/manuals/GAME-PVZ/en_US_readme.html)              | 模式、场地、图鉴、商店与基本操作 |
| [冒险攻略](https://strategywiki.org/wiki/Plants_vs._Zombies/Walkthrough)                                 | 50 关结构、场地与特殊关卡        |
| [植物图鉴](https://strategywiki.org/wiki/Plants_vs._Zombies/Plants)                                      | 49 种植物、功能与升级关系        |
| [植物条目](https://plantsvszombies.wiki.gg/wiki/Plants_%28PvZ%29)                                        | 产阳光、防守、减速与辅助能力     |
| [Phaser 官方 Vite + TypeScript 模板说明](https://phaser.io/news/2024/01/phaser-vite-typescript-template) | 工程技术方案                     |

部分社区页面正文返回 403，能获取搜索摘要但不能声称已逐项核对全部参数。当前实现数值需继续与可访问图鉴/原版实测比对。

## 场地规则

- 白天：自然阳光、基础分行防御。
- 夜间：不掉落自然阳光，蘑菇清醒，墓碑阻挡种植并可能出怪。
- 泳池：六行，中间两行水路；陆生植物需睡莲。
- 浓雾：夜间泳池，路灯照明、三叶草驱散。
- 屋顶：花盆、坡度、抛射攻击；最后一关首领。

## 当前实现差异

参数集中在 content.ts 与 engine.ts，当前以可玩原型为目标。原版精确波次、动画节奏、全体能力交互及难度尚未完成逐关比对。README 中列明未完成项，不把 50 个入口计为 50 关忠实复刻验收。
