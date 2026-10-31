ALTER TABLE "Guide" ADD COLUMN "curatedKey" TEXT;
CREATE UNIQUE INDEX "Guide_curatedKey_key" ON "Guide"("curatedKey");

CREATE TABLE "GuideCheck" (
    "guideId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "item" INTEGER NOT NULL,

    CONSTRAINT "GuideCheck_pkey" PRIMARY KEY ("guideId","userId","item")
);

ALTER TABLE "GuideCheck" ADD CONSTRAINT "GuideCheck_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuideCheck" ADD CONSTRAINT "GuideCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
