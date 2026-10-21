// scenery.js — Miri Grab Delivery Rush
// Sarawak shophouses with kaki lima colonnades, longkang monsoon drains, street lamps,
// casuarina (Pokok Rhu) coast trees, Bukit Kanada rainforest, telegraph poles & props.
import * as THREE from 'three';
import { PALETTE, toonMat, addOutline, box, cyl, cone, flatMesh, textTexture, orientAlong, clamp, rand, seededRandom } from './shared.js';

const UP = new THREE.Vector3(0, 1, 0);
const SHOP_NAMES = [
  'KEDAI KOPI AH HUAT', '99 SPEEDMART', 'SALON SURI', 'KEDAI EMAS', 'WARUNG KOLO MEE',
  'TAMAN CAKES', 'KEDAI OBAT SIN HEE', 'MEE JAWA 88', 'FONG PHOTO', 'KEDAI RUNCIT PUJUT',
  'POH KONG JEWELLERY', 'KEDAI GUNTING', 'SIN SENG HIN', 'KEDAI BUKU MIRI',
];

export class Scenery {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.nightMats = [];
    this.nightMeshes = [];
    this.lampPools = null;
  }

  _frame(edgeId, s, lateral) {
    const f = this.world.edgeFrame(edgeId, s);
    const pos = this.world.edgePoint(edgeId, s, lateral);
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(f.right, UP, f.tan)
    );
    return { f, pos, q };
  }

  _isNearJunction(edge, s, tol = 22) {
    return s < tol || s > edge.length - tol;
  }

  // Reject spots where a 21 m lateral offset would sit on another street
  _clearOfOtherRoad(edgeId, pos, margin = 26) {
    const p = this.world.projectToRoad(pos.x, pos.z);
    return p.edgeId === edgeId || p.dist >= margin;
  }

  build(landmarks) {
    this.scene.add(this.group);
    this._shophouses();
    this._drains();
    this._streetLamps();
    this._coastTrees();
    this._palms();
    this._rainforest(landmarks);
    this._telegraphPoles();
    this._busShelters();
    this._props();
  }

  // ---------------- coconut palms (Miri roadside signature) ----------------
  _palms() {
    const rng = seededRandom(5150);
    const N = 90;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 7.5, 5);
    trunkGeo.translate(0, 3.75, 0);
    const trunkMat = toonMat(0x8a6a45);
    const frondGeo = new THREE.PlaneGeometry(0.9, 3.6);
    frondGeo.translate(0, 1.8, 0);
    frondGeo.rotateX(Math.PI / 2);
    const frondMat = toonMat(PALETTE.palmGreen, { side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, N * 7);
    const trunks2 = trunks;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let fi = 0;
    for (let i = 0; i < N; i++) {
      const edge = this.world.edges[Math.floor(rng() * this.world.edges.length)];
      const s = 8 + rng() * (edge.length - 16);
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * (11.5 + rng() * 6);
      p.copy(this.world.edgePoint(edge.id, s, lat));
      p.y = 0; // palms root into the flat ground beside the cambered road
      const hs = rand(0.85, 1.35);
      const tiltX = rand(-0.07, 0.07), tiltZ = rand(-0.07, 0.07);
      e.set(tiltX, rng() * Math.PI * 2, tiltZ);
      q.setFromEuler(e);
      sc.set(1, hs, 1);
      m.compose(p, q, sc);
      trunks.setMatrixAt(i, m);
      // crown fronds fanned around the trunk top
      const topY = p.y + 7.4 * hs;
      for (let f = 0; f < 7; f++) {
        const ang = (f / 7) * Math.PI * 2 + rng() * 0.2;
        const droop = -0.12 - rng() * 0.3; // slight downward droop of the frond tips
        e.set(droop, ang, 0, 'YXZ');
        q.setFromEuler(e);
        p.set(p.x, topY, p.z);
        const fs = rand(0.8, 1.25) * hs;
        sc.set(fs, fs, fs);
        // rotate around crown centre then translate outward
        m.compose(p, q, sc);
        fronds.setMatrixAt(fi++, m);
      }
    }
    fronds.count = fi;
    trunks.instanceMatrix.needsUpdate = true;
    fronds.instanceMatrix.needsUpdate = true;
    this.group.add(trunks2, fronds);
  }

  // ---------------- Sarawak shophouses with kaki lima ----------------
  _shophouses() {
    const rng = seededRandom(1337);
    const clusters = [
      ['Boulevard', 1], ['Boulevard', -1],
      ['Permyjaya E-Mart', 1], ['Permyjaya E-Mart', -1],
      ['Pujut 7', -1], ['Pujut 7', 1],
      ['Tua Pek Kong Temple', 1], ['Tua Pek Kong Temple', -1],
      ['Bulatan Park', 1], ['Marina Bay', 1],
    ];
    const bodyMat = {};
    let nameIdx = 0;

    for (const [anchorName, side] of clusters) {
      const a = this.world.landmarks.find(x => x.name === anchorName);
      if (!a) continue;
      const edge = this.world.edges[a.edgeId];
      const count = 6 + Math.floor(rng() * 4);
      const startS = clamp(a.s - count * 6.5, 16, edge.length - 16);
      for (let k = 0; k < count; k++) {
        const s = startS + k * 13;
        // keep clear of junctions
        if (this._isNearJunction(edge, s, 24)) continue;
        const jitter = (rng() - 0.5) * 1.2;
        const lateral = side * (21.5 + jitter);
        const { pos, q } = this._frame(edge.id, s, lateral);
        if (!this._clearOfOtherRoad(edge.id, pos)) continue;
        const g = new THREE.Group();
        g.position.copy(pos);
        // buildings stand on the flat padang, not on the road's camber
        g.position.y = 0.02;
        g.quaternion.copy(q);
        // local +X points at the road: right-side clusters are mirrored vs left-side
        const face = -side;

        const w = 8.4 + rng() * 1.2;
        const h = 8.6 + rng() * 4.4;
        const d = 10.5;
        const color = PALETTE.shophouseColors[nameIdx % PALETTE.shophouseColors.length];
        nameIdx++;

        const body = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), toonMat(color));
        body.position.set(0, h / 2, 0);
        addOutline(body, 1.012);
        g.add(body);

        // parapet + roof
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(d + 0.4, 0.7, w + 0.4), toonMat(0x9a9488));
        parapet.position.set(0, h + 0.35, 0);
        g.add(parapet);

        // five-foot-way: raised walkway slab + columns + overhang roof
        const walk = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.24, w), toonMat(0xb9b2a4));
        walk.position.set(face * (d / 2 + 1.4), 0.42, 0);
        g.add(walk);
        for (let c = 0; c < 3; c++) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.5, 0.34), toonMat(0xa09a8c));
          col.position.set(face * (d / 2 + 2.55), 1.7, -w / 2 + 1.1 + c * (w - 2.2) / 2);
          g.add(col);
        }
        const overhang = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.22, w + 0.3), toonMat(0x8d867a));
        overhang.position.set(face * (d / 2 + 1.4), 3.0, 0);
        g.add(overhang);

        // striped awning projecting over the five-foot-way
        const awnMat = toonMat([0xc0392b, 0x1d5c33, 0x16406b, 0x7a2b5c][Math.floor(rng() * 4)]);
        const awning = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, w - 0.4), awnMat);
        awning.position.set(face * (d / 2 + 3.0), 3.55, 0);
        awning.rotation.z = -face * 0.22;
        g.add(awning);

        // ground floor shutter (dark) on road-facing side
        const shutter = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.2, 2.5), new THREE.MeshBasicMaterial({ color: 0x2b2f36 }));
        shutter.rotation.y = face * Math.PI / 2;
        shutter.position.set(face * (d / 2 + 0.05), 1.3, 0);
        g.add(shutter);

        // upper windows
        for (let win = 0; win < 3; win++) {
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ color: 0x3a4f63 }));
          pane.rotation.y = face * Math.PI / 2;
          pane.position.set(face * (d / 2 + 0.06), h - 1.9, -w / 2 + 1.6 + win * (w - 3.2) / 2);
          g.add(pane);
        }

        // signboard
        const label = SHOP_NAMES[Math.floor(rng() * SHOP_NAMES.length)];
        const tex = textTexture(label, { w: 512, h: 128, bg: ['#8e2b20', '#16406b', '#1d5c33', '#7a2b5c'][Math.floor(rng() * 4)], fg: '#ffd23f', size: 46 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.8, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
        sign.rotation.y = face * Math.PI / 2;
        sign.position.set(face * (d / 2 + 0.09), 3.6, 0);
        g.add(sign);

        // AC units / utility boxes on the flank
        for (let u = 0; u < 2; u++) {
          const ac = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.45), toonMat(0xd8dde0));
          ac.position.set(-face * (d / 2 - 1), h - 2.6 - u * 1.6, -w / 2 + 1);
          g.add(ac);
        }
        this.group.add(g);
      }
    }
  }

  // ---------------- longkang monsoon drains ----------------
  _drains() {
    const seg = 8; // meters per segment
    let cap = 0;
    for (const e of this.world.edges) cap += Math.floor(e.length / seg);
    const wallGeo = new THREE.BoxGeometry(0.22, 0.55, seg * 0.92);
    const waterGeo = new THREE.PlaneGeometry(1.15, seg * 0.9);
    waterGeo.rotateX(-Math.PI / 2);
    const wallMat = toonMat(0x9aa39d);
    const waterMat = new THREE.MeshToonMaterial({ color: 0x1c4a4a });
    waterMat.emissive = new THREE.Color(0x16383a);
    waterMat.emissiveIntensity = 0.25;

    const walls = new THREE.InstancedMesh(wallGeo, wallMat, cap * 4);
    const waters = new THREE.InstancedMesh(waterGeo, waterMat, cap * 2);
    let wCount = 0, wtrCount = 0;
    const m = new THREE.Matrix4(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const edge of this.world.edges) {
      const total = Math.floor(edge.length / seg);
      for (let i = 0; i < total; i++) {
        const s = i * seg + seg * 0.5;
        if (this._isNearJunction(edge, s, 10)) continue;
        const f = this.world.edgeFrame(edge.id, s);
        q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, UP, f.tan));

        for (const side of [-1, 1]) {
          const lat = side * 10.9;
          // nearside lip, water channel, far lip
          for (const dl of [-0.62, 0.62]) {
            this.world.edgePoint(edge.id, s, lat + side * dl, p);
            p.y += 0.14;
            m.compose(p, q, sc);
            walls.setMatrixAt(wCount++, m);
          }
          this.world.edgePoint(edge.id, s, lat, p);
          p.y += 0.16;
          m.compose(p, q, sc);
          waters.setMatrixAt(wtrCount++, m);
        }
      }
    }
    walls.count = wCount;
    waters.count = wtrCount;
    walls.instanceMatrix.needsUpdate = true;
    waters.instanceMatrix.needsUpdate = true;
    this.group.add(walls, waters);
  }

  // ---------------- street lamps ----------------
  _streetLamps() {
    const spacing = 42;
    let count = 0;
    for (const e of this.world.edges) count += Math.max(1, Math.floor(e.length / spacing));
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 7.4, 6);
    const armGeo = new THREE.BoxGeometry(2.1, 0.13, 0.13);
    const headGeo = new THREE.BoxGeometry(1.0, 0.22, 0.4);
    const poleMat = toonMat(0x4a5560);
    const headMat = toonMat(0x6b7580);
    headMat.emissive = new THREE.Color(0xffe9a8);
    headMat.emissiveIntensity = 0;
    const poolGeo = new THREE.PlaneGeometry(13, 13);
    poolGeo.rotateX(-Math.PI / 2);
    // soft radial falloff so the pool reads as light, not a flat square
    const poolTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,224,160,1)');
      g.addColorStop(0.45, 'rgba(255,214,130,0.42)');
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count);
    pools.visible = false;

    const m = new THREE.Matrix4(), sc = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion();
    let n = 0;
    for (const edge of this.world.edges) {
      const per = Math.max(1, Math.floor(edge.length / spacing));
      const gap = edge.length / per;
      for (let i = 0; i < per; i++) {
        const s = (i + 0.5) * gap;
        if (this._isNearJunction(edge, s, 12)) continue;
        const side = n % 2 === 0 ? -1 : 1;
        const f = this.world.edgeFrame(edge.id, s);
        q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, UP, f.tan));

        const p0 = this.world.edgePoint(edge.id, s, side * 9.6); p0.y += 3.7;
        m.compose(p0, q, sc); poles.setMatrixAt(n, m);

        const pArm = this.world.edgePoint(edge.id, s, side * 8.6); pArm.y += 7.3;
        m.compose(pArm, q, sc); arms.setMatrixAt(n, m);

        const pHead = this.world.edgePoint(edge.id, s, side * 7.7); pHead.y += 7.2;
        m.compose(pHead, q, sc); heads.setMatrixAt(n, m);

        const pPool = this.world.edgePoint(edge.id, s, side * 7.6); pPool.y += 0.09;
        m.compose(pPool, new THREE.Quaternion(), sc); pools.setMatrixAt(n, m);
        n++;
      }
    }
    poles.count = n;
    arms.count = n;
    heads.count = n;
    pools.count = n;
    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    this.group.add(poles, arms, heads, pools);
    this.lampPools = pools;
    this.nightMats.push({ mat: headMat, on: 1.4 });
  }

  // ---------------- casuarina trees along the coast ----------------
  _coastTrees() {
    const rng = seededRandom(808);
    const N = 46;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 9, 5);
    const trunkGeo2 = trunkGeo.clone();
    trunkGeo2.translate(0, 4.5, 0);
    const trunkMat = toonMat(0x6b4a2f);
    const foliageGeo = new THREE.ConeGeometry(1.5, 5, 7);
    foliageGeo.translate(0, 3, 0);
    const foliageMat = toonMat(0x2f6b3f);
    const trunks = new THREE.InstancedMesh(trunkGeo2, trunkMat, N);
    const tops = new THREE.InstancedMesh(foliageGeo, foliageMat, N * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const euler = new THREE.Euler();
    let ti = 0, fi = 0;
    for (let i = 0; i < N; i++) {
      const z = -900 + (i / N) * 1800 + rand(-16, 16);
      const x = this.world.oceanX ?? -430;
      const px = x - 60 - rng() * 25;
      pos.set(px, 0, z);
      euler.set(rand(-0.08, 0.08), rand(0, Math.PI * 2), rand(-0.1, 0.1));
      q.setFromEuler(euler);
      const hScale = rand(0.8, 1.3);
      sc.set(1, hScale, 1);
      m.compose(pos, q, sc);
      trunks.setMatrixAt(ti++, m);
      for (let k = 0; k < 3; k++) {
        const p2 = new THREE.Vector3(px + rand(-0.3, 0.3), 7.4 * hScale + k * 1.8, z + rand(-0.3, 0.3));
        const s2 = new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.75, 1.05) * (1 - k * 0.2));
        euler.set(rand(-0.12, 0.12), rand(0, Math.PI * 2), rand(-0.12, 0.12));
        q.setFromEuler(euler);
        m.compose(p2, q, s2);
        tops.setMatrixAt(fi++, m);
      }
    }
    tops.count = fi;
    trunks.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, tops);
  }

  // ---------------- Bukit Kanada + roadside rainforest ----------------
  _rainforest(landmarks) {
    const rng = seededRandom(4242);
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 4.4, 5);
    trunkGeo.translate(0, 2.2, 0);
    const canopyGeo = new THREE.SphereGeometry(1.9, 7, 5);
    const trunkMat = toonMat(0x5d4126);
    const canopyMat = toonMat(PALETTE.leafGreen);
    const trunkMat2 = toonMat(0x6b4a2f);
    const canopyMat2 = toonMat(PALETTE.leafDark);

    const spots = [];
    // hill scatter
    if (landmarks && landmarks.hillCenter && landmarks.hillRadius > 0) {
      const c = landmarks.hillCenter, R = landmarks.hillRadius;
      for (let i = 0; i < 150; i++) {
        const ang = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * R * 0.82;
        const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
        if (this.world.distToRoad(x, z) < 18) continue;
        const y = c.y * clamp(1 - r / R, 0, 1) * 0.9;
        spots.push({ x, y, z });
      }
    }
    // roadside scatter
    let guard = 0;
    while (spots.length < 460 && guard++ < 6000) {
      const x = rand(-360, 640), z = rand(-620, 620);
      const dRoad = this.world.distToRoad(x, z);
      if (dRoad < 14 || dRoad > 85) continue;
      if (x < (this.world.oceanX ?? -430) + 40) continue;
      spots.push({ x, y: 0, z });
    }

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    const canopies2 = new THREE.InstancedMesh(canopyGeo, canopyMat2, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach((s, i) => {
      const hs = rand(0.8, 1.5);
      e.set(rand(-0.05, 0.05), rand(0, Math.PI * 2), rand(-0.05, 0.05));
      q.setFromEuler(e);
      p.set(s.x, s.y, s.z);
      sc.set(1, hs, 1);
      m.compose(p, q, sc);
      trunks.setMatrixAt(i, m);
      const cs = rand(0.8, 1.35) * hs;
      p.set(s.x, s.y + 4.2 * hs, s.z);
      sc.set(cs, cs * rand(0.9, 1.25), cs);
      m.compose(p, q, sc);
      canopies.setMatrixAt(i, m);
      p.set(s.x + rand(-1.1, 1.1), s.y + 5.1 * hs, s.z + rand(-1.1, 1.1));
      sc.multiplyScalar(0.7);
      m.compose(p, q, sc);
      canopies2.setMatrixAt(i, m);
    });
    for (const im of [trunks, canopies, canopies2]) im.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, canopies, canopies2);
  }

  // ---------------- telegraph poles + sagging wires ----------------
  _telegraphPoles() {
    const spacing = 72;
    let count = 0;
    for (const e of this.world.edges) count += Math.max(1, Math.floor(e.length / spacing));
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const armGeo = new THREE.BoxGeometry(2.4, 0.16, 0.16);
    const mat = toonMat(0x55412c);
    const poles = new THREE.InstancedMesh(poleGeo, mat, count);
    const arms = new THREE.InstancedMesh(armGeo, mat, count);
    const m = new THREE.Matrix4(), sc = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion();
    const pts = [];
    let n = 0;
    for (const edge of this.world.edges) {
      const per = Math.max(1, Math.floor(edge.length / spacing));
      const gap = edge.length / per;
      let prev = null;
      for (let i = 0; i < per; i++) {
        const s = (i + 0.5) * gap;
        if (this._isNearJunction(edge, s, 14)) { prev = null; continue; }
        const side = n % 2 === 0 ? 1 : -1;
        const f = this.world.edgeFrame(edge.id, s);
        q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, UP, f.tan));
        // pole geometry is already lifted so its base sits at y=0
        const p = this.world.edgePoint(edge.id, s, side * 11.9); p.y = 0;
        m.compose(p, q, sc); poles.setMatrixAt(n, m);
        const pa = this.world.edgePoint(edge.id, s, side * 11.9); pa.y = 8.3;
        m.compose(pa, q, sc); arms.setMatrixAt(n, m);
        const topL = this.world.edgePoint(edge.id, s, side * 11.9); topL.y = 8.2;
        topL.addScaledVector(f.right, -1.1);
        const topR = topL.clone().addScaledVector(f.right, 2.2);
        const top = { a: topL, b: topR };
        // sagging wires between consecutive poles on the same street
        if (prev && Math.abs(s - prev.s) < spacing * 1.6) {
          for (const key of ['a', 'b']) {
            const A = prev[key], B = top[key];
            const segs = 4;
            for (let sI = 0; sI < segs; sI++) {
              const f0 = sI / segs, f1 = (sI + 1) / segs;
              const p0 = A.clone().lerp(B, f0), p1 = A.clone().lerp(B, f1);
              p0.y -= Math.sin(f0 * Math.PI) * 1.1;
              p1.y -= Math.sin(f1 * Math.PI) * 1.1;
              pts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
            }
          }
        }
        prev = { ...top, s };
        n++;
      }
    }
    poles.count = n;
    arms.count = n;
    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    this.group.add(poles, arms);

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x22282c, transparent: true, opacity: 0.7 })));
  }

  // ---------------- bus shelters ----------------
  _busShelters() {
    const anchors = this.world.landmarks.filter(a => ['Boulevard', 'Pujut 7', 'Tua Pek Kong Temple'].includes(a.name));
    for (const a of anchors) {
      const side = -a.side;
      const edge = this.world.edges[a.edgeId];
      const s = clamp(a.s + 8, 10, edge.length - 10);
      const f = this.world.edgeFrame(edge.id, s);
      const g = new THREE.Group();
      g.position.copy(this.world.edgePoint(edge.id, s, side * 12.6));
      g.position.y = 0.01;
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, UP, f.tan));
      g.rotateY(Math.PI / 2);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.18, 2.6), toonMat(0x2f6b8f));
      roof.position.y = 2.9;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 0.6), toonMat(0xb08050));
      bench.position.set(0, 0.6, 0.9);
      g.add(roof, bench);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.16), toonMat(0x9aa5aa));
        post.position.set(sx * 2.5, 1.45, -1.1);
        g.add(post);
      }
      const back = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.9), new THREE.MeshBasicMaterial({ color: 0x8fb2c4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
      back.position.set(0, 1.7, -1.15);
      const tex = textTexture('BAS MIRI', { w: 256, h: 96, bg: '#1d5c8a', size: 44 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      sign.position.set(0, 3.3, 0);
      g.add(back, sign);
      this.group.add(g);
    }
  }

  // ---------------- roadside props ----------------
  _props() {
    const rng = seededRandom(777);
    const bushGeo = new THREE.SphereGeometry(0.75, 7, 5);
    const bushMat = toonMat(PALETTE.leafDark);
    const binGeo = new THREE.CylinderGeometry(0.4, 0.34, 1.0, 8);
    const binMat = toonMat(0x2f6b4f);
    const bushCount = 170, binCount = 24;
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
    const bins = new THREE.InstancedMesh(binGeo, binMat, binCount);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < bushCount; i++) {
      const edge = this.world.edges[Math.floor(rng() * this.world.edges.length)];
      const s = 6 + rng() * (edge.length - 12);
      const side = rng() < 0.5 ? -1 : 1;
      p.copy(this.world.edgePoint(edge.id, s, side * rand(10.4, 26)));
      p.y = 0.3;
      const hs = rand(0.7, 1.6);
      sc.set(hs, hs * rand(0.7, 1.0), hs);
      m.compose(p, new THREE.Quaternion(), sc);
      bushes.setMatrixAt(i, m);
    }
    for (let i = 0; i < binCount; i++) {
      const edge = this.world.edges[Math.floor(rng() * this.world.edges.length)];
      const s = 6 + rng() * (edge.length - 12);
      const side = rng() < 0.5 ? -1 : 1;
      p.copy(this.world.edgePoint(edge.id, s, side * 10.0));
      p.y = 0.5;
      sc.set(1, 1, 1);
      m.compose(p, new THREE.Quaternion(), sc);
      bins.setMatrixAt(i, m);
    }
    bushes.instanceMatrix.needsUpdate = true;
    bins.instanceMatrix.needsUpdate = true;
    this.group.add(bushes, bins);
  }

  setNight(on) {
    for (const e of this.nightMats) e.mat.emissiveIntensity = on ? e.on : 0;
    if (this.lampPools) this.lampPools.visible = on;
    for (const m of this.nightMeshes) m.visible = on;
  }
}
