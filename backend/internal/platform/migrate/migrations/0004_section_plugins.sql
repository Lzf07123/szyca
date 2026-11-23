ALTER TABLE home_sections
    DROP CONSTRAINT IF EXISTS home_sections_kind_check;

ALTER TABLE home_sections
    ADD COLUMN IF NOT EXISTS plugin_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE home_sections
    DROP CONSTRAINT IF EXISTS home_sections_plugin_version_check;

ALTER TABLE home_sections
    ADD CONSTRAINT home_sections_plugin_version_check
    CHECK (plugin_version > 0);
