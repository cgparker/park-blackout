import { DINO_AI, DINOS, FIGHT, MAP, TIPS, UNITS } from '../config';
import { footprintCenter, type Exhibit } from '../core/exhibit';
import type { Point } from '../core/grid';
import { guarded, nearestExhibit, troopsNear } from '../core/guard';
import { substationCenter } from '../core/power';
import type { GameEvent, World } from '../core/world';
import { numberWord } from './levels';

/**
 * Tips that teach the two defense lessons the balance runs found:
 * raptors kill visitors unless each pen is guarded (and its fence reinforced),
 * and the T. rex picks off troops that are spread thin.
 * One more explains the evacuation rule: guests stay until the first animal gets out.
 * Levels 1 and 2 have their own: how to train and send troops, why Triceratops run, and how raptors fight.
 * Level 4: staying out of the raptors' sight, sending the Engineer, what a fixed substation does, and being seen.
 * Level 5: the fight, the 4x4, a pen broken open, the first animal killed, and pulling the T. rex's target away in the 4x4.
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
  | 'raptorBites'
  | 'stealth'
  | 'noticed'
  | 'engineer'
  | 'powered'
  | 'spotted'
  | 'squadLost'
  | 'fight'
  | 'jeep'
  | 'penBroken'
  | 'killed'
  | 'jeepKite';

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
  if (w.level === 4) return gridTips(w, events);
  if (w.level === 5) return fightTips(w, events);
  if (w.mission) return huntTips(w, events);
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
          body: 'A Triceratops runs straight away from the nearest troop. It turns along rocks, water, fences, and the edge of the park, and only stops in a corner. Come at it from the open side to drive it into one.',
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

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Level 4: the pen whose animals go for the fence first, and the substation that powers it. */
function firstToBreak(w: World) {
  let pen: Exhibit | null = null;
  for (const ex of w.exhibits) {
    if (ex.powered || ex.breakoutAt == null) continue;
    if (!pen || ex.breakoutAt < (pen.breakoutAt ?? Infinity)) pen = ex;
  }
  return { pen, substation: pen ? w.substationFor(pen.id) : undefined };
}

/** Level 4. */
function gridTips(w: World, events: readonly GameEvent[]): Tip[] {
  const out: Tip[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'started': {
        const raptor = w.dinos.find((d) => d.kind === 'raptor' && d.state === 'loose');
        out.push({
          id: 'stealth',
          title: 'Stay out of sight',
          body: 'Two raptors walk the east side of the park. The cone in front of each one shows what it sees, and rock, pens, and substations block its view. A raptor takes a moment to make out a troop in its cone, and the cone turns orange while it does. Once it’s sure, it comes for the troop and calls the other.',
          focus: raptor ? { x: raptor.x, y: raptor.y } : null,
        });
        const { pen, substation } = firstToBreak(w);
        const when = pen?.breakoutAt != null ? ` Its raptors go for their fence at ${clock(pen.breakoutAt)}.` : '';
        out.push({
          id: 'engineer',
          title: `Fix the ${substation?.name.toLowerCase() ?? 'nearest'} substation`,
          body: `Tap the Engineer, then the side of the substation beside HQ that it should work from. It works while it stands beside it, and work done stays done if it has to leave.${when}`,
          focus: substation ? substationCenter(substation, T) : HQ_CENTER,
        });
        break;
      }
      case 'substationFixed': {
        const s = w.substationById(e.id);
        const { pen, substation } = firstToBreak(w);
        const next = !e.last && pen?.breakoutAt != null && substation ? ` Next, the ${substation.name.toLowerCase()} substation: its ${pen.kind === 'trex' ? 'T. rex goes' : 'animals go'} for the fence at ${clock(pen.breakoutAt)}.` : '';
        out.push({
          id: 'powered',
          title: 'The power is back here',
          body: `The pens this substation powers are sealed, and the animals inside stay inside.${next}`,
          focus: s ? substationCenter(s, T) : null,
        });
        break;
      }
      case 'noticed': {
        const engineer = e.kind === 'engineer';
        out.push({
          id: 'noticed',
          title: `A raptor noticed ${engineer ? 'the Engineer' : `your ${UNITS[e.kind].name}`}`,
          body: `It stopped to make out what it saw. Get out of its cone, or behind cover, before the ring fills, or it comes and calls the other.${engineer ? ' Being noticed at all costs the Engineer’s star.' : ''}`,
          focus: { x: e.x, y: e.y },
        });
        break;
      }
      case 'spotted': {
        const engineer = e.kind === 'engineer';
        // A raptor darted by a troop it never saw comes alone, so say whether the other one is coming too.
        const both = w.dinos.filter((d) => d.state === 'loose' && d.target?.type === 'unit' && d.target.id === e.unitId).length > 1;
        const body = engineer
          ? both
            ? 'It’s coming, and it called the other. The Engineer can’t outrun them. A raptor goes for whoever darts it, so darts from the Tranq Squad can draw them off.'
            : 'It’s coming. The Engineer can’t outrun it. A raptor goes for whoever darts it, so darts from the Tranq Squad can draw it off.'
          : both
            ? 'It’s coming, and it called the other. Two raptors are too many for a Tranq Squad, but while they chase it, the Engineer can work.'
            : 'It’s coming on its own. A Tranq Squad can put down one raptor, so keep darting.';
        out.push({ id: 'spotted', title: `A raptor is after ${engineer ? 'the Engineer' : `your ${UNITS[e.kind].name}`}`, body, focus: { x: e.x, y: e.y } });
        break;
      }
      case 'unitLost':
        if (e.kind !== 'tranq') break;
        out.push({
          id: 'squadLost',
          title: 'The Tranq Squad is gone',
          body: 'The raptors go back to their routes now. Whatever the Engineer fixed while they were busy stays fixed.',
          focus: { x: e.x, y: e.y },
        });
        break;
    }
  }
  return out;
}

