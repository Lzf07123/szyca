CREATE TABLE IF NOT EXISTS admin_roles (
    role        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO admin_roles (role, label, permissions) VALUES
    ('owner', '所有者', '["*"]'::jsonb),
    ('content_editor', '内容编辑', '["site.read","site.write","media.read","media.write"]'::jsonb),
    ('event_operator', '活动运营', '["site.read","media.read","quiz.read","quiz.operate","scores.read","lottery.configure","lottery.claim"]'::jsonb),
    ('data_viewer', '数据查看', '["site.read","quiz.read","scores.read","audit.read"]'::jsonb)
ON CONFLICT (role) DO UPDATE
SET label = EXCLUDED.label, permissions = EXCLUDED.permissions;

CREATE TABLE IF NOT EXISTS admin_accounts (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL REFERENCES admin_roles(role),
    disabled      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id           BIGSERIAL PRIMARY KEY,
    account_id   BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    csrf_hash    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip           TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    actor_id      BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    actor_name    TEXT NOT NULL DEFAULT 'legacy',
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL DEFAULT '',
    before        JSONB NOT NULL DEFAULT '{}'::jsonb,
    after         JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id    TEXT NOT NULL,
    ip            TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
    key        TEXT PRIMARY KEY,
    enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    config     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, enabled, config) VALUES
    ('quiz', TRUE, '{}'::jsonb),
    ('lottery', FALSE, '{"default_no_win_weight":100}'::jsonb),
    ('join', TRUE, '{}'::jsonb),
    ('screen', TRUE, '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS site_pages (
    id           BIGSERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    seo          JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ,
    updated_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_sections (
    id         BIGSERIAL PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('hero','about','activities','quiz','lottery','join','gallery')),
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    sort       INT NOT NULL DEFAULT 0,
    starts_at  TIMESTAMPTZ,
    ends_at    TIMESTAMPTZ,
    config     JSONB NOT NULL DEFAULT '{}'::jsonb,
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_home_sections_public
    ON home_sections(status, enabled, sort)
    WHERE status = 'published' AND enabled;

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'hero', TRUE, 10,
       '{"eyebrow":"汕头职业技术学院 · 计算机协会","title":"把好奇心，写进每一行代码","subtitle":"招新答题、技术活动与同好社区，都在这里相遇。","primary_label":"开始答题","primary_to":"/quiz","secondary_label":"加入我们","secondary_to":"/join"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'hero');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'about', TRUE, 20,
       '{"eyebrow":"关于协会","title":"一起学习，一起创造","body":"计算机协会面向所有对技术感兴趣的同学。我们用真实项目练习协作、工程与表达，让每个想法都有机会被实现。"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'about');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'activities', TRUE, 30,
       '{"eyebrow":"持续发生","title":"不只是招新","items":[{"title":"技术分享","body":"从 Web 开发到容器云，以能上手为目标组织分享。"},{"title":"项目协作","body":"组队完成网站、工具与校园应用，积累可展示的作品。"},{"title":"竞赛实践","body":"围绕真实赛题训练排障、工程化与团队配合。"}]}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'activities');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'quiz', TRUE, 40,
       '{"eyebrow":"现场挑战","title":"招新答题","body":"选择难度，完成一轮答题，实时查看你的成绩与排名。","action_label":"进入答题","action_to":"/quiz"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'quiz');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'lottery', FALSE, 50,
       '{"eyebrow":"现场福利","title":"招新抽奖","body":"完成一轮答题即可参与，结果由服务端公平生成。","action_label":"查看活动","action_to":"/lottery"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'lottery');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'join', TRUE, 60,
       '{"eyebrow":"保持联系","title":"加入我们","body":"扫码加入招新群或关注协会公众号，不错过下一场活动。","action_label":"查看群二维码","action_to":"/join"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'join');

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT 'gallery', TRUE, 70,
       '{"eyebrow":"协会现场","title":"活动影像","body":"技术分享、比赛与协作时刻。"}'::jsonb,
       'published'
WHERE NOT EXISTS (SELECT 1 FROM home_sections WHERE kind = 'gallery');

INSERT INTO site_pages (slug, title, summary, body, status, published_at)
VALUES (
    'about',
    '关于计算机协会',
    '面向汕职院技术爱好者的学习与实践社区。',
    '计算机协会通过技术分享、项目协作与竞赛实践，帮助成员建立可持续的学习方式。',
    'published',
    now()
)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS media_assets (
    id         BIGSERIAL PRIMARY KEY,
    path       TEXT NOT NULL UNIQUE,
    mime       TEXT NOT NULL,
    width      INT,
    height     INT,
    checksum   TEXT NOT NULL DEFAULT '',
    created_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_refs (
    media_id      BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    module        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (media_id, module, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_media_refs_resource
    ON media_refs(module, resource_type, resource_id);
