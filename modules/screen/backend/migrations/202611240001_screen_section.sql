INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT
    'screen',
    TRUE,
    45,
    '{"eyebrow":"现场大屏","title":"实时排行","body":"成绩与名次实时更新，在共同时区里看见每一次进步。","action_label":"查看排行","action_to":"/screen"}'::jsonb,
    'published'
WHERE NOT EXISTS (
    SELECT 1 FROM home_sections WHERE kind = 'screen'
);
