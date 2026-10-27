-- Comment threading depth (0 = top-level). The original schema forgot it even
-- though create_comment/get_comments already rely on it.
ALTER TABLE comments ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;

-- Existing replies were one level deep at most.
UPDATE comments SET depth = 1 WHERE parent_id IS NOT NULL;
