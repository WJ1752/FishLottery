# 深海鱼市

服务端权威的放置钓鱼 / 彩票 / 刮刮乐 / 深海 FX 游戏。浏览器只负责渲染和发送意图，
所有随机数、开奖号码、价格、耐久损耗、兑奖入账都在服务端计算并落库。

## 本机试玩

Windows 可以双击 `start.bat`。脚本会按需安装依赖，每次启动重新构建前端，并默认只监听本机。
也可以在 PowerShell 中运行：

```powershell
npm.cmd ci
npm.cmd run build
$env:HOST = '127.0.0.1'
npm.cmd start
```

打开 <https://localhost:9000> 注册，进入钓鱼页开始垂钓。钓到第一条鱼后，去潮汐商会出售，
再按引导强化钓竿并解锁其他玩法。鱼币和票券均为游戏道具。

推荐使用 Node.js **22.13 或更新的 LTS 版本**。数据库使用内置的 `node:sqlite`。首次启动会生成
本机 HTTPS 证书，需要 OpenSSL。Windows 上可以使用 Git for Windows 自带的 OpenSSL。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `9000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。服务直接对外时显式设置网卡地址 |
| `DATA_DIR` | `./data` | 数据目录（`app.db` 在这里） |
| `DB_FILE` | `$DATA_DIR/app.db` | 直接指定数据库文件 |
| `TLS_CERT` / `TLS_KEY` | `./certs/server.crt` / `./certs/server.key` | 证书与私钥 |
| `HSTS` | 按证书配置 | 正式证书默认启用，可用 `HSTS=0` 关闭 |
| `OFFLINE_CAP_HOURS` | `12` | 离线收益最多补算多少小时 |
| `NODE_ENV` | 空 | 对外运营设为 `production` |
| `TRUST_PROXY_HOPS` | `0` | 直连时保持 0；仅在应用入口只允许可信代理访问时，填实际代理跳数 |
| `SMTP_HOST` | 空 | 邮件服务地址；生产环境需配置 SMTP 才能使用邮件验证与进度重置 |
| `SMTP_PORT` | `1025` | 邮件服务端口（465 自动按隐式 TLS 处理） |
| `SMTP_USER` / `SMTP_PASS` | 空 | 需要认证时的账号与密码 / 授权码 |
| `SMTP_SECURE` | 按端口推断 | `ssl`（465）/ `starttls`（587）/ `none` |
| `SMTP_FROM` | 同 `SMTP_USER` | 发件人地址 |

## 账号与权限

- 必须先注册登录才能玩。用户名 3–32 位 `[A-Za-z0-9_-]`，密码至少 8 位。
  验证过邮箱后也可以用邮箱 + 密码登录。
- 密码用 `scrypt`（N=2^15, r=8, p=1）加每用户随机盐存储，比较走 `timingSafeEqual`。
- 会话是 `fl_sid` Cookie（`HttpOnly; Secure; SameSite=Strict`），库里只存 token 的 SHA-256。
- 新账号一律是玩家。**管理员只能由命令行提升**，或在已登录的管理后台里提升：

```bash
npm run admin -- list
npm run admin -- promote <username>
npm run admin -- demote <username>
npm run admin -- reset-2fa <username>
npm run admin -- set-password <username>
npm run admin -- disable <username>     # 禁用并踢下线
npm run admin -- enable <username>
```

命令默认读写 `./data/app.db`，操作其它目录时带 `DATA_DIR`：

```bash
DATA_DIR=D:\FishGame\data npm run admin -- promote alice
```

### 管理后台的 2FA

管理后台要求 **角色 = admin** 且 **当前会话在 12 小时内通过过 2FA**。三条门禁分别返回：

| 情况 | HTTP | code | 前端表现 |
| --- | --- | --- | --- |
| 不是管理员 | 403 | `FORBIDDEN` | 不显示入口 |
| 未绑定 2FA | 403 | `TOTP_SETUP_REQUIRED` | 引导绑定（显示密钥） |
| 已绑定但本次会话未验证 | 403 | `MFA_REQUIRED` | 输入 6 位验证码 |

TOTP 是标准 RFC 6238（SHA-1 / 30 秒 / 6 位，容忍前后各一步），同一个时间步只接受一次，
防止重放。绑定成功后会返回 **8 个一次性恢复码**，只显示一次，用于验证器丢失时登录。

### 邮箱验证（可选）

注册不要求邮箱。登录后到「设置 → 邮箱」绑定并验证：

- 点「发送验证码」→ 邮箱收到 6 位码 → 填回页面完成验证；
- 验证码 10 分钟有效、错 5 次作废、60 秒冷却、每账号每小时最多 8 次；
- 库里只存验证码的 SHA-256，不存明文；
- 已验证的邮箱全服唯一，别人不能抢注；
- 验证后即可用**邮箱 + 密码**登录（大小写不敏感），与用户名等价；
- **验证后锁定**：不能换绑、不能解绑（`EMAIL_LOCKED`）。邮箱是账号的登录标识，
  允许解绑会让同一邮箱在账号间漂移——解绑后别人立刻抢注，就能用同一个邮箱登进
  另一个身份。需要换邮箱请换一个账号（进度可以用设置页的重置功能清空）。

本地验收邮件时，可自行运行 Mailpit。将下例路径替换为实际安装路径。

```powershell
# 启动：SMTP 收信 1025，网页看信 8025
D:\FishGame\tools\mailpit\mailpit.exe --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025

