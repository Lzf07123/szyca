CREATE TABLE IF NOT EXISTS gallery_images (
    id          BIGSERIAL PRIMARY KEY,
    section_id  BIGINT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    image_url   TEXT NOT NULL CHECK (image_url <> ''),
    sort        INT NOT NULL DEFAULT 0,
    created_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_section
    ON gallery_images(section_id, sort, id);

INSERT INTO gallery_images (section_id, title, image_url, sort, created_by)
SELECT
    section.id,
    COALESCE(item.value->>'title', ''),
    item.value->>'image_url',
    item.position * 10,
    section.updated_by
FROM home_sections section
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(section.config->'items') = 'array' THEN section.config->'items'
        ELSE '[]'::jsonb
    END
) WITH ORDINALITY AS item(value, position)
WHERE section.kind = 'gallery'
  AND NULLIF(BTRIM(COALESCE(item.value->>'image_url', '')), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM gallery_images existing
      WHERE existing.section_id = section.id
        AND existing.image_url = item.value->>'image_url'
  );

UPDATE home_sections
SET config = config - 'items',
    plugin_version = 2,
    updated_at = now()
WHERE kind = 'gallery';

INSERT INTO media_refs (media_id, module, resource_type, resource_id)
SELECT asset.id, 'gallery', 'image', image.id::text
FROM gallery_images image
JOIN media_assets asset ON asset.path = image.image_url
ON CONFLICT DO NOTHING;
