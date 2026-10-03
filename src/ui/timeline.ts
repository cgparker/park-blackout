import { DINOS, HUNTS, UNITS, type AnimalKind, type ExhibitKind, type UnitKind } from '../config';
import type { LogEntry } from '../core/log';
import { animalNoun, type Result } from '../core/report';
import { numberWord } from './levels';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Turns the blackout log into short end-screen lines, and picks one thing to try next time.
 * No Phaser and no DOM here, so the wording can be tested.
 */

export type LineTone = 'plain' | 'bad' | 'loss' | 'good';

export interface TimelineLine {
  /** Minutes and seconds since the power went out. */
  time: string;
  text: string;
  tone: LineTone;
}

/** Deaths or losses this close together, from the same cause, share one line. */
const GROUP_SECONDS = 5;
/** Animals darted this close together share one line. */
const BACK_SECONDS = 2;
const MAX_LINES = 14;

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const noun = animalNoun;
const toGo = (left: number) => (left ? ` ${left} to go.` : '');

const OUT: Record<AnimalKind, string> = { trex: 'The T. rex is out', raptor: 'Raptors are out', triceratops: 'Triceratops are out' };
const BY: Record<AnimalKind, string> = { trex: 'the T. rex', raptor: 'raptors', triceratops: 'a stampede' };
const PLACE: Record<ExhibitKind, string> = { raptor: 'near a raptor pen', trex: 'near the T. rex paddock', pasture: 'near a pasture' };

function animals(counts: Partial<Record<AnimalKind, number>>): string {
  const parts: string[] = [];
  const t = counts.trex ?? 0;
  const r = counts.raptor ?? 0;
  const c = counts.triceratops ?? 0;
  if (t) parts.push('the T. rex');
  if (r) parts.push(`${r} ${r === 1 ? 'raptor' : 'raptors'}`);
  if (c) parts.push(`${c} Triceratops`);
  return parts.join(', ');
}

function lostText(kinds: UnitKind[], by: AnimalKind | null, alone: boolean): string {
  const towers = kinds.filter((k) => k === 'tower').length;
  const troops = kinds.length - towers;
  const who: string[] = [];
  if (troops === 1 && !towers) who.push(UNITS[kinds[0]].name);
  else if (troops) who.push(`${troops} ${troops === 1 ? 'troop' : 'troops'}`);
  if (towers) who.push(towers === 1 ? (troops ? 'a tower' : 'Tranq Tower') : `${towers} towers`);
  const subject = who.join(' and ');
  const to = by ? ` to ${BY[by]}` : '';
  return `${subject[0].toUpperCase()}${subject.slice(1)} lost${to}${alone && by === 'trex' ? ', caught alone' : ''}.`;
}

/** "Triceratops", "Raptor", for the start of a sentence. */
const ONE: Record<AnimalKind, string> = { trex: 'The T. rex', raptor: 'Raptor', triceratops: 'Triceratops' };
const PEN: Record<AnimalKind, string> = { trex: 'paddock', raptor: 'pen', triceratops: 'pasture' };

