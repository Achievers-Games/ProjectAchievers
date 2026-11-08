-- Achievers fournisseur OAuth 2 : les clients partenaires, les accords des joueurs et leurs jetons.
ALTER TABLE "PartnerApp" ADD COLUMN "oauthClientId" TEXT;
ALTER TABLE "PartnerApp" ADD COLUMN "oauthSecretHash" TEXT;
ALTER TABLE "PartnerApp" ADD COLUMN "oauthRedirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "PartnerApp_oauthClientId_key" ON "PartnerApp"("oauthClientId");

CREATE TABLE "OAuthGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "codeChallenge" TEXT,
    "redirectUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthGrant_userId_appId_key" ON "OAuthGrant"("userId", "appId");
CREATE UNIQUE INDEX "OAuthToken_hash_key" ON "OAuthToken"("hash");
CREATE INDEX "OAuthToken_grantId_idx" ON "OAuthToken"("grantId");

ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_appId_fkey" FOREIGN KEY ("appId") REFERENCES "PartnerApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
