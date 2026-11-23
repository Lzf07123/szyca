UPDATE home_sections
SET config = jsonb_set(
        config,
        '{title}',
        to_jsonb('抽奖大屏'::text),
        true
    ),
    updated_at = now()
WHERE kind = 'lottery'
  AND config->>'title' = '号码抽奖';

INSERT INTO home_sections (kind, enabled, sort, config, status)
SELECT
    'lottery-participate',
    TRUE,
    51,
    '{"eyebrow":"答题福利","title":"招新抽奖","body":"完成答题后参与个人抽取，中奖结果与奖品以现场公布为准。","action_label":"参与抽奖","action_to":"/lottery/participate"}'::jsonb,
    'published'
WHERE NOT EXISTS (
    SELECT 1 FROM home_sections WHERE kind = 'lottery-participate'
);
