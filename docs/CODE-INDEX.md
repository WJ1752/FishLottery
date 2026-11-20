# 深海鱼市 · 代码索引（AI 协作速查）

> 目的：让人（或 AI）在 30 秒内定位「某个规则 / 接口 / 数字写在哪」，避免全文乱读。
> 阅读顺序建议：先看 §1 心智模型，再按 §2 的「我要改 X → 去哪」定位，然后才打开具体文件。
> README.md 面向部署与玩家规则；本文件面向**改代码**。
> 实测基线：`npm test` = 203 个用例全过（Node v24.21.0，约 9 秒）。

---

## 1. 心智模型（必须记住的 6 条）

1. **`src/game.js` 是唯一的规则源**。服务端 `server/actions.js` 和测试都 `import` 同一份纯函数；
   前端只复用它里面的常量与**展示用**纯函数（`fxBoard`、`depthsFor`、`upgradeCostAt`…）。
   → **改平衡数值、算法、随机、奖励表，只改 `src/game.js`**，不要在后端另写一套。
2. **玩家态 = 一份带版本号的 JSON 快照**（`players.state`），配 `players.version` 做乐观并发。
   除了 `data/app.db` 里的账号/会话/行情/开奖，其余全在这份 JSON 里。
3. **全服行情不进玩家快照**：`fx_days` / `fx_bucket` / `fx_bucket_bins` / `fx_day_bins`。
   读时用 `mergeFxWorld()` 注入，写前用 `extractPlayerState()` 剥离（`src/game.js:2394-2410`）。
4. **服务端权威**：客户端只能发「意图」（`POST /api/action`，白名单 27 个动作，见 §11）和两个瞬时输入
   （刮开比例、助推开关）。所有 RNG 都走服务端 `cryptoRandom()`（`server/lib/rng.js`）。
5. **冲突分两层**：跨日/跨批次的「世界」变化靠定时器 + 懒结算（`startJobs`、`settleWorld`）；
   同一玩家的并发靠**进程内 Promise 锁**（`withPlayerLock`），单实例部署足够。
6. **零运行时依赖**：没有 express、没有 nodemailer、没有原生模块（Windows 上不跑 node-gyp）。
   路由自己写（`server/router.js`），SMTP 自己写（`server/services/mail.js`），DB 用内置 `node:sqlite`。
   `devDependencies` 里的 react/vite 等只在构建期使用。

---

## 2. 「我要改 X → 去哪」（最高频索引）

