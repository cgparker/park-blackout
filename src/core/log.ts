import type { AnimalKind, ExhibitKind, UnitKind } from '../config';
import type { EndReason } from './report';
import type { CasualtyCause } from './world';

/**
 * What happened after the lights went out, kept for the end screen. `t` is seconds since the blackout.
 * The world writes these as things happen; src/ui/timeline.ts turns them into sentences.
 */
export type LogEntry =
  | { t: number; type: 'blackout'; inPark: number }
  /** The first animal out of one exhibit. `evacuation` marks the escape that started the evacuation. */
  | { t: number; type: 'escape'; kind: AnimalKind; inPark: number; evacuation: boolean }
  /** `near` is the closest exhibit, if any is close. `unguardedPen` means a raptor pen with no troops beside it was close. */
  | { t: number; type: 'death'; cause: CasualtyCause; near: ExhibitKind | null; unguardedPen: boolean }
  /** A troop or tower lost. `alone` means no more than one other troop was close by. */
  | { t: number; type: 'lost'; kind: UnitKind; by: AnimalKind | null; alone: boolean }
  | { t: number; type: 'parkEmpty' }
  | { t: number; type: 'allClear' }
  | { t: number; type: 'power'; contained: number }
  | { t: number; type: 'end'; reason: EndReason; loose: Partial<Record<AnimalKind, number>> };
