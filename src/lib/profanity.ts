/**
 * Liste courte et choisie à la main : les listes publiques masquent trop de mots ordinaires
 * (« con » veut dire « avec » en espagnol, « bite » existe en anglais, 奶 signifie « lait »).
 * Un astérisque final accepte toutes les terminaisons. Ces mots-là n'ont de sens innocent
 * dans aucune des langues du site : ils sont masqués partout.
 */
// prettier-ignore
const WORDS = [
  // Français : « nique* » toucherait « niquel ». « Nike » s'écrit comme la marque, mais se lit « nique ».
  'bâtard*', 'bougnoule*', 'conard*', 'conasse*', 'connard*', 'connasse*', 'conne', 'couille*',
  'encul*', 'enfoiré*', 'fdp', 'merde*', 'nègre*', 'nik', 'nike', 'niker', 'nikez', 'nique', 'niqué', 'niquer',
  'niquent', 'niques', 'niquez', 'ntm', 'pédé',
  'pédés', 'pétasse*', 'pouffiasse*', 'putain*', 'pute', 'putes', 'salaud*', 'salope*', 'ta gueule',
  'tepu*', 'youpin*', 'zboub*', 'zgeg*',
  // Anglais : « retard » est un mot ordinaire en français.
  'asshole*', 'bastard*', 'bitch*', 'bullshit*', 'cock', 'cunt*', 'dickhead*', 'fag', 'faggot*',
  'fuck*', 'kys', 'motherf*', 'nigga*', 'nigger*', 'pussy', 'shit', 'shitty', 'slut*', 'wanker*',
  'whore*',
  // Allemand
  'arschloch*', 'fick', 'ficken', 'ficker', 'fickt', 'fotze*', 'hurensohn*', 'missgeburt*',
  'scheiß*', 'scheiss*', 'schlampe*', 'wichser*',
  // Espagnol : sans accent, « coño* » toucherait « conocer », « puto* » toucherait « putois ».
  'cabrón*', 'cabrones', 'gilipollas', 'hijueputa', 'joder', 'jodido*', 'maricón*', 'mierda*',
  'pendejo*', 'puta', 'putas', 'puto', 'putos', 'verga', 'vergas',
  // Portugais
  'arrombado*', 'babaca*', 'buceta*', 'caralho*', 'cuzão*', 'foda*', 'merda*', 'porra*', 'viado*',
  // Russe
  'бляд*', 'блять', 'ебан*', 'ебат*', 'ебло', 'гандон*', 'залуп*', 'мудак*', 'пидор*', 'пизд*',
  'сука', 'суки', 'хуе*', 'хуй*', 'хуя*',
];

/** Le japonais et le chinois n'ont pas d'espaces entre les mots : pas de limite à chercher. */
// prettier-ignore
const JOINED = [
  'キチガイ', 'ガイジ', 'クソ', 'ちんこ', 'まんこ', 'ファック', 'ビッチ', '死ね',
  '傻逼', '操你', '他妈的', '妈的', '草泥马', '婊子', '贱人', '王八蛋', '狗屎', '卧槽',
];

/** Grossiers dans une langue, ordinaires dans une autre : comptés seulement dans la leur. */
// prettier-ignore
const LOCAL: Record<string, string[]> = {
  fr: ['bite', 'bites', 'con', 'cons', 'cul', 'culs', 'nichon*', 'salopard*', 'teub*'],
  en: ['ass', 'asses', 'crap', 'dick', 'dicks', 'retard', 'retarded', 'retards', 'tits'],
  de: ['arsch', 'hure*', 'kacke', 'nutte*', 'schwanz', 'wixer'],
  es: ['coño', 'coños', 'culero*', 'culo', 'marica*', 'polla*', 'zorra*'],
  'pt-BR': ['bicha*', 'corno*', 'cu', 'pau', 'vadia*'],
  ru: ['говно', 'дерьмо', 'жопа', 'срать'],
  ja: ['バカ', 'ブス'],
  'zh-CN': ['混蛋', '奶子', '去死'],
};
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Des morceaux qui ne se cachent dans aucun mot courant : recherchés aussi à l'intérieur des noms. */
// prettier-ignore
const ROOTS = [
  'arschloch', 'bitch', 'caralho', 'connard', 'encule', 'faggot', 'fotze', 'fuck', 'hurensohn',
  'nigga', 'nigger', 'pussy', 'putain', 'salope', 'zboub', 'zgeg', 'пизд', 'хуи',
];

