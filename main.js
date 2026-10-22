// main.js — Miri Grab Delivery Rush
// Game loop, state, input, time-of-day, tropical storm mode, broadcast camera director, HUD.
import * as THREE from 'three';
import { World } from './world.js';
import { Landmarks } from './landmarks.js';
import { Scenery } from './scenery.js';
import { RiderSystem, OrderSystem } from './rider.js';
import { Traffic } from './traffic.js';
import { AudioEngine } from './audio.js';
import { clamp, lerp, rmFmt } from './shared.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const hud = {
  landmark: $('hud-landmark'), orderList: $('order-list'), openCount: $('open-count'),
  camChip: $('cam-chip'), autoChip: $('auto-chip'), teleSpd: $('tele-spd'), teleOdo: $('tele-odo'), teleStreak: $('tele-streak'), teleXp: $('tele-xp'),
  kmh: $('kmh'), rmVal: $('rm-val'), deliv: $('deliv-count'), ticker: $('ticker-track'),
  popups: $('popups'), btnTime: $('btn-time'), btnRain: $('btn-rain'), btnCam: $('btn-cam'), btnAudio: $('btn-audio'),
  overlay: $('start-overlay'), startBtn: $('start-btn'),
};

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);

// filmic pipeline: MSAA scene pass -> soft neon bloom -> tone-mapped output
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.52, 0.62, 0.9
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ---------------- gradient sky dome + sun ----------------
function skyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([p, col]) => grad.addColorStop(p, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SKY_TEX = {
  sunset: skyTexture([[0, '#3b2a63'], [0.32, '#9a4f76'], [0.58, '#ff9a5c'], [0.78, '#ffd08a'], [1, '#ffe9bf']]),
  night: skyTexture([[0, '#040a20'], [0.45, '#0b1736'], [0.72, '#16264d'], [1, '#2b3f6a']]),
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(3200, 32, 16),
  new THREE.MeshBasicMaterial({ map: SKY_TEX.sunset, side: THREE.BackSide, fog: false, depthWrite: false })
);
scene.add(skyDome);
const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(130, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false, transparent: true, opacity: 0.95 })
);
scene.add(sunDisc);

// stars + moon ride inside the sky dome (added as children so they follow the camera)
const starField = (() => {
  const N = 700, arr = new Float32Array(N * 3), r = 2500;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - Math.random() * 0.92); // upper hemisphere
    arr[i * 3] = r * Math.sin(phi) * Math.cos(u);
    arr[i * 3 + 1] = r * Math.cos(phi) * 0.92 + 60;
    arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(u);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 2.4, sizeAttenuation: false, fog: false,
    transparent: true, opacity: 0.9, depthWrite: false,
  }));
  p.visible = false;
  p.raycast = () => {};
  skyDome.add(p);
  return p;
})();
const moonDisc = new THREE.Mesh(
  new THREE.CircleGeometry(92, 32),
  new THREE.MeshBasicMaterial({ color: 0xf2f6ff, fog: false, transparent: true, opacity: 0.92, depthWrite: false })
);
moonDisc.position.set(-1500, 1150, -1600);
moonDisc.lookAt(0, 0, 0);
moonDisc.visible = false;
moonDisc.raycast = () => {};
skyDome.add(moonDisc);

