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
  const pulse = (t, start, peak, hold, end) => ease(start, peak, t) * (1 - ease(hold, end, t));

  (window.AchieversCards ??= {}).sekiro = {
    async mount(canvas, level = 3) {
      const [background, body, head, scarf, foreground, leftArm, rightArm, topknot] =
        await (loading ??= Promise.all(
          [
            'bg.jpg',
            'body.png',
            'head.png',
            'scarf.png',
            'foreground.png',
            'arm-left.png',
            'arm-right.png',
            'topknot.png',
          ].map(load),
        ));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas 2D indisponible');
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
      const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
      let targetX = 0;
      let targetY = 0;
      let x = 0;
      let y = 0;
      let elapsed = 0;
      let last = performance.now();
      let drawn = -Infinity;
      let frame;
      const reset = () => {
        elapsed = 0;
      };
      const leave = () => {
        targetX = 0;
        targetY = 0;
      };
      const move = ({ clientX, clientY }) => {
        const box = surface.getBoundingClientRect();
        targetX = Math.max(-1, Math.min(1, (2 * (clientX - box.left)) / box.width - 1));
        targetY = Math.max(-1, Math.min(1, (2 * (clientY - box.top)) / box.height - 1));
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerleave', leave);
      canvas.addEventListener('achievers:card-replay', reset);

      const fabric = document.createElement('canvas');
      fabric.width = 116;
      fabric.height = 211;
      const fabricContext = fabric.getContext('2d');
      function drawTopknot(wind) {
        fabricContext.clearRect(0, 0, fabric.width, fabric.height);
        for (let top = 166; top < 220; top += 2) {
          const reach = 1 - ease(167, 218, top);
          const wave = 3.2 * Math.sin(elapsed * 3.5 + top * 0.08);
          const shift = Math.round(reach * (8 * wind + wave));
          fabricContext.drawImage(topknot, 927, top, 73, 2, 8 + shift, top - 166, 73, 2);
        }
        context.drawImage(fabric, 919, 166);
      }
      function drawScarf(wind) {
        fabricContext.clearRect(0, 0, fabric.width, fabric.height);
        for (let top = 275; top < 485; top += 3) {
          const reach = ease(289, 470, top);
          const wave = 6 * Math.sin(elapsed * 3.1 - top * 0.054);
          const shift = Math.round(reach * (wind * 30 + wave));
          fabricContext.drawImage(scarf, 958, top, 74, 3, 7 + shift, top - 275, 74, 3);
        }
        context.drawImage(fabric, 951, 275);
      }

      function flamePlumes(front, wind) {
        const roots = front ? [666, 747, 1181, 1280, 1360] : [704, 748, 778, 1150, 1200, 1243];
        context.save();
        context.globalCompositeOperation = 'screen';
        context.filter = front ? 'blur(4px)' : 'blur(3px)';
        for (let index = 0; index < roots.length * 2; index++) {
          const age = (elapsed * (0.58 + (index % 4) * 0.14) + index * 0.618) % 1;
          const opacity = Math.sin(Math.PI * age) ** 2;
          const height = (front ? 80 : 145) * (0.55 + 0.72 * age) * (0.78 + (index % 4) * 0.14);
          const width = (18 + (index % 4) * 7) * (1 - 0.54 * age);
          const px = roots[index % roots.length] + (index < roots.length ? -11 : 11) + 15 * x;
          const py = (front ? 637 : 585) - 25 * age;
          const drift = wind * height * 0.35 + 10 * Math.sin(elapsed * 6 + index);
          const flame = context.createLinearGradient(px, py, px + drift, py - height);
          flame.addColorStop(0, `rgba(255, 173, 57, ${opacity * 0.04})`);
          flame.addColorStop(0.27, `rgba(255, 216, 108, ${opacity * 0.62})`);
          flame.addColorStop(0.66, `rgba(255, 105, 21, ${opacity * 0.4})`);
          flame.addColorStop(1, 'rgba(255, 65, 9, 0)');
          context.fillStyle = flame;
          context.beginPath();
          context.moveTo(px - width, py);
          context.bezierCurveTo(
            px - width * 1.1,
            py - height * 0.42,
            px + drift * 0.8,
            py - height * 0.57,
            px + drift,
            py - height,
          );
          context.bezierCurveTo(
            px + drift + width * 0.48,
            py - height * 0.55,
            px + width * 1.25,
            py - height * 0.34,
            px + width,
            py,
          );
          context.fill();
        }
        context.restore();
      }

      function embers(count, depth, advance) {
        for (let index = 0; index < count; index++) {
          const age = (elapsed * (0.1 + (index % 6) * 0.022) + index * 0.618) % 1;
          const px =
            480 +
            ((index * 137) % 1030) +
            age * (220 + advance * 85) +
            23 * Math.sin(age * 6 + index) +
            depth * x;
          const py = 653 - age * (455 + (index % 5) * 23) + depth * y * 0.3;
          const alpha = Math.sin(age * Math.PI) ** 2 * (0.3 + (index % 4) * 0.11);
          context.fillStyle = `rgba(255, ${137 + (index % 5) * 21}, 64, ${alpha})`;
          context.beginPath();
          context.ellipse(
            px,
            py,
            1.4 + (index % 4) * 0.85,
            0.8 + depth * 0.02,
            -0.57,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }

      function fireSparks(wind) {
        const sources = [680, 745, 807, 1140, 1210, 1285, 1360];
        context.save();
        context.globalCompositeOperation = 'screen';
        context.lineCap = 'round';
        for (let index = 0; index < 38; index++) {
          const seed = (index * 0.61803398875) % 1;
          const age = (elapsed * (0.26 + (index % 7) * 0.047) + seed) % 1;
          const height = 112 + ((index * 89) % 345);
          const drift = 72 + wind * 118 + (index % 5) * 16;
          const px =
            sources[index % sources.length] +
            (seed - 0.5) * 61 +
            age * (0.4 + age * 0.6) * drift +
            22 * x;
          const py = 628 - height * age * (1.24 - age * 0.24) + 7 * y;
          const opacity = ease(0.0, 0.13, age) * (1 - ease(0.48, 1, age));
          const flicker = 0.71 + 0.29 * Math.sin(elapsed * (6 + (index % 4)) + index * 2.1);
          const radius = (0.9 + (index % 6) * 0.39) * (1 - 0.44 * age);
          const light = opacity * flicker;
          context.strokeStyle = `rgba(255, ${115 + (index % 4) * 22}, 31, ${light * 0.5})`;
          context.lineWidth = radius * 2.6;
          context.beginPath();
          context.moveTo(px - radius * 2.7, py + radius * 4.1);
          context.lineTo(px, py);
          context.stroke();
          context.fillStyle = `rgba(255, ${178 + (index % 4) * 19}, 90, ${light})`;
          context.beginPath();
          context.arc(px, py, radius, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      function draw(now) {
        frame = requestAnimationFrame(draw);
        const delta = Math.min((now - last) / 1000, 0.05);
        last = now;
        const still = motion.matches || level < 2;
        canvas.style.visibility = still ? 'hidden' : '';
        if (still || document.hidden || canvas.closest('[data-card-suspended]')) return;
        if (level >= 3) elapsed += delta;
        if (grid && now - drawn < 1000 / 24) return;
        const ratio = Math.min(devicePixelRatio, grid ? 1.35 : 2);
        const width = Math.round(canvas.clientWidth * ratio);
        const height = Math.round(canvas.clientHeight * ratio);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        drawn = now;
        x += (targetX - x) * 0.1;
        y += (targetY - y) * 0.1;
        const phase = elapsed % 7.7;
        const lift = pulse(phase, 0.88, 1.7, 2.04, 3.38);
        const gust = pulse(phase, 1.12, 1.82, 2.18, 3.35);
        const breath = (1 - Math.cos(elapsed * 1.48)) * 0.5;
        const wind = 0.46 + 0.18 * Math.sin(elapsed * 0.84) + 0.39 * gust;
        context.setTransform(width / 1292, 0, 0, height / 604, 0, 0);
        context.translate(-260, -8);
        context.drawImage(background, -27 * x, -7 * y, 1920, 620);
        if (level >= 3) {
          const fire = context.createRadialGradient(981, 545, 35, 981, 545, 415);
          fire.addColorStop(
            0,
            `rgba(255, 143, 31, ${0.1 + 0.07 * Math.sin(elapsed * 3.6) + 0.07 * gust})`,
          );
          fire.addColorStop(1, 'rgba(255, 99, 25, 0)');
          context.fillStyle = fire;
          context.fillRect(500, 100, 960, 520);
          flamePlumes(false, wind);
          embers(33, 6, gust);
        }
        context.save();
        context.translate(9 * x, 4 * y);
        // Le bas du manteau reste ancré. Les épaules et le col montent ensemble.
        context.translate(0, 617);
        context.scale(1, 1 + 0.021 * breath);
        context.translate(0, -617);
        context.drawImage(body, 0, 0);
        context.save();
        // Les deux poignets suivent la même levée pour garder l'arme de niveau.
        context.translate(0, 327);
        context.scale(1, 1 - 0.044 * lift);
        context.translate(0, -327);
        context.drawImage(leftArm, 0, 0);
        context.drawImage(rightArm, 0, 0);
        context.restore();
        context.drawImage(head, 0, 0);
        if (level >= 3 && fabricContext) drawTopknot(wind);
        else context.drawImage(topknot, 0, 0);
        if (level >= 3 && fabricContext) drawScarf(wind);
        else context.drawImage(scarf, 0, 0);
        context.restore();
        if (level >= 3) flamePlumes(true, wind);
        context.drawImage(foreground, 32 * x, 5 * y);
        if (level >= 3) fireSparks(wind);
      }

      draw(last);
      return () => {
        cancelAnimationFrame(frame);
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('achievers:card-replay', reset);
      };
    },
  };
})();
