# 3D assets: sources and licenses

Everything in `public3d/` is either public domain (CC0 1.0) or made for this project. No attribution is required for any of it. This file records where each part came from.

## Models (CC0 1.0, by Quaternius)

All three packs are by Quaternius (quaternius.com) and released under CC0 1.0 Universal (public domain dedication): https://creativecommons.org/publicdomain/zero/1.0/

| Folder | Pack | Used for | License text shipped with the pack |
|---|---|---|---|
| `dinos/` | Animated Dinosaur Pack (https://quaternius.com/packs/animateddinosaurs.html) | T. rex, Velociraptor, Triceratops | CC0 1.0, stated in the pack's credits file |
| `people/` | Ultimate Modular Men and Ultimate Modular Women | Troops (Adventurer, Swat), the Engineer (Worker, from the men's pack), and park guests | CC0 1.0 Universal |
| `nature/` | Stylized Nature MegaKit, free Standard version | Trees, bushes, plants, grass, rocks | CC0 1.0 Universal (`License_Standard.txt`) |

The copies used were taken from public GitHub projects that include these packs unchanged with their license files: Bleach4Ever/kid, marcoaureliomenezes/tauan-games, howellsryan/pocketRPG, playdream996-cyber/Mirag_City_Game, and osman-1002/3D-3rd-Person-Godot-Game-With-GenAI-Integration. The packs are not in this repo; `scripts/assets3d.mjs` turns them into the files here.

What the build changes, so nobody mistakes these for the originals:

- Only the animation clips the game uses are kept, and they are renamed (for example `Velociraptor_Run` becomes `Run`).
- Guests: six of the pack's characters, simplified to about a third of their triangles. Every character in a pack moves with the same clips, so only the first of each (`guest_m1`, `guest_f1`) keeps them, and the game lends them to the rest.
- Dinosaur normals are smoothed. Dinosaur colours come from the game's own skin shader, not the pack's materials.
- Vertex data is packed (KHR_mesh_quantization). Tree trunks are simplified, and leaf cards are thinned (about half kept, each grown to cover the gap).
- Tree leaves use white versions of the pack's leaf textures, tinted in the game.
- Troop gear (caps, armour, guns) and the Engineer's toolbox are built by the game from simple shapes and are not part of any pack. The Engineer's hard hat and vest are the pack's, recoloured by the game, which adds the vest's reflective bands.
- The Patrol 4x4 is built by the game from simple shapes. It copies no real vehicle's badges or grille.
- In the game, each character's parts are merged into one mesh, and each guest is given its own colours.

## Sounds (CC0 1.0)

Every recording in `audio/` is from a pack released under CC0 1.0 Universal (public domain dedication). Each OpenGameArt page lists CC0 as the work's only license, and each Kenney pack ships a `License.txt` that says Creative Commons Zero, CC0. The packs are not in this repo; `scripts/audio3d.py` downloads them (`--fetch`) and turns them into the files here.

| Source | By | Used for |
|---|---|---|
| High-Energy Adventure Theme, https://opengameart.org/content/high-energy-adventure-theme-130-bpm | SRG774 | `music_roundup` (the full theme) |
| Bamboo Blitz, https://opengameart.org/content/bamboo-blitz | Tsorthan Grove | `music_day` |
| Determined Pursuit (epic orchestra loop), https://opengameart.org/content/determined-pursuit-epic-orchestra-loop | Emma_MA | `music_chase` |
| Suspicious Loop, https://opengameart.org/content/suspicious-loop | Hazmat Harry | `music_sneak` |
| Jungle Thriller, https://opengameart.org/content/jungle-thriller | iamoneabe | `music_tension` |
| Forest Ambience, https://opengameart.org/node/23888 | TinyWorlds | `amb_day` |
| Crickets Ambient Noise - loopable, https://opengameart.org/content/crickets-ambient-noise-loopable | Wolfgang_ | `amb_night` |
| T-rex Calls, https://opengameart.org/content/t-rex-calls | CaveboyTup | `trex_roar`, `trex_growl`, `trex_die` |
| 80 CC0 creature SFX, https://opengameart.org/content/80-cc0-creature-sfx | rubberduck | `raptor_call_1`, `raptor_call_2`, `raptor_bite_1`, `raptor_bite_2`, `trex_bite` |
| 80 CC0 creture SFX #2, https://opengameart.org/content/80-cc0-creture-sfx-2 | rubberduck | `raptor_hiss`, `raptor_bite_3`, `raptor_die`, `trike_bellow`, `guest_cry` |
| 100 CC0 metal and wood SFX, https://opengameart.org/content/100-cc0-metal-and-wood-sfx | rubberduck | `build`, `tower`, `engineer_work_1` to `3`, `fence_breach` |
| 75 CC0 breaking / falling / hit sfx, https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx | rubberduck | `jeep_wreck` |
| 30 CC0 SFX loops, https://opengameart.org/content/30-cc0-sfx-loops | rubberduck | `alarm_warning` |
| Sirens and Alarm Noise, https://opengameart.org/content/sirens-and-alarm-noise | aquinn | `alarm_siren` |
| Interface Sounds, https://kenney.nl/assets/interface-sounds | Kenney | `ui_tap`, `ui_select`, `ui_order`, `ui_error`, `ui_ready`, `ui_tip`, `secured_chime` |
| Impact Sounds, https://kenney.nl/assets/impact-sounds | Kenney | `reinforce`, `jeep_door`, `fence_chain_1` to `3`, `fence_concrete_1` and `2`, `dino_down` |
| RPG Audio, https://kenney.nl/assets/rpg-audio | Kenney | `coin` |
| Music Jingles, https://kenney.nl/assets/music-jingles | Kenney | `jingle_win`, `jingle_lose` |

What the script changes, so nobody mistakes these for the originals:

- Every file is mono MP3, renamed for what it does in the game, and matched for loudness: short sounds so their loud part sits at the same level, music and backgrounds to a set loudness.
- Short sounds lose the silence at either end and get a short fade at the end.
- The T. rex's roar, growl, and death are three cuts from the one recording of calls, and the evacuation siren is one rise from the siren recording.
- The T. rex's bite is a creature bite played 6 semitones lower and slower, and the Triceratops bellow a grunt played 3 semitones lower.
- Each music and background loop has its last moment blended into its start, so the join can't click.
- `music_roundup` is the pack's full 3:45 performance (`fulltheme.ogg`), made mono and matched for loudness like the rest. The pack's separate intro, theme, and outro files are not used.

## Made for this project

- `audio/`: the dart shots (light and heavy), the power going down and coming back, the "?" when a raptor notices a troop, and the sting when a troop is lost. Made by `scripts/audio3d.py` from noise and tones. No recordings.
- The Patrol 4x4's engine, made by the game while it runs (`src/audio/engine.ts`) from pulses and noise. No recording.
- `terrain/`: grass, meadow, dirt, jungle floor, flagstone, gravel, sand, concrete, and mud textures, their normal maps, and the macro noise. Generated by `scripts/terrain_textures.py` from noise. No source images.
- Everything built in code: the HQ and its patrol car, towers, fences in every state, the gate, viewing decks, lamps, the nest, signs, the security emblem, and all effects.
- `icons/`: the Home Screen icons, the security emblem on night-park green. Drawn by `scripts/icons3d.mjs`. No source images.
- `stills/`: level 3 game snapshots, saved from the game, for `still.html`.
