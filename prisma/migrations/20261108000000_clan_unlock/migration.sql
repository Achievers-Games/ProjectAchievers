-- Les succès gagnés par un clan entier.
CREATE TABLE "ClanUnlock" (
    "clanId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClanUnlock_pkey" PRIMARY KEY ("clanId","code")
);

ALTER TABLE "ClanUnlock" ADD CONSTRAINT "ClanUnlock_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
