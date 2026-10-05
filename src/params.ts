import { LEVEL_IDS, type LevelId } from './config';

export interface Params {
  debug: boolean;
  /** Build phase length in seconds, when overridden. */
  buildPhaseSeconds: number | null;
  seed: number | null;
  /** The level the briefing opens on, when set. */
  level: LevelId | null;
}

const asLevel = (raw: string | null): LevelId | null => (LEVEL_IDS.some((l) => String(l) === raw) ? (Number(raw) as LevelId) : null);

/**
 * Reads options from the query string (?debug=1&blackout=180&seed=7&level=2) or, where the
 * query string isn't available (inside a Claude artifact), from the hash: #debug.blackout-180.seed-7.level-2
 */
export function readParams(search: string, hash: string): Params {
  const out: Params = { debug: false, buildPhaseSeconds: null, seed: null, level: null };
  const q = new URLSearchParams(search);
  if (q.has('debug') && q.get('debug') !== '0') out.debug = true;
  const seconds = (raw: string | null) => {
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n >= 10 && n <= 3600 ? Math.round(n) : null;
  };
  out.buildPhaseSeconds = seconds(q.get('blackout'));
  const seed = Number(q.get('seed'));
  if (q.has('seed') && Number.isInteger(seed)) out.seed = seed;
  out.level = asLevel(q.get('level'));

  for (const token of hash.replace(/^#/, '').split('.')) {
    if (token === 'debug') out.debug = true;
    const m = /^(blackout|seed|level)-(\d+)$/.exec(token);
    if (m && m[1] === 'blackout') out.buildPhaseSeconds = seconds(m[2]) ?? out.buildPhaseSeconds;
    if (m && m[1] === 'seed') out.seed = Number(m[2]);
    if (m && m[1] === 'level') out.level = asLevel(m[2]) ?? out.level;
  }
  return out;
}
