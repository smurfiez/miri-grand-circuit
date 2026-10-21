// traffic.js — Miri Grab Delivery Rush
// Ambient same-direction traffic (Malaysia LHT): Sarawak-flavoured Hilux pickups,
// sedans, Perodua Viva kei cars and 'MIRI BAS' buses. Pure procedural toon meshes,
// no assets, no shadows. Model front = local +Z (see shared.js convention).

import * as THREE from 'three';
import { PALETTE, toonMat, box, orientAlong, lerp, clamp, rand, choice, gradientMap, textTexture } from './shared.js';

// ---- shared geometries / materials (built once, reused by every vehicle) ----
const WHEEL_GEO = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10);
  g.rotateZ(Math.PI / 2); // axle along local X
  return g;
})();
const CONE_GEO = (() => {
  const g = new THREE.ConeGeometry(1.8, 12, 14, 1, true);
  g.rotateX(-Math.PI / 2); // apex -> -Z, base -> +Z
  g.translate(0, 0, 6);    // apex at z=0 (headlight), beam opens 12 m forward (+Z)
  return g;
})();
const HEAD_GEO = new THREE.SphereGeometry(0.09, 8, 6);
const TAIL_GEO = new THREE.SphereGeometry(0.075, 8, 6);
const BUS_WIN_GEO = new THREE.PlaneGeometry(8.8, 0.75);
const BUS_SIGN_GEO = new THREE.PlaneGeometry(3.4, 0.7);

const WHEEL_MAT = toonMat(0x22252b);
const HEAD_MAT = new THREE.MeshToonMaterial({ color: 0xfff6d8, gradientMap });
const TAIL_MAT = new THREE.MeshToonMaterial({ color: 0xb01414, gradientMap });
const CONE_MAT = new THREE.MeshBasicMaterial({
  color: 0xfff3c0, transparent: true, opacity: 0.12,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const BUS_WIN_MAT = new THREE.MeshToonMaterial({ color: 0x2b3a44, gradientMap, side: THREE.DoubleSide });
let _busSignMat = null;
function busSignMaterial() {
  if (!_busSignMat) {
    _busSignMat = new THREE.MeshBasicMaterial({
      map: textTexture('MIRI BAS', { bg: '#0a7a3d', fg: '#ffffff', border: true, size: 64 }),
      side: THREE.DoubleSide,
    });
  }
  return _busSignMat;
}

const HILUX_COLORS = [PALETTE.white, 0xc9ced4, 0x1c1e22, PALETTE.templeRed];
const SEDAN_COLORS = [PALETTE.templeRed, 0x1f5fbf, PALETTE.white, 0xc9ced4]; // Proton-ish
const VIVA_COLORS = [PALETTE.sunYellow, PALETTE.skyBlue, PALETTE.white, PALETTE.hotPink, 0xc9ced4];

const SPEEDS = { hilux: [11, 15], sedan: [12, 17], viva: [10, 14], bus: [8, 11] };
// [type, lane] spawn plan — lanes are in the travel frame, so negative always
// means the left-hand lane (Malaysia LHT) whichever way the car is heading.
const TEMPLATE = [
  ['sedan', -2.2], ['hilux', -6.2], ['viva', -2.2], ['sedan', -6.2],
  ['bus', -6.2], ['viva', -2.2], ['sedan', -2.2], ['hilux', -6.2],
  ['viva', -2.2], ['bus', -6.2], ['sedan', -6.2], ['hilux', -2.2],
  ['bus', -6.2], ['viva', -2.2], ['hilux', -6.2], ['sedan', -2.2],
];

const _up = new THREE.Vector3();
const _v = new THREE.Vector3();

function addWheelSet(group, wheels, halfTrack, r, width, zs) {
  for (const z of zs) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
      w.scale.set(width, r, r);
      w.position.set(side * halfTrack, r, z);
      group.add(w);
      wheels.push(w);
    }
  }
}

function addLights(body, halfWidth, y, zFront, zBack, scale = 1) {
  const heads = [], tails = [];
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(HEAD_GEO, HEAD_MAT);
    h.scale.setScalar(scale);
    h.position.set(side * halfWidth, y, zFront);
    body.add(h); heads.push(h);
    const t = new THREE.Mesh(TAIL_GEO, TAIL_MAT);
    t.scale.setScalar(scale);
    t.position.set(side * halfWidth * 1.05, y, zBack);
    body.add(t); tails.push(t);
  }
  return { heads, tails };
}

