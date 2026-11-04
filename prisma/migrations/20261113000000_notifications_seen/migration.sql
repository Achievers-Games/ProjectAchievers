-- Dernier point lu du centre de notifications : succès et jeux terminés avant cette date.
ALTER TABLE "User" ADD COLUMN "notificationsSeenAt" TIMESTAMP(3);

-- Une invitation de clan se retrouve par joueur, pas par clan.
CREATE INDEX "ClanInvite_userId_idx" ON "ClanInvite"("userId");
