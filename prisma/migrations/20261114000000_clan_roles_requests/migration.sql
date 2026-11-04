-- Chef, officier ou membre : le rôle remplace le drapeau « owner ».
CREATE TYPE "ClanRole" AS ENUM ('OWNER', 'OFFICER', 'MEMBER');

ALTER TABLE "ClanMember" ADD COLUMN "role" "ClanRole" NOT NULL DEFAULT 'MEMBER';

-- Le chef existant devient propriétaire du clan.
UPDATE "ClanMember" SET "role" = 'OWNER' WHERE "owner" = true;

ALTER TABLE "ClanMember" DROP COLUMN "owner";

-- Une demande d'adhésion, sans devoir être ami avec le chef.
CREATE TABLE "ClanRequest" (
    "clanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClanRequest_pkey" PRIMARY KEY ("clanId","userId")
);

CREATE INDEX "ClanRequest_userId_idx" ON "ClanRequest"("userId");

ALTER TABLE "ClanRequest" ADD CONSTRAINT "ClanRequest_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClanRequest" ADD CONSTRAINT "ClanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
