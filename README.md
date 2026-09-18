# 庭院保卫战

基于 Vue 3、TypeScript、Vite、Phaser 3 的中文卡通塔防游戏。前端是纯静态网页，游戏状态默认保存在玩家浏览器；可选启用自带的零依赖 Node 后端，用文件存储实现 1~5 个账号的登录与云存档。

## 运行

需要 Node.js 22.12+（已在本机 Node.js 26 上构建验证）。

```sh
npm ci
npm run dev
```

生产构建与本地预览：

```sh
npm test
npm run build
npm run preview
```

将 `dist/` 中的文件部署到静态站点即可，不启用账号时服务器不需要 Node.js。`deploy/nginx.conf` 是可调整的 Nginx 配置示例。

### 可选：账号与云存档

不登录时游戏完全离线，存档仍只在本机；登录后进度随账号保存到服务器，可跨设备继续。

- 后端位于 `server/`，只用 Node 内置模块，无需安装任何依赖，也不用数据库：账号写入 `users.json`，每人一份 `saves/<id>.json`，会话密钥为 `secret.key`。
- 本地启动：`DATA_DIR=./data PORT=8787 node server/index.mjs`。Vite 开发服务器已配置 `/api` 代理，`npm run dev` 即可前后端联调。
- 接口：`POST /api/auth/register|login|logout`、`GET /api/me`、`GET|PUT /api/save`、`GET /api/health`。密码用 scrypt 哈希，会话为带版本号的 HMAC 签名 Cookie（`HttpOnly; SameSite=Lax`，30 天）；登出会递增会话版本，使旧 Cookie 立即失效。写操作校验同源 Origin。
- 默认最多 5 个账号，可用环境变量 `MAX_USERS` 调整。通过 HTTPS 访问时给后端加上 `COOKIE_SECURE=1`；纯 HTTP 局域网访问保持不设置，否则浏览器不会保存登录 Cookie。
- 限流默认按 TCP 来源地址计数，无法用伪造的 `X-Forwarded-For` 绕过。仅当后端只被受信反代访问、且端口不对局域网发布时，才设置 `TRUST_PROXY=1` 并信任 Nginx 覆盖写的 `X-Real-IP`。全部变量见 `.env.example`。

#### 示例：部署到Docker

Nginx 以容器运行，后端 `garden-api` 单独一个容器；两者加入同一个 docker 网络 `garden-net`，Nginx 把 `/api/` 反代到 `http://garden-api:8787`，**不把 8787 发布到宿主机**。

1. 在 Mac 上执行一键脚本（通过 `~/.ssh/config` 的 `fnos` 别名连接，脚本顶部可改路径）：

   ```sh
   ./deploy/deploy-garden.sh
   ```

   它会：上传 `server/*.mjs` 到 `/vol1/1000/Docker/garden-server/`，在 NAS 上以 `admin(1000:1001)` 身份启动 `garden-api`，并在 `nginx -t` 校验通过后重载 Nginx。

2. 也可在 Docker 上单独执行启动脚本：

   ```sh
   ssh -t fnos 'bash /vol1/1000/Docker/garden-server/remote-garden-setup.sh'
   ```

3. Nginx 的游戏站点只需加一段反代（模板见 `deploy/nginx-garden-api.conf`）：

   ```nginx
   location /api/ {
       proxy_pass http://garden-api:8787;
       proxy_http_version 1.1;
       proxy_set_header Host              $host;
       # 覆盖而不是追加，防止客户端伪造 XFF 前缀绕过限流
       proxy_set_header X-Real-IP         $remote_addr;
       proxy_set_header X-Forwarded-For   $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

4. 验证：`curl http://192.168.199.5:5888/api/health` 应返回 `{"ok":true,"users":0,"maxUsers":5}`。部署脚本会在反代缺失或目标不是 `garden-api:8787` 时直接失败，健康检查失败也会以非零码退出。

> **从旧拓扑（宿主机端口 8787）升级**：在 NAS 上执行一次
> `sudo bash /vol1/1000/Docker/garden-server/migrate-garden-net.sh`。
> 脚本幂等、零停机：先以别名 `garden-api` 起新容器，`nginx -t` 通过并健康检查成功后才移除旧容器；任一步失败会自动恢复旧配置并保留旧容器。
> 由于会话 token 改为带版本号的格式，切换后旧登录 Cookie 会失效，玩家需重新登录一次。

**数据与备份**：账号、存档与 `secret.key` 都在 `/vol1/1000/Docker/Data/garden/`（容器内 `/data/garden`，属主为 `admin`）。备份命令：

```sh
ssh fnos 'tar czf /vol1/1000/Docker/Data/garden-backup-$(date +%F).tar.gz -C /vol1/1000/Docker/Data garden'
```