| 需求 | 位置 |
| --- | --- |
| 鱼类抽取概率 / 词条 / 海域参数 | `src/traits.js`（`TRAITS`、`FISH_POOLS`、`tensionAt`）、`src/game.js:68` `DEPTHS` |
| 钓鱼推进、咬钩、张力判定、脱钩 | `src/game.js` `rollBite`(2494) / `resolveBite`(2609) / `advanceFishing`(2759) |
| 彩票号码范围、奖励表、兑奖 | `src/game.js` `NORMAL/ADVANCED/MASTER_PRIZE_TABLE`(150-180)、`drawPoolNumbers`(2968)、`rewardFor`(3040)、`claimAll`(3048) |
| 彩票开奖时间/批次/期号 | `server/services/lottery.js`（UTC 6 小时批次）+ `server/index.js:32` 定时器 |
| 刮刮乐卡面生成、结算、刮开阈值 | `src/game.js` `makeScratchCard`(1992)、`scratchSettlement`(3106)、`drawScratchFace`(3146)、`scratchThreshold`(3241) |
| 深海 FX 报价/成交/手续费 | `src/game.js` `fxQuote`(1204)、`fxBuy`(1299)、`fxSell`(1324)、`fxDayMove`(658) |
| FX 原始流水 → 价格的第一道闸门 | `src/game.js` `fxTradeBins`（只删连续 15 分钟无流水的片段，短暂冷场保留）；`mergeFxBins` 合并后再过滤；`fxSessionFlows` 内还有最后一道防御 |
| FX 日内路径形状（波动项 / 振幅封顶） | `src/game.js` `fxMinutePath`：振幅 = min(波动系数 × 成交活跃度 × 0.5, 往返成本 × 0.35)，用 `fxBridge` 叠加摆动 |
| FX 日线结算与持久化 | `src/game.js` `settleFxDays`(1121) ← 纯函数；`server/services/market.js` `settleWorld/appendFlow` 负责读写库 |
| 后台「昨日影响 / 今日结算预览」 | `src/game.js` `fxSettlementPreview`(1496) + `fxDayBar`(1090)（与结算共用同一段 OHLC）；`server/routes/admin.js` `GET /api/admin/fx/preview`；`src/admin.jsx` `FxSettlementAdmin`(845) / `FxPerSymbolCharts` |
| 行情快照（服务端算好，客户端只画） | `server/services/fx-snapshot.js` `buildFxSnapshot` / `buildFxCandles`；接口 `GET /api/fx`、`GET /api/fx/candles`。**`withForecast` 只在管理端接口传 true**：预测段是未来价格路径，玩家侧永不下发 |
| K 线档位与解锁 | `src/fx-grains.js`（档位定义 + 蜡烛编解码，无算法）；黑市商品 kind=`grain`，id=`grain-m30` / `grain-m15` |
| K 线图 / 原始流水柱状图（玩家页与后台共用） | `src/fx-chart.jsx`（只画）：`FxCandles`（可缩放 + 历史/预测虚线分界）、`FxFlowBars`（288 格资金流）；序列构造在 `src/fx-series.js`（纯函数，可单测）：`fxCandleSeries`、`fxMinuteSeries`、`fxPredictionSeries`、`fxGrainLabel`、`FX_GRAINS` |
| FX 分钟线 / K 线聚合 | `src/game.js` `fxMinutePath`(807)、`fxAggregateMinutes`(959)、`fxHistory`(1057) |
| 无灯黑市（收购/超级刮/商店） | `src/game.js:3385-4510`（大段集中）+ 设计稿 `docs/black-market-design.md` |
| 天赋数值 / 轨道 / 升级花费 | `src/game.js` `DEFAULT_TRACKS`(394)、`trackValue`(3192)、`talentCostAt`(4640) |
| 钓竿耐久 / 强化 / 自动维修 | `src/game.js` `RODS`(109)、`repairRod`(4575)、`upgradeRod`(4601)、`autoRepairRod`(4694) |
| 离线收益追算（封顶 12h、按自然日分段） | `server/services/players.js:66` `catchUp` |
| 「什么算经济状态变了」（决定是否下发整份 me） | `server/services/players.js:113` `economySignature` |
| 新增一个玩家动作 | ①`src/game.js` 写纯函数 ②`server/actions.js` `ACTIONS` 加白名单 + 参数校验 ③前端 `send('xxx', params)` |
| 新增一个 HTTP 接口 | 对应 `server/routes/*.js` 里 `router.get/post(...)`；鉴权用 `requireAdmin` / `ctx.auth` |
| 全服可调配置（后台改数值） | 定义在 `src/game.js:180` `DEFAULT_CONFIG`；归一化 `normalizeConfig`(1635)；读写 `server/services/config.js` |
| 登录 / 2FA / 会话 | `server/services/auth.js` + `server/lib/totp.js` + `server/lib/passwords.js` |
| 邮箱验证 / 邮件投递 | `server/services/verify.js` + `server/services/mail.js`（手写 SMTP） |
| 重置进度（密码+邮箱码两步） | `server/services/reset.js` + `src/main.jsx` `ResetSection`(1817) |
| 管理后台页面 | `src/admin.jsx`（各 `*Admin` 组件对应一类配置） |
| 主题 / 配色 / 布局 | `src/styles.css`（924 行）+ `src/game.js` `THEMES`(48) |

---

## 3. 目录与文件职责

