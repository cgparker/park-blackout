import { MAP, TIPS } from '../config';
import { footprintCenter, type Exhibit } from '../core/exhibit';
import type { Point } from '../core/grid';
import { guarded, nearestExhibit, troopsNear } from '../core/guard';
import type { GameEvent, World } from '../core/world';

/**
 * Tips that teach the two defense lessons the balance runs found:
 * raptors kill visitors unless each pen is guarded (and its fence reinforced),
 * and the T. rex picks off troops that are spread thin.
 * One more explains the evacuation rule: guests stay until the first animal gets out.
 * No Phaser and no DOM here, so the rules for when a tip fires can be tested.
 */
export type TipId = 'raptorPen' | 'trex' | 'evacuation' | 'unguarded' | 'raptorKills' | 'trexLoner';

export interface Tip {
  id: TipId;
  title: string;
  body: string;
  /** Where to point the camera, in world pixels. */
  focus: Point | null;
}

const T = MAP.tileSize;

/** Tips set off by this batch of events. The caller decides whether tips are on and which were seen. */
export function tipsFor(w: World, events: readonly GameEvent[]): Tip[] {
  const out: Tip[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'built': {
        const ex = w.exhibitById(e.exhibitId);
        if (ex?.kind === 'raptor') out.push(raptorPenTip(ex));
        if (ex?.kind === 'trex') out.push(trexTip(ex));
        break;
      }
      case 'warning': {
        if (w.exhibits.some((ex) => ex.kind !== 'pasture')) out.push(evacuationTip());
        const open = w.exhibits.filter((ex) => ex.kind === 'raptor' && !guarded(w, ex));
        if (open.length) out.push(unguardedTip(open));
        break;
      }
      case 'casualty': {
        if (e.cause !== 'raptor') break;
        const pen = nearestExhibit(w, e.x, e.y, TIPS.killNearPenTiles, 'raptor');
        if (pen && !guarded(w, pen)) out.push(raptorKillsTip(e.x, e.y));
        break;
      }
      case 'unitLost': {
        if (e.by !== 'trex' || e.kind === 'tower') break;
        if (troopsNear(w, e.x, e.y, TIPS.lonerRadiusTiles) <= TIPS.lonerMaxFriends) out.push(trexLonerTip(e.x, e.y));
        break;
      }
    }
  }
  return out;
}

function raptorPenTip(ex: Exhibit): Tip {
  return {
    id: 'raptorPen',
    title: 'Raptors go for visitors',
    body: 'When the power goes out, raptors break out beside the path and attack whoever is close. Before the blackout, reinforce their fence and post troops beside each raptor pen.',
    focus: footprintCenter(ex.footprint, T),
  };
}

function trexTip(ex: Exhibit): Tip {
  return {
    id: 'trex',
    title: 'The T. rex picks off loners',
    body: 'It locks onto one troop, marked with an orange ring, and charges it. Keep your troops in one group so they all dart it at once.',
    focus: footprintCenter(ex.footprint, T),
  };
}

function evacuationTip(): Tip {
  return {
    id: 'evacuation',
    title: 'Nobody will tell the guests',
    body: 'When the power goes out, guests keep touring and paying. The park only sends them home once the first animal gets out, so whatever escapes first meets a full park.',
    focus: null,
  };
}

function unguardedTip(pens: Exhibit[]): Tip {
  const one = pens.length === 1;
  return {
    id: 'unguarded',
    title: one ? 'A raptor pen is unguarded' : `${pens.length} raptor pens are unguarded`,
    body: `${one ? 'It has' : 'They have'} no troops nearby, so raptors from ${one ? 'it' : 'them'} will reach visitors first. Move troops beside ${one ? 'it' : 'each one'}, and reinforce the fence if you can.`,
    focus: footprintCenter(pens[0].footprint, T),
  };
}

function raptorKillsTip(x: number, y: number): Tip {
  return {
    id: 'raptorKills',
    title: 'Visitors are dying by a raptor pen',
    body: 'No troops were close enough to stop the raptors. Send troops there now. Next time, guard each raptor pen and reinforce its fence before the lights go out.',
    focus: { x, y },
  };
}

function trexLonerTip(x: number, y: number): Tip {
  return {
    id: 'trexLoner',
    title: 'The T. rex caught a troop alone',
    body: 'It picks one target and charges after a short wind-up. Keep troops together near the T. rex, and move a troop with an orange ring out of its path.',
    focus: { x, y },
  };
}
