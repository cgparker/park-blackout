// Turns the single-file build into an artifact page: the artifact host supplies
// <!doctype>, <html>, <head>, and <body>, so the page is just title, style,
// markup, and script.
// Usage: npm run build:artifact
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`Could not find ${what} in dist-single/index.html`);
  return m;
};

const title = pick(/<title>[\s\S]*?<\/title>/, 'the title')[0];
const styles = html.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? [];
const scripts = (html.match(/<script type="module"[^>]*>[\s\S]*?<\/script>/g) ?? []).map((s) =>
  s.replace(/^<script[^>]*>/, '<script type="module">'),
);
const body = pick(/<body>([\s\S]*?)<\/body>/, 'the body')[1].replace(/<script[^>]*src=[^>]*><\/script>/g, '').trim();

if (!scripts.length) throw new Error('No inline script found. Run npm run build:single first.');

const page = [title, ...styles, body, ...scripts].join('\n') + '\n';
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/park-blackout.html', page);
console.log(`dist-artifact/park-blackout.html (${(page.length / 1024).toFixed(0)} KB)`);
