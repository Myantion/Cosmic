const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');
const gl = canvas.getContext('webgl2', {
  alpha: true,
  premultipliedAlpha: false,
  antialias: true,
  preserveDrawingBuffer: false,
});

if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;padding:20px">需要 WebGL2 支持</p>';
  throw new Error('WebGL2 not supported');
}

const VERT = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_variant;   // 0=Interstellar斜视 1=EHT环视 2=侧视狭缝
uniform vec2 u_pan;
uniform float u_rs;
uniform float u_viewRef;
uniform vec3 u_diskHot;
uniform vec3 u_diskWarm;
uniform vec3 u_diskCool;

out vec4 fragColor;

#define PI 3.14159265359
#define TAU 6.28318530718

// --- Hash & noise ---

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

// --- Star field (background for lensing) ---

vec3 starField(vec3 rd) {
  vec2 uv = vec2(atan(rd.z, rd.x) / TAU + 0.5, rd.y * 0.5 + 0.5);
  vec2 p = uv * 6.0;
  vec3 col = vec3(0.0);

  for (int layer = 0; layer < 3; layer++) {
    float scale = float(layer + 1) * 2.1;
    vec2 g = floor(p * scale);
    vec2 f = fract(p * scale) - 0.5;
    float h = hash21(g + float(layer) * 17.0);
    if (h > 0.993 - float(layer) * 0.003) {
      float d = length(f);
      float b = exp(-d * d * 900.0 * (1.0 + h));
      vec3 starCol = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.88, 0.65), hash11(h * 100.0));
      col += starCol * b * (0.55 + 0.45 * sin(u_time * (1.0 + h * 3.0) + h * TAU));
    }
  }

  float neb = fbm(uv * 4.0 + u_time * 0.008);
  col += vec3(0.03, 0.025, 0.07) * neb * 0.35;
  return col;
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

// --- Accretion disk emissivity (equatorial plane) ---

vec3 sampleDisk(vec2 xz, float r, float rs) {
  float innerR = rs * 2.12;
  float outerR = rs * 9.5;
  if (r < innerR * 0.98 || r > outerR + rs * 0.08) return vec3(0.0);

  float sn = xz.y / r;
  float cs = xz.x / r;
  float omega = sqrt(rs / max(r, innerR));
  float rot = u_time * 0.30 * omega * 4.0;
  float cR = cos(rot), sR = sin(rot);

  // 笛卡尔旋转坐标 — 避免 atan 在 ±π 处的色差接缝
  vec2 q = vec2(cs * cR + sn * sR, -cs * sR + sn * cR);
  float lr = log(r / rs);

  // 多层柔和噪声
  float turb = fbm3(q * 1.8 + vec2(lr * 0.55, lr * 0.25));
  turb += 0.35 * fbm3(q * 4.2 + lr * 0.4);
  turb /= 1.35;
  turb = smoothstep(0.18, 0.85, turb);
  turb = mix(0.40, 1.0, turb);

  float radial = pow((outerR - r) / (outerR - innerR), 0.58);

  // 保留多层螺旋，略抬暗部让盘缝更连续
  float swirl = sin(q.x * 3.8 + q.y * 2.6 + lr * 2.2 + turb * 1.8);
  swirl = 0.81 + 0.19 * swirl;

  float innerEdge = smoothstep(innerR, innerR + rs * 0.18, r);
  float outerEdge = 1.0 - smoothstep(outerR - rs * 1.05, outerR - rs * 0.04, r);
  float innerGlow = exp(-pow((r - innerR * 1.06) / (rs * 0.10), 2.0));

  float beta = 0.38 * omega;
  float doppler = pow(clamp(1.0 + beta * q.y, 0.15, 3.2), 2.6);

  vec3 hot  = u_diskHot;
  vec3 warm = u_diskWarm;
  vec3 cool = u_diskCool;

  vec3 c = mix(cool, warm, radial);
  c = mix(c, hot, radial * radial * turb);
  // 仅最外 fade 带（约 15% 盘宽）向暖色收，盘主体保持原色
  float inOuterFade = 1.0 - smoothstep(0.12, 0.88, outerEdge);
  c = mix(c, mix(warm, hot, 0.62), inOuterFade * 0.72);

  float brightness = radial * turb * swirl * doppler * innerEdge * outerEdge;
  brightness *= 1.0 + innerGlow * 3.5;
  brightness = max(brightness, innerEdge * radial * mix(0.055, 0.0, 1.0 - outerEdge));
  return c * brightness * 5.8;
}

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
}

mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
}

// --- Schwarzschild geodesic ray march (Interstellar-style lensing) ---

vec4 renderBlackHole(vec2 uv) {
  float rs = u_rs;
  vec2 p = uv + u_pan * 0.08;

  float pitch, roll, camY, camZ, fov;
  if (u_variant < 0.5) {
    pitch = -0.22; roll = -0.18; camY = 0.20; camZ = -3.8; fov = 1.32;
  } else if (u_variant < 1.5) {
    pitch = -0.04; roll = 0.02; camY = 0.05; camZ = -4.65; fov = 1.24;
  } else {
    pitch = -1.28; roll = 0.12; camY = 0.14; camZ = -3.55; fov = 1.36;
  }

  vec3 ro = vec3(0.0, camY, camZ);
  vec3 rd = normalize(vec3(p.x * fov, p.y * fov, 1.62));

  mat3 orient = rotX(pitch) * rotZ(roll);
  ro = orient * ro;
  rd = orient * rd;

  vec3 col = vec3(0.0);
  float weight = 1.0;
  bool captured = false;

  const int STEPS = 120;
  for (int i = 0; i < STEPS; i++) {
    float r = length(ro);

    if (r < rs * 1.02) {
      captured = true;
      break;
    }

    if (r > 28.0) break;

    float stepLen = clamp(0.055 * r, 0.018, 0.12);

    vec3 accel = (-2.1 * rs / pow(r, 3.0)) * ro;
    rd = normalize(rd + accel * stepLen);

    vec3 roNext = ro + rd * stepLen;

    if (ro.y * roNext.y <= 0.0) {
      float t = abs(ro.y) / (abs(ro.y) + abs(roNext.y));
      vec3 hit = mix(ro, roNext, t);
      float rr = length(hit.xz);
      vec3 dCol = sampleDisk(hit.xz, rr, rs);
      if (dot(dCol, dCol) > 0.0) {
        col += dCol * weight;
        weight *= exp(-length(dCol) * 0.28);
      }
    }

    ro = roNext;
  }

  // 落入视界且无盘面 → 纯黑本影
  if (captured && length(col) < 0.006) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  float luma = max(max(col.r, col.g), col.b);
  float alpha = smoothstep(0.010, 0.11, luma);
  if (luma > 0.042) {
    alpha = max(alpha, smoothstep(0.042, 0.08, luma) * 0.90);
  } else {
    alpha = min(alpha, luma * 12.0);
  }
  return vec4(col, alpha);
}

vec4 renderBlackHoleAA(vec2 uv) {
  float px = 0.34 / min(u_resolution.x, u_resolution.y);
  vec4 s = renderBlackHole(uv);
  s += renderBlackHole(uv + vec2(px, px * 0.5));
  s += renderBlackHole(uv + vec2(-px * 0.5, px));
  s += renderBlackHole(uv + vec2(px * 0.5, -px));
  return s * 0.25;
}

// --- Bloom ( luminance-based glow ) ---

vec3 bloom(vec3 col) {
  float luma = max(max(col.r, col.g), col.b);
  float glow = smoothstep(0.12, 0.65, luma);
  return col + col * glow * 0.75;
}

