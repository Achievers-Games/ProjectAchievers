import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { resolveGuideTerms } from './guide-term-markup';

const LINKS = {
  a: sanitizeHtml.simpleTransform('a', {
    rel: 'nofollow noopener noreferrer',
    target: '_blank',
  }),
};

const YOUTUBE = /^https:\/\/(?:www\.youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;
const VIDEO = /\.(?:mp4|webm)(?:\?.*)?$/i;

const attribute = (text: string) => text.replaceAll('"', '&quot;');

/** Dans un guide, une image peut aussi être une vidéo : `![légende](adresse)`. */
const guideMarked = new Marked({
  gfm: true,
  renderer: {
    image({ href, text }) {
      const youtube = YOUTUBE.exec(href)?.[1];
      if (youtube) {
        const start = /[?&]t=(\d+)s?(?:&|$)/.exec(href)?.[1];
        const src = `https://www.youtube-nocookie.com/embed/${youtube}${start ? `?start=${start}` : ''}`;
        return `<iframe src="${src}" title="${attribute(text)}" allowfullscreen loading="lazy"></iframe>`;
      }
      if (VIDEO.test(href)) {
        return `<video src="${attribute(href)}" controls preload="metadata" playsinline></video>`;
      }
      return `<img src="${attribute(href)}" alt="${attribute(text)}" loading="lazy" />`;
    },
  },
});

/**
 * Le rendu d'un guide, le même sur le serveur (`#lib/server/markdown` le réexporte) et dans
 * l'aperçu du navigateur. Un guide va plus loin qu'un commentaire : titres, médias et cases à
 * cocher y sont permis.
 */
export function renderGuide(source: string, termName?: (name: string) => string): string {
  const html = sanitizeHtml(
    guideMarked.parse(resolveGuideTerms(source, termName), { async: false }) as string,
    {
      allowedTags: [
        ...(sanitizeHtml.defaults.allowedTags as string[]),
        'h2',
        'h3',
        'h4',
        'img',
        'video',
        'iframe',
        'input',
      ],
      allowedAttributes: {
        a: ['href', 'rel', 'target'],
        img: ['src', 'alt', 'loading'],
        video: ['src', 'controls', 'preload', 'playsinline'],
        iframe: ['src', 'title', 'allowfullscreen', 'loading'],
        input: ['type'],
      },
      allowedSchemes: ['https'],
      allowedIframeHostnames: ['www.youtube-nocookie.com'],
      transformTags: LINKS,
    },
  );
  // Le rang identifie la case : il reste le même dans toutes les traductions du guide.
  let item = 0;
  return html.replace(/<input[^>]*>/g, () => `<input type="checkbox" data-check="${item++}" />`);
}
