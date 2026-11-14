// Les migrations du dépôt portent des dates en avance sur le calendrier, une par jour : Prisma
// les applique dans l'ordre de leur nom. Une migration créée aujourd'hui par `prisma migrate dev`
// prendrait l'heure réelle et se classerait avant elles. Ce script la renomme juste après la
// dernière migration du dépôt, tant qu'elle n'est pas encore suivie par git.
import { execSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';

const DIR = 'prisma/migrations';
const stamp = (name) => name.slice(0, 14);

const tracked = new Set(
  execSync(`git ls-files ${DIR}`, { encoding: 'utf8' })
    .split('\n')
    .map((path) => path.split('/')[2])
    .filter(Boolean),
);
const folders = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

let last = folders
  .filter((name) => tracked.has(name))
  .map(stamp)
  .sort()
  .at(-1);

const nextDay = (value) => {
  const date = new Date(
    Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8) + 1),
  );
  return date.toISOString().slice(0, 10).replaceAll('-', '') + '000000';
};

for (const name of folders.filter((folder) => !tracked.has(folder))) {
  if (last && stamp(name) <= last) {
    const renamed = `${nextDay(last)}${name.slice(14)}`;
    renameSync(`${DIR}/${name}`, `${DIR}/${renamed}`);
    console.log(`Migration renommée : ${name} → ${renamed}`);
    last = stamp(renamed);
  } else {
    last = stamp(name);
  }
}
