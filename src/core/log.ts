import type { AnimalKind, ExhibitKind, UnitKind } from '../config';
import type { EndReason } from './report';
import type { CasualtyCause } from './world';

/**
 * What happened, kept for the end screen. `t` is seconds since the log started: the power cut in level 3,
 * or the start in levels 1 and 2. The world writes these as things happen; src/ui/timeline.ts turns them into sentences.
 */
export type LogEntry =
  | { t: number; type: 'blackout'; inPark: number }
  /** Levels 1 and 2: what is loose at the start, and whether the raptors guard a nest. */
  | { t: number; type: 'start'; loose: Partial<Record<AnimalKind, number>>; nest: boolean }
  /** The first animal out of one exhibit. `evacuation` marks the escape that started the evacuation. */
  | { t: number; type: 'escape'; kind: AnimalKind; inPark: number; evacuation: boolean }
  /** `near` is the closest exhibit, if any is close. `unguardedPen` means a raptor pen with no troops beside it was close. */
  | { t: number; type: 'death'; cause: CasualtyCause; near: ExhibitKind | null; unguardedPen: boolean }
  /** A troop or tower lost. `alone` means no more than one other troop was close by. */
  | { t: number; type: 'lost'; kind: UnitKind; by: AnimalKind | null; alone: boolean }
  /** Levels 1 and 2: an animal is back in a pen, darted and carried there or walked in. `left` is how many are still loose. */
  | { t: number; type: 'back'; kind: AnimalKind; how: 'darted' | 'walked'; left: number }
  | { t: number; type: 'parkEmpty' }
  | { t: number; type: 'allClear' }
  | { t: number; type: 'power'; contained: number }
  | { t: number; type: 'end'; reason: EndReason; loose: Partial<Record<AnimalKind, number>> };
