(() => {
  const assets = new URL('.', document.currentScript.src);
  const id = 'hollow-knight-mythique';
  let loading;
  const load = (file) => {
    const image = new Image();
    image.src = new URL(file, assets);
    return image.decode().then(() => image);
  };
  function ease(start, end, time) {
    const x = Math.max(0, Math.min(1, (time - start) / (end - start)));
    return x * x * (3 - 2 * x);
  }
  const pulse = (t, start, peak, hold, end) => ease(start, peak, t) * (1 - ease(hold, end, t));

  (window.AchieversCards ??= {})[id] = {
    async mount(canvas, level = 3) {
      const [bg, body, nail, cloak, head, platform, flowers] = await (loading ??= Promise.all(
        [
          'bg.jpg',
          'body.png',
          'nail.png',
          'cloak.png',
          'head.png',
          'platform.png',
          'flowers.png',
        ].map(load),
      ));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas 2D indisponible');
      const fabric = document.createElement('canvas');
      fabric.width = 630;
      fabric.height = 384;
      const fabricContext = fabric.getContext('2d');
      if (!fabricContext) throw new Error('Calque de cape indisponible');
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
      const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
      let elapsed = 0;
      let previous = performance.now();
      let lastDraw = -Infinity;
      let frame;
      let aimX = 0;
      let aimY = 0;
      let x = 0;
      let y = 0;
      const move = (event) => {
        const bounds = surface.getBoundingClientRect();
        aimX = Math.max(-1, Math.min(1, (2 * (event.clientX - bounds.left)) / bounds.width - 1));
        aimY = Math.max(-1, Math.min(1, (2 * (event.clientY - bounds.top)) / bounds.height - 1));
      };
      const leave = () => {
        aimX = 0;
        aimY = 0;
      };
      const replay = () => {
        elapsed = 0;
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerleave', leave);
      canvas.addEventListener('achievers:card-replay', replay);

      function part(image, dx, dy, px, py, angle, stretch = 1) {
        context.save();
        context.translate(dx + px, dy + py);
        context.rotate(angle);
        context.scale(1, stretch);
        context.drawImage(image, -px, -py);
        context.restore();
      }

      function flower(x, y, width, height, px, py, dx, dy, angle) {
        context.save();
        context.translate(px + dx, py + dy);
        context.rotate(angle);
        context.drawImage(flowers, x, y, width, height, x - px, y - py, width, height);
        context.restore();
      }

      function drawCloak(dx, dy, angle, follow) {
        context.save();
        context.translate(dx + 683, dy + 395);
        context.rotate(angle);
        context.translate(-683, -395);
        const wave = (position) => {
          const reach = ease(55, position < 683 ? 362 : 220, Math.abs(position - 683));
          return (
            reach *
            (Math.sin(elapsed * 2.8 - position * 0.025) * 14 +
              Math.sin(elapsed * 4.1 - position * 0.049) * 4 +
              follow * 6)
          );
        };
        // Déformer à l'échelle des pixels avant l'affichage. Le filtrage du
        // canvas principal ne peut ainsi pas ouvrir de fente entre les bandes.
        fabricContext.clearRect(0, 0, fabric.width, fabric.height);
        for (let left = 300; left < 930; left += 5) {
          const shift = Math.round(wave(left + 2.5));
          fabricContext.drawImage(cloak, left, 168, 5, 320, left - 300, 32 + shift, 5, 320);
        }
        context.drawImage(fabric, 300, 136);
        context.restore();
      }

      function draw(now) {
        frame = requestAnimationFrame(draw);
        const delta = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        const still = motion.matches || level < 2;
        canvas.style.visibility = still ? 'hidden' : '';
        if (still || document.hidden || canvas.closest('[data-card-suspended]')) return;
        if (level >= 3) elapsed += delta;
        if (grid && now - lastDraw < 1000 / 24) return;
        lastDraw = now;
        const ratio = Math.min(devicePixelRatio, grid ? 1.4 : 2);
        const width = Math.round(canvas.clientWidth * ratio);
        const height = Math.round(canvas.clientHeight * ratio);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        x += (aimX - x) * 0.1;
        y += (aimY - y) * 0.1;
        const t = elapsed % 7.8;
        const alert = pulse(t, 0.35, 0.95, 1.45, 2.7);
        const brace = pulse(t, 0.85, 1.55, 2.05, 3.35);
        const lift = pulse(t, 1.25, 1.95, 2.24, 3.5);
        const follow = pulse(t, 1.4, 2.15, 2.45, 3.8);
        const breath = 1 - Math.cos(elapsed * 1.45);

        // Le cadrage du poster et celui du canvas partagent le même repère.
        context.setTransform(width / 1446, 0, 0, height / 676, 0, 0);
        context.translate(73, -14);
        const air = level >= 3 ? Math.sin(elapsed * 0.48) * 5 : 0;
        const farX = -22 * x + air;
        const farY = -11 * y;
        context.drawImage(bg, -111 + farX, -13 + farY, bg.width + 56, bg.height + 26);
        if (level >= 3) {
          const glow = context.createRadialGradient(937 + farX, 255, 25, 937 + farX, 255, 260);
          glow.addColorStop(0, `rgba(170, 225, 255, ${0.08 + 0.035 * Math.sin(elapsed * 0.8)})`);
          glow.addColorStop(1, 'rgba(170, 225, 255, 0)');
          context.fillStyle = glow;
          context.fillRect(640, 0, 600, 600);
          for (let index = 0; index < 29; index++) {
            const age = (elapsed * (0.11 + (index % 5) * 0.014) + index * 0.618) % 1;
            const py = 55 + age * 595;
            const px =
              1030 -
              (py - 55) * 0.42 +
              ((index * 47) % 174) -
              87 +
              Math.sin(age * 7 + index) * 12 +
              farX;
            const opacity = Math.sin(age * Math.PI) ** 2 * (0.35 + (index % 4) * 0.12);
            context.fillStyle = `rgba(217, 245, 255, ${opacity})`;
            context.beginPath();
            context.arc(px, py + farY, 0.9 + (index % 4) * 0.62, 0, 2 * Math.PI);
            context.fill();
          }
        }
        flower(115, 98, 153, 100, 205, 115, -16 * x, -7 * y, 0.048 * Math.sin(elapsed * 1.9));
        const dx = 10 * x - 9 * brace;
        const ground = 7 * y;
        const dy = ground + 14 * brace - 2.5 * breath;
        part(body, dx, ground, 621, 658, 0.018 * brace, 1 - 0.072 * brace + 0.012 * breath);
        part(nail, dx, dy, 466, 452, 0.17 * lift);
        if (level >= 3) drawCloak(dx, dy, -0.023 * follow, follow);
        else part(cloak, dx, dy, 683, 395, 0);
        part(head, dx, dy, 680, 399, -0.075 * alert + 0.033 * follow);
        part(platform, 10 * x, ground, 0, 0, 0);
        flower(
          786,
          594,
          75,
          98,
          801,
          673,
          10 * x,
          ground,
          0.075 * (Math.sin(elapsed * 2.05 + 1.4) - Math.sin(1.4)),
        );
        flower(0, 601, 150, 119, 9, 688, 17 * x, 9 * y, 0.055 * Math.sin(elapsed * 1.5));

        if (level >= 3) {
          for (let index = 0; index < 21; index++) {
            const seed = index * 0.618;
            const age = (elapsed * (0.045 + (index % 4) * 0.014) + seed) % 1;
            const px = ((index * 143.9) % 1350) - 20 + Math.sin(age * 5 + seed) * 19;
            const py = 725 - age * 730;
            const opacity = Math.sin(age * Math.PI) ** 2 * (0.18 + (index % 3) * 0.09);
            context.fillStyle = `rgba(153, 230, 255, ${opacity})`;
            context.beginPath();
            context.arc(px, py, 1 + (index % 4) * 0.5, 0, 2 * Math.PI);
            context.fill();
          }
          const gleam = pulse(t, 1.72, 1.96, 2.01, 2.26);
          if (gleam > 0) {
            context.save();
            context.translate(dx + 466, dy + 452);
            context.rotate(0.17 * lift);
            const halo = context.createRadialGradient(-226, 79, 0, -226, 79, 41);
            halo.addColorStop(0, `rgba(197, 244, 255, ${0.68 * gleam})`);
            halo.addColorStop(1, 'rgba(120, 209, 255, 0)');
            context.fillStyle = halo;
            context.fillRect(-267, 38, 82, 82);
            context.restore();
          }
        }
      }
      draw(previous);
      return () => {
        cancelAnimationFrame(frame);
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('achievers:card-replay', replay);
      };
    },
  };
})();