float circleMask(vec2 uv) {
  float dist = length(uv);
  // Square window corners sit at ~0.707; inscribed circle radius is 0.5
  return 1.0 - smoothstep(0.47, 0.50, dist);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_viewRef;

  float rs = u_rs;
  vec2 p = uv + u_pan * 0.08;
  float dist = length(p);

  vec4 bh = renderBlackHoleAA(uv);

  float shadowR = rs * 1.18;
  float bhLuma = dot(bh.rgb, bh.rgb);

  if (bh.a < 0.004) {
    fragColor = vec4(0.0);
    return;
  }

  if (bhLuma < 1e-6) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = bloom(bh.rgb);
  if (u_variant < 0.5) {
    col = col / (col + vec3(0.75));
    col = pow(col, vec3(0.95));
  } else if (u_variant < 1.5) {
    col = col / (col + vec3(0.52));
    col = pow(col, vec3(0.88));
    float ringR = smoothstep(rs * 0.818, rs * 1.818, dist)
                * (1.0 - smoothstep(rs * 2.182, rs * 3.091, dist));
    col += vec3(1.0, 0.72, 0.32) * ringR * 0.14;
  } else {
    col = col / (col + vec3(0.68));
    col = pow(col, vec3(0.92));
  }

  float outLuma = max(max(col.r, col.g), col.b);

  // 本影内：暗部一律纯黑；仅保留明亮的前向透镜盘条
  if (dist < shadowR && outLuma < 0.08) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float alpha = dist < shadowR ? max(bh.a, 0.95) : bh.a;

  // 本影边界：极窄 alpha 羽化，不压暗盘面颜色
  float edgeW = rs * 0.0545;

  if (abs(dist - shadowR) < edgeW) {
    float t = smoothstep(shadowR - edgeW, shadowR + edgeW, dist);
    if (dist < shadowR && outLuma >= 0.08) {
      alpha = mix(1.0, alpha, t);
    } else if (dist >= shadowR && outLuma < 0.06) {
      alpha *= t;
    }
  }

  float warpCut = (u_variant < 1.5 ? 3.091 : 3.455) * rs;
  if (dist > warpCut) {
    alpha *= smoothstep(0.022, 0.058, outLuma);
  }

  // 外圈透镜带：减弱盘面对背景扭曲的遮挡
  float lensReveal = smoothstep(rs * 2.4, rs * 3.0, dist)
                   * (1.0 - smoothstep(rs * 4.4, rs * 5.1, dist));
  alpha *= 1.0 - lensReveal * 0.72 * (1.0 - smoothstep(0.05, 0.20, outLuma));

  if (alpha < 0.003) {
    fragColor = vec4(0.0);
    return;
  }

  fragColor = vec4(col * alpha, alpha);
}`;

const LENS_FRAG = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform sampler2D u_live;
uniform vec2 u_screenSize;
uniform vec2 u_liveSize;
uniform vec2 u_windowPos;
uniform vec2 u_windowSize;
uniform float u_rs;
uniform float u_viewRef;

out vec4 fragColor;

vec2 toLiveUV(vec2 pix) {
  return clamp(pix / u_liveSize, 0.002, 0.998);
}

vec3 sampleLive(vec2 pix) {
  return texture(u_live, toLiveUV(pix)).rgb;
}

void main() {
  float rs = u_rs;
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_viewRef;
  vec2 p = uv + u_pan * 0.08;
  float dist = length(p);

  if (dist < rs * 2.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pix = u_windowPos + vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 winCenter = u_windowPos + u_windowSize * 0.5;
  vec2 fromCenter = pix - winCenter;
  vec2 outward = length(fromCenter) > 1.0 ? normalize(fromCenter) : vec2(0.0, 1.0);

  float b = max(dist * 2.8, rs * 1.8);
  float deflect = 3.2 * rs / b;
  vec2 toward = dist > 1e-4 ? p / dist : vec2(1.0, 0.0);
  vec2 perp = vec2(-toward.y, toward.x);
  float lensStrength = u_screenSize.y * 0.045 * (rs / 0.11);
  vec2 lensOff = (toward * 0.72 + perp * 0.38) * deflect * lensStrength;

  // 把采样点推到窗外（实时桌面），lensOff 保留扭曲所需的像素差
  float escapeDist = 0.5 * min(u_windowSize.x, u_windowSize.y) + 14.0;
  vec2 base = pix + outward * escapeDist + lensOff;

  vec2 px = vec2(1.2, 0.0);
  vec3 bg = sampleLive(base);
  bg += sampleLive(base + px);
  bg += sampleLive(base - px);
  bg *= 0.333;

  float lensOuter = rs * 5.0;
  float lensInner = rs * 2.36;
  float mask = smoothstep(lensOuter, lensInner, dist);
  float alpha = mask * (0.55 + 0.45 * smoothstep(0.004, 0.040, length(bg)));
  fragColor = vec4(bg * alpha, alpha);
}`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown compile error';
    console.error(log);
    hint.textContent = `着色器编译失败: ${log}`;
    hint.classList.remove('hidden');
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(vs, fs, label) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'unknown link error';
    console.error(`${label}:`, log);
    hint.textContent = `${label}链接失败: ${log}`;
    hint.classList.remove('hidden');
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

