/**
 * Moteur des cartes décrites par des données. Une carte fournit `scene.json` et ses images ; son
 * `cards.js` ne fait que charger ce moteur. Tout le reste est déclaré :
 *
 * - `view` : la fenêtre visible, en pixels de la source ; `period` : la durée de la boucle.
 * - `curves` : des accents nommés `[début, sommet, maintien, fin]`, en secondes dans la boucle.
 * - `background` : l'image du fond et sa parallaxe.
 * - `sprites` : des images partagées par les effets et les intros (planches de feuilles, symbole).
 * - `layers` : les calques dans l'ordre de dessin. Un calque sans `file` est un groupe : il porte
 *   un pivot, une parallaxe et des mouvements que ses enfants (`parent`) héritent. Un mouvement
 *   déplace (`dx`, `dy`), tourne (`angle`) ou étire (`sx`, `sy`) autour du pivot, au rythme d'un
 *   accent (`curve`), d'un signal (`signal`), d'une oscillation (`wave`, vitesse) ou d'une
 *   respiration (`wave` avec `"shape": "breath"`). `sway` fait onduler un tissu bande par bande ;
 *   `mesh` découpe le calque en triangles déformés (ondes, plis vers la pointe) pour une cape, un
 *   voile ou une aile.
 * - `signals` : des grandeurs nommées, comme le vent ou un regard, faites d'une base,
 *   d'oscillations `[amplitude, vitesse, phase]`, d'accents pondérés, d'étapes `[début, fin,
 *   poids]` (une transition qui reste acquise) et de flashs `[début, sommet, fin, poids]`.
 * - `clip` : un calque découpé par un contour posé dans le repère d'un autre (un œil dans son
 *   logement). `mirror` retourne toute la carte ; `fill` colore la marge.
 * - Une Relief (niveau 2) ne bouge qu'en parallaxe : mouvements, ondulations et effets sont
 *   réservés aux Vivantes et Mythiques.
 * - `effects` : des effets du catalogue (`EFFECTS`), dessinés avant un calque (`before`), attachés
 *   à un calque dont ils suivent le mouvement (`attach`), ou au premier plan.
 * - `intro` : une intro du catalogue (`INTROS`), avec ses paramètres.
 *
 * Le lecteur accepte `data-card-time` (boucle figée), `data-card-intro-time` (intro figée),
 * `data-card-joint` (un seul calque animé) et `data-card-effects="off"`.
 */
export async function loadCardScene(folder) {
  const response = await fetch(new URL('scene.json', folder));
  if (!response.ok) throw new Error('Données de scène indisponibles');
  const scene = await response.json();
  const image = async (file) => {
    const node = new Image();
    node.src = new URL(file, folder);
    await node.decode();
    return node;
  };
  const files = new Set([scene.background.file]);
  for (const layer of scene.layers) if (layer.file) files.add(layer.file);
  for (const sprite of Object.values(scene.sprites ?? {})) files.add(sprite.file);
  const images = Object.fromEntries(
    await Promise.all([...files].map(async (file) => [file, await image(file)])),
  );
  return (canvas, level) => mount(canvas, level, scene, images);
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const ease = (a, b, t) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const pulse = (t, [a, b, c, d]) => ease(a, b, t) * (1 - ease(c, d, t));
const seed = (index) => (index * 0.618033989) % 1;
const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** Le contexte d'une image : horloges, pointeur, accents et réglages de la carte. */
function frameState(scene, elapsed, pointer, intro, isolated, animated) {
  const period = scene.period ?? 7.6;
  const t = ((elapsed % period) + period) % period;
  const curves = {};
  for (const [name, points] of Object.entries(scene.curves ?? {})) curves[name] = pulse(t, points);
  const signals = {};
  for (const [name, def] of Object.entries(scene.signals ?? {})) {
    let value = def.base ?? 0;
    for (const [amplitude, speed, phase = 0] of def.waves ?? []) {
      value += amplitude * Math.sin(elapsed * speed + phase);
    }
    for (const [curve, weight] of Object.entries(def.curves ?? {})) {
      value += weight * (curves[curve] ?? 0);
    }
    for (const [start, end, weight = 1] of def.steps ?? []) value += weight * ease(start, end, t);
    for (const [start, peak, end, weight = 1] of def.pulses ?? []) {
      value += weight * ease(start, peak, t) * (1 - ease(peak, end, t));
    }
    signals[name] = value;
  }
  return { scene, elapsed, t, pointer, intro, isolated, curves, signals, animated };
}

/** La valeur d'un accent ou d'un signal nommé, pour les paramètres des effets. */
const driven = (state, source) =>
  !source ? 0 : (state.curves[source] ?? state.signals[source] ?? 0);

/* ---------- Calques ---------- */

function termAmount(term, layer, state) {
  if (state.isolated) return state.isolated === layer.id ? 1 : 0;
  if (term.curve) return state.curves[term.curve] ?? 0;
  if (term.signal) return state.signals[term.signal] ?? 0;
  if (term.shape === 'breath') return (1 - Math.cos(state.elapsed * term.wave)) / 2;
  const phase = term.phase ?? 0;
  // `settle` : l'oscillation part de sa position de repos au lancement de la carte.
  const start = term.shape === 'settle' ? Math.sin(phase) : 0;
  return Math.sin(state.elapsed * term.wave + phase) - start;
}

function layerOffset(layer, state) {
  let dx = 0,
    dy = 0,
    angle = 0,
    sx = 0,
    sy = 0;
  // Une Relief ne bouge qu'avec le pointeur.
  if (state.animated || state.isolated) {
    for (const term of layer.motion ?? []) {
      const amount = termAmount(term, layer, state);
      dx += (term.dx ?? 0) * amount;
      dy += (term.dy ?? 0) * amount;
      angle += (term.angle ?? 0) * amount;
      sx += (term.sx ?? 0) * amount;
      sy += (term.sy ?? 0) * amount;
    }
  }
  const [px, py] = layer.parallax ?? [0, 0];
  return { dx: dx + px * state.pointer.x, dy: dy + py * state.pointer.y, angle, sx, sy };
}

function applyLayer(ctx, layers, layer, state) {
  if (layer.parent) applyLayer(ctx, layers, layers.get(layer.parent), state);
  const { dx, dy, angle, sx, sy } = layerOffset(layer, state);
  const [cx, cy] = layer.pivot ?? [0, 0];
  ctx.translate(cx + dx, cy + dy);
  ctx.rotate(angle);
  if (sx || sy) ctx.scale(1 + sx, 1 + sy);
  ctx.translate(-cx, -cy);
}

/**
 * Un tissu ou une mèche qui flotte : le calque est redessiné par bandes décalées. `axis: "x"`
 * (défaut) découpe des lignes décalées horizontalement, `axis: "y"` des colonnes décalées
 * verticalement (une cape). L'écart vaut zéro au bord attaché et grandit vers le bord libre
 * (`reach` et `free`), ou s'éloigne d'une attache centrale (`around`). Il suit des ondes
 * `[amplitude, vitesse, fréquence]` et une poussée (`push`, un signal ou un accent).
 */
/** Le décalage d'une ondulation à une position, partagé par `sway` et les maillages. */
function swayShift(sway, position, state) {
  const push = (sway.push?.amount ?? 0) * driven(state, sway.push?.signal ?? sway.push?.curve);
  const waves = sway.waves ?? (sway.wave ? [[sway.wave.amp, sway.wave.speed, sway.wave.freq]] : []);
  let reach;
  if (sway.around) {
    const { center, from, before, after } = sway.around;
    reach = ease(from, position < center ? before : after, Math.abs(position - center));
  } else {
    const [from, to] = sway.reach;
    reach = sway.free === 'bottom' ? ease(from, to, position) : 1 - ease(from, to, position);
  }
  let wave = 0;
  for (const [amp, speed, freq] of waves)
    wave += amp * Math.sin(state.elapsed * speed + position * freq);
  return reach * (push + wave);
}

function drawSway(ctx, image, sway, state) {
  const vertical = sway.axis === 'y';
  const [band0, bandSize] = sway.columns;
  const [from0, to0] = sway.rows;
  const step = sway.step ?? 2;
  for (let position = from0; position < to0; position += step) {
    const sample = position + (sway.sampleOffset ?? 0);
    const shift = Math.round(swayShift(sway, sample, state));
    if (vertical)
      ctx.drawImage(
        image,
        position,
        band0,
        step,
        bandSize,
        position,
        band0 + shift,
        step,
        bandSize,
      );
    else
      ctx.drawImage(
        image,
        band0,
        position,
        bandSize,
        step,
        band0 + shift,
        position,
        bandSize,
        step,
      );
  }
}

/** Les déformations d'un maillage, appliquées à un point de la source. */
function deformPoint(x, y, deformers, state, layer) {
  let px = x,
    py = y;
  for (const deform of deformers) {
    if (deform.type === 'wave') {
      // La même onde qu'un `sway`, mais lissée sur les sommets du maillage.
      const vertical = deform.axis === 'y';
      const position = vertical ? x : y;
      const shift = swayShift(deform, position, state);
      if (vertical) py += shift;
      else px += shift;
    } else if (deform.type === 'bend') {
      // Un pli autour d'une attache : la pointe tourne plus que la base.
      const [cx, cy] = deform.pivot;
      const [inner, outer] = deform.falloff;
      let angle = 0;
      for (const term of deform.motion ?? [])
        angle += (term.angle ?? 0) * termAmount(term, layer, state);
      const weight = ease(inner, outer, Math.hypot(px - cx, py - cy));
      const turn = angle * weight;
      const cos = Math.cos(turn),
        sin = Math.sin(turn);
      const dx = px - cx,
        dy = py - cy;
      px = cx + dx * cos - dy * sin;
      py = cy + dx * sin + dy * cos;
    }
  }
  return [px, py];
}

/**
 * Dessine un calque à travers un maillage déformé : chaque triangle de la grille reçoit la
 * transformation affine qui l'envoie de sa place d'origine à sa place déformée. Les triangles
 * sont légèrement agrandis pour qu'aucune fente n'apparaisse entre eux.
 */
function drawMesh(ctx, image, mesh, state, layer) {
  const [rx, ry, rw, rh] = mesh.rect;
  const [cols, rows] = mesh.grid ?? [16, 10];
  const source = [];
  const target = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = rx + (rw * i) / cols;
      const y = ry + (rh * j) / rows;
      source.push([x, y]);
      target.push(deformPoint(x, y, mesh.deform, state, layer));
    }
  }
  const at = (i, j) => j * (cols + 1) + i;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c = at(i, j + 1),
        d = at(i + 1, j + 1);
      drawTriangle(ctx, image, source[a], source[b], source[c], target[a], target[b], target[c]);
      drawTriangle(ctx, image, source[b], source[d], source[c], target[b], target[d], target[c]);
    }
  }
}

