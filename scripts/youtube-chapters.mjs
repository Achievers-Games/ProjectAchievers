// Trouve les vidéos d'un guide et leurs chapitres, pour les liens « vidéo » des guides officiels.
// Usage : node scripts/youtube-chapters.mjs "PowerPyx Elden Ring legendary talismans"
// Lit YOUTUBE_API_KEY dans le .env ; la clé n'est jamais affichée.
import 'dotenv/config';

const key = process.env.YOUTUBE_API_KEY;
const query = process.argv.slice(2).join(' ');
if (!key || !query) {
  console.error(
    'Usage : node scripts/youtube-chapters.mjs "recherche" (YOUTUBE_API_KEY dans .env)',
  );
  process.exit(1);
}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value);
  const body = await (await fetch(url)).json();
  if (body.error) throw new Error(`YouTube ${body.error.code} : ${body.error.message}`);
  return body.items;
}

const found = await api('search', { part: 'snippet', type: 'video', maxResults: '5', q: query });
const videos = await api('videos', {
  part: 'snippet,status',
  id: found.map((item) => item.id.videoId).join(','),
});

/** Les chapitres d'une description : toute ligne qui contient un horodatage. */
const toSeconds = (stamp) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);

for (const video of videos) {
  const embed = video.status.embeddable ? '' : ' (intégration désactivée par l’auteur)';
  console.log(`\n${video.snippet.title} — ${video.snippet.channelTitle}${embed}`);
  console.log(`https://youtu.be/${video.id}`);
  for (const line of video.snippet.description.split('\n')) {
    const stamp = /\b(\d{1,2}(?::\d\d){1,2})\b/.exec(line)?.[1];
    if (stamp)
      console.log(`  ${line.trim()}  →  https://youtu.be/${video.id}?t=${toSeconds(stamp)}`);
  }
}
