import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const [title, base, mythic] = process.argv.slice(2);
if (!title || !base || !mythic) {
  throw new Error(
    'Usage: node scripts/check-dev-card-set.mjs "Titre du jeu" dossier-base dossier-mythique',
  );
}
const origin = process.env.CARD_DEV_ORIGIN ?? 'http://localhost:3000';
const manifest = async (path) => {
  const response = await fetch(`${origin}/_proto/${path}`);
  assert.ok(response.ok, path);
  return response.json();
};
const [baseScene, mythicScene, reveal] = await Promise.all([
  manifest(`${base}/scene.json`),
  manifest(`${mythic}/scene.json`),
  manifest(`${mythic}/edition.json`),
]);
assert.notEqual(baseScene.source, mythicScene.source);
assert.equal(reveal.shots.length, 3);
assert.ok(reveal.shots[0].from.x < 0.3 && reveal.shots[1].from.x > 0.7);
assert.deepEqual(reveal.shots[2].to, { x: 0.5, y: 0.5, zoom: 1 });
for (const scene of [baseScene, mythicScene]) {
  const ids = new Set(scene.layers.map(({ id }) => id));
  assert.equal(ids.size, scene.layers.length);
  assert.ok(scene.layers.some(({ peak }) => peak.some(Boolean)));
  for (const part of scene.layers) {
    const lineage = new Set([part.id]);
    for (
      let parent = part.parent;
      parent;
      parent = scene.layers.find((p) => p.id === parent).parent
    ) {
      assert.ok(ids.has(parent) && !lineage.has(parent), `Parent invalide pour ${part.id}`);
      lineage.add(parent);
    }
  }
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${origin}/dev/cartes-animees`, { waitUntil: 'networkidle' });
  const card = (edition) =>
    page.getByRole('button', { name: `Inspecter ${title} — ${edition}`, exact: true });
  const dialog = page.getByRole('dialog');
  const canvas = dialog.locator('canvas[data-ready]');
  const snapshot = () => canvas.evaluate((el) => el.toDataURL());
  const paint = async (time, joint, effects) => {
    await canvas.evaluate(
      async (el, data) => {
        el.dataset.cardTime = String(data.time);
        el.dataset.cardEffects = data.effects;
        if (data.joint) el.dataset.cardJoint = data.joint;
        else delete el.dataset.cardJoint;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      },
      { time, joint, effects },
    );
    return snapshot();
  };

  assert.equal(await card('Relief').locator('img').getAttribute('src'), `/_proto/${base}/full.jpg`);
  assert.equal(
    await card('Vivante').locator('img').getAttribute('src'),
    `/_proto/${base}/full.jpg`,
  );
  assert.equal(
    await card('Mythique').locator('img').getAttribute('src'),
    `/_proto/${mythic}/full.jpg`,
  );

  await card('Relief').click();
  await canvas.waitFor();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  assert.equal(
    await paint(0, null, 'on'),
    await paint(1.45, null, 'on'),
    'Relief immobile au repos',
  );
  const still = await snapshot();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.88, bounds.y + bounds.height * 0.27);
  await page.waitForTimeout(250);
  assert.notEqual(await snapshot(), still, 'Parallaxe Relief');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  for (const [edition, scene] of [
    ['Vivante', baseScene],
    ['Mythique', mythicScene],
  ]) {
    await card(edition).click();
    await canvas.waitFor();
    await page.mouse.move(0, 0);
    const rest = await paint(0, null, 'off');
    for (const part of scene.layers.filter(({ peak }) => peak.some(Boolean))) {
      assert.notEqual(await paint(0, part.id, 'off'), rest, `Pivot ${part.id}`);
    }
    assert.notEqual(await paint(0.95, null, 'off'), rest, 'Transition du geste');
    assert.notEqual(await paint(1.45, null, 'off'), rest, 'Pose maximale');
    assert.equal(await paint(4.5, null, 'off'), rest, 'Retour au repos');
    if (edition === 'Mythique') {
      assert.notEqual(await paint(4.5, null, 'on'), rest, 'Effet visible pendant la phase calme');
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log(`${edition} · pivots isolés, transition, sommet et retour vérifiés`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card('Mythique').click();
  await dialog.locator('img').first().waitFor();
  assert.ok(
    await dialog
      .locator('img')
      .first()
      .evaluate((el) => el.complete && el.naturalWidth > 0),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${origin}/dev/boosters`, { waitUntil: 'networkidle' });
  await page
    .getByRole('button', { name: `${title} : Relief, Vivante et Mythique`, exact: true })
    .click();
  await page.locator('button.pack').press('Enter');
  await page.evaluate(() => {
    window.cardCameraFrames = [];
    const watch = new MutationObserver(() => {
      const lens = document.querySelector('.mythique[data-phase="focus"] .lens');
      if (lens) window.cardCameraFrames.push(lens.style.transformOrigin);
    });
    watch.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-phase'],
    });
  });
  await page.locator('button.card[data-edition="mythique"]').click();
  await page.locator('.mythique .lens canvas[data-ready]').waitFor();
  await page.locator('.mythique[data-phase="burst"]').waitFor();
  const cameraFrames = await page.evaluate(() => window.cardCameraFrames);
  let cursor = 0;
  for (const {
    to: { x, y },
  } of reveal.shots) {
    const match = cameraFrames.findIndex((origin, index) => {
      const [left, top] = origin.split(' ').map(Number.parseFloat);
      return index >= cursor && Math.abs(left - x * 100) < 0.1 && Math.abs(top - y * 100) < 0.1;
    });
    assert.ok(match >= cursor, `Plan de caméra absent (${x}, ${y})`);
    cursor = match + 1;
  }
  console.log(
    `${title} · trois éditions, repli fixe et travelling gauche → droite → centre vérifiés`,
  );
} finally {
  await browser.close();
}
