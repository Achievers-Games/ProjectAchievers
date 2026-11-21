(() => {
  const assets = new URL('.', document.currentScript.src);
  const image = async (file) => {
    const artwork = new Image();
    artwork.src = new URL(file, assets);
    await artwork.decode();
    return artwork;
  };
  let loaded;

  // Repère des calques : source réduite (voir prepare-art.py), 1840 × 1034 px.
  // La carte montre la fenêtre de 1840 × 860 px qui débute à (0, 57.5).
  const SIZE = [1840, 1034];
  const CENTER = [920, 487.5];
  const PERIOD = 7.6;
  // Intro : Zagreus remonte du bassin du Styx ; le titre arrive quand le sang s'est retiré.
  const INTRO_REVEAL = 3.95;
  const INTRO_END = 5.0;
  // Os de la marionnette, dans l'ordre des indices transmis au vertex shader. La racine
  // (jambes, bassin) reste immobile et n'a pas d'indice : c'est le reste des poids.
  const BONES = ['chest', 'head', 'upperArm', 'forearm', 'hand', 'sword', 'hipArm', 'hipForearm'];
  const STEP = 8;

  const common = `
    precision highp float;
    uniform vec2 windowSize, pointer;
    uniform float t, fx, gesture, phase, intro;
    const vec2 SIZE = vec2(1840.0, 1034.0);
    const vec2 CENTER = vec2(920.0, 487.5);
    const float FIX = 0.6;

    float hash(float seed) { return fract(sin(seed * 127.1) * 43758.5453); }

    // Intro du Styx : la scène est rendue entière ; le bassin de sang la couvre dans la passe finale.
    const float STYX_DRAIN = 2.3;
    const float STYX_DRAIN_END = 3.9;
    float revealAmount() { return 1.0; }
    // La couronne s'embrase quand Zagreus a fini de sortir du bassin.
    float revealPulse() {
      return intro < 0.0 ? 0.0 : smoothstep(3.75, 3.9, intro) * (1.0 - smoothstep(3.9, 4.7, intro));
    }

    vec2 turn(vec2 v, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    }

    // Décalage de parallaxe : le point fixe est sur Zagreus, le décor part à l'opposé.
    vec2 parallax(float depth) { return pointer * vec2(72.0, 35.0) * (FIX - depth); }

    float glow(vec2 point, vec2 center, float size) {
      return exp(-length(point - center) / size);
    }

    // Feuilles de laurier dorées emportées par le courant chaud des Enfers.
    vec3 leaves(vec3 color, vec2 point, float near) {
      for (int i = 0; i < 6; i++) {
        float seed = float(i) + 1.0 + near * 9.0;
        float age = fract(t * mix(0.06, 0.11, near) * (0.75 + hash(seed)) + hash(seed + 2.0));
        vec2 center = vec2(mix(1700.0, 150.0, age) + hash(seed + 5.0) * 300.0,
                           mix(980.0, 40.0, age) - hash(seed + 9.0) * 260.0);
        center.x += sin(age * 7.0 + seed) * mix(40.0, 70.0, near);
        vec2 offset = point - center;
        float roll = age * 11.0 + seed;
        vec2 shape = turn(offset, -(0.6 + 0.5 * sin(roll)));
        float size = mix(6.0, 12.0, near) * (0.7 + hash(seed + 7.0) * 0.6);
        shape /= vec2(size, size * (0.22 + abs(cos(roll)) * 0.3));
        float form = abs(shape.x) + abs(shape.y + 0.18 * shape.x * shape.x) * 0.9;
        float edge = 1.0 - smoothstep(0.72, 1.06, form);
        float fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.86, 1.0, age));
        vec3 tint = mix(vec3(0.95, 0.36, 0.10), vec3(1.0, 0.80, 0.22), abs(cos(roll)));
        color = mix(color, tint, edge * fade * fx * mix(0.55, 0.85, near));
      }
      return color;
    }

    vec3 embers(vec3 color, vec2 point, float near, float burst) {
      for (int i = 0; i < 12; i++) {
        float seed = float(i) + near * 20.0;
        float age = fract(t * (0.07 + hash(seed) * 0.05) + hash(seed + 3.0));
        vec2 spark = vec2(80.0 + hash(seed + 1.0) * 1680.0 + sin(age * 6.0 + seed) * 30.0,
                          1060.0 - age * 1050.0);
        float fade = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.6, 1.0, age));
        float size = mix(1.6, 3.2, near) * (1.0 + burst * 0.6);
        color += vec3(1.0, 0.48, 0.16) * exp(-length(point - spark) / size)
          * fade * fx * (0.55 + burst * 0.8);
      }
      return color;
    }
  `;

  const quad = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = position * vec2(0.5, -0.5) + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  // Passe 1 : décor et spectres de Cerbère et d'Hadès, déformés par zones.
  const backdropFragment = `${common}
    varying vec2 uv;
    uniform sampler2D backdrop, backgroundHeads, lowHead, earLeft, earRight, backgroundDetails;
    const vec2 CERBERUS = vec2(612.0, 562.0);
    const vec2 HADES = vec2(1270.0, 642.0);

    // Spectre peint dans le décor : il respire autour de son centre et se rapproche
    // davantage que le dégradé. Le raccord avec le fond reste continu.
    vec2 ghost(vec2 point, vec2 center, vec2 radius, float cycle, float swell) {
      float influence = 1.0 - smoothstep(0.55, 1.15, length((point - center) / radius));
      float breath = (0.010 + 0.012 * swell) * sin(cycle) * fx;
      return ((point - center) * breath - pointer * vec2(16.0, 8.0)) * influence;
    }

    float zone(vec2 point, vec2 center, vec2 radius) {
      return 1.0 - smoothstep(0.55, 1.0, length((point - center) / radius));
    }

    // Rotation d'une partie du décor autour de son attache, effacée vers le bord de la zone.
    vec2 swivel(vec2 point, vec2 pivot, vec2 center, vec2 radius, float angle) {
      return pivot + turn(point - pivot, angle * zone(point, center, radius));
    }

    vec2 earPose(vec2 point, vec2 pivot, float angle) {
      vec2 offset = point - pivot;
      // Rotation constante de la pointe au milieu de l'oreille. La transition
      // souple reste dans les derniers pixels au-dessus de l'attache.
      float root = smoothstep(0.0, 24.0, -offset.y);
      return point + (turn(offset, angle) - offset) * root;
    }

    float reaction(float time, float start, float peak, float hold, float end) {
      return smoothstep(start, peak, time) * (1.0 - smoothstep(hold, end, time));
    }

    float breathCycle(float period, float offset) {
      float phase = fract((t + offset) / period);
      return reaction(phase, 0.0, 0.32, 0.38, 0.96) * fx;
    }

    void main() {
      vec2 point = (uv - 0.5) * windowSize + CENTER;
      vec2 far = point - parallax(0.1);
      far.x += sin(far.y / 47.0 - t * 1.7) * 1.6 * fx * (1.0 - smoothstep(300.0, 1000.0, far.y));
      far += ghost(far, CERBERUS, vec2(330.0, 340.0), t * 0.9, gesture);
      far += ghost(far, HADES, vec2(270.0, 430.0), t * 0.7 + 1.7, gesture);
      float dogTime = mod(t, 8.9);
      float perk = reaction(dogTime, 2.0, 2.45, 2.85, 3.55) * fx;
      float sniff = reaction(dogTime, 2.32, 2.85, 3.1, 3.85) * fx;
      float lowLook = reaction(dogTime, 3.1, 3.8, 4.1, 4.9) * fx;
      float dogBreath = breathCycle(3.25, 0.0);
      float lowBreath = breathCycle(3.25, 1.12);
      float leftEar = (reaction(dogTime, 0.65, 0.84, 0.9, 1.26)
        + 0.7 * reaction(dogTime, 5.35, 5.5, 5.56, 5.92)) * fx;
      float rightEar = (reaction(dogTime, 0.84, 1.02, 1.08, 1.45)
        + 0.7 * reaction(dogTime, 5.56, 5.72, 5.78, 6.13)) * fx;
      float godTime = mod(t, 10.7);
      float nod = reaction(godTime, 4.1, 4.7, 5.05, 5.9) * fx;
      float handLift = reaction(godTime, 4.5, 5.05, 5.35, 6.2) * fx;
      float godBreath = breathCycle(4.45, 0.65);

      far.x = CENTER.x + (far.x - CENTER.x) * (1.0 - 0.046 * abs(pointer.x));
      vec2 handSpace = far;
      handSpace.y += 12.0 * godBreath * zone(far, vec2(1280.0, 658.0), vec2(187.0, 163.0));
      handSpace.y += 10.0 * dogBreath * zone(far, vec2(585.0, 638.0), vec2(180.0, 140.0));
      vec3 color = texture2D(backdrop, handSpace / SIZE).rgb;

      // Contre-jour de braises. La chaleur varie en intensité sans propager d'anneau.
      vec2 halo = (far - vec2(929.0, 496.0)) / vec2(405.0, 470.0);
      float heat = 0.77 + 0.12 * sin(t * 1.05) + 0.26 * gesture + 0.25 * revealPulse();
      float draft = 0.82 + 0.18 * sin(halo.x * 11.0 + sin(halo.y * 6.0 - t * 1.6) + t * 0.5);
      color += (vec3(0.50, 0.075, 0.009) * exp(-dot(halo, halo) * 1.72)
        + vec3(0.36, 0.17, 0.027) * exp(-dot(halo, halo) * 3.8) * draft) * heat * fx;

      // Couronne de feu stationnaire derrière la silhouette. Seul le contour frémit.
      vec2 fireCrown = (far - vec2(925.0, 515.0)) * vec2(1.0, 1.12);
      float direction = atan(fireCrown.y, fireCrown.x + 0.0001);
      float ripple = 13.0 * sin(direction * 7.0 + t * 1.7)
        + 6.0 * sin(direction * 19.0 - t * 2.3);
      float rim = abs(length(fireCrown) - 316.0 + ripple);
      float filament = 0.34 + 0.66 * pow(0.5 + 0.5 * sin(direction * 11.0 + t * 2.2), 2.0);
      float ignition = 1.0 + 1.6 * revealPulse();
      color += (vec3(0.65, 0.105, 0.012) * exp(-rim / 40.0)
        + vec3(1.0, 0.38, 0.075) * exp(-rim / 5.2) * filament) * heat * fx * 0.73 * ignition;

      // Chaque tête se déplace devant son propre fond retouché.
      vec2 dogPivot = vec2(642.0, 570.0);
      vec2 dog = dogPivot + turn(far - dogPivot + vec2(-5.0, 4.0) * sniff, -0.145 * sniff);
      dog += vec2(5.0, 12.0) * dogBreath * zone(dog, vec2(534.0, 466.0), vec2(200.0, 245.0));
      vec2 leftEarUV = earPose(dog, vec2(515.0, 423.0), 0.13 * perk + 0.17 * leftEar);
      vec2 rightEarUV = earPose(dog, vec2(591.0, 424.0), -0.12 * perk - 0.16 * rightEar);
      vec2 jawPivot = vec2(572.0, 576.0);
      vec2 jaw = jawPivot + turn(dog - jawPivot, 0.12 * sniff + 0.075 * dogBreath);
      vec2 wrist = vec2(1300.0, 778.0);
      vec2 hand = wrist + turn(handSpace - wrist + vec2(-3.0, 9.0) * handLift, 0.09 * handLift);
      vec2 lowPivot = vec2(684.0, 744.0);
      vec2 lower = lowPivot + turn(far - lowPivot + vec2(8.0, 7.0) * lowLook, -0.15 * lowLook);
      lower += vec2(3.0, 9.0) * lowBreath * zone(lower, vec2(644.0, 708.0), vec2(92.0, 100.0));

      vec2 godsPivot = vec2(1270.0, 590.0);
      vec2 god = godsPivot + turn(far - godsPivot + vec2(-5.0, -7.0) * nod, 0.13 * nod);
      god.y += 9.0 * godBreath * zone(god, vec2(1250.0, 425.0), vec2(180.0, 220.0));
      float crown = zone(god, vec2(1230.0, 345.0), vec2(165.0, 95.0));
      god += vec2(sin(god.y / 17.0 + t * 2.1), cos(god.x / 21.0 + t * 1.7)) * 2.2 * crown * fx;

      vec4 lowColor = texture2D(lowHead, lower / SIZE);
      color = mix(color, lowColor.rgb, lowColor.a);
      vec4 rightColor = texture2D(earRight, rightEarUV / SIZE);
      color = mix(color, rightColor.rgb, rightColor.a);
      vec4 leftColor = texture2D(earLeft, leftEarUV / SIZE);
      color = mix(color, leftColor.rgb, leftColor.a);
      vec4 headColor = texture2D(backgroundHeads, mix(dog, god, step(CENTER.x, far.x)) / SIZE);
      color = mix(color, headColor.rgb, headColor.a);
      vec4 detailColor = texture2D(backgroundDetails, mix(jaw, hand, step(CENTER.x, far.x)) / SIZE);
      color = mix(color, detailColor.rgb, detailColor.a);
      float awake = 0.35 + 0.25 * sin(t * 1.3) + gesture * 0.65;
      color += vec3(0.95, 0.85, 0.30) * glow(dog, vec2(591.0, 461.0), 7.0) * (awake * fx + sniff);
      color += vec3(1.0, 0.55, 0.20) * (glow(god, vec2(1212.0, 419.0), 4.5)
        + glow(god, vec2(1268.0, 419.0), 4.5)) * (awake * fx + nod) * 0.8;
      color = embers(color, point - parallax(0.25), 0.0, gesture);
      color = leaves(color, point - parallax(0.3), 0.0);
      gl_FragColor = vec4(color * revealAmount(), 1.0);
    }
  `;

  // Passe 2 : la marionnette. Chaque sommet suit jusqu'à quatre os (skinning linéaire) ;
  // le reste de ses poids le laisse à sa place, sur la racine immobile.
  const meshVertex = `
    precision highp float;
    attribute vec2 rest;
    attribute vec4 bones, weights;
    uniform vec3 boneX[8], boneY[8];
    uniform vec2 windowSize;
    uniform float part, breathing;
    varying vec2 home;
    const vec2 CENTER = vec2(920.0, 487.5);

    vec2 pose(float index, vec3 point) {
      int i = int(index);
      return vec2(dot(boneX[i], point), dot(boneY[i], point));
    }

    void main() {
      vec3 point = vec3(rest, 1.0);
      vec2 moved = rest;
      moved += weights.x * (pose(bones.x, point) - rest);
      moved += weights.y * (pose(bones.y, point) - rest);
      moved += weights.z * (pose(bones.z, point) - rest);
      moved += weights.w * (pose(bones.w, point) - rest);
      if (part == 0.0) {
        // Léger soulèvement local des pectoraux, qui s'efface vers le cou et la ceinture.
        vec2 chest = (rest - vec2(910.0, 515.0)) / vec2(155.0, 138.0);
        float influence = 1.0 - smoothstep(0.2, 1.0, length(chest));
        moved.y -= 9.0 * breathing * influence;
      }
      home = rest;
      vec2 clip = (moved - CENTER) / (windowSize * 0.5);
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }
  `;
  const meshFragment = `${common}
    varying vec2 home;
    uniform sampler2D layer;
    uniform float part;
    const vec2 BLADE_BASE = vec2(1004.0, 313.0);
    const vec2 BLADE_TIP = vec2(1254.0, 108.0);

    void main() {
      vec4 texel = texture2D(layer, home / SIZE);
      vec3 color = texel.rgb;
      if (part == 2.0) {
        // Éclat qui remonte la lame, de la nuque à la pointe, pendant le geste.
        vec2 edge = BLADE_TIP - BLADE_BASE;
        float along = clamp(dot(home - BLADE_BASE, edge) / dot(edge, edge), 0.0, 1.0);
        float across = length(home - BLADE_BASE - edge * along);
        float onBlade = (1.0 - smoothstep(16.0, 26.0, across)) * step(0.001, along)
          * smoothstep(0.35, 0.6, color.r);
        float sweep = clamp((phase - 0.8) / 0.9, 0.0, 1.0);
        float flare = exp(-abs(along - sweep) * 8.0) * smoothstep(0.7, 0.95, phase)
          * (1.0 - smoothstep(1.7, 2.15, phase)) * fx;
        color += vec3(1.0, 0.86, 0.66) * onBlade * flare * 1.6;
        color += vec3(1.0, 0.9, 0.7) * glow(home, BLADE_TIP, 9.0) * flare * step(0.9, sweep) * 1.3;
      }
      if (part == 0.0) {
        // Œil rouge et œil vert : lueur douce, plus vive au moment du geste.
        float stare = (0.25 + 0.1 * sin(t * 2.1) + gesture * 0.9) * fx;
        color += vec3(1.0, 0.12, 0.05) * glow(home, vec2(885.0, 326.0), 4.0) * stare;
        color += vec3(0.2, 1.0, 0.5) * glow(home, vec2(938.0, 326.0), 3.5) * stare * 0.8;
      }
      // Lueur de braise qui remonte sur la silhouette pendant le geste.
      color += vec3(0.6, 0.12, 0.02) * gesture * 0.18 * (1.0 - smoothstep(300.0, 900.0, home.y));
      float exposure = revealAmount();
      color *= exposure;
      gl_FragColor = vec4(color, texel.a);
    }
  `;

  // Passe 3 : laurier flottant, effets proches, reflet dans l'œil et vignette.
  const overlayFragment = `${common}
    varying vec2 uv;
    uniform sampler2D scene, laurel;
    uniform vec2 eye, introEye, face, resolution, crownOffset;

    vec4 cutout(sampler2D layer, vec2 point) {
      if (any(lessThan(point, vec2(0.0))) || any(greaterThan(point, SIZE))) return vec4(0.0);
      return texture2D(layer, point / SIZE);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n = dot(i, vec2(1.0, 57.0));
      return mix(mix(hash(n), hash(n + 1.0), f.x), mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
    }
    float drainProgress() { return smoothstep(STYX_DRAIN, STYX_DRAIN_END, intro); }
    // Montée de Zagreus hors du bassin, en pixels de la source.
    float riseOffset() { return intro < 0.0 ? 0.0 : 70.0 * (1.0 - drainProgress()); }

    // Bassin du Styx vu de dessus : sang visqueux, reflets qui glissent, ondes et bulles.
    vec3 styxBlood(vec2 q) {
      vec2 pool = vec2(920.0, 560.0);
      vec2 warp = vec2(vnoise(q / 320.0 + intro * 0.08), vnoise(q / 320.0 - intro * 0.08 + 7.0));
      vec2 flow = q + (warp - 0.5) * 220.0;
      float n = vnoise(flow / 150.0) * 0.65 + vnoise(flow / 48.0 + intro * 0.2) * 0.35;
      vec3 blood = mix(vec3(0.045, 0.0, 0.005), vec3(0.36, 0.012, 0.022), pow(n, 1.25));
      float sheen = pow(vnoise(flow / 85.0 + vec2(intro * 0.25, 0.0)), 7.0);
      blood += vec3(1.0, 0.38, 0.32) * sheen * 0.55;
      float r = length((q - pool) * vec2(1.0, 1.7)) + (warp.x - 0.5) * 70.0;
      float calm = 1.0 - drainProgress();
      float ring = pow(max(sin(r * 0.04 - intro * 3.6), 0.0), 22.0) * exp(-r / 520.0);
      blood += vec3(0.95, 0.3, 0.24) * ring * 0.3 * calm;
      // Onde de surface : quelque chose remonte du fond.
      float surge = r - (intro - 1.85) * 1300.0;
      blood += vec3(1.0, 0.42, 0.32) * exp(-surge * surge / 1800.0)
        * step(1.85, intro) * (1.0 - smoothstep(1.85, 2.6, intro)) * 0.7;
      float dome = exp(-r * r / 26000.0) * smoothstep(1.5, 2.1, intro) * (1.0 - smoothstep(2.2, 2.6, intro));
      blood += vec3(0.7, 0.1, 0.08) * dome * 0.5;
      for (int i = 0; i < 7; i++) {
        float seed = float(i) + 1.0;
        vec2 center = pool + (vec2(hash(seed), hash(seed + 5.0)) - 0.5) * vec2(1100.0, 520.0);
        float period = 1.2 + hash(seed + 9.0) * 1.0;
        float age = fract((intro + hash(seed + 2.0) * 4.0) / period);
        float d = length(q - center);
        float radius = mix(4.0, 14.0 + 10.0 * hash(seed + 4.0), smoothstep(0.0, 0.8, age));
        float alive = 1.0 - step(0.82, age);
        float rim = exp(-pow((d - radius) / 2.2, 2.0)) * alive;
        float glint = exp(-length(q - center + vec2(radius * 0.4)) / 2.5) * alive;
        float burst = d - radius - (age - 0.82) * 260.0;
        float pop = exp(-burst * burst / 8.0) * step(0.82, age) * (1.0 - age) * 4.0;
        blood += vec3(1.0, 0.45, 0.38) * (rim * 0.3 + glint * 0.6 + pop * 0.35) * calm;
      }
      blood *= 1.0 - 0.45 * smoothstep(450.0, 1150.0, r);
      return blood * smoothstep(0.2, 0.85, intro);
    }

    // Le sang s'écoule vers le bas et laisse des coulures brillantes sur la silhouette.
    vec3 styx(vec3 scene, vec2 q) {
      float drain = drainProgress();
      float level = mix(-140.0, 1200.0, pow(drain, 1.15));
      float edge = level + 9.0 * sin(q.x / 63.0 + intro * 2.6) + 5.0 * sin(q.x / 23.0 - intro * 3.4);
      float liquid = smoothstep(edge - 2.0, edge + 2.0, q.y);
      float drip = 0.0;
      float shine = 0.0;
      for (int i = 0; i < 14; i++) {
        float seed = float(i) + 21.0;
        float reach = (50.0 + hash(seed + 7.0) * 170.0) * smoothstep(0.05, 0.6, drain)
          * (1.0 - smoothstep(0.82, 0.98, drain));
        if (reach < 1.0) continue;
        float top = edge - reach;
        float along = clamp((q.y - top) / reach, 0.0, 1.0);
        float cx = 520.0 + hash(seed) * 800.0 + 4.0 * sin(q.y / 26.0 + seed);
        float w = (2.0 + hash(seed + 3.0) * 4.5) * (0.35 + 0.65 * along);
        float dx = q.x - cx;
        float stem = (1.0 - smoothstep(w - 1.0, w + 1.0, abs(dx))) * step(top, q.y) * step(q.y, edge);
        float film = smoothstep(0.0, 0.35, along);
        drip = max(drip, stem * film);
        shine = max(shine, stem * film * exp(-pow((dx + w * 0.4) / max(w * 0.3, 0.6), 2.0)));
      }
      // Reflet sur la peau et l'armure juste découvertes.
      float wet = drain > 0.0 ? exp(-max(edge - q.y, 0.0) / 140.0) * (1.0 - smoothstep(0.9, 1.0, drain)) : 0.0;
      vec3 drenched = mix(scene, scene * vec3(0.95, 0.4, 0.35) + vec3(0.05, 0.0, 0.0), wet * 0.45);
      vec3 color = mix(drenched, vec3(0.3, 0.01, 0.02), drip * 0.9) + vec3(1.0, 0.5, 0.45) * shine * 0.5;
      color = mix(color, styxBlood(q), liquid);
      float meniscus = exp(-pow((q.y - edge) / 3.5, 2.0)) * smoothstep(0.0, 0.05, drain)
        * (1.0 - smoothstep(0.92, 1.0, drain));
      return color + vec3(1.0, 0.35, 0.26) * meniscus * 0.55;
    }

    void main() {
      vec2 screenPoint = (uv - 0.5) * windowSize + CENTER;
      float rise = riseOffset();
      vec2 point = screenPoint - vec2(0.0, rise);
      vec3 color = texture2D(scene, (gl_FragCoord.xy + vec2(0.0, rise * resolution.y / windowSize.y)) / resolution).rgb;
      vec3 base = color;
      float breath = sin(t * 1.6) * fx;

      // Feuilles du laurier : elles flottent et s'envolent un peu plus haut avec le geste.
      vec2 crown = point - parallax(0.8) - crownOffset;
      crown.y += breath * 2.0 + gesture * 14.0 * (1.0 - smoothstep(60.0, 240.0, crown.y));
      crown += vec2(sin(crown.y / 23.0 + t * 1.3), cos(crown.x / 29.0 + t * 1.1)) * 3.2 * fx;
      vec4 laurelLeaves = cutout(laurel, crown);
      color = mix(color, laurelLeaves.rgb, laurelLeaves.a);

      // Reflet dans l'œil rouge : une petite étoile s'allume de temps en temps, et à
      // l'apogée du geste. Les branches débordent du visage comme un éclat de lumière.
      float local = mod(t + 1.4, 5.3);
      float spark = smoothstep(0.0, 0.12, local) * (1.0 - smoothstep(0.12, 0.75, local))
        + smoothstep(0.35, 0.5, phase) * (1.0 - smoothstep(0.5, 1.1, phase));
      vec2 ray = turn(point - eye, 0.25 * sin(t * 0.7));
      vec2 tilted = turn(ray, 0.785);
      float star = exp(-abs(ray.x) / 10.0) * exp(-abs(ray.y) / 0.9)
        + exp(-abs(ray.y) / 10.0) * exp(-abs(ray.x) / 0.9)
        + 0.45 * (exp(-abs(tilted.x) / 5.0) * exp(-abs(tilted.y) / 0.8)
          + exp(-abs(tilted.y) / 5.0) * exp(-abs(tilted.x) / 0.8));
      float core = exp(-length(ray) / 2.2);
      color += (vec3(1.0, 0.35, 0.25) * star + vec3(1.0, 0.85, 0.8) * core * 1.4) * spark * fx;

      // Premier plan : braises et feuilles proches, effacées autour du visage.
      float clear = smoothstep(90.0, 220.0, length(point - face));
      vec2 near = point - parallax(1.3);
      color = mix(color, embers(color, near, 1.0, gesture), clear);
      color = mix(color, leaves(color, near, 1.0), clear);

      // Vignette chaude qui rapproche le regard du personnage.
      vec2 frame = (point - CENTER) / (windowSize * 0.5);
      color *= 1.0 - 0.18 * smoothstep(0.55, 1.25, length(frame * vec2(0.85, 1.0)));
      if (intro >= 0.0) {
        color = styx(color, screenPoint);
        float ignition = smoothstep(3.3, 3.7, intro) * (1.0 - smoothstep(4.3, 4.6, intro));
        color += (vec3(0.86, 0.025, 0.01) * glow(point, introEye, 12.0)
          + vec3(1.0, 0.29, 0.10) * glow(point, introEye, 3.6)) * ignition;
        float flash = 0.55 * smoothstep(3.8, 3.88, intro) * (1.0 - smoothstep(3.88, 4.2, intro));
        float spread = 0.27 + 0.73 * glow(point, introEye, 245.0);
        color += vec3(0.62, 0.025, 0.013) * flash * spread;
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const smooth = (from, to, value) => {
    const x = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return x * x * (3 - 2 * x);
  };

  // Pose des os à l'instant t. Angles en radians, positifs dans le sens horaire à l'écran.
  function pose(t, fx, look, intro) {
    const local = t % PERIOD;
    const gesture = smooth(0.55, 1.1, local) * (1 - smooth(1.4, 2.35, local)) * fx;
    const elbow = smooth(0.48, 1.08, local) * (1 - smooth(1.36, 2.4, local)) * fx;
    const chestAngle = -0.037 * gesture;
    const upperArmAngle = 0.14 * elbow;
    const forearmAngle = 0.083 * gesture;
    // Une petite inclinaison vers le haut dans le repère de la scène, même
    // lorsque les autres articulations tournent pour lever la poignée.
    const bladeAngle = -0.055 * gesture;
    const glance = smooth(0.25, 0.85, local) * (1 - smooth(1.45, 2.2, local)) * fx
      + smooth(3.3, 3.8, intro) * (1 - smooth(4.4, 5.0, intro)) * 0.55;
    const settle = smooth(2.65, 3.45, local) * (1 - smooth(3.65, 4.65, local)) * fx;
    const lift = smooth(3.55, 4.2, local) * (1 - smooth(4.4, 5.45, local)) * fx;
    const cycle = t % 4.8;
    const breath = smooth(0, 1.7, cycle) * (1 - smooth(1.7, 4.5, cycle)) * fx;
    return {
      gesture,
      phase: local,
      breathing: breath,
      bones: {
        // Le torse respire et se hausse pendant le geste ; les jambes restent ancrées.
        chest: {
          angle: chestAngle,
          offset: [0, -(6 * breath + 8 * gesture) + 12 * settle],
        },
        head: {
          // Le menton se relève avec l'inspiration et la tête recule depuis la nuque.
          angle:
            0.043 * breath + 0.136 * glance - 0.05 * settle + 0.07 * lift + 0.026 * look.x * fx,
          offset: [-3 * glance, -3 * breath - 5 * glance - 4 * lift + 2 * look.y * fx],
        },
        // Le coude amorce la montée, puis l'avant-bras suit. Pendant le report
        // du poids de l'épée, le bras et la lame restent dans leur pose de repos.
        upperArm: { angle: upperArmAngle },
        forearm: { angle: forearmAngle },
        hand: { angle: bladeAngle - chestAngle - upperArmAngle - forearmAngle },
        // L'autre bras se balance le long de la hanche et la main s'y resserre.
        hipArm: {
          angle: 0.015 * Math.sin(t * 1.1 + 0.4) * fx + 0.044 * gesture,
          offset: [0, -3 * breath + 2 * settle],
        },
        hipForearm: { angle: 0.03 * Math.sin(t * 1.1) * fx - 0.05 * gesture },
      },
    };
  }

  // Cinématique directe : chaque os tourne autour de son pivot, dans le repère de son parent.
  function skeleton(rig, state) {
    const world = {};
    const multiply = (a, b) => [
      a[0] * b[0] + a[1] * b[3],
      a[0] * b[1] + a[1] * b[4],
      a[0] * b[2] + a[1] * b[5] + a[2],
      a[3] * b[0] + a[4] * b[3],
      a[3] * b[1] + a[4] * b[4],
      a[3] * b[2] + a[4] * b[5] + a[5],
    ];
    const resolve = (name) => {
      if (world[name]) return world[name];
      const { pivot, parent } = rig.bones[name];
      const { angle = 0, offset = [0, 0] } = state.bones[name] ?? {};
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const [px, py] = pivot;
      const local = [
        c,
        -s,
        px - c * px + s * py + offset[0],
        s,
        c,
        py - s * px - c * py + offset[1],
      ];
      world[name] = parent ? multiply(resolve(parent), local) : local;
      return world[name];
    };
    BONES.forEach(resolve);
    return world;
  }

  const apply = (m, [x, y]) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

  // Lit une carte de poids : chaque canal donne l'influence d'un os.
  function sampler(source) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, ...SIZE);
    const { data } = context.getImageData(0, 0, ...SIZE);
    return (x, y) => {
      const i =
        (Math.min(SIZE[1] - 1, Math.max(0, Math.round(y))) * SIZE[0] +
          Math.min(SIZE[0] - 1, Math.max(0, Math.round(x)))) *
        4;
      return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255];
    };
  }

  // Grille régulière sur la boîte de la pièce ; les texels transparents ne dessinent rien.
  function grid(box, influence) {
    const [x0, y0, x1, y1] = box;
    const columns = Math.ceil((x1 - x0) / STEP) + 1;
    const lines = Math.ceil((y1 - y0) / STEP) + 1;
    const rest = new Float32Array(columns * lines * 2);
    const bones = new Float32Array(columns * lines * 4);
    const weights = new Float32Array(columns * lines * 4);
    for (let row = 0; row < lines; row++) {
      for (let column = 0; column < columns; column++) {
        const v = row * columns + column;
        const x = Math.min(x1, x0 + column * STEP);
        const y = Math.min(y1, y0 + row * STEP);
        rest.set([x, y], v * 2);
        const pairs = influence(x, y);
        pairs.forEach(([bone, weight], k) => {
          bones[v * 4 + k] = BONES.indexOf(bone);
          weights[v * 4 + k] = weight;
        });
      }
    }
    const indices = new Uint16Array((columns - 1) * (lines - 1) * 6);
    let n = 0;
    for (let row = 0; row < lines - 1; row++) {
      for (let column = 0; column < columns - 1; column++) {
        const a = row * columns + column;
        indices.set([a, a + 1, a + columns, a + 1, a + columns + 1, a + columns], n);
        n += 6;
      }
    }
    return { rest, bones, weights, indices };
  }

  function puppet(rig, bodyMap, armMap, hipMap) {
    const body = (x, y) => {
      const [chest, head, hipArm] = bodyMap(x, y);
      const [hipForearm] = hipMap(x, y);
      const [arm, forearm, hand] = armMap(x, y);
      // L'épaulette à droite de l'image fait partie du bras gauche de Zagreus.
      // Donner le même mouvement à son centre et raccorder près du tissu.
      const shoulder = smooth(1000, 1055, x) * (1 - smooth(580, 650, y)) * smooth(350, 410, y);
      const bodyShare = (1 - arm) * (1 - shoulder);
      const weights = [
        ['chest', chest * bodyShare],
        ['head', head * bodyShare],
        ['hipArm', hipArm * bodyShare + shoulder * (1 - arm)],
        ['hipForearm', hipForearm * bodyShare],
        ['upperArm', arm * Math.max(0, 1 - forearm - hand)],
        ['forearm', arm * forearm],
        ['hand', arm * hand],
      ];
      // Quatre influences par sommet ; le poids restant correspond au bassin fixe.
      const visibleWeight = Math.min(
        1,
        weights.reduce((sum, [, weight]) => sum + weight, 0),
      );
      const strongest = weights.sort((a, b) => b[1] - a[1]).slice(0, 4);
      const kept = strongest.reduce((sum, [, weight]) => sum + weight, 0);
      return strongest.map(([bone, weight]) => [bone, kept ? (weight * visibleWeight) / kept : 0]);
    };
    const rigid = () => [['sword', 1]];
    return [
      { part: 2, texture: 'sword', mesh: grid(rig.meshes.sword, rigid) },
      { part: 0, texture: 'body', mesh: grid(rig.meshes.body, body) },
      { part: 1, texture: 'guard', mesh: grid(rig.meshes.guard, rigid) },
    ];
  }

  async function load() {
    const [rig, ...images] = await Promise.all([
      fetch(new URL('puppet.json', assets)).then((response) => response.json()),
      ...[
        'puppet-background.jpg',
        'puppet-background-heads.png',
        'puppet-background-low-head.png',
        'puppet-ear-0.png',
        'puppet-ear-1.png',
        'puppet-background-details.png',
        'puppet-body.png',
        'puppet-sword.png',
        'puppet-guard.png',
        'leaves.png',
      ].map(image),
      ...['puppet-weights-body.png', 'puppet-weights-arm.png', 'puppet-weights-hip.png'].map(image),
    ]);
    const [
      backdrop,
      backgroundHeads,
      lowHead,
      earLeft,
      earRight,
      backgroundDetails,
      body,
      sword,
      guard,
      laurel,
      bodyWeights,
      armWeights,
      hipWeights,
    ] = images;
    return {
      rig,
      images: {
        backdrop,
        backgroundHeads,
        lowHead,
        earLeft,
        earRight,
        backgroundDetails,
        body,
        sword,
        guard,
        laurel,
      },
      parts: puppet(rig, sampler(bodyWeights), sampler(armWeights), sampler(hipWeights)),
    };
  }

  function mount(canvas, { rig, images, parts }, level) {
    const gl = canvas.getContext('webgl', { alpha: false });
    if (!gl) throw new Error('WebGL indisponible');
    const programs = [];
    const program = (vertexSource, fragmentSource) => {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const error = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(error);
        }
        return shader;
      };
      const linked = gl.createProgram();
      const shaders = [
        compile(gl.VERTEX_SHADER, vertexSource),
        compile(gl.FRAGMENT_SHADER, fragmentSource),
      ];
      shaders.forEach((shader) => gl.attachShader(linked, shader));
      gl.linkProgram(linked);
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(linked);
        gl.deleteProgram(linked);
        throw new Error(error);
      }
      programs.push(linked);
      const uniforms = new Proxy(
        {},
        {
          get: (cache, name) => (cache[name] ??= gl.getUniformLocation(linked, name)),
        },
      );
      return { linked, uniforms };
    };
    const backdropPass = program(quad, backdropFragment);
    const meshPass = program(meshVertex, meshFragment);
    const overlayPass = program(quad, overlayFragment);

    const buffers = [];
    const buffer = (target, data) => {
      const handle = gl.createBuffer();
      gl.bindBuffer(target, handle);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      buffers.push(handle);
      return handle;
    };
    const screen = buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    const meshes = parts.map(({ part, texture, mesh }) => ({
      part,
      texture,
      count: mesh.indices.length,
      rest: buffer(gl.ARRAY_BUFFER, mesh.rest),
      bones: buffer(gl.ARRAY_BUFFER, mesh.bones),
      weights: buffer(gl.ARRAY_BUFFER, mesh.weights),
      indices: buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
    }));

    const textures = [];
    const texture = (source) => {
      const handle = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      textures.push(handle);
      return handle;
    };
    const layers = Object.fromEntries(
      Object.entries(images).map(([name, source]) => [name, texture(source)]),
    );
    // Le décor et la marionnette sont rendus dans une texture, que la passe finale complète.
    const scene = texture(null);
    const framebuffer = gl.createFramebuffer();
    let sceneSize = [0, 0];

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const surface = canvas.closest('[data-card-motion]') ?? canvas.parentElement;
    const detail = canvas.closest('[data-card-quality="close-up"]');
    const grid = canvas.closest('[data-card-quality="grid"]');
    const target = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    const move = (event) => {
      const box = surface.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
      target.y = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
    };
    const leave = () => (target.x = target.y = 0);
    const cardMove = ({ detail }) => {
      target.x = detail.x;
      target.y = detail.y;
    };
    const external = surface.hasAttribute('data-card-motion');
    if (external) surface.addEventListener('achievers:card-motion', cardMove);
    else {
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerleave', leave);
    }

    // Relief (niveau 2) : parallaxe seule, le temps du décor et des personnages est arrêté.
    const animated = level >= 3;
    const fx = animated ? 1 : 0;
    const shared = (pass, view, state, elapsed) => {
      gl.useProgram(pass.linked);
      gl.uniform2f(pass.uniforms.windowSize, ...view);
      gl.uniform2f(pass.uniforms.pointer, look.x, look.y);
      gl.uniform1f(pass.uniforms.t, elapsed);
      gl.uniform1f(pass.uniforms.fx, fx);
      gl.uniform1f(pass.uniforms.gesture, state.gesture);
      gl.uniform1f(pass.uniforms.phase, state.phase);
    };
    const fullscreen = (pass) => {
      const position = gl.getAttribLocation(pass.linked, 'position');
      gl.bindBuffer(gl.ARRAY_BUFFER, screen);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(position);
    };
    const bind = (pass, name, unit, handle) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.uniform1i(pass.uniforms[name], unit);
    };

    let elapsed = 0;
    let last = performance.now();
    let drawnAt = -Infinity;
    let frame;
    let intro = -1;
    let introRequested = false;
    const replay = (event) => {
      elapsed = 0;
      if (animated && event.detail?.intro && !motion.matches) intro = 0;
    };
    canvas.addEventListener('achievers:card-replay', replay);
    function draw(now) {
      frame = requestAnimationFrame(draw);
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (document.hidden || canvas.closest('[data-card-suspended]')) return;
      const still = motion.matches || level < 2;
      canvas.style.visibility = still ? 'hidden' : '';
      if (still) intro = -1;
      if (still || !canvas.clientWidth || !canvas.clientHeight) return;
      if (animated) elapsed += delta;
      if (grid && now - drawnAt < 32) return;
      drawnAt = now;
      const ratio = Math.min(devicePixelRatio * (detail ? 1.75 : 1), detail ? 2.5 : grid ? 1.5 : 2);
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (sceneSize[0] !== width || sceneSize[1] !== height) {
        gl.bindTexture(gl.TEXTURE_2D, scene);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene, 0);
        sceneSize = [width, height];
      }
      const scale = Math.max(width / 1840, height / 860) * 1.035;
      const view = [width / scale, height / scale];
      look.x += (target.x - look.x) * 0.1;
      look.y += (target.y - look.y) * 0.1;
      const requested = animated && Boolean(canvas.closest('[data-card-intro]'));
      if (requested && !introRequested) intro = 0;
      introRequested = requested;
      // data-card-intro-time fige l'intro à un instant donné pour la vérifier image par image.
      const forcedIntro = animated ? canvas.dataset.cardIntroTime : undefined;
      if (forcedIntro !== undefined) intro = Number(forcedIntro);
      const state = pose(elapsed, fx, look, intro);
      const world = skeleton(rig, state);
      gl.viewport(0, 0, width, height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.disable(gl.BLEND);
      shared(backdropPass, view, state, elapsed);
      gl.uniform1f(backdropPass.uniforms.intro, intro);
      bind(backdropPass, 'backdrop', 0, layers.backdrop);
      bind(backdropPass, 'backgroundHeads', 1, layers.backgroundHeads);
      bind(backdropPass, 'lowHead', 2, layers.lowHead);
      bind(backdropPass, 'earLeft', 3, layers.earLeft);
      bind(backdropPass, 'earRight', 4, layers.earRight);
      bind(backdropPass, 'backgroundDetails', 5, layers.backgroundDetails);
      fullscreen(backdropPass);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      shared(meshPass, view, state, elapsed);
      gl.uniform1f(meshPass.uniforms.intro, intro);
      gl.uniform1f(meshPass.uniforms.breathing, state.breathing);
      gl.uniform3fv(
        meshPass.uniforms['boneX[0]'],
        BONES.flatMap((name) => world[name].slice(0, 3)),
      );
      gl.uniform3fv(
        meshPass.uniforms['boneY[0]'],
        BONES.flatMap((name) => world[name].slice(3)),
      );
      const attributes = ['rest', 'bones', 'weights'].map((name) =>
        gl.getAttribLocation(meshPass.linked, name),
      );
      for (const mesh of meshes) {
        bind(meshPass, 'layer', 0, layers[mesh.texture]);
        gl.uniform1f(meshPass.uniforms.part, mesh.part);
        [mesh.rest, mesh.bones, mesh.weights].forEach((handle, i) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, handle);
          gl.enableVertexAttribArray(attributes[i]);
          gl.vertexAttribPointer(attributes[i], i ? 4 : 2, gl.FLOAT, false, 0, 0);
        });
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      }
      attributes.forEach((location) => gl.disableVertexAttribArray(location));

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      shared(overlayPass, view, state, elapsed);
      bind(overlayPass, 'scene', 0, scene);
      bind(overlayPass, 'laurel', 1, layers.laurel);
      gl.uniform2f(overlayPass.uniforms.resolution, width, height);
      gl.uniform2f(overlayPass.uniforms.eye, ...apply(world.head, [885, 326]));
      // The light settles on the painted iris at the end of the glance.
      const gaze = 1 - smooth(3.3, 3.8, intro);
      gl.uniform2f(overlayPass.uniforms.introEye, ...apply(world.head, [885 - 7 * gaze, 326 + 10 * gaze]));
      gl.uniform2f(overlayPass.uniforms.face, ...apply(world.head, [913, 331]));
      gl.uniform1f(overlayPass.uniforms.intro, intro);
      const [crownX, crownY] = apply(world.head, [920, 200]);
      gl.uniform2f(overlayPass.uniforms.crownOffset, crownX - 920, crownY - 200);
      fullscreen(overlayPass);
      if (intro >= 0 && forcedIntro === undefined) {
        intro += delta;
        if (requested && intro >= INTRO_REVEAL && intro - delta < INTRO_REVEAL) {
          canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
        }
        if (intro >= INTRO_END) intro = -1;
      }
    }
    draw(last);
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('achievers:card-motion', cardMove);
      canvas.removeEventListener('achievers:card-replay', replay);
      textures.forEach((handle) => gl.deleteTexture(handle));
      buffers.forEach((handle) => gl.deleteBuffer(handle));
      gl.deleteFramebuffer(framebuffer);
      programs.forEach((linked) => gl.deleteProgram(linked));
    };
  }

  (window.AchieversCards ??= {})['hades-mythique'] = {
    async mount(canvas, level = 3) {
      return mount(canvas, await (loaded ??= load()), level);
    },
  };
})();
