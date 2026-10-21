// rider.js — Miri Grab Delivery Rush
// Scooter riders (player + AI), food-order lifecycle, rider management.
// Convention: model front = local +Z; riders orient via shared.orientAlong
// (orientAlong(group, s.tan, s.right, s.bank*0.4 + lean*0.3)).
// This module never touches the DOM scene graph of the HUD; main.js owns that.
import * as THREE from 'three';
import { PALETTE, box, cyl, sph, textTexture, orientAlong, clamp, lerp, rand, choice } from './shared.js';

export const FOODS = ['Laksa Sarawak', 'Kolo Mee', 'Ayam Penyet', 'Teh C Peng', 'Nasi Lemak', 'Midin Belacan', 'Manok Pansoh', 'Kueh Chap', 'Roti Kahwin', 'Pisang Goreng', 'Kampua Mee', 'Sarawak Laksa'];
export const RIDER_NAMES = ['Aiman', 'Dayang', 'Sylvia', 'Fredie', 'Nurul', 'Hafiz', 'Cindy', 'Joey', 'Lulut', 'Zai', 'Melissa', 'Abang'];

const MAX_SPEED = 33;
const UP_VEC = new THREE.Vector3(0, 1, 0);
const round2 = (v) => Math.round(v * 100) / 100;
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------
// OrderSystem — spawns food orders, auto-assigns them, tracks pickup/dropoff
// ---------------------------------------------------------------------------
export class OrderSystem {
  constructor(world, onEvent) {
    this.world = world;
    this.onEvent = onEvent;
    this.orders = [];
    this.spawnTimer = 1.2;
    this.streak = 0;
    this._nextId = 1;
  }

  get playerOrders() {
    return this.orders.filter((o) => o.assignee && o.assignee.isPlayer);
  }

  update(dt, riders) {
    const player = riders.find((r) => r.isPlayer) || null;

    // --- spawn (every 6-10s while under the cap) ---
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (this.orders.length < 6) this._spawn(player);
      this.spawnTimer = rand(6, 10);
    }

    // --- auto-assign open orders ---
    for (const o of this.orders) {
      if (o.state !== 'open') continue;
      let bestAI = null, bestD = Infinity;
      for (const r of riders) {
        if (r.isPlayer || r.order) continue;
        const d = flatDist(r.group.position, o.from.pos);
        if (d < bestD) { bestD = d; bestAI = r; }
      }
      const playerD = player ? flatDist(player.group.position, o.from.pos) : Infinity;
      const playerEligible = !!(player && !player.order && this.playerOrders.length < 2);
      let chosen = null;
      // the human rider gets first refusal on every new order so the run stays playable
      if (playerEligible && this.playerOrders.length < 1) chosen = player;
      else if (playerEligible && playerD <= bestD) chosen = player;
      else if (bestAI) chosen = bestAI;
      else if (playerEligible) chosen = player;
      if (!chosen) continue;
      o.state = 'assigned';
      o.assignee = chosen;
      chosen.order = o;
      chosen.phase = 'toPickup';
      chosen.setTarget(o.from);
      this.onEvent('assigned', { order: o, rider: chosen });
    }