```
src/                     前端（React，无路由库，靠 activeTab 切换）
  game.js       4755 行   ★ 领域规则唯一源：纯函数、配置默认值、快照结构、黑市
  traits.js      247     词条 / 鱼种 / 张力曲线 / 稀有度 / 组合概率
  main.jsx      2099      游戏壳：AuthGate → GameApp（1s 轮询 + 各页面组件按 activeTab 挂载）
  admin.jsx     1074      管理后台各分区（奖池/钓竿/天赋/词条/海域/商会/黑市/FX）
  fx-chart.jsx   200      ★ 深海FX 图表渲染：K 线（可缩放 + 历史/预测虚线分界）、原始流水柱状图
  fx-series.js   230      ★ 深海FX 蜡烛序列构造（纯函数）：日K/周K/分钟聚合、预测段切分，玩家页与后台共用
  auth.jsx       217      登录 / 注册 / TOTP 绑定 / step-up
  api.js          85      浏览器 → 服务端唯一通道（含 requestId 幂等、401 处理）
  styles.css     924      全部样式与主题变量
server/                  后端（Node 原生 http/https，无框架）
  index.js       106      读环境变量、起 HTTPS、定时任务、优雅退出
  app.js         164      安全头/CSP、限流、CSRF、静态文件与 SPA fallback、错误映射
  router.js       40      极简 :param 路由，自带 405 推断
  actions.js     186      ★ 动作白名单 + 参数校验 + 领域函数调用 + 错误码翻译
  http-util.js   134      HttpError、JSON 读取（256KB 上限）、响应、静态文件
  db/index.js     67      openDatabase（跑 schema.sql）、get/all/run/transaction、meta
  db/schema.sql  175      全部表结构（幂等 CREATE）
  routes/                HTTP 层：auth.js / game.js / admin.js
  services/              业务编排：auth、config、lottery、market、players、verify、reset、mail
  lib/                   基础设施：clock、logger、passwords、rng、tls、totp
scripts/                 CLI：admin、gen-cert、rebuild-db、fx-sim、mail-check、smtp-selftest、windows-service.ps1
test/                    203 个用例：game（领域）、fx（行情）、fx-snapshot（快照/档位）、frontend（前端引用）、black-market（黑市）、server（HTTP 集成）
docs/                    black-market-design.md（黑市设计稿）+ 本文件
data/ certs/ dist/       运行时产物，勿手改
```

### 3.1 依赖方向（禁止反向）

```
src/traits.js  ←  src/game.js  ←  server/actions.js, server/services/*, test/*, src/main.jsx(只读展示)
                   ▲
        server 永远不 import src/main.jsx 或 src/admin.jsx
```

- `server/*` 可以 import `src/game.js` / `src/traits.js`（纯 ESM、无 DOM 依赖）。
- 新增规则时若发现要写进 `server/`，先问：能不能放进 `game.js`？能就别放 server。

---

## 4. 请求生命周期（读代码时对照用）

```
浏览器
 └ api.js           带上 X-Requested-With: fetch + Cookie(fl_sid)
   └ server/app.js  createApp()
      ├ 非 /api/* → dist 静态文件 → SPA fallback index.html
      ├ 安全头 SECURITY_HEADERS + HSTS(可选)
      ├ generalLimiter 120 req/s/IP → 429
      ├ router.match() → 404 / 405
      ├ 写方法：checkCsrf() → /api/action 另有 20 req/s/IP
      ├ readJson → parseCookies → readSession(db, token)
      ├ ctx = { db, req, res, url, query, params, body, ip, auth, config }
      └ await handler(ctx) → { status, body, headers } 或抛 HttpError
          └ routes/game.js → withPlayerLock → syncPlayerLocked → applyAction → savePlayer
```

关键约定：handler 返回 `{ status, body }`；业务失败抛 `HttpError(status, code, message)`
→ 前端 `ApiError.message` 直接显示中文。`/api/action` 返回 409 `NO_EFFECT` 表示「条件不满足」。

### 4.1 三条读写路径