# 服务端指向它
$env:SMTP_HOST="127.0.0.1"; $env:SMTP_PORT="1025"; npm start
```

然后打开 <http://127.0.0.1:8025> 就能看到验证码邮件。

**Mailpit 只截留邮件、不投递**。它收到的信永远停留在本地网页里，不会发到 QQ / Gmail /
任何真实邮箱。要发给真实玩家，必须换成真实的 SMTP 服务商：

```powershell
# QQ 邮箱：授权码在「设置 → 账户 → POP3/IMAP/SMTP服务」里生成
$env:SMTP_HOST="smtp.qq.com"
$env:SMTP_PORT="465"
$env:SMTP_USER="你的QQ号@qq.com"
$env:SMTP_PASS="授权码（不是登录密码）"
$env:SMTP_FROM="你的QQ号@qq.com"
npm start
```

改完配置先用诊断命令验证一遍，它会把 SMTP 对话完整打出来并指出卡在哪一步：

```powershell
npm run mail:test -- 你的邮箱@qq.com
```

常见失败原因：`SMTP_PASS` 填成了登录密码（要用授权码）、发件人地址和认证账号不一致、
端口加密方式不对（465 用隐式 TLS，587 用 STARTTLS）、或者被服务商判定为垃圾邮件。

`SMTP_HOST` 留空时，开发环境可以在服务端本地日志中读取验证码。生产环境只通过已配置的邮件服务发送验证码。

### 重置进度

「设置 → 重置进度」会清空鱼、票、钓竿与材料，账号、密码、邮箱和主题设置保留。这是不可撤销的
操作，所以要求**两步都过**：

1. 输入账号密码 → 通过后向已验证邮箱发一封 6 位验证码；
2. 输入验证码 → 校验通过才真正清空玩家快照。

- 没绑定邮箱时第一步就会拒绝（`EMAIL_REQUIRED`），页面会提示先验证邮箱；
- 密码错误 15 分钟内累计 5 次会锁住重置入口，避免把这里变成密码爆破通道；
- 验证码 10 分钟有效、错 5 次作废、60 秒冷却、每小时最多 5 次，库里只存 SHA-256；
- 重置不是 `/api/action` 的动作，只拿到会话无法清空存档；
- 会话不会被重置：账号还在，只是游戏进度回到新号状态。

## 上线运行

同一个 SQLite 数据目录使用一个服务实例。上线前准备正式域名和 HTTPS 证书，把 `DATA_DIR` 指向持久化目录，
把 SMTP 凭据放在服务进程的环境变量中。启动后检查 `GET /api/health` 返回 HTTP 200，
并用普通玩家账号走通注册、垂钓、卖鱼和重新登录。

盯盘机暂未开放新启用，存档仍保留原有机器和挂单数据。

```powershell
cd D:\FishGame
npm.cmd ci --include=dev
npm.cmd run build
$env:NODE_ENV = 'production'
$env:HOST = '0.0.0.0'
$env:DATA_DIR = 'D:\FishGame\data'
$env:TLS_CERT = 'D:\FishGame\certs\fullchain.pem'
$env:TLS_KEY = 'D:\FishGame\certs\privkey.pem'
npm.cmd start
```

开机自启（管理员 PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-service.ps1 -Install -InstallDir "D:\FishGame" -Port 9000
powershell -ExecutionPolicy Bypass -File scripts\windows-service.ps1 -Uninstall
```