// drifting tropical cloud banks, painted into one shared sprite material
const cloudMat = (() => {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  for (let i = 0; i < 34; i++) {
    const x = 40 + Math.random() * 432;
    const y = 150 + Math.random() * 64;
    const r = 22 + Math.random() * 58;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    const a = 0.1 + Math.random() * 0.2;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.65, `rgba(255,250,240,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(255,245,235,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
  });
})();
const clouds = [];
for (let i = 0; i < 14; i++) {
  const s = new THREE.Sprite(cloudMat);
  const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
  const r = 2100 + Math.random() * 500;
  s.position.set(Math.cos(ang) * r, 240 + Math.random() * 560, Math.sin(ang) * r);
  const w = 900 + Math.random() * 800;
  s.scale.set(w, w * 0.36, 1);
  s.userData.ang = ang;
  s.userData.r = r;
  s.userData.spin = 0.0015 + Math.random() * 0.0018;
  s.raycast = () => {};
  skyDome.add(s);
  clouds.push(s);
}

const PALETTES = {
  sunset: {
    sky: 0xffc98a, fog: 0xffd9a8, fogNear: 260, fogFar: 2700,
    hemiSky: 0xffe2b8, hemiGround: 0x6a7f5a, hemiInt: 0.95, ambInt: 0.32,
    dirColor: 0xffd29a, dirInt: 1.35, dirPos: [400, 500, 200],
  },
  night: {
    sky: 0x0a0f2a, fog: 0x0b1130, fogNear: 150, fogFar: 1500,
    hemiSky: 0x35406e, hemiGround: 0x141a26, hemiInt: 0.55, ambInt: 0.16,
    dirColor: 0x93a7ff, dirInt: 0.5, dirPos: [-300, 400, -200],
  },
};
const state = {
  started: false, night: false, rain: false, muted: false,
  rm: 0, xp: 0, deliveries: 0,
  camMode: 0, camAuto: true, camTimer: 0,
  tod: { active: false, t: 0, from: null, to: null },
  tickerItems: ['Welcome to Miri Grab Delivery Rush — kaki lima run starts now!'],
};

const hemi = new THREE.HemisphereLight(0xffe2b8, 0x6a7f5a, 0.95);
const ambient = new THREE.AmbientLight(0xffffff, 0.32);
const dir = new THREE.DirectionalLight(0xffd29a, 1.35);
dir.position.set(400, 500, 200);
// a tight shadow camera that rides along with the player keeps 2K shadows crisp
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.left = -95;
dir.shadow.camera.right = 95;
dir.shadow.camera.top = 95;
dir.shadow.camera.bottom = -95;
dir.shadow.camera.near = 5;
dir.shadow.camera.far = 420;
dir.shadow.bias = -0.0006;
dir.shadow.normalBias = 0.03;
scene.add(hemi, ambient, dir, dir.target);
const sunDir = new THREE.Vector3(0.6, 0.75, 0.3).normalize();

function applyPalette(p) {
  scene.background = scene.background || new THREE.Color();
  scene.background.set(p.sky);
  scene.fog = scene.fog || new THREE.Fog(p.fog, p.fogNear, p.fogFar);
  scene.fog.color.set(p.fog);
  const rf = state.rain ? 0.55 : 1;
  scene.fog.near = p.fogNear * rf;
  scene.fog.far = p.fogFar * rf;
  hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemiInt;
  ambient.intensity = p.ambInt;
  dir.color.set(p.dirColor); dir.intensity = p.dirInt;
  dir.position.set(...p.dirPos);
  sunDir.copy(dir.position).normalize();
}
applyPalette(PALETTES.sunset);
scene.fog = new THREE.Fog(PALETTES.sunset.fog, PALETTES.sunset.fogNear, PALETTES.sunset.fogFar);
applyPalette(PALETTES.sunset);

// ---------------- world & actors ----------------
const world = new World();
world.build(scene);

const landmarks = new Landmarks(scene, world);
landmarks.build();

const scenery = new Scenery(scene, world);
scenery.build(landmarks);

const riderSystem = new RiderSystem(scene, world, 8, {
  onBump: () => { audio.bump(); },
  onSkid: (active) => { audio.skid(active); },
});
const player = riderSystem.player;

const traffic = new Traffic(scene, world, 16);

// real-time sun shadows for the whole cast, skipping the inverted-hull ink
// outlines (they are back-side shells and would smear the shadow map)
function enableShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material && o.material.side === THREE.BackSide) return;
    o.castShadow = !!(o.geometry && o.geometry.type !== 'PlaneGeometry');
    o.receiveShadow = true;
  });
}
enableShadows(world.group);
enableShadows(scenery.group);
enableShadows(landmarks.group);
for (const r of riderSystem.riders) enableShadows(r.group);
for (const c of traffic.cars) enableShadows(c.group);

const orders = new OrderSystem(world, onOrderEvent);
const audio = new AudioEngine();

// ---------------- destination beacons ----------------
function makeBeacon(color) {
  const g = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 26, 14, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
  );
  pillar.position.y = 13;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.14, 6, 26),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 22),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.12;
  g.add(pillar, ring, pad);
  g.visible = false;
  g.userData = { pillar, ring, pad };
  scene.add(g);
  return g;
}
const beaconPickup = makeBeacon(0x00d084);
const beaconDropoff = makeBeacon(0xffd23f);
let beaconPhase = 0;
function updateBeacons(dt, pose) {
  const active = orders.playerOrders[0];
  beaconPhase += dt;
  if (!active) { beaconPickup.visible = false; beaconDropoff.visible = false; return; }
  const dropping = active.assignee && active.assignee.phase === 'toDropoff';
  const target = dropping ? active.to : active.from;
  const beacon = dropping ? beaconDropoff : beaconPickup;
  beaconPickup.visible = !dropping;
  beaconDropoff.visible = dropping;
  beacon.position.copy(target.pos);
  beacon.position.y = 0;
  const pulse = 0.9 + Math.sin(beaconPhase * 3.2) * 0.14;
  beacon.userData.ring.scale.setScalar(pulse);
  beacon.userData.pillar.material.opacity = 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(beaconPhase * 3.2));
  const dist = player.distanceTo(target.pos);
  beacon.userData.ring.visible = dist > 12;
}

// ---------------- tropical rain ----------------
const RAIN_COUNT = 850;
const rainGroup = new THREE.Group();
const rainMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.04, 1.5, 0.04),
  new THREE.MeshBasicMaterial({ color: 0xaaccee, transparent: true, opacity: 0.42 }),
  RAIN_COUNT
);
rainMesh.frustumCulled = false;
const rainDrops = [];
for (let i = 0; i < RAIN_COUNT; i++) {
  rainDrops.push({
    x: (Math.random() - 0.5) * 320, y: Math.random() * 120, z: (Math.random() - 0.5) * 320,
    v: 38 + Math.random() * 18, wind: -4 - Math.random() * 5,
  });
}
rainGroup.add(rainMesh);
rainGroup.visible = false;
scene.add(rainGroup);
const _rm = new THREE.Matrix4();
function updateRain(dt) {
  if (!state.rain) return;
  rainGroup.position.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
  for (let i = 0; i < RAIN_COUNT; i++) {
    const d = rainDrops[i];
    d.y -= d.v * dt;
    d.x += d.wind * dt;
    if (d.y < -4) { d.y += 120; d.x = (Math.random() - 0.5) * 320; }
    _rm.makeTranslation(d.x, d.y, d.z);
    rainMesh.setMatrixAt(i, _rm);
  }
  rainMesh.instanceMatrix.needsUpdate = true;
}

// ---------------- time-of-day tween ----------------
function startTodore(paletteName) {
  state.tod = { active: true, t: 0, from: capturePalette(), to: PALETTES[paletteName], target: paletteName };
}
function capturePalette() {
  const c = (hex) => new THREE.Color(hex);
  return {
    sky: scene.background ? scene.background.clone() : c(PALETTES.sunset.sky),
    fog: scene.fog.color.clone(), fogNear: scene.fog.near, fogFar: scene.fog.far,
    hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemiInt: hemi.intensity,
    ambInt: ambient.intensity,
    dirColor: dir.color.clone(), dirInt: dir.intensity, dirPos: dir.position.toArray(),
  };
}
function updateTod(dt) {
  if (!state.tod.active) return;
  const t = state.tod;
  t.t = Math.min(1, t.t + dt / 1.6);
  const k = t.t * t.t * (3 - 2 * t.t);
  const f = t.from, g = t.to;
  scene.background.copy(f.sky).lerp(g.sky instanceof THREE.Color ? g.sky : new THREE.Color(g.sky), k);
  scene.fog.color.copy(f.fog).lerp(new THREE.Color(g.fog), k);
  const rf = state.rain ? 0.55 : 1;
  scene.fog.near = lerp(f.fogNear, g.fogNear * rf, k);
  scene.fog.far = lerp(f.fogFar, g.fogFar * rf, k);
  hemi.color.copy(f.hemiSky).lerp(new THREE.Color(g.hemiSky), k);
  hemi.groundColor.copy(f.hemiGround).lerp(new THREE.Color(g.hemiGround), k);
  hemi.intensity = lerp(f.hemiInt, g.hemiInt, k);
  ambient.intensity = lerp(f.ambInt, g.ambInt, k);
  dir.color.copy(f.dirColor).lerp(new THREE.Color(g.dirColor), k);
  dir.intensity = lerp(f.dirInt, g.dirInt, k);
  dir.position.set(lerp(f.dirPos[0], g.dirPos[0], k), lerp(f.dirPos[1], g.dirPos[1], k), lerp(f.dirPos[2], g.dirPos[2], k));
  if (t.t >= 1) {
    t.active = false;
    const on = t.target === 'night';
    skyDome.material.map = on ? SKY_TEX.night : SKY_TEX.sunset;
    skyDome.material.needsUpdate = true;
    sunDisc.visible = !on;
    starField.visible = on;
    moonDisc.visible = on;
    world.setNight(on);
    landmarks.setNight && landmarks.setNight(on);
    scenery.setNight && scenery.setNight(on);
    riderSystem.setNight(on);
    traffic.setNight && traffic.setNight(on);
    audio.setNight(on);
    cloudMat.color.set(on ? 0x6c7fae : 0xffffff);
    cloudMat.opacity = on ? 0.2 : 0.55;
    hud.btnTime.textContent = on ? 'SUNSET' : 'NIGHT';
    hud.btnTime.classList.toggle('on', on);
    pushTicker(on ? 'Night touge mode — neon Miri skyline is ON' : 'Golden Miri sunset restored');
  }
}
function toggleTime() {
  state.night = !state.night;
  startTodore(state.night ? 'night' : 'sunset');
}

// ---------------- rain toggle ----------------
function toggleRain() {
  state.rain = !state.rain;
  rainGroup.visible = state.rain;
  world.setWet(state.rain);
  audio.setRain(state.rain);
  hud.btnRain.classList.toggle('on', state.rain);
  // re-apply fog density
  const p = state.night ? PALETTES.night : PALETTES.sunset;
  const rf = state.rain ? 0.55 : 1;
  scene.fog.near = p.fogNear * rf;
  scene.fog.far = p.fogFar * rf;
  pushTicker(state.rain ? 'Monsoon rain hits Miri — jalan licin, ride careful!' : 'Rain cleared — asphalt drying up');
}

// ---------------- broadcast camera director ----------------
const CAM_MODES = ['chase', 'heli', 'side', 'helmet'];
const CAM_LABELS = ['CHASE CAM', 'HELICOPTER DRONE', 'SIDE-CAR ACTION CAM', 'RIDER HELMET CAM'];
const camPos = new THREE.Vector3(0, 6, -12);
const camLook = new THREE.Vector3();
const camUp = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function directorUpdate(dt) {
  const pose = player.getPose();
  const { pos, tan, right, lean, bank, speed } = pose;
  const speedNorm = clamp(speed / 33, 0, 1);
  const mode = CAM_MODES[state.camMode];
  let targetFov = 62;

  if (mode === 'chase') {
    _v1.copy(pos).addScaledVector(tan, -8).add(_v2.set(0, 3.4, 0)).addScaledVector(right, 1.6);
    _v3.copy(pos).addScaledVector(tan, 9).setY(pos.y + 1.3);
    targetFov = 60 + speedNorm * 12;
    camUp.lerp(_v2.set(0, 1, 0), 0.1);
  } else if (mode === 'heli') {
    _v1.copy(pos).addScaledVector(right, 22).addScaledVector(tan, -14).add(_v2.set(0, 30, 0));
    _v3.copy(pos);
    targetFov = 52;
    camUp.lerp(_v2.set(0, 1, 0), 0.1);
  } else if (mode === 'side') {
    _v1.copy(pos).addScaledVector(right, 6.4).add(_v2.set(0, 1.5, 0)).addScaledVector(tan, -1);
    _v3.copy(pos).addScaledVector(tan, 3).setY(pos.y + 1.1);
    targetFov = 58;
    camUp.copy(_v2.set(0, 1, 0).applyAxisAngle(tan, lean * 0.35 + bank));
  } else { // helmet
    // sit above the mirrors and look further down the road so the bar stays at the frame bottom
    _v1.copy(pos).add(_v2.set(0, 2.0, 0)).addScaledVector(tan, 0.55);
    _v3.copy(pos).addScaledVector(tan, 16).setY(pos.y + 1.55);
    targetFov = 74;
    camUp.copy(_v2.set(0, 1, 0).applyAxisAngle(tan, lean * 0.55 + bank));
  }

  const k = 1 - Math.exp(-dt * 5.5);
  camPos.lerp(_v1, k);
  camLook.lerp(_v3, k);
  camera.position.copy(camPos);
  camera.up.copy(camUp).normalize();
  camera.lookAt(camLook);
  camera.fov += (targetFov - camera.fov) * k;
  camera.updateProjectionMatrix();

  // auto-director cycling
  if (state.camAuto) {
    state.camTimer += dt;
    if (state.camTimer > 8) cycleCam();
  }
  hud.camChip.textContent = CAM_LABELS[state.camMode];

  // keep the sky dome and sun anchored to the camera
  skyDome.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(sunDir, 2600);
  sunDisc.lookAt(camera.position);

  // clouds drift slowly across the dome
  for (const c of clouds) {
    c.userData.ang += c.userData.spin * dt;
    c.position.x = Math.cos(c.userData.ang) * c.userData.r;
    c.position.z = Math.sin(c.userData.ang) * c.userData.r;
  }

  // the shadow volume follows the rider so the nearest blocks stay sharp
  dir.target.position.set(pos.x, 0, pos.z);
  dir.position.copy(dir.target.position).addScaledVector(sunDir, 240);
  dir.target.updateMatrixWorld();
}
function cycleCam() {
  state.camMode = (state.camMode + 1) % CAM_MODES.length;
  state.camTimer = 0;
}

// ---------------- HUD helpers ----------------
function pushTicker(txt) {
  state.tickerItems.push(txt);
  if (state.tickerItems.length > 6) state.tickerItems.shift();
  const line = state.tickerItems.join('  +++  ');
  hud.ticker.textContent = line + '  +++  ' + line;
}
function popup(title, body, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.innerHTML = `<div class="pop-title">${title}</div><div class="pop-body">${body}</div>`;
  hud.popups.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4100);
}
function renderOrderBoard() {
  const mine = orders.playerOrders;
  const open = orders.orders.filter(o => o.state === 'open');
  hud.openCount.textContent = `${open.length} OPEN`;
  if (!mine.length) {
    hud.orderList.innerHTML = open.length
      ? open.slice(0, 3).map(o => `<div class="order-card">
          <div class="order-food">${o.food}</div>
          <div class="order-route">${o.from.name} &rarr; ${o.to.name}</div>
          <div class="order-meta"><span class="order-rm">${rmFmt(o.rm)}</span><span class="order-phase">UNASSIGNED</span></div>
          <div class="order-bar"><i style="width:${clamp(100 - (o.age / o.deadline) * 100, 0, 100)}%"></i></div>
        </div>`).join('')
      : '<div id="no-orders">Waiting for orders...</div>';
    return;
  }
  hud.orderList.innerHTML = mine.map(o => {
    const phase = o.assignee && o.assignee.phase === 'toDropoff' ? 'DROPOFF' : 'PICKUP';
    const pct = clamp(100 - (o.age / o.deadline) * 100, 0, 100);
    return `<div class="order-card ${phase === 'DROPOFF' ? 'dropoff' : ''}">
      <div class="order-food">${o.food}</div>
      <div class="order-route">${o.from.name} &rarr; ${o.to.name}</div>
      <div class="order-meta"><span class="order-rm">${rmFmt(o.rm)}</span><span class="order-phase">${phase}</span></div>
      <div class="order-bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('');
}
function onOrderEvent(type, payload) {
  const { order, rider } = payload;
  if (type === 'new') {
    audio.orderPing();
    pushTicker(`NEW ORDER: ${order.food} — ${order.from.name} to ${order.to.name} (${rmFmt(order.rm)})`);
    renderOrderBoard();
  } else if (type === 'assigned') {
    if (rider.isPlayer) { popup('ORDER ACCEPTED', `${order.food}<br>${order.from.name} &rarr; ${order.to.name}`, 'new'); renderOrderBoard(); }
  } else if (type === 'picked') {
    if (rider.isPlayer) popup('PICKED UP', `${order.food} is on the back seat — jom!`, 'new');
    else pushTicker(`${rider.name} picked up ${order.food}`);
  } else if (type === 'delivered') {
    if (rider.isPlayer) {
      state.rm += payload.rm; state.xp += payload.xp; state.deliveries++;
      audio.cash();
      popup('DELIVERED!', `+${rmFmt(payload.rm)} &bull; +${payload.xp} XP &bull; streak x${(1 + 0.12 * payload.streak).toFixed(2)}`, 'gold');
      hud.rmVal.classList.remove('bump'); void hud.rmVal.offsetWidth; hud.rmVal.classList.add('bump');
      renderOrderBoard();
    } else {
      pushTicker(`${rider.name} delivered ${order.food} +${rmFmt(payload.rm)}`);
    }
  } else if (type === 'expired') {
    if (rider && rider.isPlayer) popup('ORDER EXPIRED', `${order.food} went cold — streak lost!`, 'bad');
    else if (rider) pushTicker(`${rider.name} dropped an order (${order.food}) — sian`);
    renderOrderBoard();
  }
}

// ---------------- minimap ----------------
const minimap = (() => {
  const cvs = $('minimap');
  if (!cvs) return null;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;

  // fit the whole street network inside the canvas, north up (-z is north → +y)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const e of world.edges) {
    for (const p of e.pos) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  const pad = 26;
  const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oz = (H - (maxZ - minZ) * scale) / 2 - minZ * scale;
  const mx = (x) => x * scale + ox;
  const mz = (z) => z * scale + oz;

  // static layer: the full branching street grid, junction dots, landmark pips
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const b = base.getContext('2d');
  const edgePath = (c) => {
    c.beginPath();
    for (const e of world.edges) {
      const pts = e.pos;
      c.moveTo(mx(pts[0].x), mz(pts[0].z));
      for (let i = 1; i < pts.length; i += 2) c.lineTo(mx(pts[i].x), mz(pts[i].z));
      c.lineTo(mx(pts[pts.length - 1].x), mz(pts[pts.length - 1].z));
    }
  };
  b.lineJoin = 'round';
  b.lineCap = 'round';
  edgePath(b); b.strokeStyle = 'rgba(0,209,132,0.14)'; b.lineWidth = 13; b.stroke();
  edgePath(b); b.strokeStyle = '#00d084'; b.lineWidth = 4; b.stroke();
  edgePath(b); b.strokeStyle = '#0b0e16'; b.lineWidth = 1.6; b.stroke();
  // junction dots so the grid reads as streets, not a race track
  for (const n of world.nodes) {
    const deg = n.links.length;
    if (deg < 2) continue;
    b.fillStyle = '#00d084';
    b.beginPath(); b.arc(mx(n.x), mz(n.z), deg >= 4 ? 3.6 : 2.6, 0, Math.PI * 2); b.fill();
    b.strokeStyle = '#0b0e16';
    b.lineWidth = 1.4;
    b.stroke();
  }
  for (const a of world.landmarks) {
    b.fillStyle = '#14161a';
    b.strokeStyle = '#ffd23f';
    b.lineWidth = 2;
    b.beginPath(); b.arc(mx(a.roadPos.x), mz(a.roadPos.z), 4, 0, Math.PI * 2);
    b.fill(); b.stroke();
  }
  const startEdge = world.edges[world.start.edgeId];
  const startPos = startEdge.pos[0];
  b.fillStyle = '#ff4d8d';
  b.beginPath(); b.arc(mx(startPos.x), mz(startPos.z), 4, 0, Math.PI * 2); b.fill();

  const ring = (x, y, color, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  return {
    draw(pose) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);

      // current order: target pin bright, the other leg dim
      const active = orders.playerOrders[0];
      if (active) {
        const dropping = active.assignee && active.assignee.phase === 'toDropoff';
        for (const wp of [active.from, active.to]) {
          const isPickup = wp === active.from;
          const x = mx(wp.pos.x), y = mz(wp.pos.z);
          if (isPickup !== dropping) {
            ring(x, y, isPickup ? '#00d084' : '#ffd23f', 4);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      // AI riders
      for (const r of riderSystem.riders) {
        if (r.isPlayer) continue;
        const p = r.group.position;
        ctx.fillStyle = `#${r.jacketColor.toString(16).padStart(6, '0')}`;
        ctx.strokeStyle = '#14161a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx(p.x), mz(p.z), 5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      // player arrow, oriented along the tangent
      ctx.save();
      ctx.translate(mx(pose.pos.x), mz(pose.pos.z));
      ctx.rotate(Math.atan2(pose.tan.z, pose.tan.x));
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-7, 7); ctx.lineTo(-3, 0); ctx.lineTo(-7, -7);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#00b14f';
      ctx.lineWidth = 3;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  };
})();

let hudClock = 0, boardClock = 0;
function updateHUD(dt, pose) {
  hudClock += dt;
  boardClock += dt;
  if (boardClock > 1) { boardClock = 0; renderOrderBoard(); }
  if (hudClock < 0.12) return;
  hudClock = 0;
  const kmh = Math.round(pose.speed * 3.6);
  hud.kmh.textContent = kmh;
  hud.teleSpd.textContent = `${kmh} KM/H`;
  hud.teleOdo.textContent = `${(player.odo / 1000).toFixed(1)} KM`;
  const mult = 1 + 0.12 * orders.streak;
  hud.teleStreak.textContent = `x${mult.toFixed(2)}`;
  hud.teleXp.textContent = state.xp;
  hud.rmVal.textContent = rmFmt(state.rm);
  hud.deliv.textContent = `${state.deliveries} DELIVERIES`;
  const auto = player.autopilot;
  hud.autoChip.textContent = auto ? 'AUTO-PILOT' : 'MANUAL';
  hud.autoChip.classList.toggle('manual', !auto);
  // nearest landmark
  const best = world.nearestLandmark(player.group.position.x, player.group.position.z);
  if (best) hud.landmark.textContent = `— ${best.name.toUpperCase()} —`;
  if (minimap) minimap.draw(pose);
  // live countdown bars
  const mine = orders.playerOrders;
  if (mine.length) {
    mine.forEach((o, i) => {
      const card = hud.orderList.children[i];
      if (card && card.querySelector) {
        const bar = card.querySelector('.order-bar i');
        if (bar) bar.style.width = `${clamp(100 - (o.age / o.deadline) * 100, 0, 100)}%`;
      }
    });
  }
}

// ---------------- input ----------------
const keys = {};
let lastSteer = 0, blinkerCd = 0;
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyN') toggleTime();
  if (e.code === 'KeyR') toggleRain();
  if (e.code === 'KeyC') { state.camAuto = false; cycleCam(); }
  if (e.code === 'KeyX') audio.horn();
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

let manualHold = 0;
function readPlayerInput(dt) {
  const throttle = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  const brake = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
  let steer = 0;
  if (keys.KeyA || keys.ArrowLeft) steer -= 1;
  if (keys.KeyD || keys.ArrowRight) steer += 1;
  // hands-off by default: any driving key hands control to the player, and the
  // autopilot takes back over a couple of seconds after the last key is released
  if (throttle || brake || steer !== 0) manualHold = 2.5;
  else manualHold = Math.max(0, manualHold - dt);
  player.autopilot = manualHold <= 0;
  player.input.throttle = throttle;
  player.input.brake = brake;
  player.input.steer = steer;
  blinkerCd -= dt;
  if (steer !== 0 && steer !== lastSteer && blinkerCd <= 0) {
    audio.blinker();
    blinkerCd = 0.22;
  }
  lastSteer = steer;
}

// ---------------- UI buttons ----------------
hud.btnTime.addEventListener('click', toggleTime);
hud.btnRain.addEventListener('click', toggleRain);
hud.btnCam.addEventListener('click', () => { state.camAuto = false; cycleCam(); });
function toggleMute() {
  state.muted = audio.toggleMute();
  hud.btnAudio.textContent = state.muted ? 'AUDIO: OFF' : 'AUDIO: ON';
  hud.btnAudio.classList.toggle('on', !state.muted);
}
hud.btnAudio.addEventListener('click', toggleMute);
hud.startBtn.addEventListener('click', async () => {
  await audio.unlock();
  state.muted = false;
  hud.btnAudio.textContent = 'AUDIO: ON';
  hud.btnAudio.classList.toggle('on', true);
  hud.overlay.classList.add('hidden');
  state.started = true;
  pushTicker('Autopilot engaged — sit back, the rider picks up and delivers on its own. Tap WASD to take over.');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
});

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let frameCount = 0;
renderer.setAnimationLoop(() => {
  frameCount++;
  const dt = clamp(clock.getDelta(), 0, 0.05);
  readPlayerInput(dt);
  riderSystem.update(dt, traffic.cars);
  orders.update(dt, riderSystem.riders);
  world.updateSignals(dt);
  traffic.update(dt, riderSystem.riders);
  const pose = player.getPose();
  directorUpdate(dt);
  updateTod(dt);
  updateBeacons(dt, pose);
  updateRain(dt);
  // tide-like scroll on the sea surface
  if (world.seaMesh && world.seaMesh.material.map) {
    world.seaMesh.material.map.offset.y -= dt * 0.006;
  }
  audio.setEngine(clamp(player.speed / 33, 0, 1), player.isDrifting);
  audio.update(dt, pose.pos, world);
  updateHUD(dt, pose);
  composer.render();
});

// debug / inspection hook (kept from the Miri Grand Circuit convention)
window.__miri = { THREE, scene, camera, renderer, world, landmarks, scenery, riderSystem, traffic, orders, get frameCount() { return frameCount; } };

pushTicker('Selamat datang ke Miri! Deliver laksa, earn ringgit, avoid the Hilux.');
renderOrderBoard();
