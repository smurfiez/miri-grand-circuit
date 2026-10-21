// world.js — Miri Grab Delivery Rush
// Hand-authored Miri street network (Coast Road, Jln Kipas, Jln Brooke, Jln Merbau,
// Boulevard, Jln Pujut, Jln Riam) as a graph of nodes and road edges. Riders and
// traffic navigate the graph; A* plans delivery routes. No single-ring circuit.
import * as THREE from 'three';
import { PALETTE, toonMat, textTexture, checkerTexture, flatMesh, clamp, seededRandom } from './shared.js';

export const SCALE = 0.25; // stylized compression: 1 real meter -> 0.25 scene meters
const LAT0 = 4.3980, LON0 = 113.9846; // Miri city centre GPS origin
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 110984; // 111320 * cos(4.4 deg)

// +x = east, -z = north (three.js ground convention)
export function gpsToScene(lat, lon) {
  const east = (lon - LON0) * M_PER_DEG_LON * SCALE;
  const north = (lat - LAT0) * M_PER_DEG_LAT * SCALE;
  return new THREE.Vector2(east, -north);
}

// Real Miri landmarks. `on` lists the road edge(s) each one fronts.
export const LANDMARK_GPS = [
  { name: 'Tua Pek Kong Temple', lat: 4.3980, lon: 113.9756, on: ['HL'] },
  { name: 'Marina Bay',          lat: 4.4100, lon: 113.9710, on: ['AB'] },
  { name: 'Coco Cabana',         lat: 4.4180, lon: 113.9760, on: ['JK'] },
  { name: 'Boulevard',           lat: 4.4130, lon: 113.9950, on: ['KX', 'XV'] },
  { name: 'Permyjaya E-Mart',    lat: 4.4030, lon: 113.9970, on: ['VW'] },
  { name: 'Bulatan Park',        lat: 4.3920, lon: 113.9900, on: ['PT', 'TU'] },
  { name: 'Grand Old Lady',      lat: 4.3940, lon: 113.9858, on: ['PT'] },
  { name: 'Pujut 7',             lat: 4.3790, lon: 113.9910, on: ['RS'] },
];

const COAST_X = -430; // coastline: South China Sea west of this x
export const oceanX = COAST_X;

// intersection nodes, scene metres (x, z)
const NODE_DEFS = [
  ['A', -350, -560], ['B', -350, -330], ['C', -350, -200], ['D', -350, 120],
  ['E', -300, -220], ['F', -300, -120], ['G', -300, 60], ['H', -260, -40],
  ['I', -260, 160], ['J', -220, -520], ['K', -260, -420], ['L', -180, -40],
  ['M', -140, 60], ['N', -160, 160], ['O', -100, -40], ['P', 0, 150],
  ['Q', 120, 300], ['R', 160, 430], ['S', 180, 540], ['T', 180, 170],
  ['U', 300, 120], ['V', 330, -20], ['W', 330, -140], ['X', 270, -400],
  ['Y', 60, -30], ['Z', 200, -30],
  ['N1', -40, -300],
];

// road edges in canonical a -> b order (string keys match landmark `on` hints)
const EDGE_DEFS = [
  ['A', 'B', 'Jln Lutong (Coast Road)', 'arterial'],
  ['B', 'C', 'Jln Tanjong Lobang', 'arterial'],
  ['C', 'D', 'Jln Tanjong Lobang', 'arterial'],
  ['D', 'I', 'Jln Bulatan', 'street'],

  ['B', 'E', 'Jln Kipas', 'street'],
  ['E', 'F', 'Jln Kipas', 'street'],
  ['F', 'H', 'Jln Kipas', 'street'],
  ['H', 'G', 'Jln Kipas', 'street'],
  ['G', 'I', 'Jln Kipas', 'street'],

  ['H', 'L', 'Jln Brooke', 'street'],
  ['L', 'O', 'Jln Brooke', 'street'],
  ['O', 'Y', 'Jln Brooke', 'street'],
  ['Y', 'Z', 'Jln Brooke', 'street'],
  ['Z', 'V', 'Jln Brooke', 'street'],
  ['V', 'W', 'Jln Brooke', 'street'],

  ['G', 'M', 'Jln Bendahara', 'street'],
  ['M', 'P', 'Jln Bendahara', 'street'],

  ['I', 'N', 'Jln Merbau', 'street'],
  ['N', 'P', 'Jln Merbau', 'street'],
  ['P', 'T', 'Jln Merbau', 'arterial'],
  ['T', 'U', 'Jln Merbau', 'arterial'],
  ['U', 'V', 'Jln Merbau', 'arterial'],

  ['L', 'M', 'Cross Street 1', 'lane'],
  ['O', 'M', 'Cross Street 2', 'lane'],
  ['U', 'W', 'Cross Street 4', 'lane'],

  ['J', 'K', 'Jln Riam', 'street'],
  ['K', 'E', 'Jln Riam', 'street'],

  ['K', 'X', 'Boulevard', 'arterial'],
  ['X', 'V', 'Boulevard', 'arterial'],

  ['W', 'U', 'Permyjaya Link', 'street'],

  ['T', 'Q', 'Jln Pujut', 'street'],
  ['Q', 'R', 'Jln Pujut', 'street'],
  ['R', 'S', 'Jln Pujut', 'street'],

  ['P', 'Q', 'Jln Miri-Bintulu', 'arterial'],

  // Interior grid: breaks the outer ring into real city blocks
  ['K', 'N1', 'Jln Airport', 'arterial'],
  ['N1', 'X', 'Jln Airport', 'street'],
  ['N1', 'Y', 'Jln Krokop', 'street'],
  ['Y', 'P', 'Jln Maju', 'street'],
  ['X', 'Z', 'Jln Piasau', 'street'],
];

