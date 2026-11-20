-- 深海鱼市 · 服务端权威数据库
-- 目标：node:sqlite (Windows 单机部署)，WAL，幂等建表。
-- 设计取舍：账号 / 会话 / 全服行情 / 开奖 / 审计是关系表；
-- 每个玩家的游戏态是一份带版本号的 JSON 快照（players.state）。
-- 行情不进玩家快照，永远是下面 fx_days / fx_bucket 两张全服表。

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  username_key  TEXT    NOT NULL UNIQUE,          -- 小写规范化，防大小写重复注册
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  display_name  TEXT    NOT NULL DEFAULT '',
  email         TEXT,                             -- 原始大小写，仅用于展示与发信
  email_key     TEXT,                             -- 小写规范化，用于唯一性判断
  email_verified_at INTEGER,                      -- NULL = 未验证（邮箱是可选功能）
  totp_secret   TEXT,                             -- base32；NULL = 未绑定
  totp_enabled_at INTEGER,
  totp_last_step  INTEGER NOT NULL DEFAULT 0,     -- 防同一步长重放
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
-- 已验证的邮箱全服唯一；未验证的允许重复（换绑期间两边都不能被卡住）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verified
  ON users(email_key) WHERE email_verified_at IS NOT NULL;

-- 邮箱验证码：只存哈希，一次性，10 分钟过期。
CREATE TABLE IF NOT EXISTS email_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_key  TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_created ON email_tokens(created_at);

-- 重置进度的二次确认：密码已通过后，再发一个邮箱验证码。
-- 单独一张表而不是复用 email_tokens：两种码用途不同，不能互相顶替。
CREATE TABLE IF NOT EXISTS reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_created ON reset_tokens(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,                 -- 随机 token 的 SHA-256
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  mfa_at     INTEGER NOT NULL DEFAULT 0,          -- 最近一次通过 2FA 的时间
  ip         TEXT    NOT NULL DEFAULT '',
  user_agent TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);

-- 登录第二步的临时挑战：密码已通过、等 TOTP。
CREATE TABLE IF NOT EXISTS login_challenges (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expires ON login_challenges(expires_at);

CREATE TABLE IF NOT EXISTS players (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT    NOT NULL,                    -- 玩家快照 JSON（不含 fx.days / fx.today）
  version    INTEGER NOT NULL DEFAULT 1,          -- 乐观并发 + 客户端增量判断
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_config (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  config     TEXT    NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- 全服共享行情：每天一根日线，买卖价由它推导。
CREATE TABLE IF NOT EXISTS fx_days (
  symbol TEXT    NOT NULL,
  day    INTEGER NOT NULL,
  open   REAL    NOT NULL,
  high   REAL    NOT NULL,
  low    REAL    NOT NULL,
  close  REAL    NOT NULL,
  net    REAL    NOT NULL DEFAULT 0,
  volume REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, day)
);

-- 全服共享的「今天」待结算桶：玩家上钩 / 出货先累加到这里，零点统一结算成日线。
CREATE TABLE IF NOT EXISTS fx_bucket (
  symbol TEXT    PRIMARY KEY,
  day    INTEGER NOT NULL,
  net    REAL    NOT NULL DEFAULT 0,
  volume REAL    NOT NULL DEFAULT 0
);

-- 当日成交时间桶：15 分钟一格，记录每格真实的净流入与成交量。
-- 单独一张表而不是给 fx_bucket 加列，旧库不需要 ALTER TABLE。
CREATE TABLE IF NOT EXISTS fx_bucket_bins (
  symbol TEXT    PRIMARY KEY,
  day    INTEGER NOT NULL,
  bins   TEXT    NOT NULL DEFAULT '[]'
);

-- 已结算日的成交时间桶：只保留最近 30 天，供日内 K 线按真实成交时间回放。
CREATE TABLE IF NOT EXISTS fx_day_bins (
  symbol TEXT    NOT NULL,
  day    INTEGER NOT NULL,
  bins   TEXT    NOT NULL,
  PRIMARY KEY (symbol, day)
);

-- 彩票批次登记：玩家一合成号码票就登记，定时器据此在批次结束后开奖。
CREATE TABLE IF NOT EXISTS lottery_batches (
  batch_id TEXT    PRIMARY KEY,
  start_at INTEGER NOT NULL,
  end_at   INTEGER NOT NULL,
  drawn    INTEGER NOT NULL DEFAULT 0,
  rules    TEXT
);

-- 彩票批次开奖：号码只在服务端生成一次，全服共用。
CREATE TABLE IF NOT EXISTS lottery_draws (
  batch_id TEXT    NOT NULL,
  type_id  TEXT    NOT NULL,
  numbers  TEXT    NOT NULL,                      -- JSON 数组
  drawn_at INTEGER NOT NULL,
  PRIMARY KEY (batch_id, type_id)
);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_type_batch ON lottery_draws(type_id, batch_id DESC);

-- 动作幂等：同一个 requestId 只结算一次（网络重试 / 双击）。
CREATE TABLE IF NOT EXISTS action_log (
  request_id TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  response   TEXT    NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT    NOT NULL,
  detail     TEXT    NOT NULL DEFAULT '',
  ip         TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
