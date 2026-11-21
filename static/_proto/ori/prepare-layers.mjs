// Prépare les calques de la carte Ori à partir du hero Steam, sans Python.
// Exécution : node static/_proto/ori/prepare-layers.mjs (Chromium du Playwright du dépôt).
//
// Les calques gardent toute la largeur du hero (1920 × 620). La carte n'en montre qu'une
// fenêtre de 1326 px : la caméra dispose ainsi de vraie image sur les côtés.
//
// - Contours guidés (polygones ci-dessous) affinés par un modèle de couleurs, à la manière
//   de GrabCut : dans une bande autour du contour, chaque pixel est attribué au personnage
//   ou au décor selon les couleurs les plus proches de part et d'autre.
// - Le décor caché est rempli par diffusion pyramidale. Le calque de Ku est aussi complété
//   sous l'oreille d'Ori, pour que l'oreille puisse bouger.
// - depth.png : profondeur du décor (rouge), racines lumineuses (vert, pour les lueurs) et
//   zone adoucie des racines (bleu, pour leur ondulation).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
export const WINDOW = [400, 0, 1326, 620];

const KU = [
  [1222, 250], [1222, 220], [1227, 207], [1240, 190], [1260, 178], [1273, 170], [1287, 168],
  [1300, 173], [1318, 184], [1330, 193], [1340, 207], [1328, 204], [1317, 203], [1310, 217],
  [1330, 250], [1347, 267], [1365, 282], [1377, 290], [1392, 298], [1392, 320], [1380, 337],
  [1370, 367], [1360, 383], [1360, 403], [1340, 418], [1307, 415], [1287, 412], [1257, 415],
  [1245, 408], [1258, 390], [1250, 363], [1237, 337], [1227, 307], [1221, 277],
];
const ORI = [
  [1326, 306], [1345, 290], [1365, 276], [1386, 262], [1370, 246], [1372, 238], [1392, 236],
  [1404, 226], [1422, 230], [1440, 236], [1452, 246], [1446, 262], [1433, 276], [1432, 292],
  [1446, 306], [1455, 320], [1460, 346], [1452, 354], [1445, 348], [1442, 372], [1440, 398],
  [1430, 401], [1427, 378], [1420, 376], [1418, 398], [1404, 403], [1400, 386], [1394, 370],
  [1380, 377], [1364, 381], [1359, 371], [1374, 362], [1390, 352], [1394, 332], [1386, 312],
  [1360, 306],
];
const BRANCH = [
  [470, 548], [560, 545], [600, 540], [640, 528], [680, 510], [700, 500], [720, 490], [760, 478], [800, 470],
  [840, 462], [880, 455], [920, 450], [960, 445], [1000, 440], [1040, 436], [1100, 430],
  [1160, 425], [1220, 418], [1280, 412], [1340, 405], [1400, 395], [1450, 382], [1500, 370],
  [1550, 360], [1600, 352], [1650, 345], [1685, 342], [1670, 358], [1640, 378], [1600, 402],
  [1560, 430], [1520, 455], [1495, 480], [1475, 520], [1455, 565], [1440, 620], [470, 620],
];
const SPROUTS = [
  [[697, 500], [693, 460], [700, 445], [712, 443], [722, 452], [718, 470], [712, 490], [712, 500]],
  [[788, 492], [790, 475], [800, 468], [812, 472], [815, 488]],
  [[893, 470], [895, 450], [905, 438], [915, 442], [905, 455], [900, 470]],
  [[900, 452], [1000, 432], [1058, 420], [1062, 426], [1000, 440], [905, 458]],
  [[1490, 372], [1495, 330], [1492, 310], [1500, 300], [1510, 305], [1508, 335], [1512, 370]],
  [[1530, 365], [1545, 330], [1550, 310], [1560, 298], [1568, 305], [1558, 330], [1545, 362]],
  [[1440, 374], [1452, 358], [1475, 360], [1482, 374]],
];
const FRONT = [
  [0, 498], [150, 505], [160, 520], [165, 480], [180, 468], [200, 470], [210, 490], [220, 470],
  [240, 460], [265, 453], [290, 458], [305, 475], [310, 505], [330, 510], [400, 508],
  [500, 510], [560, 515], [600, 528], [620, 545], [612, 620], [0, 620],
];
const TRUNK = [
  [790, 180], [850, 0], [1100, 0], [1180, 190], [1200, 300], [1150, 420], [900, 440],
  [800, 330],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(async args => {
  const { src, polygons } = args;
  const image = new Image(); image.src = src; await image.decode();
  const W = image.width, H = image.height, N = W * H;
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d');
  g.drawImage(image, 0, 0);
  const pix = g.getImageData(0, 0, W, H).data;
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

  const boxBlur = (input, radius) => {
    let a = Float32Array.from(input), b = new Float32Array(N);
    for (const dx of [true, false]) {
      const lines = dx ? H : W, len = dx ? W : H;
      for (let line = 0; line < lines; line++) {
        const at = i => dx ? line * W + i : i * W + line;
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += a[at(Math.min(len - 1, Math.max(0, i)))];
        for (let i = 0; i < len; i++) {
          b[at(i)] = sum / (radius * 2 + 1);
          sum += a[at(Math.min(len - 1, i + radius + 1))] - a[at(Math.max(0, i - radius))];
        }
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const polygon = list => {
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d');
    x.fillStyle = '#fff';
    for (const points of list) {
      x.beginPath(); points.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); x.fill();
    }
    const d = x.getImageData(0, 0, W, H).data, m = new Float32Array(N);
    for (let i = 0; i < N; i++) m[i] = d[i * 4] / 255;
    return m;
  };
  const grow = (m, r) => boxBlur(m, r).map(v => v > 0.01 ? 1 : 0);
  const shrink = (m, r) => boxBlur(m, r).map(v => v > 0.99 ? 1 : 0);
  const color = i => [pix[i * 4], pix[i * 4 + 1], pix[i * 4 + 2]];

  // k-moyennes simples sur un échantillon de couleurs.
  const centers = (indices, k) => {
    const sample = [];
    const step = Math.max(1, Math.floor(indices.length / 4000));
    for (let i = 0; i < indices.length; i += step) sample.push(color(indices[i]));
    if (!sample.length) return [];
    let c = Array.from({ length: k }, (_, j) => sample[Math.floor(j * sample.length / k)].slice());
    for (let it = 0; it < 12; it++) {
      const sum = c.map(() => [0, 0, 0, 0]);
      for (const s of sample) {
        let best = 0, bd = Infinity;
        c.forEach((cc, j) => { const d = (s[0] - cc[0]) ** 2 + (s[1] - cc[1]) ** 2 + (s[2] - cc[2]) ** 2; if (d < bd) { bd = d; best = j; } });
        sum[best][0] += s[0]; sum[best][1] += s[1]; sum[best][2] += s[2]; sum[best][3]++;
      }
      c = c.map((cc, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : cc);
    }
    return c;
  };
  const nearest = (cs, s) => Math.sqrt(Math.min(...cs.map(cc => (s[0] - cc[0]) ** 2 + (s[1] - cc[1]) ** 2 + (s[2] - cc[2]) ** 2)));

  // Affinage guidé : la bande autour du contour est répartie selon les couleurs.
  const refine = (rough, band) => {
    const inner = shrink(rough, band), outer = grow(rough, band), far = grow(rough, band * 2);
    const fgIdx = [], bgIdx = [];
    for (let i = 0; i < N; i++) { if (inner[i]) fgIdx.push(i); else if (far[i] && !outer[i]) bgIdx.push(i); }
    const fg = centers(fgIdx, 6), bg = centers(bgIdx, 6);
    const p = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (inner[i]) { p[i] = 1; continue; }
      if (!outer[i]) continue;
      const s = color(i), df = nearest(fg, s), db = nearest(bg, s);
      p[i] = db / (df + db + 1e-3);
    }
    const soft = boxBlur(p, 1);
    return soft.map((v, i) => outer[i] ? smooth(0.42, 0.62, v) : 0);
  };

  const fill = (channels, known) => channels.map(c => {
    const levels = [{ w: W, h: H, v: c.map((v, i) => v * known[i]), k: Float32Array.from(known) }];
    while (levels.at(-1).w > 2) {
      const pr = levels.at(-1), w = Math.ceil(pr.w / 2), h = Math.ceil(pr.h / 2);
      const v = new Float32Array(w * h), k = new Float32Array(w * h);
      for (let y = 0; y < pr.h; y++) for (let x = 0; x < pr.w; x++) {
        const j = (y >> 1) * w + (x >> 1), i = y * pr.w + x; v[j] += pr.v[i]; k[j] += pr.k[i];
      }
      levels.push({ w, h, v, k });
    }
    for (let l = levels.length - 2; l >= 0; l--) {
      const pr = levels[l], q = levels[l + 1];
      for (let y = 0; y < pr.h; y++) for (let x = 0; x < pr.w; x++) {
        const fx = Math.min(q.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(q.h - 1, Math.max(0, (y - 0.5) / 2));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(q.w - 1, x0 + 1), y1 = Math.min(q.h - 1, y0 + 1);
        const ax = fx - x0, ay = fy - y0;
        const at = (xx, yy) => { const j = yy * q.w + xx; return q.k[j] > 0 ? q.v[j] / q.k[j] : 0; };
        const coarse = (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
        const i = y * pr.w + x, kn = Math.min(1, pr.k[i]), own = pr.k[i] > 0 ? pr.v[i] / pr.k[i] : 0;
        pr.v[i] = own * kn + coarse * (1 - kn); pr.k[i] = 1;
      }
    }
    const filled = levels[0].v, soft = boxBlur(boxBlur(filled, 4), 4);
    return filled.map((v, i) => known[i] > 0.5 ? v : soft[i] + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 2.5);
  });

  const rgb = [0, 1, 2].map(k => { const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = pix[i * 4 + k]; return c; });
  const oriRough = polygon([polygons.ori]);
  const kuRough = polygon([polygons.ku]);
  const ori = refine(oriRough, 6);
  const ku = refine(kuRough, 7).map((v, i) => Math.max(v * (1 - ori[i] * 0.999), kuRough[i] * ori[i]));
  // Les pousses sont trop fines pour le modèle de couleurs : leur polygone est gardé tel quel.
  const sproutMask = boxBlur(polygon(polygons.sprouts), 1);
  const branch = refine(polygon([polygons.branch, ...polygons.sprouts]), 7).map((v, i) => Math.max(v, sproutMask[i]));
  const front = boxBlur(refine(polygon([polygons.front]), 10), 2);

  // Ku est complété sous Ori à partir de ses propres plumes.
  const kuKnown = ku.map((v, i) => v > 0.5 && ori[i] < 0.05 ? 1 : 0);
  const kuRgb = fill(rgb, kuKnown);

  // Décor : on retire tous les calques, avec une marge pour les contours.
  const union = new Float32Array(N);
  for (let i = 0; i < N; i++) union[i] = Math.max(ori[i], ku[i], branch[i], front[i]);
  const hole = grow(union.map(v => v > 0.05 ? 1 : 0), 4);
  const bgRgb = fill(rgb, hole.map(v => 1 - v));

  // Profondeur peinte à la main par grandes zones, puis lissée.
  const trunk = polygon([polygons.trunk]);
  const depth = new Float32Array(N), roots = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const blob = (cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
    let d = 0.05;
    d = Math.max(d, 0.30 * blob(1000, 260, 300, 320), 0.30 * trunk[i]);
    d = Math.max(d, 0.45 * blob(200, 330, 300, 260));
    d = Math.max(d, 0.20 * blob(1780, 470, 260, 200));
    d = Math.max(d, 0.25 * smooth(380, 560, y));
    depth[i] = d;
    const r = bgRgb[0][i], gg = bgRgb[1][i], b = bgRgb[2][i];
    const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    const orb = Math.hypot(x - 1150, y - 235) < 70 ? 0 : 1;
    roots[i] = smooth(135, 200, lum) * (1 - smooth(440, 500, y)) * (1 - trunk[i] * 0.8) * orb;
  }
  const depthSoft = boxBlur(boxBlur(depth, 20), 20);
  const rootsSoft = boxBlur(roots, 3);
  // Zone large des racines : elle guide l'ondulation, qui doit varier lentement.
  const rootZone = boxBlur(boxBlur(roots, 10), 10).map(v => Math.min(1, v * 2.2));

  const encode = async (fn, type, quality, w = W, h = H, ox = 0, oy = 0) => {
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) fn(img.data, (yy * w + xx) * 4, (yy + oy) * W + xx + ox);
    x.putImageData(img, 0, 0);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type, quality })).arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const layer = (alpha, channels = rgb) => encode((d, o, i) => {
    d[o] = channels[0][i]; d[o + 1] = channels[1][i]; d[o + 2] = channels[2][i]; d[o + 3] = alpha[i] * 255;
  }, 'image/png');
  const [wx, wy, ww, wh] = args.window;
  return {
    'ori.png': await layer(ori),
    'ku.png': await layer(ku, kuRgb),
    'branch.png': await layer(branch),
    'front.png': await layer(front),
    'bg.jpg': await encode((d, o, i) => { d[o] = bgRgb[0][i]; d[o + 1] = bgRgb[1][i]; d[o + 2] = bgRgb[2][i]; d[o + 3] = 255; }, 'image/jpeg', 0.92),
    'depth.png': await encode((d, o, i) => { d[o] = depthSoft[i] * 255; d[o + 1] = rootsSoft[i] * 255; d[o + 2] = rootZone[i] * 255; d[o + 3] = 255; }, 'image/png'),
    'full.jpg': await encode((d, o, i) => { d[o] = pix[i * 4]; d[o + 1] = pix[i * 4 + 1]; d[o + 2] = pix[i * 4 + 2]; d[o + 3] = 255; }, 'image/jpeg', 0.93, ww, wh, wx, wy),
    'masks.png': await encode((d, o, i) => {
      d[o] = Math.max(ori[i], front[i]) * 255; d[o + 1] = Math.max(ori[i], branch[i]) * 255; d[o + 2] = Math.max(ku[i], ori[i]) * 255;
      d[o + 3] = Math.max(ori[i], ku[i], branch[i], front[i]) * 255;
    }, 'image/png'),
  };
}, {
  src: 'data:image/jpeg;base64,' + readFileSync(join(root, 'source.jpg')).toString('base64'),
  window: WINDOW,
  polygons: { ku: KU, ori: ORI, branch: BRANCH, sprouts: SPROUTS, front: FRONT, trunk: TRUNK },
});
await browser.close();
for (const [name, data] of Object.entries(result)) writeFileSync(join(root, name), Buffer.from(data, 'base64'));
console.log('Prepared', Object.keys(result).join(', '));