// ---- vehicle builders (front = +Z, origin on road surface) ----
function buildHilux() {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const wheels = [];
  const color = choice(HILUX_COLORS);
  const cab = box(1.85, 0.8, 1.9, color); cab.position.set(0, 0.78, 1.55); body.add(cab);
  const bed = box(1.85, 0.55, 2.6, color); bed.position.set(0, 0.66, -1.3); body.add(bed);
  const liner = box(1.6, 0.1, 2.35, 0x2a2d33, { outline: false }); liner.position.set(0, 0.95, -1.3); body.add(liner);
  const bull = box(1.5, 0.4, 0.14, 0x9aa1a8, { outline: false }); bull.position.set(0, 0.62, 2.62); body.add(bull);
  const roll = box(1.6, 0.55, 0.14, 0x9aa1a8, { outline: false }); roll.position.set(0, 1.2, 0.45); body.add(roll);
  addWheelSet(group, wheels, 0.82, 0.36, 0.3, [1.75, -1.75]);
  const lights = addLights(body, 0.62, 0.72, 2.52, -2.62);
  return { group, body, wheels, lights, len: 5.3, width: 1.85, type: 'hilux', wheelR: 0.36 };
}

function buildSedan() {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const wheels = [];
  const color = choice(SEDAN_COLORS);
  const shell = box(1.7, 0.55, 4.4, color); shell.position.set(0, 0.5, 0); body.add(shell);
  const cabin = box(1.55, 0.5, 2.3, color); cabin.position.set(0, 1.0, -0.25); body.add(cabin);
  addWheelSet(group, wheels, 0.78, 0.3, 0.26, [1.45, -1.45]);
  const lights = addLights(body, 0.58, 0.58, 2.22, -2.22);
  return { group, body, wheels, lights, len: 4.4, width: 1.7, type: 'sedan', wheelR: 0.3 };
}

function buildViva() {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const wheels = [];
  const color = choice(VIVA_COLORS);
  const shell = box(1.5, 0.66, 3.6, color); shell.position.set(0, 0.54, 0); body.add(shell);
  const cabin = box(1.38, 0.52, 1.7, color); cabin.position.set(0, 1.12, -0.3); body.add(cabin);
  addWheelSet(group, wheels, 0.68, 0.27, 0.24, [1.15, -1.15]);
  const lights = addLights(body, 0.5, 0.6, 1.82, -1.82);
  return { group, body, wheels, lights, len: 3.6, width: 1.5, type: 'viva', wheelR: 0.27 };
}

function buildBus() {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const wheels = [];
  const shell = box(2.3, 2.15, 10.5, 0xf2f5f3); shell.position.set(0, 1.53, 0); body.add(shell);
  const stripe = box(2.36, 0.5, 10.52, 0x0a7a3d, { outline: false }); stripe.position.set(0, 0.8, 0); body.add(stripe);
  const signMat = busSignMaterial();
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(BUS_WIN_GEO, BUS_WIN_MAT);
    win.position.set(side * 1.19, 2.2, 0);
    win.rotation.y = side * Math.PI / 2;
    body.add(win);
    const sign = new THREE.Mesh(BUS_SIGN_GEO, signMat);
    sign.position.set(side * 1.2, 1.45, 2.6);
    sign.rotation.y = side * Math.PI / 2;
    body.add(sign);
  }
  addWheelSet(group, wheels, 0.92, 0.5, 0.36, [3.5, -2.9, -4.3]);
  const lights = addLights(body, 0.75, 1.1, 5.28, -5.28, 1.5);
  return { group, body, wheels, lights, len: 10.5, width: 2.3, type: 'bus', wheelR: 0.5 };
}

const TYPE_BUILDERS = { hilux: buildHilux, sedan: buildSedan, viva: buildViva, bus: buildBus };

export class Traffic {
  constructor(scene, world, count = 16) {
    this.world = world;
    this.cars = [];
    this.time = 0;

    // --- spawn plan: lane-appropriate types, buses capped at 3 ---
    const plan = [];
    let buses = 0;
    for (let i = 0; i < count; i++) {
      let entry = TEMPLATE[i % TEMPLATE.length];
      if (entry[0] === 'bus') {
        if (buses >= 3) entry = ['viva', -2.2];
        else buses++;
      }
      plan.push(entry);
    }

    for (let i = 0; i < plan.length; i++) {
      const [type, lane] = plan[i];
      // spread cars over the street network in both directions
      const edge = world.edges[(i * 5 + 1) % world.edges.length];
      const dir = i % 2 === 0 ? 1 : -1;
      let s = edge.length * (0.15 + 0.7 * ((i * 7) % 11) / 11);
      // keep >= 40 m between vehicles sharing the same street + direction
      for (let pass = 0; pass < 6; pass++) {
        let clear = true;
        for (const c of this.cars) {
          if (c.edgeId !== edge.id || c.dir !== dir) continue;
          if (Math.abs(c.s - s) < 40) {
            s = (s + 45) % edge.length;
            clear = false;
          }
        }
        if (clear) break;
      }

      const b = TYPE_BUILDERS[type]();
      const [sMin, sMax] = SPEEDS[type];
      const car = {
        group: b.group, body: b.body, wheels: b.wheels,
        headlights: b.lights.heads, taillights: b.lights.tails,
        edgeId: edge.id, s, dir, lane, lateral: lane,
        speed: rand(sMin, sMax), baseSpeed: rand(sMin, sMax),
        len: b.len, width: b.width, type, wheelR: b.wheelR, cone: null, idx: this.cars.length,
        visTan: null,
      };
      car.visTan = world.travelFrame(car.edgeId, car.s, car.dir).tan;

      // per-car additive headlight cone (hidden in daytime)
      const cone = new THREE.Mesh(CONE_GEO, CONE_MAT);
      cone.visible = false;
      cone.position.set(0, b.lights.heads[0].position.y, b.len / 2 + 0.1);
      b.body.add(cone);
      car.cone = cone;

      this._place(car);
      scene.add(b.group);
      this.cars.push(car);
    }
  }

