import { describe, expect, it } from 'vitest';
import { boxBlur } from '../src/render3d/terrain';

/** The blur as it was first written: every pixel of the image, edges clamped. */
function reference(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  const at = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += a[y * w + at(x + k, w - 1)];
        b[y * w + x] = acc / (2 * r + 1);
      }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += a[at(y + k, h - 1) * w + x];
        b[y * w + x] = acc / (2 * r + 1);
      }
    [a, b] = [b, a];
  }
  return a;
}

describe('ground blur', () => {
  it('blurs only around what is there, and matches blurring the whole image', () => {
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const w = 61;
    const h = 37;
    // Sparse spots, one touching each edge, a block in the middle, and an empty image.
    const cases: [number, number][][] = [
      [[5, 7], [30, 20]],
      [[0, 0], [60, 36], [0, 36], [60, 0]],
      Array.from({ length: 40 }, () => [Math.floor(rand() * w), Math.floor(rand() * h)] as [number, number]),
      [],
    ];
    for (const spots of cases) {
      for (const [r, passes] of [[1, 1], [1, 2], [3, 3], [5, 3]]) {
        const src = new Float32Array(w * h);
        for (const [x, y] of spots) src[y * w + x] = 0.25 + rand() * 0.75;
        const want = reference(src, w, h, r, passes);
        const got = boxBlur(Float32Array.from(src), w, h, r, passes);
        for (let i = 0; i < w * h; i++) expect(got[i]).toBeCloseTo(want[i], 5);
      }
    }
  });
});
