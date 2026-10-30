// Base dédiée aux tests Playwright : recréée à chaque lancement, elle laisse les vraies données
// du développement intactes.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
const testDatabase = 'achievers_e2e';

url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${testDatabase} ENCODING 'UTF8' LOCALE 'C' TEMPLATE template0`);
await admin.end();

url.pathname = `/${testDatabase}`;
const env = { ...process.env, DATABASE_URL: url.href };
execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
execSync('npm run db:seed', { env, stdio: 'ignore' });
