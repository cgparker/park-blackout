// Turns the artifact build of the 3D slice (npm run build:3d-artifact) into an artifact page plus
// the list of files it needs.
// - The artifact host supplies <!doctype>, <html>, <head>, and <body>, so the page keeps only the
//   title, its stylesheet and scripts, and the markup.
// - The host serves no binary files, so every model becomes a GLB in base64 text (`.glb.txt`):
//   .glb files as they are, and each .gltf packed with its .bin. Textures stay separate images.
// - Only what the slice loads is listed: no guests, no stills.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist-slice-artifact';
const html = readFileSync(`${DIST}/slice.html`, 'utf8');
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`Could not find ${what} in ${DIST}/slice.html`);
  return m;
};
const title = pick(/<title>[\s\S]*?<\/title>/, 'the title')[0];
const head = pick(/<head>([\s\S]*?)<\/head>/, 'the head')[1];
const links = head.match(/<link [^>]*>/g) ?? [];
const scripts = head.match(/<script [^>]*><\/script>/g) ?? [];
const body = pick(/<body>([\s\S]*?)<\/body>/, 'the body')[1].trim();
const page = [title, ...links, body, ...scripts].join('\n') + '\n';
writeFileSync(`${DIST}/park-blackout-3d.html`, page);

/** A .gltf and its one .bin as a GLB, images left as files beside it. */
function packGlb(gltfPath) {
  const json = JSON.parse(readFileSync(gltfPath, 'utf8'));
  if (json.buffers?.length !== 1) throw new Error(`${gltfPath}: expected one buffer`);
  const bin = readFileSync(path.join(path.dirname(gltfPath), json.buffers[0].uri));
  delete json.buffers[0].uri;
  json.buffers[0].byteLength = bin.length;
  const pad = (n) => (4 - (n % 4)) % 4;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc(pad(text.length), 0x20)]);
  const data = Buffer.concat([bin, Buffer.alloc(pad(bin.length), 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + data.length, 8);
  const chunk = (buf, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(buf.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, buf]);
  };
  return Buffer.concat([header, chunk(text, 0x4e4f534a), chunk(data, 0x004e4942)]);
}

const files = {};
const add = (rel) => {
  files[rel] = path.join(DIST, rel);
};
for (const tag of [...links, ...scripts]) {
  const m = tag.match(/(?:href|src)="\.\/([^"]+)"/);
  if (m) add(m[1]);
}
const asText = (rel, bytes) => {
  writeFileSync(path.join(DIST, `${rel}.txt`), bytes.toString('base64'));
  add(`${rel}.txt`);
};
for (const f of readdirSync(`${DIST}/dinos`)) if (f.endsWith('.glb')) asText(`dinos/${f}`, readFileSync(`${DIST}/dinos/${f}`));
for (const f of ['ranger_m.glb', 'ranger_f.glb', 'heavy.glb']) asText(`people/${f}`, readFileSync(`${DIST}/people/${f}`));
for (const f of readdirSync(`${DIST}/nature`)) {
  if (f.endsWith('.gltf')) asText(`nature/${f.replace(/\.gltf$/, '.glb')}`, packGlb(`${DIST}/nature/${f}`));
  else if (/\.(png|jpg)$/.test(f)) add(`nature/${f}`);
}
for (const f of readdirSync(`${DIST}/terrain`)) add(`terrain/${f}`);

let bytes = 0;
for (const src of Object.values(files)) bytes += statSync(src).size;
writeFileSync(`${DIST}/artifact-files.json`, JSON.stringify(files, null, 2));
console.log(`${DIST}/park-blackout-3d.html (${(page.length / 1024).toFixed(1)} KB), ${Object.keys(files).length} files, ${(bytes / 1048576).toFixed(1)} MB`);
