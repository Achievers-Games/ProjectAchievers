ALTER TYPE "Provider" ADD VALUE 'RETRO';
ALTER TYPE "Platform" ADD VALUE 'RETRO';

ALTER TABLE "PsnVerification" ADD COLUMN "provider" "Provider" NOT NULL DEFAULT 'PSN';
