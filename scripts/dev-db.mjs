// PostgreSQL de développement sans Docker : lance un serveur local sur le port 5433.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = '.pgdata';
const isNew = !existsSync(`${dataDir}/PG_VERSION`);
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'achievers',
  password: 'achievers',
  port: 5433,
  persistent: true,
  onLog: () => {},
});

if (isNew) await pg.initialise();
await pg.start();
if (isNew) await pg.createDatabase('achievers');
console.log('PostgreSQL prêt sur localhost:5433');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await pg.stop();
    process.exit(0);
  });
}
