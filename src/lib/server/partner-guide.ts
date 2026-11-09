import { Marked, type Tokens } from 'marked';

// Le guide des partenaires, tel qu'il est versionné : la page et le fichier envoyé ne divergent pas.
const FILES = import.meta.glob<string>('/docs/api-partenaires.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** L'ancre d'un titre, comme celles du sommaire : minuscules, ponctuation retirée, tirets. */
export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      const id = headingId(text);
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

let cached: { title: string; html: string } | null = null;

/**
 * Le guide en HTML. Il vient du dépôt, pas d'un utilisateur : il peut garder ses tableaux et ses
 * blocs de code. Le titre de premier niveau sert de titre à la page.
 */
export function partnerGuide() {
  if (cached) return cached;
  const source = Object.values(FILES)[0] ?? '';
  const [, title = 'API partenaires Achievers'] = /^# (.+)$/m.exec(source) ?? [];
  const html = marked.parse(source.replace(/^# .+\n/m, ''), { async: false }) as string;
  cached = { title, html };
  return cached;
}
