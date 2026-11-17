# Kinetic Serif Mix

A caption-led look for vertical talking-head shorts, measured from one reference clip (numbers in
`reference-profile.json`). The words are the graphics: there are no panels, bars, or lower-thirds.

## What it looks like
- **Word stacks.** Two to five spoken words appear one at a time, each on its spoken time, and stack into
  2 to 4 short lines beside or below the speaker. A stack clears before the next one starts.
- **Two voices of type.** Content words are Poppins SemiBold, tightly tracked. Small words (the, of, to, is,
  that...) are Playfair Display Italic. One chosen word per idea is a large Poppins Bold "hero" on its own line.
- **Text cards.** A few lines take the whole screen: near-white background, near-black type, a small sans line
  over one large italic serif word, and a single red glyph (?, !, +, a fraction) above. The voice carries on.
- **Camera.** Hard zoom jumps between framings at sentence ends (about every 2 to 4 s), with a slow 3% drift
  inside each shot. Footage is darkened top and bottom so white type reads on any background.
- **Colour.** White, near-black, one red (#e3000f). Nothing else.

## Motion
- Word in: opacity 0 to 1, blur 16 px to 0, 16 px rise, 0.26 s, `power2.out`, starting 50 ms before the word.
- Stack out: 0.1 s blur-and-fade. No slide, no bounce.
- Card in: hard cut, preceded by a two-frame red flash. Glyph pops with a slight rotation.
- Sound: one whoosh into each card and one tick back out. Ordinary caption words are silent. No music bed.

## Using it
`kinetic.mjs` builds all of the above from the transcript. A project's `beats.mjs` only chooses hero words and
which spoken ranges become cards; `video.json` sets `"captions": false, "lowerThird": false, "camera": false`.
The header of `kinetic.mjs` shows a complete call. Fonts are in `fonts/`: Poppins and Playfair Display, both under
the SIL Open Font License 1.1 (licence texts beside them).

## What not to do
- No more than one hero word per stack, and no more than about one text card per 15 s.
- No caption bar, box, or outline behind the words. No second accent colour.
- Do not let a stack sit over the eyes or mouth; slots are above the head and on the chest.
- Do not use it where the speech needs diagrams: this style explains nothing the speaker does not say.

## Limits
- Slots are tuned on 1080x1920 with a centred speaker. 4:5 is scaled from those numbers and has not been
  checked on rendered frames.
- The reference cut to B-roll for a quarter of its length. This pack has no B-roll mechanism.
