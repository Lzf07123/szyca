CREATE TABLE IF NOT EXISTS lottery_campaigns (
    id                    BIGSERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','paused','ended')),
    starts_at             TIMESTAMPTZ,
    ends_at               TIMESTAMPTZ,
    eligibility           TEXT NOT NULL DEFAULT 'completed_round'
                          CHECK (eligibility IN ('completed_round','min_score')),
    eligibility_min_score INT NOT NULL DEFAULT 0 CHECK (eligibility_min_score >= 0),
    max_draws_per_user    INT NOT NULL DEFAULT 1 CHECK (max_draws_per_user = 1),
    no_win_weight         INT NOT NULL DEFAULT 100 CHECK (no_win_weight >= 0),
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    created_by            BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_lottery_campaign_lifecycle
    ON lottery_campaigns(status, enabled, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS lottery_prizes (
    id          BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    total       INT NOT NULL CHECK (total >= 0),
    remaining   INT NOT NULL CHECK (remaining >= 0),
    weight      INT NOT NULL CHECK (weight > 0),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    sort        INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (remaining <= total)
);
CREATE INDEX IF NOT EXISTS idx_lottery_prizes_campaign
    ON lottery_prizes(campaign_id, enabled, sort, id);

CREATE TABLE IF NOT EXISTS lottery_draws (
    id          BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES lottery_campaigns(id) ON DELETE RESTRICT,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    prize_id    BIGINT REFERENCES lottery_prizes(id) ON DELETE RESTRICT,
    status      TEXT NOT NULL CHECK (status IN ('won','no_win','claimed')),
    request_id  TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at  TIMESTAMPTZ,
    claimed_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    UNIQUE (campaign_id, user_id),
    CHECK (
        (status = 'no_win' AND prize_id IS NULL AND claimed_at IS NULL) OR
        (status IN ('won','claimed') AND prize_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_campaign
    ON lottery_draws(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_claim
    ON lottery_draws(campaign_id, status, created_at)
    WHERE status IN ('won','claimed');
