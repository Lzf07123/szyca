UPDATE home_sections
SET config = config || '{
        "eyebrow": "现场开奖",
        "title": "抽奖大屏",
        "body": "现场号码抽奖实时开奖，中奖结果在大屏统一公布。",
        "action_label": "进入大屏"
    }'::jsonb,
    updated_at = now()
WHERE kind = 'lottery'
  AND config->>'title' = '招新抽奖'
  AND config->>'eyebrow' = '现场福利'
  AND config->>'body' = '现场号码抽奖将在大屏实时公布中奖结果。'
  AND config->>'action_label' = '查看活动'
  AND config->>'action_to' = '/lottery';
