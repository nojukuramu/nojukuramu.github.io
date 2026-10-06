# Sounds

Every file here is free to use. All but the announcer's WARLORD lines are public domain (CC0 1.0);
those are CC BY-SA 4.0, credited below as their licence asks, and stay under that licence.

Each was trimmed to the one event the game plays, mixed down to mono, peak-normalised, faded at its
tail and encoded as a small MP3 (44.1 kHz). A few were pitched, as noted. Until a file has loaded the
game plays its own synthesised version instead (`js/audio.js`), so none of them is ever waited for.

## Guns — CC0 1.0

From **The Free Firearm Sound Library** by Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney
(https://opengameart.org/content/the-free-firearm-sound-library). Each gun has a near take (yours, and
anyone close) and a mid-distance take (`_far`, anyone more than ~28 m away).

| File | Recording |
|------|-----------|
| `wasp.mp3`, `wasp_far.mp3` | Walther PPQ 9 mm, `X_39P` / `X_31P` |
| `brick.mp3`, `brick_far.mp3` | 1911 .45, `A_42P` / `A_34P`, pitched down 8% |
| `hornet.mp3`, `hornet_far.mp3` | Carl Gustav M45 9 mm, `G_31P` / `G_20P` |
| `kestrel.mp3`, `kestrel_far.mp3` | AR-15 5.56, `D_32P` / `D_24P` |
| `mauler.mp3`, `mauler_far.mp3` | Benelli Nova 12 ga, `O_21P` / `O_17P` |
| `talon.mp3`, `talon_far.mp3` | Tikka T3 .30-06, `W_29P` / `W_24P` |
| `condor.mp3`, `condor_far.mp3` | Mosin Nagant 7.62×54R, `M_21P` / `M_26P`, pitched down 16% |

## Handling — CC0 1.0

| File | Source | Author |
|------|--------|--------|
| `reload_mag.mp3` | `gunreload1.wav`, https://opengameart.org/content/gun-reload-sounds | SpringySpringo |
| `reload_rifle.mp3` | `assaultriflereload1_0.wav`, same page | SpringySpringo |
| `pump.mp3` | `shotguncock_0.wav`, same page | SpringySpringo |
| `clip.mp3` | `clipload1.wav`, https://opengameart.org/content/gun-reload-sound-effects | BMacZero |
| `shell.mp3` | `Subsequent Shells.mp3`, https://opengameart.org/content/shotgun-reload-sound-effects | zer0_sol |
| `rack.mp3` | `Rack.mp3`, same page | zer0_sol |
| `bolt.mp3` | the opening bolt-action clicks of `equipment_clicks3.wav`, https://opengameart.org/content/equipment-clicks-iii | LFA |

## Blades, steps, metal, voices — CC0 1.0

| File | Source | Author |
|------|--------|--------|
| `slice.mp3`, `slice2.mp3`, `chop.mp3` (pitched down 10%), `draw.mp3` | `knifeSlice`, `knifeSlice2`, `chop`, `drawKnife1` from **50 RPG sound effects**, https://opengameart.org/content/50-rpg-sound-effects | Kenney (kenney.nl) |
| `step1.mp3` … `step4.mp3` | `footstep00` … `footstep03`, same pack | Kenney |
| `clank.mp3`, `dink.mp3` (pitched up 25%) | `impactMetal_000`, `impactMetal_002` from **Sci-fi Sounds**, https://opengameart.org/content/sci-fi-sounds | Kenney |
| `yelp.mp3` (pitched up 45%), `grunt.mp3` | `2yell1.wav`, `3grunt1.wav` from **Male Grunt/Yelling sounds**, https://opengameart.org/content/male-gruntyelling-sounds | HaelDB |

## Announcer

| File | Source | Author | Licence |
|------|--------|--------|---------|
| `vo_fight.mp3`, `vo_multi_kill.mp3`, `vo_combo_breaker.mp3`, `vo_final_round.mp3`, `vo_flawless_victory.mp3` | **Voiceover Pack: Fighter**, https://opengameart.org/content/voiceover-pack-fighter-40-taunts | Kenney (kenney.nl) | CC0 1.0 |
| `vo_team_deathmatch.mp3`, `vo_first_blood.mp3`, `vo_double_kill.mp3`, `vo_triple_kill.mp3`, `vo_rampage.mp3`, `vo_dominating.mp3`, `vo_unstoppable.mp3`, `vo_annihilation.mp3`, `vo_headshot.mp3`, `vo_killshot.mp3`, `vo_precision_kill.mp3`, `vo_revenge_kill.mp3`, `vo_round_winner.mp3`, `vo_game_over.mp3` | **WARLORD – Video Game Announcer**, part of the SoundBiter SFX library, https://opengameart.org/content/warlord-video-game-announcer | VoiceBosch | CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) |

The WARLORD files were changed only as described at the top (trimmed of silence, mono, normalised,
MP3). As CC BY-SA asks, these changed files are offered under the same licence.

No recording says "Nut shot" or "Collateral": those two lines are spoken by the device's own voice,
and only by one that runs on the device (`js/audio.js`).
