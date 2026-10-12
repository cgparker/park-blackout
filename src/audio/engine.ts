// The Patrol 4x4's engine, made here from pulses and noise, with no recording behind it: a diesel's knock a little
// above idle. One second of it loops without a seam, and the game plays it faster as the 4x4 speeds up
// (AUDIO.engine). The numbers below shape the sound, like a shader's constants, so they stay with the code.

/** Firings in the one-second loop: a four-cylinder diesel at about 1200 rpm. */
const FIRINGS = 40;
/** Each cylinder fires a little differently, which gives the engine its lope. */
const CYLINDERS = [1, 0.74, 0.9, 0.66];
/** Each firing is a sharp crack of noise that dies away this fast (s)... */
const CRACK_DECAY = 0.0025;
/** ...rung through the block and the exhaust: resonances at these pitches (Hz), with this sharpness (Q). */
const BODY: readonly (readonly [number, number, number])[] = [
  // [Hz, Q, level]
  [190, 3, 1],
  [520, 4, 0.7],
  [1250, 3, 0.25],
];
/** A low hum at the firing rate and half of it, for headphones. Phone speakers don't reach it. */
const HUM = 0.12;
const HALF_HUM = 0.06;

/** A band-pass filter (Audio EQ Cookbook) run twice round the loop: once to settle, once to write. */
function ring(x: Float32Array, rate: number, hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y;
      if (pass === 1) out[i] = y;
    }
  }
  return out;
}

/** One second of engine at `rate` samples per second, peaking at 0.9. */
export function engineLoop(rate: number): Float32Array {
  const n = Math.round(rate);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  // The firings. Each tail wraps round to the start, so the end leads into it.
  const raw = new Float32Array(n);
  const tail = Math.round(rate * 0.02);
  for (let k = 0; k < FIRINGS; k++) {
    const start = Math.round((k * n) / FIRINGS);
    const amp = CYLINDERS[k % CYLINDERS.length] * (0.85 + 0.3 * rand());
    for (let i = 0; i < tail; i++) {
      const j = (start + i) % n;
      raw[j] += amp * (rand() * 2 - 1) * Math.exp(-i / rate / CRACK_DECAY);
    }
  }

  const out = new Float32Array(n);
  for (const [hz, q, level] of BODY) {
    const r = ring(raw, rate, hz, q);
    for (let i = 0; i < n; i++) out[i] += level * r[i];
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) {
    const p = (2 * Math.PI * i) / n;
    out[i] = out[i] / peak + HUM * Math.sin(FIRINGS * p) + HALF_HUM * Math.sin((FIRINGS / 2) * p);
  }

  peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return out;
}
