// Materials, procedural textures, and shader tweaks for the 3D view.
import * as THREE from 'three';
import { canvasTexture, col, hdr, mulberry32 } from './util';

const rnd = mulberry32(99);

// ------------------------------------------------------------------ procedural textures

function noiseFill(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, size = 2): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * alpha})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}

/** The security shield with three claw marks, drawn into a box at (x, y) of size w by h. */
function drawEmblem(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const shield = () => {
    g.beginPath();
    g.moveTo(x + w * 0.5, y + h * 0.06);
    g.lineTo(x + w * 0.88, y + h * 0.18);
    g.quadraticCurveTo(x + w * 0.86, y + h * 0.72, x + w * 0.5, y + h * 0.95);
    g.quadraticCurveTo(x + w * 0.14, y + h * 0.72, x + w * 0.12, y + h * 0.18);
    g.closePath();
  };
  shield();
  g.fillStyle = '#f2f4f7';
  g.fill();
  g.save();
  g.translate(x + w * 0.5, y + h * 0.5);
  g.scale(0.86, 0.86);
  g.translate(-(x + w * 0.5), -(y + h * 0.5));
  shield();
  g.fillStyle = '#2152b8';
  g.fill();
  g.restore();
  g.strokeStyle = '#f2f4f7';
  g.lineCap = 'round';
  g.lineWidth = w * 0.06;
  for (const dx of [-0.137, 0, 0.137]) {
    g.beginPath();
    g.moveTo(x + w * (0.5 + dx) - w * 0.078, y + h * 0.3);
    g.quadraticCurveTo(x + w * (0.5 + dx) - w * 0.02, y + h * 0.5, x + w * (0.5 + dx) + w * 0.059, y + h * 0.7);
    g.stroke();
  }
}