function drawTriangle(ctx, image, s0, s1, s2, d0, d1, d2) {
  const [x0, y0] = s0,
    [x1, y1] = s1,
    [x2, y2] = s2;
  const [u0, v0] = d0,
    [u1, v1] = d1,
    [u2, v2] = d2;
  const delta = x0 * y1 + y0 * x2 + x1 * y2 - y1 * x2 - y0 * x1 - x0 * y2;
  if (!delta) return;
  const a = (u0 * y1 + y0 * u2 + u1 * y2 - y1 * u2 - y0 * u1 - u0 * y2) / delta;
  const b = (x0 * u1 + u0 * x2 + x1 * u2 - u1 * x2 - u0 * x1 - x0 * u2) / delta;
  const c =
    (x0 * y1 * u2 + y0 * u1 * x2 + u0 * x1 * y2 - u0 * y1 * x2 - y0 * x1 * u2 - x0 * u1 * y2) /
    delta;
  const d = (v0 * y1 + y0 * v2 + v1 * y2 - y1 * v2 - y0 * v1 - v0 * y2) / delta;
  const e = (x0 * v1 + v0 * x2 + x1 * v2 - v1 * x2 - v0 * x1 - x0 * v2) / delta;
  const f =
    (x0 * y1 * v2 + y0 * v1 * x2 + v0 * x1 * y2 - v0 * y1 * x2 - y0 * x1 * v2 - x0 * v1 * y2) /
    delta;
  // Agrandi d'un pixel autour de son centre : les bords voisins se recouvrent.
  const mx = (u0 + u1 + u2) / 3,
    my = (v0 + v1 + v2) / 3;
  const grow = ([u, v]) => {
    const length = Math.hypot(u - mx, v - my) || 1;
    return [u + ((u - mx) / length) * 0.9, v + ((v - my) / length) * 0.9];
  };
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...g0);
  ctx.lineTo(...g1);
  ctx.lineTo(...g2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, d, b, e, c, f);
  const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 2);
  const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 2);
  const right = Math.min(image.width, Math.ceil(Math.max(x0, x1, x2)) + 2);
  const bottom = Math.min(image.height, Math.ceil(Math.max(y0, y1, y2)) + 2);
  if (right > left && bottom > top) {
    ctx.drawImage(
      image,
      left,
      top,
      right - left,
      bottom - top,
      left,
      top,
      right - left,
      bottom - top,
    );
  }
  ctx.restore();
}

/* ---------- Effets ---------- */

/** La parallaxe du fond, pour les effets peints dans le décor. */
const backgroundShift = (scene, pointer, elapsed = 0, animated = false) => {
  const [px, py] = scene.background.parallax ?? [0, 0];
  let drift = 0;
  if (animated) {
    for (const [amplitude, speed] of scene.background.drift ?? [])
      drift += amplitude * Math.sin(elapsed * speed);
  }
  return [px * pointer.x + drift, py * pointer.y];
};