const LEET: Record<string, string> = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  '@': 'a',
  $: 's',
};

/** Retire accents et majuscules sans changer les positions : `censor` masque le texte d'origine. */
const fold = (text: string) =>
  text.replace(/./gsu, (char) => {
    const plain = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return plain.length === char.length ? plain : char;
  });

/** Ce qui peut remplacer une lettre : chiffres et symboles, ou la lettre cyrillique identique. */
const LOOKALIKE: Record<string, string> = {
  a: 'a4@а',
  c: 'cс',
  e: 'e3е',
  i: 'i1!',
  o: 'o0о',
  p: 'pр',
  s: 's5$',
  t: 't7',
};

/** « c.o.n.n.a.r.d » : la ponctuation entre deux lettres ne cache rien. */
const BETWEEN = '[._*\\-]*';

/** Chaque lettre peut être répétée à volonté : « connnnard ». */
const letters = (part: string) =>
  [...part].map((char) => `[${LOOKALIKE[char] ?? char}]+`).join(BETWEEN);

const word = (entry: string) => {
  const stem = fold(entry.replace(/\*$/, '')).split(' ').map(letters).join('\\s+');
  return entry.endsWith('*') ? `${stem}[\\p{L}\\p{N}]*` : stem;
};

/** « c o n n a r d » : des lettres isolées, à recoller avant de juger. */
const SPELLED = /(?<![\p{L}\p{N}])[\p{L}\p{N}](?: +[\p{L}\p{N}]){2,}(?![\p{L}\p{N}])/gu;

const patterns = new Map<string, RegExp>();

function patternFor(locale?: string | null) {
  const key = locale ?? '';
  const known = patterns.get(key);
  if (known) return known;
  const local = LOCAL[key] ?? [];
  const spaced = [...WORDS, ...local.filter((entry) => !UNSPACED.test(entry))].map(word);
  const joined = [...JOINED, ...local.filter((entry) => UNSPACED.test(entry))].map(fold);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${spaced.join('|')})(?![\\p{L}\\p{N}])|${joined.join('|')}`,
    'gu',
  );
  patterns.set(key, pattern);
  return pattern;
}
const FOLDED_ROOTS = ROOTS.map(fold);

/**
 * Remplace chaque grossièreté par autant d'astérisques que de caractères.
 * `locale` est la langue de l'auteur : un texte ancien sans langue reçoit le filtre commun.
 */
export function censor(text: string, locale?: string | null) {
  const pattern = patternFor(locale);
  let shown = '';
  let position = 0;
  for (const match of fold(text).matchAll(pattern)) {
    // « 455 » ressemble à « ass » : un nombre seul n'insulte personne.
    if (!/\p{L}/u.test(match[0])) continue;
    shown += text.slice(position, match.index) + '*'.repeat([...match[0]].length);
    position = match.index + match[0].length;
  }
  return (shown + text.slice(position)).replace(SPELLED, (run) =>
    fold(run).replace(/ /g, '').search(pattern) >= 0 ? '*'.repeat([...run].length) : run,
  );
}

/** Pour un nom, plus strict qu'un message : « sh1t » ou « f.u.c.k » ne passent pas. */
export function isProfane(name: string, locale?: string | null) {
  const pattern = patternFor(locale);
  const plain = fold(name).replace(/[013457@$]/g, (char) => LEET[char] ?? char);
  const joined = plain.replace(/[^\p{L}\p{N}]/gu, '');
  return (
    plain.search(pattern) >= 0 ||
    joined.search(pattern) >= 0 ||
    FOLDED_ROOTS.some((root) => joined.includes(root))
  );
}