const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor() {
    this.halfW = 8;          // 16 m roadway everywhere
    this.roadY = 0.05;
    this.oceanX = COAST_X;
    this.roadMat = null;
    this.gantryLamps = [];

    const rng = seededRandom(4711);
    this.nodes = [];
    this.nodeById = new Map();
    for (const [id, x, z] of NODE_DEFS) {
      const node = { id, x, z, pos: new THREE.Vector3(x, 0, z), links: [] };
      node.index = this.nodes.length;
      this.nodes.push(node);
      this.nodeById.set(id, node);
    }

    this.edges = [];
    this.edgeById = new Map();
    for (const [a, b, name, kind] of EDGE_DEFS) {
      const na = this.nodeById.get(a), nb = this.nodeById.get(b);
      const pts = this._edgePoints(na, nb, rng);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      curve.arcLengthDivisions = Math.max(60, Math.ceil(na.pos.distanceTo(nb.pos) * 6));
      const length = Math.max(1, curve.getLength());
      const n = Math.max(4, Math.ceil(length / 4)); // ~4 m between frames
      const spaced = curve.getSpacedPoints(n);     // n + 1 equal-arc points

      const pos = [], tan = [], right = [];
      for (let i = 0; i <= n; i++) pos.push(spaced[i].clone().setY(0));
      for (let i = 0; i <= n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1);
        const t = pos[i1].clone().sub(pos[i0]);
        if (t.lengthSq() < 1e-8) t.set(0, 0, 1);
        tan.push(t.normalize());
        right.push(new THREE.Vector3().crossVectors(UP, tan[i]).normalize());
      }

      const edge = {
        id: this.edges.length, key: a + b, name, kind,
        a: na.index, b: nb.index,
        pos, tan, right, n, step: length / n, length,
        halfW: this.halfW,
        curve,
      };
      this.edges.push(edge);
      this.edgeById.set(edge.key, edge);
      na.links.push({ edgeId: edge.id, dir: 1, to: nb.index });
      nb.links.push({ edgeId: edge.id, dir: -1, to: na.index });
    }

    // landmark snap points + which side of the canonical road they sit on
    this.landmarks = LANDMARK_GPS.map((g) => {
      const sp = gpsToScene(g.lat, g.lon);
      const target = new THREE.Vector3(sp.x, 0, sp.y);
      let best = null;
      for (const key of g.on) {
        const e = this.edgeById.get(key);
        if (!e) continue;
        const p = this._projectToEdge(e, target.x, target.z);
        if (!best || p.dist < best.dist) best = { edgeId: e.id, s: p.s, dist: p.dist };
      }
      const f = this.edgeFrame(best.edgeId, best.s);
      const roadPos = f.pos.clone();
      const side = Math.sign(target.clone().sub(roadPos).dot(f.right)) || 1;
      return { name: g.name, edgeId: best.edgeId, s: best.s, side, scenePos: target, roadPos };
    });

    let total = 0;
    for (const e of this.edges) total += e.length;
    this.lengthMeters = total;

    // player start: middle of Jln Brooke between Y and Z, facing east
    const startEdge = this.edgeById.get('YZ');
    this.start = { edgeId: startEdge.id, s: 30, dir: 1 };
  }

  // ---- construction helpers ------------------------------------------------
  _edgePoints(na, nb, rng) {
    const pts = [na.pos.clone()];
    const chord = na.pos.distanceTo(nb.pos);
    if (chord > 70) {
      const dir = nb.pos.clone().sub(na.pos).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);
      const amp = Math.min(14, chord * 0.045) * (rng() < 0.5 ? -1 : 1);
      const mid = na.pos.clone().lerp(nb.pos, 0.5).addScaledVector(perp, amp);
      pts.push(mid);
    }
    pts.push(nb.pos.clone());
    for (const p of pts) p.y = 0;
    return pts;
  }

  _projectToEdge(e, x, z) {
    let bestD2 = Infinity, bestI = 0;
    for (let i = 0; i <= e.n; i += 2) {
      const p = e.pos[i];
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
    let best = { s: bestI * e.step, dist: Math.sqrt(bestD2) };
    for (let i = Math.max(0, bestI - 1); i < Math.min(e.n, bestI + 1); i++) {
      const a = e.pos[i], b = e.pos[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const den = abx * abx + abz * abz || 1;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / den, 0, 1);
      const px = a.x + abx * t, pz = a.z + abz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best.dist) best = { s: e.step * (i + t), dist: d };
    }
    return best;
  }

  // ---- road frames ---------------------------------------------------------
  // s is canonical distance from node a. dir = +1 travels a -> b.
  edgeFrame(edgeId, s) {
    const e = this.edges[edgeId];
    const f = clamp(s / e.length, 0, 1) * e.n;
    const i0 = Math.min(e.n - 1, Math.floor(f));
    const i1 = Math.min(e.n, i0 + 1);
    const a = f - i0;
    const pos = e.pos[i0].clone().lerp(e.pos[i1], a);
    const tan = e.tan[i0].clone().lerp(e.tan[i1], a).normalize();
    const right = e.right[i0].clone().lerp(e.right[i1], a).normalize();
    return { pos, tan, right, bank: 0 };
  }

  // frame in the rider/vehicle travel direction
  travelFrame(edgeId, s, dir = 1) {
    const f = this.edgeFrame(edgeId, s);
    if (dir < 0) {
      f.tan.negate();
      f.right.negate();
    }
    return f;
  }

  // lateral is in the travel frame: negative = left of travel (Malaysia LHT)
  edgePoint(edgeId, s, lateral = 0, out = new THREE.Vector3(), dir = 1) {
    const f = this.edgeFrame(edgeId, s);
    out.copy(f.pos).addScaledVector(f.right, lateral * dir);
    out.y = this.roadY;
    return out;
  }

  // world-space point -> nearest road position
  projectToRoad(x, z) {
    let best = { edgeId: 0, s: 0, dist: Infinity };
    for (const e of this.edges) {
      const p = this._projectToEdge(e, x, z);
      if (p.dist < best.dist) best = { edgeId: e.id, s: p.s, dist: p.dist };
    }
    return best;
  }

  distToRoad(x, z) {
    let best = Infinity;
    for (const e of this.edges) {
      const d = this._projectToEdge(e, x, z).dist;
      if (d < best) best = d;
    }
    return best;
  }

  nearestLandmark(x, z) {
    let best = null, bestD = Infinity;
    for (const l of this.landmarks) {
      const d = (l.scenePos.x - x) ** 2 + (l.scenePos.z - z) ** 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  outgoing(nodeIndex) {
    return this.nodes[nodeIndex].links;
  }

  _travelTanAtNode(edgeId, dir, nodeIndex) {
    const e = this.edges[edgeId];
    const atB = e.b === nodeIndex;
    const f = atB ? this.edgeFrame(edgeId, e.length) : this.edgeFrame(edgeId, 0);
    return f.tan.multiplyScalar(dir > 0 ? 1 : -1);
  }

  // ---- A* over the street graph -------------------------------------------
  // start: {edgeId, s, dir}   target: {edgeId, s}
  // returns legs [{edgeId, dir, toS}] to follow in order
  findPath(start, target) {
    const se = this.edges[start.edgeId];
    const te = this.edges[target.edgeId];
    const sDir = start.dir >= 0 ? 1 : -1;

    // already on the target road, target ahead -> single leg
    if (start.edgeId === target.edgeId) {
      const ahead = (target.s - start.s) * sDir;
      if (ahead >= 0) return [{ edgeId: start.edgeId, dir: sDir, toS: target.s }];
    }

    const startNode = sDir > 0 ? se.b : se.a;
    const startRemain = sDir > 0 ? se.length - start.s : start.s;

    // approach the target road from whichever end is cheaper
    const opts = [
      { node: te.a, dir: 1, extra: target.s },
      { node: te.b, dir: -1, extra: te.length - target.s },
    ];
    let bestPlan = null;
    for (const o of opts) {
      const chain = this._astar(startNode, o.node, { edgeId: se.id, dir: sDir }, te.id);
      if (!chain) continue;
      const cost = startRemain + chain.cost + o.extra;
      if (!bestPlan || cost < bestPlan.cost) bestPlan = { ...o, chain, cost };
    }
    if (!bestPlan) return [{ edgeId: se.id, dir: sDir, toS: sDir > 0 ? se.length : 0 }];

    const legs = [{ edgeId: se.id, dir: sDir, toS: sDir > 0 ? se.length : 0 }];
    for (const step of bestPlan.chain.steps) {
      const e = this.edges[step.edgeId];
      legs.push({ edgeId: step.edgeId, dir: step.dir, toS: step.dir > 0 ? e.length : 0 });
    }
    legs.push({ edgeId: te.id, dir: bestPlan.dir, toS: target.s });
    return legs;
  }

  _astar(from, to, startLink, forbiddenEdgeId) {
    const N = this.nodes.length;
    const g = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(null);
    const closed = new Array(N).fill(false);
    const open = [from];
    g[from] = 0;
    const heur = (i) => this.nodes[i].pos.distanceTo(this.nodes[to].pos);

    while (open.length) {
      let bi = 0, bf = Infinity;
      for (let k = 0; k < open.length; k++) {
        const f = g[open[k]] + heur(open[k]);
        if (f < bf) { bf = f; bi = k; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === to) {
        const steps = [];
        let n = to;
        while (n !== from) {
          const p = prev[n];
          if (!p) return null;
          steps.push({ edgeId: p.edgeId, dir: p.dir });
          n = p.node;
        }
        steps.reverse();
        return { cost: g[to], steps };
      }
      if (closed[cur]) continue;
      closed[cur] = true;

      const incoming = prev[cur]
        ? { edgeId: prev[cur].edgeId, dir: prev[cur].dir }
        : { edgeId: startLink.edgeId, dir: startLink.dir };

      for (const link of this.nodes[cur].links) {
        // the target road itself is entered on the final leg, never as transit
        if (link.edgeId === forbiddenEdgeId) continue;
        const degree = this.nodes[cur].links.length;
        const uTurn = link.edgeId === incoming.edgeId && link.dir === -incoming.dir;
        if (uTurn && degree > 1) continue;

        let penalty = 0;
        if (!uTurn) {
          const a = this._travelTanAtNode(incoming.edgeId, incoming.dir, cur);
          const b = this._travelTanAtNode(link.edgeId, link.dir, cur);
          const ang = Math.acos(clamp(a.dot(b), -1, 1));
          if (ang > Math.PI / 3) penalty = 20;
        }
        const cost = g[cur] + this.edges[link.edgeId].length + penalty;
        if (cost < g[link.to]) {
          g[link.to] = cost;
          prev[link.to] = { node: cur, edgeId: link.edgeId, dir: link.dir };
          if (!closed[link.to] && !open.includes(link.to)) open.push(link.to);
        }
      }
    }
    return null;
  }

  _outgoingAt(nodeIndex, excludeEdgeId) {
    const all = this.nodes[nodeIndex].links;
    const forward = all.length > 1 ? all.filter((l) => l.edgeId !== excludeEdgeId) : all.slice();
    return forward.length ? forward : all;
  }

  // pick a random outgoing link at a node, preferring to keep going straight
  randomSuccessor(nodeIndex, excludeEdgeId, currentTan) {
    const pool = this._outgoingAt(nodeIndex, excludeEdgeId);
    if (pool.length === 1) return pool[0];
    if (currentTan && Math.random() < 0.65) {
      return this._straightest(nodeIndex, pool, currentTan);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  straightestSuccessor(nodeIndex, excludeEdgeId, currentTan) {
    const pool = this._outgoingAt(nodeIndex, excludeEdgeId);
    return this._straightest(nodeIndex, pool, currentTan);
  }

  _straightest(nodeIndex, pool, currentTan) {
    let best = pool[0], bestDot = -Infinity;
    for (const l of pool) {
      const t = this._travelTanAtNode(l.edgeId, l.dir, nodeIndex);
      const d = t.dot(currentTan);
      if (d > bestDot) { bestDot = d; best = l; }
    }
    return best;
  }

  // ---- rendering -----------------------------------------------------------
  _buildStrip(l0, l1, y) {
    const verts = [], idx = [];
    let base = 0;
    for (const e of this.edges) {
      const i0 = 1, i1 = Math.max(1, e.n - 1); // inset 4 m inside each junction
      for (let i = i0; i <= i1; i++) {
        const p = e.pos[i], r = e.right[i];
        verts.push(p.x + r.x * l0, y, p.z + r.z * l0);
        verts.push(p.x + r.x * l1, y, p.z + r.z * l1);
      }
      const rings = i1 - i0 + 1;
      for (let k = 0; k < rings - 1; k++) {
        const b = base + k * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      base += rings * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _addMarkings(list, lateral, step, len, w) {
    const p = new THREE.Vector3(), sc = new THREE.Vector3(w, 1, len);
    for (const e of this.edges) {
      for (let s = 6; s < e.length - 6; s += step) {
        const f = this.edgeFrame(e.id, s);
        p.copy(f.pos).addScaledVector(f.right, lateral);
        p.y = this.roadY + 0.012;
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(f.right, UP, f.tan)
        );
        list.push(new THREE.Matrix4().compose(p, q, sc));
      }
    }
  }

  build(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // ---- ground ----
    const grassTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#6fae5c';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * 128, y = Math.random() * 128;
        const r = Math.random() * 2.2 + 0.6;
        ctx.fillStyle = Math.random() < 0.55
          ? `rgba(${70 + Math.random() * 30 | 0}, ${140 + Math.random() * 45 | 0}, ${60 + Math.random() * 30 | 0}, 0.5)`
          : `rgba(${95 + Math.random() * 40 | 0}, ${165 + Math.random() * 45 | 0}, ${75 + Math.random() * 35 | 0}, 0.4)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(260, 260);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), toonMat(PALETTE.grass, { map: grassTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    this.group.add(ground);

    // ---- sea + beach ----
    const sea = flatMesh(new THREE.PlaneGeometry(2800, 4600), PALETTE.seaBlue);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(COAST_X - 1400, -0.02, -100);
    this.group.add(sea);
    const beach = flatMesh(new THREE.PlaneGeometry(150, 4400), PALETTE.sand);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(COAST_X - 72, -0.04, -100);
    this.group.add(beach);
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 4400),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(COAST_X - 7, 0.02, -100);
    this.group.add(foam);
    this.seaMesh = sea;

    // ---- roadway + shoulders ----
    this.roadMat = toonMat(PALETTE.asphalt);
    const road = new THREE.Mesh(this._buildStrip(-this.halfW, this.halfW, this.roadY), this.roadMat);
    road.material.side = THREE.DoubleSide;
    this.group.add(road);
    this.roadMesh = road;

    const shoulderMat = toonMat(PALETTE.concrete);
    for (const [a, b] of [[-9.6, -8], [8, 9.6]]) {
      const m = new THREE.Mesh(this._buildStrip(a, b, this.roadY - 0.005), shoulderMat);
      m.material.side = THREE.DoubleSide;
      this.group.add(m);
    }

    // ---- junction slabs ----
    const slabGeo = new THREE.CircleGeometry(this.halfW * 1.45, 30);
    slabGeo.rotateX(-Math.PI / 2);
    const slabMat = toonMat(PALETTE.asphalt);
    const slabs = new THREE.InstancedMesh(slabGeo, slabMat, this.nodes.length);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      m4.makeTranslation(n.x, 0.035, n.z);
      slabs.setMatrixAt(i, m4);
    }
    slabs.instanceMatrix.needsUpdate = true;
    this.group.add(slabs);

    // ---- lane markings ----
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    const yellowMat = new THREE.MeshBasicMaterial({ color: PALETTE.laneYellow });

    const yellow = [], white = [];
    this._addMarkings(yellow, -0.28, 8, 9.2, 0.14);
    this._addMarkings(yellow, 0.28, 8, 9.2, 0.14);
    this._addMarkings(white, -4, 9, 3.6, 0.16);
    this._addMarkings(white, 4, 9, 3.6, 0.16);
    this._addMarkings(white, -7.55, 8, 9.2, 0.2);
    this._addMarkings(white, 7.55, 8, 9.2, 0.2);

    const makeInst = (list, mat) => {
      const im = new THREE.InstancedMesh(quad, mat, list.length);
      list.forEach((mx, i) => im.setMatrixAt(i, mx));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      return im;
    };
    makeInst(yellow, yellowMat);
    makeInst(white, whiteMat);

    // ---- zebra crossings on junction approaches ----
    const stripeGeo = new THREE.PlaneGeometry(0.9, 3.2);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeMats = [];
    const stripeP = new THREE.Vector3(), stripeSc = new THREE.Vector3(1, 1, 1);
    for (const e of this.edges) {
      for (const s of [10, e.length - 10]) {
        if (s < 6 || s > e.length - 6) continue;
        const f = this.edgeFrame(e.id, s);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(f.right, UP, f.tan)
        );
        for (let k = 0; k < 7; k++) {
          const lat = -6 + k * 2;
          stripeP.copy(f.pos).addScaledVector(f.right, lat);
          stripeP.y = this.roadY + 0.012;
          stripeMats.push(new THREE.Matrix4().compose(stripeP, q, stripeSc));
        }
      }
    }
    if (stripeMats.length) {
      const zebra = new THREE.InstancedMesh(stripeGeo, whiteMat, stripeMats.length);
      stripeMats.forEach((mx, i) => zebra.setMatrixAt(i, mx));
      zebra.instanceMatrix.needsUpdate = true;
      this.group.add(zebra);
    }

    // ---- JKR gantries at the landmarks ----
    for (const l of this.landmarks) {
      const f = this.edgeFrame(l.edgeId, l.s);
      const g = new THREE.Group();
      const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 7, 8), toonMat(0x1c7a3d));
      postL.position.set(-9.4, 3.5, 0);
      const postR = postL.clone(); postR.position.x = 9.4;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(19.4, 0.5, 0.5), toonMat(0x1c7a3d));
      beam.position.y = 6.7;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8.4, 2.1),
        new THREE.MeshBasicMaterial({
          map: textTexture(l.name.toUpperCase(), { bg: '#0a5c2f', border: true, size: 48 }),
        })
      );
      sign.position.set(0, 7.6, 0.05);
      const signBack = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.1), toonMat(0x0a5c2f));
      signBack.rotation.y = Math.PI;
      signBack.position.set(0, 7.6, -0.05);
      const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5555 }));
      lampL.position.set(-8.6, 6.95, 0.3);
      const lampR = lampL.clone(); lampR.position.x = 8.6;
      this.gantryLamps.push(lampL.material, lampR.material);
      g.add(postL, postR, beam, sign, signBack, lampL, lampR);
      g.position.copy(f.pos);
      g.position.y = 0;
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, UP, f.tan));
      this.group.add(g);
    }

    // ---- start banner ----
    const bannerG = new THREE.Group();
    const bpostL = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 8, 8), toonMat(0x222222));
    bpostL.position.set(-9.4, 4, 0);
    const bpostR = bpostL.clone(); bpostR.position.x = 9.4;
    const checker = new THREE.Mesh(new THREE.PlaneGeometry(18.6, 1.1), new THREE.MeshBasicMaterial({ map: checkerTexture(24, 16) }));
    checker.position.y = 7.2;
    const bSign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 2.6),
      new THREE.MeshBasicMaterial({ map: textTexture('MIRI GRAB DELIVERY RUSH', { bg: '#00b14f', size: 56, border: true, borderColor: '#14161a' }) })
    );
    bSign.position.set(0, 5.7, 0.06);
    const bSignBack = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.6), toonMat(PALETTE.grabGreen));
    bSignBack.rotation.y = Math.PI;
    bSignBack.position.set(0, 5.7, -0.06);
    bannerG.add(bpostL, bpostR, checker, bSign, bSignBack);
    const sf = this.edgeFrame(this.start.edgeId, this.start.s);
    bannerG.position.copy(sf.pos);
    bannerG.position.y = 0;
    bannerG.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sf.right, UP, sf.tan));
    this.group.add(bannerG);
  }

  setNight(on) {
    for (const m of this.gantryLamps) m.color.set(on ? 0xff6666 : 0x552222);
  }

  setWet(on) {
    if (this.roadMat) this.roadMat.color.set(on ? PALETTE.asphaltWet : PALETTE.asphalt);
  }
}
