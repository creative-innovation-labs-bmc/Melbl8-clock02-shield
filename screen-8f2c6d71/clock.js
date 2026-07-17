'use strict';

/*
  Efficient filled-leaf clock for NVIDIA Shield signage.
  No p5.js. The visible canvas is 1920x402 and CSS scales it to 3840x804.
  Leaves use the exact sprite_32.png silhouette.
*/

const PROFILE = 'shield';
const PROFILES = {
  shield: {
    particlesPerZone: 220,
    targetFps: 30,
    maskSpacing: 10,
    blueprintLayers: 4,
    leafSizes: [15, 18, 21, 24]
  },
  balanced: {
    particlesPerZone: 240,
    targetFps: 30,
    maskSpacing: 9,
    blueprintLayers: 5,
    leafSizes: [15, 18, 21, 24]
  }
};

const CFG = PROFILES[PROFILE];
const BASE_W = 1920;
const BASE_H = 402;
const ZONE_W = BASE_W / 4;
const FRAME_MS = 1000 / CFG.targetFps;
const PARTICLES_PER_ZONE = CFG.particlesPerZone;
const TOTAL_PARTICLES = PARTICLES_PER_ZONE * 4;
const DIGIT_Y = 194;
const FALLBACK_DIGIT_FONT = '900 468px "Arial Black", Impact, sans-serif';
const LEAF_COLOURS = ['#89C925','#7FB832','#6FA13D','#577740','#9AD83A','#789A46','#A5D95A','#4F6A3C'];
const ROTATIONS = 12;
const TILE = 32;
const ATLAS_COLS = 24;
const BG = '#1C1B1C';

const staticCanvas = document.getElementById('static-layer');
const leafCanvas = document.getElementById('leaf-layer');
const staticCtx = staticCanvas.getContext('2d', { alpha: false });
const leafCtx = leafCanvas.getContext('2d', { alpha: true, desynchronized: true });
leafCtx.imageSmoothingEnabled = true;

const x = new Float32Array(TOTAL_PARTICLES);
const y = new Float32Array(TOTAL_PARTICLES);
const tx = new Float32Array(TOTAL_PARTICLES);
const ty = new Float32Array(TOTAL_PARTICLES);
const vx = new Float32Array(TOTAL_PARTICLES);
const vy = new Float32Array(TOTAL_PARTICLES);
const phase = new Float32Array(TOTAL_PARTICLES);
const spin = new Float32Array(TOTAL_PARTICLES);
const baseRot = new Uint8Array(TOTAL_PARTICLES);
const colourIndex = new Uint8Array(TOTAL_PARTICLES);
const sizeIndex = new Uint8Array(TOTAL_PARTICLES);
const targetsByDigit = new Array(10);

let digitFont = FALLBACK_DIGIT_FONT;
let footerFont = '700 20px Georgia, serif';
let sideFont = '600 8px Arial, sans-serif';
let atlasSource = null;
let currentDigits = ['', '', '', ''];
let lastSecond = -1;
let pulse = 0;
let lastFrame = 0;
let leafImage = null;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const debugElement = document.getElementById('debug');
let debugFrames = 0;
let debugStart = performance.now();
let debugDrawAverage = 0;
if (DEBUG) debugElement.hidden = false;