| 接口 | 频率 | 语义 |
| --- | --- | --- |
| `GET /api/bootstrap` | 登录 / 配置变更 | 全量：user、me、config、fx、lottery |
| `GET /api/sync?v=&d=&boost=` | **每秒** | 轻量：只回 `fishing` 时间态；`changed` 时才带整份 `me`；`daysVersion` 变了才带 `fx` |
| `POST /api/action` | 玩家操作 | 幂等（`requestId` 10 分钟缓存）；返回新 `me` + `meVersion` |

**改同步协议的注意点**：`economySignature()`（players.js:113）决定 `changed`。
如果新增的经济字段不进签名，前端就拿不到更新；反过来把每秒变化的字段放进签名会造成每秒下发整份存档。

---

## 5. 领域层 `src/game.js` 分区地图

按行号顺序（文件很长，先看分区再跳转）：

| 行号 | 区块 | 代表导出 |
| --- | --- | --- |
| 1-108 | 常量：能量/版本/主题/海域/起始竿 | `STATE_VERSION=12`、`DEPTHS`、`STARTING_DEPTHS` |
| 109-180 | 钓竿、材料、奖池表、`DEFAULT_CONFIG` | `RODS`、`MATERIALS`、`DEFAULT_CONFIG` |
| 366-490 | 配置归一化：张力、刮刮乐奖池、天赋轨道、词条权重 | `normalizeConfig`、`normalizeTalentTrack`、`traitWeightFor` |
| 491-1005 | **深海 FX**：配置、交易日、时段、报价、分钟线、K线聚合 | `fxDayIndex/Start/Close`、`fxSession`、`fxQuote`、`fxMinutePath`、`fxAggregateMinutes` |
| 1006-1490 | FX 日线紧凑存储、结算、供需流水、持仓、看板 | `encodeBar`、`settleFxDays`、`fxBiteFlow`/`fxExchangeFlow`、`fxBoard` |
| 1500-1960 | 黑市配置归一化 + 通用查询（价格分档、报价、竿数值、配置应用） | `normalizeBlackMarketConfig`、`applyConfig`、`fishQuotePrice` |
| 1943-2410 | 刮刮乐发卡、初始状态、快照分离 | `makeScratchCard`、`createInitialState`、`mergeFxWorld`、`extractPlayerState` |
| 2416-2915 | **钓鱼循环**：解锁海域、咬钩、张力、推进、启停 | `rollBite`、`resolveBite`、`advanceFishing`、`toggleFishing` |
| 2916-3105 | 彩票：合成/号码/开奖结算/兑奖 | `chooseLotteryBatch`、`drawPoolNumbers`、`applyDrawNumbers`、`claimAll` |
| 3106-3382 | 刮刮乐：结算、刮开、兑奖、丢弃 | `scratchSettlement`、`revealScratch`、`claimAllScratch` |
| 3385-4510 | **无灯黑市**（最密集的一块） | `blackSellFish`、`blackBuy`、`blackSuperPlan/Reveal`、`scratchPoolStats` |
| 4512-4755 | 鱼兑换、钓竿维修/强化、天赋升级、自动维修、装备 | `exchangeFishBatchByFilter`、`upgradeRod`、`upgradeTalent` |

**修改约定**
- 函数签名几乎都是 `(state, ...args, now = Date.now(), random = Math.random)` → 注入时钟与 RNG，便于测试。
- 返回**同一个 state 引用**表示「没生效」（余额不足等），`applyAction` 据此回 409；不要抛异常表示业务失败。
- 返回新对象时必须保持不可变更新（展开而非就地改），否则 `me` 的引用比较会失效。

---

## 6. 服务端 services 速查

