CREATE TABLE "GameCompletionSample" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameCompletionSample_pkey" PRIMARY KEY ("userId", "gameId", "scope"),
    CONSTRAINT "GameCompletionSample_progress_fkey" FOREIGN KEY ("userId", "gameId")
        REFERENCES "UserGame"("userId", "gameId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GameCompletionSample_gameId_scope_idx" ON "GameCompletionSample"("gameId", "scope");
