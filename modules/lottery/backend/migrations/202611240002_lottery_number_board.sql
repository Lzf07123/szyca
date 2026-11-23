CREATE TABLE IF NOT EXISTS lottery_mode_settings (
    id                SMALLINT PRIMARY KEY CHECK (id = 1),
    screen_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    personal_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by        BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lottery_mode_settings
    (id, screen_enabled, personal_enabled)
VALUES
    (1, TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lottery_number_events (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','live','archived')),
    range_start   BIGINT NOT NULL CHECK (range_start >= 0),
    range_end     BIGINT NOT NULL CHECK (range_end >= range_start),
    number_width  SMALLINT NOT NULL CHECK (number_width BETWEEN 1 AND 16),
    revision      BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_by    BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    published_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    archived_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    published_at  TIMESTAMPTZ,
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_lottery_number_live
    ON lottery_number_events(status)
    WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_lottery_number_events_status
    ON lottery_number_events(status, id DESC);

CREATE TABLE IF NOT EXISTS lottery_number_levels (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT NOT NULL REFERENCES lottery_number_events(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    winner_count  INT NOT NULL CHECK (winner_count BETWEEN 1 AND 100),
    sort          INT NOT NULL CHECK (sort >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, id),
    UNIQUE (event_id, name),
    UNIQUE (event_id, sort)
);

CREATE TABLE IF NOT EXISTS lottery_number_draws (
    id           BIGSERIAL PRIMARY KEY,
    event_id     BIGINT NOT NULL REFERENCES lottery_number_events(id) ON DELETE RESTRICT,
    level_id     BIGINT NOT NULL,
    request_id   TEXT NOT NULL UNIQUE,
    operator_id  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (level_id),
    FOREIGN KEY (event_id, level_id)
        REFERENCES lottery_number_levels(event_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS lottery_number_winners (
    id          BIGSERIAL PRIMARY KEY,
    draw_id     BIGINT NOT NULL REFERENCES lottery_number_draws(id) ON DELETE RESTRICT,
    event_id    BIGINT NOT NULL,
    level_id    BIGINT NOT NULL,
    number      BIGINT NOT NULL CHECK (number >= 0),
    position    INT NOT NULL CHECK (position > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, number),
    UNIQUE (level_id, position),
    FOREIGN KEY (event_id, level_id)
        REFERENCES lottery_number_levels(event_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_lottery_number_winners_level
    ON lottery_number_winners(level_id, number);

UPDATE home_sections
SET config = jsonb_set(
        config,
        '{body}',
        to_jsonb('现场号码抽奖由后台统一开奖，中奖结果实时公布。'::text),
        true
    ),
    updated_at = now()
WHERE kind = 'lottery'
  AND config->>'title' = '招新抽奖'
  AND config->>'body' IN (
      '完成答题后参与现场抽奖。',
      '完成一轮答题即可参与，结果由服务端公平生成。'
  );