const EFFECTS = {
  /** Une nappe de lumière douce, qui respire et glisse avec un accent. */
  mist(ctx, fx, state) {
    const [x0, y0] = fx.center;
    const cx = x0 + (fx.drift?.dx ?? 0) * driven(state, fx.drift?.curve);
    const radius = fx.radius ?? 520;
    let alpha = fx.alpha ?? 0.12;
    for (const [amplitude, speed] of fx.waves ?? [[0.06, 0.9]]) {
      alpha += amplitude * Math.sin(state.elapsed * speed);
    }
    if (fx.boost) alpha += fx.boost.amount * driven(state, fx.boost.curve);
    const glow = ctx.createRadialGradient(cx, y0, fx.inner ?? radius * 0.05, cx, y0, radius);
    glow.addColorStop(0, rgba(fx.color, alpha));
    glow.addColorStop(1, rgba(fx.edge ?? fx.color, 0));
    ctx.fillStyle = glow;
    const [rx, ry, rw, rh] = fx.rect ?? [
      cx - radius * 1.02,
      y0 - radius * 0.75,
      radius * 2.04,
      radius * 1.4,
    ];
    ctx.fillRect(rx, ry, rw, rh);
  },

  /** Des flammes floues qui montent de foyers et se couchent avec le vent. */
  flames(ctx, fx, state) {
    const roots = fx.roots;
    const wind = driven(state, fx.wind);
    const [px0] = fx.parallax ?? [0, 0];
    const tall = fx.height ?? 145;
    ctx.filter = `blur(${fx.blur ?? 3}px)`;
    for (let index = 0; index < roots.length * 2; index++) {
      const age = (state.elapsed * (0.58 + (index % 4) * 0.14) + index * 0.618) % 1;
      const opacity = Math.sin(Math.PI * age) ** 2;
      const height = tall * (0.55 + 0.72 * age) * (0.78 + (index % 4) * 0.14);
      const width = (18 + (index % 4) * 7) * (1 - 0.54 * age);
      const px =
        roots[index % roots.length] + (index < roots.length ? -11 : 11) + px0 * state.pointer.x;
      const py = fx.y - 25 * age;
      const drift = wind * height * 0.35 + 10 * Math.sin(state.elapsed * 6 + index);
      const flame = ctx.createLinearGradient(px, py, px + drift, py - height);
      flame.addColorStop(0, `rgba(255, 173, 57, ${opacity * 0.04})`);
      flame.addColorStop(0.27, `rgba(255, 216, 108, ${opacity * 0.62})`);
      flame.addColorStop(0.66, `rgba(255, 105, 21, ${opacity * 0.4})`);
      flame.addColorStop(1, 'rgba(255, 65, 9, 0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(px - width, py);
      ctx.bezierCurveTo(
        px - width * 1.1,
        py - height * 0.42,
        px + drift * 0.8,
        py - height * 0.57,
        px + drift,
        py - height,
      );
      ctx.bezierCurveTo(
        px + drift + width * 0.48,
        py - height * 0.55,
        px + width * 1.25,
        py - height * 0.34,
        px + width,
        py,
      );
      ctx.fill();
    }
  },

  /** Des braises qui montent en dérivant, plus loin pendant un accent. */
  embers(ctx, fx, state) {
    const depth = fx.depth ?? 6;
    const advance = driven(state, fx.advance);
    const [x0, spread] = fx.span ?? [480, 1030];
    for (let index = 0; index < (fx.count ?? 33); index++) {
      const age = (state.elapsed * (0.1 + (index % 6) * 0.022) + index * 0.618) % 1;
      const px =
        x0 +
        ((index * 137) % spread) +
        age * (220 + advance * 85) +
        23 * Math.sin(age * 6 + index) +
        depth * state.pointer.x;
      const py = fx.y - age * (455 + (index % 5) * 23) + depth * state.pointer.y * 0.3;
      const alpha = Math.sin(age * Math.PI) ** 2 * (0.3 + (index % 4) * 0.11);
      ctx.fillStyle = `rgba(255, ${137 + (index % 5) * 21}, 64, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(px, py, 1.4 + (index % 4) * 0.85, 0.8 + depth * 0.02, -0.57, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** Des étincelles de feu qui jaillissent des foyers et partent avec le vent. */
  cinders(ctx, fx, state) {
    const sources = fx.sources;
    const wind = driven(state, fx.wind);
    const [px0, py0] = fx.parallax ?? [0, 0];
    ctx.lineCap = 'round';
    for (let index = 0; index < (fx.count ?? 38); index++) {
      const offset = (index * 0.61803398875) % 1;
      const age = (state.elapsed * (0.26 + (index % 7) * 0.047) + offset) % 1;
      const height = 112 + ((index * 89) % 345);
      const drift = 72 + wind * 118 + (index % 5) * 16;
      const px =
        sources[index % sources.length] +
        (offset - 0.5) * 61 +
        age * (0.4 + age * 0.6) * drift +
        px0 * state.pointer.x;
      const py = fx.y - height * age * (1.24 - age * 0.24) + py0 * state.pointer.y;
      const opacity = ease(0.0, 0.13, age) * (1 - ease(0.48, 1, age));
      const flicker = 0.71 + 0.29 * Math.sin(state.elapsed * (6 + (index % 4)) + index * 2.1);
      const radius = (0.9 + (index % 6) * 0.39) * (1 - 0.44 * age);
      const light = opacity * flicker;
      ctx.strokeStyle = `rgba(255, ${115 + (index % 4) * 22}, 31, ${light * 0.5})`;
      ctx.lineWidth = radius * 2.6;
      ctx.beginPath();
      ctx.moveTo(px - radius * 2.7, py + radius * 4.1);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, ${178 + (index % 4) * 19}, 90, ${light})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** Des faisceaux de lumière qui partent du haut, oscillent et s'élargissent vers le bas. */
  rays(ctx, fx, state) {
    const boost = fx.boost ? (state.curves[fx.boost.curve] ?? 0) * fx.boost.amount : 0;
    const length = fx.length ?? 720;
    for (let i = 0; i < (fx.count ?? 5); i++) {
      const source =
        fx.from + i * (fx.step ?? 111) + 16 * Math.sin(state.elapsed * 0.43 + i * 0.48);
      const tip = source + (fx.lean ?? -420) + Math.sin(state.elapsed * 0.54 + i * 0.87) * 37;
      const strength = 0.68 + 0.23 * Math.sin(state.elapsed * 0.79 + i * 1.17) + boost;
      for (const [width, opacity] of [
        [1.65, 0.08],
        [1, 0.15],
        [0.43, 0.17],
      ]) {
        const ray = ctx.createLinearGradient(source, 0, tip, length);
        ray.addColorStop(0, rgba(fx.color, strength * opacity));
        ray.addColorStop(0.36, rgba(fx.color, strength * opacity * 0.78));
        ray.addColorStop(1, rgba(fx.color, 0));
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(source - 11 * width, 0);
        ctx.lineTo(source + 11 * width, 0);
        ctx.lineTo(tip + 55 * width, length);
        ctx.lineTo(tip - 55 * width, length);
        ctx.fill();
      }
    }
  },

  /** Des feuilles (une planche d'images carrées) portées par le vent, à une profondeur donnée. */
  leaves(ctx, fx, state, images) {
    const sheet = state.scene.sprites[fx.sprite];
    const image = images[sheet.file];
    const frames = sheet.frames ?? 1;
    const depth = fx.depth ?? 1;
    const gust = fx.gust ? (state.curves[fx.gust] ?? 0) : 0;
    const [x0, y0, width, height] = fx.area ?? [-90, 90, 2180, 735];
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < (fx.count ?? 19); i++) {
      const index = i + depth * 29;
      const age = (state.elapsed * (0.085 + seed(index) * 0.07) + seed(index + 18)) % 1;
      const px = x0 + age * width + gust * (24 + 16 * depth) + depth * state.pointer.x * 18;
      const py =
        y0 +
        seed(index + 7) * height +
        age * (fx.fall ?? 125) +
        Math.sin(age * 9 + index) * (12 + 5 * depth) +
        depth * state.pointer.y * 11;
      const size = (13 + depth * 22) * (0.65 + seed(index + 12));
      const frame = (i + Math.floor(depth * 4)) % frames;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(age * 7 + index);
      ctx.scale(1, 0.32 + 0.68 * Math.abs(Math.cos(state.elapsed * 1.4 + index)));
      ctx.globalAlpha = Math.sin(Math.PI * age) ** 2 * (0.64 + depth * 0.16);
      ctx.drawImage(
        image,
        frame * sheet.frame,
        0,
        sheet.frame,
        sheet.frame,
        -size / 2,
        -size / 2,
        size,
        size,
      );
      ctx.restore();
    }
  },

  /** Des étincelles qui tombent d'un point du calque, plus vives pendant un accent. */
  sparks(ctx, fx, state) {
    const burst = fx.curve ? (state.curves[fx.curve] ?? 0) : 0;
    const [ox, oy] = fx.origin;
    const time = state.elapsed;
    ctx.lineCap = 'round';
    for (let i = 0; i < (fx.count ?? 48); i++) {
      const streak = i % 4 === 0;
      const age =
        (time * (streak ? 0.44 + seed(i) * 0.21 : 0.65 + seed(i) * 0.66) + seed(i + 2)) % 1;
      const fall = age * (0.45 + age * 0.55);
      const range = streak ? 275 + seed(i + 25) * 178 : 35 + seed(i + 25) * 153;
      const px =
        ox + seed(i + 42) * 46 + (seed(i + 11) - 0.56) * 148 * age + (streak ? 155 : 53) * fall;
      const py = oy + range * fall;
      const hot = ease(0, 0.06, age) * (1 - ease(streak ? 0.61 : 0.32, 1, age));
      const trail = streak ? (18 + seed(i + 8) * 37) * (0.55 + age * 0.63) : 2 + seed(i + 8) * 5;
      const tailX = px - (streak ? trail * (0.28 + fall * 0.34) : 2);
      const tailY = py - trail;
      const intensity = hot * (0.78 + burst * 0.22);
      const light = ctx.createLinearGradient(tailX, tailY, px, py);
      light.addColorStop(0, 'rgba(255, 83, 17, 0)');
      light.addColorStop(0.7, `rgba(255, 123, 28, ${intensity * 0.75})`);
      light.addColorStop(1, `rgba(255, 206, 87, ${intensity})`);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px, py);
      ctx.strokeStyle = light;
      ctx.lineWidth = streak ? 5.6 + burst * 2 : 1.7 + seed(i + 6) * 1.25;
      ctx.stroke();
      if (streak) {
        ctx.strokeStyle = `rgba(255, 235, 166, ${intensity * 0.88})`;
        ctx.lineWidth = 1.65;
        ctx.beginPath();
        ctx.moveTo(px * 0.38 + tailX * 0.62, py * 0.38 + tailY * 0.62);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    const [gx, gy] = fx.glow ?? [ox + 25, oy - 3];
    const glow = ctx.createRadialGradient(gx, gy, 3, gx, gy, 78);
    glow.addColorStop(0, `rgba(255, 179, 54, ${0.26 + burst * 0.46})`);
    glow.addColorStop(1, 'rgba(255, 111, 25, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(gx - 82, gy - 82, 165, 165);
  },

  /** Un halo large autour d'une source, qui gagne en intensité pendant un accent. */
  halo(ctx, fx, state) {
    const [cx, cy] = fx.center;
    const radius = fx.radius ?? 705;
    const accent = driven(state, fx.curve);
    const glow = ctx.createRadialGradient(cx, cy, fx.inner ?? 25, cx, cy, radius);
    glow.addColorStop(0, rgba(fx.color, (fx.intensity ?? 0.8) * (0.5 + accent * 0.24)));
    glow.addColorStop(0.52, rgba(fx.color, fx.middle ?? 0.16));
    glow.addColorStop(1, rgba(fx.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  },

  /** Une optique : faisceau, cœur, reflet horizontal et anneaux de balayage, éblouie par un signal. */
  lens(ctx, fx, state) {
    const [cx, cy] = fx.center;
    const glare = driven(state, fx.glare);
    const accent = driven(state, fx.curve);
    const intensity = fx.intensity ?? 0.82;
    const tint = (alpha) => rgba(fx.color, alpha);
    const beam = ctx.createRadialGradient(cx, cy, 32, cx, cy, 690);
    beam.addColorStop(0, `rgba(216, 245, 255, ${0.08 + 0.44 * glare})`);
    beam.addColorStop(0.27, tint(0.035 + 0.59 * glare));
    beam.addColorStop(0.63, tint(0.22 * glare));
    beam.addColorStop(1, tint(0));
    ctx.fillStyle = beam;
    ctx.fillRect(cx - 690, cy - 690, 1380, 1380);
    const glow = ctx.createRadialGradient(cx, cy, 12, cx, cy, 193);
    glow.addColorStop(0, `rgba(220, 247, 255, ${0.18 + 0.5 * glare})`);
    glow.addColorStop(
      0.55,
      tint(intensity * (0.3 + 0.3 * glare + 0.05 * Math.sin(state.elapsed * 2))),
    );
    glow.addColorStop(1, tint(0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 193, cy - 193, 386, 386);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.09 + 0.06 * glare);
    const flare = ctx.createRadialGradient(0, 0, 0, 0, 0, 335);
    flare.addColorStop(0, `rgba(225, 251, 255, ${0.06 + 0.59 * glare})`);
    flare.addColorStop(0.38, tint(0.06 + 0.3 * glare));
    flare.addColorStop(1, tint(0));
    ctx.fillStyle = flare;
    ctx.fillRect(-335, -335, 670, 670);
    ctx.restore();
    for (let ring = 0; ring < 3; ring++) {
      const radius = 101 + ring * 31;
      ctx.strokeStyle = tint(0.22 + 0.19 * accent + ring * 0.03);
      ctx.lineWidth = 2.5 - ring * 0.5;
      for (let arc = 0; arc < 3; arc++) {
        const angle = state.elapsed * (ring % 2 ? -0.7 : 0.47) + (arc * Math.PI * 2) / 3 + ring;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius, radius * 0.82, -0.23, angle, angle + 0.64 - ring * 0.12);
        ctx.stroke();
      }
    }
  },

  /** Des poussières lumineuses qui montent lentement autour d'un point. */
  motes(ctx, fx, state) {
    const [cx, cy] = fx.center;
    const first = fx.offset ?? 0;
    for (let i = 0; i < (fx.count ?? 27); i++) {
      const index = i + first;
      const age =
        (state.elapsed * (fx.speed ?? 1) * (0.067 + (index % 5) * 0.014) + index * 0.618) % 1;
      const px = cx + ((index * 183) % 1040) - 520 + Math.sin(age * 5 + index) * 28;
      const py = cy + 490 - age * 870;
      ctx.fillStyle = rgba(fx.color, Math.sin(age * Math.PI) ** 2 * (0.35 + (index % 3) * 0.17));
      ctx.beginPath();
      ctx.arc(px, py, (fx.size ?? 1) + (index % 4) * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** Un reflet qui glisse le long d'une arme pendant un accent (immobile si `to` manque). */
  glint(ctx, fx, state) {
    const shine = pulse(state.t, fx.window ?? [1.39, 1.8, 1.96, 2.6]);
    if (!shine) return;
    const [start, end] = fx.travel ?? [1.35, 2.57];
    const progress = ease(start, end, state.t);
    const to = fx.to ?? fx.from;
    const px = fx.from[0] + (to[0] - fx.from[0]) * progress;
    const py = fx.from[1] + (to[1] - fx.from[1]) * progress;
    const radius = fx.radius ?? 22;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, radius);
    glow.addColorStop(0, rgba(fx.color ?? [255, 223, 171], shine * (fx.alpha ?? 0.8)));
    glow.addColorStop(1, rgba(fx.edge ?? fx.color ?? [255, 185, 140], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  },

  /** Des poussières qui descendent le long d'un rayon de lumière oblique. */
  beamDust(ctx, fx, state) {
    const [x0, y0] = fx.top;
    const length = fx.length ?? 595;
    for (let index = 0; index < (fx.count ?? 29); index++) {
      const age = (state.elapsed * (0.11 + (index % 5) * 0.014) + index * 0.618) % 1;
      const py = y0 + age * length;
      const px =
        x0 +
        (py - y0) * (fx.slope ?? -0.42) +
        ((index * 47) % (fx.spread ?? 174)) -
        (fx.spread ?? 174) / 2 +
        Math.sin(age * 7 + index) * 12;
      const opacity = Math.sin(age * Math.PI) ** 2 * (0.35 + (index % 4) * 0.12);
      ctx.fillStyle = rgba(fx.color, opacity);
      ctx.beginPath();
      ctx.arc(px, py, 0.9 + (index % 4) * 0.62, 0, 2 * Math.PI);
      ctx.fill();
    }
  },

  /** Des poussières qui montent lentement du sol sur toute la largeur. */
  rising(ctx, fx, state) {
    const [x0, width] = fx.span;
    for (let index = 0; index < (fx.count ?? 21); index++) {
      const offset = index * 0.618;
      const age = (state.elapsed * (0.045 + (index % 4) * 0.014) + offset) % 1;
      const px = ((index * 143.9) % width) + x0 + Math.sin(age * 5 + offset) * 19;
      const py = fx.y - age * (fx.rise ?? 730);
      const opacity = Math.sin(age * Math.PI) ** 2 * (0.18 + (index % 3) * 0.09);
      ctx.fillStyle = rgba(fx.color, opacity);
      ctx.beginPath();
      ctx.arc(px, py, 1 + (index % 4) * 0.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  },
};

function drawEffect(ctx, fx, state, images) {
  if (fx.hideDuringIntro && state.intro >= 0 && state.intro < state.introClear) return;
  ctx.save();
  ctx.globalCompositeOperation = fx.blend ?? 'screen';
  if (fx.parallax === 'background') {
    ctx.translate(...backgroundShift(state.scene, state.pointer, state.elapsed, state.animated));
  }
  // Dans le repère d'un calque, sans son découpage : un faisceau déborde de l'œil qui l'émet.
  if (fx.frame) state.runtime.apply(ctx, fx.frame, state);
  EFFECTS[fx.type](ctx, fx, state, images);
  ctx.restore();
}

/* ---------- Intros ---------- */

/**
 * « strike » : un symbole du jeu s'allume seul dans le noir, une poussée file le long d'une
 * arme, un impact éclate et la scène s'ouvre depuis ce point avec un bord irrégulier, pendant
 * qu'une gerbe de sprites part du choc. Tirée de Sekiro (危, lance, hache).
 */
function strikeIntro(scene, images) {
  const p = scene.intro;
  const [vx, vy, vw, vh] = scene.view;
  const { symbol, thrust, impact } = p;
  const IMPACT = impact.time;
  const REVEAL_END = impact.revealEnd;
  const shade = document.createElement('canvas');
  // Une marge noire de 10 px : le lissage et la secousse ne montrent jamais un bord clair.
  shade.width = Math.round(vw / 3) + 20;
  shade.height = Math.round(vh / 3) + 20;
  const shadeContext = shade.getContext('2d');
  const [ix, iy] = impact.at;
  const thrustAt = (time) => {
    const u = clamp01((time - thrust.start) / (thrust.end - thrust.start));
    const k = u ** 1.7;
    return {
      u,
      x: thrust.from[0] + (thrust.to[0] - thrust.from[0]) * k,
      y: thrust.from[1] + (thrust.to[1] - thrust.from[1]) * k,
    };
  };
  const edgeRadius = (angle) =>
    1 +
    0.09 * Math.sin(5 * angle + 1.3) +
    0.05 * Math.sin(11 * angle + 0.4) +
    0.025 * Math.sin(23 * angle + 2.1);
  const revealRadius = (time) => (impact.radius ?? 1750) * ease(IMPACT, REVEAL_END, time) ** 0.8;

  function lightHole(px, py, radius, alpha) {
    const sx = (px - vx) / 3 + 10,
      sy = (py - vy) / 3 + 10,
      sr = radius / 3;
    const hole = shadeContext.createRadialGradient(sx, sy, 0, sx, sy, sr);
    hole.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
    shadeContext.fillStyle = hole;
    shadeContext.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }

  function revealShape(target, small, radius, offset) {
    target.beginPath();
    for (let step = 0; step <= 72; step++) {
      const angle = (step / 72) * Math.PI * 2;
      const r = radius * edgeRadius(angle) - offset;
      let px = ix + Math.cos(angle) * r;
      let py = iy + Math.sin(angle) * r;
      if (small) {
        px = (px - vx) / 3 + 10;
        py = (py - vy) / 3 + 10;
      }
      if (step) target.lineTo(px, py);
      else target.moveTo(px, py);
    }
    target.closePath();
  }

  function shadeLayer(ctx, time) {
    if (time >= REVEAL_END + 0.1) return;
    shadeContext.globalCompositeOperation = 'source-over';
    shadeContext.clearRect(0, 0, shade.width, shade.height);
    shadeContext.fillStyle = '#000';
    shadeContext.fillRect(0, 0, shade.width, shade.height);
    shadeContext.globalCompositeOperation = 'destination-out';
    const warn = pulse(time, [symbol.in, symbol.in + 0.3, IMPACT, IMPACT + 0.12]);
    lightHole(symbol.at[0], symbol.at[1] + 140, 420, 0.22 * warn);
    if (time > thrust.start && time < IMPACT + 0.4) {
      const head = thrustAt(time);
      const linger = 1 - ease(IMPACT, IMPACT + 0.4, time);
      for (let k = 0; k < 10; k++) {
        const back = thrustAt(time - k * 0.025);
        lightHole(back.x, back.y, 95 - k * 4, 0.6 * (1 - k / 10) * linger);
      }
      const steps = Math.floor(head.u * 22);
      for (let k = 0; k <= steps; k++) {
        const s = k / 22;
        lightHole(
          thrust.from[0] + (thrust.to[0] - thrust.from[0]) * s,
          thrust.from[1] + (thrust.to[1] - thrust.from[1]) * s,
          70,
          0.38 * linger,
        );
      }
    }
    if (time >= IMPACT) {
      lightHole(ix, iy, 320, 1 - ease(IMPACT + 0.1, IMPACT + 0.5, time) * 0.3);
      const radius = revealRadius(time);
      for (let k = 6; k >= 0; k--) {
        shadeContext.fillStyle = `rgba(0, 0, 0, ${k ? 0.2 : 1})`;
        revealShape(shadeContext, true, radius, k * 18 + 30);
        shadeContext.fill();
      }
    }
    ctx.drawImage(shade, vx - 30, vy - 30, vw + 60, vh + 60);
  }

  function lights(ctx, time) {
    ctx.save();
    if (time >= IMPACT && time < REVEAL_END) {
      const fade = 1 - ease(IMPACT + 0.25, REVEAL_END, time);
      ctx.globalCompositeOperation = 'screen';
      revealShape(ctx, false, revealRadius(time), 34);
      ctx.strokeStyle = rgba(impact.edge ?? [255, 120, 34], 0.55 * fade);
      ctx.lineWidth = 22;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 214, 140, ${0.5 * fade})`;
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    // Le symbole du jeu : un cœur détouré, des lueurs qui ne dessinent que son ombre.
    const appear = ease(symbol.in, symbol.in + 0.22, time);
    const vanish = ease(IMPACT, IMPACT + 0.14, time);
    const alpha = appear * (1 - vanish);
    if (alpha > 0) {
      const [sx, sy] = symbol.at;
      const beat = 0.5 + 0.5 * Math.cos((time - symbol.in - 0.22) * 4.2);
      const grow = 1.35 - 0.35 * appear + 0.25 * vanish;
      const [glowColor, ...passes] = symbol.glow;
      ctx.globalCompositeOperation = 'screen';
      const halo = ctx.createRadialGradient(sx, sy, 10, sx, sy, 260);
      halo.addColorStop(0, rgba(glowColor, alpha * (0.4 + 0.2 * beat)));
      halo.addColorStop(1, rgba(glowColor, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(sx - 260, sy - 260, 520, 520);
      ctx.translate(sx, sy);
      ctx.scale(grow, grow);
      ctx.globalAlpha = alpha;
      const unit = ctx.getTransform().a;
      const glyph = images[scene.sprites[symbol.sprite].file];
      const size = symbol.size;
      passes.forEach(([color, blur, glowOnly], index) => {
        ctx.save();
        if (glowOnly) ctx.translate(10000, 0);
        ctx.shadowColor = rgba(color, color[3] ?? 1);
        ctx.shadowOffsetX = glowOnly ? -10000 * unit : 0;
        ctx.shadowBlur = (blur + (index === 0 ? 24 * beat : 0)) * unit;
        ctx.drawImage(glyph, -size / 2, -size / 2, size, (size * glyph.height) / glyph.width);
        ctx.restore();
      });
    }
    ctx.restore();
    ctx.save();

    if (time > thrust.start && time < IMPACT + 0.08) {
      const head = thrustAt(time);
      const tail = thrustAt(time - 0.09);
      const fade = 1 - ease(thrust.end, IMPACT + 0.08, time);
      ctx.globalCompositeOperation = 'screen';
      ctx.lineCap = 'round';
      const streak = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      streak.addColorStop(0, 'rgba(255, 190, 140, 0)');
      streak.addColorStop(1, `rgba(255, 244, 222, ${0.95 * fade})`);
      ctx.strokeStyle = streak;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      const bloom = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 110);
      bloom.addColorStop(0, `rgba(255, 246, 228, ${fade})`);
      bloom.addColorStop(0.2, `rgba(255, 214, 170, ${0.6 * fade})`);
      bloom.addColorStop(1, 'rgba(255, 170, 110, 0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(head.x - 110, head.y - 110, 220, 220);
    }

    const strike = pulse(time, [IMPACT - 0.03, IMPACT + 0.02, IMPACT + 0.08, IMPACT + 0.55]);
    if (strike > 0) {
      ctx.globalCompositeOperation = 'screen';
      const flash = ctx.createRadialGradient(ix, iy, 0, ix, iy, 300);
      flash.addColorStop(0, `rgba(255, 250, 230, ${strike})`);
      flash.addColorStop(0.25, `rgba(255, 170, 70, ${strike * 0.7})`);
      flash.addColorStop(1, 'rgba(255, 90, 20, 0)');
      ctx.fillStyle = flash;
      ctx.fillRect(ix - 300, iy - 300, 600, 600);
      ctx.fillStyle = `rgba(255, 248, 225, ${strike})`;
      const tilt = impact.starAngle ?? -0.35;
      for (const [angle, length] of [
        [tilt, 360],
        [tilt + Math.PI, 360],
        [tilt + 1.57, 210],
        [tilt + 1.57 + Math.PI, 210],
      ]) {
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, -7 * strike);
        ctx.lineTo(length * (0.6 + 0.4 * strike), 0);
        ctx.lineTo(0, 7 * strike);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    if (time >= IMPACT) {
      ctx.globalCompositeOperation = 'screen';
      ctx.lineCap = 'round';
      const age = time - IMPACT;
      for (let i = 0; i < 70; i++) {
        const life = 0.35 + seed(i + 5) * 0.55;
        const a = age / life;
        if (a >= 1) continue;
        const angle = -Math.PI * (0.05 + seed(i + 31) * 1.1) + (seed(i + 9) - 0.5) * 0.5;
        const speed = 500 + seed(i + 17) * 900;
        const travel = (speed * (1 - Math.exp(-3.2 * age))) / 3.2;
        const px = ix + Math.cos(angle) * travel;
        const py = iy + Math.sin(angle) * travel + 520 * age * age;
        const vxs = Math.cos(angle) * speed * Math.exp(-3.2 * age);
        const vys = Math.sin(angle) * speed * Math.exp(-3.2 * age) + 1040 * age;
        const hot = 1 - a;
        ctx.strokeStyle = `rgba(255, ${150 + 90 * hot}, ${60 + 120 * hot}, ${hot})`;
        ctx.lineWidth = 1.5 + 3 * seed(i + 3) * hot;
        ctx.beginPath();
        ctx.moveTo(px - vxs * 0.03, py - vys * 0.03);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    ctx.restore();

    // La gerbe de sprites soufflée par le choc, qui ralentit et rejoint la boucle.
    if (p.burst && time >= IMPACT) {
      const sheet = scene.sprites[p.burst.sprite];
      const image = images[sheet.file];
      const age = time - IMPACT;
      for (let i = 0; i < (p.burst.count ?? 120); i++) {
        const life = 1.7 + seed(i + 40) * 1.4;
        const a = age / life;
        if (a >= 1) continue;
        const angle = (seed(i * 7 + 3) - 0.5) * Math.PI * 1.7;
        const speed = 700 + seed(i + 13) * 1500;
        const travel = (speed * (1 - Math.exp(-2.6 * age))) / 2.6;
        const depth = seed(i + 77);
        const size = (24 + 70 * depth ** 1.5) * (0.7 + 0.3 * (1 - a));
        const px = ix + Math.cos(angle) * travel + 160 * age;
        const py =
          iy + Math.sin(angle) * travel * 0.75 + 60 * age * age + 18 * Math.sin(age * 6 + i);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(i + age * (3 + 6 * depth) * Math.exp(-age));
        ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.cos(i + age * 4)));
        ctx.globalAlpha = Math.min(1, age * 12) * (1 - a) ** 1.5 * (0.6 + 0.4 * depth);
        const frame = i % (sheet.frames ?? 1);
        ctx.drawImage(
          image,
          frame * sheet.frame,
          0,
          sheet.frame,
          sheet.frame,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        ctx.restore();
      }
    }
  }

  return {
    /** La boucle commence décalée : son temps `loopAt` tombe sur l'impact. */
    loopStart: (p.loopAt ?? IMPACT) - IMPACT,
    revealAt: p.revealAt / 1000,
    end: p.end ?? REVEAL_END + 2.2,
    /** Les reflets de la boucle restent éteints tant que la scène se dévoile. */
    clear: REVEAL_END + 0.4,
    shake: (time) => (p.shake ?? 10) * pulse(time, [IMPACT - 0.01, IMPACT, IMPACT, IMPACT + 0.22]),
    draw(ctx, time) {
      shadeLayer(ctx, time);
      lights(ctx, time);
    },
  };
}

/**
 * « portal » : un premier portail s'ouvre seul dans le noir, puis un second sur le sujet. Les
 * deux sont reliés : le premier montre ce que voit le second. Le sujet s'allume comme une ampoule
 * défectueuse et jette des regards (signaux remplacés), puis le second portail grandit jusqu'à
 * remplir la carte pendant que le premier se referme. Tirée de Portal 2.
 */
function portalIntro(scene, images, runtime) {
  const p = scene.intro;
  const [vx, vy, vw, vh] = scene.view;
  const first = p.first;
  const second = p.second;
  const view = document.createElement('canvas');
  view.width = second.size[0];
  view.height = second.size[1];

  /** Ouverture avec dépassement, comme un portail qui se pose sur une paroi. */
  const opening = (time, start) => {
    const u = clamp01((time - start) / 0.34);
    if (!u) return 0;
    const v = u - 1;
    return 1 + 2.9 * v ** 3 + 1.9 * v ** 2;
  };
  const portalPath = (cx, cy, rx, ry, time, phase) => {
    const path = new Path2D();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const wobble =
        1 +
        0.009 * Math.sin(5 * a + time * 9 + phase) +
        0.005 * Math.sin(11 * a - time * 13 + phase);
      const px = cx + Math.cos(a) * rx * wobble;
      const py = cy + Math.sin(a) * ry * wobble;
      if (i) path.lineTo(px, py);
      else path.moveTo(px, py);
    }
    path.closePath();
    return path;
  };
  function rim(ctx, path, [r, g, b], cx, cy, rx, ry, time, alpha, phase) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineJoin = 'round';
    ctx.save();
    ctx.clip(path);
    for (const [width, a] of [
      [150, 0.14],
      [70, 0.22],
    ]) {
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * alpha})`;
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
    ctx.restore();
    for (const [width, a, white] of [
      [64, 0.1, 0],
      [34, 0.26, 0],
      [17, 0.6, 0.25],
      [6, 1, 0.75],
    ]) {
      const mix = (c) => Math.round(c + (255 - c) * white);
      ctx.strokeStyle = `rgba(${mix(r)}, ${mix(g)}, ${mix(b)}, ${a * alpha})`;
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
    for (let i = 0; i < 46; i++) {
      const offset = (i * 0.618033989 + phase) % 1;
      const a = offset * Math.PI * 2 + time * (0.7 + offset * 0.9) * (i % 2 ? 1 : -1);
      const out = (time * (0.8 + offset) + offset * 3) % 1;
      const spread = 1 + 0.03 + out * (0.12 + 0.1 * offset);
      ctx.fillStyle = `rgba(${Math.min(255, r + 120)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 40)}, ${alpha * (1 - out) * 0.9})`;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(a) * rx * spread,
        cy + Math.sin(a) * ry * spread,
        2.5 + 3 * (1 - out),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }
  const bootPower = (time) => {
    let power = 0.04;
    for (const [at, value] of p.boot ?? []) if (time >= at) power = value;
    return power;
  };

  function draw(ctx, time, state) {
    const expand = ease(second.expand[0], second.expand[1], time);
    const done = ease(p.done[0], p.done[1], time);
    const secondOpen = opening(time, second.open);
    const grow = 1 + 7.5 * expand ** 2;
    const [bx, by] = second.at;
    const brx = second.size[0] * secondOpen * grow;
    const bry = second.size[1] * secondOpen * grow;
    const secondPath = secondOpen > 0 ? portalPath(bx, by, brx, bry, time, 0) : null;
    if (secondPath) {
      ctx.save();
      ctx.clip(secondPath);
      const power = bootPower(time);
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.35 + 0.35 * (1 - power)) * (1 - expand)})`;
      ctx.fillRect(vx, vy, vw, vh);
      const aperture = p.lamp ? runtime.clipPath(p.lamp) : null;
      if (aperture && power < 1) {
        ctx.save();
        runtime.apply(ctx, runtime.layers.get(p.lamp).clip.frame, state, true);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.9 * (1 - power)})`;
        ctx.fill(aperture);
        ctx.restore();
      }
      ctx.restore();
    }
    // Les portails sont reliés : le premier montre ce que voit le second.
    const firstOpen = opening(time, first.open) * (1 - ease(first.close[0], first.close[1], time));
    if (firstOpen > 0 && secondPath) {
      const m = ctx.getTransform();
      const sx = bx - second.size[0],
        sy = by - second.size[1];
      view
        .getContext('2d')
        .drawImage(
          runtime.canvas,
          m.a * sx + m.e,
          m.d * sy + m.f,
          m.a * second.size[0] * 2,
          m.d * second.size[1] * 2,
          0,
          0,
          view.width,
          view.height,
        );
    }
    const mask = new Path2D();
    mask.rect(vx - 80, vy - 80, vw + 160, vh + 160);
    if (secondPath) mask.addPath(secondPath);
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - done})`;
    ctx.fill(mask, 'evenodd');

    if (firstOpen > 0) {
      const [ox, oy] = first.at;
      const orx = first.size[0] * firstOpen;
      const ory = first.size[1] * firstOpen;
      const firstPath = portalPath(ox, oy, orx, ory, time, 2.1);
      ctx.save();
      ctx.clip(firstPath);
      ctx.fillStyle = '#000';
      ctx.fillRect(ox - orx * 1.2, oy - ory * 1.2, orx * 2.4, ory * 2.4);
      if (secondPath) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(
          view,
          ox - second.size[0] * firstOpen,
          oy - second.size[1] * firstOpen,
          second.size[0] * 2 * firstOpen,
          second.size[1] * 2 * firstOpen,
        );
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      rim(ctx, firstPath, first.color, ox, oy, orx, ory, time, Math.min(1, firstOpen * 1.5), 0.37);
    }
    if (secondPath) {
      const fade = 1 - ease(second.rimFade[0], second.rimFade[1], time);
      rim(
        ctx,
        secondPath,
        second.color,
        bx,
        by,
        brx,
        bry,
        time,
        Math.min(1, secondOpen * 1.5) * fade,
        0,
      );
    }

    // L'éclat d'ouverture de chaque portail.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const portal of [first, second]) {
      const [px, py] = portal.at;
      const pop =
        ease(portal.open, portal.open + 0.05, time) *
        (1 - ease(portal.open + 0.05, portal.open + 0.45, time));
      if (!pop) continue;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, 420);
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.8 * pop})`);
      glow.addColorStop(0.2, rgba(portal.color, 0.6 * pop));
      glow.addColorStop(1, rgba(portal.color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(px - 420, py - 420, 840, 840);
    }
    ctx.restore();
  }

  return {
    loopStart: 0,
    freezeLoop: true,
    revealAt: p.revealAt / 1000,
    end: p.end,
    clear: 0,
    shake: () => 0,
    /** Les regards du sujet pendant l'intro : des étapes qui remplacent ceux de la boucle. */
    signals(time) {
      const values = {};
      for (const [name, steps] of Object.entries(p.signals ?? {})) {
        values[name] = steps.reduce(
          (sum, [start, end, weight]) => sum + weight * ease(start, end, time),
          0,
        );
      }
      return values;
    },
    draw,
  };
}

/* Bruit lissé, pour les bords irréguliers et les matières (sang, brume). */
const hash2 = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
function noise2(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy),
    c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Un voile noir réduit au tiers, percé puis posé sur la scène : bords doux, peu de calcul. */
function shadeLayer(scene) {
  const [vx, vy, vw, vh] = scene.view;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw / 3) + 20;
  canvas.height = Math.round(vh / 3) + 20;
  const context = canvas.getContext('2d');
  return {
    context,
    begin(color = [0, 0, 0]) {
      context.globalCompositeOperation = 'source-over';
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = rgba(color, 1);
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Les trous se tracent en pixels de la scène.
      context.setTransform(1 / 3, 0, 0, 1 / 3, 10 - vx / 3, 10 - vy / 3);
      context.globalCompositeOperation = 'destination-out';
    },
    draw(ctx, alpha = 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(canvas, vx - 30, vy - 30, vw + 60, vh + 60);
      ctx.restore();
    },
  };
}

/**
 * « slash » : des coups d'arme tracent leurs croissants dans le noir et laissent entrevoir la
 * scène, puis un grand coup la déchire depuis sa trace, avec un bord irrégulier et une lisière
 * pâle. Tirée de Hollow Knight.
 */
function slashIntro(scene) {
  const p = scene.intro;
  const shade = shadeLayer(scene);
  const color = p.color ?? [247, 252, 255];
  const bloom = p.bloom ?? [140, 184, 230];
  const tear = p.tear;
  const big = p.slashes[tear.slash];
  const open = (time) => (tear.max ?? 1200) * ease(tear.open[0], tear.open[1], time) ** 1.4;

  /**
   * Un croissant d'un seul tenant : la tête balaie l'arc et laisse une traîne. Sa forme suit
   * l'épaisseur, et un dégradé conique porte la traîne le long de l'arc.
   */
  function crescent(ctx, slash, time, spread, rgb, alpha) {
    const k = (time - slash.start) / (slash.duration ?? 0.2);
    if (k <= 0 || k > 2.2) return;
    const head = k * 1.4;
    const fade = 1 - ease(1, 2.2, k);
    const [cx, cy] = slash.center;
    const [a0, a1] = slash.angles;
    const steps = 48;
    const trailAt = (sv) =>
      ease(head - 0.9, head - 0.15, sv) * (1 - ease(head - 0.07, head + 0.02, sv));
    const outer = [],
      inner = [];
    for (let n = 0; n <= steps; n++) {
      const sv = n / steps;
      const width =
        slash.width * spread * Math.sin(Math.PI * sv) ** 0.7 * (0.55 + 0.45 * trailAt(sv));
      const angle = a0 + (a1 - a0) * sv;
      outer.push([
        cx + Math.cos(angle) * (slash.radius + width / 2),
        cy + Math.sin(angle) * (slash.radius + width / 2),
      ]);
      inner.push([
        cx + Math.cos(angle) * (slash.radius - width / 2),
        cy + Math.sin(angle) * (slash.radius - width / 2),
      ]);
    }
    const low = Math.min(a0, a1);
    const turn = Math.PI * 2;
    const gradient = ctx.createConicGradient(low, cx, cy);
    const stops = [];
    for (let n = 0; n <= steps; n++) {
      const sv = n / steps;
      const angle = a0 + (a1 - a0) * sv;
      stops.push([Math.min(1, Math.max(0, (angle - low) / turn)), trailAt(sv) * fade * alpha]);
    }
    stops.sort((a, b) => a[0] - b[0]);
    for (const [at, value] of stops) gradient.addColorStop(at, rgba(rgb, value));
    gradient.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    outer.forEach((point, index) => (index ? ctx.lineTo(...point) : ctx.moveTo(...point)));
    for (const point of inner.reverse()) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fill();
  }

  /** Le bord de la déchirure : un cercle bosselé autour de l'arc du grand coup. */
  function tearRing(target, time, offset) {
    const [cx, cy] = big.center;
    const steps = 160;
    for (const side of [1, -1]) {
      target.moveTo(cx + big.radius + side * offset, cy);
      for (let n = 0; n <= steps; n++) {
        const angle = (n / steps) * Math.PI * 2 * side;
        const bump = 110 * (noise2(Math.cos(angle) * 5 + time * 0.6, Math.sin(angle) * 5) - 0.5);
        const r = big.radius + side * (offset - bump);
        target.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      target.closePath();
    }
  }

  return {
    loopStart: 0,
    revealAt: p.revealAt / 1000,
    end: p.end,
    clear: tear.open[1],
    shake: () => 0,
    draw(ctx, time) {
      const done = ease(p.done[0], p.done[1], time);
      shade.begin([0, 1, 3]);
      const view = shade.context;
      for (const slash of p.slashes) crescent(view, slash, time, 1.6, [0, 0, 0], 0.5);
      const width = open(time);
      if (width > 0) {
        for (let k = 3; k >= 0; k--) {
          view.fillStyle = `rgba(0, 0, 0, ${k ? 0.3 : 1})`;
          view.beginPath();
          tearRing(view, time, Math.max(0, width - k * 25));
          view.fill('evenodd');
        }
      }
      shade.draw(ctx, 1 - done);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (const slash of p.slashes) {
        crescent(ctx, slash, time, 3, bloom, 0.28);
        crescent(ctx, slash, time, 1, color, 1);
      }
      if (width > 0) {
        const edge =
          1 -
          ease(
            tear.edgeFade?.[0] ?? tear.open[0] + 0.4,
            tear.edgeFade?.[1] ?? tear.open[1] - 0.1,
            time,
          );
        ctx.strokeStyle = rgba(tear.edge ?? [184, 219, 255], 0.45 * edge);
        ctx.lineWidth = 10;
        ctx.beginPath();
        tearRing(ctx, time, width);
        ctx.stroke();
      }
      if (p.flash !== undefined) {
        const flash =
          ease(p.flash, p.flash + 0.04, time) * (1 - ease(p.flash + 0.04, p.flash + 0.4, time));
        if (flash > 0) {
          const [cx, cy] = big.center;
          ctx.strokeStyle = rgba(bloom, 0.2 * flash);
          ctx.lineWidth = 140;
          ctx.beginPath();
          ctx.arc(cx, cy, big.radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}

/**
 * « dawn » : dans la nuit, une lumière tourne autour d'un objet qui tombe (une plume), puis
 * s'envole vers un coin d'où l'aube se lève avec un bord nuageux ; un souffle emporte l'objet.
 * Tirée d'Ori.
 */
function dawnIntro(scene, images) {
  const p = scene.intro;
  const shade = shadeLayer(scene);
  const night = p.night ?? [4, 5, 12];
  const orb = p.orb;
  const item = p.feather;
  const [ox, oy] = p.origin;
  const itemAt = (time) => {
    const [[x0, y0], [, y1]] = item.fall;
    const blown = ease(item.blow.times[0], item.blow.times[1], time);
    return [
      x0 + 55 * Math.sin(time * 1.4) + item.blow.by[0] * blown * blown,
      y0 + (y1 - y0) * ease(item.times[0], item.times[1], time) + item.blow.by[1] * blown * blown,
    ];
  };
  const orbAt = (time) => {
    const w = time * 2.7;
    const [fx, fy] = itemAt(Math.min(time, orb.leave[0]));
    const around = [fx + Math.cos(w) * 150, fy + Math.sin(w) * 80 - 20];
    const leave = ease(orb.leave[0], orb.leave[1], time) ** 2;
    return [around[0] + (ox - around[0]) * leave, around[1] + (oy - around[1]) * leave];
  };
  const radius = (time) => (p.radius ?? 2700) * ease(p.open[0], p.open[1], time) ** 1.3;
  function dawnEdge(target, time, offset) {
    const steps = 120;
    const r0 = radius(time);
    for (let n = 0; n <= steps; n++) {
      const angle = (n / steps) * Math.PI * 2;
      const r = Math.max(
        0,
        r0 - offset + 220 * (noise2(Math.cos(angle) * 4 + time * 0.35, Math.sin(angle) * 4) - 0.5),
      );
      const px = ox + Math.cos(angle) * r,
        py = oy + Math.sin(angle) * r;
      if (n) target.lineTo(px, py);
      else target.moveTo(px, py);
    }
    target.closePath();
  }
  /** Une plume dessinée : un rachis et deux vanes inégales, éclairés par la lumière. */
  function feather(ctx, time, lit) {
    const visible =
      ease(item.times[0], item.times[0] + 0.3, time) *
      (1 - ease(item.blow.times[0] + 0.7, item.blow.times[0] + 1.2, time));
    if (visible <= 0) return;
    const [fx, fy] = itemAt(time);
    const angle =
      0.9 + 0.55 * Math.sin(time * 1.25) + 2.2 * ease(item.blow.times[0], item.blow.times[1], time);
    const length = item.length ?? 240;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(-angle);
    ctx.globalAlpha = visible * (0.55 + 0.45 * lit);
    const sprite = item.sprite ? images[scene.sprites[item.sprite].file] : null;
    if (sprite) {
      ctx.drawImage(
        sprite,
        -length / 2,
        -length / 4,
        length,
        (length * sprite.height) / sprite.width,
      );
    } else {
      const shade = (base, light) =>
        `rgb(${Math.round(base[0] + light[0] * lit)}, ${Math.round(base[1] + light[1] * lit)}, ${Math.round(base[2] + light[2] * lit)})`;
      ctx.fillStyle = shade([26, 23, 36], [89, 158, 242]);
      for (const side of [1, -1]) {
        const vane = side > 0 ? length * 0.21 : length * 0.15;
        ctx.beginPath();
        ctx.moveTo(-length * 0.46, 0);
        ctx.quadraticCurveTo(-length * 0.1, side * vane * 1.3, length * 0.5, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = shade([40, 38, 54], [128, 178, 230]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-length * 0.62, 0);
      ctx.lineTo(length * 0.5, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  return {
    loopStart: 0,
    revealAt: p.revealAt / 1000,
    end: p.end,
    clear: p.open[1],
    shake: () => 0,
    draw(ctx, time) {
      shade.begin(night);
      if (radius(time) > 0) {
        for (let k = 3; k >= 0; k--) {
          shade.context.fillStyle = `rgba(0, 0, 0, ${k ? 0.3 : 1})`;
          shade.context.beginPath();
          dawnEdge(shade.context, time, k * 35 + 40);
          shade.context.fill();
        }
      }
      shade.draw(ctx);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (radius(time) > 0) {
        ctx.strokeStyle = rgba(
          p.rim ?? [255, 199, 158],
          0.12 * (1 - ease(p.open[0] + 1, p.open[1], time)),
        );
        ctx.lineWidth = 16;
        ctx.beginPath();
        dawnEdge(ctx, time, 30);
        ctx.stroke();
      }
      ctx.restore();
      const [px, py] = orbAt(time);
      const [fx, fy] = itemAt(time);
      const lit =
        Math.exp(-Math.hypot(px - fx, py - fy) / 170) *
        (1 - ease(orb.leave[0] + 0.4, orb.leave[1], time));
      feather(ctx, time, lit);
      const visible = ease(0.35, 0.7, time) * (1 - ease(orb.leave[1] - 0.25, orb.leave[1], time));
      if (visible <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let k = 13; k >= 0; k--) {
        const [tx, ty] = orbAt(time - k * 0.028);
        const size = k ? 10 : 70;
        const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, size);
        const alpha = visible * (k ? 0.45 * (1 - k / 14) : 1);
        glow.addColorStop(0, `rgba(235, 248, 255, ${alpha})`);
        glow.addColorStop(0.3, rgba(orb.color, alpha * 0.6));
        glow.addColorStop(1, rgba(orb.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(tx - size, ty - size, size * 2, size * 2);
      }
      const halo = ctx.createRadialGradient(px, py, 0, px, py, 180);
      halo.addColorStop(0, rgba(orb.color, 0.3 * visible));
      halo.addColorStop(1, rgba(orb.color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(px - 180, py - 180, 360, 360);
      ctx.restore();
    },
  };
}

/**
 * « drain » : un bassin de liquide vu de dessus (ondes, bulles, une onde annonce la remontée),
 * puis le liquide s'écoule vers le bas en laissant des coulures, pendant que la scène remonte.
 * Tirée de Hadès (le Styx).
 */
function drainIntro(scene) {
  const p = scene.intro;
  const [vx, vy, vw, vh] = scene.view;
  const deep = p.deep ?? [33, 0, 3];
  const bright = p.bright ?? [128, 6, 9];
  const glint = p.glint ?? [255, 110, 90];
  // La matière du liquide : un bruit coloré calculé une fois, étiré et décalé à chaque image.
  const matter = document.createElement('canvas');
  matter.width = 320;
  matter.height = 160;
  const pixels = matter.getContext('2d');
  const image = pixels.createImageData(matter.width, matter.height);
  for (let y = 0; y < matter.height; y++) {
    for (let x = 0; x < matter.width; x++) {
      // Des octaves tournées et un léger tourbillon : pas de motif aligné sur la grille du bruit.
      const wx = x + 18 * (noise2(x / 40, y / 40 + 7) - 0.5);
      const wy = y + 18 * (noise2(x / 40 + 3, y / 40) - 0.5);
      const n =
        noise2(wx / 30, wy / 30) * 0.55 +
        noise2((wx * 0.8 + wy * 0.6) / 12, (wy * 0.8 - wx * 0.6) / 12) * 0.3 +
        noise2((wx * 0.6 - wy * 0.8) / 5, (wy * 0.6 + wx * 0.8) / 5) * 0.15;
      const k = n ** 1.25;
      const shine = noise2((wx * 0.7 + wy * 0.7) / 16 + 40, (wy * 0.7 - wx * 0.7) / 16) ** 6 * 0.5;
      const offset = (y * matter.width + x) * 4;
      image.data[offset] = Math.min(255, deep[0] + (bright[0] - deep[0]) * k + glint[0] * shine);
      image.data[offset + 1] = Math.min(
        255,
        deep[1] + (bright[1] - deep[1]) * k + glint[1] * shine,
      );
      image.data[offset + 2] = Math.min(
        255,
        deep[2] + (bright[2] - deep[2]) * k + glint[2] * shine,
      );
      image.data[offset + 3] = 255;
    }
  }
  pixels.putImageData(image, 0, 0);
  const pattern = { canvas: matter };
  const progress = (time) => ease(p.drain[0], p.drain[1], time);
  const level = (time) => vy - 140 + (vh + 280) * progress(time) ** 1.15;
  const edgeAt = (x, time) =>
    level(time) + 9 * Math.sin(x / 63 + time * 2.6) + 5 * Math.sin(x / 23 - time * 3.4);
  const drips = Array.from({ length: p.drips ?? 10 }, (_, index) => ({
    x: p.span[0] + seed(index + 21) * (p.span[1] - p.span[0]),
    width: 2 + seed(index + 24) * 4.5,
    length: 50 + seed(index + 28) * 170,
  }));

  function liquidPath(time) {
    const path = new Path2D();
    path.moveTo(vx - 40, vy + vh + 40);
    for (let x = vx - 40; x <= vx + vw + 40; x += 12) path.lineTo(x, edgeAt(x, time));
    path.lineTo(vx + vw + 40, vy + vh + 40);
    path.closePath();
    const drain = progress(time);
    const grow = ease(0.05, 0.6, drain) * (1 - ease(0.82, 0.98, drain));
    for (const drip of drips) {
      const length = drip.length * grow;
      if (length < 1) continue;
      const edge = edgeAt(drip.x, time);
      path.rect(drip.x - drip.width, edge - length, drip.width * 2, length + 4);
      path.moveTo(drip.x + drip.width * 1.1, edge - length);
      path.arc(drip.x, edge - length, drip.width * 1.1, 0, Math.PI * 2);
    }
    return path;
  }

  return {
    loopStart: 0,
    revealAt: p.revealAt / 1000,
    end: p.end,
    clear: p.drain[1],
    shake: () => 0,
    /** La scène remonte du liquide pendant qu'il s'écoule. */
    offset: (time) => (p.rise ?? 70) * (1 - progress(time)),
    draw(ctx, time) {
      const drain = progress(time);
      if (drain >= 1) return;
      const path = liquidPath(time);
      const [cx, cy] = p.pool;
      ctx.save();
      // Le reflet humide sur ce qui vient d'émerger.
      if (drain > 0) {
        const top = level(time);
        const wet = ctx.createLinearGradient(0, top - 140, 0, top);
        wet.addColorStop(0, 'rgba(120, 20, 15, 0)');
        wet.addColorStop(1, `rgba(120, 20, 15, ${0.45 * (1 - ease(0.9, 1, drain))})`);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = wet;
        ctx.fillRect(vx, top - 140, vw, 140);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.clip(path);
      // Le liquide couvre tout dès le départ : il sort du noir, la scène n'apparaît pas dessous.
      ctx.fillStyle = '#000';
      ctx.fillRect(vx - 40, vy - 200, vw + 80, vh + 400);
      ctx.globalAlpha = ease(0.2, 0.85, time);
      const span = vw * 1.25;
      const drift = (time * 14) % span;
      for (const shift of [0, span]) {
        ctx.drawImage(pattern.canvas, vx - drift + shift, vy - 60, span, span / 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'screen';
      const calm = (1 - drain) * ease(0.2, 0.85, time);
      for (let ring = 0; ring < 6; ring++) {
        const r = ((ring * 120 + time * 85) % 720) + 20;
        ctx.strokeStyle = rgba(glint, 0.22 * calm * (1 - r / 740));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r / 1.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (time >= p.surge) {
        const r = (time - p.surge) * 1300;
        const surge = 1 - ease(p.surge, p.surge + 0.75, time);
        ctx.strokeStyle = rgba(glint, 0.6 * surge);
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r / 1.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 7; i++) {
        const period = 1.2 + seed(i + 9);
        const age = ((time + seed(i + 2) * 4) / period) % 1;
        if (age > 0.82) continue;
        const bx = cx + (seed(i + 1) - 0.5) * 1100,
          by = cy + (seed(i + 6) - 0.5) * 520;
        const r = 4 + (10 + 10 * seed(i + 4)) * ease(0, 0.8, age);
        ctx.strokeStyle = rgba(glint, 0.3 * calm);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      if (drain > 0 && drain < 0.95) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = rgba(glint, 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = vx - 40; x <= vx + vw + 40; x += 12) {
          if (x === vx - 40) ctx.moveTo(x, edgeAt(x, time));
          else ctx.lineTo(x, edgeAt(x, time));
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

const INTROS = {
  strike: strikeIntro,
  portal: portalIntro,
  slash: slashIntro,
  dawn: dawnIntro,
  drain: drainIntro,
};

/** Les noms reconnus par le moteur, pour valider les scènes avant publication. */
export const EFFECT_TYPES = Object.keys(EFFECTS);
export const INTRO_TYPES = Object.keys(INTROS);

/* ---------- Lecteur ---------- */

function mount(canvas, level, scene, images) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
  const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const layers = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const clipPaths = new Map();
  for (const layer of scene.layers) {
    if (!layer.clip) continue;
    const path = new Path2D();
    layer.clip.polygon.forEach(([px, py], index) =>
      index ? path.lineTo(px, py) : path.moveTo(px, py),
    );
    path.closePath();
    clipPaths.set(layer.id, path);
  }
  const runtime = {
    canvas,
    layers,
    clipPath: (id) => clipPaths.get(id),
    /** Le repère d'un calque ; `rest` l'applique sans accent ni signal (au repos). */
    apply: (ctx, id, state, rest = false) =>
      applyLayer(ctx, layers, layers.get(id), rest ? { ...state, animated: false } : state),
  };
  const intro = scene.intro ? INTROS[scene.intro.type](scene, images, runtime) : null;
  const direction = scene.mirror ? -1 : 1;
  const before = new Map();
  const attached = new Map();
  const front = [];
  for (const fx of scene.effects ?? []) {
    if (fx.before) before.set(fx.before, [...(before.get(fx.before) ?? []), fx]);
    else if (fx.attach) attached.set(fx.attach, [...(attached.get(fx.attach) ?? []), fx]);
    else front.push(fx);
  }
  // Un effet placé avant un groupe se dessine avant le premier calque de ce groupe.
  const firstDrawn = (id) => {
    const children = scene.layers.filter((layer) => layer.file && descends(layer, id));
    return children[0]?.id ?? id;
  };
  const descends = (layer, id) =>
    layer.id === id || (layer.parent ? descends(layers.get(layer.parent), id) : false);
  for (const [id, list] of [...before]) {
    const target = firstDrawn(id);
    if (target !== id) {
      before.delete(id);
      before.set(target, [...(before.get(target) ?? []), ...list]);
    }
  }

  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let elapsed = 0,
    introTime = -1,
    introRequested = false,
    last = performance.now(),
    painted = -Infinity,
    frame;
  const [vx, vy, vw, vh] = scene.view;
  const background = images[scene.background.file];

  const move = ({ clientX, clientY }) => {
    const box = surface.getBoundingClientRect();
    target.x = Math.max(-1, Math.min(1, ((clientX - box.left) * 2) / box.width - 1));
    target.y = Math.max(-1, Math.min(1, ((clientY - box.top) * 2) / box.height - 1));
  };
  const leave = () => {
    target.x = 0;
    target.y = 0;
  };
  const startIntro = () => {
    introTime = 0;
    elapsed = intro.loopStart;
  };
  /** La boucle s'arrête pendant les intros qui le demandent. */
  const loopRuns = () => !(intro?.freezeLoop && introTime >= 0);
  const replay = (event) => {
    elapsed = 0;
    if (intro && level >= 3 && event.detail?.intro && !motion.matches) startIntro();
  };
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerleave', leave);
  canvas.addEventListener('achievers:card-replay', replay);

  const [growX, growY] = scene.background.grow ?? [0, 0];
  const [bgWidth, bgHeight] = scene.background.size ?? [
    background.width + growX,
    background.height + growY,
  ];
  const [offsetX, offsetY] = scene.background.offset ?? [0, 0];
  function drawBackground(shift) {
    const [bx, by] = shift;
    if (scene.background.size || scene.background.grow || scene.background.offset) {
      ctx.drawImage(background, offsetX + bx, offsetY + by, bgWidth, bgHeight);
      return;
    }
    // Les bords du fond s'étirent d'un pixel : la parallaxe ne découvre jamais de vide.
    if (bx > 0)
      ctx.drawImage(background, 0, 0, 1, background.height, 0, by, bx + 1, background.height);
    if (bx < 0) {
      const edge = background.width - 1;
      ctx.drawImage(
        background,
        edge,
        0,
        1,
        background.height,
        edge + bx,
        by,
        1 - bx,
        background.height,
      );
    }
    ctx.drawImage(background, bx, by);
  }

  function draw(now) {
    frame = requestAnimationFrame(draw);
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    const still = motion.matches || level < 2;
    canvas.style.visibility = still ? 'hidden' : '';
    if (still) introTime = -1;
    if (still || document.hidden || canvas.closest('[data-card-suspended]')) return;
    const animated = level >= 3;
    const requested = Boolean(intro) && animated && Boolean(canvas.closest('[data-card-intro]'));
    if (requested && !introRequested) startIntro();
    introRequested = requested;
    const forcedIntro = intro && animated ? canvas.dataset.cardIntroTime : undefined;
    if (forcedIntro !== undefined) {
      introTime = Number(forcedIntro);
      elapsed = intro.freezeLoop ? intro.loopStart : introTime + intro.loopStart;
    } else if (animated && loopRuns()) elapsed += delta;
    if (grid && now - painted < 1000 / 24) return;
    const ratio = Math.min(devicePixelRatio, grid ? 1.3 : 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    painted = now;
    pointer.x += (target.x - pointer.x) * 0.1;
    pointer.y += (target.y - pointer.y) * 0.1;

    const clock = animated ? Number(canvas.dataset.cardTime ?? elapsed) : 0;
    const isolated = canvas.dataset.cardJoint ?? null;
    // En miroir, la parallaxe horizontale suit toujours le pointeur à l'écran.
    const look = { x: pointer.x * direction, y: pointer.y };
    const state = frameState(scene, clock, look, introTime, isolated, animated);
    state.introClear = intro?.clear ?? 0;
    state.runtime = runtime;
    if (introTime >= 0 && intro.signals && !isolated)
      Object.assign(state.signals, intro.signals(introTime));
    const showEffects = animated && !isolated && canvas.dataset.cardEffects !== 'off';

    ctx.setTransform((direction * width) / vw, 0, 0, height / vh, scene.mirror ? width : 0, 0);
    ctx.fillStyle = scene.fill ?? '#000';
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(-vx, -vy);
    const playing = introTime >= 0 && showEffects;
    const shake = playing ? intro.shake(introTime) : 0;
    if (shake) ctx.translate(shake * Math.sin(introTime * 97), shake * Math.cos(introTime * 71));
    // Une intro peut déplacer la scène (un personnage qui remonte d'un liquide).
    const lift = playing && intro.offset ? intro.offset(introTime) : 0;
    ctx.save();
    if (lift) ctx.translate(0, lift);

    drawBackground(backgroundShift(scene, look, clock, animated));
    for (const layer of scene.layers) {
      if (showEffects)
        for (const fx of before.get(layer.id) ?? []) drawEffect(ctx, fx, state, images);
      if (!layer.file) continue;
      ctx.save();
      if (layer.clip) {
        const viewTransform = ctx.getTransform();
        applyLayer(ctx, layers, layers.get(layer.clip.frame), state);
        ctx.clip(clipPaths.get(layer.id));
        ctx.setTransform(viewTransform);
      }
      applyLayer(ctx, layers, layer, state);
      if (layer.sway && animated && !isolated) drawSway(ctx, images[layer.file], layer.sway, state);
      else if (layer.mesh && (animated || isolated)) {
        drawMesh(ctx, images[layer.file], layer.mesh, state, layer);
      } else if (layer.crop) {
        const [cx, cy, cw, ch] = layer.crop;
        ctx.drawImage(images[layer.file], cx, cy, cw, ch, cx, cy, cw, ch);
      } else ctx.drawImage(images[layer.file], ...(layer.origin ?? [0, 0]));
      if (showEffects)
        for (const fx of attached.get(layer.id) ?? []) drawEffect(ctx, fx, state, images);
      ctx.restore();
    }
    if (showEffects) for (const fx of front) drawEffect(ctx, fx, state, images);
    ctx.restore();

    if (playing) intro.draw(ctx, introTime, state);
    if (introTime >= 0 && forcedIntro === undefined) {
      const previous = introTime;
      introTime += delta;
      if (requested && previous < intro.revealAt && introTime >= intro.revealAt) {
        canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
      }
      if (introTime >= intro.end) introTime = -1;
    }
  }

  draw(last);
  return () => {
    cancelAnimationFrame(frame);
    surface.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('achievers:card-replay', replay);
  };
}