const vs = compileShader(gl.VERTEX_SHADER, VERT);
const fs = compileShader(gl.FRAGMENT_SHADER, FRAG);
const lensFs = compileShader(gl.FRAGMENT_SHADER, LENS_FRAG);

if (!vs || !fs) {
  throw new Error('Shader compile failed');
}

const program = linkProgram(vs, fs, '主着色器');
const lensProgram = lensFs ? linkProgram(vs, lensFs, '透镜着色器') : null;

if (!program) {
  throw new Error('Shader link failed');
}

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

const aPos = gl.getAttribLocation(program, 'a_pos');
const uResolution = gl.getUniformLocation(program, 'u_resolution');
const uTime = gl.getUniformLocation(program, 'u_time');
const uVariant = gl.getUniformLocation(program, 'u_variant');
const uPan = gl.getUniformLocation(program, 'u_pan');
const uRs = gl.getUniformLocation(program, 'u_rs');
const uViewRef = gl.getUniformLocation(program, 'u_viewRef');
const uDiskHot = gl.getUniformLocation(program, 'u_diskHot');
const uDiskWarm = gl.getUniformLocation(program, 'u_diskWarm');
const uDiskCool = gl.getUniformLocation(program, 'u_diskCool');

const lResolution = lensProgram ? gl.getUniformLocation(lensProgram, 'u_resolution') : null;
const lPan = lensProgram ? gl.getUniformLocation(lensProgram, 'u_pan') : null;
const lRs = lensProgram ? gl.getUniformLocation(lensProgram, 'u_rs') : null;
const lViewRef = lensProgram ? gl.getUniformLocation(lensProgram, 'u_viewRef') : null;
const lLive = lensProgram ? gl.getUniformLocation(lensProgram, 'u_live') : null;
const lScreenSize = lensProgram ? gl.getUniformLocation(lensProgram, 'u_screenSize') : null;
const lLiveSize = lensProgram ? gl.getUniformLocation(lensProgram, 'u_liveSize') : null;
const lWindowPos = lensProgram ? gl.getUniformLocation(lensProgram, 'u_windowPos') : null;
const lWindowSize = lensProgram ? gl.getUniformLocation(lensProgram, 'u_windowSize') : null;

let desktopTextures = [null, null];
let desktopReadIndex = 0;
let pendingTextureSwap = false;
let desktopVideo = null;
let liveCaptureReady = false;
let liveTexSize = [1920, 1080];

let cleanTexture = null;
let hasCleanDesktop = false;
let snapImage = null;
let hasDesktop = false;
let captureBusy = false;
let captureTimer = null;
let screenSize = [1920, 1080];
let windowPos = [0, 0];
let windowScale = 1;
let lensWindowSize = [0, 0];

const MODE_COUNT = 3;
const MODE_LABELS = ['Interstellar 斜视', 'EHT 环视', '侧视狭缝'];
let mode = 0;
let pan = [0, 0];
let dragging = false;
let dragStart = { x: 0, y: 0 };
let windowDrag = { x: 0, y: 0 };
let isWindowDrag = false;
let dragMoveId = 0;

const renderSettings = {
  blackHoleSize: 0.11,
  viewRef: 280,
  diskHot: [1.0, 0.98, 0.88],
  diskWarm: [1.0, 0.68, 0.14],
  diskCool: [1.0, 0.42, 0.06],
};

function applyRenderSettings(payload) {
  if (!payload) return;
  if (typeof payload.blackHoleSize === 'number') renderSettings.blackHoleSize = payload.blackHoleSize;
  if (typeof payload.viewRef === 'number') renderSettings.viewRef = payload.viewRef;
  if (payload.diskHot) renderSettings.diskHot = payload.diskHot;
  if (payload.diskWarm) renderSettings.diskWarm = payload.diskWarm;
  if (payload.diskCool) renderSettings.diskCool = payload.diskCool;
}

