// Contrôle d'un jeu dans /dev/cartes-animees et /dev/boosters : les trois éditions, leurs scènes du
// moteur commun (shared/card-engine.js), chaque pivot isolé, le geste, le retour au repos, le
// repli fixe et la révélation du booster (travelling ou intro).
//
//   node scripts/check-dev-card-set.mjs "Portal 2" portal-2 portal-2-mythique
//
// Une édition faite à la main (sans scene.json du moteur commun) ne passe que les contrôles
// d'intégration : image fixe, repli en mouvement réduit et révélation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const [title, base, mythic] = process.argv.slice(2);
if (!title || !base || !mythic) {
  throw new Error(
    'Usage: node scripts/check-dev-card-set.mjs "Titre du jeu" dossier-base dossier-mythique',
  );
}
const origin = process.env.CARD_DEV_ORIGIN ?? 'http://localhost:3000';
const json = async (path, optional = false) => {
  const response = await fetch(`${origin}/_proto/${path}`);
  if (optional && !response.ok) return null;
  assert.ok(response.ok, path);
  return response.json();
};
/** La scène d'un dossier, si elle est décrite pour le moteur commun. */
const dataScene = async (folder) => {
  const scene = await json(`${folder}/scene.json`, true);
  return scene?.engine === 2 ? scene : null;
};
const [baseScene, mythicScene, reveal] = await Promise.all([
  dataScene(base),
  dataScene(mythic),
  json(`${mythic}/edition.json`),
]);
assert.notEqual(base, mythic, 'La Mythique vient d’une autre illustration');
// Une Mythique sans intro se dévoile par trois plans de caméra : gauche, droite, puis centre.
if (!reveal.intro) {
  assert.equal(reveal.shots.length, 3);
  assert.ok(reveal.shots[0].from.x < 0.3 && reveal.shots[1].from.x > 0.7);
  assert.deepEqual(reveal.shots[2].to, { x: 0.5, y: 0.5, zoom: 1 });
}

/** Un calque animé : mouvements, ondulation ou maillage. */
const animatedLayer = (layer) => Boolean(layer.motion?.length || layer.sway || layer.mesh);
/** Une scène qui bouge toujours un peu (respiration, vent, fleurs) n'a pas de repos exact. */
const idles = (scene) =>
  scene.layers.some(
    (layer) => layer.sway || layer.mesh || layer.motion?.some((term) => term.wave || term.signal),
  ) || Object.values(scene.signals ?? {}).some((signal) => signal.waves?.length);

for (const scene of [baseScene, mythicScene].filter(Boolean)) {
  const ids = new Set(scene.layers.map(({ id }) => id));
  assert.equal(ids.size, scene.layers.length);
  assert.ok(scene.layers.some(animatedLayer), 'Au moins un calque animé');
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
    if (!scene) {
      console.log(`${edition} · faite à la main : contrôles de scène ignorés`);
      continue;
    }
    await card(edition).click();
    await canvas.waitFor();
    await page.mouse.move(0, 0);
    const rest = await paint(0, null, 'off');
    for (const part of scene.layers.filter((layer) => layer.motion?.length)) {
      assert.notEqual(await paint(0, part.id, 'off'), rest, `Pivot ${part.id}`);
    }
    const peaks = Object.values(scene.curves ?? {}).map(([, peak]) => peak);
    for (const peak of peaks) {
      assert.notEqual(await paint(peak, null, 'off'), rest, `Sommet à ${peak} s`);
    }
    if (!idles(scene)) {
      assert.equal(await paint(scene.period - 0.05, null, 'off'), rest, 'Retour au repos');
    }
    if (edition === 'Mythique' && scene.effects?.length) {
      assert.notEqual(
        await paint(scene.period - 0.05, null, 'on'),
        await paint(scene.period - 0.05, null, 'off'),
        'Effet visible pendant la phase calme',
      );
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log(`${edition} · pivots isolés, sommets et retour vérifiés`);
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
    window.cardIntroRevealed = false;
    document.addEventListener('card-intro-reveal', () => (window.cardIntroRevealed = true), true);
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
  await page.getByRole('button', { name: 'Tout retourner' }).waitFor();
  await page.locator('button.card[data-edition="mythique"]').click();
  await page.locator('.mythique .lens canvas[data-ready]').waitFor();
  await page.locator('.mythique[data-phase="burst"]').waitFor({ timeout: 30_000 });
  if (reveal.intro) {
    // L'intro remplace le travelling : la carte annonce elle-même son dévoilement. Sans GPU, un
    // rendu WebGL peut être trop lent : le titre arrive alors par le filet de sécurité du booster.
    await page.waitForFunction(
      () => window.cardIntroRevealed || document.querySelector('.mythique-text:not([inert])'),
      null,
      { timeout: 30_000 },
    );
    const announced = await page.evaluate(() => window.cardIntroRevealed);
    console.log(
      `${title} · trois éditions, repli fixe et intro de révélation vérifiés` +
        (announced ? '' : ' (titre par le filet de sécurité : rendu trop lent sans GPU)'),
    );
  } else {
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
  }
} finally {
  await browser.close();
}
