// Régénère src/lib/server/site-icons.ts depuis game-icons.net : `node scripts/site-icons.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Le dessin de chaque succès du site, par nom d'icône game-icons.net. */
const ICONS = {
  first_account: 'gamepad',
  two_platforms: 'linked-rings',
  three_platforms: 'stack',
  makeover: 'paint-brush',
  storefront: 'shop',
  ring_me: 'ringing-bell',
  stage_name: 'domino-mask',
  painful_compare: 'scales',
  cards_1: 'card-pickup',
  cards_10: 'card-play',
  cards_50: 'card-random',
  cards_100: 'phone',
  cards_250: 'skull-crossed-bones',
  gold_1: 'sparkles',
  gold_10: 'target-arrows',
  gold_25: 'binoculars',
  diamond_1: 'cut-diamond',
  prismatic_1: 'prism',
  bronze_25: 'sun',
  copies2_1: 'mirror-mirror',
  copies2_5: 'cycle',
  wide_gap: 'acrobatic',
  reverse_gear: 'back-forth',
  shiny_double: 'gem-pendant',
  second_helping: 'knife-fork',
  legendary: 'crown',
  game_100: 'stop-sign',
  game_500: 'broken-skull',
  small_10: 'cupcake',
  borderless: 'world',
  unlocks_100: 'flame',
  unlocks_1000: 'mountains',
  unlocks_5000: 'mountain-climbing',
  unlocks_10000: 'suitcase',
  unlocks_20000: 'siren',
  rare_1: 'clover',
  rare_50: 'whip',
  ultra_rare: 'hand',
  podium: 'podium',
  hours_100: 'hearts',
  hours_1000: 'house',
  quick_1: 'stopwatch',
  quick_5: 'run',
  library_500: 'cardboard-box',
  library_1000: 'bookshelf',
  stalled_5: 'battery-25',
  almost: 'battery-75',
  stalled_25: 'pill',
  unfinished_100: 'tombstone',
  unfinished_500: 'graveyard',
  barely_played_50: 'shopping-cart',
  sealed_100: 'locked-chest',
  resurrection: 'raise-zombie',
  one_left: 'jigsaw-piece',
  one_more_10: 'coffee-cup',
  one_more_50: 'night-sleep',
  yet_another: 'card-draw',
  withdrawal: 'cigarette',
  friend_1: 'shaking-hands',
  friends_10: 'three-friends',
  clan_join: 'shield',
  clan_5: 'wolf-head',
  messages_100: 'talk',
  comment_1: 'chat-bubble',
  comments_50: 'megaphone',
  reactions_10: 'thumb-up',
  guide_done: 'checklist',
  snitch: 'whistle',
  support: 'auto-repair',
  season_tier2: 'upgrade',
  season_tier3: 'trophy-cup',
  season_finish_1: 'broadsword',
  season_finish_3: 'bloody-sword',
  season_goal: 'team-idea',
  founder: 'flag-objective',
  midnight: 'moon',
  friday13: 'jason-mask',
  birthday: 'cake-slice',
  christmas: 'pine-tree',
  new_year: 'party-popper',
  night_owl: 'owl',
  monk: 'monk-face',
  world_tour: 'airplane-departure',
  hare: 'rabbit',
  alphabet: 'open-book',
  rarest_last: 'diamond-trophy',
  nights_1001: 'magic-lamp',
  forty_two: 'towel',
  soulmates: 'lovers',
  twins: 'two-shadows',
  perfect_clan: 'crossed-swords',
  grand_slam: 'tennis-racket',
  full_set: 'cubes',
  four_of_a_kind: 'poker-hand',
  straight: 'card-joker',
  legend_double: 'castle',
  six_months: 'calendar',
  last_word: 'scroll-unfurled',
  first_ever: 'rocket',
  only_one: 'palm-tree',
  deserter: 'exit-door',
  mood_swing: 'drama-masks',
  dark_hours: 'candle-flame',
  comfort_zone: 'armchair',
  genre_tour_10: 'swiss-army-knife',
  genre_tour_20: 'toolbox',
  genre_tour_30: 'backpack',
  genre_tour_40: 'world',
  bad_influence: 'devil-mask',
  insomniacs: 'barn-owl',
  ghost_clan: 'floating-ghost',
  nobody_behind: 'meeple-circle',
  loyal: 'laurel-crown',
};

