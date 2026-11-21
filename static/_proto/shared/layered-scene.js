/** Lit les calques, leurs attaches et la pose d'accent exportés par la préparation. */
export async function loadLayeredScene(folder) {
  const response = await fetch(new URL('scene.json', folder));
  if (!response.ok) throw new Error('Données de scène indisponibles');
  const scene = await response.json();
  const image = async (file) => {
    const node = new Image();
    node.src = new URL(file, folder);
    await node.decode();
    return node;
  };
  const [background, ...textures] = await Promise.all([
    image(scene.background),
    ...scene.layers.map((part) => image(part.file)),
  ]);
  const parts = new Map(scene.layers.map((part, i) => [part.id, { ...part, image: textures[i] }]));
  return (canvas, level) => mount(canvas, level, scene, background, parts);
}

const ease = (lo, hi, value) => {
  const u = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
};

function mount(canvas, level, scene, background, parts) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
  const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const direction = scene.mirror ? -1 : 1;
  const { aperture, driver } = scene.effect;
  // « optic » : l'iris s'allume seul dans le noir. « portal » : deux portails s'ouvrent et le
  // bleu, ouvert sur la scène, s'agrandit jusqu'à la remplir.
  const introKind = scene.effect.intro ?? null;
  const introTiming =
    introKind === 'portal' ? { reveal: 4.05, end: 4.6 } : { reveal: 2.92, end: 3.28 };
  const aperturePath = aperture ? new Path2D() : null;
  if (aperturePath) {
    aperturePath.moveTo(...aperture[0]);
    for (const point of aperture.slice(1)) aperturePath.lineTo(...point);
    aperturePath.closePath();
  }
  let x = 0,
    y = 0,
    aimX = 0,
    aimY = 0,
    elapsed = 0,
    last = performance.now(),
    painted = -Infinity;
  let frame;
  let intro = -1;
  let introRequested = false;

  function move({ clientX, clientY }) {
    const box = surface.getBoundingClientRect();
    aimX = Math.max(-1, Math.min(1, ((clientX - box.left) * 2) / box.width - 1));
    aimY = Math.max(-1, Math.min(1, ((clientY - box.top) * 2) / box.height - 1));
  }
  const leave = () => {
    aimX = 0;
    aimY = 0;
  };
  const replay = (event) => {
    elapsed = 0;
    if (introKind && level >= 3 && event.detail?.intro && !motion.matches) intro = 0;
  };
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerleave', leave);
  canvas.addEventListener('achievers:card-replay', replay);

  function apply(part, accent, isolated, scan) {
    if (part.parent) apply(parts.get(part.parent), accent, isolated, scan);
    else ctx.translate((part.depth - 0.26) * 39 * x * direction, (part.depth - 0.26) * 20 * y);
    const value = !isolated || part.id === isolated ? accent : 0;
    const [px, py] = part.pivot;
    const [dx, dy, angle] = part.peak;
    const [lookX, lookY] = scan && part.id === driver ? scan : [value, value];
    ctx.translate(px + dx * lookX, py + dy * lookY);
    ctx.rotate(angle * lookX);
    ctx.translate(-px, -py);
  }

  function effects(time, accent, foreground, scan, glare) {
    const {
      center: [cx, cy],
      color,
      intensity,
      motif,
      parent,
    } = scene.effect;
    const [r, g, b] = color;
    const tint = (alpha) => `rgba(${r},${g},${b},${alpha})`;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (!foreground && motif === 'scan') {
      const halo = ctx.createRadialGradient(cx, cy, 25, cx, cy, 705);
      halo.addColorStop(0, tint(intensity * (0.5 + accent * 0.24)));
      halo.addColorStop(0.52, tint(0.16));
      halo.addColorStop(1, tint(0));
      ctx.fillStyle = halo;
      ctx.fillRect(cx - 705, cy - 705, 1410, 1410);
    }
    if (foreground && motif === 'scan') {
      apply(parts.get(parent), accent, null, scan);
      const beam = ctx.createRadialGradient(cx, cy, 32, cx, cy, 690);
      beam.addColorStop(0, `rgba(216, 245, 255, ${0.08 + 0.44 * glare})`);
      beam.addColorStop(0.27, tint(0.035 + 0.59 * glare));
      beam.addColorStop(0.63, tint(0.22 * glare));
      beam.addColorStop(1, tint(0));
      ctx.fillStyle = beam;
      ctx.fillRect(cx - 690, cy - 690, 1380, 1380);
      const glow = ctx.createRadialGradient(cx, cy, 12, cx, cy, 193);
      glow.addColorStop(0, `rgba(220, 247, 255, ${0.18 + 0.5 * glare})`);
      glow.addColorStop(0.55, tint(intensity * (0.3 + 0.3 * glare + 0.05 * Math.sin(time * 2))));
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
          const angle = time * (ring % 2 ? -0.7 : 0.47) + (arc * Math.PI * 2) / 3 + ring;
          ctx.beginPath();
          ctx.ellipse(cx, cy, radius, radius * 0.82, -0.23, angle, angle + 0.64 - ring * 0.12);
          ctx.stroke();
        }
      }
    }
    if (!foreground || motif !== 'scan') {
      for (let i = 0; i < (foreground ? 12 : 27); i++) {
        const index = i + (foreground ? 31 : 0);
        const age = (time * scene.effect.speed * (0.067 + (index % 5) * 0.014) + index * 0.618) % 1;
        const px = cx + ((index * 183) % 1040) - 520 + Math.sin(age * 5 + index) * 28;
        const py = cy + 490 - age * 870;
        ctx.fillStyle = tint(Math.sin(age * Math.PI) ** 2 * (0.35 + (index % 3) * 0.17));
        ctx.beginPath();
        ctx.arc(px, py, (foreground ? 2 : 1) + (index % 4) * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function revealOptic(time, scan) {
    const [left, top, width, height] = scene.crop;
    const reveal = ease(2.62, 2.92, time);
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - reveal})`;
    ctx.fillRect(left, top, width, height);

    const iris = parts.get(scene.effect.parent);
    const [cx, cy] = scene.effect.center;
    const blink = ease(1.24, 1.33, time) * (1 - ease(1.37, 1.51, time));
    const flicker = ease(0.52, 0.61, time) * (1 - ease(0.65, 0.8, time));
    const power =
      ease(0.28, 0.92, time) *
      (0.72 + 0.23 * Math.sin(time * 5.2)) *
      (1 - 0.78 * blink) *
      (1 - 0.37 * flicker);
    const flare = ease(2.57, 2.73, time) * (1 - ease(2.73, 3.28, time));
    ctx.save();
    apply(iris, 0, null, scan);
    ctx.save();
    if (blink > 0) {
      const shutter = 141 * (1 - 0.91 * blink);
      ctx.beginPath();
      ctx.rect(cx - 145, cy - shutter, 290, shutter * 2);
      ctx.clip();
    }
    ctx.globalAlpha = power * (1 - reveal) * 0.82;
    ctx.drawImage(iris.image, ...iris.origin);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    const radius = 112 + 560 * flare;
    const light = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius);
    light.addColorStop(0, `rgba(201, 233, 255, ${0.42 * power * (1 - reveal) + 0.68 * flare})`);
    light.addColorStop(0.25, `rgba(39, 139, 255, ${0.27 * power * (1 - reveal) + 0.46 * flare})`);
    light.addColorStop(1, 'transparent');
    ctx.fillStyle = light;
    ctx.fillRect(cx - radius, cy - radius, 2 * radius, 2 * radius);
    ctx.restore();
  }

  const PORTAL_ORANGE = [345, 560];
  const portalView = document.createElement('canvas');
  portalView.width = 215;
  portalView.height = 340;
  const PORTAL_BLUE = [1006, 520];
  const BLUE = [64, 160, 255];
  const ORANGE = [255, 138, 30];

  /** Ouverture avec dépassement, comme un portail qui se pose sur une paroi. */
  function opening(time, start) {
    const u = Math.max(0, Math.min(1, (time - start) / 0.34));
    if (!u) return 0;
    const v = u - 1;
    return 1 + 2.9 * v ** 3 + 1.9 * v ** 2;
  }

  function portalPath(cx, cy, rx, ry, time, phase) {
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
  }

  /** Bord lumineux du portail et particules qui tournent sur son contour. */
  function portalRim(path, [r, g, b], cx, cy, rx, ry, time, alpha, phase) {
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
      const seed = (i * 0.618033989 + phase) % 1;
      const a = seed * Math.PI * 2 + time * (0.7 + seed * 0.9) * (i % 2 ? 1 : -1);
      const out = (time * (0.8 + seed) + seed * 3) % 1;
      const spread = 1 + 0.03 + out * (0.12 + 0.1 * seed);
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

  /** Allumage de Wheatley : une ampoule qui hésite avant de tenir. */
  function bootPower(time) {
    let power = 0.04;
    for (const [at, value] of [
      [1.75, 1],
      [1.83, 0.12],
      [1.9, 0.85],
      [1.96, 0.2],
      [2.06, 1],
    ]) {
      if (time >= at) power = value;
    }
    return power;
  }

  function revealPortal(time, scan) {
    const [left, top, width, height] = scene.crop;
    const expand = ease(3.55, 4.2, time);
    const done = ease(4.0, 4.3, time);

    // Portail bleu, ouvert sur Wheatley, qui finit par remplir la carte.
    const blueOpen = opening(time, 1.3);
    const grow = 1 + 7.5 * expand ** 2;
    const [bx, by] = PORTAL_BLUE;
    const brx = 215 * blueOpen * grow;
    const bry = 340 * blueOpen * grow;
    const blue = blueOpen > 0 ? portalPath(bx, by, brx, bry, time, 0) : null;
    if (blue) {
      ctx.save();
      ctx.clip(blue);
      const power = bootPower(time);
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.35 + 0.35 * (1 - power)) * (1 - expand)})`;
      ctx.fillRect(left, top, width, height);
      if (aperturePath && power < 1) {
        ctx.save();
        apply(parts.get(parts.get(driver).parent), 0, null, scan);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.9 * (1 - power)})`;
        ctx.fill(aperturePath);
        ctx.restore();
      }
      ctx.restore();
    }
    // Les portails sont reliés : l'orange montre ce que voit le bleu.
    const orangeOpen = opening(time, 0.4) * (1 - ease(3.45, 3.75, time));
    if (orangeOpen > 0 && blue) {
      const m = ctx.getTransform();
      const sx = bx - 215,
        sy = by - 340;
      portalView
        .getContext('2d')
        .drawImage(
          canvas,
          m.a * sx + m.e,
          m.d * sy + m.f,
          m.a * 430,
          m.d * 680,
          0,
          0,
          portalView.width,
          portalView.height,
        );
    }
    const mask = new Path2D();
    mask.rect(left - 80, top - 80, width + 160, height + 160);
    if (blue) mask.addPath(blue);
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - done})`;
    ctx.fill(mask, 'evenodd');

    // Portail orange, tiré en premier, qui se referme quand le bleu s'ouvre sur tout.
    if (orangeOpen > 0) {
      const [ox, oy] = PORTAL_ORANGE;
      const orx = 150 * orangeOpen;
      const ory = 245 * orangeOpen;
      const orange = portalPath(ox, oy, orx, ory, time, 2.1);
      ctx.save();
      ctx.clip(orange);
      ctx.fillStyle = '#000';
      ctx.fillRect(ox - orx * 1.2, oy - ory * 1.2, orx * 2.4, ory * 2.4);
      if (blue) {
        // Même échelle que le bleu : on voit Wheatley de l'autre côté, un peu plus sombre.
        ctx.globalAlpha = 0.85;
        ctx.drawImage(
          portalView,
          ox - 215 * orangeOpen,
          oy - 340 * orangeOpen,
          430 * orangeOpen,
          680 * orangeOpen,
        );
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      portalRim(orange, ORANGE, ox, oy, orx, ory, time, Math.min(1, orangeOpen * 1.5), 0.37);
    }
    if (blue) {
      portalRim(
        blue,
        BLUE,
        bx,
        by,
        brx,
        bry,
        time,
        Math.min(1, blueOpen * 1.5) * (1 - ease(3.85, 4.2, time)),
        0,
      );
    }

    // Éclat d'ouverture de chaque portail.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const [[px, py], color, start] of [
      [PORTAL_ORANGE, ORANGE, 0.4],
      [PORTAL_BLUE, BLUE, 1.3],
    ]) {
      const pop = ease(start, start + 0.05, time) * (1 - ease(start + 0.05, start + 0.45, time));
      if (!pop) continue;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, 420);
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.8 * pop})`);
      glow.addColorStop(0.2, `rgba(${color.join(', ')}, ${0.6 * pop})`);
      glow.addColorStop(1, `rgba(${color.join(', ')}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(px - 420, py - 420, 840, 840);
    }
    ctx.restore();
  }

  function draw(now) {
    frame = requestAnimationFrame(draw);
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    const still = motion.matches || level < 2;
    canvas.style.visibility = still ? 'hidden' : '';
    if (still) intro = -1;
    if (still || document.hidden || canvas.closest('[data-card-suspended]')) return;
    const animated = level >= 3;
    const requested =
      Boolean(introKind) && animated && Boolean(canvas.closest('[data-card-intro]'));
    if (requested && !introRequested) intro = elapsed = 0;
    introRequested = requested;
    // data-card-intro-time fige l'intro à un instant donné pour la vérifier image par image.
    const forcedIntro = introKind && animated ? canvas.dataset.cardIntroTime : undefined;
    if (forcedIntro !== undefined) intro = Number(forcedIntro);
    if (animated && intro < 0) elapsed += delta;
    if (grid && now - painted < 1000 / 24) return;
    const ratio = Math.min(devicePixelRatio, grid ? 1.35 : 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    painted = now;
    x += (aimX - x) * 0.12;
    y += (aimY - y) * 0.12;
    const time = animated ? Number(canvas.dataset.cardTime ?? elapsed) : 0;
    const cycle = time % 6.7;
    const isolated = canvas.dataset.cardJoint;
    const accent = isolated ? 1 : ease(0.45, 1.45, cycle) * (1 - ease(1.76, 3.32, cycle));
    const first = ease(0.35, 0.55, cycle);
    const second = ease(1.24, 1.54, cycle);
    const third = ease(2.43, 2.68, cycle);
    const reset = ease(3.69, 3.93, cycle);
    const scanInLoop =
      animated && !isolated && driver
        ? [
            -first + 1.94 * second - 1.58 * third + 0.64 * reset,
            0.28 * first - 0.64 * second + 1.09 * third - 0.73 * reset,
          ]
        : null;
    const playingIntro = intro >= 0 && !isolated && canvas.dataset.cardEffects !== 'off';
    const lookAside = ease(0.79, 1.09, intro) * (1 - ease(1.49, 1.76, intro));
    const lookBack = ease(1.49, 1.76, intro) * (1 - ease(2.03, 2.33, intro));
    // Portail : regards paniqués, gauche, droite, gauche, puis retour face au joueur.
    const darts = [
      ease(2.4, 2.48, intro),
      ease(2.75, 2.82, intro),
      ease(3.05, 3.12, intro),
      ease(3.3, 3.5, intro),
    ];
    const scan = !playingIntro
      ? scanInLoop
      : introKind === 'portal'
        ? [
            -1.25 * darts[0] + 2.55 * darts[1] - 2.1 * darts[2] + 0.8 * darts[3],
            0.4 * darts[0] - 0.7 * darts[1] + 0.8 * darts[2] - 0.5 * darts[3],
          ]
        : [-1.22 * lookAside + 0.93 * lookBack, 0.47 * lookAside - 0.62 * lookBack];
    const flash = (start, peak, end) => ease(start, peak, cycle) * (1 - ease(peak, end, cycle));
    const glare = flash(1.28, 1.4, 1.68) + flash(2.47, 2.55, 2.79) + flash(3.79, 3.93, 4.23);
    const showEffects = animated && !isolated && canvas.dataset.cardEffects !== 'off';
    const [left, top, windowWidth, windowHeight] = scene.crop;
    ctx.setTransform(
      (direction * width) / windowWidth,
      0,
      0,
      height / windowHeight,
      scene.mirror ? width : 0,
      0,
    );
    ctx.translate(-left, -top);
    // Marge en bordure, identique au repos pour le poster et le rendu.
    ctx.fillStyle = '#141a21';
    ctx.fillRect(left, top, windowWidth, windowHeight);
    ctx.drawImage(background, -7 * x * direction, -4 * y, background.width, background.height);
    if (showEffects) effects(time, accent, false, scan, glare);
    for (const part of parts.values()) {
      ctx.save();
      if (aperturePath && (part.id === driver || part.parent === driver)) {
        const view = ctx.getTransform();
        apply(parts.get(parts.get(driver).parent), accent, isolated, scan);
        ctx.clip(aperturePath);
        ctx.setTransform(view);
      }
      apply(part, accent, isolated, scan);
      ctx.drawImage(part.image, ...part.origin);
      ctx.restore();
    }
    if (showEffects) effects(time, accent, true, scan, glare);
    if (playingIntro) {
      if (introKind === 'portal') revealPortal(intro, scan);
      else revealOptic(intro, scan);
    }
    if (intro >= 0 && forcedIntro === undefined) {
      const previous = intro;
      intro += delta;
      if (requested && previous < introTiming.reveal && intro >= introTiming.reveal) {
        canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
      }
      if (intro >= introTiming.end) intro = -1;
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
