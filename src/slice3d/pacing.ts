// Frame pacing for the frame-rate cap. requestAnimationFrame calls back once per screen tick: 60 times a second on
// most phones, 120 or more on some screens, and 30 in iOS Low Power Mode. Under a cap, a tick that comes too soon
// after the last frame is skipped, so on a 60 Hz screen a 30 fps cap draws every second tick.

/** When the last capped frame was due, in requestAnimationFrame time (ms). */
export interface Pacer {
  last: number;
}

export function newPacer(): Pacer {
  return { last: -Infinity };
}

/**
 * Whether to draw at `now` under a cap of `fps` frames a second, moving the pacer on if so. A tick within `slackMs` of
 * the due time counts. The next frame is due one interval after this one was due rather than after it came, so the
 * rate holds at the cap on a screen whose rate isn't a multiple of it, and a late frame brings no catch-up burst.
 */
export function paceFrame(p: Pacer, now: number, fps: number, slackMs: number): boolean {
  const interval = 1000 / fps;
  if (now - p.last < interval - slackMs) return false;
  p.last = Math.max(p.last + interval, now - slackMs);
  return true;
}
