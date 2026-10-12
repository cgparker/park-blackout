// Loads the CC0 models and turns them into templates: dinosaur skins, troop kit, guests, nature parts.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimalKind } from '../config';
import { natureParts, type DecorKind, type NaturePart } from './decor';
import { addRim, skinMaterial, TEX, type Mats, type Rim } from './materials';
import { loadTerrainTextures, type TerrainTextures } from './terrain';
import { Batch, col, hdr } from './util';

THREE.Cache.enabled = true;

export interface DinoTemplate {
  gltf: GLTF;
  /** Materials by source material name: penned look, and loose-at-night look with a warm threat edge. */
  mats: Record<string, THREE.Material>;
  looseMats: Record<string, THREE.Material>;
  eye: { local: THREE.Vector3[]; radius: number } | null;
}

export interface PersonTemplate {
  gltf: GLTF;
  clips: Map<string, THREE.AnimationClip>;
}

export interface Assets {
  dinos: Record<AnimalKind, DinoTemplate>;
  light: PersonTemplate[];
  heavy: PersonTemplate;
  /** Level 4's Engineer. */
  engineer: PersonTemplate[];
  guests: PersonTemplate[];
  nature: Partial<Record<DecorKind, NaturePart[][]>>;
  terrain: TerrainTextures;
}

const DINO_SCALE = 0.075;
export const SCALE = { dino: DINO_SCALE, light: 0.3, heavy: 0.38, guest: 0.26, engineer: 0.3 };

/** The models use packed vertices (KHR_mesh_quantization), which needs no decoder. */
function loader(): GLTFLoader {
  return new GLTFLoader();
}

/**
 * Loads a model. The artifact build publishes each one as a GLB in base64 text (`.glb.txt`), since
 * the artifact host serves no binary files; textures stay separate images beside it.
 */
