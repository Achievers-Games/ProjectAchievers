/** Longueur que les moteurs affichent sous le titre d'un résultat. */
const SNIPPET = 160;

/** Le début d'un texte Markdown en clair, pour la description d'une page. */
export function excerpt(markdown: string, max = SNIPPET) {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+*]|\d+\.)\s+(?:\[[ xX]\]\s*)?/gm, '')
    .replace(/[#*_>`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
