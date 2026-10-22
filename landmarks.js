// landmarks.js — Miri Grab Delivery Rush
// Procedural Miri landmarks: Grand Old Lady derrick, Petroleum Museum, Coco Cabana seahorse
// lighthouse, Marina Bay jetty, Bulatan Park, Tua Pek Kong temple, Pujut 7, Boulevard/E-Mart
// malls and offshore oil rigs. All geometry procedural, no assets.
import * as THREE from 'three';
import { PALETTE, toonMat, addOutline, box, cyl, sph, cone, flatMesh, textTexture, orientAlong, clamp } from './shared.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Landmarks {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.nightMats = [];   // toggled emissive at night
    this.nightMeshes = []; // additive beams / neon strips
    this.hillCenter = null;
    this.hillRadius = 0;
  }

  _anchor(name) {
    const a = this.world.landmarks.find(x => x.name === name);
    if (!a) throw new Error(`Landmark missing: ${name}`);
    return a;
  }

  // Build a group facing the road at `offset` meters from the centreline
  _site(anchor, offset, y = 0) {
    const f = this.world.edgeFrame(anchor.edgeId, anchor.s);
    const g = new THREE.Group();
    const lat = anchor.side * offset;
    this.world.edgePoint(anchor.edgeId, anchor.s, lat, g.position);
    g.position.y = y;
    const toward = f.right.clone().multiplyScalar(-anchor.side).normalize();
    const right = new THREE.Vector3().crossVectors(UP, toward).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, UP, toward));
    this.group.add(g);
    return g;
  }

  _sign(text, w, h, opts = {}) {
    const t = textTexture(text, { w: opts.tw || 512, h: opts.th || 128, bg: opts.bg || '#0a3d2a', fg: opts.fg || '#ffffff', size: opts.size || 58, border: opts.border, borderColor: opts.borderColor });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    return m;
  }

  _latticeDerrick(h, color) {
    const g = new THREE.Group();
    const baseR = 1.9, topR = 0.35;
    const legMat = toonMat(color);
    for (let i = 0; i < 4; i++) {
      const ang = i * Math.PI / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, h, 6), legMat);
      const bx = Math.cos(ang) * baseR, bz = Math.sin(ang) * baseR;
      const tx = Math.cos(ang) * topR, tz = Math.sin(ang) * topR;
      leg.position.set((bx + tx) / 2, h / 2, (bz + tz) / 2);
      // tilt: rotate around axis perpendicular to leg's lean direction
      const lean = new THREE.Vector3(tx - bx, h, tz - bz).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, lean);
      leg.quaternion.copy(q);
      g.add(leg);
    }
    // horizontal + X braces
    const braceMat = toonMat(color);
    const levels = 6;
    for (let l = 1; l <= levels; l++) {
      const y = (h / (levels + 1)) * l;
      const r = baseR + (topR - baseR) * (y / h);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 4, 16), braceMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
      if (l < levels) {
        for (let i = 0; i < 4; i++) {
          const a0 = i * Math.PI / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2;
          const y2 = y + h / (levels + 1);
          const r2 = baseR + (topR - baseR) * (y2 / h);
          const p0 = new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r);
          const p1 = new THREE.Vector3(Math.cos(a1) * r2, y2, Math.sin(a1) * r2);
          const mid = p0.clone().add(p1).multiplyScalar(0.5);
          const len = p0.distanceTo(p1);
          const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.05), braceMat);
          br.position.copy(mid);
          br.quaternion.setFromUnitVectors(UP, p1.clone().sub(p0).normalize());
          g.add(br);
        }
      }
    }
    const deck = cyl(topR * 2.4, topR * 2.4, 0.28, 0x8a4a24, { seg: 8 });
    deck.position.y = h - 0.1;
    const crown = box(1.5, 0.9, 1.5, color);
    crown.position.y = h + 0.35;
    g.add(deck, crown);
    return g;
  }

  build() {
    this.scene.add(this.group);
    this._grandOldLady();
    this._temple();
    this._cocoCabana();
    this._marinaBay();
    this._bulatanPark();
    this._pujut7();
    this._malls();
    this._offshoreRigs();
  }

  // ---- 1910 Grand Old Lady derrick + Petroleum Museum on Canada Hill ----
  _grandOldLady() {
    const a = this._anchor('Grand Old Lady');
    const site = this._site(a, 130);
    const roadSample = this.world.edgeFrame(a.edgeId, a.s);
    // The grid doubles back close to itself here, so a fixed lateral offset is not
    // enough: scan a ring around the anchor and keep the open ground that is
    // farthest from every stretch of road before sizing the hill.
    let cx = site.position.x, cz = site.position.z;
    let clear = this.world.distToRoad(cx, cz);
    for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 9) {
      for (let r = 90; r <= 300; r += 30) {
        const px = roadSample.pos.x + Math.cos(ang) * r;
        const pz = roadSample.pos.z + Math.sin(ang) * r;
        if (px < (this.world.oceanX ?? -430) + 80 || px > 700 || Math.abs(pz) > 700) continue;
        const dd = this.world.distToRoad(px, pz);
        if (dd > clear + 12) { clear = dd; cx = px; cz = pz; }
      }
    }
    this.hillRadius = clamp(clear - 30, 30, 85);
    const H = this.hillRadius * 0.42;
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(this.hillRadius, H, 26, 3),
      toonMat(PALETTE.grassDark)
    );
    hill.position.set(cx, H / 2 - 0.4, cz);
    hill.rotation.y = 0.4;
    this.group.add(hill);
    this.hillCenter = new THREE.Vector3(cx, H, cz);

    const plateau = cyl(this.hillRadius * 0.22, this.hillRadius * 0.26, 2.2, PALETTE.grass, { seg: 18 });
    plateau.position.set(cx, H - 0.6, cz);
    this.group.add(plateau);

    const derrick = this._latticeDerrick(15, 0xd94f3d);
    derrick.position.set(cx, H + 0.6, cz);
    derrick.rotation.y = 0.5;
    this.group.add(derrick);

    // base machinery shed
    const shed = box(5.4, 2.6, 3.6, 0x8d6a45);
    shed.position.set(cx + 5.2, H + 1.3, cz + 1.4);
    shed.rotation.y = -0.3;
    this.group.add(shed);
    const roof = box(6.0, 0.35, 4.2, 0x3f4a52);
    roof.position.set(cx + 5.2, H + 2.7, cz + 1.4);
    roof.rotation.y = -0.3;
    this.group.add(roof);

    // Petroleum Museum: white cube + half cylinder
    const mus = new THREE.Group();
    const body = box(14, 6.5, 9, PALETTE.white);
    body.position.y = 3.25;
    const shell = cyl(4.6, 4.6, 8.4, 0xe8eef2, { seg: 18, outline: false });
    shell.rotation.z = Math.PI / 2;
    shell.position.set(0, 6.4, 0);
    shell.scale.z = 0.72;
    const plate = this._sign('MUZIUM PETROLEUM', 8.6, 1.7, { bg: '#123c2b', border: true, size: 46 });
    plate.position.set(0, 4.6, 4.58);
    const door = box(2.4, 3, 0.25, 0x2d3436);
    door.position.set(0, 1.5, 4.55);
    mus.add(body, shell, plate, door);
    mus.position.set(cx - 14, H + 0.2, cz + 10);
    mus.rotation.y = 0.35;
    this.group.add(mus);
  }

  // ---- Tua Pek Kong temple ----
  _temple() {
    const a = this._anchor('Tua Pek Kong Temple');
    const g = this._site(a, 24);

    const wall = box(12, 5.2, 9, 0xe8c66a);
    wall.position.y = 2.6;
    g.add(wall);

    // stepped pagoda roofs
    for (let i = 0; i < 3; i++) {
      const w = 15 - i * 2.6, d = 11.6 - i * 2.1;
      const roof = box(w, 0.55, d, PALETTE.templeRoof);
      roof.position.y = 5.4 + i * 1.65;
      roof.scale.z = 1;
      g.add(roof);
      const up = box(w - 1.8, 0.5, d - 1.6, PALETTE.templeRoof);
      up.position.y = 5.7 + i * 1.65;
      g.add(up);
      // upturned corner tips
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const tip = box(1.1, 0.35, 0.35, PALETTE.templeRed);
        tip.position.set(sx * (w / 2 - 0.4), 5.9 + i * 1.65, sz * (d / 2 - 0.3));
        tip.rotation.x = sz * 0.34;
        tip.rotation.z = -sx * 0.3;
        g.add(tip);
      }
    }
    const finial = cyl(0.12, 0.3, 2.4, PALETTE.templeGold, { seg: 8 });
    finial.position.y = 10.2;
    g.add(finial);

    // red columns
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const col = cyl(0.3, 0.34, 5.2, PALETTE.templeRed, { seg: 8 });
      col.position.set(sx * 5.2, 2.6, sz * 4.1);
      g.add(col);
    }

    // entrance steps + paifang gate
    const step = box(7, 0.4, 3.2, 0xb0b6ba);
    step.position.set(0, 0.2, 6.2);
    g.add(step);
    const gate = new THREE.Group();
    for (const sx of [-1, 1]) {
      const p = cyl(0.28, 0.32, 5.6, PALETTE.templeRed, { seg: 8 });
      p.position.set(sx * 2.6, 2.8, 0);
      gate.add(p);
    }
    const lintel = box(6.4, 0.7, 0.7, PALETTE.templeRed);
    lintel.position.y = 5.3;
    const gateRoof = box(8.2, 0.5, 1.6, PALETTE.templeRoof);
    gateRoof.position.y = 5.9;
    const gateSign = this._sign('TUA PEK KONG', 4.4, 1.0, { bg: '#8e2b20', fg: '#ffd23f', size: 48, border: true, borderColor: '#ffd23f' });
    gateSign.position.set(0, 4.5, 0.38);
    gate.add(lintel, gateRoof, gateSign);
    gate.position.set(0, 0, 8.4);
    g.add(gate);

    // incense burner
    const burner = cyl(1.1, 0.9, 1.3, 0x6b4a2f, { seg: 12 });
    burner.position.set(0, 0.65, 4.6);
    const burnerGold = cyl(1.15, 1.15, 0.2, PALETTE.templeGold, { seg: 12 });
    burnerGold.position.set(0, 1.35, 4.6);
    g.add(burner, burnerGold);

    // red lanterns (glow at night)
    this.lanternMats = [];
    for (let i = 0; i < 6; i++) {
      const mat = toonMat(0xd9362b);
      mat.emissive = new THREE.Color(0xd9362b);
      mat.emissiveIntensity = 0;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), mat);
      l.scale.y = 1.25;
      l.position.set(-4.2 + i * 1.68, 4.65, 4.9);
      g.add(l);
      this.nightMats.push({ mat, on: 1.5 });
    }
  }

  // ---- Coco Cabana seahorse lighthouse ----
  _cocoCabana() {
    const a = this._anchor('Coco Cabana');
    const g = this._site(a, 22);

    const tower = new THREE.Group();
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const r = 1.5 - i * 0.06;
      const seg = cyl(r, r + 0.04, 2.1, i % 2 ? 0xf2f2f2 : 0xd9362b, { seg: 14, outline: i === 0 });
      seg.position.y = 1.05 + i * 2.1;
      seg.rotation.y = 0.12;
      tower.add(seg);
    }
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.5, 12), lanternMat);
    lantern.position.y = segments * 2.1 + 0.75;
    const rail = cyl(1.25, 1.25, 0.16, 0x333a40, { seg: 12 });
    rail.position.y = segments * 2.1 + 1.65;
    const roof = cone(1.5, 1.6, 0xd9362b, { seg: 12 });
    roof.position.y = segments * 2.1 + 2.4;
    const tip = sph(0.16, 0xffd23f);
    tip.position.y = segments * 2.1 + 3.25;
    tower.add(lantern, rail, roof, tip);

    // seahorse silhouette accent
    const seaBody = sph(0.7, PALETTE.templeGold, { seg: 10 });
    seaBody.scale.set(0.55, 1.15, 0.4);
    seaBody.position.set(1.75, 6.4, 0);
    const seaHead = sph(0.36, PALETTE.templeGold, { seg: 10 });
    seaHead.position.set(1.95, 7.5, 0);
    const seaSnout = box(0.5, 0.16, 0.16, PALETTE.templeGold);
    seaSnout.position.set(2.35, 7.5, 0);
    const seaTail = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.1, 6, 12, Math.PI * 1.4), toonMat(PALETTE.templeGold));
    seaTail.position.set(1.6, 5.35, 0);
    seaTail.rotation.z = 1.1;
    tower.add(seaBody, seaHead, seaSnout, seaTail);

    g.add(tower);

    // lighthouse beam (night only)
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(7, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.rotation.z = Math.PI / 2 - 0.22;
    beam.position.set(26, segments * 2.1 + 0.9, 0);
    beam.visible = false;
    g.add(beam);
    this.nightMeshes.push(beam);

    // dome cabana + sign
    const cabana = new THREE.Group();
    const cbody = cyl(3.2, 3.2, 2.4, 0xf3e6cf, { seg: 16 });
    cbody.position.y = 1.2;
    const cdome = sph(3.3, 0xe0a96d, { seg: 16 });
    cdome.scale.y = 0.55;
    cdome.position.y = 2.5;
    cabana.add(cbody, cdome);
    cabana.position.set(-9, 0, 3);
    g.add(cabana);

    const sign = this._sign('COCO CABANA', 7.2, 1.8, { bg: '#0f6e8c', size: 52, border: true });
    sign.position.set(0, 4.2, -8);
    g.add(sign);
  }

  // ---- Marina Bay waterfront ----
  _marinaBay() {
    const a = this._anchor('Marina Bay');
    const g = this._site(a, 15);

    // boardwalk running parallel to the road
    const walk = box(58, 0.35, 4.2, 0xc8a97a);
    walk.position.set(0, 0.15, -6);
    g.add(walk);
    for (let i = 0; i < 12; i++) {
      const post = cyl(0.16, 0.18, 1.4, 0x7a5230, { seg: 6, outline: false });
      post.position.set(-27 + i * 4.8, 0.8, -8.1);
      g.add(post);
    }
    for (let i = 0; i < 6; i++) {
      const lampPost = cyl(0.1, 0.14, 3.4, 0x2f3438, { seg: 6, outline: false });
      lampPost.position.set(-22 + i * 8.8, 1.9, -4.4);
      const bulb = sph(0.22, 0xfff2b0, { outline: false });
      bulb.position.set(-22 + i * 8.8, 3.55, -4.4);
      g.add(lampPost, bulb);
    }

    // sign
    const sign = this._sign('MARINA BAY MIRI', 9, 2, { bg: '#12374d', size: 54, border: true, borderColor: '#4cc9f0' });
    sign.position.set(6, 5.2, 0);
    for (const sx of [-1, 1]) {
      const post = cyl(0.12, 0.14, 4.4, 0x3c4550, { seg: 6, outline: false });
      post.position.set(6 + sx * 4, 2.2, 0);
      g.add(post);
    }
    g.add(sign);

    // yachts out on the sea (west of the coastline)
    const yachts = [
      { x: -520, z: a.scenePos.y - 40, r: 0.4 },
      { x: -600, z: a.scenePos.y + 55, r: -0.9 },
      { x: -680, z: a.scenePos.y - 110, r: 2.1 },
    ];
    for (const y of yachts) {
      const boat = new THREE.Group();
      const hull = box(9, 1.4, 3.2, PALETTE.white);
      hull.position.y = 0.6;
      const bow = cone(1.6, 3.2, PALETTE.white, { seg: 4 });
      bow.rotation.x = -Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      bow.scale.set(1, 1, 1.2);
      bow.position.set(-5.4, 0.6, 0);
      const cabin = box(4, 1.3, 2.4, 0xe9eef2);
      cabin.position.set(0.6, 1.9, 0);
      const screen = box(2.6, 0.7, 2.2, 0x2f3a44);
      screen.position.set(-0.2, 2.0, 0);
      boat.add(hull, bow, cabin, screen);
      boat.position.set(y.x, 0.2, y.z);
      boat.rotation.y = y.r;
      this.group.add(boat);
    }

    // mooring buoys
    for (let i = 0; i < 5; i++) {
      const b = sph(0.5, 0xff6b3d, { seg: 8, outline: false });
      b.position.set(-505 - i * 22, 0.35, a.scenePos.y + 18 + i * 26);
      this.group.add(b);
    }
  }

  // ---- Bulatan Park roundabout garden ----
  _bulatanPark() {
    const rb = this.world.roundabouts.find((r) => r.name === 'Bulatan Park');
    if (!rb) return;
    // the garden now lives on the roundabout's centre island
    const g = new THREE.Group();
    g.position.set(rb.centerNode.x, 0.17, rb.centerNode.z);
    this.group.add(g);

    const plaza = cyl(17, 17, 0.3, 0xd8d2c4, { seg: 32, outline: false });
    plaza.position.y = 0.15;
    g.add(plaza);
    const grassRing = cyl(14.2, 14.2, 0.36, PALETTE.grass, { seg: 32, outline: false });
    grassRing.position.y = 0.2;
    g.add(grassRing);

    // fountain
    const basin = cyl(4.4, 4.6, 0.9, 0xcfd6d4, { seg: 20 });
    basin.position.y = 0.65;
    const water = cyl(4.15, 4.15, 0.16, 0x4cc9f0, { seg: 20, outline: false, mat: { transparent: true, opacity: 0.85 } });
    water.position.y = 1.05;
    const tier1 = cyl(1.8, 2.2, 1.0, 0xe6e9ea, { seg: 16 });
    tier1.position.y = 1.4;
    const tier2 = cyl(0.7, 1.0, 1.3, 0xe6e9ea, { seg: 12 });
    tier2.position.y = 2.5;
    const jet = cyl(0.16, 0.3, 2.2, 0x9fe4ff, { seg: 8, outline: false, mat: { transparent: true, opacity: 0.7 } });
    jet.position.y = 4.0;
    g.add(basin, water, tier1, tier2, jet);

    // hedge ring
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const h = box(3.1, 1.05, 1.1, i % 2 ? PALETTE.leafGreen : PALETTE.leafDark, { outline: false });
      h.position.set(Math.cos(ang) * 11.4, 0.8, Math.sin(ang) * 11.4);
      h.rotation.y = -ang;
      g.add(h);
    }
    // flower clusters
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2, r = 5.6 + Math.random() * 4.6;
      const f = sph(0.26, [0xff4d8d, 0xffd23f, 0xff8c42, 0x9b5de5][i % 4], { seg: 6, outline: false });
      f.position.set(Math.cos(ang) * r, 0.5, Math.sin(ang) * r);
      g.add(f);
    }
    // lamp posts (glow at night)
    this.parkLampMats = [];
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + i * Math.PI / 2;
      const post = cyl(0.12, 0.16, 4.2, 0x2f3438, { seg: 6, outline: false });
      post.position.set(Math.cos(ang) * 13, 2.1, Math.sin(ang) * 13);
      const head = sph(0.34, 0xfff2b0, { outline: false });
      head.position.set(Math.cos(ang) * 13, 4.3, Math.sin(ang) * 13);
      g.add(post, head);
    }
    const parkSign = this._sign('BULATAN PARK', 6.4, 1.5, { bg: '#1d5c33', size: 52, border: true });
    parkSign.position.set(0, 4.4, 15.5);
    g.add(parkSign);
  }

  // ---- Pujut 7 entrance + water tower ----
  _pujut7() {
    const a = this._anchor('Pujut 7');
    const g = this._site(a, 20);

    const sign = this._sign('PUJUT 7', 6.8, 2.1, { bg: '#1a3c6e', size: 64, border: true, borderColor: '#ffd23f' });
    sign.position.set(0, 3.6, 0);
    for (const sx of [-1, 1]) {
      const post = box(0.3, 3.6, 0.3, 0x4a5560);
      post.position.set(sx * 3.1, 1.8, 0);
      g.add(post);
    }
    g.add(sign);

    // water tank tower
    const tower = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(0.14, 0.18, 12, 0x9aa5a0, { seg: 6, outline: false });
      leg.position.set(sx * 2.4, 6, sz * 2.4);
      tower.add(leg);
    }
    const tank = cyl(3.2, 3.4, 4.2, 0xe3e8e6, { seg: 14 });
    tank.position.y = 14.1;
    const tankTop = cone(3.3, 1.2, 0x9aa5a0, { seg: 14 });
    tankTop.position.y = 16.8;
    tower.add(tank, tankTop);
    tower.position.set(-16, 0, 4);
    g.add(tower);
  }

  // ---- Boulevard & E-Mart malls ----
  _malls() {
    for (const [name, label, offset, neon] of [
      ['Boulevard', 'BOULEVARD', 30, 0xff4d8d],
      ['Permyjaya E-Mart', 'EMART', 28, 0x4cc9f0],
    ]) {
      const a = this._anchor(name);
      const g = this._site(a, offset);

      const body = box(34, 11, 20, 0xd9dee3);
      body.position.y = 5.5;
      const roofSlab = box(35.4, 0.8, 21.4, 0xa4adb6);
      roofSlab.position.y = 11.4;
      const entry = box(9, 6, 3, 0x2f3a44);
      entry.position.set(0, 3, 11.4);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(15, 4.2), new THREE.MeshBasicMaterial({ color: 0x8fd0e8 }));
      glass.position.set(14, 6.2, 10.02);
      const sign = this._sign(label, 15, 3.4, { bg: '#101820', fg: '#ffffff', size: 62, border: true, borderColor: '#ffd23f' });
      sign.position.set(0, 8.6, 10.1);
      g.add(body, roofSlab, entry, glass, sign);

      // neon roof trim (night only)
      const neonMat = new THREE.MeshBasicMaterial({ color: neon });
      const trim = new THREE.Mesh(new THREE.BoxGeometry(34.4, 0.22, 0.22), neonMat);
      trim.position.set(0, 10.2, 10.4);
      trim.visible = false;
      g.add(trim);
      this.nightMeshes.push(trim);

      // parking lot + parked cars (behind the block, away from the road)
      const lot = flatMesh(new THREE.PlaneGeometry(30, 16), 0x4a4f55);
      lot.rotation.x = -Math.PI / 2;
      lot.position.set(0, 0.03, -22);
      g.add(lot);
      for (let i = 0; i < 7; i++) {
        const c = box(1.8, 1.4, 4.1, [0xf2f2f2, 0xa4adb6, 0xc0392b, 0x2f3a44, 0x3a86ff][i % 5], { outline: false });
        c.position.set(-12 + i * 4, 0.75, -22 + (i % 2 ? 3 : -2));
        c.rotation.y = Math.PI / 2;
        g.add(c);
      }
    }
  }

  // ---- Offshore platforms ----
  _offshoreRigs() {
    const rigs = [
      { x: -880, z: -320, s: 1.0 },
      { x: -1320, z: 60, s: 1.15 },
      { x: -1900, z: -470, s: 1.3 },
    ];
    for (const r of rigs) {
      const g = new THREE.Group();
      const legMat = toonMat(0xc99a2e);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 26, 8), legMat);
        leg.position.set(sx * 7 * r.s, 13 * r.s, sz * 7 * r.s);
        leg.scale.y = r.s;
        g.add(leg);
      }
      for (let l = 0; l < 3; l++) {
        for (const sz of [-1, 1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.55 * r.s, 14 * r.s, 0.55 * r.s), legMat);
          brace.position.set(0, (5 + l * 8) * r.s, sz * 7 * r.s);
          brace.rotation.z = sz * 0.35;
          g.add(brace);
        }
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(22 * r.s, 2.2 * r.s, 22 * r.s), toonMat(0x8d99a6));
      deck.position.y = 27 * r.s;
      g.add(deck);
      const superstruct = new THREE.Mesh(new THREE.BoxGeometry(10 * r.s, 5 * r.s, 8 * r.s), toonMat(0xf2f2f2));
      superstruct.position.set(-2 * r.s, 30.6 * r.s, 0);
      g.add(superstruct);
      const mast = this._latticeDerrick(20 * r.s, 0xc99a2e);
      mast.position.set(4 * r.s, 28 * r.s, 0);
      g.add(mast);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(6 * r.s, 6 * r.s, 0.5 * r.s, 16), toonMat(0x2f3a44));
      pad.position.set(-11 * r.s, 28.4 * r.s, 4 * r.s);
      g.add(pad);
      const hMark = new THREE.Mesh(new THREE.CircleGeometry(3.4 * r.s, 16), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      hMark.rotation.x = -Math.PI / 2;
      hMark.position.set(-11 * r.s, 28.68 * r.s, 4 * r.s);
      g.add(hMark);
      const flareBoom = new THREE.Mesh(new THREE.BoxGeometry(0.6 * r.s, 0.6 * r.s, 16 * r.s), legMat);
      flareBoom.position.set(10 * r.s, 28 * r.s, 10 * r.s);
      flareBoom.rotation.x = -0.35;
      g.add(flareBoom);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.9 });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.6 * r.s, 5 * r.s, 8), flameMat);
      flame.position.set(10 * r.s, 34 * r.s, 17 * r.s);
      g.add(flame);
      g.position.set(r.x, 0, r.z);
      this.group.add(g);
      this.nightMeshes.push(flame);
    }
  }

  setNight(on) {
    for (const e of this.nightMats) e.mat.emissiveIntensity = on ? e.on : 0;
    for (const m of this.nightMeshes) m.visible = on;
    // the flares are always lit: keep flame meshes visible
    for (const m of this.nightMeshes) {
      if (m.geometry && m.geometry.type === 'ConeGeometry' && m.material && m.material.color.getHex() === 0xff8c42) m.visible = true;
    }
    if (this.lanternMats) { /* handled via nightMats */ }
  }
}
