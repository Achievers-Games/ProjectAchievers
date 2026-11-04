import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 ne lit plus `.env` ni l'URL du schéma : tout se configure ici.
// L'URL reste optionnelle à ce niveau pour que `prisma generate` (postinstall, image Docker)
// fonctionne sans base de données.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
