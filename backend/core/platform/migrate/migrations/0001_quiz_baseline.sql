-- Version 0001: legacy quiz schema and compatibility hardening.
-- Existing installations have these objects already; every statement remains
-- idempotent so the baseline can also bootstrap a brand-new database.
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    nickname      TEXT NOT NULL,
    token         TEXT NOT NULL UNIQUE,
    device_fp     TEXT NOT NULL DEFAULT '',
    current_round      INT NOT NULL DEFAULT 0,
    current_question_idx INT NOT NULL DEFAULT 0,
    question_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_difficulty TEXT NOT NULL DEFAULT '全部',
    nickname_guard     BOOLEAN NOT NULL DEFAULT TRUE,
    device_guard       BOOLEAN NOT NULL DEFAULT TRUE,
    abandoned          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_round INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_question_idx INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS question_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_difficulty TEXT NOT NULL DEFAULT '全部';
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_guard BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_guard BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS abandoned BOOLEAN NOT NULL DEFAULT FALSE;
-- 数据库级唯一约束兜住应用层“先查后写”的并发竞态。
-- guard 列让历史重复数据保留原样，但每组只允许一条继续参与唯一约束。
WITH duplicate_ids AS (
    SELECT id, row_number() OVER (PARTITION BY nickname ORDER BY id) AS seq
    FROM users
)
UPDATE users u SET nickname_guard = FALSE
FROM duplicate_ids d WHERE u.id = d.id AND d.seq > 1;
WITH duplicate_ids AS (
    SELECT id, row_number() OVER (PARTITION BY device_fp ORDER BY id) AS seq
    FROM users WHERE device_fp <> '' AND NOT abandoned
)
UPDATE users u SET device_guard = FALSE
FROM duplicate_ids d WHERE u.id = d.id AND d.seq > 1;
DROP INDEX IF EXISTS users_nickname_unique;
CREATE UNIQUE INDEX users_nickname_unique ON users(nickname) WHERE nickname_guard;
DROP INDEX IF EXISTS users_active_device_unique;
CREATE UNIQUE INDEX users_active_device_unique
    ON users(device_fp) WHERE device_guard AND NOT abandoned AND device_fp <> '';

CREATE TABLE IF NOT EXISTS questions (
    id         BIGSERIAL PRIMARY KEY,
    content    TEXT NOT NULL,
    options    JSONB NOT NULL,
    answer     INT NOT NULL,
    score      INT NOT NULL DEFAULT 10,
    sort       INT NOT NULL DEFAULT 0,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    difficulty TEXT NOT NULL DEFAULT '简单'
);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT '简单';

CREATE TABLE IF NOT EXISTS attempts (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    question_id BIGINT REFERENCES questions(id) ON DELETE SET NULL,
    selected    INT,
    correct     BOOLEAN NOT NULL,
    score       INT NOT NULL DEFAULT 0,
    request_id  TEXT NOT NULL UNIQUE,
    round_no    INT NOT NULL DEFAULT 1,
    counted     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_question_id_fkey;
ALTER TABLE attempts ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE attempts ADD CONSTRAINT attempts_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS round_no INT NOT NULL DEFAULT 1;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS counted BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_attempts_user_round ON attempts(user_id, round_no);
-- 同一轮同一道题只允许落一条作答；重试仍由全局 request_id 唯一键负责。
-- 历史重复作答保留为审计记录，但标记为不计数，并统一清零防止旧脏分继续影响榜单。
WITH duplicate_ids AS (
    SELECT id, row_number() OVER (
        PARTITION BY user_id, round_no, question_id ORDER BY created_at, id
    ) AS seq
    FROM attempts WHERE question_id IS NOT NULL
)
UPDATE attempts a SET counted = FALSE, correct = FALSE, score = 0
FROM duplicate_ids d WHERE a.id = d.id AND d.seq > 1;
DROP INDEX IF EXISTS attempts_user_round_question_unique;
CREATE UNIQUE INDEX attempts_user_round_question_unique
    ON attempts(user_id, round_no, question_id) WHERE question_id IS NOT NULL AND counted;
-- 迁移：历史库回填 current_round（必须排在 attempts 建表之后）
UPDATE users u SET current_round = (SELECT COALESCE(MAX(round_no), 0) FROM attempts a WHERE a.user_id = u.id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);

-- 每轮冻结题目顺序，刷新/重启后不再重新抽题，也用于校验“只能回答当前题”。
CREATE TABLE IF NOT EXISTS round_questions (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_no    INT NOT NULL,
    position    INT NOT NULL,
    question_id BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, round_no, position),
    UNIQUE (user_id, round_no, question_id)
);
CREATE INDEX IF NOT EXISTS idx_round_questions_question ON round_questions(question_id);

CREATE TABLE IF NOT EXISTS qrcodes (
    id         BIGSERIAL PRIMARY KEY,
    image_url  TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    active     BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 迁移：历史库补充「二维码下方标题」列
ALTER TABLE qrcodes ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS announcements (
    id         BIGSERIAL PRIMARY KEY,
    content    TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'info',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_state (
    id         INT PRIMARY KEY,
    state      TEXT NOT NULL DEFAULT 'stop',
    difficulty TEXT NOT NULL DEFAULT '全部'
);
ALTER TABLE quiz_state ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT '全部';
INSERT INTO quiz_state (id, state) VALUES (1, 'stop') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS backgrounds (
    id         BIGSERIAL PRIMARY KEY,
    file_path  TEXT NOT NULL UNIQUE,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS footer_settings (
    id         INT PRIMARY KEY,
    owner      TEXT NOT NULL DEFAULT '',
    license    TEXT NOT NULL DEFAULT '',
    icp        TEXT NOT NULL DEFAULT '',
    icp_icon   TEXT NOT NULL DEFAULT '',
    police     TEXT NOT NULL DEFAULT '',
    police_icon TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE footer_settings ADD COLUMN IF NOT EXISTS icp_icon TEXT NOT NULL DEFAULT '';
ALTER TABLE footer_settings ADD COLUMN IF NOT EXISTS police TEXT NOT NULL DEFAULT '';
ALTER TABLE footer_settings ADD COLUMN IF NOT EXISTS police_icon TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS site_settings (
    id         INT PRIMARY KEY,
    logo_url   TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL DEFAULT ''
);
