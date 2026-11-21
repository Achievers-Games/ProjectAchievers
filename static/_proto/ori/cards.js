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

  // Repère : les calques couvrent tout le hero Steam (1920 × 620). La carte en montre la
  // fenêtre (400, 0, 1326, 620). Les coordonnées artistiques sont en pixels du hero.
  // Passes : 0 décor, 1 branche, 2 Ku, 3 Ori, 4 premier plan, 5 lueurs et braises, 6 vignette.
  // Niveaux : ×1 l'illustration, ×2 la parallaxe seule, ×3 la parallaxe et toutes les animations.
  // tc est l'horloge de la caméra, t celle des animations. En ×2, t reste à 0 et fx vaut 0 :
  // les calques gardent les pixels d'origine et aucun effet n'est ajouté.
  const COMMON = `
  uniform float t, tc, fx, pass;
  uniform vec2 look;
  const vec2 SRC = vec2(1920.0, 620.0);
  const vec2 WIN_ORIGIN = vec2(400.0, 0.0);
  const vec2 WIN = vec2(1326.0, 620.0);
  const vec2 ANCHOR = vec2(0.5, 0.5);
  const float BASE = 1.05;
  const vec2 FOCUS = vec2(0.30, 0.55);
  const vec2 PARALLAX = vec2(0.070, 0.028);
  const float HERO = 0.60;
  const float FRONT = 1.70;
  // Orbe de lumière entre les deux arbres, au cœur du vortex.
  const vec2 ORB = vec2(1150.0, 238.0);
  vec2 camera() {
    return look + vec2(sin(tc * 0.21) + 0.4 * sin(tc * 0.47 + 1.3),
      0.8 * cos(tc * 0.16) + 0.3 * sin(tc * 0.41)) * 0.45;
  }
  float dolly() { return 0.5 - 0.5 * cos(tc * 0.19); }
  float layerScale(float depth) { return BASE * (1.0 + dolly() * 0.016 * depth); }
  vec2 layerOffset(float depth) { return camera() * (vec2(depth) - FOCUS) * PARALLAX; }
  // Fenêtre normalisée (0..1) vers écran, et inversement.
  vec2 toScreen(vec2 q, float depth) { return (q - ANCHOR) * layerScale(depth) + ANCHOR + layerOffset(depth); }
  vec2 toLayer(vec2 s, float depth) { return (s - ANCHOR - layerOffset(depth)) / layerScale(depth) + ANCHOR; }
  vec2 toPixel(vec2 q) { return q * WIN + WIN_ORIGIN; }
  vec2 toTexture(vec2 pixel) { return pixel / SRC; }
  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    vec2 delta = point - pivot;
    float c = cos(angle), s = sin(angle);
    return pivot + vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  }
  float breath() { return 0.5 - 0.5 * cos(t * 1.30); }
  // Lueur d'Ori : un battement lent et doux.
  float glow() { return 0.75 + 0.25 * sin(t * 1.05) * sin(t * 0.37 + 0.8); }
  // Ku tourne la tête par à-coups, comme une chouette, toutes les 7,3 s.
  float kuTurn() {
    float p = mod(t, 7.3);
    return 0.10 * (smoothstep(1.0, 1.22, p) - smoothstep(3.8, 4.05, p))
      - 0.05 * (smoothstep(4.9, 5.1, p) - smoothstep(6.4, 6.7, p));
  }`;

  const VERT = `
  attribute vec2 position;
  varying vec2 uv;
  ${COMMON}
  float box(vec2 p, vec4 r) {
    return smoothstep(r.x - 6.0, r.x, p.x) * (1.0 - smoothstep(r.z, r.z + 6.0, p.x))
      * smoothstep(r.y - 6.0, r.y, p.y) * (1.0 - smoothstep(r.w, r.w + 6.0, p.y));
  }
  // Une pousse ancrée en bas se balance, davantage vers sa pointe.
  vec2 sprout(vec2 p, vec4 r, float seed) {
    float w = box(p, r) * pow(smoothstep(r.w, r.y, p.y), 1.4);
    return vec2(sin(t * 1.5 + seed) * 5.0 + sin(t * 2.7 + seed * 2.0) * 1.5, 0.0) * w;
  }
  void main() {
    vec2 tex = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
    if (pass < 0.5 || pass > 3.5) {
      uv = tex;
      gl_Position = vec4(position, 0.0, 1.0);
      return;
    }
    uv = tex;
    vec2 point = tex * SRC;
    vec2 rest = point;
    if (pass < 1.5) {
      // Branche : les pousses se balancent dans le vent.
      point += sprout(point, vec4(690.0, 440.0, 725.0, 500.0), 0.0);
      point += sprout(point, vec4(785.0, 466.0, 818.0, 492.0), 1.7);
      point += sprout(point, vec4(888.0, 436.0, 918.0, 470.0), 3.1);
      point += sprout(point, vec4(1488.0, 296.0, 1515.0, 372.0), 4.4);
      point += sprout(point, vec4(1528.0, 296.0, 1572.0, 366.0), 5.6);
    } else if (pass < 2.5) {
      // Ku respire, ses plumes de tête frémissent et sa tête tourne par à-coups.
      float upper = 1.0 - smoothstep(300.0, 412.0, point.y);
      point.y -= breath() * 3.2 * upper;
      point.x += sin(t * 0.6) * 1.0 * upper;
      float head = 1.0 - smoothstep(242.0, 290.0, point.y);
      float angle = kuTurn() + 0.025 * sin(t * 0.55) + look.x * 0.035;
      point = mix(point, rotateAround(point, vec2(1285.0, 275.0), angle), head);
      float tuft = smoothstep(1290.0, 1340.0, point.x) * (1.0 - smoothstep(200.0, 215.0, point.y)) * head;
      point += vec2(sin(t * 2.4) * 2.0, sin(t * 2.9 + 1.0) * 2.5) * tuft;
    } else {
      // Ori respire, lève la tête vers le pointeur et ses oreilles flottent.
      float upper = 1.0 - smoothstep(330.0, 398.0, point.y);
      point.y -= breath() * 2.4 * upper;
      vec2 headCenter = vec2(1415.0, 252.0);
      float head = 1.0 - smoothstep(272.0, 300.0, point.y);
      float angle = 0.045 * sin(t * 0.7) + look.x * 0.05 - look.y * 0.02;
      point = mix(point, rotateAround(point, vec2(1418.0, 290.0), angle), head);
      float reach = length(point - headCenter);
      float ear = smoothstep(28.0, 95.0, reach) * (1.0 - smoothstep(1398.0, 1410.0, point.x))
        * (1.0 - smoothstep(305.0, 318.0, point.y));
      point.y += (sin(t * 2.0 - reach * 0.05) * 4.0 + 2.0 * breath()) * ear;
      point.x += sin(t * 1.6 - reach * 0.04) * 2.0 * ear;
      float tail = (1.0 - smoothstep(1360.0, 1398.0, point.x)) * smoothstep(352.0, 362.0, point.y)
        * (1.0 - smoothstep(386.0, 394.0, point.y));
      point.y += sin(t * 2.6) * 3.0 * tail;
      point.x += sin(t * 2.6 + 1.2) * 1.5 * tail;
    }
    point = mix(rest, point, fx);
    vec2 q = toScreen((point - WIN_ORIGIN) / WIN, HERO);
    gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
  }`;

  const FRAG = `
  precision highp float;
  varying vec2 uv;
  uniform float level;
  uniform sampler2D background, depth, branch, ku, ori, front;
  ${COMMON}

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }

  // Particules en pixels de la fenêtre : neige lumineuse qui tombe ou braises qui montent.
  vec3 particles(vec2 q, float near, int count, float ember) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (i >= count) break;
      float seed = float(i) + near * 17.0 + ember * 31.0;
      float h = fract(sin(seed * 127.1 + 18.7) * 43758.54);
      float g = fract(sin(seed * 311.7 + 4.1) * 24634.63);
      float age = fract(t * (0.026 + h * 0.018) * mix(1.0, 1.7, near) + h);
      float y = ember > 0.5 ? mix(1.05, 0.35, age) : mix(-0.06, 1.06, age);
      vec2 center = vec2(h * 1.0 + sin(t * 0.3 + seed * 4.0) * 0.03 + age * 0.04, y);
      vec2 delta = (q - center) * WIN;
      float radius = mix(0.9, 2.2, g) * mix(1.0, 3.0, near) * (ember > 0.5 ? 1.4 : 1.0);
      float fade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.75, 1.0, age));
      float flicker = ember > 0.5 ? 0.6 + 0.4 * sin(t * (5.0 + g * 6.0) + seed) : 0.7 + 0.3 * sin(t * 1.7 + seed);
      float d2 = dot(delta, delta);
      float core = exp(-d2 / (radius * radius));
      float halo = exp(-d2 / (radius * radius * 14.0));
      vec3 tint = ember > 0.5 ? vec3(1.0, 0.62, 0.42) : vec3(0.80, 0.82, 1.0);
      light += tint * (core * mix(0.7, 0.4, near) + halo * 0.14) * fade * flicker;
    }
    return light;
  }

  void main() {
    if (level < 2.0) {
      gl_FragColor = texture2D(background, uv);
      return;
    }
    if (pass < 0.5) {
      // Décor : profondeur peinte, racines qui ondulent et pulsations de lumière.
      vec2 guess = toLayer(uv, 0.2);
      vec4 info = texture2D(depth, toTexture(toPixel(guess)));
      vec2 q = toLayer(uv, info.r * 0.9);
      vec2 p = toPixel(q);
      vec4 here = texture2D(depth, toTexture(p));
      float roots = here.g;
      // L'ondulation suit la zone adoucie des racines (bleu) : elle varie lentement d'un
      // pixel à l'autre et ne déchire pas le dessin. Elle grandit vers le bas des racines.
      float zone = here.b * smoothstep(0.0, 420.0, p.y) * fx;
      p.x += (sin(t * 0.85 - p.y * 0.016 + p.x * 0.004) * 7.0 + sin(t * 1.7 - p.y * 0.03) * 1.5) * zone;
      p.y += sin(t * 0.7 + p.x * 0.01) * 1.5 * zone;
      // Vortex autour de l'orbe : le décor se tord doucement autour du centre, avec une
      // torsion qui respire. L'ellipse donne la perspective d'un tourbillon vu de biais.
      vec2 swirl = (p - ORB) * vec2(1.0, 1.35);
      float swirlR = length(swirl);
      float twist = (0.28 + 0.10 * sin(t * 0.45)) * exp(-pow(swirlR / 150.0, 2.0)) * smoothstep(8.0, 40.0, swirlR) * fx;
      p = ORB + rotateAround(swirl, vec2(0.0), twist) / vec2(1.0, 1.35);
      vec3 color = texture2D(background, clamp(toTexture(p), 0.001, 0.999)).rgb;
      vec3 plain = color;
      // Petites impulsions permanentes le long des racines.
      float pulse = pow(0.5 + 0.5 * sin(p.y * 0.022 - t * 2.1 + p.x * 0.013), 8.0);
      color += vec3(0.62, 0.70, 1.0) * roots * pulse * 0.16;
      color += vec3(0.50, 0.55, 0.95) * roots * 0.05 * (0.5 + 0.5 * sin(t * 0.8 + p.x * 0.004));
      // Par moments, une onde de lumière plus intense descend une liane depuis le haut.
      // Chaque groupe de lianes a son propre décalage, qui varie doucement le long de x :
      // les ondes partent à des instants différents et ne se coupent pas net entre lianes.
      for (int i = 0; i < 2; i++) {
        float lane = noise(vec2(p.x * 0.0045 + float(i) * 7.3, float(i) * 3.1));
        float cycle = 8.5 + float(i) * 3.2;
        float local = mod(t + lane * cycle * 1.7 + float(i) * 4.0, cycle);
        float front = local * 150.0 - 80.0;
        float wave = exp(-pow((p.y - front) / 75.0, 2.0));
        // Les ondes ne touchent qu'une partie des lianes à la fois.
        float chosen = smoothstep(0.45, 0.65, noise(vec2(p.x * 0.006 + floor((t + lane * cycle * 1.7 + float(i) * 4.0) / cycle) * 5.7, 1.0 + float(i))));
        float fade = smoothstep(0.0, 0.8, local) * (1.0 - smoothstep(5.0, 6.0, local));
        float strength = wave * chosen * fade;
        color += vec3(0.72, 0.80, 1.0) * roots * strength * 0.75;
        color += vec3(0.55, 0.60, 1.0) * here.b * strength * 0.10;
      }
      // Orbe chaud derrière l'arbre.
      vec2 orb = (p - ORB) / 60.0;
      float orbBeat = 0.7 + 0.3 * sin(t * 0.9) * sin(t * 0.33 + 1.0);
      color += vec3(1.0, 0.72, 0.62) * (exp(-dot(orb, orb)) * 0.28 + exp(-dot(orb, orb) * 0.12) * 0.08) * orbBeat;
      // Traînées de vent en spirale qui tournent autour de l'orbe et s'y enroulent.
      vec2 v = (toPixel(q) - ORB) * vec2(1.0, 1.35);
      float vr = length(v), va = atan(v.y, v.x);
      float ring = exp(-pow((vr - 85.0) / 55.0, 2.0)) * smoothstep(10.0, 35.0, vr);
      float arms = 0.0;
      for (int i = 0; i < 2; i++) {
        float k = float(i);
        float spiral = va * (2.0 + k) + log(vr + 1.0) * (5.5 - k) - t * (1.3 + k * 0.5);
        float streak = smoothstep(0.55, 1.0, sin(spiral)) * (0.5 + 0.5 * noise(vec2(va * 3.0 + t * 0.4, vr * 0.03 + k)));
        arms += streak * (0.6 - k * 0.2);
      }
      color += vec3(1.0, 0.86, 0.72) * arms * ring * 0.22 * orbBeat;
      // Quelques poussières dorées sont aspirées en spirale vers l'orbe.
      for (int i = 0; i < 7; i++) {
        float s = float(i);
        float h = fract(sin(s * 91.7 + 3.1) * 43758.54);
        float age = fract(t * (0.10 + h * 0.06) + h);
        float radius = mix(150.0, 12.0, age * age);
        float angle = h * 6.2832 + age * (5.0 + h * 3.0);
        vec2 dust = ORB + vec2(cos(angle), sin(angle) / 1.35) * radius;
        vec2 dd = toPixel(q) - dust;
        float fade = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.8, 1.0, age));
        color += vec3(1.0, 0.82, 0.6) * (exp(-dot(dd, dd) / 3.5) * 0.7 + exp(-dot(dd, dd) / 40.0) * 0.12) * fade;
      }
      // Brume violette qui glisse au ras de la branche.
      float mist = fbm(q * vec2(3.0, 6.5) + vec2(t * 0.03, -t * 0.006));
      color = mix(color, vec3(0.70, 0.52, 0.86), smoothstep(0.50, 0.86, mist) * smoothstep(0.45, 0.95, q.y) * 0.22);
      color += particles(toLayer(uv, 0.15), 0.0, 14, 0.0) * 0.8;
      color += particles(toLayer(uv, 0.25), 0.0, 8, 1.0) * 0.8;
      gl_FragColor = vec4(mix(plain, color, fx), 1.0);
      return;
    }
    if (pass > 3.5 && pass < 4.5) {
      // Plantes floues du premier plan : forte parallaxe et balancement depuis le sol.
      vec2 p = toPixel(toLayer(uv, FRONT));
      vec2 root = vec2(250.0, 650.0);
      float reach = length(p - root) / 220.0;
      float bend = smoothstep(0.1, 1.0, reach);
      p.x -= (sin(t * 0.9 - reach * 2.5) * 9.0 + sin(t * 1.7) * 3.0) * bend * fx;
      p = rotateAround(p, root, -0.03 * sin(t * 0.55) * fx);
      vec2 tex = toTexture(p), px = 2.5 / SRC;
      vec4 c = texture2D(front, tex) * 0.4
        + (texture2D(front, tex + vec2(px.x, 0.0)) + texture2D(front, tex - vec2(px.x, 0.0))
        + texture2D(front, tex + vec2(0.0, px.y)) + texture2D(front, tex - vec2(0.0, px.y))) * 0.15;
      gl_FragColor = vec4(c.rgb * 0.85, c.a);
      return;
    }
    if (pass > 4.5 && pass < 5.5) {
      // Lueur d'Ori sur la scène, braises et brume devant.
      vec2 hero = toPixel(toLayer(uv, HERO));
      vec2 d = (hero - vec2(1410.0, 300.0)) / vec2(95.0, 110.0);
      float bloom = (exp(-dot(d, d)) * 0.20 + exp(-dot(d, d) * 0.18) * 0.07) * glow();
      vec3 light = vec3(0.62, 0.86, 1.0) * bloom;
      light += particles(toLayer(uv, 1.3), 1.0, 10, 1.0) * 0.8;
      vec2 q = toLayer(uv, 1.2);
      float mist = fbm(q * vec2(2.0, 4.0) + vec2(-t * 0.05, t * 0.01));
      float m = smoothstep(0.52, 0.90, mist) * smoothstep(0.6, 1.0, q.y) * 0.20;
      float alpha = clamp(m + max(light.r, max(light.g, light.b)), 0.0, 1.0);
      gl_FragColor = vec4((vec3(0.66, 0.50, 0.85) * m + light) / max(alpha, 0.001), alpha);
      return;
    }
    if (pass > 5.5) {
      vec2 c = (uv - vec2(0.55, 0.45)) * vec2(1.0, 1.6);
      float v = smoothstep(0.5, 1.2, length(c)) * 0.42;
      gl_FragColor = vec4(0.03, 0.0, 0.06, v);
      return;
    }

    vec2 pixel = uv * SRC;
    vec4 part;
    if (pass < 1.5) {
      part = texture2D(branch, uv);
      // La lumière d'Ori éclaire la branche sous ses pieds.
      vec2 d = (pixel - vec2(1410.0, 402.0)) / vec2(120.0, 40.0);
      part.rgb += vec3(0.30, 0.45, 0.60) * exp(-dot(d, d)) * glow() * 0.5 * fx;
    } else if (pass < 2.5) {
      part = texture2D(ku, uv);
      // Ku cligne de l'œil : la paupière descend depuis le haut de l'œil.
      float beat = mod(t, 4.7);
      float close = smoothstep(3.0, 3.08, beat) * (1.0 - smoothstep(3.16, 3.30, beat));
      vec2 e = (pixel - vec2(1239.0, 216.0)) / vec2(11.0, 17.0);
      float eye = 1.0 - smoothstep(0.85, 1.05, length(e));
      float lid = 1.0 - smoothstep(-1.0 + close * 2.1 - 0.08, -1.0 + close * 2.1, e.y);
      // La paupière prend la couleur du disque facial, prise juste au-dessus de l'œil.
      vec3 skin = texture2D(ku, vec2(1239.0, 201.0) / SRC).rgb;
      part.rgb = mix(part.rgb, skin * (0.85 + 0.15 * e.y), eye * lid * step(0.01, close));
      // L'œil orange brille un peu, et la lumière d'Ori touche son flanc droit.
      part.rgb += vec3(0.25, 0.10, 0.0) * eye * (1.0 - close) * 0.35 * (0.7 + 0.3 * sin(t * 1.3)) * fx;
      vec2 side = (pixel - vec2(1390.0, 320.0)) / vec2(55.0, 80.0);
      part.rgb += vec3(0.20, 0.32, 0.45) * exp(-dot(side, side)) * glow() * 0.6 * fx;
    } else {
      part = texture2D(ori, uv);
      // Ori cligne des yeux toutes les 5,3 s, parfois deux fois de suite. La paupière prend la
      // couleur de sa peau, prise sous l'œil, et descend en suivant l'inclinaison de l'œil.
      float beat = mod(t, 5.3), series = mod(floor(t / 5.3), 3.0);
      float close = smoothstep(1.6, 1.67, beat) * (1.0 - smoothstep(1.74, 1.86, beat))
        + step(1.5, series) * smoothstep(2.02, 2.09, beat) * (1.0 - smoothstep(2.16, 2.28, beat));
      if (close > 0.01) {
        vec3 skin = texture2D(ori, vec2(1421.0, 254.0) / SRC).rgb;
        // Seul l'œil visible cligne : le petit point sombre à droite est son nez.
        vec2 center = vec2(1424.0, 239.5);
        vec2 e = (rotateAround(pixel, center, -0.26) - center) / vec2(12.5, 8.5);
        float eye = 1.0 - smoothstep(0.9, 1.15, length(e));
        float edge = -1.1 + close * 2.3;
        float lid = 1.0 - smoothstep(edge - 0.12, edge, e.y);
        // Un trait sombre marque le bord de la paupière.
        float crease = exp(-pow((e.y - edge) / 0.12, 2.0)) * step(0.15, close) * 0.35;
        vec3 lidColor = skin * (0.92 + 0.08 * e.y) - crease;
        part.rgb = mix(part.rgb, lidColor, eye * max(lid, crease * 2.0));
      }
      // Ori rayonne doucement.
      part.rgb += vec3(0.06, 0.10, 0.14) * glow() * part.a * fx;
    }
    gl_FragColor = part;
  }`;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image introuvable ' + src));
      image.src = src;
    });
  }

  /**
   * Monte une carte sur un canvas. Le niveau vient du `data-level` de son parent, ou de l'appelant.
   * Renvoie de quoi l'arrêter : la boucle s'interrompt et le contexte WebGL est rendu.
   */
  function setup(canvas, images, level = Number(canvas.parentElement.dataset.level)) {
    let alive = true;
    let observer;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL indisponible');
    const shader = (type, source) => {
      const compiled = gl.createShader(type);
      gl.shaderSource(compiled, source);
      gl.compileShader(compiled);
      if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(compiled));
      return compiled;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // Maillage sur tout le hero, une maille de 12 px environ.
    const vertices = [];
    const indices = [];
    const columns = 160,
      rows = 52;
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) vertices.push((x / columns) * 2 - 1, 1 - (y / rows) * 2);
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const top = y * (columns + 1) + x;
        const bottom = top + columns + 1;
        indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
      }
    }
    const mesh = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    const bind = (buffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    };
    const textures =
      level < 2
        ? { background: images.original }
        : {
            background: images.background,
            depth: images.depth,
            branch: images.branch,
            ku: images.ku,
            ori: images.ori,
            front: images.front,
          };
    Object.entries(textures).forEach(([name, image], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    });
    const time = gl.getUniformLocation(program, 't');
    const cameraTime = gl.getUniformLocation(program, 'tc');
    gl.uniform1f(gl.getUniformLocation(program, 'fx'), level >= 3 ? 1 : 0);
    const pass = gl.getUniformLocation(program, 'pass');
    const camera = gl.getUniformLocation(program, 'look');
    gl.uniform1f(gl.getUniformLocation(program, 'level'), level);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const look = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const card = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
    const external = card.hasAttribute('data-card-motion');
    const grid = Boolean(canvas.closest('[data-card-quality="grid"]'));
    const closeUp = Boolean(canvas.closest('[data-card-quality="close-up"]'));
    const resolutionLimit = closeUp ? 2.5 : grid ? 1.5 : 2;
    let needsDraw = true;
    let lastDrawn = 0;
    const onMotion = (event) => {
      needsDraw = true;
      look.x = look.targetX = event.detail.x;
      look.y = look.targetY = event.detail.y;
    };
    const onMove = (event) => {
      const box = card.getBoundingClientRect();
      look.targetX = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
      look.targetY = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
    };
    const onLeave = () => {
      look.targetX = 0;
      look.targetY = 0;
    };
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
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      const resized = canvas.width !== width || canvas.height !== height;
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
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      look.x += (look.targetX - look.x) * 0.06;
      look.y += (look.targetY - look.y) * 0.06;
      gl.uniform1f(time, level >= 3 ? elapsed : 0);
      gl.uniform1f(cameraTime, level >= 3 ? elapsed : 0);
      gl.uniform2f(camera, look.x, look.y);
      gl.uniform1f(pass, 0);
      bind(quad);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (level >= 2) {
        gl.enable(gl.BLEND);
        bind(mesh);
        for (let part = 1; part <= 3; part++) {
          gl.uniform1f(pass, part);
          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        }
        bind(quad);
        // Les lueurs, braises et la vignette sont des effets : seulement en ×3.
        for (let part = 4; part <= (level >= 3 ? 6 : 4); part++) {
          gl.uniform1f(pass, part);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        if (alive) requestAnimationFrame(frame);
      }
    };
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

  const sources = {
    original: 'full.jpg',
    background: 'bg.jpg',
    depth: 'depth.png',
    branch: 'branch.png',
    ku: 'ku.png',
    ori: 'ori.png',
    front: 'front.png',
  };
  let loading;
  const loadImages = () =>
    (loading ??= Promise.all(
      Object.entries(sources).map(async ([name, src]) => [
        name,
        await loadImage(new URL(src, ASSETS)),
      ]),
    ).then(Object.fromEntries));

  // Une autre page peut monter la carte elle-même : l'ouverture d'un booster la montre en grand.
  (window.AchieversCards ??= {})['ori'] = {
    async mount(canvas, level = 3) {
      return setup(canvas, await loadImages(), level);
    },
  };

  const canvases = document.querySelectorAll('.card[data-game="ori"] canvas');
  if (canvases.length)
    loadImages()
      .then((images) => {
        for (const canvas of canvases) setup(canvas, images);
      })
      .catch((error) => {
        console.error(error);
        if (button) button.disabled = true;
        const status = document.getElementById('status');
        if (status) status.textContent = 'L’animation est indisponible sur cet appareil.';
        canvases.forEach((canvas) => {
          const card = canvas.parentElement;
          const image = new Image();
          image.src = new URL('full.jpg', ASSETS);
          image.alt = 'Illustration Ori and the Will of the Wisps';
          card.replaceChildren(image);
        });
      });
})();
