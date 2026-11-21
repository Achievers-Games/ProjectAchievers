// Détoure le 危 (avertissement d’attaque imparable) depuis une capture du jeu.
// Usage : node static/_proto/sekiro-mythique/prepare-kanji.mjs static/_proto/sekiro-mythique/kanji-source.webp static/_proto/sekiro-mythique/kanji-danger.png <apercu.png>
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const [img, out, preview] = process.argv.slice(2);
const b64 = readFileSync(img).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const [png, prev] = await page.evaluate(async (b64) => {
  const im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
  const X = 604, Y = 213, W = 78, H = 80, Z = 6;
  const c = document.createElement('canvas'); c.width = W * Z; c.height = H * Z;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(im, X, Y, W, H, 0, 0, W * Z, H * Z);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const k = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gr = p[i + 1], b = p[i + 2];
    const a = k(r, 185, 230) * k(gr, 115, 165) * k(r - b, 20, 45);
    p[i] = 255; p[i + 1] = 222; p[i + 2] = 216; p[i + 3] = Math.round(255 * a);
  }
  g.putImageData(d, 0, 0);
  g.clearRect(370, 40, 110, 90);
  // Fermeture : flou puis nouveau seuil pour boucher les trous laiss�s par la compression.
  const m = document.createElement('canvas'); m.width = c.width; m.height = c.height;
  const mg = m.getContext('2d'); mg.filter = 'blur(3.5px)'; mg.drawImage(c, 0, 0);
  const md = mg.getImageData(0, 0, c.width, c.height); const mp = md.data;
  for (let i = 0; i < mp.length; i += 4) {
    const a = k(mp[i + 3] / 255, 0.58, 0.78);
    mp[i] = 255; mp[i + 1] = 222; mp[i + 2] = 216; mp[i + 3] = Math.round(255 * a);
  }
  g.clearRect(0, 0, c.width, c.height); g.putImageData(md, 0, 0);
  const pv = document.createElement('canvas'); pv.width = c.width; pv.height = c.height;
  const q = pv.getContext('2d'); q.fillStyle = '#123'; q.fillRect(0, 0, pv.width, pv.height); q.drawImage(c, 0, 0);
  return [c.toDataURL('image/png'), pv.toDataURL('image/png')];
}, b64);
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
writeFileSync(preview, Buffer.from(prev.split(',')[1], 'base64'));
await browser.close();
