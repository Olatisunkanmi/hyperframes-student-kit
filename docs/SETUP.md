# Setup and troubleshooting

Start with [tools, accounts, and API keys](TOOLS-AND-API-KEYS.md) for Nate's
ElevenLabs and Kie.ai choices, Whisper alternatives, and optional services.

Use Node 22+ (required by the pinned HyperFrames CLI), FFmpeg with ffprobe, and
Chrome/Chromium. Run `npm ci` in the repository root before any project commands.
`npm run setup` checks tool availability; `npx hyperframes doctor` diagnoses the
renderer. If Chromium is unavailable, follow `npx hyperframes browser --help`.
Windows users should reopen their terminal after installing FFmpeg to refresh PATH.

The repository pins HyperFrames 0.7.109 and GSAP 3.14.2. Keep package-lock.json
with package.json. Upgrade deliberately, then repeat the render checks.

`npm run new-video -- lesson-one` copies the synthetic starter and local GSAP into
a new self-contained folder. Existing project names are refused so nothing is
overwritten. Replace the starter with your recording and planned compositions.
The left glass template needs your own `assets/source.mp4` with an audio stream.

Codex reads AGENTS.md and discovers `.agents/skills/`. Trust the project in Codex
if you want its project settings loaded. Restart if the skills do not appear.
Claude Code reads CLAUDE.md and `.claude/skills/`. Neither runtime needs a special
MCP server for local editing. The root `npm run check` validates the distribution;
it does not lint personal work under video-projects.

To update a skill, edit `.claude/skills/<name>/`, run `npm run sync:skills`, and
then `npm run check:skills`. No Windows symlink privileges are needed.

Scribe errors: a 401 generally means invalid authentication; a 403 can mean
missing speech_to_text access. Check the key's permissions without printing it.
No key is required for `npm test`, starter preview, or starter rendering.
For speech-free sources, supply a separate audio track before using the cutting
renderers: they expect one video stream and one audio stream.

## Studio workflow additions

- **Local transcription (optional, free):** `brew install whisper-cpp`, download `ggml-small.en.bin` to `~/.cache/whisper-cpp/`
  (commands in TOOLS-AND-API-KEYS.md), then `node scripts/transcribe-local.mjs <video>`. It cleans up stutters, so keep ElevenLabs
  Scribe for mistake detection.
- **Stop local services:** `npm run stop` stops the preview servers, headless Chrome, ffmpeg and whisper this repo started, and
  nothing else. Claude Code runs it from the SessionEnd hook in `.claude/settings.json` (open `/hooks` once or restart if the
  settings file is new). Codex has no such hook: run it before finishing a session.
- **Generated, not committed:** `sounds/sfx/` (rebuild with `node scripts/sound-design.mjs generate`) and `luts/*.cube`
  (rebuild with `python3 luts/make-soft-pastel-lut.py`).
- **Platform notes:** `npm test` skips tests that need ffmpeg, ps or lsof when they are missing. `stop-services` supports
  macOS/Linux only; on Windows it prints how to stop things by hand. The studio scripts were developed and verified on macOS.