| 文件 | 关键导出 | 什么时候读它 |
| --- | --- | --- |
| `services/auth.js` | `startLogin`、`completeTotpLogin`、`readSession`、`requireAdmin`、`stepUp`、`changePassword`、`publicUser` | 登录、2FA、权限、会话续期 |
| `services/config.js` | `getConfig(db)` → `{config, version}`、`saveConfig` | 后台保存配置 / 玩家懒应用配置 |
| `services/players.js` | `withPlayerLock`、`loadPlayer`、`savePlayer`、`catchUp`、`syncPlayer`/`syncPlayerLocked`、`settlePlayerDraws`、`fishingTick` | 存档读写、离线追算、同步协议 |
| `services/market.js` | `readWorld`、`settleWorld`、`appendFlow`、`diffFlows`、`readDayBins`、`compactWorld`、`daysVersion`、`resetWorld` | FX 全服表的一切读写 |
| `services/lottery.js` | `drawBatch`、`backfillDraws`、`dueBatches`、`currentBatchInfo`、`recentDraws`、`registerBatch` | 开奖定时逻辑、期号 |
| `services/verify.js` | `requestEmailVerification`、`confirmEmailVerification`、`maskEmail` | 邮箱绑定（验证后锁定，不可解绑） |
| `services/reset.js` | `requestProgressReset`、`confirmProgressReset` | 重置进度两步验证 |
| `services/mail.js` | `sendMail`、`mailConfigFromEnv`、`verificationMail`、`resetProgressMail` | SMTP 手写实现（465 隐式 TLS / 587 STARTTLS） |

**lib**
- `lib/clock.js`：`now()` 可被 `setClock()` 注入 → **写测试时用它穿越时间，别用假 setTimeout**。
- `lib/rng.js`：`cryptoRandom`（返回 [0,1) 的均匀分布）/ `randomId` / `randomToken`。
- `lib/totp.js`：RFC 6238（SHA-1/30s/6 位，±1 步），`verifyTotp` 返回命中步长用于防重放。
- `lib/passwords.js`：scrypt N=2^15,r=8,p=1，`timingSafeEqual` 比较；`hashToken` 用于会话/验证码哈希。
- `lib/tls.js`：自签名证书生成，SAN 覆盖 localhost + 本机局域网 IPv4。

---

## 7. 数据模型地图（`server/db/schema.sql`）

| 表 | 作用 | 注意 |
| --- | --- | --- |
| `users` | 账号、角色、邮箱、TOTP | `username_key` 小写唯一；`idx_users_email_verified` 是**部分唯一索引**（仅已验证邮箱唯一） |
| `sessions` | 会话，`id` = token 的 SHA-256 | `mfa_at` 决定管理后台 12 小时门禁；滑动续期 |
| `login_challenges` | 密码已过、等 TOTP 的临时挑战（5 分钟） | |
| `recovery_codes` | 8 个一次性恢复码（只存哈希） | |
| `email_tokens` / `reset_tokens` | 两类验证码分开存 | 两者不可互相顶替 |
| `players` | **玩家 JSON 快照** + `version` | 不含 `fx.days/today/bins` |
| `world_config` | 全服配置单行（id=1）+ version | 重建库时保留 |
| `fx_days` | 每天一根全服日线（OHLC/net/volume） | 主键 `(symbol, day)`，symbol = 词条 id |
| `fx_bucket` | 今日待结算桶 | 零点结算成日线 |
| `fx_bucket_bins` / `fx_day_bins` | 5 分钟成交时间桶（288 格/天，落库带 `{ms,v}` 格宽标记） | 供日内 K 线按真实成交时间回放，保留 30 天；旧 15 分钟槽位读取时按比例换算 |
| `lottery_batches` / `lottery_draws` | 批次登记 / 号码 | `(batch_id, type_id)` 主键，开奖幂等 |
| `action_log` | `requestId` → 响应 JSON | 幂等回放，10 分钟 TTL |
| `admin_audit` | 后台操作审计 | |
| `meta` | 键值（`fxDaysVersion`、`lotteryIssueOrigin`…） | 版本号变更驱动前端重新拉行情 |

---

## 8. 时间与结算模型

