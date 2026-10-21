// shared.js — Miri Grab Delivery Rush
// Toon pipeline, palette, geometry + math helpers. Zero external assets: everything procedural.
import * as THREE from 'three';

export const PALETTE = {
  grabGreen: 0x00b14f,
  grabDark: 0x00803d,
  grabTeal: 0x00d084,
  hotPink: 0xff4d8d,
  sunYellow: 0xffd23f,
  sunsetOrange: 0xff8c42,
  skyBlue: 0x7ec8e3,
  seaBlue: 0x1a9cba,
  seaDeep: 0x0f7a99,
  sand: 0xf2dca4,
  asphalt: 0x43484e,
  asphaltWet: 0x272b30,
  concrete: 0xcfd6d4,
  curbGray: 0xb9c0c2,
  grass: 0x6fae5c,
  grassDark: 0x4e8a44,
  trunkBrown: 0x7a5230,
  leafGreen: 0x3f9b4f,
  leafDark: 0x2f7a3d,
  palmGreen: 0x55a860,
  templeRed: 0xc0392b,
  templeGold: 0xf1c40f,
  templeRoof: 0x27632a,
  white: 0xf5f7fa,
  inkBlack: 0x14161a,
  laneYellow: 0xffc93c,
  jacketColors: [0x00b14f, 0xff4d8d, 0x3a86ff, 0xffb703, 0x9b5de5, 0x06d6a0],
  shophouseColors: [0xf4e3c1, 0xe8d5b5, 0xd9e4dd, 0xf0d3d3, 0xd7d9e4, 0xefe6cf, 0xdfe8f0, 0xe6d8c3],
};

// ---- 4-step toon gradient map (sharp anime bands) ----
const grad = new Uint8Array([70, 135, 205, 255]);
export const gradientMap = new THREE.DataTexture(grad, 4, 1, THREE.RedFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: PALETTE.inkBlack, side: THREE.BackSide });

export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...opts });
}

// Inverted-hull ink outline: black BackSide clone slightly inflated, parented to the mesh.
export function addOutline(mesh, inflate = 1.045) {
  const out = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  out.scale.setScalar(inflate);
  out.raycast = () => {};
  mesh.add(out);
  return mesh;
}

// ---- Primitive builders (toon material + optional outline) ----
export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(color, opts.mat || {}));
  if (opts.outline !== false) addOutline(m, opts.inflate);
  return m;
}
export function cyl(rt, rb, h, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, opts.seg || 12), toonMat(color, opts.mat || {}));
  if (opts.outline !== false) addOutline(m, opts.inflate);
  return m;
}
export function sph(r, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg || 14, Math.max(6, (opts.seg || 14) - 3)), toonMat(color, opts.mat || {}));
  if (opts.outline !== false) addOutline(m, opts.inflate);
  return m;
}
export function cone(r, h, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, opts.seg || 12), toonMat(color, opts.mat || {}));
  if (opts.outline !== false) addOutline(m, opts.inflate);
  return m;
}
export function flatMesh(geo, color, opts = {}) {
  return new THREE.Mesh(geo, toonMat(color, opts.mat || {}));
}

// ---- Procedural canvas text texture (signs, labels, banners) ----
export function textTexture(text, opts = {}) {
  const w = opts.w || 512, h = opts.h || 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#0a3d2a';
  g.fillRect(0, 0, w, h);
  if (opts.border) {
    g.strokeStyle = opts.borderColor || '#ffffff';
    g.lineWidth = opts.borderW || 10;
    g.strokeRect(8, 8, w - 16, h - 16);
  }
  g.fillStyle = opts.fg || '#ffffff';
  g.font = `900 ${opts.size || 60}px 'Arial Black', Arial, sans-serif`;
  g.textAlign = opts.align || 'center';
  g.textBaseline = 'middle';
  g.fillText(text, opts.align === 'left' ? 28 : w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Checker texture for start/finish banners
export function checkerTexture(n = 8, cell = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = n * cell;
  const g = c.getContext('2d');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? '#111111' : '#f5f5f5';
    g.fillRect(x * cell, y * cell, cell, cell);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Orientation convention (used by world/rider/traffic/landmarks) ----
// MODEL FRONT = local +Z. orientAlong sets quaternion so local +Z follows the tangent,
// local +X follows `right` (rolled by `bank` radians around the tangent).
const _m4 = new THREE.Matrix4();
export function orientAlong(obj, tan, right, bank = 0) {
  const r = right.clone().applyAxisAngle(tan, bank).normalize();
  const u = new THREE.Vector3().crossVectors(tan, r).normalize();
  _m4.makeBasis(r, u, tan);
  obj.quaternion.setFromRotationMatrix(_m4);
  return obj;
}

// ---- Math utils ----
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function rand(a = 1, b) {
  if (b === undefined) { b = a; a = 0; }
  return a + Math.random() * (b - a);
}
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function seededRandom(seed = 20240915) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (t) => t * t * (3 - 2 * t);

// Format Ringgit Malaysia, e.g. rmFmt(12.5) -> "RM 12.50"
export const rmFmt = (v) => 'RM ' + v.toFixed(2);
