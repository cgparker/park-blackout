// Ground and water. The ground blends tiling textures by terrain type, using small "splat" maps
// built from the tile grid, so it stays sharp at any zoom and costs little memory on phones.
import * as THREE from 'three';
import type { ExhibitKind } from '../config';
import { Tile, type Point, type Rect, type TileType } from '../core/grid';
import { clamp, col, mulberry32 } from './util';

export interface TerrainSource {
  cols: number;
  rows: number;
  tileAt(x: number, y: number): TileType;
  exhibits: readonly { kind: ExhibitKind; footprint: Rect }[];
  hq: Rect;
  gate: Point;
  /** Nest centre in tiles, or null. */
  nest: Point | null;
  /** Areas to keep free of trees and bushes, in tiles. */
  clear?: readonly Rect[];
}

/** How far the ground extends past the map, in tiles, so the camera never sees an edge. */
export const MARGIN = { x: 20, z: 14 };
const PPT = 16;

const LAYERS = ['grass', 'meadow', 'dirt', 'jungle', 'flagstone', 'gravel', 'sand', 'concrete', 'mud'] as const;
const NORMALS = ['grass_n', 'dirt_n', 'jungle_n', 'flagstone_n'] as const;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** Loads same-size images into one texture array: fewer samplers, so phones stay under their limit. */
async function textureArray(base: string, names: readonly string[], size: number, srgb: boolean): Promise<THREE.DataArrayTexture> {
  const imgs = await Promise.all(names.map((n) => loadImage(`${base}/${n}.jpg`)));
  const data = new Uint8Array(size * size * 4 * names.length);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  imgs.forEach((img, i) => {
    g.clearRect(0, 0, size, size);
    g.drawImage(img, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, names.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export interface TerrainTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  macro: THREE.Texture;
}

export async function loadTerrainTextures(base: string): Promise<TerrainTextures> {
  const [albedo, normal, macroImg] = await Promise.all([
    textureArray(base, LAYERS, 512, true),
    textureArray(base, NORMALS, 512, false),
    loadImage(`${base}/macro.jpg`),
  ]);
  const macro = new THREE.Texture(macroImg);
  macro.wrapS = macro.wrapT = THREE.RepeatWrapping;
  macro.colorSpace = THREE.NoColorSpace;
  macro.needsUpdate = true;
  return { albedo, normal, macro };
}

// ------------------------------------------------------------------ splat maps

export function boxBlur(src: Float32Array<ArrayBuffer>, w: number, h: number, r: number, passes = 2): Float32Array<ArrayBuffer> {
  if (r < 1) return src;
  let a = src;
  let b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)];
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += a[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[clamp(y + r + 1, 0, h - 1) * w + x] - a[clamp(y - r, 0, h - 1) * w + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function pack(channels: Float32Array[], w: number, h: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = clamp(Math.round((channels[c]?.[i] ?? 0) * 255), 0, 255);
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface Splat {
  a: THREE.DataTexture;
  b: THREE.DataTexture;
  c: THREE.DataTexture;
  region: THREE.Vector4;
  /** Water coverage per splat pixel, for placing reeds. */
  water: Float32Array;
  w: number;
  h: number;
}

/** Fence line of an exhibit: through the middle of its border tiles. */
export const fenceRect = (fp: Rect) => ({ x0: fp.x + 0.5, z0: fp.y + 0.5, x1: fp.x + fp.w - 0.5, z1: fp.y + fp.h - 0.5 });

export function buildSplat(src: TerrainSource): Splat {
  const X0 = -MARGIN.x;
  const Z0 = -MARGIN.z;
  const TW = src.cols + MARGIN.x * 2;
  const TH = src.rows + MARGIN.z * 2;
  const w = TW * PPT;
  const h = TH * PPT;
  const n = w * h;
  const path = new Float32Array(n);
  const water = new Float32Array(n);
  const rock = new Float32Array(n);
  const dirt = new Float32Array(n);
  const jungle = new Float32Array(n);
  const meadow = new Float32Array(n);
  const concrete = new Float32Array(n);
  const gravel = new Float32Array(n);
  const block = new Float32Array(n);
  const mud = new Float32Array(n);
  const road = new Float32Array(n);

  const tileOf = (px: number, pz: number) => {
    const x = Math.floor(X0 + (px + 0.5) / PPT);
    const z = Math.floor(Z0 + (pz + 0.5) / PPT);
    if (x < 0 || z < 0 || x >= src.cols || z >= src.rows) return -1;
    return src.tileAt(x, z);
  };
  const g = src.gate;
  for (let pz = 0; pz < h; pz++) {
    const z = Z0 + (pz + 0.5) / PPT;
    for (let px = 0; px < w; px++) {
      const x = X0 + (px + 0.5) / PPT;
      const i = pz * w + px;
      const t = tileOf(px, pz);
      if (t === Tile.Path || t === Tile.Gate) path[i] = 1;
      else if (t === Tile.Water) water[i] = 1;
      else if (t === Tile.Rock) rock[i] = 1;
      else if (t === Tile.HQ) block[i] = 1;
      else if (t === Tile.Tower) {
        const fx = x - Math.floor(x) - 0.5;
        const fz = z - Math.floor(z) - 0.5;
        if (Math.abs(fx) < 0.42 && Math.abs(fz) < 0.42) concrete[i] = 1;
      }
      // Outside the gate: a paved plaza and the road the guests arrive on.
      if (g.x === 0 && x < 0 && x > -3.4 && z > g.y - 1 && z < g.y + 2) path[i] = 1;
      if (g.x === 0 && x < -3.4 && x > -7) road[i] = 1;
    }
  }
  const hq = src.hq;
  for (let pz = 0; pz < h; pz++) {
    const z = Z0 + (pz + 0.5) / PPT;
    for (let px = 0; px < w; px++) {
      const x = X0 + (px + 0.5) / PPT;
      if (x > hq.x - 0.3 && x < hq.x + hq.w + 0.3 && z > hq.y - 0.3 && z < hq.y + hq.h + 0.3) concrete[pz * w + px] = 1;
    }
  }
  for (const ex of src.exhibits) {
    const f = fenceRect(ex.footprint);
    const px0 = Math.floor((f.x0 - 0.3 - X0) * PPT);
    const px1 = Math.ceil((f.x1 + 0.3 - X0) * PPT);
    const pz0 = Math.floor((f.z0 - 0.3 - Z0) * PPT);
    const pz1 = Math.ceil((f.z1 + 0.3 - Z0) * PPT);
    const floor = ex.kind === 'pasture' ? meadow : ex.kind === 'raptor' ? dirt : jungle;
    for (let pz = Math.max(0, pz0); pz < Math.min(h, pz1); pz++) {
      const z = Z0 + (pz + 0.5) / PPT;
      for (let px = Math.max(0, px0); px < Math.min(w, px1); px++) {
        const x = X0 + (px + 0.5) / PPT;
        const i = pz * w + px;
        const inside = x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
        if (inside) {
          floor[i] = 1;
          if (ex.kind === 'trex') mud[i] = 1;
        }
        const dx = Math.min(Math.abs(x - f.x0), Math.abs(x - f.x1));
        const dz = Math.min(Math.abs(z - f.z0), Math.abs(z - f.z1));
        const onX = z >= f.z0 - 0.1 && z <= f.z1 + 0.1;
        const onZ = x >= f.x0 - 0.1 && x <= f.x1 + 0.1;
        const d = Math.min(onX ? dx : 9, onZ ? dz : 9);
        if (d < 0.09) {
          gravel[i] = 1;
          block[i] = Math.max(block[i], 0.6);
        }
      }
    }
  }
  if (src.nest) {
    const { x: nx, y: nz } = src.nest;
    for (let pz = 0; pz < h; pz++) {
      const z = Z0 + (pz + 0.5) / PPT;
      for (let px = 0; px < w; px++) {
        const x = X0 + (px + 0.5) / PPT;
        const d = Math.hypot(x - nx, z - nz);
        if (d < 1.7) dirt[pz * w + px] = Math.max(dirt[pz * w + px], 1 - d / 1.7 > 0.25 ? 1 : (1 - d / 1.7) * 4);
      }
    }
  }

  const pathB = boxBlur(path, w, h, 1);
  const waterB = boxBlur(water, w, h, 5, 3);
  const rockB = boxBlur(rock, w, h, 3, 3);
  const dirtB = boxBlur(dirt, w, h, 1);
  for (let i = 0; i < n; i++) dirtB[i] = Math.max(dirtB[i], rockB[i] * 1.6 > 0.6 ? Math.min(1, rockB[i] * 1.6) : rockB[i] * 1.6);
  const jungleB = boxBlur(jungle, w, h, 1, 1);
  const meadowB = boxBlur(meadow, w, h, 1, 1);
  const concB = boxBlur(concrete, w, h, 1, 1);
  const gravelB = boxBlur(gravel, w, h, 1, 1);
  const roadB = boxBlur(road, w, h, 1, 1);
  // Contact shade: grass darkens a little against paths, fences, and buildings.
  const aoSrc = new Float32Array(n);
  for (let i = 0; i < n; i++) aoSrc[i] = Math.max(block[i], path[i] * 0.5);
  const aoB = boxBlur(aoSrc, w, h, 3, 2);
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = clamp(aoB[i] * (1 - pathB[i]) * (1 - concrete[i]) * 0.9, 0, 1);

  return {
    a: pack([pathB, dirtB, jungleB, meadowB], w, h),
    b: pack([waterB, new Float32Array(n), concB, gravelB], w, h),
    c: pack([ao, mud, roadB, new Float32Array(n)], w, h),
    region: new THREE.Vector4(X0, Z0, TW, TH),
    water: waterB,
    w,
    h,
  };
}

// ------------------------------------------------------------------ ground material

const GROUND_FRAG_PARS = /* glsl */ `
uniform sampler2D splatA, splatB, splatC, macroTex;
uniform highp sampler2DArray albedoArr, normalArr;
uniform vec4 region;
uniform float nightK;
varying vec2 vXZ;
vec3 tri(float layer, vec2 uv){ return texture(albedoArr, vec3(uv, layer)).rgb; }
vec3 nrm(float layer, vec2 uv){ return texture(normalArr, vec3(uv, layer)).xyz * 2.0 - 1.0; }
`;

const GROUND_FRAG_MAP = /* glsl */ `
  vec2 suv = (vXZ - region.xy) / region.zw;
  vec4 A = texture(splatA, suv);
  vec4 B = texture(splatB, suv);
  vec4 C = texture(splatC, suv);
  vec3 mac = texture(macroTex, vXZ * 0.035).rgb;
  vec3 mac2 = texture(macroTex, vXZ * 0.11 + 0.37).rgb;
  float wPath = smoothstep(0.47, 0.53, A.r);
  float wWaterF = B.r + (mac2.g - 0.5) * 0.22;
  float wWater = smoothstep(0.47, 0.53, wWaterF);
  float wShore = smoothstep(0.26, 0.44, wWaterF) * (1.0 - wWater);
  float wDirt = smoothstep(0.32, 0.62, A.g + (mac2.r - 0.5) * 0.4);
  float wJungle = A.b;
  float wMeadow = A.a;
  float wMud = C.g * smoothstep(0.58, 0.74, mac2.b);
  float wGravel = B.a;
  float wConc = B.b;
  float wRoad = C.b;

  vec3 grass = tri(0.0, vXZ * 0.5) * 0.62 + tri(0.0, vXZ * 0.17 + 0.31) * 0.38;
  float gBig = smoothstep(0.28, 0.72, mac.r * 0.7 + mac2.g * 0.3);
  grass *= mix(vec3(0.74, 0.8, 0.78), vec3(1.04), gBig);
  grass = mix(grass, grass * vec3(1.12, 1.05, 0.8), smoothstep(0.6, 0.86, mac.b) * 0.45);
  vec3 c = grass;
  c = mix(c, tri(1.0, vXZ * 0.5) * mix(0.9, 1.08, mac.g), wMeadow);
  c = mix(c, tri(2.0, vXZ * 0.4) * mix(0.88, 1.1, mac.r), wDirt);
  c = mix(c, tri(3.0, vXZ * 0.4) * mix(0.85, 1.1, mac.g), wJungle);
  c = mix(c, tri(8.0, vXZ * 0.33), wMud);
  c = mix(c, tri(5.0, vXZ * 0.7), wGravel);
  c = mix(c, tri(6.0, vXZ * 0.33), wShore);
  c = mix(c, tri(6.0, vXZ * 0.33) * mix(vec3(0.62, 0.66, 0.58), vec3(0.2, 0.28, 0.27), smoothstep(0.5, 0.9, B.r)), wWater);
  c = mix(c, tri(7.0, vXZ * 0.5) * vec3(0.45, 0.47, 0.5), wRoad);
  float kerb = (1.0 - smoothstep(0.0, 0.08, abs(A.r - 0.5) * 2.2)) * smoothstep(0.3, 0.5, A.r);
  c = mix(c, tri(4.0, vXZ / 3.0), wPath);
  c *= 1.0 - kerb * 0.28;
  c = mix(c, tri(7.0, vXZ * 0.5), wConc);
  c *= 1.0 - C.r * 0.32;
  c *= 1.0 - C.a * 0.14;
  diffuseColor.rgb = c;
  float groundRough = 0.94;
  groundRough = mix(groundRough, 0.85, wPath);
  groundRough = mix(groundRough, 0.75, wConc);
  groundRough = mix(groundRough, 0.3, wMud);
  groundRough = mix(groundRough, 0.4, smoothstep(0.38, 0.48, wWaterF) * (1.0 - wWater));
  groundRough = mix(groundRough, 0.2, wWater);
  vec3 gn = nrm(0.0, vXZ * 0.5);
  gn = mix(gn, nrm(1.0, vXZ * 0.4), max(wDirt, wMud));
  gn = mix(gn, nrm(2.0, vXZ * 0.4), wJungle);
  gn = mix(gn, nrm(3.0, vXZ / 3.0), wPath);
  gn = mix(gn, vec3(0.0, 0.0, 1.0), max(max(wConc, wWater), wRoad) * 0.8);
`;

/** The ground: one flat plane with a shader that blends textures by terrain type. */
export function makeGround(splat: Splat, tex: TerrainTextures): THREE.Mesh {
  const r = splat.region;
  const geo = new THREE.PlaneGeometry(r.z, r.w, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(r.x + r.z / 2, 0, r.y + r.w / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    splatA: { value: splat.a },
    splatB: { value: splat.b },
    splatC: { value: splat.c },
    macroTex: { value: tex.macro },
    albedoArr: { value: tex.albedo },
    normalArr: { value: tex.normal },
    region: { value: splat.region },
    nightK: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    // worldpos_vertex only runs with some features on; make sure vXZ is always written.
    if (!sh.vertexShader.includes('vXZ = (modelMatrix')) sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'vXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <fog_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_FRAG_PARS)
      .replace('#include <map_fragment>', GROUND_FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = groundRough;')
      .replace('#include <aomap_fragment>', 'float groundAO = 1.0 - C.a * 0.4 - C.r * 0.2; reflectedLight.indirectDiffuse *= groundAO; reflectedLight.indirectSpecular *= groundAO;')
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 gnw = normalize(vec3(gn.x, gn.z, -gn.y));
         normal = normalize((viewMatrix * vec4(gnw, 0.0)).xyz);`,
      );
  };
  mat.customProgramCacheKey = () => 'ground';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

/** Tileable ripples: many short waves with whole-number frequencies, so it wraps. */
function rippleNormal(): THREE.DataTexture {
  const N = 256;
  const rnd = mulberry32(3);
  const data = new Uint8Array(N * N * 4);
  const hgt = new Float32Array(N * N);
  const waves = Array.from({ length: 40 }, () => {
    const a = rnd() * Math.PI * 2;
    const f = Math.round(4 + rnd() * 18);
    return { kx: Math.round(Math.cos(a) * f), ky: Math.round(Math.sin(a) * f), p: rnd() * 6.28, a: (0.2 + rnd() * 0.8) / Math.sqrt(f) };
  });
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p);
      hgt[y * N + x] = v;
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x - 1 + N) % N)];
      const dy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
      const nx = -dx * 2.2;
      const ny = dy * 2.2;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      data[i] = (nx / l * 0.5 + 0.5) * 255;
      data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Pond surface: transparent, deeper colour in the middle, reflects the sky. */
export function makeWater(splat: Splat): THREE.Mesh {
  const r = splat.region;
  const mat = new THREE.MeshStandardMaterial({ color: col('#2a5961'), roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, normalMap: rippleNormal(), envMapIntensity: 1.4 });
  mat.normalMap!.repeat.set(r.z / 2.2, r.w / 2.2);
  mat.normalScale.set(0.16, 0.16);
  const uniforms = { wmask: { value: splat.b }, shallow: { value: col('#4a8a7f') }, deep: { value: col('#123d47') } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUvW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvW = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vUvW; uniform sampler2D wmask; uniform vec3 shallow; uniform vec3 deep;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wf = texture2D(wmask, vec2(vUvW.x, 1.0 - vUvW.y)).r;
        float cover = smoothstep(0.47, 0.53, wf);
        float depth = smoothstep(0.5, 0.95, wf);
        diffuseColor.rgb = mix(shallow, deep, depth);
        diffuseColor.a = cover * mix(0.45, 0.93, depth);
        if (diffuseColor.a < 0.01) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'water';
  const geo = new THREE.PlaneGeometry(r.z, r.w, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(r.x + r.z / 2, 0.02, r.y + r.w / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
