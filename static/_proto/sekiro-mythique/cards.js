(() => {
  const assets = new URL('.', document.currentScript.src);
  let loading;
  async function load(file) {
    const image = new Image();
    image.src = new URL(file, assets);
    await image.decode();
    return image;
  }
  const ease = (a, b, t) => {
    const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  };
  const pulse = (t, a, b, c, d) => ease(a, b, t) * (1 - ease(c, d, t));
  const seed = (index) => (index * 0.618033989) % 1;
  // Temps de l'intro en secondes. La boucle tourne dès 0 : le saut du Loup et la montée de la
  // hache se font dans le noir, et le choc coïncide avec la gerbe d'étincelles de la boucle.
  // Le 危 reste seul dans le noir assez longtemps pour être reconnu avant la poussée.
  const KANJI_IN = 0.35;
  const THRUST_START = 2.05;
  const THRUST_END = 2.62;
  const CLASH = 2.75;
  const REVEAL_END = 3.95;
  const introDuration = 3.7;
  const introEnd = 6.2;
  // Décalage de la boucle : son pic d'étincelles (1,55 s) tombe sur le choc de l'intro.
  const LOOP_AT_CLASH = 1.55;
  const loopStart = LOOP_AT_CLASH - CLASH;

  (window.AchieversCards ??= {})['sekiro-mythique'] = {
    async mount(canvas, level = 3) {
      const files = [
        'bg',
        'wolf',
        'monk',
        'shaft',
        'flap',
        'sleeve',
        'wolf-head',
        'wolf-axe',
        'wolf-katana',
        'wolf-bent-leg',
        'wolf-extended-leg',
        'monk-head',
        'monk-grips',
        'monk-robe',
        'maple-leaves',
        'kanji-danger',
      ];
      const layers = await (loading ??= Promise.all(
        files.map(async (name) => [name, await load(`${name}.${name === 'bg' ? 'jpg' : 'png'}`)]),
      ).then(Object.fromEntries));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas 2D indisponible');
      const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
      const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      let x = 0,
        y = 0,
        targetX = 0,
        targetY = 0;
      let elapsed = 0,
        frame;
      let intro = -1;
      let introRequested = false;
      let sparkTime = 0;
      let last = performance.now(),
        drawn = -Infinity;
      const move = ({ clientX, clientY }) => {
        const bounds = surface.getBoundingClientRect();
        targetX = Math.max(-1, Math.min(1, (2 * (clientX - bounds.left)) / bounds.width - 1));
        targetY = Math.max(-1, Math.min(1, (2 * (clientY - bounds.top)) / bounds.height - 1));
      };
      const leave = () => {
        targetX = 0;
        targetY = 0;
      };
      const replay = (event) => {
        elapsed = 0;
        sparkTime = 0;
        if (level >= 3 && event.detail?.intro && !motion.matches) {
          intro = 0;
          elapsed = sparkTime = loopStart;
        }
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerleave', leave);
      canvas.addEventListener('achievers:card-replay', replay);

      function turn(cx, cy, tx, ty, angle) {
        context.translate(cx + tx, cy + ty);
        context.rotate(angle);
        context.translate(-cx, -cy);
      }

      function part(name, pivotX, pivotY, angle, dx = 0, dy = 0) {
        context.save();
        turn(pivotX, pivotY, dx, dy, angle);
        context.drawImage(layers[name], 0, 0);
        context.restore();
      }

      function leaves(count, depth, gust) {
        for (let i = 0; i < count; i++) {
          const index = i + depth * 29;
          const age = (elapsed * (0.085 + seed(index) * 0.07) + seed(index + 18)) % 1;
          const baseY = 90 + seed(index + 7) * 735;
          const px = -90 + age * 2180 + gust * (24 + 16 * depth) + depth * x * 18;
          const py =
            baseY + age * 125 + Math.sin(age * 9 + index) * (12 + 5 * depth) + depth * y * 11;
          const size = (13 + depth * 22) * (0.65 + seed(index + 12));
          const sprite = (i + Math.floor(depth * 4)) % 4;
          context.save();
          context.translate(px, py);
          context.rotate(age * 7 + index);
          context.scale(1, 0.32 + 0.68 * Math.abs(Math.cos(elapsed * 1.4 + index)));
          context.globalAlpha = Math.sin(Math.PI * age) ** 2 * (0.64 + depth * 0.16);
          context.drawImage(
            layers['maple-leaves'],
            sprite * 128,
            0,
            128,
            128,
            -size / 2,
            -size / 2,
            size,
            size,
          );
          context.restore();
        }
      }

      // Intro « 危 » : l'avertissement d'attaque imparable du jeu s'allume au-dessus du moine,
      // la poussée de la lance traverse le noir, puis le coup de hache du Loup éclate en
      // étincelles et la lumière du choc dévoile la scène depuis le point d'impact.
      const shade = document.createElement('canvas');
      // Marge noire de 10 px autour de la vue : le lissage et la secousse ne montrent jamais un bord clair.
      shade.width = 660;
      shade.height = 319;
      const shadeContext = shade.getContext('2d');
      const kanji = { x: 1290, y: 250 };
      const thrustFrom = { x: 1455, y: 384 };
      const thrustTo = { x: 185, y: 658 };
      const clash = { x: 456, y: 460 };
      const thrustAt = (time) => {
        const u = Math.max(0, Math.min(1, (time - THRUST_START) / (THRUST_END - THRUST_START)));
        const k = u ** 1.7;
        return {
          u,
          x: thrustFrom.x + (thrustTo.x - thrustFrom.x) * k,
          y: thrustFrom.y + (thrustTo.y - thrustFrom.y) * k,
        };
      };
      const edgeRadius = (angle) =>
        1 +
        0.09 * Math.sin(5 * angle + 1.3) +
        0.05 * Math.sin(11 * angle + 0.4) +
        0.025 * Math.sin(23 * angle + 2.1);
      const revealRadius = (time) => 1750 * ease(CLASH, REVEAL_END, time) ** 0.8;

      function lightHole(px, py, radius, alpha) {
        const sx = px / 3 + 10,
          sy = (py - 46) / 3 + 10,
          sr = radius / 3;
        const hole = shadeContext.createRadialGradient(sx, sy, 0, sx, sy, sr);
        hole.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
        hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
        shadeContext.fillStyle = hole;
        shadeContext.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }

      function revealShape(target, scale, radius, offset) {
        target.beginPath();
        for (let step = 0; step <= 72; step++) {
          const angle = (step / 72) * Math.PI * 2;
          const r = radius * edgeRadius(angle) - offset;
          const shift = scale === 1 ? 0 : 10;
          const px = (clash.x + Math.cos(angle) * r) * scale + shift;
          const py = (clash.y + Math.sin(angle) * r - (scale === 1 ? 0 : 46)) * scale + shift;
          if (step) target.lineTo(px, py);
          else target.moveTo(px, py);
        }
        target.closePath();
      }

      function introShade(time) {
        if (time >= REVEAL_END + 0.1) return;
        shadeContext.globalCompositeOperation = 'source-over';
        shadeContext.clearRect(0, 0, 660, 319);
        shadeContext.fillStyle = '#000';
        shadeContext.fillRect(0, 0, 660, 319);
        shadeContext.globalCompositeOperation = 'destination-out';
        // Le 危 rougeoie à peine sur le moine.
        const warn = pulse(time, KANJI_IN, KANJI_IN + 0.3, CLASH, CLASH + 0.12);
        lightHole(kanji.x, kanji.y + 140, 420, 0.22 * warn);
        // La pointe de la lance éclaire son propre trajet.
        if (time > THRUST_START && time < CLASH + 0.4) {
          const head = thrustAt(time);
          const linger = 1 - ease(CLASH, CLASH + 0.4, time);
          for (let k = 0; k < 10; k++) {
            const back = thrustAt(time - k * 0.025);
            lightHole(back.x, back.y, 95 - k * 4, 0.6 * (1 - k / 10) * linger);
          }
          const steps = Math.floor(head.u * 22);
          for (let k = 0; k <= steps; k++) {
            const s = k / 22;
            lightHole(
              thrustFrom.x + (thrustTo.x - thrustFrom.x) * s,
              thrustFrom.y + (thrustTo.y - thrustFrom.y) * s,
              70,
              0.38 * linger,
            );
          }
        }
        // L'impact de la hache ouvre la scène avec un bord irrégulier.
        if (time >= CLASH) {
          lightHole(clash.x, clash.y, 320, 1 - ease(CLASH + 0.1, CLASH + 0.5, time) * 0.3);
          const radius = revealRadius(time);
          for (let k = 6; k >= 0; k--) {
            shadeContext.fillStyle = `rgba(0, 0, 0, ${k ? 0.2 : 1})`;
            revealShape(shadeContext, 1 / 3, radius, k * 18 + 30);
            shadeContext.fill();
          }
        }
        context.drawImage(shade, -30, 16, 1980, 957);
      }

      function introLights(time, _scale) {
        context.save();
        // Bord du dévoilement : un front de braises qui s'éteint en s'éloignant.
        if (time >= CLASH && time < REVEAL_END) {
          const radius = revealRadius(time);
          const fade = 1 - ease(CLASH + 0.25, REVEAL_END, time);
          context.globalCompositeOperation = 'screen';
          revealShape(context, 1, radius, 34);
          context.strokeStyle = `rgba(255, 120, 34, ${0.55 * fade})`;
          context.lineWidth = 22;
          context.stroke();
          context.strokeStyle = `rgba(255, 214, 140, ${0.5 * fade})`;
          context.lineWidth = 5;
          context.stroke();
        }

        // Kanji 危.
        const appear = ease(KANJI_IN, KANJI_IN + 0.22, time);
        const vanish = ease(CLASH, CLASH + 0.14, time);
        const alpha = appear * (1 - vanish);
        if (alpha > 0) {
          const beat = 0.5 + 0.5 * Math.cos((time - KANJI_IN - 0.22) * 4.2);
          const grow = 1.35 - 0.35 * appear + 0.25 * vanish;
          context.globalCompositeOperation = 'screen';
          const halo = context.createRadialGradient(kanji.x, kanji.y, 10, kanji.x, kanji.y, 260);
          halo.addColorStop(0, `rgba(255, 40, 70, ${alpha * (0.4 + 0.2 * beat)})`);
          halo.addColorStop(1, 'rgba(170, 0, 30, 0)');
          context.fillStyle = halo;
          context.fillRect(kanji.x - 260, kanji.y - 260, 520, 520);
          // Le cœur rose pâle est détouré d'une capture du jeu (prepare-kanji.mjs). Les lueurs
          // rouges ne dessinent que l'ombre du kanji, déplacé hors champ : le dégradé reste continu.
          context.translate(kanji.x, kanji.y);
          context.scale(grow, grow);
          context.globalAlpha = alpha;
          const unit = context.getTransform().a;
          const glyph = layers['kanji-danger'];
          const size = 300;
          const draw = () =>
            context.drawImage(
              glyph,
              -size / 2,
              -size / 2,
              size,
              (size * glyph.height) / glyph.width,
            );
          for (const [color, blur, glowOnly] of [
            ['rgba(225, 18, 48, 1)', 70 + 24 * beat, true],
            ['rgba(255, 46, 70, 1)', 26, true],
            ['rgba(255, 70, 92, 1)', 10, true],
            ['rgba(255, 120, 136, 0.9)', 4, false],
          ]) {
            context.save();
            if (glowOnly) context.translate(10000, 0);
            context.shadowColor = color;
            context.shadowOffsetX = glowOnly ? -10000 * unit : 0;
            context.shadowBlur = blur * unit;
            draw();
            context.restore();
          }
        }
        context.restore();
        context.save();

        // Poussée : un éclat file le long de la hampe vers la pointe.
        if (time > THRUST_START && time < CLASH + 0.08) {
          const head = thrustAt(time);
          const tail = thrustAt(time - 0.09);
          const fade = 1 - ease(THRUST_END, CLASH + 0.08, time);
          context.globalCompositeOperation = 'screen';
          context.lineCap = 'round';
          const streak = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
          streak.addColorStop(0, 'rgba(255, 190, 140, 0)');
          streak.addColorStop(1, `rgba(255, 244, 222, ${0.95 * fade})`);
          context.strokeStyle = streak;
          context.lineWidth = 7;
          context.beginPath();
          context.moveTo(tail.x, tail.y);
          context.lineTo(head.x, head.y);
          context.stroke();
          const bloom = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, 110);
          bloom.addColorStop(0, `rgba(255, 246, 228, ${fade})`);
          bloom.addColorStop(0.2, `rgba(255, 214, 170, ${0.6 * fade})`);
          bloom.addColorStop(1, 'rgba(255, 170, 110, 0)');
          context.fillStyle = bloom;
          context.fillRect(head.x - 110, head.y - 110, 220, 220);
        }

        // Impact : étoile de parade et gerbe d'étincelles.
        const strike = pulse(time, CLASH - 0.03, CLASH + 0.02, CLASH + 0.08, CLASH + 0.55);
        if (strike > 0) {
          context.globalCompositeOperation = 'screen';
          const flash = context.createRadialGradient(clash.x, clash.y, 0, clash.x, clash.y, 300);
          flash.addColorStop(0, `rgba(255, 250, 230, ${strike})`);
          flash.addColorStop(0.25, `rgba(255, 170, 70, ${strike * 0.7})`);
          flash.addColorStop(1, 'rgba(255, 90, 20, 0)');
          context.fillStyle = flash;
          context.fillRect(clash.x - 300, clash.y - 300, 600, 600);
          context.fillStyle = `rgba(255, 248, 225, ${strike})`;
          for (const [angle, length] of [
            [-0.35, 360],
            [-0.35 + Math.PI, 360],
            [1.22, 210],
            [1.22 + Math.PI, 210],
          ]) {
            context.save();
            context.translate(clash.x, clash.y);
            context.rotate(angle);
            context.beginPath();
            context.moveTo(0, -7 * strike);
            context.lineTo(length * (0.6 + 0.4 * strike), 0);
            context.lineTo(0, 7 * strike);
            context.closePath();
            context.fill();
            context.restore();
          }
        }
        if (time >= CLASH) {
          context.globalCompositeOperation = 'screen';
          context.lineCap = 'round';
          const age = time - CLASH;
          for (let i = 0; i < 70; i++) {
            const life = 0.35 + seed(i + 5) * 0.55;
            const a = age / life;
            if (a >= 1) continue;
            const angle = -Math.PI * (0.05 + seed(i + 31) * 1.1) + (seed(i + 9) - 0.5) * 0.5;
            const speed = 500 + seed(i + 17) * 900;
            const travel = (speed * (1 - Math.exp(-3.2 * age))) / 3.2;
            const px = clash.x + Math.cos(angle) * travel;
            const py = clash.y + Math.sin(angle) * travel + 520 * age * age;
            const vx = Math.cos(angle) * speed * Math.exp(-3.2 * age);
            const vy = Math.sin(angle) * speed * Math.exp(-3.2 * age) + 1040 * age;
            const hot = 1 - a;
            context.strokeStyle = `rgba(255, ${150 + 90 * hot}, ${60 + 120 * hot}, ${hot})`;
            context.lineWidth = 1.5 + 3 * seed(i + 3) * hot;
            context.beginPath();
            context.moveTo(px - vx * 0.03, py - vy * 0.03);
            context.lineTo(px, py);
            context.stroke();
          }
        }
        context.restore();

        // Les érables soufflés par le choc ralentissent et rejoignent la boucle.
        if (time >= CLASH) {
          const age = time - CLASH;
          for (let i = 0; i < 120; i++) {
            const life = 1.7 + seed(i + 40) * 1.4;
            const a = age / life;
            if (a >= 1) continue;
            const angle = (seed(i * 7 + 3) - 0.5) * Math.PI * 1.7;
            const speed = 700 + seed(i + 13) * 1500;
            const travel = (speed * (1 - Math.exp(-2.6 * age))) / 2.6;
            const depth = seed(i + 77);
            const size = (24 + 70 * depth ** 1.5) * (0.7 + 0.3 * (1 - a));
            const px = clash.x + Math.cos(angle) * travel + 160 * age;
            const py =
              clash.y +
              Math.sin(angle) * travel * 0.75 +
              60 * age * age +
              18 * Math.sin(age * 6 + i);
            context.save();
            context.translate(px, py);
            context.rotate(i + age * (3 + 6 * depth) * Math.exp(-age));
            context.scale(1, 0.4 + 0.6 * Math.abs(Math.cos(i + age * 4)));
            context.globalAlpha = Math.min(1, age * 12) * (1 - a) ** 1.5 * (0.6 + 0.4 * depth);
            context.drawImage(
              layers['maple-leaves'],
              (i % 4) * 128,
              0,
              128,
              128,
              -size / 2,
              -size / 2,
              size,
              size,
            );
            context.restore();
          }
        }
      }

      function axeSparks(burst, time) {
        context.save();
        context.globalCompositeOperation = 'screen';
        context.lineCap = 'round';
        for (let i = 0; i < 48; i++) {
          const streak = i % 4 === 0;
          const age =
            (time * (streak ? 0.44 + seed(i) * 0.21 : 0.65 + seed(i) * 0.66) + seed(i + 2)) % 1;
          const fall = age * (0.45 + age * 0.55);
          const range = streak ? 275 + seed(i + 25) * 178 : 35 + seed(i + 25) * 153;
          const px =
            417 +
            seed(i + 42) * 46 +
            (seed(i + 11) - 0.56) * 148 * age +
            (streak ? 155 : 53) * fall;
          const py = 458 + range * fall;
          const hot = ease(0, 0.06, age) * (1 - ease(streak ? 0.61 : 0.32, 1, age));
          const trail = streak
            ? (18 + seed(i + 8) * 37) * (0.55 + age * 0.63)
            : 2 + seed(i + 8) * 5;
          const tailX = px - (streak ? trail * (0.28 + fall * 0.34) : 2);
          const tailY = py - trail;
          const intensity = hot * (0.78 + burst * 0.22);
          const streakLight = context.createLinearGradient(tailX, tailY, px, py);
          streakLight.addColorStop(0, 'rgba(255, 83, 17, 0)');
          streakLight.addColorStop(0.7, `rgba(255, 123, 28, ${intensity * 0.75})`);
          streakLight.addColorStop(1, `rgba(255, 206, 87, ${intensity})`);
          context.beginPath();
          context.moveTo(tailX, tailY);
          context.lineTo(px, py);
          context.strokeStyle = streakLight;
          context.lineWidth = streak ? 5.6 + burst * 2 : 1.7 + seed(i + 6) * 1.25;
          context.stroke();
          if (streak) {
            context.strokeStyle = `rgba(255, 235, 166, ${intensity * 0.88})`;
            context.lineWidth = 1.65;
            context.beginPath();
            context.moveTo(px * 0.38 + tailX * 0.62, py * 0.38 + tailY * 0.62);
            context.lineTo(px, py);
            context.stroke();
          }
        }
        const glow = context.createRadialGradient(442, 455, 3, 442, 455, 78);
        glow.addColorStop(0, `rgba(255, 179, 54, ${0.26 + burst * 0.46})`);
        glow.addColorStop(1, 'rgba(255, 111, 25, 0)');
        context.fillStyle = glow;
        context.fillRect(360, 373, 165, 165);
        context.restore();
      }

      function glint(x1, y1, x2, y2, phase) {
        const shine = pulse(phase, 1.39, 1.8, 1.96, 2.6);
        if (!shine) return;
        const progress = ease(1.35, 2.57, phase);
        const px = x1 + (x2 - x1) * progress;
        const py = y1 + (y2 - y1) * progress;
        const glow = context.createRadialGradient(px, py, 0, px, py, 22);
        glow.addColorStop(0, `rgba(255, 223, 171, ${shine * 0.8})`);
        glow.addColorStop(1, 'rgba(255, 185, 140, 0)');
        context.save();
        context.globalCompositeOperation = 'screen';
        context.fillStyle = glow;
        context.fillRect(px - 22, py - 22, 44, 44);
        context.restore();
      }

      function light(gust, dx, dy) {
        context.save();
        context.globalCompositeOperation = 'screen';
        context.translate(dx, dy);
        const mist = context.createRadialGradient(
          1020 + 115 * gust,
          470,
          23,
          1020 + 115 * gust,
          470,
          520,
        );
        mist.addColorStop(0, `rgba(235, 181, 147, ${0.12 + 0.06 * Math.sin(elapsed * 0.9)})`);
        mist.addColorStop(1, 'rgba(207, 151, 123, 0)');
        context.fillStyle = mist;
        context.fillRect(500, 80, 1050, 720);
        for (let i = 0; i < 5; i++) {
          const source = 1420 + i * 111 + 16 * Math.sin(elapsed * 0.43 + i * 0.48);
          const tip = source - 420 + Math.sin(elapsed * 0.54 + i * 0.87) * 37;
          const strength = 0.68 + 0.23 * Math.sin(elapsed * 0.79 + i * 1.17) + 0.13 * gust;
          for (const [width, opacity] of [
            [1.65, 0.08],
            [1, 0.15],
            [0.43, 0.17],
          ]) {
            const ray = context.createLinearGradient(source, 0, tip, 720);
            ray.addColorStop(0, `rgba(255, 222, 186, ${strength * opacity})`);
            ray.addColorStop(0.36, `rgba(255, 211, 170, ${strength * opacity * 0.78})`);
            ray.addColorStop(1, 'rgba(255, 213, 166, 0)');
            context.fillStyle = ray;
            context.beginPath();
            context.moveTo(source - 11 * width, 0);
            context.lineTo(source + 11 * width, 0);
            context.lineTo(tip + 55 * width, 720);
            context.lineTo(tip - 55 * width, 720);
            context.fill();
          }
        }
        context.restore();
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
        const requested = animated && Boolean(canvas.closest('[data-card-intro]'));
        if (requested && !introRequested) {
          intro = 0;
          elapsed = sparkTime = loopStart;
        }
        introRequested = requested;
        // data-card-intro-time fige l'intro à un instant donné pour la vérifier image par image.
        const forced = animated ? canvas.dataset.cardIntroTime : undefined;
        if (forced !== undefined) {
          intro = Number(forced);
          elapsed = sparkTime = intro + loopStart;
        } else if (animated) {
          sparkTime += delta;
          elapsed += delta;
        }
        if (grid && now - drawn < 1000 / 24) return;
        const ratio = Math.min(devicePixelRatio, grid ? 1.3 : 2);
        const width = Math.round(canvas.clientWidth * ratio),
          height = Math.round(canvas.clientHeight * ratio);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        drawn = now;
        x += (targetX - x) * 0.1;
        y += (targetY - y) * 0.1;
        const t = elapsed % 7.6;
        const leap = pulse(t, 0.5, 1.32, 1.8, 3.1);
        const guard = pulse(t, 0.94, 1.72, 2.22, 3.5);
        const burst = pulse(t, 1.37, 1.82, 2.03, 3.15);
        context.setTransform(width / 1920, 0, 0, height / 897, 0, 0);
        context.fillStyle = '#000';
        context.fillRect(0, 0, 1920, 897);
        context.translate(0, -46);
        const inIntro = intro >= 0;
        const shake = inIntro ? 10 * pulse(intro, CLASH - 0.01, CLASH, CLASH, CLASH + 0.22) : 0;
        if (shake) context.translate(shake * Math.sin(intro * 97), shake * Math.cos(intro * 71));
        const showGlints = animated && (!inIntro || intro > REVEAL_END + 0.4);
        const farX = -19 * x;
        const farY = -10 * y;
        if (farX > 0) context.drawImage(layers.bg, 0, 0, 1, 1080, 0, farY, farX + 1, 1080);
        if (farX < 0)
          context.drawImage(layers.bg, 1919, 0, 1, 1080, 1919 + farX, farY, 1 - farX, 1080);
        context.drawImage(layers.bg, farX, farY);
        if (animated) {
          light(burst, farX, farY);
          leaves(19, 0.4, burst);
        }
        context.save();
        turn(1445, 805, 8 * x, 5 * y, 0);
        const shaftAngle = -0.024 * guard;
        part('shaft', 1355, 405, shaftAngle, 0, -3 * guard);
        context.drawImage(layers.monk, 0, 0);
        part('monk-robe', 1564, 619, -0.041 * burst + 0.012 * Math.sin(elapsed * 1.9));
        part('monk-head', 1300, 387, 0.057 * guard, 0, 3 * guard);
        part('sleeve', 1175, 473, 0.041 * burst + 0.012 * Math.sin(elapsed * 2));
        context.save();
        turn(1355, 405, 0, -3 * guard, shaftAngle);
        context.drawImage(layers['monk-grips'], 0, 0);
        if (showGlints) glint(1030, 483, 1455, 384, t);
        context.restore();
        context.restore();
        if (animated) leaves(19, 1.0, burst);
        context.save();
        turn(725, 380, 15 * x + 5 * leap, 8 * y - 5 * leap, 0.01 * leap);
        part('wolf-bent-leg', 658, 448, 0.076 * leap, 0, -2 * leap);
        part('wolf-extended-leg', 806, 430, -0.051 * leap);
        context.drawImage(layers.wolf, 0, 0);
        part('wolf-head', 728, 153, -0.053 * leap);
        part('flap', 818, 353, -0.058 * guard - 0.015 * Math.sin(elapsed * 2.5));
        context.save();
        turn(649, 244, 0, 0, -0.062 * guard);
        context.drawImage(layers['wolf-axe'], 0, 0);
        if (animated) axeSparks(burst, sparkTime);
        context.restore();
        context.save();
        turn(792, 204, 0, 0, -0.046 * leap);
        context.drawImage(layers['wolf-katana'], 0, 0);
        if (showGlints) glint(951, 230, 842, 309, t);
        context.restore();
        context.restore();
        if (animated) leaves(13, 1.8, burst);
        if (inIntro) {
          introShade(intro);
          introLights(intro, width / 1920);
          if (forced === undefined) {
            const previousIntro = intro;
            intro += delta;
            if (requested && previousIntro < introDuration && intro >= introDuration) {
              canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
            }
            if (intro >= introEnd) intro = -1;
          }
        }
      }

      draw(last);
      return () => {
        cancelAnimationFrame(frame);
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('achievers:card-replay', replay);
      };
    },
  };
})();
