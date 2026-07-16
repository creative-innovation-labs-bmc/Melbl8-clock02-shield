// Particle Clock - Exact Leaf Batch QC v3
// Uses the user's exact leaf silhouette, recoloured into a small batch.
// Default is tuned for NVIDIA Shield signage.

p5.disableFriendlyErrors = true;

const DISPLAY_W = 3840;
const DISPLAY_H = 804;

// 'shield-safe' is the recommended default for NVIDIA Shield signage.
const PRESET = 'shield-safe';
// Choose '32' for NVIDIA Shield. Use '64' only for stronger devices if you want higher sprite detail.
const LEAF_SET = '32';

const PRESETS = {
  quality: {
    RENDER_SCALE: 0.60,
    TARGET_FPS: 30,
    PARTICLES_PER_ZONE: 240,
    BLUEPRINT_LAYERS: 4,
    DIGIT_SAMPLE_FACTOR: 0.16,
    JITTER_RANGE: 8,
    MOTION_BLEND: 0.20,
    SIZE_MIN: 22,
    SIZE_MAX: 34
  },
  balanced: {
    RENDER_SCALE: 0.55,
    TARGET_FPS: 30,
    PARTICLES_PER_ZONE: 220,
    BLUEPRINT_LAYERS: 4,
    DIGIT_SAMPLE_FACTOR: 0.15,
    JITTER_RANGE: 8,
    MOTION_BLEND: 0.19,
    SIZE_MIN: 21,
    SIZE_MAX: 32
  },
  'shield-safe': {
    RENDER_SCALE: 0.50,
    TARGET_FPS: 30,
    PARTICLES_PER_ZONE: 200,
    BLUEPRINT_LAYERS: 3,
    DIGIT_SAMPLE_FACTOR: 0.14,
    JITTER_RANGE: 7,
    MOTION_BLEND: 0.18,
    SIZE_MIN: 20,
    SIZE_MAX: 30
  }
};

const CFG = PRESETS[PRESET];
const RENDER_SCALE = CFG.RENDER_SCALE;
const TARGET_FPS = CFG.TARGET_FPS;
const PARTICLES_PER_ZONE = CFG.PARTICLES_PER_ZONE;
const BLUEPRINT_LAYERS = CFG.BLUEPRINT_LAYERS;
const DIGIT_SAMPLE_FACTOR = CFG.DIGIT_SAMPLE_FACTOR;
const JITTER_RANGE = CFG.JITTER_RANGE;
const MOTION_BLEND = CFG.MOTION_BLEND;
const SIZE_MIN = CFG.SIZE_MIN;
const SIZE_MAX = CFG.SIZE_MAX;

const BG = '#1C1B1C';
const LABEL = '#BBC6C3';
const LOCATION_TEXT = 'MELBOURNE, AUSTRALIA';
const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];
const DAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'
];

let canvas;
let mainFont, footerFont, sidebarFont;
let leafSprites = [];
let digitPoints = {};
let zones = [];
let lastDigits = [];
let lastSecond = -1;
let pulse = 0;
let footerTime = '00:00:00';
let dateText = '';
let todayStamp = '';

function preload() {
  mainFont = loadFont('MP-B.ttf');
  footerFont = loadFont('MS-Bk.otf');
  sidebarFont = loadFont('MP-M.ttf');

  const leafFolder = LEAF_SET === '64' ? 'leaves_64' : 'leaves_32';
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(2, '0');
    leafSprites.push(loadImage(`${leafFolder}/leaf_${n}.png`));
  }
}

function setup() {
  const renderW = Math.round(DISPLAY_W * RENDER_SCALE);
  const renderH = Math.round(DISPLAY_H * RENDER_SCALE);

  canvas = createCanvas(renderW, renderH);
  canvas.parent('stage');
  canvas.style('width', `${DISPLAY_W}px`);
  canvas.style('height', `${DISPLAY_H}px`);
  pixelDensity(1);
  frameRate(TARGET_FPS);
  imageMode(CENTER);

  buildDigitCache();
  initZones();
  refreshClockState(true);
}

function draw() {
  background(BG);
  refreshClockState(false);
  drawVerticalDividers();
  updateAndDrawZones();
  drawOverlayLayout();
  pulse *= 0.80;
}