/** End-screen lines, oldest first. Long games keep the start and the end. */
export function timelineLines(log: readonly LogEntry[]): TimelineLine[] {
  const out: TimelineLine[] = [];
  // Levels 1 and 2 open with a start entry. It decides how a win reads.
  let hunt: { kind: AnimalKind; nest: boolean } | null = null;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    switch (e.type) {
      case 'blackout':
        out.push({ time: clock(e.t), text: `The power is cut with ${guests(e.inPark)} inside.`, tone: 'plain' });
        break;
      case 'start': {
        const kind = (Object.keys(e.loose)[0] as AnimalKind | undefined) ?? 'triceratops';
        hunt = { kind, nest: e.nest };
        const what = animals(e.loose);
        out.push({ time: clock(e.t), text: e.nest ? `${cap(what)} are guarding a nest.` : `${cap(what)} are loose in the park.`, tone: 'plain' });
        break;
      }
      case 'back': {
        if (e.how === 'walked') {
          out.push({ time: clock(e.t), text: `A ${noun(e.kind, 1)} walked back into its ${PEN[e.kind]}.${toGo(e.left)}`, tone: 'good' });
          break;
        }
        // Animals darted within a couple of seconds of each other share a line.
        let n = 1;
        let left = e.left;
        while (i + 1 < log.length) {
          const next = log[i + 1];
          if (next.type !== 'back' || next.how !== 'darted' || next.kind !== e.kind || next.t - e.t > BACK_SECONDS) break;
          n++;
          left = next.left;
          i++;
        }
        const who = n === 1 ? ONE[e.kind] : `${n} ${noun(e.kind, n)}`;
        out.push({ time: clock(e.t), text: `${who} darted.${toGo(left)}`, tone: 'good' });
        break;
      }
      case 'escape': {
        // Pens of the same kind that open within a second of each other share a line.
        let pens = 1;
        let evacuation = e.evacuation;
        let inPark = e.inPark;
        while (i + 1 < log.length) {
          const next = log[i + 1];
          if (next.type !== 'escape' || next.kind !== e.kind || next.t - e.t > 1) break;
          pens++;
          evacuation ||= next.evacuation;
          inPark = Math.max(inPark, next.inPark);
          i++;
        }
        const what = pens > 1 ? `${OUT[e.kind]} of ${pens} pens` : OUT[e.kind];
        const text = !inPark
          ? `${what}. The guests are already gone.`
          : evacuation
            ? `${what}. The park evacuates with ${guests(inPark)} inside.`
            : `${what} with ${guests(inPark)} still inside.`;
        out.push({ time: clock(e.t), text, tone: inPark ? 'bad' : 'plain' });
        break;
      }
      case 'death': {
        let n = 1;
        let unguarded = e.unguardedPen;
        while (i + 1 < log.length) {
          const next = log[i + 1];
          if (next.type !== 'death' || next.cause !== e.cause || next.t - e.t > GROUP_SECONDS) break;
          n++;
          unguarded ||= next.unguardedPen;
          i++;
        }
        const place = unguarded ? 'near an unguarded raptor pen' : e.near ? PLACE[e.near] : 'on the paths';
        const text = e.cause === 'stampede' ? `${guests(n)} trampled ${place}.` : `${guests(n)} killed by ${e.cause === 'trex' ? 'the T. rex' : 'raptors'} ${place}.`;
        out.push({ time: clock(e.t), text: text[0].toUpperCase() + text.slice(1), tone: 'bad' });
        break;
      }
      case 'lost': {
        const kinds: UnitKind[] = [e.kind];
        let alone = e.alone;
        while (i + 1 < log.length) {
          const next = log[i + 1];
          if (next.type !== 'lost' || next.by !== e.by || next.t - e.t > GROUP_SECONDS) break;
          kinds.push(next.kind);
          alone ||= next.alone;
          i++;
        }
        out.push({ time: clock(e.t), text: lostText(kinds, e.by, alone), tone: 'loss' });
        break;
      }
      case 'parkEmpty':
        out.push({ time: clock(e.t), text: 'The park is empty.', tone: 'plain' });
        break;
      case 'allClear':
        out.push({ time: clock(e.t), text: 'Every predator is secured.', tone: 'good' });
        break;
      case 'power':
        out.push({
          time: clock(e.t),
          text: e.contained ? `The power is back. ${e.contained} ${e.contained === 1 ? 'animal is' : 'animals are'} contained.` : 'The power is back.',
          tone: 'plain',
        });
        break;
      case 'end': {
        const loose = animals(e.loose);
        const still = loose ? ` Still loose: ${loose}.` : '';
        const won = hunt ? (hunt.nest ? 'The nest is clear.' : `Every ${noun(hunt.kind, 1)} is back.`) : 'Every dinosaur is accounted for.';
        const text =
          e.reason === 'secured'
            ? won
            : e.reason === 'shutdown'
              ? 'The park is shut down.'
              : e.reason === 'overrun'
                ? `The park is overrun.${still}`
                : e.reason === 'timeUp'
                  ? `The park opens.${still}`
                  : e.reason === 'noTroops'
                    ? `No troops left, and no money for more.${still}`
                    : `You ended the game.${still}`;
        out.push({ time: clock(e.t), text, tone: e.reason === 'secured' ? 'good' : 'bad' });
        break;
      }
    }
  }
  if (out.length <= MAX_LINES) return out;
  const hidden = out.length - (MAX_LINES - 1);
  return [...out.slice(0, MAX_LINES - 2), { time: '', text: `${hidden} more events`, tone: 'plain' }, out[out.length - 1]];
}