    // --- progress + expiry (reverse loop: orders may be removed) ---
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      o.age += dt;
      const r = o.assignee;
      let removed = false;
      if (r && r.order === o) {
        if (r.phase === 'toPickup') {
          if (flatDist(r.group.position, o.from.pos) < 14) {
            r.phase = 'pickupWait';
            r.phaseT = 1.2;
            r.speed = 0;
            r.clearPath();
            this.onEvent('picked', { order: o, rider: r });
          }
        } else if (r.phase === 'pickupWait') {
          r.phaseT -= dt;
          if (r.phaseT <= 0) {
            r.phase = 'toDropoff';
            r.setTarget(o.to);
          }
        } else if (r.phase === 'toDropoff') {
          if (flatDist(r.group.position, o.to.pos) < 14) {
            const rm = round2(o.rm * (1 + 0.12 * this.streak));
            const xp = Math.round(o.xp * (1 + 0.12 * this.streak));
            this.streak++;
            this.onEvent('delivered', { order: o, rider: r, rm, xp, streak: this.streak });
            r.order = null;
            r.phase = 'cruise';
            r.clearPath();
            this.orders.splice(i, 1);
            removed = true;
          }
        }
      }
      if (removed) continue;
      if (o.age > o.deadline) {
        this.onEvent('expired', { order: o, rider: r || null });
        if (r && r.order === o) {
          r.order = null;
          r.phase = 'cruise';
          r.clearPath();
        }
        this.streak = 0;
        this.orders.splice(i, 1);
      }
    }
  }

  _pick(from, minD, maxD) {
    const lms = this.world.landmarks;
    const inRange = lms.filter((l) => l !== from && flatDist(l.roadPos, from.roadPos) > minD && flatDist(l.roadPos, from.roadPos) < maxD);
    if (inRange.length) return choice(inRange);
    const rest = lms.filter((l) => l !== from);
    return rest[Math.floor(Math.random() * rest.length)];
  }

  _spawn(player) {
    const lms = this.world.landmarks;
    // Hands-off play needs a steady delivery cadence: bias pickups to a landmark
    // within a rideable radius of the player rather than anywhere in the city.
    let from = null;
    if (player) {
      const near = lms.filter((l) => {
        const d = flatDist(l.roadPos, player.group.position);
        return d > 120 && d < 900;
      });
      from = near.length ? choice(near) : this._pick({ roadPos: player.group.position }, 120, 900);
    } else {
      from = choice(lms);
    }
    const to = this._pick(from, 150, 1100);
    const cityDistance = flatDist(from.roadPos, to.roadPos);
    const rm = round2(4 + cityDistance * 0.02 + rand(0, 4));
    const order = {
      id: this._nextId++,
      food: choice(FOODS),
      from: { name: from.name, edgeId: from.edgeId, s: from.s, side: from.side, pos: from.roadPos.clone() },
      to: { name: to.name, edgeId: to.edgeId, s: to.s, side: to.side, pos: to.roadPos.clone() },
      rm,
      xp: Math.round(rm * 3),
      state: 'open',
      assignee: null,
      age: 0,
      deadline: 180,
    };
    this.orders.push(order);
    this.onEvent('new', { order });
  }
}

// ---------------------------------------------------------------------------
// Rider — one delivery scooter (player-controlled or AI)
// ---------------------------------------------------------------------------
export class Rider {
  constructor(world, opts = {}) {
    const o = opts || {};
    this.world = world;
    this.isPlayer = !!o.isPlayer;
    this.name = o.name || 'YOU';
    const jacketColor = o.jacketColor !== undefined ? o.jacketColor : PALETTE.grabGreen;
    this.jacketColor = jacketColor; // minimap dot colour
    this.edgeId = o.edgeId !== undefined ? o.edgeId : world.start.edgeId;
    this.s = o.s !== undefined ? o.s : world.start.s;
    this.dir = o.dir !== undefined ? o.dir : 1;
    this.lateral = o.lateral !== undefined ? o.lateral : -2;
    this.baseLane = this.lateral;      // AI cruise lane (-2 or -6)
    this.baseSpeed = o.baseSpeed !== undefined ? o.baseSpeed : rand(14, 19); // AI cruise target speed
    this.autopilot = o.autopilot !== undefined ? o.autopilot : false;
    this.speed = 0;
    this.latVel = 0;
    this.lean = 0;
    this.isDrifting = false;
    this.phase = 'cruise';             // 'cruise'|'toPickup'|'pickupWait'|'toDropoff'|'deliverWait'
    this.phaseT = 0;
    this.order = null;
    this.path = null;                  // A* legs [{edgeId, dir, toS}]
    this.pathIdx = 0;
    this.odo = 0;                      // metres ridden (HUD odometer)
    this.wheels = [];
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.onBump = null;                // set by RiderSystem (hooks.onBump)
    this.time = rand(0, 100);
    this._wanderSeed = rand(0, Math.PI * 2);
    this._lastBump = -10;
    this._tmp = new THREE.Vector3();
    const f = world.travelFrame(this.edgeId, this.s, this.dir);
    this.visTan = f.tan.clone();
    this.visRight = f.right.clone();
    this._buildMesh(jacketColor);
    this._place();
  }

