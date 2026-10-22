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
  { name: 'Bulatan Park',        lat: 4.3920, lon: 113.9900, on: [] },
  { name: 'Grand Old Lady',      lat: 4.3940, lon: 113.9858, on: [] },
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

// Real Miri roundabouts. The centre node is replaced by a one-way ring of nodes
// so vehicles actually circulate around the island instead of cutting across it.
const ROUNDABOUT_DEFS = [
  { center: 'T', radius: 26, name: 'Bulatan Park' },
];

export class World {
  constructor() {
    this.halfW = 8;          // 16 m roadway everywhere
    this.roadY = 0.05;
    this.oceanX = COAST_X;
    this.roadMat = null;
    this.gantryLamps = [];
    this.roundabouts = [];
    this.signals = [];
    this.signalByApproach = new Map();
    this.signalTime = 0;

    const rng = seededRandom(4711);
    this.rng = rng;
    this.nodes = [];
    this.nodeById = new Map();
    for (const [id, x, z] of NODE_DEFS) {
      const node = { id, x, z, pos: new THREE.Vector3(x, 0, z), links: [] };
      node.index = this.nodes.length;
      this.nodes.push(node);
      this.nodeById.set(id, node);
    }
    this._buildRoundaboutNodes();

    this.edges = [];
    this.edgeById = new Map();
    const centers = new Set(ROUNDABOUT_DEFS.map((d) => d.center));
    for (const [a, b, name, kind] of EDGE_DEFS) {
      if (centers.has(a) && centers.has(b)) continue;
      const na = this._nodeAt(a, b), nb = this._nodeAt(b, a);
      this._makeEdge(na, nb, name, kind, { straight: centers.has(a) || centers.has(b) });
    }
    // one-way clockwise ring arcs (Malaysia drives on the left)
    for (const rb of this.roundabouts) {
      rb.ringOrder = this.nodes.filter((n) => n.roundabout === rb).sort((p, q) => p.ringAngle - q.ringAngle);
      for (let i = 0; i < rb.ringOrder.length; i++) {
        const na = rb.ringOrder[i], nb = rb.ringOrder[(i + 1) % rb.ringOrder.length];
        this._makeEdge(na, nb, rb.name + ' Roundabout', 'arterial', { ring: rb, oneWay: true });
      }
    }

    // Junction trim distances: road surfaces stop outside the paved junction.
    // Footpaths are measured against the actual mesh band: they are cut back to
    // the first point where their full width clears every crossing carriageway
    // (plus the roundabout annulus). That is angle-aware, so skewed junctions and
    // sharp bends are handled instead of only 90-degree crossroads.
    for (const n of this.nodes) n.degree = n.links.length;
    const roadTrim = (n) => (n.ring ? 4 : n.degree >= 3 ? 16 : 0.05);
    for (const e of this.edges) {
      e.trimStart = roadTrim(this.nodes[e.a]);
      e.trimEnd = roadTrim(this.nodes[e.b]);
    }
    for (const e of this.edges) {
      e.walkStart = { neg: 0, pos: 0 };
      e.walkEnd = { neg: 0, pos: 0 };
      if (e.noSurface) continue;
      const baseS = Math.min(e.trimStart + 2.5, e.length * 0.3);
      const baseE = Math.min(e.trimEnd + 2.5, e.length * 0.3);
      e.walkStart.neg = Math.max(baseS, this._measureWalkTrim(e, true, -16.4, -11.7, baseS));
      e.walkStart.pos = Math.max(baseS, this._measureWalkTrim(e, true, 11.7, 16.4, baseS));
      e.walkEnd.neg = Math.max(baseE, this._measureWalkTrim(e, false, -16.4, -11.7, baseE));
      e.walkEnd.pos = Math.max(baseE, this._measureWalkTrim(e, false, 11.7, 16.4, baseE));
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
      if (!best) {
        for (const e of this.edges) {
          const p = this._projectToEdge(e, target.x, target.z);
          if (!best || p.dist < best.dist) best = { edgeId: e.id, s: p.s, dist: p.dist };
        }
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
  _buildRoundaboutNodes() {
    for (const def of ROUNDABOUT_DEFS) {
      const center = this.nodeById.get(def.center);
      const rb = { ...def, centerNode: center, ringNodes: [], byOther: new Map(), ringOrder: [] };
      const others = [];
      for (const [a, b] of EDGE_DEFS) {
        if (a === def.center && !others.includes(b)) others.push(b);
        else if (b === def.center && !others.includes(a)) others.push(a);
      }
      others.forEach((otherId, i) => {
        const other = this.nodeById.get(otherId);
        const dx = other.x - center.x, dz = other.z - center.z;
        const d = Math.hypot(dx, dz) || 1;
        const x = center.x + (dx / d) * def.radius;
        const z = center.z + (dz / d) * def.radius;
        const node = {
          id: `${def.center}${i + 1}`, x, z, pos: new THREE.Vector3(x, 0, z),
          links: [], ring: true, roundabout: rb,
          ringAngle: Math.atan2(z - center.z, x - center.x),
        };
        node.index = this.nodes.length;
        this.nodes.push(node);
        this.nodeById.set(node.id, node);
        rb.ringNodes.push(node);
        rb.byOther.set(otherId, node);
      });
      this.roundabouts.push(rb);
    }
  }

  _nodeAt(id, otherId) {
    const rb = this.roundabouts.find((r) => r.center === id);
    return rb ? rb.byOther.get(otherId) : this.nodeById.get(id);
  }

  // clockwise arc samples around a roundabout centre (increasing atan2(z, x))
  _arcPoints(na, nb, rb) {
    const c = this.nodeById.get(rb.center);
    const R = rb.radius;
    const a0 = Math.atan2(na.pos.z - c.pos.z, na.pos.x - c.pos.x);
    let a1 = Math.atan2(nb.pos.z - c.pos.z, nb.pos.x - c.pos.x);
    while (a1 <= a0) a1 += Math.PI * 2;
    const steps = Math.max(6, Math.ceil((R * (a1 - a0)) / 4));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push(new THREE.Vector3(c.pos.x + Math.cos(a) * R, 0, c.pos.z + Math.sin(a) * R));
    }
    return pts;
  }

  _makeEdge(na, nb, name, kind, opts = {}) {
    const pts = opts.ring
      ? this._arcPoints(na, nb, opts.ring)
      : this._edgePoints(na, nb, opts.straight ? null : this.rng);
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
      id: this.edges.length, key: na.id + nb.id, name, kind,
      a: na.index, b: nb.index,
      pos, tan, right, n, step: length / n, length,
      halfW: this.halfW,
      curve,
      ring: !!opts.ring, noSurface: !!opts.ring, oneWay: !!opts.oneWay,
      trimStart: 0, trimEnd: 0,
    };
    // bounding circle, used to reject far edges quickly when testing whether a
    // footpath sample lands on somebody else's roadway
    let cx = 0, cz = 0;
    for (const p of pos) { cx += p.x; cz += p.z; }
    cx /= pos.length; cz /= pos.length;
    let reach = 0;
    for (const p of pos) reach = Math.max(reach, Math.hypot(p.x - cx, p.z - cz));
    edge.cx = cx; edge.cz = cz; edge.reach = reach + 0.5;
    this.edges.push(edge);
    this.edgeById.set(edge.key, edge);
    na.links.push({ edgeId: edge.id, dir: 1, to: nb.index });
    if (!opts.oneWay) nb.links.push({ edgeId: edge.id, dir: -1, to: na.index });
    return edge;
  }

  _edgePoints(na, nb, rng) {
    const pts = [na.pos.clone()];
    const chord = na.pos.distanceTo(nb.pos);
    if (rng && chord > 70) {
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

  // ---- footpath clearance ---------------------------------------------------
  // true when (x,z) lies on another street's asphalt (or on the roundabout
  // carriageway), i.e. exactly the places a raised footpath must never cross
  _onOtherRoad(x, z, excludeId, pad = 0.8) {
    const lim = this.halfW + pad;
    for (const e of this.edges) {
      if (e.id === excludeId) continue;
      if (Math.abs(x - e.cx) > e.reach + lim || Math.abs(z - e.cz) > e.reach + lim) continue;
      if (this._projectToEdge(e, x, z).dist < lim) return true;
    }
    for (const rb of this.roundabouts) {
      const d = Math.hypot(x - rb.centerNode.x, z - rb.centerNode.z);
      if (Math.abs(d - rb.radius) < this.halfW + pad) return true;
    }
    return false;
  }

  _bandBlocked(e, s, l0, l1) {
    const f = this.edgeFrame(e.id, s);
    return this._onOtherRoad(f.pos.x + f.right.x * l0, f.pos.z + f.right.z * l0, e.id) ||
           this._onOtherRoad(f.pos.x + f.right.x * l1, f.pos.z + f.right.z * l1, e.id);
  }

  // Walk in from an edge end until the whole [l0,l1] band is clear of every
  // crossing carriageway for a sustained stretch. This gives the true, geometry-
  // driven cut-back distance, so acute angles cut back further than right angles
  // and gentle bends need almost none.
  _measureWalkTrim(e, atA, l0, l1, base) {
    const cap = Math.min(e.length * 0.62, 40);
    let run = 0;
    for (let s = 0; s <= cap; s += 0.6) {
      const at = atA ? s : e.length - s;
      if (this._bandBlocked(e, at, l0, l1)) run = 0;
      else run += 0.6;
      if (s >= base && run >= 5.4) return Math.min(cap, s + 0.9);
    }
    return cap;
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
  // vertical ribbon along the road edge (raised kerb faces)
  _buildKerb(lat, y0, y1) {
    const verts = [], idx = [];
    let base = 0;
    for (const e of this.edges) {
      if (e.noSurface) continue;
      const side = lat < 0 ? 'neg' : 'pos';
      const s0 = e.walkStart[side], s1 = e.length - e.walkEnd[side];
      if (s1 - s0 < 0.5) continue;
      const steps = Math.max(1, Math.ceil((s1 - s0) / 4));
      const band = Math.abs(lat) > 10.5 ? [11.7, 16.4] : [9.6, 10.35];
      const clearRing = [];
      for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        const f = this.edgeFrame(e.id, s);
        verts.push(f.pos.x + f.right.x * lat, y0, f.pos.z + f.right.z * lat);
        verts.push(f.pos.x + f.right.x * lat, y1, f.pos.z + f.right.z * lat);
        clearRing.push(!this._bandBlocked(e, s, lat < 0 ? -band[1] : band[0], lat < 0 ? -band[0] : band[1]));
      }
      const rings = steps + 1;
      for (let k = 0; k < rings - 1; k++) {
        if (!clearRing[k] || !clearRing[k + 1]) continue;
        const b = base + k * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      base += rings * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // flat ribbon along the road. `raised` surfaces are cut back from junctions so
  // kerbs/footpaths never ride over a crossing roadway.
  _buildStrip(l0, l1, y, raised = false) {
    const verts = [], idx = [];
    let base = 0;
    for (const e of this.edges) {
      if (e.noSurface) continue;
      const side = l0 < 0 ? 'neg' : 'pos';
      const s0 = raised ? e.walkStart[side] : e.trimStart;
      const s1 = e.length - (raised ? e.walkEnd[side] : e.trimEnd);
      if (s1 - s0 < 0.5) continue;
      const steps = Math.max(1, Math.ceil((s1 - s0) / 4));
      // a hair of per-edge height separation avoids z-fighting where two
      // ribbons meet at a bend and share the same ground plane
      const yy = y + e.id * 0.00018;
      const clearRing = [];
      for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        const f = this.edgeFrame(e.id, s);
        verts.push(f.pos.x + f.right.x * l0, yy, f.pos.z + f.right.z * l0);
        verts.push(f.pos.x + f.right.x * l1, yy, f.pos.z + f.right.z * l1);
        if (raised) clearRing.push(!this._bandBlocked(e, s, l0, l1));
      }
      const rings = steps + 1;
      for (let k = 0; k < rings - 1; k++) {
        if (raised && (!clearRing[k] || !clearRing[k + 1])) continue;
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
      const s0 = e.trimStart + 4, s1 = e.length - e.trimEnd - 4;
      if (e.noSurface || s1 <= s0) continue;
      for (let s = s0; s < s1; s += step) {
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

  // ---- junction / roundabout / signal construction -------------------------
  _buildJunctionPatches() {
    const verts = [], idx = [];
    let vi = 0;
    for (const n of this.nodes) {
      if (n.ring || n.degree < 3) continue;
      const pts = [];
      for (const link of n.links) {
        const e = this.edges[link.edgeId];
        const atA = e.a === n.index;
        const s = atA ? e.trimStart : e.length - e.trimEnd;
        const f = this.edgeFrame(e.id, s);
        for (const lat of [-this.halfW, this.halfW]) {
          const x = f.pos.x + f.right.x * lat;
          const z = f.pos.z + f.right.z * lat;
          pts.push({ x, z, ang: Math.atan2(z - n.z, x - n.x) });
        }
      }
      if (pts.length < 6) continue;
      pts.sort((p, q) => p.ang - q.ang);
      const y = this.roadY - 0.004;
      verts.push(n.x, y, n.z);
      for (const p of pts) verts.push(p.x, y, p.z);
      for (let k = 0; k < pts.length; k++) {
        idx.push(vi, vi + 1 + ((k + 1) % pts.length), vi + 1 + k);
      }
      vi += pts.length + 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _buildRoundabouts() {
    const asphalt = this.roadMat || toonMat(PALETTE.asphalt);
    const kerbMat = toonMat(PALETTE.curbGray, { side: THREE.DoubleSide });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    for (const rb of this.roundabouts) {
      const c = rb.centerNode;
      const inner = rb.radius - this.halfW;
      const outer = rb.radius + this.halfW;
      const y = this.roadY;

      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96, 1), asphalt);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, y, c.z);
      this.group.add(ring);

      // raised island kerb + grass bowl
      const kerb = new THREE.Mesh(
        new THREE.CylinderGeometry(inner, inner, 0.16, 64, 1, true), kerbMat
      );
      kerb.position.set(c.x, 0.09, c.z);
      this.group.add(kerb);
      const island = new THREE.Mesh(new THREE.CircleGeometry(inner - 0.02, 64), toonMat(PALETTE.grass));
      island.rotation.x = -Math.PI / 2;
      island.position.set(c.x, 0.165, c.z);
      this.group.add(island);

      // circular edge lines
      for (const rad of [inner + 0.55, outer - 0.55]) {
        const line = new THREE.Mesh(new THREE.RingGeometry(rad - 0.07, rad + 0.07, 96), whiteMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(c.x, y + 0.014, c.z);
        this.group.add(line);
      }

      // dashed lane divider around the circle
      const dashGeo = new THREE.PlaneGeometry(0.16, 2.8);
      dashGeo.rotateX(-Math.PI / 2);
      const count = Math.floor((2 * Math.PI * rb.radius) / 9.5);
      const dashes = new THREE.InstancedMesh(dashGeo, whiteMat, count);
      const m4 = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const tan = new THREE.Vector3();
      const right = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        p.set(c.x + Math.cos(ang) * rb.radius, y + 0.014, c.z + Math.sin(ang) * rb.radius);
        tan.set(-Math.sin(ang), 0, Math.cos(ang));
        right.crossVectors(UP, tan).normalize();
        q.setFromRotationMatrix(m4.makeBasis(right, UP, tan));
        m4.compose(p, q, one);
        dashes.setMatrixAt(i, m4);
      }
      dashes.instanceMatrix.needsUpdate = true;
      this.group.add(dashes);
    }
  }

  _buildTrafficSignals() {
    const poleMat = toonMat(0x2b3036);
    const headMat = toonMat(0x191c20);
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 3.3, 8);
    const headGeo = new THREE.BoxGeometry(0.54, 1.34, 0.32);
    const lampGeo = new THREE.SphereGeometry(0.15, 8, 6);
    this.signalMats = {
      redOn: new THREE.MeshBasicMaterial({ color: 0xff2e2e }),
      redOff: new THREE.MeshBasicMaterial({ color: 0x3d1a19 }),
      amberOn: new THREE.MeshBasicMaterial({ color: 0xffb020 }),
      amberOff: new THREE.MeshBasicMaterial({ color: 0x3d2f14 }),
      greenOn: new THREE.MeshBasicMaterial({ color: 0x27e06a }),
      greenOff: new THREE.MeshBasicMaterial({ color: 0x12351f }),
    };

    const stopGeo = new THREE.PlaneGeometry(7.4, 0.55);
    stopGeo.rotateX(-Math.PI / 2);
    const stopMats = [];
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion();
    const m4 = new THREE.Matrix4();

    for (const node of this.nodes) {
      if (node.ring || node.degree < 3) continue;
      // sort approaches around the junction, alternate them between two phases
      const links = node.links.slice().sort((la, lb) => {
        const ta = this._travelTanAtNode(la.edgeId, la.dir, node.index);
        const tb = this._travelTanAtNode(lb.edgeId, lb.dir, node.index);
        return Math.atan2(ta.z, ta.x) - Math.atan2(tb.z, tb.x);
      });
      const signal = { nodeIndex: node.index, states: [-1, -1], heads: [] };
      links.forEach((link, i) => {
        const group = i % 2;
        const e = this.edges[link.edgeId];
        const incomingDir = -link.dir;
        const sStop = incomingDir > 0 ? e.length - 18 : 18;
        const f = this.travelFrame(e.id, sStop, incomingDir);

        const g = new THREE.Group();
        g.position.copy(f.pos).addScaledVector(f.right, -10.0);
        g.position.y = 0;
        g.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(f.right, UP, f.tan)
        );
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.65;
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 3.5;
        const lamps = [];
        for (let k = 0; k < 3; k++) {
          const lamp = new THREE.Mesh(lampGeo, this.signalMats.redOff);
          lamp.position.set(0, 3.92 - k * 0.42, -0.19);
          lamps.push(lamp);
        }
        g.add(pole, head, ...lamps);
        this.group.add(g);
        signal.heads.push({ group, lamps });
        this.signalByApproach.set(e.id + '|' + incomingDir, { signal, group });

        // stop line across the near-side lanes (Malaysia LHT = left of travel)
        p.copy(f.pos).addScaledVector(f.right, -4);
        p.y = this.roadY + 0.015;
        q.setFromRotationMatrix(m4.makeBasis(f.right, UP, f.tan));
        stopMats.push(new THREE.Matrix4().compose(p, q, one));
      });
      this.signals.push(signal);
    }

    if (stopMats.length) {
      const stopLines = new THREE.InstancedMesh(stopGeo, new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), stopMats.length);
      stopMats.forEach((mx, i) => stopLines.setMatrixAt(i, mx));
      stopLines.instanceMatrix.needsUpdate = true;
      this.group.add(stopLines);
    }
  }

  // 24 s cycle: 10 s green, 2 s amber, 12 s red, phases offset by half a cycle
  updateSignals(dt) {
    this.signalTime = (this.signalTime + dt) % 24;
    for (const s of this.signals) {
      for (let g = 0; g < s.states.length; g++) {
        const t = (this.signalTime + g * 12) % 24;
        const state = t < 10 ? 0 : t < 12 ? 1 : 2;
        if (s.states[g] === state) continue;
        s.states[g] = state;
        for (const h of s.heads) {
          if (h.group !== g) continue;
          h.lamps[0].material = state === 2 ? this.signalMats.redOn : this.signalMats.redOff;
          h.lamps[1].material = state === 1 ? this.signalMats.amberOn : this.signalMats.amberOff;
          h.lamps[2].material = state === 0 ? this.signalMats.greenOn : this.signalMats.greenOff;
        }
      }
    }
  }

  isRed(edgeId, dir) {
    const a = this.signalByApproach.get(edgeId + '|' + dir);
    return a ? a.signal.states[a.group] !== 0 : false;
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
    const seaTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1a9cba';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 130; i++) {
        const y = Math.random() * 256;
        const w = 20 + Math.random() * 90;
        const x = Math.random() * 256;
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(10,90,120,0.25)';
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + w * 0.5, y + (Math.random() - 0.5) * 8, x + w, y);
        ctx.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(16, 40);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2800, 4600), toonMat(PALETTE.seaBlue, { map: seaTex }));
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

    // raised kerbs + footpaths either side: gives the road a real edge profile
    const kerbMat = toonMat(PALETTE.curbGray);
    const walkMat = toonMat(0xb6bdb8);
    for (const side of [-1, 1]) {
      const kerb = new THREE.Mesh(this._buildKerb(side * 9.6, this.roadY, 0.17), kerbMat);
      kerb.material.side = THREE.DoubleSide;
      this.group.add(kerb);
      const verge = new THREE.Mesh(this._buildStrip(side * 9.6, side * 10.35, 0.17, true), kerbMat);
      verge.material.side = THREE.DoubleSide;
      this.group.add(verge);
      // footpath on the far side of the longkang drain
      const walk = new THREE.Mesh(this._buildStrip(side * 11.7, side * 16.4, 0.15, true), walkMat);
      walk.material.side = THREE.DoubleSide;
      this.group.add(walk);
      // kerb face for the footpath edge
      const walkKerb = new THREE.Mesh(this._buildKerb(side * 11.7, 0.05, 0.15), kerbMat);
      walkKerb.material.side = THREE.DoubleSide;
      this.group.add(walkKerb);
    }

    // ---- paved junction patches ----
    // polygon fan that fills the gap left by the trimmed road ribbons at every
    // multi-way junction, so no grass shows through the intersection
    const patchMat = toonMat(PALETTE.asphalt, { side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(this._buildJunctionPatches(), patchMat));

    // ---- roundabouts ----
    this._buildRoundabouts();

    // ---- lane markings ----
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    const yellowMat = new THREE.MeshBasicMaterial({ color: PALETTE.laneYellow });

    // continuous centre/edge lines are ribbons that follow the road frame, so
    // they can never drift out of alignment on curves
    const lineDefs = [
      [-0.4, -0.18, yellowMat], [0.18, 0.4, yellowMat],
      [-7.7, -7.48, whiteMat], [7.48, 7.7, whiteMat],
    ];
    for (const [l0, l1, mat] of lineDefs) {
      const m = new THREE.Mesh(this._buildStrip(l0, l1, this.roadY + 0.013), mat);
      m.material.side = THREE.DoubleSide;
      this.group.add(m);
    }

    const white = [];
    this._addMarkings(white, -4, 10, 3.8, 0.16);
    this._addMarkings(white, 4, 10, 3.8, 0.16);

    const makeInst = (list, mat) => {
      const im = new THREE.InstancedMesh(quad, mat, list.length);
      list.forEach((mx, i) => im.setMatrixAt(i, mx));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      return im;
    };
    makeInst(white, whiteMat);

    // ---- zebra crossings on the approach to every real junction ----
    const stripeGeo = new THREE.PlaneGeometry(0.9, 3.2);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeMats = [];
    const stripeP = new THREE.Vector3(), stripeSc = new THREE.Vector3(1, 1, 1);
    for (const e of this.edges) {
      if (e.noSurface) continue;
      for (const [s, node] of [[e.trimStart + 5, this.nodes[e.a]], [e.length - e.trimEnd - 5, this.nodes[e.b]]]) {
        if (node.degree < 3 || s < 6 || s > e.length - 6) continue;
        const f = this.edgeFrame(e.id, s);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(f.right, UP, f.tan)
        );
        for (let k = 0; k < 7; k++) {
          const lat = -6 + k * 2;
          stripeP.copy(f.pos).addScaledVector(f.right, lat);
          stripeP.y = this.roadY + 0.014;
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

    // ---- traffic lights ----
    this._buildTrafficSignals();

    // ---- JKR gantries at the landmarks ----
    for (const l of this.landmarks) {
      if (l.name === 'Bulatan Park') continue; // its sign sits on the island instead
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