计划任务以安装时的 Windows 用户运行。可在安装目录的 `.env` 文件中配置服务环境变量，
并给运行用户授予数据目录和证书文件所需权限。端口使用安装时传入的 `-Port`。

### 证书

`npm run cert` 用系统 `openssl` 生成自签名证书，SAN 覆盖 `localhost`、`127.0.0.1` 和本机所有
局域网 IPv4。加 `--force` 重新生成。换机器或换 IP 后需要重签。

浏览器首次访问会提示证书不受信任：

- 本机：`https://localhost:9000` → 高级 → 继续前往。
- 局域网：把 `certs/server.crt` 装进「受信任的根证书颁发机构」，或用自己域名签发的正式证书
  （通过 `TLS_CERT` / `TLS_KEY` 指定）。

### 备份

使用与服务相同的 `DATA_DIR` 或 `DB_FILE` 配置创建一致的 SQLite 快照。命令可在服务运行期间执行。

```powershell
npm.cmd run db:backup -- D:\FishGameBackups\fish-2026-11-21.db
```

恢复时先停服务并保留当前整个数据目录，再在新的数据目录中把备份放为 `app.db`。
指向新目录启动后，检查健康接口和玩家存档。更新代码前也可以用这条命令备份。

### 重建数据库

保留在线玩家存档时，使用备份与升级流程。只有在明确要清空账号、存档、行情和开奖记录时，停服后执行：

```powershell
# 先停服务
npm run db:rebuild -- --confirm
```

它会清空账号、存档、行情与开奖记录，但**保留管理后台里调好的全服配置**
（先抠出 `world_config`，重建后写回并让版本号 +1），同时把旧库备份成 `app.db.<时间戳>.bak`。

## 架构

```
浏览器 (React)                       Node 进程 (单实例, https://localhost:9000)
┌────────────────┐  HTTPS/JSON     ┌──────────────────────────────────────┐
│ 页面组件        │ ──────────────► │ 静态 dist/ + /api/*                   │
│ 纯展示 + 意图   │ ◄────────────── │ auth / players / market / lottery     │
│ 1s 轮询         │                 │        ↓                              │
└────────────────┘                 │  src/game.js（纯领域函数，唯一规则源）│
                                   └──────────────┬───────────────────────┘
                                                  ▼  node:sqlite (WAL) data/app.db
```

- **`src/game.js` 是唯一的规则源**：服务端和测试都 import 同一份纯函数，前端只复用其中的常量
  与展示辅助（`DEPTHS`、`fxBoard`、`upgradeCostAt` 等），不再调用任何会改状态的函数。
- **玩家状态是版本化 JSON 快照**（`players.state`），配 `players.version` 做乐观并发。鱼、词条、
  稀有度、开奖号码、刮刮乐卡面、价格、耐久扣减、兑奖入账全部由服务端产生。
- **深海 FX 行情是全服共享的**，存在 `fx_days` / `fx_bucket` 两张表里，玩家快照只保留自己的
  持仓与流水；读时注入、写前剥离，不会双算。
- **彩票按 UTC 6 小时批次开奖**，号码由服务端 `crypto` RNG 生成写入 `lottery_draws`，玩家下次
  同步时结算为已开奖。奖池规则按购票期保存，后台的规则调整会作用于后续期次。
  开奖面板默认展示七期，展示数量可在后台调整。
- **离线收益由服务端追算**：从 `fishing.lastTickAt` 起按自然日分段推进，封顶 12 小时，跨零点的
  FX 流水落到正确的交易日。

### API

```
GET  /api/health             → { ok }
POST /api/auth/register | login | totp | logout | step-up | password
GET  /api/auth/me
POST /api/auth/totp/setup   → { secret }
POST /api/auth/totp/enable  → { recoveryCodes }
POST /api/auth/email/send   → { sent, delivered, email, expiresAt }
POST /api/auth/email/verify → { email, verifiedAt, user }
POST /api/auth/email/remove → 409 EMAIL_LOCKED（邮箱不可解绑）
POST /api/auth/progress-reset/send    → { sent, delivered, email(掩码), expiresAt }
POST /api/auth/progress-reset/confirm → { ok, version, me }
GET  /api/bootstrap         → { user, config, configVersion, me, fx, lottery, serverTime }
GET  /api/sync?v=&d=&boost= → { changed, me?, fishing, lottery, ... }
POST /api/action            → { ok, me, ... }   带 requestId 幂等
GET/POST /api/admin/*
```