- **默认时区语义**：服务器本地时间。交易日 = 本地零点切分，08:00 开市 / 24:00 收市。
- **FX**：盘中每分钟动价（U 型释放曲线 + 桥接扰动，`fxMinutePath` 是**确定性**函数 → 刷新后同图）。
  当天先进 `fx_bucket`，零点 `settleWorld` 结算成 `fx_days` 一行。
- **彩票**：UTC 6 小时批次（00/06/12/18）。号码只在服务端生成一次；玩家在下次 `sync` 时
  `settlePlayerDraws` 结算。往期由 `backfillDraws` 补齐，期号自 `meta.lotteryIssueOrigin` 起算。
- **离线收益**：`catchUp` 从 `fishing.lastTickAt` 起**按自然日分段**推进，封顶 `OFFLINE_CAP_HOURS`（12h）。
  分段原因：跨零点的 FX 流水必须落到正确的交易日。
- **助推**：只在「上次同步 ≤3 秒前」时才被信任（`ONLINE_SYNC_GAP_MS`），避免用离线整段加速。
- **定时任务**：`startJobs` 每 30 秒一次：开奖 → 补齐往期 → 行情结算 → 刷新 daysVersion

---

## 9. 安全边界（改代码时必须守住的）

- **信任的客户端输入只有三项**：刮刮乐刮开比例（只影响翻牌时机）、助推开关（幅度/半径取自天赋配置）、主题偏好。
- **CSRF**：写请求必须 `X-Requested-With: fetch`，且 `Origin/Referer` 的 host 必须等于 `Host`。
- **Cookie**：`fl_sid; HttpOnly; Secure; SameSite=Strict`，库内只存 SHA-256。
- **限流**：全局 120/s/IP，`/api/action` 20/s/IP；登录失败 10 次/15 分钟；注册 5 个/小时/IP（可 `REGISTER_LIMIT_PER_HOUR` 放宽）。
- **验证码**：6 位数字，只存 `sha256(userId:...:code)`，10 分钟有效、错 5 次作废、60 秒冷却。
- **未刮开的刮刮乐卡面不下发**：`redactScratchFaces()`（game.js:2071）——防止挑高产出卡喂超级刮刮乐。
- **管理后台**：`role=admin` + 12 小时内 2FA → 403 `TOTP_SETUP_REQUIRED` / `MFA_REQUIRED` / `FORBIDDEN` 区分三种门禁。
- **重置进度不走 action**：必须「密码 → 邮箱码」两步，`ACTION_NAMES` 里确认没有 `resetProgress`（有测试守护）。
- **静态文件**：`sendStatic` 校验路径落在 root 内，防 `../` 穿越。

---

## 10. HTTP 接口总表

```
POST /api/auth/register            → 201 { user }                     + Set-Cookie
POST /api/auth/login               → { user } 或 { totpRequired, challengeId }
POST /api/auth/totp                → { user }                         + Set-Cookie
POST /api/auth/logout              → { ok }
GET  /api/auth/me                  → { user|null, mfaActive, serverTime }
POST /api/auth/totp/setup          → { secret, uri }
POST /api/auth/totp/enable         → { recoveryCodes }
POST /api/auth/totp/reset          → 需 admin
POST /api/auth/step-up             → 后台前的 2FA 补验
POST /api/auth/password            → 改密码
POST /api/auth/email/send          → { sent, delivered, email, expiresAt }
POST /api/auth/email/verify        → { email, verifiedAt, user }
POST /api/auth/email/remove        → 409 EMAIL_LOCKED（永远拒绝）
POST /api/auth/progress-reset/send / confirm

GET  /api/bootstrap                → { user, me, meVersion, config, configVersion, fx, daysVersion, lottery, serverTime }
GET  /api/sync?v&d&boost           → { changed, me?, fishing, fx|fxToday, lottery, ... }
POST /api/action                   → { ok, me, meVersion, ... }（409 NO_EFFECT）
GET  /api/fx                       → 行情历史（进 FX 页时单独拉）

GET  /api/admin/overview           → users/stats/online/audit/config
PUT  /api/admin/config             → 保存配置（version+1）
POST /api/admin/users/:id/role     → 改角色（降级会清 2FA 并踢下线；不能自降）
POST /api/admin/users/:id/reset-2fa
POST /api/admin/users/:id/logout   → 强制下线
POST /api/admin/fx/reset           → 清空行情历史
GET  /api/admin/fx/preview         → 昨日影响 + 今日结算预览（逐标的，只读）
POST /api/admin/lottery/draw-now   → 立即开奖当前批次
GET  /api/admin/lottery            → 当前批次号码
```