/** Levels 1 and 2: one thing to do differently. Each line is something the balance runs showed works. */
function huntAdvice(r: Result, level: 1 | 2): string | null {
  const cfg = HUNTS[level];
  const spent = r.spending.troops;
  const timeLeft = r.hunt?.timeLeft ?? 0;
  if (!cfg.nest) {
    if (!r.won) {
      if (r.reason !== 'timeUp') return null;
      return r.troopsTrained <= 1
        ? 'One squad is too slow. Train two or three at the start, and send each one after a different Triceratops.'
        : 'Triceratops run straight away from the nearest troop. Come at them from the open side, so they run into rocks, water, or a fence and stop.';
    }
    const squads = Math.floor(cfg.spendStar / UNITS.tranq.cost);
    if (spent > cfg.spendStar) return `${cap(numberWord(squads))} ${squads === 1 ? 'squad is' : 'squads are'} enough if each one goes after a different Triceratops.`;
    const third = cfg.thirdStar;
    if (third.type === 'timeLeft' && Math.ceil(timeLeft) < third.seconds) return 'Train your squads at the start, and send each one after a different Triceratops.';
    return null;
  }
  const losses = r.log.filter((e) => e.type === 'lost');
  const alone = losses.filter((e) => e.type === 'lost' && e.alone).length;
  const heavy = UNITS.heavy;
  if (!r.won) {
    if (r.reason === 'abandoned' && !losses.length) return null;
    if (!losses.length) return 'Train your team right away and go in together. The nest has to be clear before the park opens.';
    if (alone * 2 >= losses.length) {
      return 'Raptors attack together, so troops that go in a few at a time get bitten down. Gather every troop into one group first, then go in.';
    }
    return 'Bring more troops. Raptors pile onto the nearest troop, and a bigger group darts them down before they can finish anyone.';
  }
  if (r.troopsLost) {
    return `Heavy Teams take ${Math.round(heavy.hp / DINOS.raptor.troopDamage)} raptor bites. Two of them together often clear the nest without a loss.`;
  }
  if (spent > cfg.spendStar) return `Two Heavy Teams together can clear the nest for ${money(2 * heavy.cost)}.`;
  return null;
}

/** One thing to do differently, from what went worst. null when there's nothing to fix. */
export function nextTime(r: Result): string | null {
  if (r.hunt && r.level !== 3) return huntAdvice(r, r.level);
  const log = r.log;
  const raptorDeaths = log.filter((e) => e.type === 'death' && e.cause === 'raptor');
  const trex = r.exhibits.find((e) => e.kind === 'trex');
  if (raptorDeaths.length) {
    if (r.evacuatedBy === 'raptor' && !trex) {
      return 'With no T. rex, the raptors are the first ones out, so they meet a full park. Reinforce their fences and post troops beside every raptor pen.';
    }
    if (r.evacuatedBy === 'raptor' && trex?.reinforced) {
      return 'The concrete held the T. rex in until after the raptors got out, so they met a full park. Reinforce the raptor pens instead. The T. rex getting out first starts the evacuation.';
    }
    if (raptorDeaths.some((e) => e.type === 'death' && e.unguardedPen)) {
      return 'Guests died near an unguarded raptor pen. Post troops beside each raptor pen before the lights go out.';
    }
    const start = log.find((e) => e.type === 'escape' && e.evacuation);
    const raptors = log.find((e) => e.type === 'escape' && e.kind === 'raptor');
    if (start && raptors?.type === 'escape' && start !== raptors && raptors.inPark > 0) {
      const gap = Math.max(1, Math.round(raptors.t - start.t));
      return `The raptors got out ${gap} s after the evacuation began, with ${guests(raptors.inPark)} still inside. Reinforce the raptor pens to give the guests more time.`;
    }
  }
  if (log.some((e) => e.type === 'lost' && e.by === 'trex' && e.alone)) {
    return 'The T. rex caught a troop on its own. Keep your troops together near it.';
  }
  if (r.reason === 'overrun') {
    const end = log.find((e) => e.type === 'end');
    const left = end?.type === 'end' ? animals(end.loose) : '';
    return `${left ? `Still loose at the end: ${left}. ` : ''}Train more troops before the blackout, and keep them together.`;
  }
  if (r.won && r.revenue < r.revenueTarget) {
    return `Revenue came in under $${r.revenueTarget.toLocaleString('en-US')}, so no revenue star. Exhibits close to the gate and to each other earn more, because guests spend less of their visit walking.`;
  }
  return null;
}
