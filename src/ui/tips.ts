import { DINOS, MAP, TIPS, UNITS } from '../config';
import { footprintCenter, type Exhibit } from '../core/exhibit';
import type { Point } from '../core/grid';
import { guarded, nearestExhibit, troopsNear } from '../core/guard';
import type { GameEvent, World } from '../core/world';

/**
 * Tips that teach the two defense lessons the balance runs found:
 * raptors kill visitors unless each pen is guarded (and its fence reinforced),
 * and the T. rex picks off troops that are spread thin.
 * One more explains the evacuation rule: guests stay until the first animal gets out.
 * Levels 1 and 2 have their own: how to train and send troops, why Triceratops run, and how raptors fight.
 * No Phaser and no DOM here, so the rules for when a tip fires can be tested.
 */
export type TipId =
  | 'raptorPen'
  | 'trex'
  | 'evacuation'
  | 'unguarded'
  | 'raptorKills'
  | 'trexLoner'
  | 'train'
  | 'dart'
  | 'spooked'
  | 'nest'
  | 'raptorBites';

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
  if (w.hunt) return huntTips(w, events);
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

const HQ_CENTER: Point = { x: (MAP.hq.x + MAP.hq.w / 2) * T, y: (MAP.hq.y + MAP.hq.h / 2) * T };

/** Levels 1 and 2. */
function huntTips(w: World, events: readonly GameEvent[]): Tip[] {
  const out: Tip[] = [];
  const nest = w.nest;
  for (const e of events) {
    switch (e.type) {
      case 'started':
        if (nest) {
          out.push({
            id: 'nest',
            title: 'Raptors guard their nest',
            body: 'They attack any troop that comes close, all at once. Gather your troops into one group before you go in. If a fight goes badly, pull back: they won’t chase you far from the nest.',
            focus: nest,
          });
        } else {
          out.push({
            id: 'train',
            title: 'Train a Tranq Squad',
            body: 'Tap HQ, then Tranq Squad. Each squad walks out beside HQ when it’s ready, and you can queue several at once.',
            focus: HQ_CENTER,
          });
        }
        break;
      case 'trained': {
        if (nest) break;
        const u = w.unitById(e.unitId);
        out.push({
          id: 'dart',
          title: 'Send it after a Triceratops',
          body: 'Tap the squad to select it, then tap a Triceratops to dart it. A squad also darts anything close by on its own.',
          focus: u ? { x: u.x, y: u.y } : HQ_CENTER,
        });
        break;
      }
      case 'stampede':
        if (nest || !e.byTroop) break;
        out.push({
          id: 'spooked',
          title: 'Triceratops run from troops',
          body: 'A Triceratops runs straight away from the nearest troop. Come at it from the open side, so it runs into rocks, water, a fence, or the edge of the park and stops.',
          focus: { x: e.x, y: e.y },
        });
        break;
      case 'unitLost':
        if (!nest || e.by !== 'raptor') break;
        out.push({
          id: 'raptorBites',
          title: 'Raptors pile on',
          body: `Raptors bite the nearest troop. A group darts them down before they can finish anyone. Heavy Teams have ${UNITS.heavy.hp} HP, so they last ${Math.round(UNITS.heavy.hp / DINOS.raptor.troopDamage)} bites.`,
          focus: { x: e.x, y: e.y },
        });
        break;
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