function refreshClockState(force) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const digits = [hh[0], hh[1], mm[0], mm[1]];
  const sec = now.getSeconds();

  if (force || sec !== lastSecond) {
    pulse = 1;
    lastSecond = sec;
    footerTime = `${hh}:${mm}:${ss}`;
    const newTodayStamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (force || newTodayStamp !== todayStamp) {
      todayStamp = newTodayStamp;
      dateText = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} ${DAYS[now.getDay()]}`;
    }
  }

  for (let z = 0; z < 4; z++) {
    if (force || digits[z] !== lastDigits[z]) {
      assignTargetsToZone(z, digits[z]);
    }
  }

  lastDigits = digits;
}

function buildDigitCache() {
  const size = 720 * RENDER_SCALE;
  for (let d = 0; d <= 9; d++) {
    const ch = String(d);
    const bounds = mainFont.textBounds(ch, 0, 0, size);
    const x = -bounds.x - bounds.w / 2;
    const y = -bounds.y - bounds.h / 2;
    const pts = mainFont.textToPoints(ch, x, y, size, {
      sampleFactor: DIGIT_SAMPLE_FACTOR,
      simplifyThreshold: 0
    });
    digitPoints[ch] = pts.map(p => ({ x: p.x, y: p.y }));
  }
}

function initZones() {
  zones = [];
  const zoneW = width / 4;
  const centerY = height * 0.50;
  for (let z = 0; z < 4; z++) {
    const centerX = zoneW * z + zoneW / 2;
    const particles = [];
    for (let i = 0; i < PARTICLES_PER_ZONE; i++) {
      particles.push(new Particle(centerX, centerY, zoneW));
    }
    zones.push({
      centerX,
      centerY,
      particles,
      currentDigit: '0',
      seed: floor(random(1000))
    });
  }
}

function assignTargetsToZone(zoneIndex, digit) {
  const zone = zones[zoneIndex];
  const pts = digitPoints[digit] || [];
  if (!zone || pts.length === 0) return;

  const len = pts.length;
  const stride = 37;
  const baseOffset = (zone.seed + zoneIndex * 59) % len;

  for (let i = 0; i < zone.particles.length; i++) {
    const p = zone.particles[i];
    const pt = pts[(baseOffset + i * stride) % len];
    p.setTarget(zone.centerX + pt.x + p.jitter.x, zone.centerY + pt.y + p.jitter.y);
  }

  zone.currentDigit = digit;
  zone.seed = (zone.seed + 97) % 100000;
}

function drawVerticalDividers() {
  const zoneW = width / 4;
  stroke(255, 255, 255, 18);
  strokeWeight(1);
  for (let i = 1; i < 4; i++) {
    const x = i * zoneW;
    line(x, 0, x, height);
  }
}

function updateAndDrawZones() {
  for (let z = 0; z < zones.length; z++) {
    const zone = zones[z];
    drawDigitBlueprint(zone.currentDigit, zone.centerX, zone.centerY);
    const particles = zone.particles;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.update();
      p.draw();
    }
  }
}

function drawDigitBlueprint(ch, cx, cy) {
  const size = 720 * RENDER_SCALE;
  push();
  translate(cx, cy);
  textAlign(CENTER, CENTER);
  textFont(mainFont);
  textSize(size);
  noFill();
  for (let i = 0; i < BLUEPRINT_LAYERS; i++) {
    const t = frameCount * 0.018 + i * 0.8;
    const offX = Math.sin(t * 1.3) * (9 * RENDER_SCALE) * (i + 1) * 0.34;
    const offY = Math.cos(t * 1.0) * (9 * RENDER_SCALE) * (i + 1) * 0.34;
    const a = map(i, 0, Math.max(1, BLUEPRINT_LAYERS - 1), 18, 34);
    stroke(188, 198, 195, a);
    strokeWeight(1 * RENDER_SCALE + 0.15);
    text(ch, offX, offY);
  }
  pop();
}

function drawOverlayLayout() {
  const zoneW = width / 4;
  for (let i = 0; i < 4; i++) {
    const startX = i * zoneW;

    push();
    noStroke();
    fill(255);
    textAlign(LEFT, BOTTOM);
    textFont(footerFont);
    textSize(40 * RENDER_SCALE);
    text(footerTime, startX + 40 * RENDER_SCALE, height - 24 * RENDER_SCALE);
    pop();

    push();
    translate(startX + zoneW - 34 * RENDER_SCALE, 40 * RENDER_SCALE);
    rotate(-HALF_PI);
    textAlign(RIGHT, CENTER);
    noStroke();
    fill(LABEL);
    textFont(sidebarFont);
    textSize(16 * RENDER_SCALE);
    text(LOCATION_TEXT, 0, 0);
    pop();

    push();
    translate(startX + zoneW - 34 * RENDER_SCALE, height - 34 * RENDER_SCALE);
    rotate(-HALF_PI);
    textAlign(LEFT, CENTER);
    noStroke();
    fill(LABEL);
    textFont(sidebarFont);
    textSize(16 * RENDER_SCALE);
    text(dateText, 0, 0);
    pop();
  }
}

class Particle {
  constructor(cx, cy, zoneW) {
    this.pos = createVector(
      cx + random(-zoneW * 0.22, zoneW * 0.22),
      cy + random(-height * 0.32, height * 0.32)
    );
    this.target = this.pos.copy();
    this.vel = createVector();
    this.baseSize = random(SIZE_MIN, SIZE_MAX) * RENDER_SCALE;
    this.rotation = random(TWO_PI);
    this.rotSpeed = random(-0.022, 0.022);
    this.leaf = random(leafSprites);
    this.jitter = createVector(random(-JITTER_RANGE, JITTER_RANGE) * RENDER_SCALE, random(-JITTER_RANGE, JITTER_RANGE) * RENDER_SCALE);
    this.motionSeed = random(1000);
  }

  setTarget(x, y) {
    this.target.set(x, y);
  }

  update() {
    const steer = p5.Vector.sub(this.target, this.pos);
    const d = steer.mag();

    if (d > 0.01) {
      const nearDist = 36 * RENDER_SCALE;
      const maxSpeed = 5.6 * RENDER_SCALE;
      const speed = d < nearDist ? map(d, 0, nearDist, 0, maxSpeed) : maxSpeed;
      steer.setMag(speed);
      this.vel.lerp(steer, MOTION_BLEND);
    }

    if (pulse > 0.02) {
      const ang = frameCount * 0.10 + this.motionSeed;
      this.vel.x += Math.cos(ang) * pulse * 0.16 * RENDER_SCALE;
      this.vel.y += Math.sin(ang * 1.25) * pulse * 0.16 * RENDER_SCALE;
    }

    this.pos.add(this.vel);
    this.vel.mult(0.86);
    this.rotation += this.rotSpeed;
  }

  draw() {
    const size = this.baseSize * (1 + pulse * 0.14);
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.rotation);
    image(this.leaf, 0, 0, size, size);
    pop();
  }
}