/** Level 5. */
function fightTips(w: World, events: readonly GameEvent[]): Tip[] {
  const out: Tip[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'started': {
        const rex = w.dinos.find((d) => d.kind === 'trex' && d.state === 'loose');
        const jeep = w.units.find((u) => u.kind === 'jeep' && !u.dead);
        out.push({
          id: 'fight',
          title: 'They are killing each other',
          body: `The T. rex and the raptors are wounding each other, and the red bars show it. Dart them before they die. A raptor you dart turns on you for a few seconds. The T. rex is too busy for you while ${numberWord(FIGHT.shieldRaptors)} or more raptors are on it; after that, it comes for whoever darts it.`,
          focus: rex ? { x: rex.x, y: rex.y } : null,
        });
        out.push({
          id: 'jeep',
          title: 'The Patrol 4x4',
          body: 'Select troops and tap the 4x4 to load two. Then tap the 4x4 and tap the map to drive, and they climb out where it stops. Tap an animal instead to drop them beside it.',
          focus: jeep ? { x: jeep.x, y: jeep.y } : HQ_CENTER,
        });
        break;
      }
      case 'breach':
        out.push({
          id: 'penBroken',
          title: 'The fight broke into a pen',
          body: 'The T. rex pushes toward pens with no power, and the animals inside join the fight. Put it down before it reaches the next one.',
          focus: { x: e.x, y: e.y },
        });
        break;
      case 'roar':
        out.push({
          id: 'jeepKite',
          title: 'The T. rex picked a target',
          body: `The orange ring marks the troop it roared at. Load that troop into the 4x4 and keep driving around nearby: the T. rex chases the 4x4 instead, and the others can dart it while it does. More than ${DINO_AI.trexLockBreakTiles} tiles away, it gives up.`,
          focus: { x: e.x, y: e.y },
        });
        break;
      case 'killed':
        out.push({
          id: 'killed',
          title: e.kind === 'trex' ? 'The T. rex was killed' : 'A raptor was killed',
          body: `The T. rex bites the most hurt raptor it can reach, and raptors wear the T. rex down. ${FIGHT.killLimit} animals killed loses the level.`,
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