async function fetchModel(l: GLTFLoader, base: string, path: string): Promise<GLTF> {
  if (typeof __MODELS_AS_TEXT__ === 'undefined' || !__MODELS_AS_TEXT__) return l.loadAsync(`${base}/${path}`);
  const url = `${base}/${path.replace(/\.gltf$/, '.glb')}.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const text = (await res.text()).replace(/\s+/g, '');
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return l.parseAsync(bytes.buffer, url.slice(0, url.lastIndexOf('/') + 1));
}

// Kit and eyes are placed in the model's rest pose, in its own space (metres for people). The files are
// packed (quantized), and each packed mesh keeps its own scale in its bind matrices, so raw vertex
// positions can't be mixed between meshes. Skinning every vertex once into the rest pose sidesteps that.
const restCache = new WeakMap<THREE.SkinnedMesh, Float32Array>();

/** Rest-pose positions of a skinned mesh's vertices in model space. The model root must be at identity with world matrices updated. */
function restPositions(mesh: THREE.SkinnedMesh): Float32Array {
  const cached = restCache.get(mesh);
  if (cached) return cached;
  const pos = mesh.geometry.attributes.position;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  restCache.set(mesh, out);
  return out;
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
  });
  return found;
}

/** Rest-pose bounds, in model space, of the vertices that mostly follow one bone. */
function boneBox(meshes: THREE.SkinnedMesh[], bone: string, minWeight = 0.5): THREE.Box3 {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const mesh of meshes) {
    const bi = mesh.skeleton.bones.findIndex((b) => b.name === bone);
    if (bi < 0) continue;
    const rest = restPositions(mesh);
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < si.count; i++) {
      for (let k = 0; k < 4; k++) {
        if (si.getComponent(i, k) === bi && sw.getComponent(i, k) >= minWeight) {
          box.expandByPoint(p.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]));
          break;
        }
      }
    }
  }
  return box;
}

function skinned(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverseVisible((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
}

/** Rest-pose positions (model space) of the vertices that mostly follow one bone. */
function boneVerts(meshes: THREE.SkinnedMesh[], bone: string, minWeight = 0.5): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    const bi = mesh.skeleton.bones.findIndex((b) => b.name === bone);
    if (bi < 0) continue;
    const rest = restPositions(mesh);
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < si.count; i++)
      for (let k = 0; k < 4; k++)
        if (si.getComponent(i, k) === bi && sw.getComponent(i, k) >= minWeight) {
          out.push(new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]));
          break;
        }
  }
  return out;
}

function bonePos(root: THREE.Object3D, name: string): THREE.Vector3 | null {
  const b = findBone(root, name);
  return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null;
}

/** How far a limb's surface sits from the line a to b: a high percentile of its vertices' distances. */
function limbRadius(verts: THREE.Vector3[], a: THREE.Vector3, b: THREE.Vector3, q = 0.85): number {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const d: number[] = [];
  const p = new THREE.Vector3();
  for (const v of verts) {
    const t = p.copy(v).sub(a).dot(ab) / len2;
    if (t < 0.08 || t > 0.92) continue;
    d.push(p.copy(a).addScaledVector(ab, t).distanceTo(v));
  }
  if (!d.length) return 0.05;
  d.sort((x, y) => x - y);
  return d[Math.min(d.length - 1, Math.floor(q * d.length))];
}

interface ShellOptions {
  /** Squash across the shell: x is to the side, z is toward the front. */
  sx?: number;
  sz?: number;
  seg?: number;
  /** Part of the way round, for plates that only cover the front. 0 is the front. */
  phiStart?: number;
  phiLength?: number;
}

/**
 * A smooth shell around the line from a to b, turned on a lathe. Profile points are
 * [t, r]: t runs from 0 at a to 1 at b, r is the radius there. The shell's front faces +z (the model's front).
 */
function shellGeo(a: THREE.Vector3, b: THREE.Vector3, profile: [number, number][], o: ShellOptions = {}): THREE.BufferGeometry {
  const axis = b.clone().sub(a);
  const len = axis.length();
  const Y = axis.normalize();
  const front = new THREE.Vector3(0, 0, 1);
  if (Math.abs(front.dot(Y)) > 0.95) front.set(0, 1, 0);
  const Z = front.sub(Y.clone().multiplyScalar(front.dot(Y))).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  const pts = profile.map(([t, r]) => new THREE.Vector2(Math.max(r, 0.0005), t * len));
  const phiLength = o.phiLength ?? Math.PI * 2;
  const geo = new THREE.LatheGeometry(pts, o.seg ?? 18, (o.phiStart ?? 0) - phiLength / 2, phiLength);
  geo.scale(o.sx ?? 1, 1, o.sz ?? 1);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a));
  return geo;
}

/**
 * Rigid gear (armour, caps, guns). Each piece is built in rest-pose model space and rides one bone.
 * At the end the pieces are skinned to their bones and merged, a few draw calls for the whole kit.
 */
class Kit {
  readonly pieces: { bone: string; geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  add(bone: string, geo: THREE.BufferGeometry, mat: THREE.Material): void {
    this.pieces.push({ bone, geo, mat });
  }
}

/**
 * One skinned mesh per character instead of one per material, coloured per vertex: a person is one
 * draw call. Every part moves into the first part's packed space (each packed part keeps its own
 * scale in its bind matrices), which stays exact in every pose. Returns null if a part has a texture.
 */
/**
 * Merges a character's skinned parts into one skinned mesh with vertex colours: one draw call. With
 * `slotOf`, each vertex also remembers which kind of part it came from (skin, hair, top...), by material
 * name, so a copy can be recoloured.
 */
function mergePerson(root: THREE.Object3D, rim: Rim, roughness: number, slotOf?: (material: string) => number): THREE.SkinnedMesh | null {
  root.updateMatrixWorld(true);
  const parts = skinned(root);
  if (!parts.length) return null;
  for (const m of parts) if ((Array.isArray(m.material) ? m.material : [m.material]).some((mm) => (mm as THREE.MeshStandardMaterial).map)) return null;
  const ref = parts[0];
  const parent = ref.parent ?? root;
  const bones = ref.skeleton.bones;
  const refInv = ref.skeleton.boneInverses;
  let count = 0;
  let icount = 0;
  for (const m of parts) {
    count += m.geometry.attributes.position.count;
    icount += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const rgb = new Float32Array(count * 3);
  const slots = new Uint8Array(count);
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  const index = new Uint32Array(icount);
  const v = new THREE.Vector3();
  const K = new THREE.Matrix4();
  let vb = 0;
  let ib = 0;
  for (const m of parts) {
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    const map = m.skeleton.bones.map((b) => {
      const i = bones.indexOf(b);
      return i >= 0 ? i : bones.findIndex((x) => x.name === b.name);
    });
    if (map.some((i) => i < 0)) return null;
    // This part's packed space to the first part's, through any shared bone.
    K.copy(refInv[map[0]]).multiply(ref.bindMatrix).invert().multiply(m.skeleton.boneInverses[0].clone().multiply(m.bindMatrix));
    const g = m.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const SI = g.attributes.skinIndex;
    const SW = g.attributes.skinWeight;
    const src = g.index ? g.index.array : null;
    const matOf = new Uint8Array(P.count);
    for (const gr of g.groups) for (let k = gr.start; k < gr.start + gr.count; k++) matOf[src ? src[k] : k] = gr.materialIndex ?? 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(K);
      pos[(vb + i) * 3] = v.x;
      pos[(vb + i) * 3 + 1] = v.y;
      pos[(vb + i) * 3 + 2] = v.z;
      if (N) {
        v.fromBufferAttribute(N, i).transformDirection(K);
        nor[(vb + i) * 3] = v.x;
        nor[(vb + i) * 3 + 1] = v.y;
        nor[(vb + i) * 3 + 2] = v.z;
      }
      const mm = mats[matOf[i]] ?? mats[0];
      const c = mm.color;
      if (slotOf) slots[vb + i] = slotOf(mm.name);
      rgb[(vb + i) * 3] = c.r;
      rgb[(vb + i) * 3 + 1] = c.g;
      rgb[(vb + i) * 3 + 2] = c.b;
      for (let k = 0; k < 4; k++) {
        si[(vb + i) * 4 + k] = map[SI.getComponent(i, k)] ?? 0;
        sw[(vb + i) * 4 + k] = SW.getComponent(i, k);
      }
    }
    const n = src ? src.length : P.count;
    for (let k = 0; k < n; k++) index[ib + k] = vb + (src ? src[k] : k);
    ib += n;
    vb += P.count;
  }
  for (const m of parts) m.removeFromParent();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if (slotOf) geo.userData.slots = slots;
  const mat = addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, envMapIntensity: 0.55 }), rim);
  const body = new THREE.SkinnedMesh(geo, mat);
  body.name = 'Body';
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  parent.add(body);
  body.bind(new THREE.Skeleton(bones, refInv.map((x) => x.clone())), ref.bindMatrix.clone());
  return body;
}

/** Gear that glows (visors, power cells, coils) and its colour, brighter than white for the bloom. */
function glowColor(m: THREE.Material): THREE.Color | null {
  if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) return (m as THREE.MeshBasicMaterial).color.clone();
  const s = m as THREE.MeshStandardMaterial;
  const lit = s.emissive ? s.emissive.r + s.emissive.g + s.emissive.b : 0;
  if (lit > 0.05 && s.emissiveIntensity >= 0.9) return s.emissive.clone().multiplyScalar(1.8);
  return null;
}

/** Skins the kit's pieces to the body's skeleton: plates (panel texture), plain parts, and glowing parts. */
function finishKit(body: THREE.SkinnedMesh, kit: Kit, rim: Rim): void {
  const bones = body.skeleton.bones;
  const inv = body.skeleton.boneInverses;
  const groups: Record<'plate' | 'plain' | 'glow', THREE.BufferGeometry[]> = { plate: [], plain: [], glow: [] };
  const M = new THREE.Matrix4();
  for (const p of kit.pieces) {
    const bi = bones.findIndex((b) => b.name === p.bone);
    if (bi < 0) continue;
    // Rest-pose model space to the body's bind space for this bone.
    M.copy(inv[bi]).multiply(body.bindMatrix).invert().multiply(bones[bi].matrixWorld.clone().invert());
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(M);
    const n = g.attributes.position.count;
    const glow = glowColor(p.mat);
    const c = glow ?? (p.mat as THREE.MeshStandardMaterial).color;
    const rgb = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = c.r;
      rgb[i * 3 + 1] = c.g;
      rgb[i * 3 + 2] = c.b;
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    groups[glow ? 'glow' : (p.mat as THREE.MeshStandardMaterial).map ? 'plate' : 'plain'].push(g);
    p.geo.dispose();
  }
  const mats = {
    plate: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.plate, bumpMap: TEX.plate, bumpScale: 0.8, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.6 }), rim),
    plain: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.6 }), rim),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  for (const key of ['plate', 'plain', 'glow'] as const) {
    if (!groups[key].length) continue;
    const merged = mergeGeometries(groups[key], false);
    for (const g of groups[key]) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.SkinnedMesh(merged, mats[key]);
    mesh.name = `Kit_${key}`;
    mesh.castShadow = key !== 'glow';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    body.parent!.add(mesh);
    mesh.bind(body.skeleton, body.bindMatrix);
  }
}

/** For gear built in a bone's own frame (guns): moves it into rest-pose model space. */
function fromBone(root: THREE.Object3D, bone: string, geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const b = findBone(root, bone);
  if (b) geo.applyMatrix4(b.matrixWorld);
  return geo;
}

// ------------------------------------------------------------------ dinosaurs

const DINO_LOOK: Record<AnimalKind, Record<string, (rim: Rim | null) => THREE.Material>> = {
  trex: {
    Green: (r) => skinMaterial('#6d6b40', { stripe: 0.5, stripeCol: '#34301c', blotch: 0.3, bump: 0.5 }, r),
    LightGreen: (r) => skinMaterial('#bba67a', { belly: 0.2, blotch: 0.15, bump: 0.4 }, r),
    LightYellow: () => new THREE.MeshStandardMaterial({ color: col('#e8dfc8'), roughness: 0.4 }),
    Red: () => new THREE.MeshStandardMaterial({ color: col('#6e2b2b'), roughness: 0.5 }),
    Black: () => new THREE.MeshStandardMaterial({ color: col('#161412'), roughness: 0.5 }),
  },
  raptor: {
    Brown: (r) => skinMaterial('#7a4e2c', { stripe: 0.8, stripeCol: '#2a1a0e', blotch: 0.25, bump: 0.45, freq: 1.6 }, r),
    LightBrown: (r) => skinMaterial('#b08c62', { belly: 0.2, blotch: 0.12, bump: 0.35, freq: 1.6 }, r),
    Black: () => new THREE.MeshStandardMaterial({ color: col('#151311'), roughness: 0.5 }),
  },
  triceratops: {
    Purple: (r) => skinMaterial('#6b6450', { stripe: 0.25, stripeCol: '#3c372b', blotch: 0.28, bump: 0.55 }, r),
    Brown: () => new THREE.MeshStandardMaterial({ color: col('#d8ccb0'), roughness: 0.45 }),
    LightBrown: (r) => skinMaterial('#a59572', { belly: 0.2, blotch: 0.12, bump: 0.4 }, r),
  },
};

function prepDino(kind: AnimalKind, gltf: GLTF): DinoTemplate {
  // Rims only show at night; setRims() switches them.
  const moon: Rim = { color: '#a8c0ff', power: 2.8, strength: 0.12 };
  const threat: Rim = { color: '#ff6a3d', power: 2.2, strength: 0.9 };
  const mats: Record<string, THREE.Material> = {};
  const looseMats: Record<string, THREE.Material> = {};
  for (const [name, make] of Object.entries(DINO_LOOK[kind])) {
    mats[name] = make(moon);
    looseMats[name] = make(threat);
    mats[name].name = looseMats[name].name = name;
  }
  const meshes = skinned(gltf.scene);
  for (const m of meshes) {
    const src = (m.material as THREE.Material).name;
    if (mats[src]) m.material = mats[src];
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  let eye: DinoTemplate['eye'] = null;
  if (kind !== 'triceratops') {
    // The models have no eyeballs, so place them: a share of the way along the head from the back of
    // the skull and up from the jaw, pressed into the side of the head where the surface actually is.
    gltf.scene.updateMatrixWorld(true);
    const body = meshes.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
    const pts = boneVerts([body], 'Head', 0.5);
    const head = findBone(gltf.scene, 'Head');
    if (head && pts.length) {
      const hb = new THREE.Box3().setFromPoints(pts);
      const s = hb.getSize(new THREE.Vector3());
      const at = kind === 'trex' ? { z: 0.27, y: 0.72 } : { z: 0.3, y: 0.76 };
      const ze = hb.min.z + s.z * at.z;
      const ye = hb.min.y + s.y * at.y;
      const near = pts.filter((p) => Math.abs(p.z - ze) < s.z * 0.09 && Math.abs(p.y - ye) < s.y * 0.16);
      const xs = near.length >= 2 ? near.map((p) => p.x) : [hb.min.x, hb.max.x];
      const r = s.x * (kind === 'trex' ? 0.06 : 0.075);
      const inv = head.matrixWorld.clone().invert();
      const local = [Math.min(...xs) + r * 0.45, Math.max(...xs) - r * 0.45].map((x) => new THREE.Vector3(x, ye, ze).applyMatrix4(inv));
      eye = { local, radius: r / head.matrixWorld.getMaxScaleOnAxis() };
    }
  }
  return { gltf, mats, looseMats, eye };
}

// ------------------------------------------------------------------ troops

const clipMap = (g: GLTF) => new Map(g.animations.map((a) => [a.name, a]));

/** Regular troop: olive fatigues, a team-blue cap, and a slim dart rifle. No armour. */
function prepLight(g: GLTF, M: Mats): PersonTemplate {
  g.scene.updateMatrixWorld(true);
  const rim: Rim = { color: '#b4c8ff', power: 3.5, strength: 0.3 };
  const meshes = skinned(g.scene);
  for (const m of meshes) {
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
      const c = (mm as THREE.MeshStandardMaterial).clone();
      c.roughness = 0.75;
      c.envMapIntensity = 0.5;
      if (/^(LightGreen|White)$/.test(c.name)) c.color.set('#5f6640');
      if (c.name === 'Green') c.color.set('#4a4f2f');
      if (/Brown/.test(c.name)) c.color.multiplyScalar(0.85);
      return addRim(c, rim);
    });
    m.material = list.length === 1 ? list[0] : list;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  const kit = new Kit();
  // Cap on the head: a dome and a brim, team blue.
  const hb = boneBox(meshes, 'Head', 0.6);
  if (!hb.isEmpty()) {
    const s = hb.getSize(new THREE.Vector3());
    const c = hb.getCenter(new THREE.Vector3());
    const r = Math.max(s.x, s.z) * 0.54;
    const dome = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.62, 1);
    dome.translate(c.x, hb.max.y - r * 0.42, c.z - r * 0.04);
    kit.add('Head', dome, M.team);
    const brim = new THREE.CylinderGeometry(r * 0.78, r * 0.78, r * 0.06, 18, 1, false, -Math.PI / 2, Math.PI);
    brim.scale(1, 1, 1.15);
    brim.rotateX(0.12);
    brim.translate(c.x, hb.max.y - r * 0.42, c.z + r * 0.62);
    kit.add('Head', brim, M.team);
  }
  rifle(g.scene, M, false, kit);
  const body = mergePerson(g.scene, rim, 0.75);
  if (body) finishKit(body, kit, rim);
  return { gltf: g, clips: clipMap(g) };
}

/**
 * The gun rides the right wrist bone. In this rig the hand points along the bone's +y, and in the aiming
 * clips +y is straight ahead and -x is up, so the gun is built in that frame: forward, up, side.
 * The grip sits where the model's own pistol was, about 14 cm out from the wrist joint.
 */
function rifle(root: THREE.Object3D, M: Mats, heavy: boolean, kit: Kit): void {
  const wrist = findBone(root, 'WristR');
  if (!wrist) return;
  const k = (heavy ? 1.3 : 1) / wrist.matrixWorld.getMaxScaleOnAxis();
  // Gun space (x forward, y up, z side) to wrist space (forward = +y, up = -x, side = +z).
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)).scale(new THREE.Vector3(k, k, k));
  const B = new Batch();
  const part = (geo: THREE.BufferGeometry, f: number, u: number, sd: number, mat: THREE.Material) => {
    geo.translate(f, u, sd);
    B.add(geo, mat);
  };
  const box = (l: number, h: number, w: number, r = 0.008) => new RoundedBoxGeometry(l, h, w, 2, Math.min(r, l / 2, h / 2, w / 2));
  const tube = (r: number, len: number, seg = 12) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
  if (!heavy) {
    // Dart carbine: slim, dark, with an orange tip and a team-blue stock.
    part(box(0.3, 0.06, 0.05), 0.17, 0.03, 0, M.gun);
    part(box(0.045, 0.09, 0.034).rotateZ(-0.25), 0.13, -0.03, 0, M.gun);
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 10), 0.23, -0.035, 0, M.darkSteel);
    part(box(0.16, 0.046, 0.046), 0.39, 0.035, 0, M.darkSteel);
    part(tube(0.012, 0.3), 0.6, 0.04, 0, M.gun);
    part(tube(0.016, 0.03), 0.76, 0.04, 0, M.orange);
    part(tube(0.016, 0.12), 0.18, 0.085, 0, M.darkSteel);
    part(box(0.2, 0.065, 0.042, 0.015), -0.07, 0.02, 0, M.gunTeam);
  } else {
    // The big gun: a heavy dart cannon, white with blue trim, glowing coils, and a drum of darts.
    part(box(0.56, 0.17, 0.15, 0.035), 0.12, 0.07, 0, M.whitePlate);
    part(box(0.18, 0.13, 0.13, 0.03), -0.24, 0.06, 0, M.gun);
    part(tube(0.05, 0.58, 16), 0.66, 0.08, 0, M.gun);
    for (let i = 0; i < 4; i++) part(tube(0.066, 0.032, 16), 0.46 + i * 0.085, 0.08, 0, i % 2 ? M.darkSteel : M.wireLive);
    part(tube(0.062, 0.07, 16), 0.97, 0.08, 0, M.orange);
    part(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 20).rotateX(Math.PI / 2), 0.12, -0.07, 0, M.gun);
    part(box(0.05, 0.1, 0.04), 0.14, -0.02, 0, M.gun);
    part(box(0.32, 0.04, 0.05, 0.012), 0.12, 0.18, 0, M.teamPlate);
    part(box(0.08, 0.05, 0.16, 0.012), 0.36, 0.06, 0, M.teamPlate);
  }
  const merged = new THREE.Group();
  B.flush(merged);
  for (const c of merged.children) {
    const m = c as THREE.Mesh;
    kit.add('WristR', fromBone(root, 'WristR', m.geometry.applyMatrix4(basis)), m.material as THREE.Material);
  }
}

/**
 * Heavy Team: a full suit of power armour over the rig. Smooth plates follow each bone (thighs, shins,
 * arms, chest), with a helmet with a glowing visor band, a power pack, and the big dart cannon.
 * Mostly white, with team-blue accents (knees, chest plate, crest) and a dark undersuit.
 */
function prepHeavy(g: GLTF, M: Mats): PersonTemplate {
  g.scene.updateMatrixWorld(true);
  const rim: Rim = { color: '#b4c8ff', power: 3.5, strength: 0.3 };
  g.scene.traverse((o) => {
    if (/Pistol/.test(o.name)) o.visible = false;
  });
  const meshes = skinned(g.scene);
  for (const m of meshes) {
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
      const c = (mm as THREE.MeshStandardMaterial).clone();
      c.envMapIntensity = 0.6;
      if (c.name === 'Swat' || c.name === 'Grey') c.color.set('#1b2433');
      if (c.name === 'Swat_Black' || c.name === 'Black') c.color.set('#121417');
      return addRim(c, rim);
    });
    m.material = list.length === 1 ? list[0] : list;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  const blue = addRim(M.teamPlate.clone(), rim);
  const white = addRim(M.whitePlate.clone(), rim);
  const dark = addRim(M.greyPlate.clone(), rim);
  dark.color.set('#323a46');
  const visorMat = new THREE.MeshBasicMaterial({ color: hdr('#47d7ff', 2.2) });
  const P = (n: string) => bonePos(g.scene, n);
  const kit = new Kit();
  const put = (bone: string, geo: THREE.BufferGeometry, mat: THREE.Material) => kit.add(bone, geo, mat);

  // Legs: thigh plates, knee guards, shin guards, boots.
  for (const side of ['L', 'R']) {
    const hip = P(`UpperLeg${side}`);
    const knee = P(`LowerLeg${side}`);
    const foot = P(`Foot${side}`);
    if (!hip || !knee || !foot) continue;
    const ankle = foot.clone().add(new THREE.Vector3(0, 0.09, 0));
    const rT = limbRadius(boneVerts(meshes, `UpperLeg${side}`), hip, knee);
    const rS = limbRadius(boneVerts(meshes, `LowerLeg${side}`), knee, ankle);
    put(`UpperLeg${side}`, shellGeo(hip, knee, [[-0.04, rT * 0.6], [0.02, rT * 1.36], [0.45, rT * 1.42], [0.86, rT * 1.24], [0.95, rT * 0.85]]), white);
    put(`LowerLeg${side}`, shellGeo(knee, ankle, [[0.04, rS * 1.0], [0.12, rS * 1.32], [0.6, rS * 1.36], [0.92, rS * 1.5], [1.0, rS * 1.1]]), dark);
    put(`LowerLeg${side}`, shellGeo(knee, ankle, [[0.1, rS * 1.4], [0.55, rS * 1.46], [0.85, rS * 1.54]], { phiLength: Math.PI * 0.8, seg: 10 }), white);
    const kneePad = new THREE.SphereGeometry(rS * 1.2, 14, 10);
    kneePad.scale(1, 1.15, 0.75);
    const kdir = knee.clone().sub(hip).normalize();
    const kfront = new THREE.Vector3(0, 0, 1).addScaledVector(kdir, -kdir.z).normalize();
    kneePad.translate(knee.x + kfront.x * rS * 0.9, knee.y + kfront.y * rS * 0.9, knee.z + kfront.z * rS * 0.9);
    put(`LowerLeg${side}`, kneePad, blue);
    const fb = boneBox(meshes, `Foot${side}`, 0.5);
    if (!fb.isEmpty()) {
      const fs = fb.getSize(new THREE.Vector3());
      const fc = fb.getCenter(new THREE.Vector3());
      const boot = new RoundedBoxGeometry(fs.x * 1.3, fs.y * 1.35, fs.z * 1.15, 3, Math.min(0.03, fs.y * 0.4));
      boot.translate(fc.x, fc.y + fs.y * 0.1, fc.z + fs.z * 0.03);
      put(`Foot${side}`, boot, dark);
    }
  }

  // Torso: a sculpted breastplate, a waist band, and a hip guard.
  const hips = P('Hips');
  const abd = P('Abdomen');
  const neck = P('Neck');
  const cb = boneBox(meshes, 'Chest', 0.5).union(boneBox(meshes, 'Torso', 0.5));
  if (hips && abd && neck && !cb.isEmpty()) {
    const cs = cb.getSize(new THREE.Vector3());
    const hx = cs.x * 0.5;
    const hz = cs.z * 0.5;
    put('Chest', shellGeo(abd.clone().add(new THREE.Vector3(0, 0.1, 0)), neck, [[0, 0.82], [0.2, 0.92], [0.5, 1.05], [0.74, 1.08], [0.88, 0.95], [0.97, 0.62], [1.0, 0.3]], { sx: hx * 1.36, sz: hz * 1.55, seg: 24 }), white);
    put('Chest', shellGeo(abd.clone().add(new THREE.Vector3(0, 0.22, 0)), neck, [[0.3, 1.1], [0.6, 1.13], [0.78, 1.12]], { sx: hx * 1.36, sz: hz * 1.55, seg: 12, phiLength: Math.PI * 0.5 }), blue);
    put('Abdomen', shellGeo(abd.clone().add(new THREE.Vector3(0, -0.06, 0)), abd.clone().add(new THREE.Vector3(0, 0.14, 0)), [[0, 0.86], [0.3, 0.92], [0.5, 0.88], [0.7, 0.92], [1, 0.86]], { sx: hx * 1.2, sz: hz * 1.3, seg: 22 }), dark);
    put('Hips', shellGeo(hips.clone().add(new THREE.Vector3(0, 0.08, 0)), hips.clone().add(new THREE.Vector3(0, -0.12, 0)), [[0, 0.98], [0.35, 1.04], [0.8, 0.98], [1, 0.8]], { sx: hx * 1.32, sz: hz * 1.4, seg: 22 }), white);
    // Power pack on the back with two glowing cells.
    const c = cb.getCenter(new THREE.Vector3());
    const pack = new RoundedBoxGeometry(cs.x * 0.85, cs.y * 0.95, cs.z * 0.55, 3, 0.04);
    pack.translate(c.x, c.y + cs.y * 0.05, cb.min.z - cs.z * 0.42);
    put('Chest', pack, dark);
    for (const sd of [-1, 1]) {
      const cell = new THREE.CylinderGeometry(cs.x * 0.08, cs.x * 0.08, cs.y * 0.75, 12);
      cell.translate(c.x + sd * cs.x * 0.22, c.y + cs.y * 0.05, cb.min.z - cs.z * 0.72);
      put('Chest', cell, visorMat);
    }
  }

  // Arms: plated upper arms and flared gauntlets. No shoulder pads.
  for (const side of ['L', 'R']) {
    const sh = P(`UpperArm${side}`);
    const el = P(`LowerArm${side}`);
    const wr = P(`Wrist${side}`);
    if (!sh || !el || !wr) continue;
    const rU = limbRadius(boneVerts(meshes, `UpperArm${side}`), sh, el);
    const rF = limbRadius(boneVerts(meshes, `LowerArm${side}`), el, wr);
    put(`UpperArm${side}`, shellGeo(sh, el, [[0.0, rU * 1.0], [0.1, rU * 1.32], [0.6, rU * 1.36], [0.95, rU * 1.15]]), white);
    put(`LowerArm${side}`, shellGeo(el, wr, [[-0.04, rF * 0.8], [0.06, rF * 1.3], [0.6, rF * 1.5], [0.93, rF * 1.68], [1.0, rF * 1.25]]), white);
    const elbow = new THREE.SphereGeometry(rF * 1.05, 12, 8);
    elbow.translate(el.x, el.y, el.z);
    put(`LowerArm${side}`, elbow, dark);
  }

  // Helmet: rounded white shell, a blue crest, and a glowing band across the eyes.
  const hb = boneBox(meshes, 'Head', 0.6);
  if (!hb.isEmpty()) {
    const s = hb.getSize(new THREE.Vector3());
    const c = hb.getCenter(new THREE.Vector3());
    const helm = new THREE.SphereGeometry(1, 28, 20);
    helm.scale(s.x * 0.72, s.y * 0.68, s.z * 0.78);
    helm.translate(c.x, c.y + s.y * 0.05, c.z - s.z * 0.02);
    put('Head', helm, white);
    const crest = new RoundedBoxGeometry(s.x * 0.16, s.y * 0.16, s.z * 1.1, 2, 0.01);
    crest.translate(c.x, c.y + s.y * 0.66, c.z - s.z * 0.05);
    put('Head', crest, blue);
    const band = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, -Math.PI * 0.32, Math.PI * 0.64);
    band.scale(s.x * 0.72, s.y * 0.13, s.z * 0.8);
    band.translate(c.x, c.y + s.y * 0.1, c.z - s.z * 0.01);
    put('Head', band, visorMat);
    const jaw = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4);
    jaw.scale(s.x * 0.6, s.y * 0.62, s.z * 0.7);
    jaw.translate(c.x, c.y + s.y * 0.02, c.z + s.z * 0.04);
    put('Head', jaw, dark);
  }
  rifle(g.scene, M, true, kit);
  const body = mergePerson(g.scene, rim, 0.6);
  if (body) finishKit(body, kit, rim);
  return { gltf: g, clips: clipMap(g) };
}

/**
 * Level 4's Engineer: the pack's park worker, recoloured to a safety-yellow hard hat and an orange high-visibility
 * vest with two reflective bands, carrying a red toolbox in its left hand instead of a gun.
 */
function prepEngineer(g: GLTF, M: Mats): PersonTemplate {
  g.scene.updateMatrixWorld(true);
  const rim: Rim = { color: '#b4c8ff', power: 3.5, strength: 0.3 };
  const meshes = skinned(g.scene);
  for (const m of meshes) {
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
      const c = (mm as THREE.MeshStandardMaterial).clone();
      c.roughness = 0.7;
      c.envMapIntensity = 0.5;
      if (c.name === 'Worker_Yellow') c.color.set('#f2c21b');
      if (c.name === 'Worker_Vest') c.color.set('#ff6f12');
      return addRim(c, rim);
    });
    m.material = list.length === 1 ? list[0] : list;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  const kit = new Kit();
  // Two reflective bands around the vest.
  const abd = bonePos(g.scene, 'Abdomen');
  const neck = bonePos(g.scene, 'Neck');
  const cb = boneBox(meshes, 'Chest', 0.5).union(boneBox(meshes, 'Torso', 0.5));
  if (abd && neck && !cb.isEmpty()) {
    const cs = cb.getSize(new THREE.Vector3());
    for (const t of [0.28, 0.62]) {
      const a = abd.clone().lerp(neck, t);
      const b = abd.clone().lerp(neck, t + 0.07);
      kit.add('Chest', shellGeo(a, b, [[0, 1], [1, 1]], { sx: cs.x * 0.56, sz: cs.z * 0.62, seg: 22 }), M.reflective);
    }
  }
  toolbox(g.scene, M, kit);
  const body = mergePerson(g.scene, rim, 0.7);
  if (body) finishKit(body, kit, rim);
  return { gltf: g, clips: clipMap(g) };
}

/** A red toolbox with a steel lid seam and handle, hanging from the left hand. Built in the wrist's frame, where +y runs down the hand. */
function toolbox(root: THREE.Object3D, M: Mats, kit: Kit): void {
  const wrist = findBone(root, 'WristL');
  if (!wrist) return;
  const k = 1 / wrist.matrixWorld.getMaxScaleOnAxis();
  const scale = new THREE.Matrix4().makeScale(k, k, k);
  const B = new Batch();
  const box = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  B.add(box(0.12, 0.14, 0.3, 0.014), M.toolbox, B.at(0, 0.24, 0));
  B.add(new THREE.BoxGeometry(0.124, 0.012, 0.304), M.steel, B.at(0, 0.19, 0));
  for (const z of [-0.1, 0.1]) B.add(new THREE.BoxGeometry(0.016, 0.06, 0.016), M.darkSteel, B.at(0, 0.14, z));
  B.add(new THREE.BoxGeometry(0.02, 0.018, 0.22), M.darkSteel, B.at(0, 0.11, 0));
  const merged = new THREE.Group();
  B.flush(merged);
  for (const c of merged.children) {
    const m = c as THREE.Mesh;
    kit.add('WristL', fromBone(root, 'WristL', m.geometry.applyMatrix4(scale)), m.material as THREE.Material);
  }
}

/** Which colour a guest's part takes: 0 keeps the model's own, then skin, darker skin, hair, top, and bottom. */
export const GUEST_SLOT = { own: 0, skin: 1, skinDark: 2, hair: 3, top: 4, bottom: 5 } as const;

function guestSlot(name: string): number {
  if (/^Skin/.test(name)) return name === 'Skin_Darker' ? GUEST_SLOT.skinDark : GUEST_SLOT.skin;
  if (/Hair|Eyebrows|Moustache/.test(name)) return GUEST_SLOT.hair;
  if (/Shirt|Purple|^Red$|LimeGreen|Orange|Pink|^White$|LightBlue|^Green$|LightGreen|Main/.test(name)) return GUEST_SLOT.top;
  if (/Pants|LightBrown|^Brown$|Suit|DarkBrown|Red_Dark/.test(name)) return GUEST_SLOT.bottom;
  return GUEST_SLOT.own;
}

/**
 * A park guest: one skinned mesh that each guest recolours (see Actors). Guests cast no shadow of their
 * own (a soft blob stands in), since a park holds dozens. Models without clips borrow their pack's.
 */
function prepGuest(g: GLTF, clips: THREE.AnimationClip[]): PersonTemplate {
  g.scene.traverse((o) => {
    if (/Pistol/.test(o.name)) o.visible = false;
  });
  const body = mergePerson(g.scene, { color: '#b4c8ff', power: 3.5, strength: 0.22 }, 0.8, guestSlot);
  if (body) {
    body.castShadow = false;
    (body.material as THREE.MeshStandardMaterial).envMapIntensity = 0.5;
  }
  if (!g.animations.length) g.animations = clips;
  return { gltf: g, clips: clipMap(g) };
}

/** Level 4 has one Engineer, so one model is enough. */
const ENGINEER_FILES = ['engineer'];

/** Guests: the first of each pack carries the clips for the rest of its pack. */
const GUEST_FILES = { men: ['guest_m1', 'guest_m2', 'guest_m3'], women: ['guest_f1', 'guest_f3', 'guest_f4'] };

// ------------------------------------------------------------------ nature

const NATURE_FILES: Record<DecorKind, { files: string[]; tint: string[] | null }> = {
  tree: { files: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'], tint: ['#55803a', '#4b7536', '#628a3c', '#4e7a2f', '#5b7f33'] },
  pine: { files: ['Pine_1', 'Pine_2', 'Pine_3'], tint: ['#35593a', '#2f5434', '#3c5f35'] },
  twisted: { files: ['TwistedTree_1', 'TwistedTree_3'], tint: ['#3f6b2c', '#4a7330'] },
  log: { files: ['DeadTree_1'], tint: null },
  bush: { files: ['Bush_Common'], tint: ['#4f7a34'] },
  bushFlower: { files: ['Bush_Common_Flowers'], tint: ['#55803a'] },
  hedge: { files: ['Bush_Common'], tint: ['#3f6b2f'] },
  fern: { files: ['Fern_1'], tint: null },
  plant: { files: ['Plant_1_Big'], tint: null },
  plantTall: { files: ['Plant_7_Big'], tint: null },
  flower: { files: ['Flower_3_Group', 'Flower_4_Group'], tint: null },
  grass: { files: ['Grass_Common_Short'], tint: ['#83a24e'] },
  grassTall: { files: ['Grass_Common_Tall'], tint: ['#7f9f50'] },
  wispy: { files: ['Grass_Wispy_Short'], tint: ['#86a050'] },
  reed: { files: ['Grass_Wispy_Tall'], tint: ['#6f8f42'] },
  rock: { files: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'], tint: null },
  pebble: { files: ['Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_2'], tint: null },
  clover: { files: ['Clover_1'], tint: null },
  mushroom: { files: ['Mushroom_Common'], tint: null },
};

export interface LoadOptions {
  base: string;
  guests: boolean;
  onProgress?: (done: number, total: number) => void;
}

export async function loadAssets(M: Mats, o: LoadOptions): Promise<Assets> {
  const l = loader();
  let done = 0;
  const jobs: Promise<unknown>[] = [];
  const track = <T>(p: Promise<T>): Promise<T> => {
    jobs.push(p);
    p.then(() => o.onProgress?.(++done, jobs.length));
    return p;
  };
  const load = (url: string) => track(fetchModel(l, o.base, url));
  const dinoP = Promise.all((['trex', 'raptor', 'triceratops'] as AnimalKind[]).map(async (k) => [k, prepDino(k, await load(`dinos/${k}.glb`))] as const));
  const lightP = Promise.all(['ranger_m', 'ranger_f'].map(async (n) => prepLight(await load(`people/${n}.glb`), M)));
  const heavyP = load('people/heavy.glb').then((g) => prepHeavy(g, M));
  const engineerP = Promise.all(ENGINEER_FILES.map(async (n) => prepEngineer(await load(`people/${n}.glb`), M)));
  const pack = async (names: string[]) => {
    const files = await Promise.all(names.map((n) => load(`people/${n}.glb`)));
    return files.map((g) => prepGuest(g, files[0].animations));
  };
  const guestP = o.guests ? Promise.all([pack(GUEST_FILES.men), pack(GUEST_FILES.women)]).then(([m, f]) => m.flatMap((x, i) => [x, f[i]])) : Promise.resolve([]);
  const natP = Promise.all(
    (Object.entries(NATURE_FILES) as [DecorKind, (typeof NATURE_FILES)[DecorKind]][]).map(async ([kind, spec]) => {
      const variants = await Promise.all(spec.files.map(async (f, i) => natureParts((await load(`nature/${f}.gltf`)).scene, spec.tint ? spec.tint[i % spec.tint.length] : null)));
      return [kind, variants] as const;
    }),
  );
  const terrainP = track(loadTerrainTextures(`${o.base}/terrain`));
  const [dinos, light, heavy, engineer, guests, nat, terrain] = await Promise.all([dinoP, lightP, heavyP, engineerP, guestP, natP, terrainP]);
  return {
    dinos: Object.fromEntries(dinos) as Record<AnimalKind, DinoTemplate>,
    light,
    heavy,
    engineer,
    guests,
    nature: Object.fromEntries(nat),
    terrain,
  };
}
