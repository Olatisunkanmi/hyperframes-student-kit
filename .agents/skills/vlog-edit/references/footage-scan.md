# Footage scan

Goal: turn a folder of clips into `assets/footage-ledger.json` the shot list can draw from. Work per clip, write
intermediate output into `<project>/review/scan/` (gitignored with the project).

## 1. Inventory

```sh
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,duration:stream_side_data=rotation:stream_tags=rotate:format=duration \
  -of json <clip>
```

Record duration, resolution, fps, rotation, and whether fps is variable (r_frame_rate != avg_frame_rate). Flag
HDR/10-bit sources and portrait clips going into a landscape cut.

## 2. Signals (ffmpeg 7+ filters; all verified present in this kit's ffmpeg)

| Filter | Finds | Use |
|---|---|---|
| `scdet=threshold=10` | scene changes inside a clip | split a long clip into candidate segments |
| `freezedetect=n=-60dB:d=0.5` | frozen frames | reject dead segments |
| `blurdetect` | blur score per frame | drop blurry segments; average over each candidate |
| `signalstats` (YAVG) | brightness | flag black (<16) and blown-out (>235) frames |

Example (all signals in one pass, log to a file, never re-run to see more):

```sh
ffmpeg -hide_banner -i <clip> -vf "scdet=threshold=10,freezedetect=n=-60dB:d=0.5,blurdetect,signalstats,metadata=print:file=review/scan/<clip>.txt" -an -f null -
```

Signals are hints. A low blur score can be an intentional shallow depth of field; a scene change can be a whip pan.

## 3. Contact sheets (the real selection step)

```sh
ffmpeg -i <clip> -vf "fps=1/2,scale=320:-1,tile=6x4" -frames:v 1 review/scan/<clip>-sheet.jpg
```

Open every sheet. For each candidate segment note: subject, scale (wide/medium/detail), light, movement visible from
adjacent frames, and any defect. Sheets show stills, so movement quality is inferred, not seen.

## 4. Ledger shape

```json
{
  "clips": [{
    "file": "assets/clips/IMG_0412.mp4",
    "duration": 18.4, "fps": 30, "orientation": "landscape",
    "segments": [{ "in": 2.0, "out": 5.5, "score": 4, "scale": "wide",
                   "tags": ["market", "street", "morning"], "defects": [], "needsUserConfirm": false }],
    "rejected": [{ "in": 0.0, "out": 2.0, "reason": "frozen start" }]
  }]
}
```

Keep the rejected list: it saves re-scanning and explains choices at the shot-list gate.
