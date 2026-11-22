interface OutlineEntry {
  id: string;
  level: 2 | 3;
  text: string;
}

const HEADING = /<h([1-4])>([\s\S]*?)<\/h\1>/g;
const ANCHORED = /<h([23]) id="(partie-\d+)">([\s\S]*?)<\/h\1>/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** Le texte affiché d'un fragment déjà assaini, sans balises ni entités. */
export const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity)
    .trim();

/**
 * Numérote les parties d'un guide déjà assaini pour le sommaire.
 * Le titre du guide occupe le `h1` de la page : les niveaux du texte descendent d'un cran au besoin.
 */
export function anchorHeadings(html: string): string {
  let index = 0;
  return html.replace(HEADING, (_, level: string, inner: string) => {
    const shifted = Math.max(2, Number(level));
    if (shifted > 3) return `<h4>${inner}</h4>`;
    return `<h${shifted} id="partie-${++index}">${inner}</h${shifted}>`;
  });
}

/** Le sommaire suit le texte affiché : l'original ou sa traduction. */
export function outlineOf(html: string): OutlineEntry[] {
  return [...html.matchAll(ANCHORED)].map(([, level, id, inner]) => ({
    id: id as string,
    level: Number(level) as 2 | 3,
    text: plainText(inner as string),
  }));
}
