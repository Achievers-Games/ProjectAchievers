CREATE TYPE "FeedbackKind" AS ENUM ('BUG', 'IDEA');
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'PLANNED', 'DONE', 'DECLINED');

CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "content" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
