# reference-profile.json

One file per style pack, at `style-library/<NN>-<slug>/reference-profile.json`. It holds what the
reference analysis found, in a form the editing skills can act on. It contains numbers and
descriptions only: no frames, audio, transcript text, or other media from the reference.

Every value belongs to one of three confidence groups, listed under `confidence`:

- **measured**: read from `analysis.json` (cuts, tempo, loudness, pace).
- **observed**: seen by the agent on the contact sheets (captions, layout, transitions).
- **guessed**: model labels or inference (music genre, sound-effect type, font identity).

```json
{
  "source": { "url": "https://...", "format": "1080x1920 @ 30 fps", "duration_s": 34.2 },
  "pacing": {
    "median_shot_s": 1.6,
    "cuts_per_10s": 4.1,
    "cuts_in_first_3s": 2,
    "cuts_on_beat": 0.71,
    "words_per_second": 3.4,
    "first_word_at_s": 0.1
  },
  "hook": {
    "mechanism": "Opens mid-action on the result, names the promise in the first sentence",
    "visual": "Tight crop on face, large two-word caption, first cut at 0.9 s"
  },
  "captions": {
    "position": "centre, lower third of the safe area",
    "words_per_card": 3,
    "case": "upper",
    "emphasis": "one word per card in the accent colour, scaled up",
    "animation": "pop in, about 0.12 s, no exit",
    "font_like": "heavy geometric sans (nearest licensed match: ...)"
  },
  "layout": { "framing": "chest-up, punch-in on emphasis", "broll_share": 0.3, "graphics": ["stat card", "arrow callout"] },
  "transitions": [{ "kind": "hard cut", "share": 0.8 }, { "kind": "zoom punch-in", "share": 0.2 }],
  "audio": {
    "music": {
      "named_sound": "Track / Artist as shown on the post",
      "bpm": 120,
      "genre": "lo-fi hip hop",
      "mood": "calm and relaxed",
      "rel_lu": -14,
      "duck_db": 2.5,
      "replacement": "what the user licensed or approved instead",
      "user_confirmed": false
    },
    "sfx_rules": [
      { "event": "caption emphasis word", "kit_sfx": "pop", "gain": -16, "evidence": "5 of 6 tagged pops fall on a caption change" },
      { "event": "cut to B-roll", "kit_sfx": "whoosh-up", "gain": -14, "evidence": "4 whooshes, each within 0.12 s of a cut" }
    ]
  },
  "brand_policy": "brand-wins | reference-wins | a written mix, e.g. brand fonts and bumper, reference pacing and captions",
  "does_not_transfer": ["Creator's logo sting", "The licensed track"],
  "confidence": {
    "measured": ["pacing", "audio.music.bpm", "audio.music.rel_lu", "audio.music.duck_db"],
    "observed": ["hook", "captions", "layout", "transitions"],
    "guessed": ["audio.music.genre", "audio.music.mood", "audio.sfx_rules", "captions.font_like"]
  }
}
```

## Mapping to the kit

| Profile field | Where it is used |
| --- | --- |
| `pacing.*` | Targets in the short-form plan; a reference pace is a ceiling for educational speech, not a quota |
| `captions.*`, `layout.*` | The pack's `DESIGN.md` and `tokens.css`, then the project's caption and beat design |
| `audio.sfx_rules[].kit_sfx`, `gain` | Cues for `scripts/sound-design.mjs mix` (`gain` is dB, keep effects under the voice) |
| `audio.music.rel_lu`, `duck_db` | `scripts/sound-design.mjs music --rel <rel_lu> --duck <duck_db>` |
| `brand_policy` | Decides between this pack and `brand/BRAND.md` wherever they disagree |

`kit_sfx` is one of the pack names in `scripts/sound-design.mjs` (`whoosh-up`, `whoosh-down`, `hit`,
`pop`, `tick`, `ping`, `riser`). When the reference uses a sound the pack lacks, write the label in
`event` and leave `kit_sfx` null so the gap is visible.
