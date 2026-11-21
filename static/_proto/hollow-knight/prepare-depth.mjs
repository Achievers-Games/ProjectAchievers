// Prépare les plans de profondeur du décor à partir de bg.jpg (sortie LaMa).
// - bg-far.jpg : décor sans les épines du premier plan, stries LaMa adoucies.
// - thorns.png : épines noires du premier plan, détourées depuis les pixels originaux.
// - bg-depth.png : profondeur lissée du décor (0 = fond lumineux, 1 = proche).
// Exécution : node static/_proto/hollow-knight/prepare-depth.mjs (Playwright du dépôt).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const dataUrl = (file, type) => `data:${type};base64,` + readFileSync(join(root, file)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async ({ bgUrl, maskUrl }) => {
  const load = async src => { const i = new Image(); i.src = src; await i.decode(); return i; };
  const [bg, maskImage] = await Promise.all([load(bgUrl), load(maskUrl)]);
  const W = bg.width, H = bg.height, N = W * H;
  const pixels = image => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    g.drawImage(image, 0, 0);
    return g.getImageData(0, 0, W, H).data;
  };
  const src = pixels(bg), maskData = pixels(maskImage);
  const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

  // Flou de boîte séparable sur un canal flottant.
  const boxBlur = (input, radius, horizontal = true, vertical = true) => {
    let a = Float32Array.from(input), b = new Float32Array(N);
    const pass = (from, to, dx) => {
      for (let line = 0; line < (dx ? H : W); line++) {
        const len = dx ? W : H;
        const at = i => dx ? line * W + i : i * W + line;
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += from[at(Math.min(len - 1, Math.max(0, i)))];
        for (let i = 0; i < len; i++) {
          to[at(i)] = sum / (radius * 2 + 1);
          sum += from[at(Math.min(len - 1, i + radius + 1))] - from[at(Math.max(0, i - radius))];
        }
      }
    };
    if (horizontal) { pass(a, b, true); [a, b] = [b, a]; }
    if (vertical) { pass(a, b, false); [a, b] = [b, a]; }
    return a;
  };
  const channel = (data, k) => { const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = data[i * 4 + k]; return c; };
  let rgb = [0, 1, 2].map(k => channel(src, k));

  // 1. Les stries verticales laissées par LaMa derrière le personnage sont adoucies
  //    par un flou horizontal limité à la zone reconstruite.
  const grown = boxBlur(channel(maskData, 0), 45).map(v => v > 4 ? 255 : 0);
  const hole = boxBlur(boxBlur(grown, 16), 16);
  rgb = rgb.map(c => {
    let streak = c;
    for (let i = 0; i < 3; i++) streak = boxBlur(streak, 9, true, false);
    streak = boxBlur(streak, 2, false, true);
    return c.map((v, i) => v + (streak[i] - v) * Math.min(1, hole[i] / 160));
  });

  // 2. Épines du premier plan : silhouettes noires dans deux zones du cadre.
  const thorn = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const left = x >= 195 && x <= 345 && y >= 425;
    const right = x >= 985 && y >= 290;
    if (!left && !right) continue;
    const i = y * W + x;
    const peak = Math.max(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    thorn[i] = 1 - smooth(6, 26, peak);
  }
  // Retire les petits îlots isolés : on ne garde que les pixels proches d'un cœur opaque.
  const core = boxBlur(thorn.map(v => v > 0.95 ? 1 : 0), 4);
  for (let i = 0; i < N; i++) if (core[i] < 0.35) thorn[i] *= smooth(0.05, 0.35, core[i]);

  // 3. Le décor caché derrière les épines est rempli par diffusion pyramidale.
  const holeMask = boxBlur(thorn, 4).map(v => v > 0.02 ? 1 : 0);
  const fill = c => {
    const levels = [{ w: W, h: H, v: c.map((v, i) => v * (1 - holeMask[i])), k: holeMask.map(m => 1 - m) }];
    while (levels.at(-1).w > 2) {
      const p = levels.at(-1), w = Math.ceil(p.w / 2), h = Math.ceil(p.h / 2);
      const v = new Float32Array(w * h), k = new Float32Array(w * h);
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const j = (y >> 1) * w + (x >> 1), i = y * p.w + x;
        v[j] += p.v[i]; k[j] += p.k[i];
      }
      levels.push({ w, h, v, k });
    }
    for (let l = levels.length - 2; l >= 0; l--) {
      const p = levels[l], q = levels[l + 1];
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const i = y * p.w + x;
        const fx = Math.min(q.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(q.h - 1, Math.max(0, (y - 0.5) / 2));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(q.w - 1, x0 + 1), y1 = Math.min(q.h - 1, y0 + 1);
        const ax = fx - x0, ay = fy - y0;
        const at = (xx, yy) => { const j = yy * q.w + xx; return q.k[j] > 0 ? q.v[j] / q.k[j] : 0; };
        const coarse = (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
        const known = Math.min(1, p.k[i]);
        const own = p.k[i] > 0 ? p.v[i] / p.k[i] : 0;
        p.v[i] = own * known + coarse * (1 - known);
        p.k[i] = 1;
      }
    }
    // Lissage des raccords à l'intérieur du trou seulement.
    const filled = levels[0].v, soft = boxBlur(boxBlur(boxBlur(filled, 6), 6), 6);
    const edge = boxBlur(holeMask, 5);
    // Un grain léger évite l'aspect lisse du remplissage.
    return filled.map((v, i) => { const mix = holeMask[i] ? 1 : Math.min(1, edge[i] * 2); const grain = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 3; return v + (soft[i] + grain - v) * mix; });
  };
  rgb = rgb.map(fill);

  // 4. Profondeur : le peintre éclaircit les plans lointains, on suit donc la luminance.
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.299 * rgb[0][i] + 0.587 * rgb[1][i] + 0.114 * rgb[2][i];
  let depth = lum.map((v, i) => {
    const y = Math.floor(i / W) / H;
    return Math.min(1, Math.pow(Math.max(0, 1 - v / 175), 1.3) * 0.85 + y * 0.12);
  });
  for (let i = 0; i < 3; i++) depth = boxBlur(depth, 14);

  const encode = async (fillPixel, type, quality) => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
    for (let i = 0; i < N; i++) fillPixel(img.data, i);
    g.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type, quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return {
    far: await encode((d, i) => { d[i * 4] = rgb[0][i]; d[i * 4 + 1] = rgb[1][i]; d[i * 4 + 2] = rgb[2][i]; d[i * 4 + 3] = 255; }, 'image/jpeg', 0.93),
    thorns: await encode((d, i) => { d[i * 4] = 2; d[i * 4 + 1] = 4; d[i * 4 + 2] = 8; d[i * 4 + 3] = thorn[i] * 255; }, 'image/png'),
    depth: await encode((d, i) => { const v = depth[i] * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }, 'image/png'),
  };
}, { bgUrl: dataUrl('bg.jpg', 'image/jpeg'), maskUrl: dataUrl('background-mask.png', 'image/png') });
await browser.close();

writeFileSync(join(root, 'bg-far.jpg'), Buffer.from(out.far, 'base64'));
writeFileSync(join(root, 'thorns.png'), Buffer.from(out.thorns, 'base64'));
writeFileSync(join(root, 'bg-depth.png'), Buffer.from(out.depth, 'base64'));
console.log('Prepared bg-far.jpg, thorns.png and bg-depth.png.');