---

## 11. 动作白名单（`server/actions.js` `ACTIONS`，共 27 个）

> 用 `node -e "import('./server/actions.js').then(m=>console.log(m.ACTION_NAMES))"` 可随时核对最新清单。

| 分类 | 动作 | 前端调用点 |
| --- | --- | --- |
| 钓鱼 | `toggleFishing`、`selectDepth`、`unlockDepth`、`setBoost` | FishingPage / SeaSelectorOverlay |
| 钓具 | `repairRod`、`upgradeRod`、`selectRod` | RodPage / DurabilityDrawer |
| 天赋 | `upgradeTalent` | TalentPage |
| 彩票 | `craftTickets`、`claimTickets` | LotteryPage |
| 刮刮乐 | `revealScratch`、`revealAllScratch`、`claimScratch`、`claimAllScratch`、`discardScratch` | ScratchPage |
| 商会 | `exchangeFish`、`exchangeFishBatch`（`params.filter` 优先） | NpcPage |
| FX | `fxBuy`、`fxSell` | FxPage |
| 设置 | `setTheme`（`void` 主题需黑市购买记录） | SettingsPage |
| 黑市 | `blackAcknowledge`、`blackSellFish`、`blackSellMaterial`、`blackRefreshOrder`、`blackSuperStart`、`blackSuperReveal`、`blackBuy` | BlackBuy/BlackSuper/BlackShop |

黑市错误码 → 中文在 `server/actions.js:34` `BLACK_ERROR_TEXT`。

---

## 12. 前端结构（`src/main.jsx`）

- 无路由库：`activeTab` 状态 + 条件渲染（`main.jsx:301-320`）。`NAV` 定义鱼市 10 页，`BLACK_NAV` 是黑市三页；
  `activeTab` 以 `black-` 开头即进入「黑市模式」，导航整体替换。
- `GameApp` 负责：bootstrap、1 秒 `sync` 轮询、时钟偏移、主题、`send(action, params, notice)` → `api.action`。
- 页面组件都收 `state`(=me) 与 `onAction`，**自己不持有游戏数据**，只做展示和发意图。
- 每秒的钓鱼动画由 `useFrameClock` + `fishingFrame()` 在客户端插值，权威值仍来自 `sync` 的 `fishing` 字段。
- 体量大的页面：`FxPage`(931)、`ScratchPage`(1139)、`ScratchCard`(1274-canvas 刮层)、`BlackSuperPage`(1503)、`AdminPage`(admin.jsx:905)。

---

## 13. 测试地图（`npm test` → `node --test`）

| 文件 | 覆盖 |
| --- | --- |
| `test/game.test.js` (1511) | 彩票/合成/奖励表、升级费用、海域解锁、刮刮乐结算、咬钩与张力、钓竿 |
| `test/fx.test.js` (40) | 报价价差、涨跌停、供需失衡、均值回归、交易日时段、往返亏损、K 线聚合与 5 分钟桶、结算预览与落库一致性 |
| `test/fx-series.test.js` (7) | 蜡烛序列构造：六种粒度的预测切分、预测柱 OHLC 与结算预览一致、无预测数据时不画假分界线 |
| `test/black-market.test.js` (311) | 黑市配置归一化、解锁、日切订单、卖鱼/材料、刷新、商店、卡面保密、超级刮刮乐 |
| `test/server.test.js` (972) | 登录/2FA/会话、CSRF、邮箱验证与锁定、重置两步、离线封顶、共享行情、后台概览、彩票期号 |

