-- Un commentaire supprimé ne laisse plus de trace ; ses réponses remontent d'un niveau.
UPDATE "Comment" SET "parentId" = NULL
WHERE "parentId" IN (SELECT id FROM "Comment" WHERE status = 'DELETED');

DELETE FROM "Report"
WHERE "targetType" = 'COMMENT' AND "targetId" IN (SELECT id FROM "Comment" WHERE status = 'DELETED');

DELETE FROM "Comment" WHERE status = 'DELETED';
