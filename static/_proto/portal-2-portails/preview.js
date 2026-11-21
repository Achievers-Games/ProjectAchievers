const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const pause = document.querySelector('#pause');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const W = canvas.width;
const H = canvas.height;
const tau = Math.PI * 2;
const cycle = 7.4;
const portals = [
  { x: 176, y: 242, color: '55,174,255', dir: 1 },
  { x: 744, y: 219, color: '255,125,36', dir: -1 },
];

function ellipse(x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, tau);
}

function chamber() {
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#111920');
  wall.addColorStop(.7, '#32404b');
  wall.addColorStop(1, '#101720');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  for (let y = 16; y < 344; y += 52) {
    for (let x = 0; x < W; x += 116) {
      ctx.fillStyle = (x + y) % 3 ? '#ffffff08' : '#03060835';
      ctx.fillRect(x + 2, y + 2, 112, 48);
      ctx.fillStyle = '#090e19';
      ctx.fillRect(x + 1, y + 50, 114, 2);
    }
  }
  ctx.fillStyle = '#131d28';
  ctx.fillRect(0, 356, W, 74);
  ctx.strokeStyle = '#53657460';
  ctx.beginPath();
  for (let x = -340; x < 1300; x += 85) {
    ctx.moveTo(460 + (x - 460) * .52, 356);
    ctx.lineTo(x, H);
  }
  for (const y of [356, 374, 400]) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
}

function portal(gate, time, pulse, rimOnly = false) {
  const { x, y, color } = gate;
  const tint = (alpha) => `rgba(${color},${alpha})`;
  ctx.save();
  if (!rimOnly) {
    const glow = ctx.createRadialGradient(x, y, 15, x, y, 177);
    glow.addColorStop(0, tint(.26 + pulse * .21));
    glow.addColorStop(1, tint(0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - 180, y - 180, 360, 360);
    ellipse(x, y, 41, 101);
    ctx.fillStyle = '#080f1c';
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 7; i++) {
      const phase = ((time * .65 + i / 7) % 1);
      ellipse(x, y, 7 + phase * 39, 15 + phase * 93);
      ctx.strokeStyle = tint(Math.sin(phase * Math.PI) * .52);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.translate(x, y);
  ctx.scale(1, 2.45);
  ctx.shadowColor = tint(1);
  ctx.shadowBlur = 20 + pulse * 18;
  ctx.strokeStyle = tint(rimOnly ? .83 : .98);
  ctx.lineWidth = rimOnly ? 2 : 5;
  ctx.beginPath();
  const start = rimOnly ? (gate.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
  ctx.arc(0, 0, 41, start, start + (rimOnly ? Math.PI : tau));
  ctx.stroke();
  ctx.restore();
  if (rimOnly) return;
  for (let i = 0; i < 25; i++) {
    const age = (time * (.43 + i % 4 * .04) + i * .618) % 1;
    const angle = i * 2.399 + time * .36;
    const px = x + Math.cos(angle) * (40 + age * 45);
    const py = y + Math.sin(angle) * (96 + age * 42);
    ellipse(px, py, 1 + (1 - age) * 1.6, 1 + (1 - age) * 1.6);
    ctx.fillStyle = tint((1 - age) * (.66 + pulse * .3));
    ctx.fill();
  }
}

function robot(image, progress, reverse) {
  const entry = portals[reverse ? 1 : 0];
  const exit = portals[reverse ? 0 : 1];
  const dir = entry.dir;
  const jump = Math.sin(Math.PI * progress);
  const x = entry.x - dir * 96 + (exit.x - entry.x + dir * 192) * progress;
  const y = entry.y + (exit.y - entry.y) * progress - jump * (reverse ? 31 : 94);
  const height = reverse ? 200 : 158;
  const width = height * image.naturalWidth / image.naturalHeight;

  ctx.save();
  // The chamber and the two apertures form one visibility mask.
  ctx.beginPath();
  ctx.rect(portals[0].x, 0, portals[1].x - portals[0].x, H);
  for (const { x: px, y: py } of portals) {
    ctx.moveTo(px + 40, py);
    ctx.ellipse(px, py, 40, 100, 0, 0, tau);
  }
  ctx.clip();

  ctx.translate(x, y);
  ctx.rotate(dir * (Math.cos(Math.PI * progress) * .30 + jump * .10));
  ctx.scale(reverse ? -1 : 1, 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

async function load(path) {
  const image = new Image();
  image.src = path;
  await image.decode();
  return image;
}

try {
  const [atlas, pBody] = await Promise.all([load('./atlas.png'), load('./p-body.png')]);
  function draw(time) {
    const t = time % cycle;
    const bluePulse = Math.max(0, 1 - Math.min(Math.abs(t - .67), Math.abs(t - 6.72)) * 3);
    const orangePulse = Math.max(0, 1 - Math.min(Math.abs(t - 3.03), Math.abs(t - 4.25)) * 3);
    chamber();
    portal(portals[0], t, bluePulse);
    portal(portals[1], t, orangePulse);
    if (t >= .30 && t < 3.40) robot(atlas, (t - .30) / 3.10, false);
    if (t >= 3.87 && t < 7.12) robot(pBody, (t - 3.87) / 3.25, true);
    portal(portals[0], t, bluePulse, true);
    portal(portals[1], t, orangePulse, true);
  }

  let time = motion.matches ? 1.8 : 0;
  let playing = !motion.matches;
  let frame = 0;
  let previous;
  function tick(now) {
    if (previous !== undefined) time += Math.min((now - previous) / 1000, .05);
    previous = now;
    draw(time);
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = undefined;
    pause.textContent = playing ? 'Pause' : 'Lire';
    draw(time);
    if (playing && !document.hidden) frame = requestAnimationFrame(tick);
  }
  document.querySelector('#restart').onclick = () => {
    time = 0;
    playing = true;
    sync();
  };
  pause.onclick = () => {
    playing = !playing;
    sync();
  };
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', () => {
    playing = !motion.matches;
    sync();
  });
  sync();
} catch (error) {
  document.querySelector('#status').textContent = 'Les illustrations du prototype n’ont pas pu être chargées.';
  console.error(error);
}