function getViewRefPx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return renderSettings.viewRef * dpr;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (lensWindowSize[0] < 1 || lensWindowSize[1] < 1) {
    lensWindowSize = [canvas.width, canvas.height];
  }
}

function initDesktopTexture(tex) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function ensureDesktopTextures() {
  if (desktopTextures[0]) return;
  desktopTextures[0] = gl.createTexture();
  desktopTextures[1] = gl.createTexture();
  initDesktopTexture(desktopTextures[0]);
  initDesktopTexture(desktopTextures[1]);
}

function getDesktopReadTexture() {
  return desktopTextures[desktopReadIndex];
}

function swapDesktopTexture() {
  if (!pendingTextureSwap) return;
  desktopReadIndex = 1 - desktopReadIndex;
  pendingTextureSwap = false;
  hasDesktop = true;
}

function updateLiveDesktopTexture() {
  if (!liveCaptureReady || !desktopVideo || desktopVideo.readyState < 2) return;

  if (desktopVideo.videoWidth > 0 && desktopVideo.videoHeight > 0) {
    liveTexSize = [desktopVideo.videoWidth, desktopVideo.videoHeight];
  }

  ensureDesktopTextures();
  const writeIndex = 1 - desktopReadIndex;
  gl.bindTexture(gl.TEXTURE_2D, desktopTextures[writeIndex]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, desktopVideo);
  pendingTextureSwap = true;
}

async function initLiveDesktop() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 20, max: 30 } },
      audio: false,
    });
    desktopVideo = document.createElement('video');
    desktopVideo.srcObject = stream;
    desktopVideo.muted = true;
    desktopVideo.playsInline = true;
    await desktopVideo.play();
    if (desktopVideo.videoWidth > 0 && desktopVideo.videoHeight > 0) {
      liveTexSize = [desktopVideo.videoWidth, desktopVideo.videoHeight];
    }
    ensureDesktopTextures();
    liveCaptureReady = true;
    hasDesktop = true;
    await updateWindowPos();
  } catch (e) {
    console.warn('Live desktop capture failed:', e);
  }
}

async function loadCleanFromBase64(base64) {
  if (!base64) return;
  if (!snapImage) snapImage = new Image();
  if (!cleanTexture) {
    cleanTexture = gl.createTexture();
    initDesktopTexture(cleanTexture);
  }
  await new Promise((resolve, reject) => {
    snapImage.onload = resolve;
    snapImage.onerror = reject;
    snapImage.src = `data:image/png;base64,${base64}`;
  });
  gl.bindTexture(gl.TEXTURE_2D, cleanTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snapImage);
  hasCleanDesktop = true;
  hasDesktop = true;
}

async function loadDesktopFromBase64(base64) {
  await loadCleanFromBase64(base64);
}

