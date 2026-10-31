-- Microsoft donne ces images en http et en très grand.
UPDATE "Game"
SET "headerUrl" = replace("headerUrl", 'http://', 'https://') || '?w=920',
    "coverUrl" = replace("coverUrl", 'http://', 'https://') || '?w=920'
WHERE platform = 'XBOX' AND "headerUrl" LIKE 'http://store-images.s-microsoft.com/%';
