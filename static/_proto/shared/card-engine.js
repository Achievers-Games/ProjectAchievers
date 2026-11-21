/**
 * Moteur des cartes décrites par des données. Une carte fournit `scene.json` et ses images ; son
 * `cards.js` ne fait que charger ce moteur. Tout le reste est déclaré :
 *
 * - `view` : la fenêtre visible, en pixels de la source ; `period` : la durée de la boucle.
 * - `curves` : des accents nommés `[début, sommet, maintien, fin]`, en secondes dans la boucle.
 * - `background` : l'image du fond et sa parallaxe.
 * - `sprites` : des images partagées par les effets et les intros (planches de feuilles, symbole).
 * - `layers` : les calques dans l'ordre de dessin. Un calque sans `file` est un groupe : il porte
 *   un pivot, une parallaxe et des mouvements que ses enfants (`parent`) héritent. Un mouvement est
 *   `{ "curve": nom, "dx", "dy", "angle" }` ou une oscillation `{ "wave": vitesse, ... }`.
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
function frameState(scene, elapsed, pointer, intro, isolated) {
  const period = scene.period ?? 7.6;
  const t = ((elapsed % period) + period) % period;
  const curves = {};
  for (const [name, points] of Object.entries(scene.curves ?? {})) curves[name] = pulse(t, points);
  return { scene, elapsed, t, pointer, intro, isolated, curves };
}

/* ---------- Calques ---------- */

function layerOffset(layer, state) {
  let dx = 0,
    dy = 0,
    angle = 0;
  for (const term of layer.motion ?? []) {
    let amount;
    if (state.isolated) amount = state.isolated === layer.id && term.curve ? 1 : 0;
    else if (term.curve) amount = state.curves[term.curve] ?? 0;
    else amount = Math.sin(state.elapsed * term.wave + (term.phase ?? 0));
    dx += (term.dx ?? 0) * amount;
    dy += (term.dy ?? 0) * amount;
    angle += (term.angle ?? 0) * amount;
  }
  const [px, py] = layer.parallax ?? [0, 0];
  return { dx: dx + px * state.pointer.x, dy: dy + py * state.pointer.y, angle };
}

function applyLayer(ctx, layers, layer, state) {
  if (layer.parent) applyLayer(ctx, layers, layers.get(layer.parent), state);
  const { dx, dy, angle } = layerOffset(layer, state);
  const [cx, cy] = layer.pivot ?? [0, 0];
  ctx.translate(cx + dx, cy + dy);
  ctx.rotate(angle);
  ctx.translate(-cx, -cy);
}

/* ---------- Effets ---------- */

/** La parallaxe du fond, pour les effets peints dans le décor. */
const backgroundShift = (scene, pointer) => {
  const [px, py] = scene.background.parallax ?? [0, 0];
  return [px * pointer.x, py * pointer.y];
};

const EFFECTS = {
  /** Une nappe de lumière douce, qui respire et glisse avec un accent. */
  mist(ctx, fx, state) {
    const [x0, y0] = fx.center;
    const cx = x0 + (fx.drift?.dx ?? 0) * (state.curves[fx.drift?.curve] ?? 0);
    const radius = fx.radius ?? 520;
    const alpha = (fx.alpha ?? 0.12) + (fx.breathe ?? 0.06) * Math.sin(state.elapsed * 0.9);
    const glow = ctx.createRadialGradient(cx, y0, radius * 0.05, cx, y0, radius);
    glow.addColorStop(0, rgba(fx.color, alpha));
    glow.addColorStop(1, rgba(fx.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius * 1.02, y0 - radius * 0.75, radius * 2.04, radius * 1.4);
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

  /** Un reflet qui glisse le long d'une arme pendant un accent. */
  glint(ctx, fx, state) {
    const shine = pulse(state.t, fx.window ?? [1.39, 1.8, 1.96, 2.6]);
    if (!shine) return;
    const [start, end] = fx.travel ?? [1.35, 2.57];
    const progress = ease(start, end, state.t);
    const px = fx.from[0] + (fx.to[0] - fx.from[0]) * progress;
    const py = fx.from[1] + (fx.to[1] - fx.from[1]) * progress;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, 22);
    glow.addColorStop(0, rgba(fx.color ?? [255, 223, 171], shine * 0.8));
    glow.addColorStop(1, rgba(fx.color ?? [255, 185, 140], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(px - 22, py - 22, 44, 44);
  },
};

function drawEffect(ctx, fx, state, images) {
  if (fx.hideDuringIntro && state.intro >= 0 && state.intro < state.introClear) return;
  ctx.save();
  ctx.globalCompositeOperation = fx.blend ?? 'screen';
  if (fx.parallax === 'background') ctx.translate(...backgroundShift(state.scene, state.pointer));
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

const INTROS = { strike: strikeIntro };

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
  const intro = scene.intro ? INTROS[scene.intro.type](scene, images) : null;
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
  const replay = (event) => {
    elapsed = 0;
    if (intro && level >= 3 && event.detail?.intro && !motion.matches) startIntro();
  };
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerleave', leave);
  canvas.addEventListener('achievers:card-replay', replay);

  function drawBackground(shift) {
    const [bx, by] = shift;
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
      elapsed = introTime + intro.loopStart;
    } else if (animated) elapsed += delta;
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
    const state = frameState(scene, clock, pointer, introTime, isolated);
    state.introClear = intro?.clear ?? 0;
    const showEffects = animated && !isolated && canvas.dataset.cardEffects !== 'off';

    ctx.setTransform(width / vw, 0, 0, height / vh, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(-vx, -vy);
    const playing = introTime >= 0 && showEffects;
    const shake = playing ? intro.shake(introTime) : 0;
    if (shake) ctx.translate(shake * Math.sin(introTime * 97), shake * Math.cos(introTime * 71));

    drawBackground(backgroundShift(scene, pointer));
    for (const layer of scene.layers) {
      if (showEffects)
        for (const fx of before.get(layer.id) ?? []) drawEffect(ctx, fx, state, images);
      if (!layer.file) continue;
      ctx.save();
      applyLayer(ctx, layers, layer, state);
      ctx.drawImage(images[layer.file], ...(layer.origin ?? [0, 0]));
      if (showEffects)
        for (const fx of attached.get(layer.id) ?? []) drawEffect(ctx, fx, state, images);
      ctx.restore();
    }
    if (showEffects) for (const fx of front) drawEffect(ctx, fx, state, images);

    if (playing) intro.draw(ctx, introTime);
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