function render(t) {
  updateLiveDesktopTexture();
  swapDesktopTexture();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const liveTex = getDesktopReadTexture();

  if (liveCaptureReady && liveTex && lensProgram) {
    gl.useProgram(lensProgram);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, liveTex);
    gl.uniform1i(lLive, 0);
    gl.uniform2f(lResolution, canvas.width, canvas.height);
    gl.uniform2f(lPan, pan[0], pan[1]);
    gl.uniform2f(lScreenSize, screenSize[0], screenSize[1]);
    gl.uniform2f(lLiveSize, liveTexSize[0], liveTexSize[1]);
    gl.uniform2f(lWindowPos, windowPos[0], windowPos[1]);
    gl.uniform2f(lWindowSize, lensWindowSize[0], lensWindowSize[1]);
    if (lRs) gl.uniform1f(lRs, renderSettings.blackHoleSize);
    if (lViewRef) gl.uniform1f(lViewRef, getViewRefPx());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  gl.useProgram(program);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(uResolution, canvas.width, canvas.height);
  gl.uniform1f(uTime, t * 0.001);
  gl.uniform1f(uVariant, mode);
  gl.uniform2f(uPan, pan[0], pan[1]);
  gl.uniform1f(uRs, renderSettings.blackHoleSize);
  gl.uniform1f(uViewRef, getViewRefPx());
  gl.uniform3f(uDiskHot, ...renderSettings.diskHot);
  gl.uniform3f(uDiskWarm, ...renderSettings.diskWarm);
  gl.uniform3f(uDiskCool, ...renderSettings.diskCool);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

resize();
window.addEventListener('resize', resize);

function applyWindowBounds(bounds) {
  if (!bounds) return;
  windowPos[0] = bounds.x;
  windowPos[1] = bounds.y;
  windowScale = bounds.scale || 1;
  if (bounds.width > 0 && bounds.height > 0) {
    lensWindowSize = [bounds.width, bounds.height];
  }
}

async function updateWindowPos() {
  if (!window.cosmicPet) return;
  try {
    const bounds = await window.cosmicPet.getWindowBounds();
    const size = await window.cosmicPet.getScreenSize();
    applyWindowBounds(bounds);
    screenSize = [size.width, size.height];
  } catch (_) {}
}

let posCounter = 0;
let animTime = 0;
let lastFrame = performance.now();

function frame(t) {
  const now = t || performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  animTime += dt;

  if (posCounter++ % 10 === 0 && !isWindowDrag) updateWindowPos();
  render(animTime * 1000);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
setTimeout(initLiveDesktop, 400);
updateWindowPos();

async function captureCleanDesktop() {
  if (captureBusy || !window.cosmicPet || isWindowDrag) return;
  captureBusy = true;
  try {
    const base64 = await window.cosmicPet.captureCleanFrame();
    await loadCleanFromBase64(base64);
  } catch (e) {
    console.warn('Clean desktop capture failed:', e);
  } finally {
    captureBusy = false;
  }
}

function scheduleCapture(delay = 400) {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(captureCleanDesktop, delay);
}

// --- Interaction ---

canvas.addEventListener('mousemove', (e) => {
  if (!window.cosmicPet || isWindowDrag) return;
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left - rect.width / 2;
  const cy = e.clientY - rect.top - rect.height / 2;
  const dist = Math.hypot(cx, cy) / (rect.width / 2);
  const sizeRatio = renderSettings.blackHoleSize / 0.11;
  const winRatio = rect.width / renderSettings.viewRef;
  const hitRadius = 0.42 * Math.min(1.0, sizeRatio / winRatio);
  window.cosmicPet.setMouseIgnore(dist > hitRadius);
});

canvas.addEventListener('mousedown', async (e) => {
  if (e.button === 0) {
    window.cosmicPet?.setMouseIgnore(false);
    isWindowDrag = true;
    windowDrag = { x: e.screenX, y: e.screenY };
    canvas.classList.add('dragging');
    hint.classList.add('hidden');
    await updateWindowPos();
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isWindowDrag || !window.cosmicPet) return;
  const dx = e.screenX - windowDrag.x;
  const dy = e.screenY - windowDrag.y;
  if (dx === 0 && dy === 0) return;
  windowDrag = { x: e.screenX, y: e.screenY };
  const moveId = ++dragMoveId;
  window.cosmicPet.moveWindow(dx, dy).then((bounds) => {
    if (moveId !== dragMoveId) return;
    applyWindowBounds(bounds);
  });
});

window.addEventListener('mouseup', async () => {
  if (isWindowDrag) await updateWindowPos();
  isWindowDrag = false;
  canvas.classList.remove('dragging');
});

function cycleMode() {
  mode = (mode + 1) % MODE_COUNT;
  hint.textContent = `当前：${MODE_LABELS[mode]} · 双击切换形态`;
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 2500);
}

canvas.addEventListener('dblclick', () => {
  cycleMode();
});

if (window.cosmicPet) {
  window.cosmicPet.onToggleMode(() => {
    cycleMode();
  });
  window.cosmicPet.onInitialDesktop((base64) => {
    loadCleanFromBase64(base64).then(() => updateWindowPos()).catch(console.warn);
  });
  // 仅托盘手动刷新（会闪一下）；日常使用不再自动截图
  window.cosmicPet.onRefreshDesktopBg(() => {
    if (!isWindowDrag && !captureBusy) scheduleCapture(150);
  });
  window.cosmicPet.onApplySettings((payload) => {
    applyRenderSettings(payload);
  });
}

setTimeout(() => hint.classList.add('hidden'), 6000);
