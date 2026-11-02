-- CreateTable
CREATE TABLE "ServiceToken" (
    "name" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "okAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ServiceToken_pkey" PRIMARY KEY ("name")
);
