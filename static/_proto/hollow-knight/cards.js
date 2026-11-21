// Les images sont cherchées à côté du script, pour que la carte serve depuis n'importe quelle page.
// Isolé dans une fonction : plusieurs cartes peuvent se charger sur la même page.
(() => {
  const ASSETS = new URL('.', document.currentScript.src);
  // Intro : deux coups d'aiguillon dans le noir, puis un grand coup qui déchire la scène.
  const INTRO_REVEAL = 3.5;
  const INTRO_END = 4.3;
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

  // Repère : les calques couvrent le rectangle (297, 0, 1623, 620) du hero Steam.
  // Chaque plan a une profondeur. La caméra décale et agrandit davantage les plans proches.
  // Passes : 0 décor, 1 à 5 personnage, 6 épines, 7 brume avant, 8 vignette.
  // Niveaux : ×1 l'illustration, ×2 la parallaxe seule, ×3 la parallaxe et toutes les animations.
  // tc est l'horloge de la caméra, t celle des animations. En ×2, t reste à 0 et fx vaut 0 :
  // les calques gardent les pixels d'origine et aucun effet n'est ajouté.
  const COMMON = `
  uniform float t, tc, fx, pass, intro;
  uniform vec2 look;
  const vec2 SIZE = vec2(1326.0, 620.0);
  const vec2 ORIGIN = vec2(297.0, 0.0);
  const vec2 ANCHOR = vec2(0.5, 0.18);
  // Le zoom de base laisse juste la marge que le décor parcourt. Horizontalement, le
  // point fixe est dans le décor : les plans proches traversent le cadre. Verticalement,
  // il est sur le personnage, qui reste presque fixe pour garder les cornes, tandis que
  // le décor et les épines partent en sens opposés.
  const float BASE = 1.045;
  const vec2 FOCUS = vec2(0.12, 0.50);
  const float HERO = 0.55;
  const float THORNS = 1.9;
  const float BG_DEPTH = 0.3;
  const vec2 PARALLAX = vec2(0.066, 0.040);
  // Le décor est agrandi de 3 % depuis le bas du cadre pour gagner la marge verticale
  // en haut. Le socle, posé en bas, reste aligné ; plus haut le décor est reconstruit.
  const float BG_LIFT = 1.03;
  vec2 camera() {
    return look + vec2(sin(tc * 0.23) + 0.4 * sin(tc * 0.51 + 1.3),
      0.8 * cos(tc * 0.17) + 0.3 * sin(tc * 0.43)) * 0.45;
  }
  float dolly() { return 0.5 - 0.5 * cos(tc * 0.21); }
  float layerScale(float depth) { return BASE * (1.0 + dolly() * 0.016 * depth); }
  vec2 layerOffset(float depth) { return camera() * (vec2(depth) - FOCUS) * PARALLAX; }
  vec2 toScreen(vec2 q, float depth) { return (q - ANCHOR) * layerScale(depth) + ANCHOR + layerOffset(depth); }
  vec2 toLayer(vec2 s, float depth) { return (s - ANCHOR - layerOffset(depth)) / layerScale(depth) + ANCHOR; }
  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    vec2 delta = point - pivot;
    float c = cos(angle), s = sin(angle);
    return pivot + vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  }
  // Rafales de vent partagées par la cape et les poussières.
  float gust() { return 0.75 + 0.45 * sin(t * 0.37) * sin(t * 0.23 + 1.0); }
  const float NAIL_CYCLE = 8.8;
  float poseAccent(float start, float peak, float hold, float end) {
    float phase = mod(t, NAIL_CYCLE);
    return smoothstep(start, peak, phase) * (1.0 - smoothstep(hold, end, phase));
  }
  float nailAngle() {
    float lift = poseAccent(1.16, 1.92, 2.52, 3.6);
    return -0.205 * lift + 0.02 * sin(t * 1.48 + 0.4);
  }`;

  const VERT = `
  attribute vec2 position;
  varying vec2 uv;
  ${COMMON}
  vec2 introCamera(vec2 screen) {
    if (intro < 0.0) return screen;
    // Léger recul pendant que la déchirure s'ouvre.
    float zoom = mix(1.12, 1.0, smoothstep(2.4, 4.0, intro));
    return (screen - vec2(0.5)) * zoom + 0.5;
  }
  void main() {
    uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
    if (pass > 8.5) {
      // Calques de l'intro, fixés à l'écran.
      gl_Position = vec4(position, 0.0, 1.0);
      return;
    }
    if (pass < 0.5 || (pass > 5.5 && pass < 8.5)) {
      vec2 framed = introCamera(uv);
      gl_Position = vec4(framed.x * 2.0 - 1.0, 1.0 - framed.y * 2.0, 0.0, 1.0);
      return;
    }
    vec2 point = uv * SIZE + ORIGIN;
    vec2 rest = point;
    float breath = 0.5 - 0.5 * cos(t * 1.48);
    float brace = poseAccent(0.72, 1.44, 2.42, 3.55);
    float release = poseAccent(2.58, 3.18, 3.34, 4.18);
    if (pass > 2.5 && pass < 3.5) {
      // Le masque suit la respiration avec retard et se tourne vers le pointeur.
      float alert = poseAccent(0.2, 0.85, 1.86, 3.3);
      float tilt = 0.025 * sin(t * 0.82 - 0.6) + look.x * 0.028 + 0.135 * alert - 0.047 * release;
      if (intro >= 0.0) tilt += 0.10 * (1.0 - smoothstep(2.8, 3.8, intro));
      point = rotateAround(point, vec2(861.0, 323.0), tilt);
      point.y -= breath * 1.6 + look.y * 2.5;
    }
    if (pass > 1.5 && pass < 2.5) {
      // La main est sous la cape. La lame tourne autour de cette attache.
      float angle = nailAngle();
      point = rotateAround(point, vec2(1085.0, 465.0), angle);
    }
    if (pass > 3.5 && pass < 4.5) {
      // Le vent augmente vers les pans libres et souffle par rafales. Le col reste attaché au cou.
      float wind = gust();
      float trailing = smoothstep(860.0, 1180.0, point.x);
      float fringe = smoothstep(385.0, 540.0, point.y);
      point.y += sin(t * 1.9 - point.x * 0.018) * 8.5 * trailing * wind;
      point.x += sin(t * 1.4 - point.y * 0.024) * 5.2 * max(trailing, fringe * 0.60) * wind;
      point.y += sin(t * 2.15 - point.x * 0.028) * 3.0 * fringe * wind;
      point.x += sin(t * 3.1 - point.y * 0.05) * 1.4 * trailing * fringe * wind;
      point.y -= 8.0 * trailing * release;
    }
    if (pass < 4.5) {
      // Toute la silhouette prend appui ensemble. Les pattes amortissent
      // près du sol, et le masque et l'aiguillon gardent leurs proportions.
      float upper = pass < 1.5 ? 1.0 - smoothstep(475.0, 585.0, rest.y) : 1.0;
      vec2 stance = vec2(-15.0 * brace + 4.0 * release, 15.0 * brace - 4.0 * release);
      point += upper * (stance + vec2(sin(t * 0.72) * 2.2, -5.5 * breath));
    }
    point = mix(rest, point, fx);
    vec2 q = introCamera(toScreen((point - ORIGIN) / SIZE, HERO));
    gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
  }`;

  const FRAG = `
  precision highp float;
  varying vec2 uv;
  uniform float level;
  uniform sampler2D background, depth, legs, nail, head, cloak, platform, thorns;
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

  // Poussières lumineuses. Les plus proches sont plus grosses, plus floues et plus rapides.
  vec3 motes(vec2 point, float near, int count) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      if (i >= count) break;
      float seed = float(i) + near * 13.0;
      float h = fract(sin(seed * 127.1 + 18.7) * 43758.54);
      float g = fract(sin(seed * 311.7 + 4.1) * 24634.63);
      float age = fract(t * (0.030 + h * 0.016) * mix(1.0, 1.6, near) + h);
      vec2 center = vec2(0.06 + h * 0.88 + sin(t * 0.24 + seed * 4.0) * 0.022 + age * (0.07 * gust() - 0.035),
        mix(1.06, -0.08, age));
      vec2 delta = (point - center) * SIZE;
      float radius = mix(0.8, 2.3, g) * mix(1.0, 2.6, near);
      float fade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.82, 1.0, age));
      float twinkle = 0.65 + 0.35 * sin(t * (1.3 + g * 2.0) + seed);
      float d2 = dot(delta, delta);
      float core = exp(-d2 / (radius * radius));
      float glow = exp(-d2 / (radius * radius * 16.0));
      light += vec3(0.55, 0.80, 1.0) * (core * mix(0.62, 0.35, near) + glow * 0.11) * fade * twinkle;
    }
    return light;
  }

  // Ondulation d'un membre ancré à sa racine : une onde part de la racine vers les pointes.
  // Le déplacement est surtout perpendiculaire au membre et grandit avec la distance.
  vec2 limb(vec2 p, vec2 root, vec2 extent, float speed, float waves, float amount, float seed) {
    vec2 r = (p - root) / extent;
    float reach = length(r);
    float weight = smoothstep(0.12, 0.85, reach) * (1.0 - smoothstep(0.95, 1.4, reach));
    vec2 radial = r / max(reach, 0.001);
    vec2 across = vec2(-radial.y, radial.x);
    float phase = t * speed - reach * waves + seed;
    float sway = sin(phase) + 0.35 * sin(phase * 1.9 + p.x * 0.01 + seed);
    return weight * amount * (across * sway + radial * 0.3 * sin(phase * 0.7 + 1.0));
  }

  // Tentacules du décor : la créature en haut à droite, celle de gauche et les branches
  // en haut à gauche. Les valeurs sont en pixels du repère de la carte.
  vec2 tentacles(vec2 p) {
    return limb(p, vec2(1340.0, -30.0), vec2(560.0, 320.0), 1.05, 6.5, 9.0, 0.0)
      + limb(p, vec2(-20.0, 280.0), vec2(220.0, 240.0), 0.80, 5.0, 6.0, 2.1)
      + limb(p, vec2(30.0, -40.0), vec2(320.0, 220.0), 0.65, 4.0, 6.5, 4.3);
  }

  // Rayons de lumière venus du haut du cadre, qui ondulent lentement.
  float rays(vec2 q) {
    vec2 source = vec2(0.35 + 0.018 * sin(t * 0.43), -0.34);
    vec2 dir = (q - source) * vec2(SIZE.x / SIZE.y, 1.0);
    float angle = atan(dir.x, dir.y);
    float shafts = 0.0;
    for (int i = 0; i < 5; i++) {
      float index = float(i);
      float axis = -0.13 + 0.151 * index + 0.035 * sin(t * 0.49 + index * 1.2);
      float band = (angle - axis) / (0.034 + 0.009 * mod(index, 3.0));
      shafts += exp(-band * band) * (0.74 + 0.26 * sin(t * 0.72 + index));
    }
    float reach = 1.0 - smoothstep(0.30, 1.3, length(dir));
    return shafts * reach;
  }

  float rayDust(vec2 q) {
    float dust = 0.0;
    for (int i = 0; i < 13; i++) {
      float index = float(i);
      float seed = hash(vec2(index, 7.0));
      float drift = hash(vec2(index, 19.0));
      float age = fract(t * (0.054 + 0.04 * drift) + seed);
      float y = mix(-0.04, 0.82, age);
      vec2 center = vec2(0.35 + y * 0.13 + (drift - 0.5) * 0.46
        + 0.022 * sin(t * 0.73 + index), y);
      vec2 delta = (q - center) * SIZE;
      float radius = mix(1.4, 3.5, drift);
      float distance = dot(delta, delta) / (radius * radius);
      float life = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.76, 1.0, age));
      dust += (exp(-distance) + 0.15 * exp(-distance * 0.15)) * life;
    }
    return dust;
  }

  vec3 voidFilaments(vec3 color, vec2 point, float resonance) {
    for (int i = 0; i < 3; i++) {
      float index = float(i);
      float root = i == 0 ? 380.0 : (i == 1 ? 785.0 : 966.0);
      float height = (245.0 + 38.0 * index) + 62.0 * resonance;
      float reach = (614.0 - point.y) / height;
      float u = clamp(reach, 0.0, 1.0);
      float curl = sin(u * 5.4 + index * 1.3 - t * (0.63 + index * 0.14));
      float lean = i == 0 ? -135.0 : 92.0 + 25.0 * index;
      float spine = root + u * lean * (1.0 - 0.23 * resonance) + curl * u * (35.0 + index * 9.0);
      float width = mix(26.0 - index * 4.0, 1.2, u);
      float distance = abs(point.x - spine);
      float coverage = (1.0 - smoothstep(width * 0.65, width + 2.5, distance))
        * smoothstep(0.0, 0.08, reach) * (1.0 - smoothstep(0.90, 1.0, reach));
      color = mix(color, vec3(0.018), coverage * (0.67 + 0.18 * resonance));
    }
    return color;
  }

  // Croissant d'un coup d'aiguillon : arc de cercle effilé aux deux bouts, dont la tête
  // balaie l'arc de a0 vers a1 et laisse une traîne qui s'éteint.
  float slash(vec2 p, vec2 c, float r, float a0, float a1, float w, float start, float duration) {
    float k = (intro - start) / duration;
    if (k <= 0.0 || k > 2.2) return 0.0;
    vec2 d = p - c;
    float s = (atan(d.y, d.x) - a0) / (a1 - a0);
    if (s < 0.0 || s > 1.0) return 0.0;
    float head = k * 1.4;
    float trail = smoothstep(head - 0.9, head - 0.15, s) * (1.0 - smoothstep(head - 0.07, head + 0.02, s));
    float width = w * pow(sin(3.14159265 * s), 0.7) * (0.55 + 0.45 * trail);
    float band = 1.0 - smoothstep(width * 0.3, width * 0.5, abs(length(d) - r));
    return band * trail * (1.0 - smoothstep(1.0, 2.2, k));
  }
  float slashes(vec2 p, float spread) {
    return slash(p, vec2(560.0, 560.0), 300.0, -2.6, -0.85, 44.0 * spread, 0.4, 0.2)
      + slash(p, vec2(800.0, 90.0), 330.0, 2.55, 0.55, 48.0 * spread, 1.1, 0.2)
      + slash(p, vec2(640.0, 720.0), 380.0, -2.45, -0.6, 52.0 * spread, 1.8, 0.2);
  }
  float bigSlash(vec2 p, float spread) {
    return slash(p, vec2(420.0, -380.0), 900.0, 2.25, 0.72, 78.0 * spread, 2.4, 0.22);
  }
  // Distance à l'arc du grand coup, bord irrégulier compris, et ouverture de la déchirure.
  float tearDistance(vec2 p) {
    return abs(length(p - vec2(420.0, -380.0)) - 900.0)
      + 110.0 * (fbm(p * 0.011 + vec2(intro * 0.6, 0.0)) - 0.5);
  }
  float tearOpen() { return 1200.0 * pow(smoothstep(2.48, 3.55, intro), 1.4); }

  void main() {
    if (pass > 8.5) {
      vec2 p = uv * SIZE;
      if (pass < 9.5) {
        // Noir de l'intro : les premiers coups laissent entrevoir la scène, le grand l'ouvre.
        float view = clamp(slashes(p, 1.6) * 0.5, 0.0, 0.6);
        float open = tearOpen();
        float tear = open > 0.0 ? 1.0 - smoothstep(open - 30.0, open + 30.0, tearDistance(p)) : 0.0;
        float dark = (1.0 - view) * (1.0 - tear) * (1.0 - smoothstep(3.5, 3.85, intro));
        gl_FragColor = vec4(0.0, 0.004, 0.01, dark);
        return;
      }
      // Lumière ajoutée : croissants blancs, éclair du grand coup et lisière de la déchirure.
      float cut = slashes(p, 1.0) + bigSlash(p, 1.0);
      float bloom = slashes(p, 3.0) + bigSlash(p, 3.0);
      float open = tearOpen();
      float edge = open > 0.0
        ? exp(-pow((tearDistance(p) - open) / 12.0, 2.0)) * (1.0 - smoothstep(2.85, 3.45, intro))
        : 0.0;
      float flash = smoothstep(2.42, 2.46, intro) * (1.0 - smoothstep(2.46, 2.82, intro));
      vec3 light = vec3(0.97, 0.99, 1.0) * cut * 1.2 + vec3(0.55, 0.72, 0.9) * bloom * 0.28
        + vec3(0.72, 0.86, 1.0) * edge * 0.45
        + vec3(0.40, 0.52, 0.62) * flash * exp(-pow(tearDistance(p) / 160.0, 2.0)) * 0.6;
      gl_FragColor = vec4(light, 1.0);
      return;
    }
    if (level < 2.0) {
      gl_FragColor = texture2D(background, uv);
      return;
    }
    if (pass < 0.5) {
      // Décor : la profondeur lissée décale les créatures plus que la lumière du fond.
      vec2 guess = toLayer(uv, BG_DEPTH * 0.5);
      guess = vec2(0.5, 1.0) + (guess - vec2(0.5, 1.0)) / BG_LIFT;
      float d = texture2D(depth, clamp(guess, 0.001, 0.999)).r * BG_DEPTH;
      vec2 q = toLayer(uv, d);
      q = vec2(0.5, 1.0) + (q - vec2(0.5, 1.0)) / BG_LIFT;
      q = clamp(q - tentacles(q * SIZE) / SIZE * fx, 0.001, 0.999);
      vec3 color = texture2D(background, q).rgb;
      float shafts = rays(q);
      float bright = smoothstep(0.30, 0.80, dot(color, vec3(0.299, 0.587, 0.114)));
      float pulse = 0.82 + 0.18 * sin(t * 0.41) * sin(t * 0.27 + 2.0);
      color += vec3(0.80, 0.90, 1.0) * shafts * bright * 0.16 * pulse * fx;
      // Brume lointaine qui glisse entre les plans.
      float mist = fbm(q * vec2(3.2, 7.0) + vec2(t * 0.035, -t * 0.008));
      color = mix(color, vec3(0.62, 0.70, 0.76),
        smoothstep(0.48, 0.85, mist) * smoothstep(0.25, 0.95, q.y) * 0.20 * fx);
      color += motes(toLayer(uv, 0.15), 0.0, 10) * 0.9 * fx;
      // Le contre-jour reste en place et se renforce avec la prise de garde.
      float resonance = poseAccent(1.05, 1.92, 2.32, 3.65) * fx;
      resonance += smoothstep(2.55, 3.1, intro) * (1.0 - smoothstep(3.1, 4.0, intro)) * 0.55;
      vec2 halo = (q * SIZE - vec2(594.0, 267.0)) / vec2(330.0, 264.0);
      float luminance = 0.62 + 0.14 * sin(t * 0.8) + 0.24 * resonance;
      color += vec3(0.23, 0.39, 0.52) * exp(-dot(halo, halo) * 1.55) * luminance * fx;
      color += vec3(0.45, 0.60, 0.73) * shafts * (0.33 * fx + resonance * 0.24);
      if (fx > 0.0) {
        color = voidFilaments(color, q * SIZE, resonance);
        color += vec3(0.69, 0.85, 1.0) * rayDust(q) * (0.14 + 0.78 * shafts);
      }
      color += motes(toLayer(uv, 0.25), 0.36, 10) * (0.30 * fx + resonance * 0.65);
      // Les deux lucioles peintes dans le décor pulsent chacune à son rythme.
      for (int i = 0; i < 2; i++) {
        vec2 fly = i == 0 ? vec2(890.0, 105.0) : vec2(425.0, 350.0);
        float beat = i == 0 ? sin(t * 1.7) * 0.5 + 0.5 : sin(t * 1.3 + 2.0) * 0.5 + 0.5;
        beat = pow(beat, 3.0);
        vec2 delta = q * SIZE - fly;
        float d2 = dot(delta, delta);
        color += vec3(0.62, 0.86, 1.0) * (exp(-d2 / 260.0) * 0.30 + exp(-d2 / 2600.0) * 0.10) * beat * fx;
      }
      gl_FragColor = vec4(color, 1.0);
      return;
    }
    if (pass > 5.5 && pass < 6.5) {
      // Épines du premier plan : parallaxe forte, balancement autour de la base, léger flou.
      // Chaque épine ondule aussi : une vague part de la base et grandit vers la pointe.
      vec2 left = rotateAround(toLayer(uv, THORNS) * SIZE, vec2(300.0, 660.0),
        -0.055 * sin(t * 0.61 + 0.5) * fx);
      left = (left - limb(left, vec2(300.0, 660.0), vec2(260.0, 260.0), 1.0, 4.5, 24.0, 0.7) * fx) / SIZE;
      // L'épine de droite est coupée par le bord du cadre. Elle recule peu vers la gauche,
      // pour que sa coupe ne rentre pas dans la carte. Le reste du décalage devient un
      // grossissement depuis le coin inférieur droit.
      vec2 shift = layerOffset(THORNS);
      float spill = min(shift.x + 0.010, 0.0);
      vec2 right = (uv - ANCHOR - vec2(max(shift.x, -0.010), shift.y)) / layerScale(THORNS) + ANCHOR;
      right = 1.0 + (right - 1.0) / (1.0 - spill * 1.5);
      right = rotateAround(right * SIZE, vec2(1340.0, 660.0), -0.040 * sin(t * 0.47 + 1.7) * fx);
      right = (right - limb(right, vec2(1340.0, 660.0), vec2(500.0, 500.0), 0.85, 5.0, 34.0, 3.4) * fx) / SIZE;
      vec2 px = 1.6 / SIZE;
      float a = 0.0;
      for (int side = 0; side < 2; side++) {
        vec2 q = side == 0 ? left : right;
        float own = side == 0 ? step(q.x, 0.5) : step(0.5, q.x);
        float sampleA = texture2D(thorns, q).a * 0.4
          + (texture2D(thorns, q + vec2(px.x, 0.0)).a + texture2D(thorns, q - vec2(px.x, 0.0)).a
          + texture2D(thorns, q + vec2(0.0, px.y)).a + texture2D(thorns, q - vec2(0.0, px.y)).a) * 0.15;
        a = max(a, sampleA * own);
      }
      gl_FragColor = vec4(0.008, 0.016, 0.030, a);
      return;
    }
    if (pass > 6.5 && pass < 7.5) {
      // Brume et poussières devant le personnage.
      vec2 q = toLayer(uv, 1.2);
      float mist = fbm(q * vec2(2.2, 4.5) + vec2(-t * 0.06, t * 0.01));
      float m = smoothstep(0.50, 0.90, mist) * smoothstep(0.55, 1.0, q.y) * 0.22;
      vec3 light = motes(toLayer(uv, 1.3), 1.0, 12) * 0.75;
      float glow = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
      float alpha = clamp(m + glow, 0.0, 1.0);
      vec3 color = (vec3(0.60, 0.68, 0.74) * m + light) / max(alpha, 0.001);
      gl_FragColor = vec4(color, alpha);
      return;
    }
    if (pass > 7.5) {
      // Vignette qui respire avec la lumière.
      vec2 c = (uv - vec2(0.48, 0.42)) * vec2(1.0, 1.6);
      float v = smoothstep(0.45, 1.15, length(c)) * (0.42 + 0.06 * sin(t * 0.41));
      gl_FragColor = vec4(0.0, 0.01, 0.02, v);
      return;
    }
    vec4 part;
    if (pass < 1.5) part = texture2D(legs, uv);
    else if (pass < 2.5) part = texture2D(nail, uv);
    else if (pass < 3.5) part = texture2D(head, uv);
    else if (pass < 4.5) part = texture2D(cloak, uv);
    else part = texture2D(platform, uv);

    vec2 pixel = uv * SIZE + ORIGIN;
    if (pass > 1.5 && pass < 2.5) {
      // Le contour polygonal de l'aiguillon a gardé un liseré du décor d'origine, visible
      // quand la lame bouge. Près du bord, les pixels proches du décor reconstruit sont effacés.
      vec2 e = 3.0 / SIZE;
      float inner = min(min(texture2D(nail, uv + vec2(e.x, 0.0)).a, texture2D(nail, uv - vec2(e.x, 0.0)).a),
        min(texture2D(nail, uv + vec2(0.0, e.y)).a, texture2D(nail, uv - vec2(0.0, e.y)).a));
      float behind = length(part.rgb - texture2D(background, uv).rgb);
      part.a *= mix(smoothstep(0.04, 0.12, behind), 1.0, smoothstep(0.6, 1.0, inner));
      float progress = clamp((mod(t, NAIL_CYCLE) - 1.65) / 0.95, 0.0, 1.0);
      float energy = pow(sin(progress * 3.14159265), 2.0);
      vec2 delta = pixel - mix(vec2(1110.0, 480.0), vec2(1380.0, 593.0), progress);
      vec2 ray = vec2(delta.x * 0.68 - delta.y * 0.73, delta.x * 0.73 + delta.y * 0.68);
      float core = exp(-dot(delta, delta) / 5.0);
      float rays = exp(-abs(ray.x) / 13.0 - abs(ray.y) / 0.50)
        + exp(-abs(ray.y) / 9.0 - abs(ray.x) / 0.50);
      float halo = exp(-dot(delta, delta) / 110.0);
      float shine = energy * (core + rays * 0.58 + halo * 0.10) * fx;
      // La lame levée vers la lumière s'éclaire ; le pointeur déplace un reflet le long du fil.
      float metal = smoothstep(0.45, 0.85, dot(part.rgb, vec3(0.333)));
      float raised = clamp(-nailAngle() / 0.205, 0.0, 1.0);
      float along = dot(pixel - vec2(1085.0, 465.0), vec2(0.938, 0.350));
      float streak = exp(-pow((along - 170.0 - look.x * 110.0) / 45.0, 2.0));
      part.rgb += vec3(0.10, 0.13, 0.16) * metal * (raised * 0.9 + streak * 0.7) * fx;
      float alpha = min(1.0, part.a + shine);
      part = vec4((part.rgb * part.a + vec3(0.68, 0.88, 1.0) * shine)
        / max(alpha, 0.001), alpha);
    }
    if (pass > 2.5 && pass < 3.5) {
      float beat = mod(t, 11.3);
      float light = smoothstep(6.5, 7.15, beat) * (1.0 - smoothstep(7.4, 8.6, beat));
      vec2 delta = (pixel - vec2(760.0, 255.0)) / vec2(105.0, 115.0);
      float rim = exp(-dot(delta, delta)) * smoothstep(0.35, 0.85, part.r);
      part.rgb += vec3(0.035, 0.080, 0.12) * light * rim * fx;
      // Reflet doux sur le masque, qui glisse avec le pointeur.
      vec2 sheen = (pixel - vec2(797.0, 150.0) - look * vec2(30.0, 18.0)) / vec2(70.0, 55.0);
      part.rgb += vec3(0.05, 0.06, 0.07) * exp(-dot(sheen, sheen)) * smoothstep(0.55, 0.9, part.r) * fx;
      // Lueur humide au fond des yeux, décalée vers la lumière et le pointeur.
      float dark = 1.0 - smoothstep(0.08, 0.22, dot(part.rgb, vec3(0.333)));
      for (int i = 0; i < 2; i++) {
        vec2 eye = i == 0 ? vec2(762.0, 215.0) : vec2(872.0, 183.0);
        vec2 g = (pixel - eye - vec2(-7.0, -16.0) - look * vec2(5.0, 4.0)) / vec2(6.0, 9.0);
        float glint = exp(-dot(g, g)) * (0.75 + 0.25 * sin(t * 0.9 + float(i)));
        part.rgb += vec3(0.30, 0.42, 0.52) * glint * dark * fx;
      }
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
    const vertices = [];
    const indices = [];
    const columns = 120,
      rows = 60;
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
    // La carte ×1 affiche l'illustration d'origine. La carte ×3 utilise huit textures,
    // le minimum garanti par WebGL 1.
    const textures =
      level < 2
        ? { background: images.original }
        : {
            background: images.background,
            depth: images.depth,
            legs: images.legs,
            nail: images.nail,
            head: images.head,
            cloak: images.cloak,
            platform: images.platform,
            thorns: images.thorns,
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
    const introTime = gl.getUniformLocation(program, 'intro');
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
    let intro = -1;
    let introRequested = false;
    const onReplay = (event) => {
      elapsed = 0;
      if (level >= 3 && event.detail?.intro && !motionQuery.matches) intro = 0;
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
      const requested =
        level >= 3 && !motionQuery.matches && Boolean(canvas.closest('[data-card-intro]'));
      if (requested && !introRequested) intro = elapsed = 0;
      introRequested = requested;
      if (motionQuery.matches) intro = -1;
      // data-card-intro-time fige l'intro à un instant donné pour la vérifier image par image.
      const forcedIntro =
        level >= 3 && !motionQuery.matches ? canvas.dataset.cardIntroTime : undefined;
      if (forcedIntro !== undefined) {
        intro = Number(forcedIntro);
        elapsed = Math.max(0, intro);
        needsDraw = true;
      }
      const delta = !paused && !document.hidden ? Math.min((now - lastTime) / 1000, 0.1) : 0;
      elapsed += delta;
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
      gl.uniform1f(introTime, intro);
      gl.uniform1f(cameraTime, level >= 3 ? elapsed : 0);
      gl.uniform2f(camera, look.x, look.y);
      gl.uniform1f(pass, 0);
      bind(quad);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (level >= 2) {
        gl.enable(gl.BLEND);
        bind(mesh);
        for (let part = 1; part <= 5; part++) {
          gl.uniform1f(pass, part);
          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        }
        bind(quad);
        // La brume avant et la vignette sont des effets : seulement en ×3.
        for (let part = 6; part <= (level >= 3 ? 8 : 6); part++) {
          gl.uniform1f(pass, part);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        if (intro >= 0 && level >= 3) {
          gl.uniform1f(pass, 9);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.uniform1f(pass, 10);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA,
          );
        }
        if (intro >= 0 && forcedIntro === undefined) {
          const previous = intro;
          intro += delta;
          if (requested && previous < INTRO_REVEAL && intro >= INTRO_REVEAL) {
            canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
          }
          if (intro >= INTRO_END) intro = -1;
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
    background: 'bg-far.jpg',
    depth: 'bg-depth.png',
    legs: 'legs.png',
    nail: 'nail.png',
    head: 'head.png',
    cloak: 'cloak.png',
    platform: 'platform.png',
    thorns: 'thorns.png',
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
  (window.AchieversCards ??= {})['hollow-knight'] = {
    async mount(canvas, level = 3) {
      return setup(canvas, await loadImages(), level);
    },
  };

  const canvases = document.querySelectorAll('.card[data-game="hollow-knight"] canvas');
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
          image.alt = 'Illustration Hollow Knight';
          card.replaceChildren(image);
        });
      });
})();
