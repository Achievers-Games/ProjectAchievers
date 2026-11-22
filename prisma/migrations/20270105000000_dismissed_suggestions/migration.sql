CREATE TABLE "DismissedSuggestion" (
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DismissedSuggestion_pkey" PRIMARY KEY ("userId", "gameId"),
  CONSTRAINT "DismissedSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DismissedSuggestion_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DismissedSuggestion_gameId_idx" ON "DismissedSuggestion"("gameId");