`sync` 每秒一次，只返回时间相关的小字段；只有服务端说「经济状态变了」才带完整 `me`。
写操作都要带 `X-Requested-With: fetch`，并且校验 `Origin`/`Referer` 与 Host 一致（CSRF）。

## 逐个解锁（新手引导）

新账号不再一次看到十个页签，而是按进度逐层开放。**只锁左侧导航页签**，页内按钮不做门槛。

| 层 | 露出 | 判定（严格串行） |
|---|---|---|
| L0 | 钓鱼、设置 | 新号默认；钓鱼页有 5 页导览（进度条 / 张力条 / 脱钩公式 / 状态与耐久 / 结果） |
| L1 | 潮汐商会 | `stats.totalCatches ≥ 1` |
| L2 | （钓竿强化） | `stats.totalSold ≥ 1`；**一次性发放 1000 鱼币 + 首级强化材料** |
| L3 | 刮刮乐 | 累计获得 ≥ 3 张刮刮乐 |
| L4 | 彩票中心 | 累计获得 ≥ 3 张空白彩票 |
| L5 | 钓竿成长 | **L3 与 L4 都完成** 且真的升级过一次钓竿 |
| L6 | 深海FX | L5 完成；**一次性发放 10000 鱼币** |
| L7 | 中奖统计 | L6 完成 |
| — | 无灯黑市 | 仍由 `blackMarket.unlockDepth`（海沟）控制，不参与引导 |

实现要点：

- **判定是纯函数**：`guideTargetStage(state)` 从 `state.stats` / 背包 / 钓竿等级推导应到层级，
  遇到第一个不满足的步就停，不跳级；`advanceGuide` 每轮同步调一次，天然幂等。
- **赠礼只发一次**：记在 `guide.granted[stepId]`，金额与材料进全服配置。
  `grantMaterials` 留空时按「当前钓竿强化首级实价」自动推导。
  跳过引导后可以立即访问页签，并在实际达到进度条件时领取对应的赠礼。
- **累计获得只增不减**：`stats.totalScratchEarned` / `totalTicketsEarned` / `totalSold`
  在发卡/发票/卖鱼时递增，玩家刮完兑完也不会让解锁条件回退。
- **防绕过**：`server/actions.js` 对商会、刮刮乐、彩票、FX 相关动作做 `assertTabUnlocked`，
  未解锁返回 403 `FEATURE_LOCKED`。前端隐藏只是表现。
- **只显示一次**：每步读过就写 `guide.seen`，刷新/重登/换设备都不再出现。
- **介绍卡 3 秒后才能关**：`minCloseMs` 默认 3000，倒计时起点由服务端写在 `guide.focus[stepId].at`，
  刷新页面不会清零；关闭按钮在倒计时结束前是 disabled，并直接显示剩余秒数。
- **海域面板交代产出**：每张海域卡片列出该海主要出土的材料，并提示「更多功能会随海域一同解锁」。
- **钓竿页交代来源**：首次进入说明「苍蓝 / 无光 来自彩票、无灯 · 黑市来自黑市商店」。
- **彩票页**：右侧面板可在「往期号码」与「奖池预览」之间切换，奖池概率由 `hitDistribution` 精确计算。

后台「新手引导」页可以调每一步的阈值、赠币额度、介绍卡显示与否、所有文案，
也可以一键 `enabled=false` 直接全部解锁（退回旧行为）。

老存档没有 `guide` 字段时视为「已过引导」，按现有进度一次性点亮，不会重新引导。

## 安全边界

- **刮刮乐刮开比例**由客户端上报（只影响何时翻牌，卡面奖励在发卡时已由服务端定死）。
- **主题偏好**存在账号里，属于 UI 设置，无经济影响。

除此之外没有客户端可信输入：所有会改变经济的数值都只在服务端计算。

## 耐久、维修与成长

天赋系统已整体删除，成长线分散到更直接的地方：

### 耐久修正最大张力

满耐久 ×1.2，60% 时 ×1.0，20% 及以下 ×0.8，中间线性过渡。耐久越高越敢拉，
磨损后张力上限收紧——这是「保养钓竿」的实际收益。

### 溢出维修（初始自带）

维修不再有等级门槛：**只要耐久没满就能修**，且一次修复可以越过标称 `maxDurability`
（额度不限）。越过上限后就不算「未满」，要掉回上限以下才能再修。

### 自动维修（每根钓竿独立升级）

