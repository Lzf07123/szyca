UPDATE home_sections
SET config = jsonb_set(
        config,
        '{body}',
        to_jsonb('现场号码抽奖将在大屏实时公布中奖结果。'::text),
        true
    ),
    updated_at = now()
WHERE kind = 'lottery'
  AND config->>'body' = '现场号码抽奖由后台统一开奖，中奖结果实时公布。';
