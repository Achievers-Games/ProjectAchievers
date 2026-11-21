import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const source = await readFile(new URL('source.png', import.meta.url));
const crop = { x: 80, y: 360, width: 3680, height: 1720 };
const output = { width: 1840, height: 860 };
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const exports = await page.evaluate(
    async ({ sourceUrl, crop, output }) => {
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      if (crop.x + crop.width > image.naturalWidth || crop.y + crop.height > image.naturalHeight) {
        throw new Error('Le cadrage dépasse les limites de la source.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = output.width;
      canvas.height = output.height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        output.width,
        output.height,
      );
      const { width, height } = output;
      const makeCanvas = (w = width, h = height) => {
        const target = document.createElement('canvas');
        target.width = w;
        target.height = h;
        return target;
      };
      const mask = makeCanvas();
      const maskContext = mask.getContext('2d');
      // Contour guidé dans le repère de la source, plumes et pattes incluses.
      const outline = [
        [683, 1350],
        [746, 1294],
        [832, 1260],
        [930, 1200],
        [754, 1230],
        [739, 1194],
        [830, 1160],
        [984, 1140],
        [1090, 1100],
        [966, 1094],
        [880, 1040],
        [871, 1006],
        [997, 1003],
        [989, 974],
        [1167, 1004],
        [1182, 976],
        [1230, 950],
        [1375, 946],
        [1452, 959],
        [1482, 988],
        [1528, 966],
        [1548, 940],
        [1602, 961],
        [1673, 945],
        [1736, 949],
        [1800, 984],
        [1844, 1020],
        [1854, 1092],
        [1841, 1160],
        [1840, 1200],
        [1795, 1235],
        [1755, 1341],
        [1704, 1453],
        [1694, 1528],
        [1709, 1640],
        [1707, 1828],
        [1671, 1859],
        [1638, 1829],
        [1617, 1756],
        [1593, 1820],
        [1568, 1791],
        [1533, 1670],
        [1497, 1718],
        [1464, 1701],
        [1433, 1635],
        [1437, 1562],
        [1298, 1580],
        [1178, 1564],
        [1063, 1525],
        [1028, 1520],
        [989, 1560],
        [934, 1566],
        [902, 1547],
        [919, 1502],
        [975, 1473],
        [944, 1444],
        [869, 1451],
        [789, 1480],
        [710, 1467],
        [738, 1432],
        [696, 1403],
        [710, 1372],
      ];
      maskContext.beginPath();
      for (const [x, y] of outline) maskContext.lineTo((x - crop.x) / 2, (y - crop.y) / 2);
      maskContext.closePath();
      maskContext.fill();

      // Le masque de retrait du fond inclut les bords que le détourage des plumes
      // rend semi-transparents. La transition s'étend dans le ciel déjà propre.
      const skyHole = makeCanvas();
      const holeContext = skyHole.getContext('2d');
      const expanded = makeCanvas();
      const expandedContext = expanded.getContext('2d');
      for (const dx of [-22, 0, 22]) {
        for (const dy of [-16, 0, 16]) expandedContext.drawImage(mask, dx, dy);
      }
      holeContext.filter = 'blur(8px)';
      holeContext.drawImage(expanded, 0, 0);

      // Affiner le contour avec les tons bleu nuit des plumes. Les zones claires d’Ori
      // et du disque facial de Ku conservent leur contour manuel.
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const matte = maskContext.getImageData(0, 0, width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (!matte.data[i + 3]) continue;
          const sx = crop.x + x * 2;
          const sy = crop.y + y * 2;
          const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          const brightOri = sy < 1040 && sx > 1180 && sx < 1500;
          const rimLight = sx > 1570 && sy < 1510 && pixels[i + 2] > 88;
          const tailLight = sx < 1100 && sy > 1130 && sy < 1240 && pixels[i + 2] > pixels[i] + 12;
          if (!brightOri && !rimLight && !tailLight) {
            matte.data[i + 3] *= Math.max(0, Math.min(1, (143 - light) / 26));
          }
        }
      }
      maskContext.putImageData(matte, 0, 0);
      const flight = makeCanvas();
      const flightContext = flight.getContext('2d');
      flightContext.drawImage(canvas, 0, 0);
      flightContext.globalCompositeOperation = 'destination-in';
      flightContext.drawImage(mask, 0, 0);

      // Comme sur Ori et Hollow Knight, effacer un peu au-delà du détourage
      // évite de laisser un double contour lorsque le personnage bouge.
      const inpaint = (source, hole, margin) => {
        const known = makeCanvas();
        const knownContext = known.getContext('2d');
        knownContext.drawImage(source, 0, 0);
        knownContext.globalCompositeOperation = 'destination-out';
        for (const dx of [-margin, 0, margin]) {
          for (const dy of [-margin, 0, margin]) knownContext.drawImage(hole, dx, dy);
        }
        const pyramid = [known];
        while (pyramid.at(-1).width > 4) {
          const previous = pyramid.at(-1);
          const next = makeCanvas(Math.ceil(previous.width / 2), Math.ceil(previous.height / 2));
          next.getContext('2d').drawImage(previous, 0, 0, next.width, next.height);
          pyramid.push(next);
        }
        const result = makeCanvas();
        const target = result.getContext('2d');
        for (const level of pyramid.reverse()) target.drawImage(level, 0, 0, width, height);
        return result;
      };

      const oriMask = makeCanvas();
      const oriMatte = oriMask.getContext('2d').createImageData(width, height);
      // La tête et les oreilles claires dépassent de l’aile. La partie cachée
      // reste solidaire de Ku ; aucun bord de détourage ne traverse le visage.
      for (let y = 293; y < 345; y++) {
        for (let x = 550; x < 715; x++) {
          const i = (y * width + x) * 4;
          const blue = pixels[i + 2];
          const red = pixels[i];
          const lit =
            Math.min(1, Math.max(0, (blue - 153) / 34)) *
            Math.min(1, Math.max(0, (blue - red + 6) / 32));
          const eye = Math.hypot((x - 685) / 12, (y - 322) / 10) < 1 ? 1 : 0;
          const weight = Math.max(lit, eye);
          oriMatte.data[i + 3] = matte.data[i + 3] * weight;
        }
      }
      const oriMaskContext = oriMask.getContext('2d');
      oriMaskContext.putImageData(oriMatte, 0, 0);
      const ori = makeCanvas();
      const oriContext = ori.getContext('2d');
      oriContext.drawImage(canvas, 0, 0);
      oriContext.globalCompositeOperation = 'destination-in';
      oriContext.drawImage(oriMask, 0, 0);

      const ku = inpaint(flight, oriMask, 2);
      const kuContext = ku.getContext('2d');
      kuContext.globalCompositeOperation = 'destination-in';
      kuContext.drawImage(mask, 0, 0);
      // Interpoler la brume à partir du ciel intact de chaque côté du duo.
      // La diffusion du contour seul conservait une empreinte sombre sous les ailes.
      const bg = makeCanvas();
      const bgContext = bg.getContext('2d');
      const sky = bgContext.createImageData(width, height);
      const hole = holeContext.getImageData(0, 0, width, height).data;
      const sample = (x, y, channel) => {
        let sum = 0;
        for (let dx = -12; dx <= 12; dx += 4) {
          for (let dy = -8; dy <= 8; dy += 4) {
            const row = Math.max(0, Math.min(height - 1, y + dy));
            sum += pixels[(row * width + x + dx) * 4 + channel];
          }
        }
        return sum / 35;
      };
      const left = 270;
      const right = 930;
      for (let y = 0; y < height; y++) {
        const cool = [0, 1, 2].map((channel) => sample(left, y, channel));
        const warm = [0, 1, 2].map((channel) => sample(right, y, channel));
        for (let x = 0; x < width; x++) {
          const pixel = y * width + x;
          const i = pixel * 4;
          const alpha = hole[i + 3] / 255;
          const blend = Math.max(0, Math.min(1, (x - left) / (right - left)));
          const grain = ((Math.sin(pixel * 12.9898) * 43758.5453) % 1) * 1.1;
          for (let channel = 0; channel < 3; channel++) {
            const haze = cool[channel] * (1 - blend) + warm[channel] * blend + grain;
            sky.data[i + channel] = pixels[i + channel] * (1 - alpha) + haze * alpha;
          }
          sky.data[i + 3] = 255;
        }
      }
      bgContext.putImageData(sky, 0, 0);

      // Le shader retourne le rendu composé. Le repli fixe doit montrer le même cadrage.
      const still = makeCanvas();
      const stillContext = still.getContext('2d');
      stillContext.translate(width, 0);
      stillContext.scale(-1, 1);
      stillContext.drawImage(canvas, 0, 0);

      const encode = (image, type) => image.toDataURL(type, 0.94).split(',')[1];
      return {
        'full.jpg': encode(still, 'image/jpeg'),
        'bg.jpg': encode(bg, 'image/jpeg'),
        'ku.png': encode(ku, 'image/png'),
        'ori.png': encode(ori, 'image/png'),
      };
    },
    { sourceUrl: `data:image/png;base64,${source.toString('base64')}`, crop, output },
  );
  await Promise.all(
    Object.entries(exports).map(([name, bytes]) =>
      writeFile(new URL(name, import.meta.url), Buffer.from(bytes, 'base64')),
    ),
  );
} finally {
  await browser.close();
}