  // ---- mesh ---------------------------------------------------------------
  _buildMesh(jacketColor) {
    const chassis = new THREE.Group();
    chassis.position.y = 0.3; // pivot at wheelbase centre
    this.group = new THREE.Group();
    this.group.scale.setScalar(1.14);
    this.group.add(chassis);
    this.chassis = chassis;

    const bodyDark = 0x3a4046;

    // wheels (spin in update via pivot.rotation.x)
    const mkWheel = (z) => {
      const pivot = new THREE.Group();
      pivot.position.set(0, -0.02, z);
      const w = cyl(0.28, 0.28, 0.18, 0x1b1e22, { seg: 14 });
      w.rotation.z = Math.PI / 2;
      // hub + tread accent
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0x8b949c }));
      hub.rotation.z = Math.PI / 2;
      pivot.add(w, hub);
      chassis.add(pivot);
      this.wheels.push(pivot);
    };
    mkWheel(0.58);
    mkWheel(-0.58);

    // scooter body
    const floor = box(0.36, 0.07, 0.8, bodyDark);
    floor.position.set(0, -0.2, 0.0);
    chassis.add(floor);

    const apron = box(0.3, 0.42, 0.14, PALETTE.grabGreen);
    apron.position.set(0, -0.02, 0.44);
    apron.rotation.x = -0.22;
    chassis.add(apron);

    const column = box(0.09, 0.62, 0.1, bodyDark);
    column.position.set(0, 0.1, 0.5);
    column.rotation.x = -0.28;
    chassis.add(column);

    const bar = cyl(0.032, 0.032, 0.56, 0x22262b, { seg: 8 });
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.42, 0.42);
    chassis.add(bar);

    const seat = box(0.32, 0.13, 0.6, 0x1c1f24);
    seat.position.set(0, 0.03, -0.34);
    chassis.add(seat);

    // green delivery backpack + GRAB label on its back face
    const pack = box(0.46, 0.54, 0.3, PALETTE.grabGreen);
    pack.position.set(0, 0.38, -0.66);
    chassis.add(pack);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.11),
      new THREE.MeshBasicMaterial({ map: textTexture('GRAB', { bg: '#00b14f', fg: '#ffffff', w: 256, h: 80, size: 52 }) })
    );
    label.position.set(0, 0.41, -0.815);
    label.rotation.y = Math.PI;
    chassis.add(label);

    // rider figure
    const helmetCol = this.isPlayer ? PALETTE.white : jacketColor;
    for (const sx of [-1, 1]) {
      const leg = box(0.12, 0.36, 0.14, 0x2c3138);
      leg.position.set(sx * 0.15, -0.12, -0.3);
      chassis.add(leg);
    }
    const torso = box(0.36, 0.46, 0.24, jacketColor);
    torso.position.set(0, 0.14, -0.36);
    torso.rotation.x = 0.3; // forward lean
    chassis.add(torso);
    for (const sx of [-1, 1]) {
      const arm = box(0.09, 0.5, 0.09, jacketColor);
      arm.position.set(sx * 0.17, 0.4, 0.06);
      arm.rotation.x = -1.35; // reach forward to the handlebar
      chassis.add(arm);
    }
    const head = sph(0.125, 0xe0ac69, { seg: 10, outline: false });
    head.position.set(0, 0.5, -0.26);
    chassis.add(head);
    const helmet = sph(0.16, helmetCol, { seg: 12 });
    helmet.position.set(0, 0.53, -0.28);
    chassis.add(helmet);
    const visor = box(0.17, 0.09, 0.07, 0x1b2430, { outline: false });
    visor.position.set(0, 0.53, -0.13);
    chassis.add(visor);

    // mirrors, front fender and exhaust
    for (const sx of [-1, 1]) {
      const stalk = cyl(0.018, 0.018, 0.24, 0x2b2f36, { seg: 5, outline: false });
      stalk.position.set(sx * 0.22, 0.52, 0.4);
      stalk.rotation.z = sx * 0.5;
      const glass = box(0.13, 0.08, 0.03, 0x9fb3c4, { outline: false });
      glass.position.set(sx * 0.28, 0.63, 0.4);
      chassis.add(stalk, glass);
    }
    const fender = box(0.3, 0.08, 0.52, PALETTE.grabGreen, { inflate: 1.06 });
    fender.position.set(0, 0.24, 0.6);
    const pipe = cyl(0.05, 0.06, 0.42, 0xb8c0c8, { seg: 6, outline: false });
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(0.17, -0.06, -0.62);
    chassis.add(fender, pipe);
    // backpack straps
    for (const sx of [-1, 1]) {
      const strap = box(0.05, 0.5, 0.04, 0x0a7a37, { outline: false });
      strap.position.set(sx * 0.2, 0.26, -0.42);
      strap.rotation.x = 0.18;
      chassis.add(strap);
    }

    // lights (emissive toggles with night)
    const headLight = sph(0.07, 0xfff3c4, { seg: 8, outline: false, mat: { emissive: 0xffe08a, emissiveIntensity: 0.25 } });
    headLight.position.set(0, 0.1, 0.55);
    chassis.add(headLight);
    this._headMat = headLight.material;
    const tailLight = sph(0.055, 0xff5040, { seg: 8, outline: false, mat: { emissive: 0xff2211, emissiveIntensity: 0.5 } });
    tailLight.position.set(0, 0.14, -0.815);
    chassis.add(tailLight);
    this._tailMat = tailLight.material;

    // night-only additive headlight beam (apex at the lamp, opens forward)
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff2b0,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.35, 7.55);
    beam.visible = false;
    beam.raycast = () => {};
    this.group.add(beam);
    this.beam = beam;
  }

  _place() {
    const f = this.world.travelFrame(this.edgeId, this.s, this.dir);
    this.world.edgePoint(this.edgeId, this.s, this.lateral, this.group.position, this.dir);
    orientAlong(this.group, f.tan, f.right, this.lean * 0.3);
  }

  // ---- public API ----------------------------------------------------------
  getPose() {
    const pos = this.world.edgePoint(this.edgeId, this.s, this.lateral, new THREE.Vector3(), this.dir);
    return {
      pos,
      tan: this.visTan.clone(),
      right: this.visRight.clone(),
      bank: 0,
      lean: this.lean,
      speed: this.speed,
      isDrifting: this.isDrifting,
    };
  }

  distanceTo(point) {
    return flatDist(this.group.position, point);
  }

  // ---- A* route following --------------------------------------------------
  setTarget(target) {
    this.path = this.world.findPath(
      { edgeId: this.edgeId, s: this.s, dir: this.dir },
      { edgeId: target.edgeId, s: target.s }
    );
    this.pathIdx = 0;
    if (this.path && this.path.length) {
      // the first leg is always the road we are already on
      this.path[0].toS = this.dir > 0 ? this.world.edges[this.edgeId].length : 0;
    }
  }

  clearPath() {
    this.path = null;
    this.pathIdx = 0;
  }

  // World-space heading a given distance ahead, following the planned route.
  _aheadFrame(dist) {
    const world = this.world;
    let edgeId = this.edgeId, s = this.s, dir = this.dir, rem = dist;
    for (let guard = 0; guard < 5; guard++) {
      const e = world.edges[edgeId];
      const toEnd = dir > 0 ? e.length - s : s;
      if (rem <= toEnd) return world.travelFrame(edgeId, s + dir * rem, dir);
      rem -= toEnd;
      let next = this.path ? this.path[this.pathIdx + 1] : null;
      if (!next) {
        const node = dir > 0 ? e.b : e.a;
        const tan = world.travelFrame(edgeId, s, dir).tan;
        const link = world.straightestSuccessor(node, edgeId, tan);
        if (!link) break;
        next = { edgeId: link.edgeId, dir: link.dir };
      }
      edgeId = next.edgeId;
      dir = next.dir;
      s = dir > 0 ? 0 : world.edges[edgeId].length;
    }
    return world.travelFrame(edgeId, s, dir);
  }

  // move along the network, switching roads at junctions
  _advance(dist) {
    const world = this.world;
    let remaining = dist, guard = 0;
    while (remaining > 0.0001 && guard++ < 8) {
      const e = world.edges[this.edgeId];
      const sEnd = this.dir > 0 ? e.length : 0;
      const toEnd = Math.abs(sEnd - this.s);
      if (remaining < toEnd) {
        this.s += this.dir * remaining;
        remaining = 0;
        break;
      }
      this.s = sEnd;
      remaining -= toEnd;
      this._nextRoad();
    }
    this.s = clamp(this.s, 0, world.edges[this.edgeId].length);
  }

  _nextRoad() {
    const world = this.world;
    if (this.path) {
      const next = this.path[this.pathIdx + 1];
      if (next) {
        this.pathIdx++;
        this._switchRoad(next.edgeId, next.dir);
        return;
      }
      this.clearPath();
    }
    // cruise: take a random outgoing street, keeping as straight as possible
    const e = world.edges[this.edgeId];
    const node = this.dir > 0 ? e.b : e.a;
    const tan = world.travelFrame(this.edgeId, this.s, this.dir).tan;
    const link = world.randomSuccessor(node, this.edgeId, tan);
    if (!link) {
      this.dir *= -1; // dead end safety net
      return;
    }
    this._switchRoad(link.edgeId, link.dir);
  }

  // Keep the world position continuous through the corner, then let the lane
  // controller pull back to the cruising lane.
  _switchRoad(edgeId, dir) {
    const world = this.world;
    const oldPos = world.edgePoint(this.edgeId, this.s, this.lateral, this._tmp, this.dir);
    const newS = dir > 0 ? 0 : world.edges[edgeId].length;
    const f = world.travelFrame(edgeId, newS, dir);
    const dx = oldPos.x - f.pos.x, dz = oldPos.z - f.pos.z;
    this.lateral = clamp(dx * f.right.x + dz * f.right.z, -8.4, 8.4);
    this.edgeId = edgeId;
    this.dir = dir;
    this.s = newS;
    this.latVel *= 0.4;
  }

  setNight(on) {
    if (this.beam) this.beam.visible = !!on;
    if (this._headMat) this._headMat.emissiveIntensity = on ? 1.5 : 0.25;
    if (this._tailMat) this._tailMat.emissiveIntensity = on ? 1.3 : 0.5;
  }

  update(dt, trafficCars, riders) {
    const cars = trafficCars || [];
    const others = riders || [];
    this.time += dt;
    // the player rider is hands-off by default: reuse the AI delivery brain
    // (A* route following, curvature braking, traffic + rider avoidance) unless
    // the player takes over with the keys
    if (this.isPlayer) {
      if (this.autopilot) this._stepAI(dt, cars, others);
      else this._stepPlayer(dt);
    } else this._stepAI(dt, cars, others);
    this._collide(cars);
    // soft lateral clamp (push back + scrub speed)
    if (Math.abs(this.lateral) > 8.4) {
      this.lateral = clamp(this.lateral, -8.4, 8.4);
      if (this.latVel * this.lateral > 0) this.latVel *= -0.35;
      this.speed *= 0.995;
    }
    // advance along the street graph
    const moved = this.speed * dt;
    this._advance(moved);
    this.odo += moved;
    // wheels, bob, orientation
    for (const w of this.wheels) w.rotation.x -= moved / 0.28;
    const speedNorm = this.speed / MAX_SPEED;
    this.chassis.position.y = 0.3 + Math.sin(this.time * 10) * 0.015 * speedNorm;
    const f = this.world.travelFrame(this.edgeId, this.s, this.dir);
    // smooth the heading so 90-degree city corners do not snap the scooter
    this.visTan.lerp(f.tan, Math.min(1, dt * 7)).normalize();
    this.visRight.crossVectors(UP_VEC, this.visTan).normalize();
    this.world.edgePoint(this.edgeId, this.s, this.lateral, this.group.position, this.dir);
    orientAlong(this.group, this.visTan, this.visRight, this.lean * 0.3);
  }

  // ---- player physics (arcade) ----------------------------------------------
  _stepPlayer(dt) {
    const throttle = clamp(this.input.throttle, 0, 1);
    const brake = clamp(this.input.brake, 0, 1);
    const steer = clamp(this.input.steer, -1, 1);

    // drift state
    if (!this.isDrifting && brake > 0.5 && this.speed > 18) this.isDrifting = true;
    if (this.isDrifting && (brake < 0.2 || this.speed < 8)) this.isDrifting = false;

    const speedNorm = this.speed / MAX_SPEED;

    // longitudinal: throttle accel / coast drag / brake
    if (throttle > 0) this.speed += 14 * throttle * dt;
    else this.speed -= (0.35 * this.speed + 3) * dt;
    if (brake > 0) this.speed -= 26 * brake * dt;

    // off-road: extra decel + wobble
    const offRoad = Math.abs(this.lateral) > 7.3;
    if (offRoad) {
      this.speed -= 6 * dt;
      this.latVel += Math.sin(this.time * 13) * 1.5 * dt * (0.4 + speedNorm);
    }
    this.speed = clamp(this.speed, 0, MAX_SPEED);
    if (this.isDrifting) this.speed = Math.max(this.speed, MAX_SPEED * 0.55); // drift keeps momentum

    // lateral: steering accel, clamp, grip damping (low grip while drifting)
    this.latVel += steer * (3 + 9 * speedNorm) * dt;
    const latMax = 3 + 8 * speedNorm;
    this.latVel = clamp(this.latVel, -latMax, latMax);
    this.latVel *= 1 - Math.min(1, dt * (this.isDrifting ? 1.4 : 5));
    this.lateral += this.latVel * dt;

    // lean
    let leanT = clamp(-this.latVel * 0.09 - steer * 0.18 * speedNorm, -0.9, 0.9);
    if (offRoad) leanT = clamp(leanT + Math.sin(this.time * 15) * 0.08 * speedNorm, -0.9, 0.9);
    this.lean = lerp(this.lean, leanT, Math.min(1, dt * 8));
  }

  // ---- AI behaviour ----------------------------------------------------------
  _stepAI(dt, trafficCars, riders) {
    const world = this.world;
    const f = world.travelFrame(this.edgeId, this.s, this.dir);
    const myPos = world.edgePoint(this.edgeId, this.s, this.lateral, this._tmp, this.dir);
    const tan = f.tan, right = f.right;

    // curvature slowdown: compare heading 12 m and 34 m ahead along the route
    const tanA = this._aheadFrame(12).tan;
    const tanB = this._aheadFrame(34).tan;
    const ang = Math.acos(clamp(tanA.dot(tanB), -1, 1));
    const curv = clamp(1 - ang * 0.85, 0.55, 1);
    let targetSpeed = this.baseSpeed * curv;
    let targetLat = this.baseLane + Math.sin(this.time * 0.7 + this._wanderSeed) * 0.8;
    let holding = false;

    // pick the side of an obstacle that actually has road left
    const swerveLane = (blockLat, offset) => {
      const side = Math.sign(this.lateral - blockLat) || 1;
      let lane = clamp(blockLat + side * offset, -6.8, 6.8);
      if (Math.abs(lane - blockLat) < offset * 0.55) lane = clamp(blockLat - side * offset, -6.8, 6.8);
      return lane;
    };

    if (this.order && (this.phase === 'toPickup' || this.phase === 'toDropoff')) {
      const wp = this.phase === 'toPickup' ? this.order.from : this.order.to;
      const d = flatDist(myPos, wp.pos);
      if (d < 45) targetSpeed = Math.min(targetSpeed, Math.max(4.5, d * 0.55));
      // landmark.side is in the canonical a->b frame; flip it for the travel direction
      targetLat = clamp((wp.side || -1) * this.dir * 5, -6.8, 6.8);
    } else if (this.phase === 'pickupWait' || this.phase === 'deliverWait') {
      targetSpeed = 0; // self-stop while OrderSystem counts phaseT
      targetLat = this.lateral;
      holding = true;
    }

    // traffic avoid: only obstacles ahead in our own travel frame, works for
    // oncoming vehicles and vehicles on the crossing street alike
    if (!holding) {
      let avoidLat = 0, avoidD = Infinity, avoidSpeed = 0;
      for (const car of trafficCars) {
        const cp = car.group.position;
        const dx = cp.x - myPos.x, dz = cp.z - myPos.z;
        const along = dx * tan.x + dz * tan.z;
        const across = dx * right.x + dz * right.z;
        const halfLat = (car.width || 1.8) * 0.5 + 0.9;
        if (along > 0 && along < 22 && Math.abs(across) < halfLat && along < avoidD) {
          avoidD = along;
          avoidLat = across;
          avoidSpeed = car.speed;
        }
      }
      if (avoidD < Infinity) {
        targetLat = swerveLane(avoidLat, 2.9);
        if (avoidD < 10) targetSpeed = Math.min(targetSpeed, Math.max(avoidSpeed, 6));
      }
    }

    // rider avoid: swing around a slower scooter ahead, then match their pace
    if (!holding && riders.length > 1) {
      let blockLat = 0, blockD = Infinity, blockSpeed = 0;
      for (const o of riders) {
        if (o === this) continue;
        const dx = o.group.position.x - myPos.x, dz = o.group.position.z - myPos.z;
        const along = dx * tan.x + dz * tan.z;
        const across = dx * right.x + dz * right.z;
        if (along > 0.5 && along < 16 && Math.abs(across) < 2.4 && along < blockD) {
          blockD = along;
          blockLat = across;
          blockSpeed = o.speed;
        }
      }
      if (blockD < Infinity) {
        targetLat = swerveLane(blockLat, 2.6);
        if (blockD < 8) targetSpeed = Math.min(targetSpeed, Math.max(blockSpeed * 0.92, 4));
      }
    }

    // longitudinal
    if (this.speed < targetSpeed) this.speed = Math.min(targetSpeed, this.speed + 9 * dt);
    else this.speed = Math.max(targetSpeed, this.speed - 16 * dt);
    if (this.speed < 0.02) this.speed = 0;

    // lateral: ease toward target lane
    const desired = clamp((targetLat - this.lateral) * 1.6, -3.5, 3.5);
    this.latVel = lerp(this.latVel, desired, Math.min(1, dt * 2.5));
    this.lateral += this.latVel * dt;

    // lean from lateral velocity
    const leanT = clamp(-this.latVel * 0.12, -0.7, 0.7);
    this.lean = lerp(this.lean, leanT, Math.min(1, dt * 8));
  }

  // ---- collisions with traffic -----------------------------------------------
  _collide(trafficCars) {
    const world = this.world;
    const myPos = this.group.position; // previous frame's pose
    const myF = world.travelFrame(this.edgeId, this.s, this.dir);
    for (const car of trafficCars) {
      const cp = car.group.position;
      // Oriented box in the vehicle's travel frame: solid from every side.
      const cf = world.travelFrame(car.edgeId, car.s, car.dir);
      const dx = myPos.x - cp.x, dz = myPos.z - cp.z;
      const along = dx * cf.tan.x + dz * cf.tan.z;
      const across = dx * cf.right.x + dz * cf.right.z;
      const halfLen = car.len * 0.5 + 1.1;
      const halfLat = (car.width || 1.8) * 0.5 + 0.6;
      if (Math.abs(along) >= halfLen || Math.abs(across) >= halfLat) continue;

      // rear-ending a vehicle: never out-run it. Being shunted from behind:
      // get carried along at its speed so the body geometry cannot overlap.
      if (along < 0) this.speed = Math.min(this.speed, car.speed);
      else this.speed = Math.max(this.speed, car.speed);

      // bounded lateral escape in the rider's own frame; never accumulate latVel
      const dLat = dx * myF.right.x + dz * myF.right.z;
      const pen = halfLat - Math.abs(across);
      const dir = Math.sign(dLat) || (this.lateral >= 0 ? 1 : -1);
      this.lateral = clamp(this.lateral + dir * Math.min(Math.max(pen, 0.02), 0.07), -8.4, 8.4);
      this.latVel *= 0.5;
      this._bump();
    }
  }

  _bump() {
    if (this.time - this._lastBump < 0.5) return; // rate-limited
    this._lastBump = this.time;
    if (this.onBump) this.onBump(this);
  }
}