export const TEX = {
  planks: canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#7c5a3a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const y = i * 32;
      const k = 0.85 + rnd() * 0.3;
      g.fillStyle = `rgb(${(150 * k) | 0},${(108 * k) | 0},${(70 * k) | 0})`;
      g.fillRect(0, y + 2, w, 29);
      for (let j = 0; j < 40; j++) {
        g.fillStyle = `rgba(60,40,20,${rnd() * 0.15})`;
        g.fillRect(rnd() * w, y + 3 + rnd() * 26, 20 + rnd() * 60, 1);
      }
      g.fillStyle = 'rgba(40,25,10,0.9)';
      g.fillRect(((i * 97) % 200) + 20, y, 2, 32);
    }
  }),
  chain: canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(205,210,214,1)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, h);
    g.moveTo(w, 0);
    g.lineTo(0, h);
    g.stroke();
  }),
  /** Chain-link pulled apart: holes and loose ends. */
  chainTorn: canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190,195,200,1)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w * 0.7, h * 0.7);
    g.moveTo(w, 0);
    g.lineTo(w * 0.35, h * 0.65);
    g.stroke();
  }),
  hazard: canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#f2c21b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1b1b';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 16, h);
      g.lineTo(x + 16 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  }),
  /** Painted steel plates: panel seams, rivets, worn edges. */
  plate: canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    noiseFill(g, w, h, 3000, 0.05);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(0, h / 2, w, 2);
    for (const y of [8, h / 2 + 8, h / 2 - 8, h - 8]) for (let x = 10; x < w; x += 24) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(x - 0.6, y - 0.6, 1.2, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,110,95,${0.15 + rnd() * 0.25})`;
      g.fillRect(rnd() * w, rnd() < 0.5 ? 2 + rnd() * 3 : h / 2 + 2 + rnd() * 3, 4 + rnd() * 18, 1.5);
    }
  }),
  /** Cast concrete: soft stains, form-tie holes, faint pour lines. */
  concrete: canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d0ccc3';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const r = 10 + rnd() * 40;
      const x = rnd() * w;
      const y = rnd() * h;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(90,85,75,${rnd() * 0.12})`);
      grd.addColorStop(1, 'rgba(90,85,75,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    noiseFill(g, w, h, 6000, 0.08, 1.5);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (const y of [64, 128, 192]) g.fillRect(0, y, w, 1);
    for (const [x, y] of [[48, 32], [208, 32], [48, 160], [208, 160], [128, 96], [128, 224]]) {
      g.fillStyle = 'rgba(40,38,35,0.6)';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    // Rain streaks down from the top.
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,58,52,${0.04 + rnd() * 0.06})`;
      g.fillRect(rnd() * w, 0, 2 + rnd() * 3, 30 + rnd() * 80);
    }
  }),
  /** The same concrete, cracked and chipped. */
  concreteCracked: canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c4bfb5';
    g.fillRect(0, 0, w, h);
    noiseFill(g, w, h, 6000, 0.09, 1.5);
    g.strokeStyle = 'rgba(30,28,25,0.85)';
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      let x = rnd() * w;
      let y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 50;
        y += 10 + rnd() * 25;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(70,65,58,0.7)';
      const x = rnd() * w;
      const y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) g.lineTo(x + (rnd() - 0.5) * 26, y + (rnd() - 0.5) * 26);
      g.fill();
    }
  }),
  corrugated: canvasTexture(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 150 + 90 * Math.sin((x / w) * Math.PI * 2 * 8);
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      g.fillRect(x, 0, 1, h);
    }
  }, false),
  grating: canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#60666b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2023';
    for (let y = 4; y < h; y += 16) for (let x = 3; x < w; x += 8) g.fillRect(x, y, 4, 10);
  }),
  glow: canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, false),
  /** Soft round shadow for the ground under small things. */
  blob: canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }),
  /** Scorched, scuffed ground under a wrecked fence. */
  scuff: canvasTexture(128, 128, (g, w, h) => {
    for (let i = 0; i < 40; i++) {
      const r = 8 + rnd() * 30;
      const x = w / 2 + (rnd() - 0.5) * w * 0.6;
      const y = h / 2 + (rnd() - 0.5) * h * 0.6;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(40,30,20,${0.1 + rnd() * 0.2})`);
      grd.addColorStop(1, 'rgba(40,30,20,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }),
  /** Park security emblem for the HQ roof and flag: a shield with three claw marks. */
  emblem: canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    drawEmblem(g, 0, 0, w, h);
  }),
  flag: canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#2f62cf';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h * 0.82, w, h * 0.06);
    drawEmblem(g, w * 0.5 - h * 0.31, h * 0.1, h * 0.62, h * 0.62);
  }),
  securitySign: canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = '#1c3f8f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SECURITY', w / 2, h / 2 + 4);
  }),
};

const windowTex = (lit: boolean) =>
  canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = lit ? '#000' : '#b9bdc2';
    g.fillRect(0, 0, w, h);
    const r = mulberry32(5);
    for (let i = 0; i < 16; i++) {
      if (lit) {
        if (r() < 0.3) continue;
        const k = 0.7 + r() * 0.3;
        g.fillStyle = `rgb(${(255 * k) | 0},${(205 * k) | 0},${(140 * k) | 0})`;
      } else {
        const grd = g.createLinearGradient(0, 6, 0, h - 6);
        grd.addColorStop(0, '#30465a');
        grd.addColorStop(1, '#141e27');
        g.fillStyle = grd;
      }
      g.fillRect(i * 32 + 3, 6, 26, h - 12);
    }
  });
TEX.plate.wrapS = TEX.plate.wrapT = THREE.RepeatWrapping;

// ------------------------------------------------------------------ shared materials