写法约定：
- 领域测试直接 `import '../src/game.js'`，用**固定 random 种子**与固定 `now` 保证确定性。
- 服务端测试用 `openDatabase(':memory:')` + `createApp({db})` + `setClock()`，不起真实端口之外的依赖；
  `node --test --test-force-exit` 避免 keep-alive 挂住进程。
- 加规则时同步加测试；`npm test` 应保持 203+ 全绿（改完必跑）。

---

## 14. 常用命令

```bash
npm run dev          # Vite 5173，/api 代理到 https://127.0.0.1:9000（前端热更新）
npm run dev:api      # 单跑后端
npm start            # 生产：node server/index.js（HTTPS 9000）
npm run build        # 前端 → dist/
npm test             # 全部测试
npm run admin -- list|promote|demote|reset-2fa|set-password|disable|enable <username>
npm run db:rebuild   # 停服后重建库，保留 world_config，旧库备份 .bak
npm run cert -- --force
npm run mail:test -- you@qq.com     # SMTP 诊断，打印完整对话
node scripts/fx-sim.js [天数] [每日鱼数]   # 行情模型模拟
```

环境变量见 README §运行，代码入口在 `server/index.js:16` `readEnv()`。

---

## 15. 修改守护清单（提交前自查）

1. 改了规则 → 只动 `src/game.js`，前后端自动一致；确认没有在 `server/` 里复制规则。
2. 新增经济字段 → 加进 `economySignature()`，否则前端收不到更新。
3. 新增动作 → 同步更新 `ACTIONS`、前端 `send()`、以及本文件 §11。
4. 改表结构 → 没有迁移机制，需 `npm run db:rebuild`（会清空账号/存档）；**改前先备份 `data/`**。
5. 幂等：任何新写接口都要考虑重复提交；玩家动作统一走 `/api/action` 的 `requestId`。
6. 时间：服务端只用 `server/lib/clock.js` 的 `now()`，别直接 `Date.now()`（否则测试无法穿越时间）。
7. RNG：服务端只用 `cryptoRandom` 注入，别在领域函数里调 `Math.random()` 生成经济结果。
8. 客户端可信输入只有三项（§9），新功能不要把经济数值交给前端。
9. 跑 `npm test`；涉及前端再 `npm run build` 确认能构建。
10. 注释风格：本项目用中文注释解释「为什么」，新增代码保持同样风格。

---

## 16. 已知的内在不对称 / 易踩坑

- **`syncPlayer` vs `syncPlayerLocked`**：已持锁时必须用 `*Locked`，否则 Promise 链等自己 → 死锁。
- **配置懒应用**：玩家快照带 `configVersion`，后台保存后不广播，玩家下次 sync 时 `applyConfig` 生效。
- **`fx.days` 历史只保留 365 天**（`FX_KEEP_DAYS`），但前端展示窗口由 `config.fx.historyDays` 决定。
- **黑市与鱼市是两套导航**：进入黑市后钓鱼页不挂载，但服务端钓鱼照常推进（`activeTab` 只是 UI）。
- **`STATE_VERSION = 12`**：`hydrateState` 负责旧存档兼容；改快照结构时同步处理。
- **README 与实现的已知出入**：README §架构写「开奖面板展示当前奖池最近五期」，实现默认是
  `config.lotteryHistory = 7`（可 1–20 调），以 `DEFAULT_CONFIG` / `recentDraws` 为准。
- **配置里有三张「默认值」副本**：`DEFAULT_CONFIG`（游戏）、`DEFAULT_DEPTH_TRAIT_WEIGHTS`（词条权重）、
  `normalizeBlackMarketConfig`（黑市）。后台保存时三者都会重新归一化，所以改默认值要改**定义**而非库里的旧行。
- `.tmp-*` 目录是调试残留，可忽略/清理；`data/`、`certs/`、`dist/` 是运行时产物。
