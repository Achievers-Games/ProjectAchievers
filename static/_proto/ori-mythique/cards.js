(() => {
  const assets = new URL('.', document.currentScript.src);
  const image = async (file) => {
    const artwork = new Image();
    artwork.src = new URL(file, assets);
    await artwork.decode();
    return artwork;
  };
  let layers;
  // Intro : la lumière d'Ori tourne autour de la plume de Kuro dans la nuit, puis s'envole
  // vers l'arrivée de Ku ; l'aube se lève depuis ce point et le duo entre.
  const introDuration = 6.0;
  const INTRO_REVEAL = 4.6;

  const vertex = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = position * vec2(0.5, -0.5) + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;
  const fragment = `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D sky, ku, ori, rockLayers;
    uniform vec2 windowSize, pointer;
    uniform float t, fx, intro;
    const vec2 SIZE = vec2(1840.0, 860.0);
    const vec2 SHOULDER = vec2(722.0, 370.0);

    vec4 cutout(sampler2D layer, vec2 point) {
      if (any(lessThan(point, vec2(0.0))) || any(greaterThan(point, SIZE))) return vec4(0.0);
      return texture2D(layer, point / SIZE);
    }

    float hash(float seed) { return fract(sin(seed * 127.1) * 43758.5453); }

    float cloudNoise(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float seed = dot(cell, vec2(17.0, 61.0));
      return mix(mix(hash(seed), hash(seed + 17.0), f.x),
        mix(hash(seed + 61.0), hash(seed + 78.0), f.x), f.y);
    }

    vec2 floatingRock(float phase, vec2 amplitude) {
      return amplitude * vec2(sin(phase * 0.73), cos(phase)) * fx;
    }


    float blink(float period, float offset) {
      float since = mod(t + offset, period);
      return smoothstep(0.0, 0.08, since) * (1.0 - smoothstep(0.105, 0.21, since)) * fx;
    }

    vec3 eyelid(sampler2D layer, vec3 original, vec2 point, vec2 center, vec2 radius,
      float angle, float amount, vec2 lidSample, vec3 crease) {
      float c = cos(angle);
      float s = sin(angle);
      vec2 delta = point - center;
      vec2 eye = vec2(c * delta.x + s * delta.y, -s * delta.x + c * delta.y) / radius;
      float edge = 1.0 - smoothstep(0.83, 1.08, length(eye));
      float closing = mix(-1.2, 1.16, amount);
      float eyelidCover = smoothstep(eye.y - 0.08, eye.y + 0.08, closing) * edge;
      vec3 paint = texture2D(layer, (lidSample + delta * 0.15) / SIZE).rgb;
      vec3 color = mix(original, paint, eyelidCover);
      float seam = (1.0 - smoothstep(0.035, 0.14, abs(eye.y - 0.18 + 0.24 * eye.x * eye.x)))
        * (1.0 - smoothstep(0.7, 0.96, abs(eye.x))) * smoothstep(0.83, 1.0, amount);
      return mix(color, crease, seam * 0.82);
    }

    float gusts(vec2 point, float flow, float strength) {
      float wisps = 0.0;
      for (int i = 0; i < 5; i++) {
        float seed = float(i) + 1.0;
        float age = fract(flow * (0.16 + seed * 0.022) + hash(seed));
        float x = point.x - mix(2280.0, -460.0, age);
        float y = point.y - (245.0 + mod(seed * 193.0, 480.0))
          + x * 0.12 + sin(x / 195.0 + seed + t) * 15.0;
        float ribbon = exp(-abs(y) / (2.0 + seed * 0.65));
        float trail = 1.0 - smoothstep(35.0, 235.0 + seed * 37.0, abs(x));
        float fade = smoothstep(0.0, 0.16, age) * (1.0 - smoothstep(0.74, 1.0, age));
        wisps += ribbon * trail * fade;
      }
      return wisps * strength;
    }

    vec3 leaves(vec3 color, vec2 point, float flow, float foreground) {
      for (int i = 0; i < 6; i++) {
        float seed = float(i) + 1.0 + foreground * 8.0;
        float age = fract(flow * mix(0.095, 0.19, foreground) * (0.75 + hash(seed)) + hash(seed + 2.0));
        vec2 center = vec2(mix(2000.0, -160.0, age), 160.0 + hash(seed + 9.0) * 620.0);
        center.y += sin(age * 8.0 + seed) * mix(42.0, 75.0, foreground) + age * 155.0;
        vec2 offset = point - center;
        float roll = age * 12.0 + seed;
        float angle = -0.32 + 0.5 * sin(roll + 0.4);
        vec2 shape = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * offset;
        float size = mix(5.5, 13.0, foreground) * (0.7 + hash(seed + 7.0) * 0.6);
        shape /= vec2(size, size * (0.15 + abs(cos(roll)) * 0.36));
        float form = abs(shape.x) + abs(shape.y - 0.12 * shape.x * shape.x) * 0.86;
        float edge = 1.0 - smoothstep(0.70, 1.08, form);
        float fade = smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(0.91, 1.0, age));
        vec3 tint = mix(vec3(0.30, 0.20, 0.25), vec3(0.96, 0.59, 0.26),
          0.30 + 0.35 * abs(cos(roll)) + 0.26 * foreground);
        color = mix(color, tint, edge * fade * fx * mix(0.57, 0.79, foreground));
      }
      return color;
    }

    // Intro, en pixels écran (origine en haut à gauche, sans miroir).
    const vec2 SCREEN = vec2(1840.0, 860.0);
    const vec2 DAWN = vec2(1900.0, -60.0);
    vec2 featherAt(float time) {
      vec2 fall = vec2(930.0 + 55.0 * sin(time * 1.4), mix(140.0, 540.0, smoothstep(0.3, 2.6, time)));
      float blown = smoothstep(2.3, 3.5, time);
      return fall + vec2(-1150.0, 260.0) * blown * blown;
    }
    vec2 orbAt(float time) {
      float w = time * 2.7;
      vec2 around = featherAt(min(time, 2.3)) + vec2(cos(w) * 150.0, sin(w) * 80.0 - 20.0);
      float leave = smoothstep(2.2, 3.0, time);
      return mix(around, DAWN, leave * leave);
    }
    float orbLight(vec2 q, float time) {
      float visible = smoothstep(0.35, 0.7, time) * (1.0 - smoothstep(2.75, 3.0, time));
      float light = 0.0;
      for (int k = 0; k < 14; k++) {
        float back = float(k) * 0.028;
        float d = length(q - orbAt(time - back));
        float weight = k == 0 ? 1.0 : 0.45 * (1.0 - float(k) / 14.0);
        light += weight * (exp(-d / (k == 0 ? 14.0 : 8.0)) + (0.45 * exp(-d / 70.0) + 0.18 * exp(-d / 180.0)) * (k == 0 ? 1.0 : 0.0));
      }
      return light * visible;
    }
    // Plume sombre : rachis, deux vanes inégales, barbes et quelques encoches.
    float featherShape(vec2 q, float time, out float rachis) {
      vec2 d = q - featherAt(time);
      float a = 0.9 + 0.55 * sin(time * 1.25) + 2.2 * smoothstep(2.3, 3.5, time);
      d = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
      float x = d.x / 240.0;
      rachis = (1.0 - smoothstep(2.0, 4.5, abs(d.y))) * step(-0.62, x) * step(x, 0.5);
      float side = d.y > 0.0 ? 50.0 : 36.0;
      float vane = side * clamp(1.0 - pow((x - 0.02) / 0.48, 2.0), 0.0, 1.0);
      float body = (1.0 - smoothstep(vane - 2.0, vane + 1.0, abs(d.y))) * step(-0.46, x);
      float barbs = 0.8 + 0.2 * sin((d.x * 0.9 + abs(d.y) * 1.6) * 0.45);
      float notch = step(0.86, fract(sin(floor((d.x + abs(d.y) * 0.6) / 22.0) * 91.3 + sign(d.y)) * 4375.5));
      return max(body * barbs * (1.0 - notch * smoothstep(0.4, 0.9, abs(d.y) / max(vane, 1.0))), rachis);
    }
    vec3 introTeaser(vec3 color, float time) {
      vec2 q = uv * SCREEN;
      // La nuit se lève depuis le haut à droite, avec un bord nuageux.
      float open = 2700.0 * pow(smoothstep(2.35, 4.1, time), 1.3);
      float dist = length(q - DAWN) + 220.0 * (cloudNoise(q / 150.0 + vec2(time * 0.35, 0.0)) - 0.5);
      float dawn = 1.0 - smoothstep(open - 90.0, open + 30.0, dist);
      vec3 night = vec3(0.015, 0.02, 0.045);
      color = mix(night, color, open > 0.0 ? dawn : 0.0);
      float rim = open > 0.0 ? exp(-pow((dist - open + 30.0) / 40.0, 2.0)) * (1.0 - smoothstep(3.4, 4.1, time)) : 0.0;
      color += vec3(1.0, 0.78, 0.62) * rim * 0.16;
      // Plume éclairée par la lumière d'Ori, emportée par le souffle de Ku.
      float rachis;
      float plume = featherShape(q, time, rachis) * smoothstep(0.3, 0.6, time) * (1.0 - smoothstep(3.0, 3.5, time));
      float lit = exp(-length(q - orbAt(time)) / 170.0) * (1.0 - smoothstep(2.6, 3.0, time));
      vec3 featherColor = vec3(0.10, 0.09, 0.14) + vec3(0.35, 0.62, 0.95) * lit * 0.9
        + vec3(0.5, 0.7, 0.9) * rachis * lit * 0.5;
      color = mix(color, featherColor, plume * (0.55 + 0.45 * lit));
      // Lumière d'Ori et sa traîne.
      float orb = orbLight(q, time);
      color += vec3(0.42, 0.72, 1.0) * orb + vec3(0.9, 0.97, 1.0) * orb * orb * 0.4;
      return color;
    }

    void main() {
      // Miroir du rendu entier : les calques et les effets restent dans le repère source.
      vec2 point = (vec2(1.0 - uv.x, uv.y) - 0.5) * windowSize + SIZE * 0.5;
      float cameraTravel = intro < 0.0 ? 0.0 : 1.0 - smoothstep(2.3, 5.9, intro);
      float arrival = intro < 0.0 ? 1.0 : smoothstep(2.4, 5.6, intro);
      float wingbeat = intro < 0.0 ? 0.0
        : smoothstep(4.0, 4.6, intro) * (1.0 - smoothstep(4.6, 5.6, intro));
      float windVisibility = intro < 0.0 ? 1.0 : mix(0.28, 1.0, smoothstep(4.6, 5.9, intro));
      point = mix(point, SIZE * 0.5, cameraTravel * 0.075);
      vec2 camera = vec2(62.0, -15.0) * cameraTravel;
      float flow = t + 0.44 * sin(t * 1.4);
      float gust = 0.30 + 0.70 * pow(0.5 + 0.5 * cos(t * 1.4), 3.0) + 0.14 * wingbeat;
      // Le relief du décor progresse vers le bas. Le ciel et les rochers proches
      // suivent le pointeur à des vitesses différentes, comme dans Hollow Knight.
      float depth = mix(0.35, 1.0, smoothstep(550.0, 860.0, point.y));
      vec2 air = vec2(sin(t * 0.55) * 5.0, cos(t * 0.42) * 2.5) * fx;
      vec2 skyPoint = point + (pointer * vec2(14.0, 8.0) + air) * depth;
      vec2 drift = floatingRock(t * 0.78 + 0.4, vec2(9.0, 13.0));
      if (skyPoint.x < 305.0) drift = floatingRock(t * 0.94 + 2.5, vec2(7.0, 16.0));
      else if (skyPoint.x < 680.0) drift = floatingRock(t * 1.21 + 4.2, vec2(5.0, 11.0));
      vec3 color = texture2D(sky, (skyPoint + 0.52 * camera) / SIZE).rgb;
      if (intro >= 0.0) {
        vec2 cloudPoint = skyPoint + 0.52 * camera;
        vec2 cloudUV = cloudPoint / vec2(220.0, 89.0) + vec2(t * 0.25, 0.0);
        float clouds = cloudNoise(cloudUV) * 0.68 + cloudNoise(cloudUV * 2.05) * 0.32;
        float mist = (1.0 - smoothstep(0.65, 1.35,
          length((cloudPoint - vec2(580.0, 478.0)) / vec2(550.0, 275.0))))
          * (1.0 - smoothstep(4.8, 5.9, intro));
        vec3 cloudColor = mix(vec3(0.66, 0.46, 0.51), vec3(1.0, 0.83, 0.65), clouds);
        color = mix(color, cloudColor, mist * 0.81);
      }
      vec4 rock = cutout(rockLayers, skyPoint + camera - drift);
      color = mix(color, rock.rgb, rock.a);
      color += vec3(0.72, 0.82, 1.0) * gusts(point, flow, gust) * fx * 0.29 * windVisibility;
      color = leaves(color, point + pointer * 6.0, flow, 0.0);

      vec2 body = point - SHOULDER - pointer * vec2(19.0, 10.0);
      // Ku faces left in the mirrored card. The flight begins above the right edge.
      float remaining = 1.0 - arrival;
      body += camera + vec2(1080.0 * remaining, 310.0 * remaining * remaining);
      body.y -= sin(t * 1.8) * 9.0 * fx;
      float bank = sin(t * 1.8 - 0.45) * 0.018 * fx - 0.085 * remaining;
      body = mat2(cos(bank), -sin(bank), sin(bank), cos(bank)) * body + SHOULDER;

      // Déformation continue, ancrée à l’épaule : comme la cape de Hollow Knight,
      // les extrémités plient davantage que la base, sans découper l’articulation.
      float span = 1.0 - smoothstep(390.0, 722.0, body.x);
      float band = smoothstep(280.0, 338.0, body.y) * (1.0 - smoothstep(435.0, 480.0, body.y));
      float cycle = t * 1.45;
      float surgeTime = mod(t + 0.25, 6.1);
      float flight = smoothstep(0.9, 1.45, surgeTime) * (1.0 - smoothstep(1.65, 3.05, surgeTime)) * fx;
      float stroke = (sin(cycle) + 0.30 * sin(cycle * 2.0 - 0.6) + gust * 0.45) * (fx + 0.32 * flight)
        + 0.42 * wingbeat;
      vec2 feather = body - vec2(span * band * stroke * 5.0, span * span * band * stroke * 26.0);

      vec2 halo = (body - vec2(736.0, 411.0)) / vec2(330.0, 265.0);
      float shimmer = 0.66 + 0.10 * sin(t * 1.25) + 0.23 * flight;
      color += vec3(0.19, 0.35, 0.50) * exp(-dot(halo, halo) * 1.85) * shimmer * fx;

      // Le sillage reste visible pendant tout le vol et s'éclaire à la rafale.
      vec2 wake = body - vec2(590.0, 403.0);
      float wakeLight = ((0.57 + 0.09 * sin(t * 1.3)) * fx + 0.34 * flight) * windVisibility
        + 0.1 * wingbeat;
      for (int i = 0; i < 4; i++) {
        float strip = float(i);
        float height = wake.y - sin(wake.x / 230.0 + strip * 0.64 + t * 0.65) * (26.0 + strip * 8.0)
          - strip * 30.0 + wake.x * 0.11;
        float reach = smoothstep(-610.0, -455.0, wake.x) * (1.0 - smoothstep(45.0, 185.0, wake.x));
        float current = 0.55 + 0.45 * sin(wake.x / 113.0 + t * 3.3 + strip);
        color += (vec3(0.17, 0.42, 0.72) * exp(-abs(height) / 16.0)
          + vec3(0.58, 0.78, 1.0) * exp(-abs(height) / 2.4) * current) * reach * wakeLight * 0.76;
      }

      vec4 owl = cutout(ku, feather);
      owl.rgb = eyelid(ku, owl.rgb, feather, vec2(852.0, 365.0), vec2(8.0, 18.5), -0.16,
        blink(4.7, 3.05), vec2(842.0, 345.0), vec3(0.22, 0.15, 0.15));
      color = mix(color, owl.rgb, owl.a);
      // Ori garde son point de contact et amortit le mouvement de Ku avec un léger retard.
      vec2 rider = body - vec2(sin(t * 1.8 - 0.7) * 2.0, sin(t * 1.8 - 0.8) * 3.5) * fx;
      vec4 spirit = cutout(ori, rider);
      spirit.rgb = eyelid(ori, spirit.rgb, rider, vec2(678.0, 316.0), vec2(17.5, 9.7), 0.74,
        blink(5.8, 3.15), vec2(680.0, 299.0), vec3(0.14, 0.29, 0.43));
      color = mix(color, spirit.rgb, spirit.a);
      float light = 1.0 - smoothstep(3.0, 106.0, length((rider - vec2(652.0, 319.0)) * vec2(0.85, 1.0)));
      color += vec3(0.19, 0.40, 0.65) * light * light
        * ((0.12 + 0.055 * sin(t * 2.4) + 0.42 * flight) * windVisibility + 0.16 * wingbeat) * fx;

      // Les poussières traversent la lumière à des vitesses et à des profondeurs différentes.
      for (int i = 0; i < 10; i++) {
        float seed = float(i);
        float age = fract(t * (0.045 + seed * 0.005) + seed * 0.618);
        vec2 spark = vec2(850.0 + mod(seed * 157.0, 810.0) - age * 210.0,
                        625.0 + mod(seed * 83.0, 160.0) - age * 460.0);
        float fade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.68, 1.0, age));
        float glow = exp(-length(point - spark) / (2.0 + mod(seed, 3.0)));
        color += vec3(1.0, 0.75, 0.45) * glow * fade * fx * 0.42;
      }
      // Le vent traverse aussi le premier plan. La rafale s'efface autour des visages.
      float faces = smoothstep(95.0, 230.0, length(body - vec2(735.0, 337.0)));
      float frontWind = gusts(point + vec2(-130.0, 210.0), flow * 1.24, gust);
      color += vec3(1.0, 0.83, 0.68) * frontWind * faces * fx * 0.32 * windVisibility;
      color = mix(color, leaves(color, point - pointer * 22.0, flow, 1.0), faces);
      if (intro >= 0.0) color = introTeaser(color, intro);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function mount(canvas, images, level) {
    const gl = canvas.getContext('webgl', { alpha: false });
    if (!gl) throw new Error('WebGL indisponible');
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
    const program = gl.createProgram();
    const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment)];
    shaders.forEach((shader) => gl.attachShader(program, shader));
    gl.linkProgram(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(error);
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const textures = images.map((source, index) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1i(
        gl.getUniformLocation(program, ['sky', 'ku', 'ori', 'rockLayers'][index]),
        index,
      );
      return texture;
    });

    const time = gl.getUniformLocation(program, 't');
    const introTime = gl.getUniformLocation(program, 'intro');
    const windowSize = gl.getUniformLocation(program, 'windowSize');
    const pointer = gl.getUniformLocation(program, 'pointer');
    gl.uniform1f(gl.getUniformLocation(program, 'fx'), level >= 3 ? 1 : 0);
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

    let elapsed = 0;
    let last = performance.now();
    let drawnAt = -Infinity;
    let frame;
    let intro = -1;
    let introRequested = false;
    const replay = (event) => {
      elapsed = 0;
      if (level >= 3 && event.detail?.intro && !motion.matches) intro = 0;
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
      elapsed += delta;
      if (grid && now - drawnAt < 32) return;
      drawnAt = now;
      const ratio = Math.min(devicePixelRatio * (detail ? 1.75 : 1), detail ? 2.5 : grid ? 1.5 : 2);
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const scale = Math.max(width / 1840, height / 860) * 1.035;
      look.x += (target.x - look.x) * 0.1;
      look.y += (target.y - look.y) * 0.1;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(windowSize, width / scale, height / scale);
      gl.uniform2f(pointer, -look.x, look.y);
      gl.uniform1f(time, elapsed);
      const requested = level >= 3 && Boolean(canvas.closest('[data-card-intro]'));
      if (requested && !introRequested) intro = 0;
      introRequested = requested;
      // data-card-intro-time fige l'intro à un instant donné pour la vérifier image par image.
      const forcedIntro = level >= 3 ? canvas.dataset.cardIntroTime : undefined;
      if (forcedIntro !== undefined) intro = Number(forcedIntro);
      gl.uniform1f(introTime, intro);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (intro >= 0 && forcedIntro === undefined) {
        intro += delta;
        if (requested && intro >= INTRO_REVEAL && intro - delta < INTRO_REVEAL) {
          canvas.dispatchEvent(new Event('card-intro-reveal', { bubbles: true }));
        }
        if (intro >= introDuration) intro = -1;
      }
    }
    draw(last);
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('achievers:card-motion', cardMove);
      canvas.removeEventListener('achievers:card-replay', replay);
      textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }

  (window.AchieversCards ??= {})['ori-mythique'] = {
    async mount(canvas, level = 3) {
      const images = await (layers ??= Promise.all([
        image('sky-clean.jpg'),
        image('ku.png'),
        image('ori.png'),
        image('rocks.png'),
      ]));
      return mount(canvas, images, level);
    },
  };
})();