/** Every material the built things use. Night and power change a few of them in place. */
export function makeMaterials() {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const M = {
    wood: std({ color: col('#6a4a2e'), roughness: 0.85 }),
    woodDark: std({ color: col('#4a3220'), roughness: 0.9 }),
    deck: std({ map: TEX.planks, roughness: 0.8 }),
    galv: std({ color: col('#9aa3aa'), metalness: 0.8, roughness: 0.35 }),
    steel: std({ color: col('#7d858c'), metalness: 0.75, roughness: 0.4 }),
    darkSteel: std({ color: col('#2c3237'), metalness: 0.6, roughness: 0.45 }),
    rust: std({ color: col('#6a4a35'), metalness: 0.4, roughness: 0.8 }),
    concrete: std({ map: TEX.concrete, bumpMap: TEX.concrete, bumpScale: 0.6, roughness: 0.95 }),
    concreteCracked: std({ map: TEX.concreteCracked, bumpMap: TEX.concreteCracked, bumpScale: 1.2, roughness: 0.95 }),
    concreteDark: std({ map: TEX.concrete, color: col('#8f8a80'), roughness: 0.95 }),
    facade: std({ map: TEX.concrete, color: col('#e2ded6'), roughness: 0.88 }),
    hqWall: std({ map: TEX.concrete, bumpMap: TEX.concrete, bumpScale: 0.5, color: col('#8c97a6'), roughness: 0.85 }),
    hqBase: std({ map: TEX.concrete, color: col('#5d6672'), roughness: 0.9 }),
    barrier: std({ map: TEX.concrete, color: col('#c9c6bf'), roughness: 0.9 }),
    flag: std({ map: TEX.flag, side: THREE.DoubleSide, roughness: 0.8 }),
    stone: std({ color: col('#9d9282'), roughness: 0.95 }),
    glass: std({ color: col('#16212b'), roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6 }),
    team: std({ color: col('#2f62cf'), roughness: 0.5 }),
    teamPlate: std({ map: TEX.plate, color: col('#2f5fc4'), bumpMap: TEX.plate, bumpScale: 0.8, metalness: 0.35, roughness: 0.5 }),
    whitePlate: std({ map: TEX.plate, color: col('#dfe2e6'), bumpMap: TEX.plate, bumpScale: 0.8, metalness: 0.3, roughness: 0.5 }),
    greyPlate: std({ map: TEX.plate, color: col('#6f777e'), bumpMap: TEX.plate, bumpScale: 0.8, metalness: 0.55, roughness: 0.45 }),
    grating: std({ map: TEX.grating, metalness: 0.6, roughness: 0.5 }),
    roof: std({ color: col('#8d969c'), bumpMap: TEX.corrugated, bumpScale: 1.5, metalness: 0.6, roughness: 0.45 }),
    hazard: std({ map: TEX.hazard, roughness: 0.7 }),
    insulator: std({ color: col('#e9e4d8'), roughness: 0.35 }),
    wireLive: std({ color: col('#bdf3ff'), emissive: col('#3fdcff'), emissiveIntensity: 1.0, roughness: 0.3 }),
    wireDead: std({ color: col('#2a2f34'), metalness: 0.8, roughness: 0.35 }),
    chain: std({ map: TEX.chain, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45, color: col('#c3c9ce') }),
    chainTorn: std({ map: TEX.chainTorn, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.55, color: col('#a9afb4') }),
    razor: std({ color: col('#c9ced2'), metalness: 0.9, roughness: 0.25 }),
    rebar: std({ color: col('#5b3a2a'), metalness: 0.5, roughness: 0.7 }),
    ledLive: new THREE.MeshBasicMaterial({ color: hdr('#5dffb0', 2.5) }),
    ledDead: new THREE.MeshBasicMaterial({ color: hdr('#ff3b2f', 3.0) }),
    rubber: std({ color: col('#1c1d1f'), roughness: 0.8 }),
    lampGlass: std({ color: col('#dfe6e8'), roughness: 0.2, emissive: col('#ffe2a8'), emissiveIntensity: 0 }),
    sign: std({ map: TEX.securitySign, roughness: 0.5, emissive: col('#ffffff'), emissiveMap: TEX.securitySign, emissiveIntensity: 0 }),
    emblem: std({ map: TEX.emblem, transparent: true, alphaTest: 0.1, roughness: 0.6 }),
    windows: std({ map: windowTex(false), roughness: 0.15, metalness: 0.1, emissive: col('#ffffff'), emissiveMap: windowTex(true), emissiveIntensity: 0, envMapIntensity: 1.4 }),
    beacon: new THREE.MeshBasicMaterial({ color: hdr('#ff2a1a', 1.2) }),
    beaconBlue: new THREE.MeshBasicMaterial({ color: hdr('#3b7bff', 1.2) }),
    carBody: std({ color: col('#eef0f2'), metalness: 0.3, roughness: 0.35, envMapIntensity: 1.1 }),
    searchGlass: new THREE.MeshBasicMaterial({ color: hdr('#e8f0ff', 1.0) }),
    orange: std({ color: col('#ff7b1c'), roughness: 0.5, emissive: col('#ff5a00'), emissiveIntensity: 0.25 }),
    gun: std({ color: col('#2a2e33'), metalness: 0.6, roughness: 0.4 }),
    gunTeam: std({ color: col('#2f62cf'), roughness: 0.45 }),
    sandbag: std({ color: col('#9a8a62'), roughness: 1 }),
    twig: std({ color: col('#6d5536'), roughness: 0.95 }),
    straw: std({ color: col('#b59a5c'), roughness: 1 }),
    egg: std({ color: col('#efe4c8'), roughness: 0.55 }),
    debris: std({ color: col('#7a746a'), roughness: 0.95 }),
  };
  return M;
}
export type Mats = ReturnType<typeof makeMaterials>;

