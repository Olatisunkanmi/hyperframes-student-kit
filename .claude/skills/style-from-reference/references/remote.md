# Running the analyzer on a server

The analyzer has no dependency on this repo. `scripts/` is the whole tool: copy that folder anywhere
with Python 3.10 to 3.12 and ffmpeg, run `setup.sh`, and `style-ref` behaves the same as it does locally.
Only the analysis moves to the server. Reading the contact sheets and writing the style pack still
happen wherever the agent runs.

## What the server needs

| Resource | Amount |
| --- | --- |
| Disk | about 3 GB for the environment and models, plus about 150 MB per reference while it is analysed |
| Memory | 4 GB free at peak (stages run one at a time) |
| CPU | any; a 60-second video takes a few minutes. A GPU is optional (`STYLE_REF_TORCH=cuda`, `--device cuda`) |
| Network | outbound HTTPS for the first model download and for fetching each reference |

Everything installed lives under `STYLE_REF_HOME` (default `~/.cache/style-from-reference`). Deleting
that folder uninstalls it.

## Option A: plain SSH

```bash
# one-time install
rsync -a .claude/skills/style-from-reference/scripts/ <host>:style-from-reference/
ssh <host> 'bash style-from-reference/setup.sh'

# per reference: analyse there, bring back only what the agent reads
ssh <host> 'bash style-from-reference/style-ref analyze "<url>" --out style-ref-runs/<slug>'
rsync -a --exclude work --exclude source <host>:style-ref-runs/<slug>/ tmp/style-ref/<slug>/
```

For a local file instead of a URL, copy it up first (`scp video.mp4 <host>:`) and pass its server path.
For a closer look at a moment, run `bash style-from-reference/style-ref frames style-ref-runs/<slug> --range <a> <b>` on the server
and rsync `sheets/` again. To audition the music stem, rsync without `--exclude work`.

Paths inside `analysis.json` are server paths. `REPORT.md` lists the contact sheets relative to the
run folder, so use it to find them after copying.

## Option B: container

```bash
docker build -t style-ref .claude/skills/style-from-reference/scripts
docker run --rm -v "$PWD/tmp/style-ref:/runs" style-ref analyze "<url>" --out /runs/<slug>
```

The image installs CPU wheels and downloads the models at build time, so a running container needs the
network only to fetch the reference. Build with `--build-arg WARM=0` for a smaller image that downloads
models on first use (mount a volume at `/opt/style-ref` to keep them).

## Keeping it working

- TikTok and Instagram change often. When a download fails, update the downloader first:
  `"$STYLE_REF_HOME/venv/bin/python" -m pip install --upgrade yt-dlp`.
- `style-ref doctor` checks the install and prints its disk use. `style-ref selftest` runs the unit tests.
- Versions are pinned in `requirements.txt`. Demucs needs the pinned torchaudio; upgrade them together.
