import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Vector contours of the approved concepts, not a substitute font or a newly generated logo.
// The original boards remain in design/brand. Re-run only when intentionally updating the brand.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  async function trace(file, region, colored = false) {
    const source = (await readFile(file)).toString('base64');
    return page.evaluate(
      async ({ source, region, colored }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${source}`;
        await img.decode();
        const [left, top, width, height] = region ?? [0, 0, img.width, img.height];
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        const mask = new Uint8Array(width * height);
        for (let i = 0; i < mask.length; i++) {
          const [r, g, b] = pixels.subarray(i * 4, i * 4 + 3);
          mask[i] = colored
            ? Number(Math.max(r, g, b) > 100 && g > 40 && b > 80)
            : Number(Math.min(r, g, b) > 175);
        }
        const on = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
        const edges = new Map();
        const edge = (x, y, a, b) => {
          const key = y * (width + 1) + x;
          const values = edges.get(key) ?? [];
          values.push([a, b]);
          edges.set(key, values);
        };
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            if (on(x, y)) {
              if (!on(x, y - 1)) edge(x, y, x + 1, y);
              if (!on(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
              if (!on(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
              if (!on(x - 1, y)) edge(x, y + 1, x, y);
            }
        const simplify = (points, tolerance = 0.7) => {
          const a = points[0],
            b = points.at(-1);
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            length = dx * dx + dy * dy;
          let maximum = tolerance * tolerance,
            at = -1;
          for (let i = 1; i < points.length - 1; i++) {
            const p = points[i];
            const t = length
              ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
              : 0;
            const distance = (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
            if (distance > maximum) {
              maximum = distance;
              at = i;
            }
          }
          return at < 0
            ? [a, b]
            : [
                ...simplify(points.slice(0, at + 1), tolerance).slice(0, -1),
                ...simplify(points.slice(at), tolerance),
              ];
        };
        const loops = [];
        while (edges.size) {
          const start = edges.keys().next().value;
          let key = start;
          const points = [];
          do {
            const x = key % (width + 1),
              y = Math.floor(key / (width + 1));
            points.push([x, y]);
            const next = edges.get(key);
            if (!next?.length) throw new Error('Open brand contour');
            const point = next.pop();
            if (!next.length) edges.delete(key);
            key = point[1] * (width + 1) + point[0];
          } while (key !== start);
          const area = Math.abs(
            points.reduce((sum, p, i) => {
              const q = points[(i + 1) % points.length];
              return sum + p[0] * q[1] - q[0] * p[1];
            }, 0) / 2,
          );
          if (area < (colored ? 20 : 8)) continue;
          let split = 1;
          for (let i = 2; i < points.length; i++)
            if (
              (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2 >
              (points[split][0] - points[0][0]) ** 2 + (points[split][1] - points[0][1]) ** 2
            )
              split = i;
          loops.push([
            ...simplify(points.slice(0, split + 1)).slice(0, -1),
            ...simplify([...points.slice(split), points[0]]).slice(0, -1),
          ]);
        }
        const all = loops.flat();
        const minX = Math.min(...all.map((p) => p[0])),
          minY = Math.min(...all.map((p) => p[1]));
        const maxX = Math.max(...all.map((p) => p[0])),
          maxY = Math.max(...all.map((p) => p[1]));
        return {
          width: maxX - minX,
          height: maxY - minY,
          path: loops
            .map(
              (points) => 'M' + points.map((p) => `${p[0] - minX},${p[1] - minY}`).join('L') + 'Z',
            )
            .join(''),
        };
      },
      { source, region, colored },
    );
  }
  const mark = await trace('design/brand/achievers-a-base-blue-turquoise-v1.png', null, true);
  const wordmark = await trace('design/brand/achievers-concept-v1.png', [400, 120, 1250, 350]);
  const ink =
    '<defs><linearGradient id="ink" x1="0%" y1="100%" x2="100%" y2="0%"><stop stop-color="#2878f0"/><stop offset=".55" stop-color="#22c7da"/><stop offset="1" stop-color="#62e8c1"/></linearGradient></defs>';
  const symbol = `<path fill="url(#ink)" fill-rule="evenodd" d="${mark.path}"/>`;
  const svg = (viewBox, content) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${content}</svg>\n`;
  const icon = (fraction = 0.78, rounded = true) => {
    const size = 64 * fraction,
      scale = Math.min(size / mark.width, size / mark.height);
    const x = (64 - mark.width * scale) / 2,
      y = (64 - mark.height * scale) / 2;
    return svg(
      '0 0 64 64',
      `${ink}<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="#101017"/><g transform="translate(${x} ${y}) scale(${scale})">${symbol}</g>`,
    );
  };
  await mkdir('static/brand', { recursive: true });
  await writeFile(
    'static/brand/achievers-mark.svg',
    svg(`0 0 ${mark.width} ${mark.height}`, ink + symbol),
  );
  await writeFile(
    'static/brand/achievers-wordmark.svg',
    svg(
      `0 0 ${wordmark.width} ${wordmark.height}`,
      `<path fill="#0b1220" fill-rule="evenodd" d="${wordmark.path}"/>`,
    ),
  );
  await writeFile('static/favicon.svg', icon());
  for (const [file, size, fraction] of [
    ['icon-32.png', 32, 0.78],
    ['icon-192.png', 192, 0.78],
    ['icon-512.png', 512, 0.78],
    ['apple-touch-icon.png', 180, 0.78],
    ['icon-maskable-512.png', 512, 0.56],
  ]) {
    const source = icon(
      fraction,
      file !== 'icon-maskable-512.png' && file !== 'apple-touch-icon.png',
    );
    const png = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(source);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { source, size },
    );
    await writeFile(`static/brand/${file}`, Buffer.from(png, 'base64'));
  }
  console.log(
    `Approved mark ${mark.width}×${mark.height}; wordmark ${wordmark.width}×${wordmark.height}; SVG and app icons saved in static/brand.`,
  );
} finally {
  await browser.close();
}
