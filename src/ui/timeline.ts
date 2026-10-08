import { DINOS, FIGHT, MISSIONS, UNITS, type AnimalKind, type ExhibitKind, type UnitKind } from '../config';
import type { LogEntry } from '../core/log';
import { animalList, animalNoun, type Result } from '../core/report';
import { numberWord } from './levels';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Turns the log into short end-screen lines, and picks one thing to try next time.
 * No Phaser and no DOM here, so the wording can be tested.
 */

export type LineTone = 'plain' | 'bad' | 'loss' | 'good';

export interface TimelineLine {
  /** Minutes and seconds since the power went out, or since the level started. */
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
/** Mission levels: an escape with no guests to mention. */
const OUT_OF: Record<AnimalKind, (pens: number) => string> = {
  trex: () => 'The T. rex is out of its paddock.',
  raptor: (n) => (n > 1 ? `Raptors are out of ${numberWord(n)} pens.` : 'Raptors are out of their pen.'),
  triceratops: (n) => (n > 1 ? `Triceratops are out of ${numberWord(n)} pastures.` : 'Triceratops are out of their pasture.'),
};
const BY: Record<AnimalKind, string> = { trex: 'the T. rex', raptor: 'raptors', triceratops: 'a stampede' };
const PLACE: Record<ExhibitKind, string> = { raptor: 'near a raptor pen', trex: 'near the T. rex paddock', pasture: 'near a pasture' };

function lostText(kinds: UnitKind[], by: AnimalKind | null, alone: boolean): string {
  const towers = kinds.filter((k) => k === 'tower').length;
  const jeeps = kinds.filter((k) => k === 'jeep').length;
  const people = kinds.filter((k) => k !== 'tower' && k !== 'jeep');
  const troops = people.length;
  const who: string[] = [];
  if (troops === 1 && !towers && !jeeps) who.push(UNITS[people[0]].name);
  else if (troops) who.push(`${troops} ${troops === 1 ? 'troop' : 'troops'}`);
  if (towers) who.push(towers === 1 ? (troops ? 'a tower' : 'Tranq Tower') : `${towers} towers`);
  if (jeeps) who.push(troops || towers ? 'the 4x4' : 'The Patrol 4x4');
  const subject = who.join(' and ');
  const to = by ? ` to ${BY[by]}` : '';
  const verb = jeeps && !troops && !towers ? 'wrecked' : 'lost';
  return `${subject[0].toUpperCase()}${subject.slice(1)} ${verb}${jeeps && !troops && !towers && by ? ` by ${BY[by]}` : to}${alone && by === 'trex' ? ', caught alone' : ''}.`;
}

/** "Triceratops", "Raptor", for the start of a sentence. */
const ONE: Record<AnimalKind, string> = { trex: 'The T. rex', raptor: 'Raptor', triceratops: 'Triceratops' };
const PEN: Record<AnimalKind, string> = { trex: 'paddock', raptor: 'pen', triceratops: 'pasture' };
/** "the raptor pen", "the pasture", for a sealed pen. */
const PEN_NAME: Record<ExhibitKind, string> = { raptor: 'raptor pen', trex: 'T. rex paddock', pasture: 'pasture' };

/** "the raptor pen and the pasture", for the pens a substation powers. */
export function pensText(pens: readonly ExhibitKind[]): string {
  const names = pens.map((k) => `the ${PEN_NAME[k]}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'nothing');
}

/** What kind of mission the log is from, read off its start entry. */
interface Mission {
  kind: AnimalKind;
  nest: boolean;
  substations: number;
  fight: boolean;
  stealth: boolean;
}

/** End-screen lines, oldest first. Long games keep the start and the end. */
export function timelineLines(log: readonly LogEntry[]): TimelineLine[] {
  const out: TimelineLine[] = [];
  // Mission levels open with a start entry. It decides how escapes and a win read.
  let mission: Mission | null = null;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    switch (e.type) {
      case 'blackout':
        out.push({ time: clock(e.t), text: `The power is cut with ${guests(e.inPark)} inside.`, tone: 'plain' });
        break;
      case 'start': {
        const kind = (Object.keys(e.loose)[0] as AnimalKind | undefined) ?? 'triceratops';
        mission = { kind, nest: e.nest, substations: e.substations ?? 0, fight: !!e.fight, stealth: !!e.stealth };
        const what = cap(animalList(e.loose, true));
        const n = Object.values(e.loose).reduce((a, k) => a + (k ?? 0), 0);
        const text = mission.fight
          ? e.loose.raptor
            ? `${what} are fighting.`
            : `${what} ${n === 1 ? 'is' : 'are'} going for the caged raptors.`
          : mission.substations
            ? `The power is out at ${mission.substations} substations. ${what} ${n === 1 ? 'is' : 'are'} ${mission.stealth ? 'on patrol' : 'loose'}.`
            : e.nest
              ? `${what} are guarding a nest.`
              : `${what} are loose in the park.`;
        out.push({ time: clock(e.t), text, tone: 'plain' });
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
        if (e.cage) {
          out.push({ time: clock(e.t), text: 'The T. rex broke into the raptor cage, and the fight is on.', tone: 'bad' });
          break;
        }
        if (mission) {
          // No guests in a mission level, so an escape is just one more animal to catch.
          out.push({ time: clock(e.t), text: OUT_OF[e.kind](pens), tone: 'bad' });
          break;
        }
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
      case 'fixed': {
        const sealed = e.pens.length ? ` ${cap(pensText(e.pens))} ${e.pens.length === 1 ? 'has' : 'have'} power.` : '';
        const held = e.contained ? ` ${e.contained} ${e.contained === 1 ? 'animal is' : 'animals are'} contained.` : '';
        out.push({ time: clock(e.t), text: `The ${e.name.toLowerCase()} substation is fixed.${sealed}${held}${e.last ? ' The power is back everywhere.' : ''}`, tone: 'good' });
        break;
      }
      case 'spotted':
        // Raptors see troops in every level, but the story only tells it where staying unseen is the point.
        if (!mission?.nest && !mission?.stealth) break;
        out.push({ time: clock(e.t), text: `A raptor saw ${e.kind === 'engineer' ? 'the Engineer' : `the ${UNITS[e.kind].name}`}.`, tone: 'bad' });
        break;
      case 'killed': {
        const by = e.by ? ` by ${BY[e.by]}` : '';
        out.push({ time: clock(e.t), text: e.kind === 'trex' ? `The T. rex was killed${by}.` : `A ${noun(e.kind, 1)} was killed${by}.`, tone: 'bad' });
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
        const loose = animalList(e.loose);
        const still = loose ? ` Still loose: ${loose}.` : '';
        const won = mission
          ? mission.fight
            ? 'The fight is over. Every animal is darted.'
            : mission.substations
              ? 'Every substation is fixed.'
              : mission.nest
                ? 'The nest is clear.'
                : `Every ${noun(mission.kind, 1)} is back.`
          : 'Every dinosaur is accounted for.';
        const text =
          e.reason === 'secured'
            ? won
            : e.reason === 'shutdown'
              ? 'The park is shut down.'
              : e.reason === 'overrun'
                ? `The park is overrun.${still}`
                : e.reason === 'timeUp'
                  ? mission?.substations
                    ? 'Dawn, and the power is still out.'
                    : `The park opens.${still}`
                  : e.reason === 'noTroops'
                    ? `No troops left${mission?.substations ? ' that can dart' : ''}, and no money for more.${still}`
                    : e.reason === 'noEngineers'
                      ? 'The Engineer is down. Nobody else can fix the substations.'
                      : e.reason === 'killed'
                        ? `${cap(numberWord(FIGHT.killLimit))} animals are dead.${still}`
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
  const cfg = MISSIONS[level];
  const spent = r.spending.troops;
  const timeLeft = r.mission?.timeLeft ?? 0;
  const spend = cfg.stars[0].type === 'spend' ? cfg.stars[0].max : Infinity;
  if (!cfg.nest) {
    if (!r.won) {
      if (r.reason !== 'timeUp') return null;
      return r.troopsTrained <= 1
        ? 'One squad is too slow. Train two or three at the start, and send each one after a different Triceratops.'
        : 'Triceratops run straight away from the nearest troop. Come at them from the open side, so they run into rocks, water, or a fence and stop.';
    }
    const squads = Math.floor(spend / UNITS.tranq.cost);
    if (spent > spend) return `${cap(numberWord(squads))} ${squads === 1 ? 'squad is' : 'squads are'} enough if each one goes after a different Triceratops.`;
    const third = cfg.stars[1];
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
  if (spent > spend) return `Two Heavy Teams together can clear the nest for ${money(2 * heavy.cost)}.`;
  return null;
}

/** Level 4: one thing to do differently. */
function gridAdvice(r: Result): string | null {
  const park = MISSIONS[4].park;
  const opensAt = (kind: ExhibitKind) => park.find((p) => p.kind === kind && p.breakoutAt != null)?.breakoutAt ?? null;
  const lost = r.log.find((e) => e.type === 'lost' && e.kind === 'engineer');
  const seen = r.log.some((e) => e.type === 'spotted' && e.kind === 'engineer');
  const escapes = r.log.filter((e) => e.type === 'escape');
  if (!r.won) {
    if (r.reason === 'abandoned' && !escapes.length && !seen) return null;
    const rex = opensAt('trex');
    if (lost?.type === 'lost' && lost.by === 'trex' && rex !== null) return `Fix the north substation before ${clock(rex)}, when the T. rex goes for its fence.`;
    const raptors = opensAt('raptor');
    if (escapes.some((e) => e.type === 'escape' && e.kind === 'raptor') && raptors !== null) {
      return `Fix the west substation first. Its raptors go for their fence at ${clock(raptors)}.`;
    }
    if (seen || lost) return 'Watch the cones on the ground and wait in cover until a raptor turns away. When a cone turns orange, get out of it before the raptor is sure.';
    return 'Keep moving. Work done on a substation stays done, so fix what you can and come back.';
  }
  if (seen) return 'Watch a raptor go round once before you send the Engineer in. A substation’s block hides whoever is on its far side.';
  if (r.troopsLost) return 'A raptor that sees who darts it calls the other. Dart one from behind, out of its cone, and it comes alone.';
  return null;
}

/** Level 5: one thing to do differently. */
function fightAdvice(r: Result): string | null {
  const killed = r.mission?.killed ?? 0;
  const losses = r.log.filter((e) => e.type === 'lost' && e.kind !== 'jeep');
  const byTrex = losses.filter((e) => e.type === 'lost' && e.by === 'trex').length;
  if (!r.won && r.reason === 'abandoned' && !killed && !losses.length) return null;
  if (r.reason === 'killed' || (!r.won && killed >= 2)) {
    // A bite every FIGHT.trexBiteSeconds on the most hurt raptor, until it's gone.
    const every = Math.ceil(DINOS.raptor.health / FIGHT.trexBite) * FIGHT.trexBiteSeconds;
    return `Be in place before the cage gives way, with two Heavy Teams brought over in the 4x4: once it’s in, the T. rex kills a raptor every ${every} s.`;
  }
  if (byTrex) return 'When the T. rex roars at a troop, load that troop in the 4x4 and keep driving around nearby: the T. rex chases the 4x4 while the others dart it.';
  if (losses.length) return `A darted raptor comes for whoever darted it. Dart raptors with Heavy Teams, which last ${Math.round(UNITS.heavy.hp / DINOS.raptor.troopDamage)} bites.`;
  if (killed) return 'The T. rex always bites the most hurt raptor. Dart that one first, while the others keep the T. rex busy.';
  return null;
}

/** One thing to do differently, from what went worst. null when there's nothing to fix. */
export function nextTime(r: Result): string | null {
  if (r.mission && r.level !== 3) {
    if (r.level === 4) return gridAdvice(r);
    if (r.level === 5) return fightAdvice(r);
    return huntAdvice(r, r.level);
  }
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
    const left = end?.type === 'end' ? animalList(end.loose) : '';
    return `${left ? `Still loose at the end: ${left}. ` : ''}Train more troops before the blackout, and keep them together.`;
  }
  if (r.won && r.revenue < r.revenueTarget) {
    return `Revenue came in under $${r.revenueTarget.toLocaleString('en-US')}, so no revenue star. Exhibits close to the gate and to each other earn more, because guests spend less of their visit walking.`;
  }
  return null;
}
