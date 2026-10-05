import type { AnimalKind, ExhibitKind, UnitKind } from '../config';
import type { EndReason } from './report';
import type { CasualtyCause } from './world';

/**
 * What happened, kept for the end screen. `t` is seconds since the log started: the power cut in level 3,
 * or the start of a mission level. The world writes these as things happen; src/ui/timeline.ts turns them into sentences.
 */
export type LogEntry =
  | { t: number; type: 'blackout'; inPark: number }
  /**
   * Mission levels: what is loose at the start, whether the raptors guard a nest (level 2), how many substations
   * are down and whether the raptors are on patrol (level 4), and whether a fight is on (level 5).
   */
  | { t: number; type: 'start'; loose: Partial<Record<AnimalKind, number>>; nest: boolean; substations: number; fight: boolean; stealth: boolean }
  /** The first animal out of one exhibit. `evacuation` marks the escape that started the evacuation. */
  | { t: number; type: 'escape'; kind: AnimalKind; inPark: number; evacuation: boolean }
  /** `near` is the closest exhibit, if any is close. `unguardedPen` means a raptor pen with no troops beside it was close. */
  | { t: number; type: 'death'; cause: CasualtyCause; near: ExhibitKind | null; unguardedPen: boolean }
  /** A troop, tower, or the 4x4 lost. `alone` means no more than one other troop was close by. */
  | { t: number; type: 'lost'; kind: UnitKind; by: AnimalKind | null; alone: boolean }
  /** Mission levels: an animal darted, or back in a powered pen on its own. `left` is how many are still loose. */
  | { t: number; type: 'back'; kind: AnimalKind; how: 'darted' | 'walked'; left: number }
  /** Level 4: a substation fixed, the pens it powers, how many animals it contained, and whether it was the last. */
  | { t: number; type: 'fixed'; name: string; pens: ExhibitKind[]; contained: number; last: boolean }
  /** Level 4: a raptor saw this troop for the first time. */
  | { t: number; type: 'spotted'; kind: UnitKind }
  /** Level 5: an animal killed in the fight, and by what. */
  | { t: number; type: 'killed'; kind: AnimalKind; by: AnimalKind | null }
  | { t: number; type: 'parkEmpty' }
  | { t: number; type: 'allClear' }
  | { t: number; type: 'power'; contained: number }
  | { t: number; type: 'end'; reason: EndReason; loose: Partial<Record<AnimalKind, number>> };