/** Night and power change glows in place, without rebuilding anything. */
export function applyLighting(M: Mats, night: boolean, power: boolean): void {
  M.wireLive.emissiveIntensity = night ? 2.2 : 0.4;
  M.windows.emissiveIntensity = night ? 2.4 : 0;
  M.sign.emissiveIntensity = night ? 0.5 : 0;
  M.lampGlass.emissiveIntensity = night && power ? 3 : 0;
  M.beacon.color = hdr('#ff2a1a', night ? 6 : 1.2);
  M.beaconBlue.color = hdr('#3b7bff', night ? 4 : 1.2);
  M.searchGlass.color = hdr('#e8f0ff', night ? 8 : 1.0);
}

// ------------------------------------------------------------------ shader tweaks

const NOISE = /* glsl */ `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ return vnoise(p) * 0.55 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.1) * 0.15; }
vec3 perturbNormalP(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }
`;

export interface Rim {
  color: string;
  power: number;
  strength: number;
}

/** Every rim's colour uniform, so night can switch them all on and day off without recompiling. */
const RIMS: { uniform: { value: THREE.Color }; base: THREE.Color }[] = [];
let rimsOn = true;

export function setRims(on: boolean): void {
  rimsOn = on;
  for (const r of RIMS) r.uniform.value.copy(on ? r.base : new THREE.Color(0, 0, 0));
}

/** A faint edge glow: moonlight catching characters at night, or a warm threat outline on loose predators. */
export function addRim(m: THREE.MeshStandardMaterial, rim: Rim | null): THREE.MeshStandardMaterial {
  if (!rim || rim.strength <= 0) return m;
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  const base = hdr(rim.color, rim.strength);
  const uniform = { value: rimsOn ? base.clone() : new THREE.Color(0, 0, 0) };
  RIMS.push({ uniform, base });
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.rimCol = uniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimCol;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += rimCol * pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), ${rim.power.toFixed(2)});`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey()}|rim${rim.power}`;
  m.userData.rim = uniform;
  return m;
}

export interface SkinOptions {
  stripe?: number;
  stripeCol?: string;
  belly?: number;
  bump?: number;
  blotch?: number;
  freq?: number;
  rough?: number;
}

