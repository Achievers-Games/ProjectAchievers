// Carte Hades. Niveaux : 0 niveaux de gris, ×1 la couleur, ×2 la parallaxe seule,
// ×3 la parallaxe et toutes les animations (personnage articulé, éclat, braises, chaleur).
// Les images sont cherchées à côté du script, pour que la carte serve depuis n'importe quelle page.
// Isolé dans une fonction : plusieurs cartes peuvent se charger sur la même page.
(() => {
  const ASSETS = new URL('.', document.currentScript.src);
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const button = document.getElementById('motion');
  let paused = motionQuery.matches;
  function updateButton() {
    if (!button) return;
    button.textContent = paused ? 'Reprendre l’animation' : 'Mettre en pause';
    button.setAttribute('aria-pressed', String(paused));
  }
  button?.addEventListener('click', () => {
    paused = !paused;
    updateButton();
  });
  motionQuery.addEventListener('change', (event) => {
    paused = event.matches;
    updateButton();
  });
  updateButton();
  const CAMERA = `
  uniform float t;
  uniform vec2 look;
  const float FG_DEPTH = 0.745;
  const float PARALLAX = 0.10;
  vec2 cameraOffset() { return look + vec2(sin(t * 0.35), cos(t * 0.27)) * 0.5; }
  float cameraZoom() { return 0.84 - 0.012 * sin(t * 0.22); }`;
  const IDLE = `
  float idleTime() { return mod(t, 6.4); }
  float swordLift() {
    float beat = idleTime();
    return smoothstep(0.95, 1.7, beat) * (1.0 - smoothstep(2.45, 3.55, beat));
  }`;
  const VERT = `
  attribute vec2 p;
  varying vec2 uv;
  uniform float heroPass;
  ${CAMERA}
  ${IDLE}
  const float ASPECT = 920.0 / 430.0;

  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    vec2 delta = (point - pivot) * vec2(ASPECT, 1.0);
    float c = cos(angle);
    float s = sin(angle);
    return pivot + vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y) / vec2(ASPECT, 1.0);
  }

  vec2 poseHero(vec2 point) {
    float phase = idleTime() * 0.9817477;
    float breath = 0.5 - 0.5 * cos(phase);
    float lift = smoothstep(0.08, 0.98, breath);
    float upperBody = 1.0 - smoothstep(0.64, 0.82, point.y);
    vec2 local = point;

    // Le cou transmet progressivement le mouvement de la tête aux épaules.
    float head = (1.0 - smoothstep(0.33, 0.40, point.y))
      * (1.0 - smoothstep(0.051, 0.075, abs(point.x - 0.556)));
    local = mix(local, rotateAround(local, vec2(0.555, 0.378),
      0.055 * sin(phase - 0.95)), head);

    // Les extrémités des rubans rouges ont plus de jeu que leurs attaches.
    float ribbon = smoothstep(0.684, 0.742, point.x)
      * (1.0 - smoothstep(0.49, 0.57, point.y));
    local += ribbon * vec2(0.004, 0.017) * sin(phase * 2.0 - 0.9 - point.x * 10.0);

    if (heroPass > 1.5) {
      // La main et la lame pivotent autour du poignet avant de suivre le buste.
      local = rotateAround(local, vec2(520.0 / 920.0, 244.0 / 430.0), 0.062 * swordLift());
    }
    vec2 torso = rotateAround(local, vec2(0.555, 0.695), 0.024 * lift - 0.009);
    torso += vec2(0.005, -0.010) * lift;
    return mix(point, torso, upperBody);
  }

  void main() {
    uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    if (heroPass < 0.5) {
      gl_Position = vec4(p, 0.0, 1.0);
      return;
    }
    vec2 offset = cameraOffset() * (FG_DEPTH - 0.45) * PARALLAX;
    vec2 position = (poseHero(uv) - offset - 0.5) / cameraZoom();
    gl_Position = vec4(position * vec2(2.0, -2.0), 0.0, 1.0);
  }`;
  const FRAG = `
  precision highp float;
  varying vec2 uv;
  uniform sampler2D img, bg, bgDepth, fg, bodyLayer, swordLayer;
  uniform float level, heroPass, layered;
  ${CAMERA}
  ${IDLE}

  float eyeMask(vec2 pixel, vec2 center, float slope) {
    vec2 delta = pixel - center;
    delta.y -= delta.x * slope;
    return 1.0 - smoothstep(0.62, 1.0, length(delta / vec2(7.0, 3.8)));
  }

  vec3 closeEye(vec3 color, vec2 pixel, vec2 center, float slope, float blink) {
    float alongLid = (pixel.x - center.x) * slope;
    float height = pixel.y - center.y - alongLid;
    // La paupière supérieure descend. La teinte vient de la peau, ombrée.
    float edge = mix(-4.0, 4.0, blink);
    float cover = (1.0 - smoothstep(edge - 0.4, edge + 0.4, height))
      * eyeMask(pixel, center, slope) * smoothstep(0.0, 0.08, blink);
    vec2 skin = vec2(pixel.x, center.y + alongLid + 5.5) / vec2(920.0, 430.0);
    vec3 lidColor = texture2D(bodyLayer, skin).rgb * vec3(0.70, 0.68, 0.67);
    float crease = 1.0 - smoothstep(0.15, 0.85, abs(height - min(edge, 0.8)));
    lidColor = mix(lidColor, vec3(0.035, 0.026, 0.030), crease * 0.85);
    return mix(color, lidColor, cover);
  }

  void main() {
    if (heroPass > 1.5) {
      vec4 sword = texture2D(swordLayer, uv);
      vec2 pixel = uv * vec2(920.0, 430.0);
      // La lame est reconstruite sous le reflet dessiné dans l'image.
      float starArea = (1.0 - smoothstep(39.0, 44.0, abs(pixel.x - 313.0)))
        * (1.0 - smoothstep(59.0, 64.0, abs(pixel.y - 216.0)));
      vec4 leftBlade = texture2D(swordLayer, vec2(260.0, pixel.y) / vec2(920.0, 430.0));
      vec4 rightBlade = texture2D(swordLayer, vec2(365.0, pixel.y) / vec2(920.0, 430.0));
      vec4 cleanBlade = mix(leftBlade, rightBlade, clamp((pixel.x - 260.0) / 105.0, 0.0, 1.0));
      sword = mix(sword, cleanBlade, starArea);
      float sweep = clamp((idleTime() - 1.66) / 0.7, 0.0, 1.0);
      float glint = 1.0 - smoothstep(1.0, 18.0, abs(pixel.x - mix(459.0, 174.0, sweep)));
      float edge = 1.0 - smoothstep(1.2, 4.0, abs(pixel.y - 225.0));
      sword.rgb += vec3(1.0, 0.76, 0.26) * 0.44 * glint * edge * sin(sweep * 3.14159);

      // Le point spéculaire glisse, s'ouvre vivement, tourne et se résorbe.
      float progress = clamp((idleTime() - 1.80) / 0.80, 0.0, 1.0);
      float attack = smoothstep(1.80, 1.94, idleTime());
      float decay = 1.0 - smoothstep(1.97, 2.60, idleTime());
      float energy = attack * decay;
      vec2 spark = pixel - vec2(mix(344.0, 283.0, progress), 225.0);
      float angle = mix(-0.85, 0.45, 1.0 - pow(1.0 - progress, 2.0));
      float c = cos(angle);
      float s = sin(angle);
      vec2 rays = vec2(c * spark.x + s * spark.y, -s * spark.x + c * spark.y);
      float radius = mix(3.0, 41.0, attack) * mix(1.0, 0.18, progress);
      float longRay = pow(max(0.0, 1.0 - abs(rays.x) / radius), 2.0)
        * exp(-abs(rays.y) / 0.60);
      float shortRay = pow(max(0.0, 1.0 - abs(rays.y) / (radius * 0.68)), 2.0)
        * exp(-abs(rays.x) / 0.65);
      float sparkCore = exp(-dot(spark, spark) / 5.0);
      float sparkHalo = exp(-dot(spark, spark) / 110.0);
      float trail = exp(-max(spark.x, 0.0) / 19.0 - abs(spark.y) / 0.75)
        * smoothstep(0.0, 3.0, spark.x);
      float shine = energy * (longRay + shortRay + sparkCore + 0.12 * sparkHalo + 0.17 * trail);
      float alpha = min(1.0, sword.a + shine);
      vec3 light = vec3(1.0, 0.91, 0.65) * shine;
      sword = vec4((sword.rgb * sword.a + light) / max(alpha, 0.001), alpha);
      gl_FragColor = sword;
      return;
    }
    if (heroPass > 0.5) {
      if (layered > 0.5) {
        float blink = smoothstep(4.19, 4.26, idleTime())
          * (1.0 - smoothstep(4.30, 4.44, idleTime()));
        vec2 pixel = uv * vec2(920.0, 430.0);
        vec4 hero = texture2D(bodyLayer, uv);
        hero.rgb = closeEye(hero.rgb, pixel, vec2(498.0, 127.8), 0.20, blink);
        hero.rgb = closeEye(hero.rgb, pixel, vec2(518.0, 124.2), -0.28, blink);

        vec2 redEye = pixel - vec2(498.0, 127.8);
        float core = exp(-dot(redEye / vec2(1.5, 1.2), redEye / vec2(1.5, 1.2)));
        float eyeBeat = mod(t, 9.7);
        float charge = smoothstep(2.70, 3.04, eyeBeat);
        float release = 1.0 - smoothstep(3.12, 3.85, eyeBeat);
        float burst = exp(-pow((eyeBeat - 3.08) / 0.075, 2.0));
        float eyeFlash = charge * release;
        float haloSize = mix(3.8, 7.8, eyeFlash);
        vec2 haloShape = redEye / vec2(haloSize, haloSize * 0.58);
        float halo = exp(-dot(haloShape, haloShape));
        float flare = exp(-abs(redEye.x) / mix(3.5, 13.0, eyeFlash) - abs(redEye.y) / 0.38);
        float pulse = 0.18 + 0.04 * sin(t * 2.4) + 1.5 * eyeFlash + 0.55 * burst;
        float openEye = 1.0 - smoothstep(0.12, 0.78, blink);
        hero.rgb += vec3(1.0, 0.018, 0.025)
          * (0.80 * core + 0.25 * halo + 0.28 * flare) * pulse * openEye;
        hero.rgb += vec3(1.0, 0.22, 0.09) * core * burst * openEye * 0.32;
        gl_FragColor = hero;
        return;
      }
      gl_FragColor = texture2D(fg, uv);
      return;
    }
    // Pas de carte, ×1 : l'image d'origine, sans calque ni déformation.
    if (level < 2.0) {
      vec3 base = texture2D(img, uv).rgb;
      if (level < 1.0) base = vec3(dot(base, vec3(0.299, 0.587, 0.114))) * 0.75;
      gl_FragColor = vec4(base, 1.0);
      return;
    }
    // La caméra respire et dérive lentement ; la souris ajoute la perspective.
    vec2 cam = cameraOffset();
    vec2 q = (uv - 0.5) * cameraZoom() + 0.5;

    // Le décor : chaque point glisse selon sa propre profondeur, sans le personnage dedans.
    float d = texture2D(bgDepth, q).r;
    vec2 b = q + cam * (d - 0.45) * PARALLAX;
    float far = 1.0 - d;
    // La chaleur fait onduler le fond : c'est un effet, seulement en ×3.
    if (level >= 3.0) b.x += sin(b.y * 38.0 + t * 2.4) * 0.0022 * far * far;
    vec3 color = texture2D(bg, clamp(b, 0.001, 0.999)).rgb;

    if (level >= 3.0) {
      // Les braises restent derrière le personnage.
      vec2 e = vec2(q.x * 26.0, q.y * 9.0 + t * 1.4);
      float ember = smoothstep(0.985, 1.0, fract(sin(dot(floor(e), vec2(12.9898, 78.233))) * 43758.5453));
      float spot = 1.0 - smoothstep(0.0, 0.35, length(fract(e) - 0.5));
      color += vec3(1.0, 0.6, 0.2) * ember * spot * smoothstep(0.2, 0.9, q.y);
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    vec2 f = q + cam * (FG_DEPTH - 0.45) * PARALLAX;
    vec4 hero = texture2D(fg, clamp(f, 0.001, 0.999));
    gl_FragColor = vec4(mix(color, hero.rgb, hero.a), 1.0);
  }`;

  const load = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image introuvable : ' + src));
      image.src = new URL(src, ASSETS);
    });

  function createHeroMesh(gl) {
    const columns = 80;
    const rows = 40;
    const vertices = [];
    const indices = [];
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        vertices.push((2 * x) / columns - 1, 1 - (2 * y) / rows);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const top = y * (columns + 1) + x;
        const bottom = top + columns + 1;
        indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
      }
    }
    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return { positions, count: indices.length };
  }

  /**
   * Monte une carte sur un canvas. Le niveau vient du `data-level` de son parent, ou de l'appelant.
   * Renvoie de quoi l'arrêter : la boucle s'interrompt et le contexte WebGL est rendu.
   */
  function setup(canvas, images, level = Number(canvas.parentElement.dataset.level)) {
    let alive = true;
    let observer;
    const gl = canvas.getContext('webgl', { antialias: true });
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(p);
    const bindPositions = (buffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    };
    const heroMesh = level === 3 ? createHeroMesh(gl) : null;
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    Object.entries(images).forEach(([name, image], unit) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    });
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniform1f(u('level'), level);
    const layered = Boolean(images.swordLayer);
    gl.uniform1f(u('layered'), layered ? 1 : 0);
    const heroPass = u('heroPass');
    const time = u('t');
    const camera = u('look');
    const look = { x: 0, y: 0, tx: 0, ty: 0 };
    const card = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
    const external = card.hasAttribute('data-card-motion');
    const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
    const closeUp = Boolean(canvas.closest('[data-card-quality="close-up"]'));
    const resolutionLimit = closeUp ? 2.5 : grid ? 1.5 : 2;
    let needsDraw = true;
    let lastDrawn = 0;
    const onMotion = (event) => {
      needsDraw = true;
      look.x = look.tx = event.detail.x;
      look.y = look.ty = event.detail.y;
    };
    const onMove = (event) => {
      const box = card.getBoundingClientRect();
      look.tx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
      look.ty = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
    };
    const onLeave = () => Object.assign(look, { tx: 0, ty: 0 });
    if (external) {
      card.addEventListener('achievers:card-motion', onMotion);
      onMotion({
        detail: {
          x: Number(card.style.getPropertyValue('--look-x')) || 0,
          y: Number(card.style.getPropertyValue('--look-y')) || 0,
        },
      });
    } else {
      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerleave', onLeave);
    }
    let lastTime = performance.now(),
      elapsed = 0;
    const onReplay = () => {
      elapsed = 0;
      lastTime = performance.now();
      needsDraw = true;
    };
    canvas.addEventListener('achievers:card-replay', onReplay);
    const frame = () => {
      const now = performance.now();
      if (canvas.closest('[data-card-suspended]')) {
        lastTime = now;
        if (alive && level >= 2) requestAnimationFrame(frame);
        return;
      }
      if (!paused && !document.hidden) elapsed += Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const ratio = Math.min(window.devicePixelRatio * (closeUp ? 1.85 : 1), resolutionLimit);
      const w = Math.round(canvas.clientWidth * ratio);
      const h = Math.round(canvas.clientHeight * ratio);
      const resized = canvas.width !== w || canvas.height !== h;
      if (
        external &&
        grid &&
        !needsDraw &&
        !resized &&
        !card.hasAttribute('data-tilting') &&
        (level < 3 || now - lastDrawn < 1000 / 24)
      ) {
        if (alive) requestAnimationFrame(frame);
        return;
      }
      needsDraw = false;
      lastDrawn = now;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      look.x += (look.tx - look.x) * 0.08;
      look.y += (look.ty - look.y) * 0.08;
      gl.uniform1f(time, level >= 3 ? elapsed : 0);
      gl.uniform2f(camera, look.x, look.y);
      gl.uniform1f(heroPass, 0);
      bindPositions(quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (heroMesh) {
        gl.uniform1f(heroPass, 1);
        bindPositions(heroMesh.positions);
        gl.enable(gl.BLEND);
        gl.drawElements(gl.TRIANGLES, heroMesh.count, gl.UNSIGNED_SHORT, 0);
        if (layered) {
          gl.uniform1f(heroPass, 2);
          gl.drawElements(gl.TRIANGLES, heroMesh.count, gl.UNSIGNED_SHORT, 0);
        }
        gl.disable(gl.BLEND);
      }
      if (level >= 2 && alive) requestAnimationFrame(frame);
    };
    // Les cartes fixes se redessinent seulement quand leur taille change.
    if (level < 2) (observer = new ResizeObserver(frame)).observe(canvas);
    frame();
    return () => {
      canvas.removeEventListener('achievers:card-replay', onReplay);
      card.removeEventListener('achievers:card-motion', onMotion);
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      alive = false;
      observer?.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }

  let loading;
  const loadImages = () =>
    (loading ??= Promise.all([
      load('full.jpg'),
      load('bg.jpg'),
      load('bg-depth.png'),
      load('fg.png'),
      // Sans les calques articulés, le ×3 retombe sur le personnage d'un seul tenant.
      Promise.all([load('zagreus-body.png'), load('zagreus-sword.png')])
        .then(([bodyLayer, swordLayer]) => ({ bodyLayer, swordLayer }))
        .catch((error) => {
          console.warn(error);
          return {};
        }),
    ]).then(([img, bg, bgDepth, fg, heroLayers]) => ({ img, bg, bgDepth, fg, heroLayers })));

  const imagesFor = (all, level) => ({
    img: all.img,
    bg: all.bg,
    bgDepth: all.bgDepth,
    fg: all.fg,
    ...(level === 3 ? all.heroLayers : {}),
  });

  // Une autre page peut monter la carte elle-même : l'ouverture d'un booster la montre en grand.
  (window.AchieversCards ??= {}).hades = {
    async mount(canvas, level = 3) {
      return setup(canvas, imagesFor(await loadImages(), level), level);
    },
  };

  const canvases = document.querySelectorAll('.card[data-game="hades"] canvas');
  if (canvases.length) {
    loadImages()
      .then((all) => {
        for (const canvas of canvases) {
          const level = Number(canvas.parentElement.dataset.level);
          setup(canvas, imagesFor(all, level), level);
        }
      })
      .catch(console.error);
  }
})();
