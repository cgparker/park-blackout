import { EXHIBITS, MAP, MISSIONS, UNITS, type AnimalKind, type LevelId, type MissionLevelId } from '../config';
import { animalNoun } from '../core/report';

/**
 * What the briefing says about each level. No Phaser and no DOM here, so the wording can be tested.
 * Level 1 teaches training and moving troops, level 2 fighting, level 3 building, level 4 sneaking past
 * patrols to make repairs, and level 5 making do with a fixed team and the 4x4.
 */

export interface LevelInfo {
  name: string;
  /** What the level teaches, for the level picker. */
  teaches: string;
}

export const LEVEL_INFO: Record<LevelId, LevelInfo> = {
  1: { name: 'Roundup', teaches: 'Troops' },
  2: { name: 'Raptor Nest', teaches: 'Fighting' },
  3: { name: 'Blackout', teaches: 'Building' },
  4: { name: 'Grid Down', teaches: 'Stealth' },
  5: { name: 'Showdown', teaches: 'Driving' },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** What starts loose in a mission level: every kind and how many, and the first kind listed (levels 1 and 2 have one). */
export function looseAtStart(level: MissionLevelId): { kind: AnimalKind; count: number; counts: Partial<Record<AnimalKind, number>> } {
  const counts: Partial<Record<AnimalKind, number>> = {};
  let first: AnimalKind | null = null;
  for (const p of MISSIONS[level].park) {
    if (!p.open) continue;
    const kind = EXHIBITS[p.kind].animal;
    first ??= kind;
    counts[kind] = (counts[kind] ?? 0) + (p.animals ?? EXHIBITS[p.kind].animalCount);
  }
  const count = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  return { kind: first ?? 'triceratops', count, counts };
}

export interface Briefing {
  title: string;
  intro: string;
  controls: string[];
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** "two", "three"; numbers past nine stay as digits. */
export const numberWord = (n: number) => WORDS[n] ?? String(n);
const word = numberWord;
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "the east end", "the northwest corner", or "the middle", for a tile. */
function placeOnMap(x: number, y: number): string {
  const ew = x > (MAP.cols * 2) / 3 ? 'east' : x < MAP.cols / 3 ? 'west' : '';
  const ns = y < MAP.rows / 3 ? 'north' : y > (MAP.rows * 2) / 3 ? 'south' : '';
  if (ew && ns) return `the ${ns}${ew} corner`;
  return ew || ns ? `the ${ew || ns} end` : 'the middle';
}

/** "one Engineer and one Tranq Squad", "2 Heavy Teams, 2 Tranq Squads, and a Patrol 4x4", for a fixed team. */
export function teamWords(level: MissionLevelId): string {
  const counts = new Map<string, number>();
  for (const m of MISSIONS[level].team ?? []) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => {
    const name = UNITS[kind as keyof typeof UNITS].name;
    if (kind === 'jeep') return `a ${name}`;
    return n === 1 ? `one ${name}` : `${n} ${name}s`;
  });
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** The briefing for a level. `seconds` is level 3's build phase, which the quick test shortens. */
export function briefingFor(level: LevelId, seconds: number, villain: string): Briefing {
  const move = 'Hold, then drag, to select a group.';
  const look = 'Drag to pan. Pinch to zoom.';
  if (level === 1) {
    const { kind, count } = looseAtStart(1);
    const pens = MISSIONS[1].park.filter((p) => p.open).length;
    const time = clock(MISSIONS[1].timeLimitSeconds);
    return {
      title: `Round them up in ${time}`,
      intro: `Overnight, ${word(pens)} pasture ${pens === 1 ? 'fence' : 'fences'} came down and ${count} ${animalNoun(kind, count)} wandered off. Train Tranq Squads at HQ and dart every one before the park opens. The crew carries each one home.`,
      controls: ['Tap HQ to train Tranq Squads.', 'Tap a squad, then tap the map to move it, or tap a Triceratops to dart it.', move, look],
    };
  }
  if (level === 2) {
    const { count } = looseAtStart(2);
    const pens = MISSIONS[2].park.filter((p) => p.open).length;
    const nest = MISSIONS[2].nest;
    const where = nest ? ` at ${placeOnMap(nest[0], nest[1])} of the park` : '';
    const time = clock(MISSIONS[2].timeLimitSeconds);
    return {
      title: `Clear the nest in ${time}`,
      intro: `${capital(word(pens))} raptor ${pens === 1 ? 'pen' : 'pens'} broke open overnight, and their ${count} raptors made a nest${where}. They attack any troop that comes close, all at once. Clear the nest before the park opens.`,
      controls: ['Tap HQ to train Tranq Squads and Heavy Teams.', 'Tap a troop, then tap the map to move, or tap a raptor to attack it.', move, look],
    };
  }
  if (level === 4) {
    const cfg = MISSIONS[4];
    const n = cfg.substations?.length ?? 0;
    const { count } = looseAtStart(4);
    return {
      title: `Power back on by dawn`,
      intro: `The blackout is over, but the power isn’t back: ${villain} wrecked the park’s ${word(n)} substations on the way out, and ${word(count)} raptors are on patrol. You have ${teamWords(4)}. Fix all ${word(n)} substations before dawn, ${clock(cfg.timeLimitSeconds)} away, and keep out of the raptors’ sight.`,
      controls: [
        'Tap the Engineer, then a substation, to fix it. Work done stays done.',
        'The cone in front of a raptor is what it sees. Rock, pens, and substations block it.',
        'Tap a pen to see when its animals break out.',
        move,
        look,
      ],
    };
  }
  if (level === 5) {
    return {
      title: 'Break up the fight',
      intro: `The T. rex and a raptor pack got out through fences still being fixed, and they are fighting. Every animal killed is lost to the park, and the fight is heading for pens with no power. You have ${teamWords(5)}. Dart them all before the park opens in ${clock(MISSIONS[5].timeLimitSeconds)}.`,
      controls: [
        'Tap troops, then tap the 4x4 to load two.',
        'Tap the 4x4, then tap the map to drive. Tap an animal to drop the troops beside it.',
        'Tap a troop, then a dinosaur to dart it. Whatever you dart comes for you.',
        move,
        look,
      ],
    };
  }
  return {
    title: `Lights out in ${clock(seconds)}`,
    intro: `${villain} will cut power to the electric fences in ${clock(seconds)} to steal dinosaur embryos. Build your park, earn money, and train your containment team before the lights go out.`,
    controls: [
      'Tap an exhibit or a tower below, then tap the map to place it.',
      'Tap HQ to train troops. Towers guard a spot on their own.',
      'Tap a troop, then tap the map to move or a dinosaur to attack.',
      move,
      look,
    ],
  };
}