function seededRandom(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function loadFont(name, url, cssValue) {
  if (!('FontFace' in window)) return false;
  try {
    const face = new FontFace(name, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    if (name === 'ClockMain') digitFont = `468px "${name}"`;
    if (name === 'ClockFooter') footerFont = `20px "${name}"`;
    if (name === 'ClockSide') sideFont = `8px "${name}"`;
    return true;
  } catch {
    return false;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function buildAtlas() {
  const sizes = CFG.leafSizes;
  const spriteCount = LEAF_COLOURS.length * sizes.length * ROTATIONS;
  const rows = Math.ceil(spriteCount / ATLAS_COLS);
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_COLS * TILE;
  atlas.height = rows * TILE;
  const ctx = atlas.getContext('2d');

  const colouredLeaves = LEAF_COLOURS.map(colour => {
    const recoloured = document.createElement('canvas');
    recoloured.width = TILE;
    recoloured.height = TILE;
    const c = recoloured.getContext('2d');
    c.drawImage(leafImage, 0, 0, TILE, TILE);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = colour;
    c.fillRect(0, 0, TILE, TILE);
    c.globalCompositeOperation = 'source-over';
    return recoloured;
  });

  let sprite = 0;
  for (let colour = 0; colour < LEAF_COLOURS.length; colour++) {
    for (let size = 0; size < sizes.length; size++) {
      for (let rotation = 0; rotation < ROTATIONS; rotation++) {
        const cellX = (sprite % ATLAS_COLS) * TILE;
        const cellY = Math.floor(sprite / ATLAS_COLS) * TILE;
        const angle = rotation * Math.PI * 2 / ROTATIONS;
        const leafSize = sizes[size];
        ctx.save();
        ctx.translate(cellX + TILE / 2, cellY + TILE / 2);
        ctx.rotate(angle);
        ctx.drawImage(colouredLeaves[colour], -leafSize / 2, -leafSize / 2, leafSize, leafSize);
        ctx.restore();
        sprite++;
      }
    }
  }

  return atlas;
}

function buildFilledTargets() {
  const mask = document.createElement('canvas');
  mask.width = ZONE_W;
  mask.height = BASE_H;
  const ctx = mask.getContext('2d', { willReadFrequently: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = digitFont;

  for (let digit = 0; digit <= 9; digit++) {
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(digit), ZONE_W / 2, DIGIT_Y);

    const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data;
    const candidates = [];
    const spacing = CFG.maskSpacing;

    for (let row = 0, py = 3; py < mask.height - 3; row++, py += spacing) {
      const offset = row & 1 ? spacing / 2 : 0;
      for (let px = 3 + offset; px < mask.width - 3; px += spacing) {
        const sampleX = Math.round(px);
        const sampleY = Math.round(py);
        const alpha = pixels[(sampleY * mask.width + sampleX) * 4 + 3];
        if (alpha > 110) candidates.push([px - ZONE_W / 2, py - DIGIT_Y]);
      }
    }

    const random = seededRandom(9001 + digit * 311);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const temp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = temp;
    }

    const chosen = new Array(PARTICLES_PER_ZONE);
    const step = candidates.length / PARTICLES_PER_ZONE;
    for (let i = 0; i < PARTICLES_PER_ZONE; i++) {
      chosen[i] = candidates[Math.floor(i * step) % candidates.length];
    }
    targetsByDigit[digit] = chosen;
  }
}

function initialiseParticles() {
  const random = seededRandom(20260716);
  for (let zone = 0; zone < 4; zone++) {
    const centreX = zone * ZONE_W + ZONE_W / 2;
    for (let i = 0; i < PARTICLES_PER_ZONE; i++) {
      const index = zone * PARTICLES_PER_ZONE + i;
      x[index] = centreX + (random() - 0.5) * 180;
      y[index] = DIGIT_Y + (random() - 0.5) * 250;
      tx[index] = x[index];
      ty[index] = y[index];
      phase[index] = random() * Math.PI * 2;
      spin[index] = 0.35 + random() * 0.75;
      baseRot[index] = Math.floor(random() * ROTATIONS);
      colourIndex[index] = Math.floor(random() * LEAF_COLOURS.length);
      const q = random();
      sizeIndex[index] = q < 0.18 ? 0 : q < 0.62 ? 1 : q < 0.9 ? 2 : 3;
    }
  }
}

function assignDigit(zone, digit, snap) {
  const points = targetsByDigit[digit];
  const random = seededRandom(411 + zone * 1009 + Number(digit) * 97);
  const centreX = zone * ZONE_W + ZONE_W / 2;
  const start = zone * PARTICLES_PER_ZONE;

  for (let i = 0; i < PARTICLES_PER_ZONE; i++) {
    const index = start + i;
    const point = points[i];
    tx[index] = centreX + point[0] + (random() - 0.5) * 5;
    ty[index] = DIGIT_Y + point[1] + (random() - 0.5) * 5;
    if (snap) {
      x[index] = tx[index];
      y[index] = ty[index];
      vx[index] = 0;
      vy[index] = 0;
    }
  }

  currentDigits[zone] = String(digit);
}

function drawStaticLayer(now) {
  staticCtx.fillStyle = BG;
  staticCtx.fillRect(0, 0, BASE_W, BASE_H);
  staticCtx.textAlign = 'center';
  staticCtx.textBaseline = 'middle';
  staticCtx.font = digitFont;
  staticCtx.lineWidth = 0.75;

  for (let zone = 0; zone < 4; zone++) {
    const centreX = zone * ZONE_W + ZONE_W / 2;
    for (let layer = 0; layer < CFG.blueprintLayers; layer++) {
      const angle = zone * 2.1 + layer * 1.7;
      const offsetX = Math.sin(angle) * layer * 2.6;
      const offsetY = Math.cos(angle * 0.8) * layer * 1.7;
      staticCtx.strokeStyle = `rgba(188,198,195,${0.055 + layer * 0.012})`;
      staticCtx.strokeText(currentDigits[zone], Math.round(centreX + offsetX), Math.round(DIGIT_Y + offsetY));
    }
  }

  staticCtx.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let i = 1; i < 4; i++) {
    const dividerX = Math.round(i * ZONE_W) + 0.5;
    staticCtx.beginPath();
    staticCtx.moveTo(dividerX, 0);
    staticCtx.lineTo(dividerX, BASE_H);
    staticCtx.stroke();
  }

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const time = `${hours}:${minutes}:${seconds}`;
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const date = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} ${days[now.getDay()]}`;

  staticCtx.fillStyle = '#fff';
  staticCtx.font = footerFont;
  staticCtx.textAlign = 'left';
  staticCtx.textBaseline = 'alphabetic';
  for (let zone = 0; zone < 4; zone++) {
    staticCtx.fillText(time, zone * ZONE_W + 20, BASE_H - 15);
  }

  staticCtx.fillStyle = '#BBC6C3';
  staticCtx.font = sideFont;
  for (let zone = 0; zone < 4; zone++) {
    const sideX = zone * ZONE_W + ZONE_W - 18;
    staticCtx.save();
    staticCtx.translate(sideX, 20);
    staticCtx.rotate(-Math.PI / 2);
    staticCtx.textAlign = 'right';
    staticCtx.textBaseline = 'middle';
    staticCtx.fillText('MELBOURNE, AUSTRALIA', 0, 0);
    staticCtx.restore();

    staticCtx.save();
    staticCtx.translate(sideX, BASE_H - 20);
    staticCtx.rotate(-Math.PI / 2);
    staticCtx.textAlign = 'left';
    staticCtx.textBaseline = 'middle';
    staticCtx.fillText(date, 0, 0);
    staticCtx.restore();
  }
}

function updateClock(force) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const digits = [hours[0], hours[1], minutes[0], minutes[1]];
  const second = now.getSeconds();
  let redrawStatic = force;

  if (force || second !== lastSecond) {
    lastSecond = second;
    pulse = 1;
    redrawStatic = true;
  }

  for (let zone = 0; zone < 4; zone++) {
    if (force || digits[zone] !== currentDigits[zone]) {
      assignDigit(zone, digits[zone], force);
      redrawStatic = true;
    }
  }

  if (redrawStatic) drawStaticLayer(now);
}

function updateParticles(deltaFrames, nowMs) {
  const slowRadius = 58;
  const maxSpeed = 4;
  const steering = 0.145;
  const damping = 0.875;
  const impulse = pulse * 0.16;

  for (let index = 0; index < TOTAL_PARTICLES; index++) {
    const deltaX = tx[index] - x[index];
    const deltaY = ty[index] - y[index];
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;

    if (distanceSquared > 0.04) {
      const distance = Math.sqrt(distanceSquared);
      const speed = distance < slowRadius ? maxSpeed * distance / slowRadius : maxSpeed;
      const desiredX = deltaX / distance * speed;
      const desiredY = deltaY / distance * speed;
      vx[index] += (desiredX - vx[index]) * steering;
      vy[index] += (desiredY - vy[index]) * steering;
    }

    if (impulse > 0.003) {
      const angle = phase[index] + nowMs * 0.00065;
      vx[index] += Math.cos(angle) * impulse;
      vy[index] += Math.sin(angle * 1.17) * impulse;
    }

    x[index] += vx[index] * deltaFrames;
    y[index] += vy[index] * deltaFrames;
    vx[index] *= damping;
    vy[index] *= damping;
  }
}

function atlasIndex(colour, size, rotation) {
  return (colour * CFG.leafSizes.length + size) * ROTATIONS + rotation;
}

function drawLeaves(nowMs) {
  const debugDrawStart = DEBUG ? performance.now() : 0;
  leafCtx.clearRect(0, 0, BASE_W, BASE_H);
  const rotationTick = Math.floor(nowMs / 180);

  for (let index = 0; index < TOTAL_PARTICLES; index++) {
    const rotation = (baseRot[index] + Math.floor(rotationTick * spin[index])) % ROTATIONS;
    const sprite = atlasIndex(colourIndex[index], sizeIndex[index], rotation);
    const sourceX = (sprite % ATLAS_COLS) * TILE;
    const sourceY = Math.floor(sprite / ATLAS_COLS) * TILE;
    leafCtx.drawImage(
      atlasSource,
      sourceX, sourceY, TILE, TILE,
      Math.round(x[index] - TILE / 2), Math.round(y[index] - TILE / 2), TILE, TILE
    );
  }
  if (DEBUG) debugDrawAverage = debugDrawAverage * 0.94 + (performance.now() - debugDrawStart) * 0.06;
}

function animationLoop(nowMs) {
  requestAnimationFrame(animationLoop);
  if (document.hidden || nowMs - lastFrame < FRAME_MS) return;

  const deltaFrames = Math.min(2, (nowMs - lastFrame) / FRAME_MS || 1);
  lastFrame = nowMs - (nowMs - lastFrame) % FRAME_MS;

  updateClock(false);
  updateParticles(deltaFrames, nowMs);
  drawLeaves(nowMs);
  pulse *= 0.79;

  if (DEBUG) {
    debugFrames++;
    if (nowMs - debugStart >= 1000) {
      const fps = debugFrames * 1000 / (nowMs - debugStart);
      debugElement.textContent = `${fps.toFixed(0)} fps · ${debugDrawAverage.toFixed(1)} ms draw · ${TOTAL_PARTICLES} leaves`;
      debugFrames = 0;
      debugStart = nowMs;
    }
  }
}

async function start() {
  await Promise.all([
    loadFont('ClockMain', 'MP-B.ttf'),
    loadFont('ClockFooter', 'MS-Bk.otf'),
    loadFont('ClockSide', 'MP-M.ttf')
  ]);

  leafImage = await loadImage('sprite_32.png');
  buildFilledTargets();
  initialiseParticles();

  const atlas = buildAtlas();
  if ('createImageBitmap' in window) {
    try {
      atlasSource = await createImageBitmap(atlas);
    } catch {
      atlasSource = atlas;
    }
  } else {
    atlasSource = atlas;
  }

  updateClock(true);
  drawLeaves(performance.now());
  requestAnimationFrame(animationLoop);
}

start().catch(() => {
  staticCtx.fillStyle = BG;
  staticCtx.fillRect(0, 0, BASE_W, BASE_H);
});
