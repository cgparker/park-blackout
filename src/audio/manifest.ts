// Which files each sound plays. The files are in public3d/audio/, made by scripts/audio3d.py, and listed with
// their sources in public3d/LICENSES.md. How loud each sound is lives in SOUNDS (src/config.ts).
import type { SoundId } from '../config';
import type { FileId } from './files';

/** A sound with several files plays a different one from last time, so repeats don't sound copied. */
export const SOUND_FILES: Record<SoundId, readonly FileId[]> = {
  tap: ['ui_tap'],
  select: ['ui_select'],
  order: ['ui_order'],
  error: ['ui_error'],
  ready: ['ui_ready'],
  tip: ['ui_tip'],
  build: ['build'],
  reinforce: ['reinforce'],
  tower: ['tower'],
  coin: ['coin'],
  dartLight: ['dart_light'],
  dartHeavy: ['dart_heavy'],
  secured: ['secured_chime'],
  down: ['dino_down'],
  fenceChain: ['fence_chain_1', 'fence_chain_2', 'fence_chain_3'],
  fenceConcrete: ['fence_concrete_1', 'fence_concrete_2'],
  breach: ['fence_breach'],
  raptorCall: ['raptor_call_1', 'raptor_call_2'],
  raptorHiss: ['raptor_hiss'],
  raptorBite: ['raptor_bite_1', 'raptor_bite_2', 'raptor_bite_3'],
  raptorDie: ['raptor_die'],
  trexRoar: ['trex_roar'],
  trexGrowl: ['trex_growl'],
  trexBite: ['trex_bite'],
  trexDie: ['trex_die'],
  trikeBellow: ['trike_bellow'],
  guestCry: ['guest_cry'],
  warning: ['alarm_warning'],
  siren: ['alarm_siren'],
  powerDown: ['power_down'],
  powerUp: ['power_up'],
  notice: ['notice'],
  troopLost: ['troop_lost'],
  jeepDoor: ['jeep_door'],
  jeepWreck: ['jeep_wreck'],
  work: ['engineer_work_1', 'engineer_work_2', 'engineer_work_3'],
  win: ['jingle_win'],
  lose: ['jingle_lose'],
};

/** Music, each track a loop. */
export type MusicId = 'music_day' | 'music_chase' | 'music_sneak' | 'music_tension';
/** Background sound under the music: birds by day, crickets at night. */
export type AmbienceId = 'amb_day' | 'amb_night';