// ---------------------------------------------------------------------------
// RiderSystem — spawns the player + AI riders and updates them
// ---------------------------------------------------------------------------
export class RiderSystem {
  constructor(scene, world, nAI = 8, hooks = {}) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks || {};
    this.riders = [];

    this.player = new Rider(world, {
      isPlayer: true, name: 'YOU', jacketColor: PALETTE.grabGreen,
      edgeId: world.start.edgeId, s: world.start.s, dir: 1, lateral: -2,
      autopilot: true, baseSpeed: 24,
    });
    this._add(this.player);
    for (let i = 0; i < nAI; i++) {
      // spread the AI riders across the street network in both directions
      const edge = world.edges[(i * 7 + 3) % world.edges.length];
      const dir = i % 2 === 0 ? 1 : -1;
      const ai = new Rider(world, {
        isPlayer: false,
        name: choice(RIDER_NAMES),
        jacketColor: choice(PALETTE.jacketColors),
        edgeId: edge.id,
        s: edge.length * (0.3 + 0.4 * ((i * 3) % 5) / 5),
        dir,
        lateral: i % 2 === 0 ? -2 : -6,
      });
      this._add(ai);
    }
    this._playerDrift = this.player.isDrifting;
  }

  _add(r) {
    r.onBump = this.hooks.onBump || null;
    this.scene.add(r.group);
    this.riders.push(r);
  }

  update(dt, trafficCars) {
    for (const r of this.riders) r.update(dt, trafficCars, this.riders);
    this._separateRiders();
    const drifting = this.player.isDrifting;
    if (drifting !== this._playerDrift) {
      this._playerDrift = drifting;
      if (this.hooks.onSkid) this.hooks.onSkid(drifting);
    }
  }

  // Hard rider-vs-rider separation: no two scooters may occupy the same patch
  // of road. The rider behind cannot out-run the one ahead, and any lateral
  // overlap is split between the pair so they slide past instead of clipping.
  _separateRiders() {
    const rs = this.riders;
    const MIN_GAP = 5.0;  // metres along the road
    const MIN_LAT = 1.9;  // metres across the road
    // a couple of passes so three-way scrums resolve without a visible snap
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], b = rs[j];
          const dx = b.group.position.x - a.group.position.x;
          const dz = b.group.position.z - a.group.position.z;
          if (dx * dx + dz * dz > 64) continue; // nothing within 8 m

          const fa = this.world.travelFrame(a.edgeId, a.s, a.dir);
          const fb = this.world.travelFrame(b.edgeId, b.s, b.dir);
          const along = dx * fa.tan.x + dz * fa.tan.z;
          const across = dx * fa.right.x + dz * fa.right.z;
          if (Math.abs(along) >= MIN_GAP || Math.abs(across) >= MIN_LAT) continue;

          // longitudinal: whoever is behind must not run into the leader
          const aBehind = along < 0;
          const front = aBehind ? b : a;
          const rear = aBehind ? a : b;
          if (rear.speed > front.speed) {
            const closing = rear.speed - front.speed;
            rear.speed = Math.max(front.speed, 0);
            rear.latVel *= 0.4;
            if (closing > 3) rear._bump();
          }

          // lateral: ease the pair apart (max 0.3 m each per pass) so they slide
          // past instead of clipping; abrupt snaps would look like teleporting
          const push = Math.min(MIN_LAT - Math.abs(across), 0.6) * 0.5;
          const acrossB = dx * fb.right.x + dz * fb.right.z;
          if (Math.abs(across) > 1e-4) a.lateral = clamp(a.lateral - Math.sign(across) * push, -8.4, 8.4);
          if (Math.abs(acrossB) > 1e-4) b.lateral = clamp(b.lateral + Math.sign(acrossB) * push, -8.4, 8.4);
          a.latVel *= 0.85;
          b.latVel *= 0.85;
          this.world.edgePoint(a.edgeId, a.s, a.lateral, a.group.position, a.dir);
          this.world.edgePoint(b.edgeId, b.s, b.lateral, b.group.position, b.dir);
        }
      }
    }
  }

  setNight(on) {
    for (const r of this.riders) r.setNight(on);
  }
}
