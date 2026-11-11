// Génère le runtime de Paraglide avec les réglages du site, pour `npm run check` : la commande
// `paraglide-js compile` ne connaît pas les adresses par langue (urlPatterns).
import { compile } from '@inlang/paraglide-js';
import { paraglideOptions } from '../paraglide.options.mjs';

await compile(paraglideOptions);
console.log('Paraglide compilé avec les réglages du site.');