**清空重来**：`ssh -t fnos 'bash /vol1/1000/Docker/garden-server/reset-garden-data.sh'`。服务把用户表缓存在内存，手动删除文件后必须重启容器才会生效。

**忘记密码**：暂无找回流程。删除对应用户的 `saves/<id>.json`，从 `users.json` 移除该条，重启容器后让对方重新注册。

`deploy/docker-compose.garden.yml` 提供等价的 compose 写法（外部网络 `garden-net`、以 `1000:1001` 运行），便于并入现有编排；`deploy/nginx.conf` 是纯静态部署示例，含安全响应头与区分哈希/固定名素材的缓存策略。

## 操作

- 选卡后进入关卡，先点种子，再点格子种植。
- 点击阳光收集；点击铲子后移除植物。
- 数字键 1～9 选择种子，S 切换铲子，Esc 取消选择，空格暂停。
- 切到后台自动暂停。全屏战斗时种子栏浮在棋盘左侧留白、进度与计时压成顶部细条（暂停时才显示“休息一下”）；手机竖屏会给出旋转引导（可跳过），iPhone 可用“添加到主屏幕”进入无地址栏的独立窗口。
- 传送带免费种植；保龄球中坚果滚动攻击；砸罐子直接点击罐子；打僵尸关直接点击僵尸。
- 玉米加农炮就绪后点击炮，再点击目标格发射。
- 僵王火球用寒冰菇清除，冰球用同一行的火爆辣椒清除。

## 当前完成度与边界

这是可运行的首版实现，**还不是完成逐关校准的忠实大型复刻**。

已实现：卡通主页、五种战场、选卡、50 张植物卡与 26 类僵尸图鉴、50 个关卡入口、规则引擎、主要特殊能力、冒险特殊关卡的简化实现、首领机制、音效、进度解锁与存档导入导出。

与原版仍有明显差异：

- 波次是按章节与难度生成的配置，不是逐关复原原版出怪表；时间、数值和首领战经过简化。
- 运行素材已转换为 WebP：50 种植物（其中 49 种带独立动作图集）、26 种僵尸和 16 张特效；部分角色使用独立序列，其余采用分层程序动画，仍非全部逐帧手绘动画。
- 多发/连发与黄油已按真实单颗弹丸结算（每颗 20 伤害、黄油发射前确定）；杨桃为五向固定星星，投掷弹道仍为简化机制；原版个别细节仍需逐项对照。
- 原版商店植物在首次通关后统一开放，卡槽按章节扩展；已有简易庭院道具商店；尚无独立小游戏、生存、解谜和花园。
- 雪人图鉴和行为已定义，并已加入重玩关卡的出怪流程（约两成概率、每次重玩由 (种子, 重玩次数) 确定性掷签）。
- 没有战局中途存档。账号与云存档为可选的简单实现：密码经 scrypt 哈希、会话用签名 Cookie；但存档内容仍由客户端产生，不做防作弊与成绩校验，也不支持邮箱找回密码。

## 验证记录

- 规则测试覆盖资源、冷却、暂停、护甲、水路、屋顶、蘑菇唤醒、跳跃、扶梯、爆炸、传送带、模仿者和存档校验。
- 后端测试 `server/index.test.mjs` 覆盖注册、密码校验、未登录 401、登出撤销会话、乐观并发、跨站写拒绝、限流与 `MAX_USERS` 上限；前端新增云存档合并与导入校验测试。精灵切图的两张源图已纳入版本库（见 `.gitignore`），`npm test` 的通过数在干净克隆 / CI 上可复现（当前 591 项）。
- 真实浏览器验证注册后自动上传存档、顶栏显示同步状态与退出登录；NAS 上经 Nginx 实测 `/api/health`、注册、存档读写与 Cookie 下发。
- 50 个关卡使用固定种子和自动玩家跑到结算，检查无卡死和非法资源；胜负取决于自动策略与当前难度。此检查**不代表全部关卡已经通过人工通关验收**。
- Chromium 实测素材加载、开局、点击种植和暂停界面；桌面及手机横屏截图在 `output/playwright/`。
- 移动端布局按 iPhone 16 Pro Max（440×956 / 956×440）、iPad 11"、Android 与桌面设备矩阵复测：横屏战场铺满可视高度（iPhone 无地址栏时画布 765×440，原先 593×341），竖屏手机显示旋转引导，浮层下点击种植仍命中棋盘；截图见 `output/playwright/v2-*.png`。
- 尚未完成 Safari、真机触控性能和全关卡人工平衡验收。

## 结构

