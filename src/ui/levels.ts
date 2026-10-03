import { EXHIBITS, HUNTS, MAP, type AnimalKind, type HuntLevelId, type LevelId } from '../config';
import { animalNoun } from '../core/report';

/**
 * What the briefing says about each level. No Phaser and no DOM here, so the wording can be tested.
 * Level 1 teaches training and moving troops, level 2 fighting, and level 3 building.
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
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** How many animals start loose in level 1 or 2, and what kind. */
export function looseAtStart(level: HuntLevelId): { kind: AnimalKind; count: number } {
  const open = HUNTS[level].park.filter((p) => p.open);
  const count = open.reduce((n, p) => n + EXHIBITS[p.kind].animalCount, 0);
  return { kind: open.length ? EXHIBITS[open[0].kind].animal : 'triceratops', count };
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

/** The briefing for a level. `seconds` is level 3's build phase, which the quick test shortens. */
export function briefingFor(level: LevelId, seconds: number, villain: string): Briefing {
  const move = 'Hold, then drag, to select a group.';
  const look = 'Drag to pan. Pinch to zoom.';
  if (level === 1) {
    const { kind, count } = looseAtStart(1);
    const pens = HUNTS[1].park.filter((p) => p.open).length;
    const time = clock(HUNTS[1].timeLimitSeconds);
    return {
      title: `Round them up in ${time}`,
      intro: `Overnight, ${word(pens)} pasture ${pens === 1 ? 'fence' : 'fences'} came down and ${count} ${animalNoun(kind, count)} wandered off. Train Tranq Squads at HQ and dart every one before the park opens. The crew carries each one home.`,
      controls: ['Tap HQ to train Tranq Squads.', 'Tap a squad, then tap the map to move it, or tap a Triceratops to dart it.', move, look],
    };
  }
  if (level === 2) {
    const { count } = looseAtStart(2);
    const pens = HUNTS[2].park.filter((p) => p.open).length;
    const nest = HUNTS[2].nest;
    const where = nest ? ` at ${placeOnMap(nest[0], nest[1])} of the park` : '';
    const time = clock(HUNTS[2].timeLimitSeconds);
    return {
      title: `Clear the nest in ${time}`,
      intro: `${capital(word(pens))} raptor ${pens === 1 ? 'pen' : 'pens'} broke open overnight, and their ${count} raptors made a nest${where}. They attack any troop that comes close, all at once. Clear the nest before the park opens.`,
      controls: ['Tap HQ to train Tranq Squads and Heavy Teams.', 'Tap a troop, then tap the map to move, or tap a raptor to attack it.', move, look],
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
