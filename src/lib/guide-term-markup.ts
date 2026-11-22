// Le nom anglais sert de référence lisible dans le Markdown et de repli.
const TERM = /\{\{terme:([^{}\r\n]+)\}\}/g;

export function resolveGuideTerms(
  source: string,
  resolve: (name: string) => string = (name) => name,
) {
  return source.replace(TERM, (_, name: string) => resolve(name));
}