/** Un dessin par genre ou thème, commun à tous ses paliers. */
const GENRE_ICONS = {
  horror: 'haunting',
  roguelike: 'dice-twenty-faces-twenty',
  platformer: 'jump-across',
  puzzle: 'puzzle',
  rpg: 'sword-in-stone',
  shooter: 'crosshair',
  racing: 'race-car',
  sports: 'soccer-ball',
  strategy: 'chess-knight',
  simulation: 'gears',
  survival: 'campfire',
  cozy: 'teapot',
  cute: 'bear-face',
  open_world: 'compass',
  short: 'hourglass',
  pixel: 'retro-controller',
  anime: 'katana',
  deck: 'card-exchange',
  point_click: 'click',
  stealth: 'hood',
  fighting: 'boxing-glove',
  rhythm: 'musical-notes',
  visual_novel: 'book-cover',
  shmup: 'starfighter',
  zombies: 'shambling-zombie',
  difficult: 'skull-crack',
  soulslike: 'fire-bowl',
  metroidvania: 'treasure-map',
  jrpg: 'crystal-ball',
  cats: 'cat',
  dinosaurs: 'dinosaur-rex',
  pirates: 'pirate-flag',
  space: 'ringed-planet',
  vampires: 'vampire-dracula',
  ninja: 'ninja-head',
  lovecraft: 'floating-tentacles',
  robots: 'robot-golem',
  dragons: 'dragon-head',
  cooking: 'cooking-pot',
  fishing: 'fishing-hook',
  farming: 'farm-tractor',
  western: 'outback-hat',
  time_travel: 'backward-time',
  detective: 'magnifying-glass',
  story_rich: 'scroll-unfurled',
  choices: 'split-arrows',
  arcade: 'joystick',
  retro: 'game-console',
  comedy: 'jester-hat',
  sci_fi: 'laser-blast',
  fantasy: 'wizard-staff',
  exploration: 'compass',
  atmospheric: 'fog',
  psychological: 'brain',
  sandbox: 'sand-castle',
  city_builder: 'modern-city',
  tower_defense: 'watchtower',
  hack_slash: 'crossed-swords',
  beat_em_up: 'punch',
  tactics: 'chess-knight',
  walking_sim: 'walking-boot',
  mystery: 'secret-book',
  post_apo: 'radioactive',
  management: 'pie-chart',
  casual_puzzle: 'gems',
  idle: 'hourglass',
  dungeon_crawler: 'dungeon-gate',
  military: 'tank',
  cyberpunk: 'cyber-eye',
  steampunk: 'steampunk-goggles',
  mythology: 'greek-temple',
  aliens: 'alien-stare',
  superhero: 'domino-mask',
  magic: 'magic-swirl',
  demons: 'devil-mask',
  werewolves: 'wolf-howl',
  gothic: 'gothic-cross',
  samurai: 'katana',
  vikings: 'viking-helmet',
  dogs: 'sitting-dog',
  horses: 'horse-head',
  underwater: 'diving-helmet',
  snow: 'snowflake-1',
  mars: 'mars-curiosity',
  trains: 'steam-locomotive',
  flight: 'airplane',
  naval: 'battleship',
  heist: 'robber-mask',
  assassin: 'cloak-dagger',
  martial_arts: 'black-belt',
  football: 'soccer-ball',
  golf: 'golf-flag',
  skate: 'skateboard',
  hunting: 'hunting-horn',
  pinball: 'pinball-flipper',
  board_games: 'chess-king',
  words: 'quill-ink',
  music: 'musical-notes',
};
/** Un dessin par série d'amis ou de clan, commun à tous ses paliers. */
const SERIES_ICONS = {
  duo: 'high-five',
  revenge: 'fist',
  teammates: 'team-idea',
  synchro: 'time-synchronization',
  prescriber: 'megaphone',
  same_taste: 'mirror-mirror',
  guild: 'knight-banner',
  clan_collection: 'open-treasure-chest',
  clan_range: 'rainbow-star',
  raid: 'dragon-head',
  clan_night: 'campfire',
  all_in: 'meeple-group',
  marathon: 'running-shoe',
  together_season: 'calendar',
  band: 'meeple-army',
};
const UNKNOWN = 'uncertainty';

const require = createRequire(import.meta.url);
const set = JSON.parse(
  readFileSync(require.resolve('@iconify-json/game-icons/icons.json'), 'utf8'),
);
const names = [
  ...new Set([
    ...Object.values(ICONS),
    ...Object.values(GENRE_ICONS),
    ...Object.values(SERIES_ICONS),
    UNKNOWN,
  ]),
];
const missing = names.filter((name) => !set.icons[name]);
if (missing.length) {
  console.error('Icônes introuvables :', missing.join(', '));
  process.exit(1);
}

const record = (map) =>
  Object.entries(map)
    .map(([key, name]) => `  ${key}: '${name}',`)
    .join('\n');
writeFileSync(
  'src/lib/server/site-icons.ts',
  `// Généré par scripts/site-icons.mjs : ne pas modifier à la main.
// Icônes de game-icons.net (Lorc, Delapouite et contributeurs), sous licence CC BY 3.0.
import type { BaseCode, GenreKey, SeriesKey } from '#lib/site-achievements';

/** Les dessins, en tracé SVG sur 512 × 512. */
export const ICON_PATHS = {
${names.map((name) => `  '${name}': ${JSON.stringify(set.icons[name].body)},`).join('\n')}
};

export type IconName = keyof typeof ICON_PATHS;

export const SITE_ICON: Record<BaseCode, IconName> = {
${record(ICONS)}
};

export const GENRE_ICON: Record<GenreKey, IconName> = {
${record(GENRE_ICONS)}
};

export const SERIES_ICON: Record<SeriesKey, IconName> = {
${record(SERIES_ICONS)}
};

/** Un secret pas encore découvert : rien ne doit trahir sa condition. */
export const UNKNOWN_ICON: IconName = '${UNKNOWN}';
`,
);
console.log(`${names.length} dessins écrits`);
