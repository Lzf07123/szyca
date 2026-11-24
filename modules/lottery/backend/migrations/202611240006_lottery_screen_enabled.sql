UPDATE home_sections
SET enabled = TRUE,
    updated_at = now()
WHERE kind = 'lottery'
  AND NOT enabled;