- 自动维修是**每根竿自带的一个升级项**，换一把竿就要重新升，0 级 = 未开启。
- 触发阈值 = `10 + 等级 × 10`（1 级 20、5 级 60），修复比例固定 90%，冷却 8 秒。
- 耐久跌破阈值时自动消耗该竿的修复材料（默认深蓝晶片 ×1）。

### 刮层直觉（静默成长）

每累计刮开 **10 次**，刮开阈值与刮除半径各升一档（阈值 −0.45%、半径 +1%），
最多 20 档（阈值 45%→36%、半径 17px→20.4px）。**完全静默**：没有任何界面展示，
等级由 `stats.totalScratch` 直接推导，不需要额外存档字段。

### 仓库扩容（纯鱼币）

升级只消耗鱼币，入口在**潮汐商会右上角的「仓库 x / y」旁边**。
1000 起步、每级 +100、90 级到 10000；价格 `150 × (1 + 等级)`。

### 组合加成

词条组合仍按配置里的 `price` 加成，**不再有任何额外的百分比修正**
（原来的「组合溢价」天赋已彻底删除）。

### 钓竿面板（唯一的钓竿管理入口）

「钓竿与背包」页面已删除。点钓鱼页右侧的耐久条唤出侧边面板：

- 点面板顶部的**竿名 / 图标**展开全部钓竿，再点一次任意一把即切换；
- 速度、最大耐久、最大张力、自动维修都在这里升级；
- **材料列在面板最下方**，只显示图标、名字、数量（不再显示低阶/进阶标签）。

## 深海FX 规则

把**钓鱼产出的词条**当成标的买卖，买卖只结算鱼币，不产出也不消耗背包材料。

### 行情

只有两种行为影响行情，且严格对称（同一条鱼钓上来又卖出去净影响为 0）：

- **上钩**：词条被抽离市场 → 供给减少 → 记正流入（+1 份 / 每个词条）。
- **卖出**：词条回到市场 → 供给增加 → 记负流入（−1 份 / 每个词条）。
- 脱钩不影响行情——跑掉的鱼从未进入过市场。

```
失衡比   = (上钩 − 卖出) / (上钩 + 卖出)          ∈ [−1, 1]
日涨跌幅 = 失衡比 × 波动系数 × 敏感度 − 均值回归 × (现价/基准价 − 1)
```

失衡比与规模无关（10 条里钓 6 卖 4 和 10 万条里钓 6 万卖 4 万结果相同）；均值回归防止价格
随机游走漂到 0 或无穷；日涨跌停（默认 ±10%）兜住集中出货。

### 交易日

- 按**服务器本地时间**零点切分交易日，每根日线记涨跌幅、收盘价、净流入与失衡比。
- **08:00 开市，24:00 收市**；零点到开盘的八小时用于结算，行情已定但不可交易。
- 当天结算先进「待结算桶」，零点统一结算成一根日线；盘中每分钟动一次价（U 型释放曲线 +
  桥接扰动），分钟线由「前收盘 + 当日净额 + 当日种子」确定性推导，刷新后是同一张图。
- 离线几天再回来会补算出每一天的日线，价格按天连续演进，不跳空。

### 成本

买卖价差（默认 2%）加单边手续费（默认 2%），往返约 4%，刷单必亏；单标的持仓上限默认 200 份；
买卖本身不写价格流水，无法自成交拉盘。

### 回看

点开标的，K 线展开在它下方，可切 **日K / 周K / 5分 / 15分 / 30分 / 60分 / 120分**，最多回看
一年。滚轮以光标为锚点缩放、拖动平移、双击复位。历史只由真实上钩与出货产生，没有模拟填充。

## 开发

```bash
npm run dev            # Vite 5173，/api 代理到 https://127.0.0.1:9000
npm run dev:api        # 单独跑后端
npm test               # 领域 + 认证 + 服务端集成测试
npm run build
```

`npm run dev` 需要后端已经在 9000 跑着（`vite.config.js` 里把 `/api` 代理过去，
并对自签名证书设了 `secure: false`）。

## 目录

```
src/            React 页面、api.js、auth.jsx、game.js（领域规则）
server/         app.js 路由与安全头、routes/、services/、lib/、db/
scripts/        admin.js（CLI）、gen-cert.js、windows-service.ps1、fx-sim.js、rebuild-db.js
test/           领域测试与 server.test.js
data/           运行时生成（SQLite）
certs/          运行时生成（自签名证书）
tools/mailpit/  本地邮件服务（仅开发/内网验证）
```
