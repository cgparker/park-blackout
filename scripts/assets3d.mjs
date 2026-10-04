// Builds the 3D view's models from the Quaternius source packs (CC0) into public3d/.
// Sources are not in the repo: put them in assets-src/ (see public3d/LICENSES.md).
// Usage: node scripts/assets3d.mjs [dinos|people|nature], or no argument for everything.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, quantize, resample, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const SRC = 'assets-src';
const OUT = 'public3d';
const TMP = '.tex-tmp';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const ONLY = process.argv[2] ?? null;
const want = (part) => !ONLY || ONLY === part;
if (want('nature')) {
  const r = spawnSync('python3', ['scripts/assets3d_textures.py', `${SRC}/nature`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('texture pass failed');
}

const DINO_CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Death'];
const TROOP_CLIPS = ['Idle', 'Idle_Gun', 'Idle_Gun_Pointing', 'Gun_Shoot', 'Run', 'Run_Shoot', 'Walk', 'HitRecieve', 'Death'];
const GUEST_CLIPS = ['Idle', 'Walk', 'Run', 'Wave', 'Death'];

/** Leaf colour textures become the kit's white masks, tinted per tree at runtime. */
const LEAF_MASK = { 'Leaves_NormalTree_C.png': 'Leaves_NormalTree.png', 'Leaves_TwistedTree_C.png': 'Leaves_TwistedTree.png', 'Leaf_Pine_C.png': 'Leaf_Pine.png', 'Leaves_GiantPine_C.png': 'Leaf_Pine.png' };

const clipName = (name) => name.split('|').pop().replace(/^(TRex|Velociraptor|Triceratops)_/, '');

function keepClips(doc, keep) {
  for (const a of doc.getRoot().listAnimations()) {
    const n = clipName(a.getName());
    if (keep.includes(n)) {
      a.setName(n);
      continue;
    }
    // Channels and samplers too, or their keyframe data stays in the file with nothing using it.
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
}

/** Smooth shading without merging vertices: each vertex gets the average normal of every face at its position. */
function smoothNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const idx = prim.getIndices();
      if (!pos || !nor) continue;
      const n = pos.getCount();
      const key = (i) => {
        const p = pos.getElement(i, []);
        return `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
      };
      const groups = new Map();
      const keys = new Array(n);
      for (let i = 0; i < n; i++) {
        keys[i] = key(i);
        if (!groups.has(keys[i])) groups.set(keys[i], [0, 0, 0]);
      }
      const tri = idx ? idx.getArray() : Array.from({ length: n }, (_, i) => i);
      const a = [], b = [], c = [];
      for (let t = 0; t < tri.length; t += 3) {
        pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        for (const v of [tri[t], tri[t + 1], tri[t + 2]]) {
          const g = groups.get(keys[v]);
          g[0] += fn[0]; g[1] += fn[1]; g[2] += fn[2];
        }
      }
      for (let i = 0; i < n; i++) {
        const g = groups.get(keys[i]);
        const l = Math.hypot(g[0], g[1], g[2]) || 1;
        nor.setElement(i, [g[0] / l, g[1] / l, g[2] / l]);
      }
    }
  }
}

function swapTextures(doc) {
  for (const tex of doc.getRoot().listTextures()) {
    const src = path.basename(tex.getURI() || tex.getName() || '');
    const name = LEAF_MASK[src] ?? src;
    const base = name.replace(/\.[a-z]+$/i, '');
    const jpg = path.join(TMP, base + '.jpg');
    const png = path.join(TMP, base + '.png');
    const file = existsSync(png) ? png : existsSync(jpg) ? jpg : null;
    if (!file) {
      console.warn('  no processed texture for', src);
      continue;
    }
    tex.setImage(readFileSync(file)).setMimeType(file.endsWith('.png') ? 'image/png' : 'image/jpeg').setURI(path.basename(file));
  }
}

/**
 * Fewer triangles for phones. The camera looks down from far away, so trunks under the canopy and
 * the insides of grass tufts can lose most of theirs. Ratios are per material. "Sloppy" ignores the
 * mesh's seams, which trunks need (their many branch pieces and texture seams stop the careful mode).
 */
const NATURE_DETAIL = [
  [/Bark/, 0.12, 0.05, true],
  [/Grass/, 0.4, 0.02, false],
  [/Mushrooms/, 0.3, 0.02, false],
  [/Flowers/, 0.6, 0.02, false],
];

function simplifyByMaterial(doc, rules) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const rule = rules.find(([re]) => re.test(name));
      const indices = prim.getIndices();
      if (!rule || !indices || indices.getCount() / 3 < 150) continue;
      const [, ratio, error, sloppy] = rule;
      if (!sloppy) {
        weldPrimitive(prim, {});
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
        continue;
      }
      const pos = prim.getAttribute('POSITION');
      const positions = new Float32Array(pos.getCount() * 3);
      const p = [];
      for (let i = 0; i < pos.getCount(); i++) positions.set(pos.getElement(i, p), i * 3);
      const src = new Uint32Array(indices.getArray());
      const target = Math.max(3, Math.floor((src.length * ratio) / 3) * 3);
      const [out] = MeshoptSimplifier.simplifySloppy(src, positions, 3, null, target, error);
      indices.setArray(pos.getCount() > 65535 ? new Uint32Array(out) : new Uint16Array(out));
      // Drop the vertices no triangle uses any more.
      compactPrimitive(prim);
    }
  }
}

/**
 * Tree and bush leaves are hundreds of separate cards (two triangles each), so the simplifier can't
 * merge anything. Instead keep a share of the cards and grow each kept card so the canopy stays as full.
 */
function thinCards(doc, keep) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      if (!/Leaves_NormalTree|Leaves_TwistedTree|Leaf_Pine|Leaves_Pine/.test(name)) continue;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (!idx || idx.getCount() < 300) continue;
      const a = Array.from(idx.getArray());
      // Cards: triangles joined by shared vertices.
      const parent = new Int32Array(pos.getCount()).map((_, i) => i);
      const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      for (let i = 0; i < a.length; i += 3) {
        const r = find(a[i]);
        parent[find(a[i + 1])] = r;
        parent[find(a[i + 2])] = r;
      }
      const cards = new Map();
      for (let i = 0; i < a.length; i += 3) {
        const c = find(a[i]);
        if (!cards.has(c)) cards.set(c, []);
        cards.get(c).push(a[i], a[i + 1], a[i + 2]);
      }
      const grow = Math.min(1.5, 1 / Math.sqrt(keep));
      const out = [];
      const v = [];
      let n = 0;
      for (const tris of cards.values()) {
        n++;
        // Keep an even spread: a fixed stride with a little hash so it doesn't stripe.
        if (((n * 2654435761) >>> 0) / 4294967296 > keep) continue;
        const verts = [...new Set(tris)];
        const c = [0, 0, 0];
        for (const i of verts) {
          pos.getElement(i, v);
          c[0] += v[0] / verts.length;
          c[1] += v[1] / verts.length;
          c[2] += v[2] / verts.length;
        }
        for (const i of verts) {
          pos.getElement(i, v);
          pos.setElement(i, [c[0] + (v[0] - c[0]) * grow, c[1] + (v[1] - c[1]) * grow, c[2] + (v[2] - c[2]) * grow]);
        }
        out.push(...tris);
      }
      idx.setArray(pos.getCount() > 65535 ? new Uint32Array(out) : new Uint16Array(out));
    }
  }
}

const quantizeMeshes = () => quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 });

async function build(src, out, { clips = null, smooth = false, compress = false, quantize = true, detail = null, cards = 1 } = {}) {
  const doc = await io.read(path.join(SRC, src));
  if (clips) keepClips(doc, clips);
  if (smooth) smoothNormals(doc);
  if (detail) simplifyByMaterial(doc, detail);
  if (cards < 1) thinCards(doc, cards);
  swapTextures(doc);
  const steps = [resample(), prune(), dedup()];
  // Packed vertex data (KHR_mesh_quantization) but no meshopt compression: decoding that needs
  // WebAssembly, which the artifact page's security policy may refuse.
  if (compress && quantize) steps.push(quantizeMeshes());
  await doc.transform(...steps);
  const dest = path.join(OUT, out);
  mkdirSync(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  console.log(`${out} ${(statSync(dest).size / 1024).toFixed(0)} KB`);
}

if (want('dinos')) for (const k of ['trex', 'raptor', 'triceratops']) await build(`models/${k}.glb`, `dinos/${k}.glb`, { clips: DINO_CLIPS, smooth: true });

const TROOPS = { 'umm/Adventurer.gltf': 'ranger_m', 'umw/Adventurer.gltf': 'ranger_f', 'umm/Swat.gltf': 'heavy' };
/**
 * Guests. Every model in a pack moves with the same clips, so only the first of each pack (guest_m1,
 * guest_f1) keeps them and the game lends them to the rest. Guests are small on screen and a park holds
 * dozens, so their meshes keep about a third of the triangles.
 */
const GUESTS = {
  'umm/Casual_2.gltf': 'guest_m1', 'umm/Casual_Hoodie.gltf': 'guest_m2', 'umm/Beach.gltf': 'guest_m3',
  'umw/Casual.gltf': 'guest_f1', 'umw/Punk.gltf': 'guest_f3', 'umw/Suit.gltf': 'guest_f4',
};
// Sloppy: the models are flat shaded, so every edge is a seam and the careful mode can't remove anything.
// Hair is the busiest part and the least missed at this size.
const GUEST_DETAIL = [
  [/Hair/, 0.25, 0.3, true],
  [/./, 0.3, 0.1, true],
];
if (want('people')) {
  for (const [src, out] of Object.entries(TROOPS)) await build(src, `people/${out}.glb`, { clips: TROOP_CLIPS, compress: true });
  for (const [src, out] of Object.entries(GUESTS)) {
    const donor = out === 'guest_m1' || out === 'guest_f1';
    await build(src, `people/${out}.glb`, { clips: donor ? GUEST_CLIPS : [], compress: true, detail: GUEST_DETAIL });
  }
}

const NATURE = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_2', 'Pine_3', 'TwistedTree_1', 'TwistedTree_3', 'DeadTree_1',
  'Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Plant_1_Big', 'Plant_7_Big', 'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall',
  'Flower_3_Group', 'Flower_4_Group', 'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_2', 'Clover_1', 'Mushroom_Common'];
// Separate .gltf files so trees and plants share one copy of each texture.
if (want('nature')) for (const n of NATURE) await build(`nature/${n}.gltf`, `nature/${n}.gltf`, { compress: true, detail: NATURE_DETAIL, cards: 0.45 });

