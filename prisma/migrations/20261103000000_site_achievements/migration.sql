-- AlterTable
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "upheld" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SiteUnlock" (
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteUnlock_pkey" PRIMARY KEY ("userId","code")
);

-- CreateIndex
CREATE INDEX "SiteUnlock_code_idx" ON "SiteUnlock"("code");

-- AddForeignKey
ALTER TABLE "SiteUnlock" ADD CONSTRAINT "SiteUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
