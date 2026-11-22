import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { renderGuide } from '#lib/guide-preview';

const LINKS = {
  a: sanitizeHtml.simpleTransform('a', {
    rel: 'nofollow noopener noreferrer',
    target: '_blank',
  }),
};

/** Convertit le Markdown des utilisateurs en HTML sûr : aucune balise hors de la liste ne passe. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'code',
      'pre',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h3',
      'h4',
      'a',
      'hr',
    ],
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    allowedSchemes: ['http', 'https'],
    transformTags: LINKS,
  });
}

// Un seul rendu des guides, partagé avec l'aperçu du navigateur : deux copies finiraient par
// afficher à l'auteur autre chose que ce que le site publie.
export { renderGuide };

/** Compte les cases rendues, sans prendre les exemples dans les blocs de code. */
export const countChecklist = (contentMd: string) =>
  renderGuide(contentMd).match(/data-check="/g)?.length ?? 0;
