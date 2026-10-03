# Brand: healthcare video mode (light, clean, trustworthy)

Source of truth for tokens is `brand.json`; fonts are in `fonts/` (Space Grotesk Bold, Inter 400/600, all SIL OFL).
Skills read this file before choosing colours, fonts, captions, and lower-thirds. It guides; it is not law:
raise a conflict with the user rather than silently breaking or silently following it.

## The guide (as given)
- Colours: Paper #FFFFFF, Deep Navy #0A1628 (headlines), Teal #0E7C7B (accents), Amber #F5A623 sparingly (CTAs, accent bars),
  Ink #1A1A1A (body), Muted Slate #5B6B7A (secondary).
- Fonts: Space Grotesk Bold (titles, headlines), Inter (body, captions).
- Monogram "OI": Space Grotesk Bold, amber on navy rounded square; on intro bumper, outro card, thumbnails.
- Specs: 1-3 min, 1080x1350 (4:5) for the LinkedIn feed. Hook in the first 3 s: bold statement/question, navy on white.
  Burned-in captions: Inter SemiBold, white on a navy backing bar, centred in the lower third.
  Lower-third on first appearance: "Olasunkanmi Igbasan - Backend Engineer", navy bar, amber rule above the name.
  2 s intro bumper (monogram on navy). Outro card: monogram, "Follow for the build", amber accent bar.
  Pacing: cut silences and filler; B-roll/screen recordings where they add clarity.
- Episodes: title "Segment & Resource #N - [milestone, 8 words or fewer]"; deliver video + thumbnail (navy, Space Grotesk
  headline of 6 words or fewer, monogram top-left, amber bar) + LinkedIn caption (hook first line, 3-5 plain-text hashtags,
  never unicode-bold, one-line takeaway). Only cut episodes tied to real milestones; say so if the material is thin.
- Don'ts: no stock-photo cliches (handshakes, stethoscopes); real product/screens or clean graphics; no colours or fonts
  outside the palette.

## Measured rules the guide does not state (WCAG contrast of the palette)
| text on | ratio | use |
|---|---|---|
| navy on paper | 18.1 | everything |
| teal on paper | 5.0 | labels and accents, fine |
| slate on paper | 5.5 | secondary text, fine |
| amber on paper | **2.0 FAILS** | never text. Fills, rules and accent bars only |
| paper on navy | 18.1 | captions, lower-third |
| amber on navy | 9.0 | emphasis text on navy is fine |
| teal on navy | **3.6** | large text and graphics only, never small text |
| slate on navy | **3.3** | large text only |

## Resolved decisions (this pipeline)
- Overlay graphics are white (paper) cards with navy type and teal accents: matches "light, clean" and the navy-on-white
  hook. Amber appears only as accent bars/rules on cards and as emphasis numbers on navy (captions).
- The "problem" colour (previously coral) becomes navy numerals plus an amber bar; no colour outside the palette.
- Captions: Inter SemiBold white on a navy bar; numbers in amber. The earlier word-pop style is retired for brand work.
- Lower-third sits BELOW the captions; the top band of the frame stays free for graphics, the face stays clear.
- Fonts are embedded from `brand/fonts` (the renderer's auto-list does not include Space Grotesk).
- Default format for brand work is 4:5, BUT ask which platform/format at the start of EVERY new video (LinkedIn 4:5, TikTok/Reels/Shorts 9:16, ...). Never assume.
- Lower-third title is "Software Engineer" (user decision; the guide's "Backend Engineer" is overridden).
- Hook first, then the 2 s monogram bumper, then the body (user decision). Outro card appended after the body.

## Open (needs the user)
- Whether non-milestone explainers (like the EMR clip) use the episode title/thumbnail/caption workflow.
- Thumbnail and LinkedIn caption draft are specified by the guide but not built yet.