- `src/game/content.ts`：植物、僵尸、场景、关卡数据。
- `src/game/engine.ts`：独立于渲染的确定性规则引擎。
- `src/game/scene.ts`：Phaser 按需加载与渲染配置。
- `src/game/scene-class.ts`：素材、绘制、输入、纹理缓存与固定步长循环。
- `src/game/art.ts`：本地 WebP 素材路径。
- `src/game/difficulty.ts`：难度、时长与分阶段波次。
- `src/game/audio.ts`：Web Audio 合成音效、并发限制与音量。
- `src/game/animation.ts`、`layout.ts`：动画帧和统一战场坐标。
- `assets-source/`、`scripts/prepare-assets.mjs`：生成图源与 PNG 裁切流程。
- `src/store.ts`：Pinia 与带校验的 localStorage 存档，登录后叠加防抖云同步。
- `src/auth.ts`、`src/api.ts`：登录态与后端接口封装。
- `src/App.vue`：菜单、选卡、图鉴、设置、HUD 与结算。
- `server/`：零依赖 Node 后端，文件存储的账号、会话与存档接口。
- `deploy/deploy-garden.sh`、`remote-garden-setup.sh`、`reset-garden-data.sh`：飞牛 NAS 的上传发布、启动容器与清空数据脚本。

存档键为 `pvz-garden-save-v1`，版本 2，兼容迁移版本 1。导入只接受连续、合法的关卡进度，失败不会覆盖当前数据。清理站点数据、更换浏览器、域名或端口会影响存档访问，应提前导出 JSON 备份。登录或会话恢复后会先取云端并做**进度并集合并**（关卡进度/金币/成就/星级等取并集，绝不丢关卡进度），再用**服务端修订号**做乐观并发写入：冲突时合并后重传，不再用客户端时钟对账。设置页仍提供手动"上传/下载覆盖"按钮。

## 本次升级

- 选卡页支持休闲、标准、困难、自定义。普通关卡前中期目标 8～12 分钟，后期 12～15 分钟；实际通关时间包含清场，失败可以提前结束。特殊玩法使用独立节奏。
- 自定义支持 5～30 分钟、出怪密度、生命、速度、初始阳光、准备时间与割草机；自定义胜利记录成绩，不解锁冒险进度。不同难度成绩分别标记保存。
- 植物发射、僵尸啃咬／低吼／死亡、护甲命中、冰冻、爆炸、种植和收集均有合成音效。设置中可以试听、调音量、关闭震动和调整特效档位。仍无录制配音；已有程序合成的背景音乐和环境层。
- 僵尸显示生命和护甲条，护甲破损、冻结、行走、啃咬与跳跃有视觉反馈。爆炸、火焰、冰冻、烟尘和收集使用 PNG 特效。
- Chromium 验证 PNG 加载、生命条、泳池对齐、爆炸／冰冻、动画帧和 Web Audio 输出；音频分析器测得非零波形。
- 运行 `node scripts/prepare-assets.mjs` 可从本地图源重建素材。生成图片来自本次图像生成工具，非原版游戏资源提取。

新增难度仍需实际试玩校准，尚未逐关人工通关。

## 体验优化计划

逐项执行状态见本地文档 `docs/optimization-plan.md`（未纳入版本库）。本批增加战斗逻辑修复、连续选卡、纯战斗全屏、普通、路障、铁桶、巨人、撑杆和食人花 PNG 动作序列、连续动作过渡和分组混音；其他角色的专属动画仍在计划中。

本批进一步加入特殊角色体型分级，以及重装护甲、耐久植物和敏捷僵尸的属性调整。巨人挥棒、抛小鬼和食人花咬合按动作阶段结算；详细数值与验证边界见优化计划。

移动端最大化：战斗沉浸布局改为“战场铺满 + 种子栏/状态栏浮层”，加入竖屏旋转引导、横竖屏与地址栏收放后的画布重算，以及 PWA manifest 与 iOS 独立窗口 meta（`scripts/prepare-icons.mjs` 生成主屏幕图标）。进入竖屏引导时会自动暂停战斗，避免看不见棋盘时继续掉血；每次开战会重置“竖屏也要玩”的跳过状态。

## 持续集成与校验

- `.github/workflows/ci.yml` 在 Node 22 上执行 `npm ci` → `npm test` → `npm run verify:assets` → `npm run build`。
- `npm run verify:assets` 对缺失/空图/尺寸/贴边等**阻断性问题**以非零码退出；`npm run verify:assets:strict` 连"脚底偏移 >8px"等提示也视为失败。

## 声明与许可

本项目是非官方个人作品，与 PopCap / EA 无关；“植物大战僵尸”相关名称、角色与商标归其权利人所有。源代码以 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权：允许非商业使用、修改与分发，**禁止商业使用**。详见 [NOTICE.md](NOTICE.md)。