  // position + orient one car on its street
  _place(car) {
    const f = this.world.travelFrame(car.edgeId, car.s, car.dir);
    this.world.edgePoint(car.edgeId, car.s, car.lateral, car.group.position, car.dir);
    car.group.position.y = this.world.roadY;
    orientAlong(car.group, car.visTan, f.right, 0);
  }

  // Move a car across a junction onto a new street, keeping its lateral offset
  // continuous in world space so it never jumps sideways through the intersection.
  _advanceEdge(car) {
    const world = this.world;
    const edge = world.edges[car.edgeId];
    const atEnd = car.dir > 0;
    const node = atEnd ? edge.b : edge.a;
    const edgeS = atEnd ? edge.length : 0;
    const over = atEnd ? car.s - edge.length : -car.s;
    const tan = world.travelFrame(car.edgeId, edgeS, car.dir).tan;

    const link = world.randomSuccessor(node, edge.id, tan);
    world.edgePoint(car.edgeId, edgeS, car.lateral, _v, car.dir);

    car.edgeId = link.edgeId;
    car.dir = link.dir;
    const ne = world.edges[car.edgeId];
    const entryS = link.dir > 0 ? 0 : ne.length;
    const f = world.travelFrame(car.edgeId, entryS, link.dir);
    const lat = (_v.x - f.pos.x) * f.right.x + (_v.z - f.pos.z) * f.right.z;
    car.lateral = clamp(lat, -6.8, 6.8);
    car.s = clamp(entryS + over * link.dir, 0, ne.length);
  }

  update(dt) {
    this.time += dt;
    const world = this.world;
    const cars = this.cars;

    for (const car of cars) {
      // --- car-following: nearest vehicle ahead on the same street + direction ---
      let target = car.baseSpeed;
      let ahead = null, best = Infinity;
      for (const o of cars) {
        if (o === car || o.edgeId !== car.edgeId || o.dir !== car.dir) continue;
        if (Math.abs(o.lateral - car.lateral) >= 1.8) continue;
        const d = (o.s - car.s) * car.dir;
        if (d <= 0 || d >= best) continue;
        best = d; ahead = o;
      }
      if (ahead) {
        const gap = best - (car.len + ahead.len) * 0.5;
        if (best < 14 + car.len) target = Math.min(target, ahead.speed * 0.95);
        if (gap < 3) target = 0;
      }
      car.speed = lerp(car.speed, target, Math.min(1, dt * 1.2));
      if (car.speed < 0) car.speed = 0; // never reverse

      // --- advance along the street, turning at the junction when s runs out ---
      car.s += car.speed * dt * car.dir;
      let guard = 0;
      while ((car.s > world.edges[car.edgeId].length || car.s < 0) && guard++ < 4) {
        this._advanceEdge(car);
      }
      car.s = clamp(car.s, 0, world.edges[car.edgeId].length);

      // --- ease back into the correct lane after a junction, smooth the heading ---
      car.lateral = lerp(car.lateral, car.lane, Math.min(1, dt * 1.4));
      const f = world.travelFrame(car.edgeId, car.s, car.dir);
      car.visTan.lerp(f.tan, Math.min(1, dt * 5)).normalize();
      this._place(car);

      // --- suspension bob + wheel spin ---
      car.body.position.y = Math.sin(this.time * 7 + car.idx) * 0.02;
      const spin = (car.speed * dt) / car.wheelR;
      for (const w of car.wheels) w.rotation.x -= spin;
    }
  }

  setNight(on) {
    for (const car of this.cars) car.cone.visible = on;
    HEAD_MAT.emissive.setHex(on ? 0xffe9a0 : 0x000000);
    TAIL_MAT.emissive.setHex(on ? 0xff2a2a : 0x000000);
  }
}
