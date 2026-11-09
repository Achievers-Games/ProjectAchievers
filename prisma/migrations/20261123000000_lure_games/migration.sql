-- CreateTable
CREATE TABLE "LureGame" (
    "steamAppId" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "url" TEXT,
    "mainMinutes" INTEGER,
    "normalMinutes" INTEGER,
    "completionistMinutes" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LureGame_pkey" PRIMARY KEY ("steamAppId")
);