/** Dinosaur skin: blotches, back stripes, a lighter belly, and fine scale bumps, all from the bind-pose position. */
export function skinMaterial(color: string, o: SkinOptions = {}, rim: Rim | null = null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: col(color), roughness: o.rough ?? 0.72, metalness: 0, envMapIntensity: 0.7 });
  const U = {
    uStripe: { value: o.stripe ?? 0 },
    uStripeCol: { value: col(o.stripeCol ?? '#2b2418') },
    uBelly: { value: o.belly ?? 0 },
    uBump: { value: o.bump ?? 0.6 },
    uBlotch: { value: o.blotch ?? 0.25 },
    uFreq: { value: o.freq ?? 1 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinP; varying vec3 vSkinN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinP = position; vSkinN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinP; varying vec3 vSkinN; uniform float uStripe, uBelly, uBump, uBlotch, uFreq; uniform vec3 uStripeCol;\n' + NOISE)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 sp = vSkinP * uFreq;
        float n1 = fbm3(sp * 0.32);
        float n2 = vnoise(sp * 1.7);
        vec3 sn = normalize(vSkinN);
        float back = smoothstep(0.15, 0.85, sn.y);
        float belly = smoothstep(-0.05, -0.7, sn.y);
        float st = smoothstep(0.62, 0.86, sin(sp.z * 1.25 + n1 * 5.0) * 0.5 + 0.5) * back;
        diffuseColor.rgb *= mix(1.0 - uBlotch, 1.0 + uBlotch * 0.6, n1) * mix(0.92, 1.05, n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, uStripeCol, st * uStripe);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + vec3(0.03, 0.025, 0.015), belly * uBelly);
        diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(-0.2, 0.6, sn.y) * 0.5 + 0.5);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float hb = vnoise(vSkinP * uFreq * 3.2) * 0.65 + vnoise(vSkinP * uFreq * 7.5) * 0.35;
        normal = perturbNormalP(-vViewPosition, normal, vec2(dFdx(hb), dFdy(hb)) * uBump, faceDirection);`,
      );
  };
  m.customProgramCacheKey = () => 'dinoskin';
  return addRim(m, rim);
}

/** Darkens foliage toward the ground, so plants have depth without baked lighting. */
export function foliageGradient(m: THREE.MeshStandardMaterial, minY: number, maxY: number, lo: number, hi: number): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.gMin = { value: minY };
    sh.uniforms.gMax = { value: maxY };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGH; uniform float gMin, gMax;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGH = clamp((position.y - gMin) / (gMax - gMin), 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGH;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= mix(${lo.toFixed(2)}, ${hi.toFixed(2)}, smoothstep(0.0, 1.0, vGH));`);
  };
  m.customProgramCacheKey = () => `grad${minY.toFixed(3)}_${maxY.toFixed(3)}_${lo}_${hi}`;
}

/**
 * Things the camera must always see (troops, animals). Tree canopies between the camera and one of
 * these dither away. Each point is x, z of the ellipse centre on the ground, then its x and z radii.
 */
export const REVEAL = { pts: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, n: { value: 0 } };

/** Lets a material dither away where it hides a REVEAL point. Safe to call twice. */
export function addReveal(m: THREE.Material): void {
  if (m.userData.reveal) return;
  m.userData.reveal = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.revealPts = REVEAL.pts;
    sh.uniforms.revealN = REVEAL.n;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRevW;').replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        vRevW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vRevW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRevW; uniform vec4 revealPts[16]; uniform int revealN;
        float revealNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (revealN > 0) {
          vec3 rd = vRevW - cameraPosition;
          if (rd.y < -0.0001) {
            vec2 gp = cameraPosition.xz + rd.xz * (-cameraPosition.y / rd.y);
            float rk = 0.0;
            for (int i = 0; i < 16; i++) {
              if (i >= revealN) break;
              vec4 p = revealPts[i];
              rk = max(rk, 1.0 - smoothstep(0.55, 1.0, length((gp - p.xy) / p.zw)));
            }
            if (rk * 0.8 > revealNoise(gl_FragCoord.xy)) discard;
          }
        }`,
      );
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + '_reveal';
  m.needsUpdate = true;
}

/** Additive light cone for flashlights and floodlights, fading along its length. */
export function beamMaterial(color: string, k: number, len: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { c: { value: hdr(color, k) }, len: { value: len } },
    vertexShader: /* glsl */ `varying float vT; varying vec3 vN; varying vec3 vV; uniform float len;
      void main(){ vT = position.z / len; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 c; varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float edge = pow(f, 2.0);
        float fall = pow(clamp(1.0 - vT, 0.0, 1.0), 1.8) * smoothstep(0.02, 0.3, vT);
        gl_FragColor = vec4(c * edge * fall, 1.0); }`,
  });
}
