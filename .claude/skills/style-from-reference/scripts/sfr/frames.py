"""Stage 3: pull frames and lay them out as labelled contact sheets an agent can read, plus a palette.

Also usable on demand for a closer look at any moment:
    python -m sfr.frames <out-dir> --range <start> <end> [--fps 8]
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from sfr.common import StageError, load, log, run, save
from sfr.metrics import frame_plan

FRAME_WIDTH = 540
LABEL_HEIGHT = 26
SHEET_SIZE = 12
WHAT = {
    "shots": "one frame from the middle of each shot: layout, framing, B-roll, graphics",
    "hook": "the first 3 seconds at 4 frames a second: how the opening is built",
    "even": "24 evenly spaced frames: captions and graphics that change inside a shot",
    "cut": "6 consecutive frames across one cut: the transition (hard cut, zoom, wipe, flash)",
    "range": "a requested time range",
}


def grab(video: str, time: float, dest: Path) -> bool:
    run([
        "ffmpeg", "-v", "error", "-y", "-ss", f"{time:.3f}", "-i", video,
        "-frames:v", "1", "-vf", f"scale={FRAME_WIDTH}:-2", "-q:v", "4", dest,
    ])
    return dest.exists()


def grab_set(video: str, name: str, times: list[float], folder: Path) -> list[tuple[Path, str]]:
    folder.mkdir(parents=True, exist_ok=True)
    wanted = [(folder / f"{name}-{i:03d}-{t:07.3f}.jpg", t) for i, t in enumerate(times)]
    return [(path, f"{t:.2f}s") for path, t in wanted if grab(video, t, path)]


def build_sheet(tiles: list[tuple[Path, str]], dest: Path, cols: int, tile_width: int) -> None:
    """Paste frames into a grid, each under a bar showing its timestamp."""
    first = Image.open(tiles[0][0])
    tile_height = round(first.height * tile_width / first.width)
    rows = -(-len(tiles) // cols)
    sheet = Image.new("RGB", (cols * tile_width, rows * (tile_height + LABEL_HEIGHT)), "#111111")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=18)
    for index, (path, label) in enumerate(tiles):
        x = (index % cols) * tile_width
        y = (index // cols) * (tile_height + LABEL_HEIGHT)
        draw.text((x + 6, y + 3), label, fill="#ffffff", font=font)
        sheet.paste(Image.open(path).resize((tile_width, tile_height)), (x, y + LABEL_HEIGHT))
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, quality=85)


def sheets_for(name: str, tiles: list[tuple[Path, str]], folder: Path) -> list[dict]:
    """Split a set into sheets small enough to read; cut strips are one row of six."""
    if not tiles:
        return []
    kind = "cut" if name.startswith("cut-") else name.split("-")[0]
    cols, width, size = (6, 240, 6) if kind == "cut" else (4, 320, SHEET_SIZE)
    chunks = [tiles[i : i + size] for i in range(0, len(tiles), size)]
    results = []
    for number, chunk in enumerate(chunks, start=1):
        dest = folder / (f"{name}.jpg" if len(chunks) == 1 else f"{name}-{number}.jpg")
        build_sheet(chunk, dest, cols, width)
        results.append({"sheet": str(dest), "shows": WHAT[kind], "times": [label for _, label in chunk]})
    return results


def palette(tiles: list[tuple[Path, str]], colours: int = 8) -> list[dict]:
    """Dominant colours across the evenly spaced frames, as hex with their share of the picture."""
    if not tiles:
        return []
    thumbs = [Image.open(path).convert("RGB").resize((48, 80)) for path, _ in tiles]
    strip = Image.new("RGB", (48 * len(thumbs), 80))
    for index, thumb in enumerate(thumbs):
        strip.paste(thumb, (index * 48, 0))
    reduced = strip.quantize(colors=colours, method=Image.Quantize.MEDIANCUT)
    table = reduced.getpalette()
    total = strip.width * strip.height
    counted = sorted(reduced.getcolors(), reverse=True)
    return [
        {"hex": "#{:02x}{:02x}{:02x}".format(*table[i * 3 : i * 3 + 3]), "share": round(count / total, 3)}
        for count, i in counted
    ]


def full_pass(out: Path) -> None:
    source, cuts = load(out, "fetch"), load(out, "cuts")
    plan = frame_plan(cuts["shots"], cuts["cuts"], source["duration"], source["fps"])
    sheets, even_tiles = [], []
    for name, times in plan.items():
        log(f"frames: {name} ({len(times)} frames)")
        tiles = grab_set(source["video"], name, times, out / "frames")
        sheets = [*sheets, *sheets_for(name, tiles, out / "sheets")]
        even_tiles = tiles if name == "even" else even_tiles
    save(out, "frames", {"sheets": sheets, "palette": palette(even_tiles)})


def range_pass(out: Path, start: float, end: float, fps: float) -> None:
    source = load(out, "fetch")
    if not 0 <= start < end:
        raise StageError("--range needs 0 <= start < end")
    count = min(48, max(2, round((end - start) * fps)))
    times = [round(start + i * (end - start) / count, 3) for i in range(count)]
    name = f"range-{start:.2f}-{end:.2f}"
    tiles = grab_set(source["video"], name, times, out / "frames")
    for sheet in sheets_for(name, tiles, out / "sheets"):
        print(sheet["sheet"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--range", nargs=2, type=float, metavar=("START", "END"))
    parser.add_argument("--fps", type=float, default=8.0)
    args = parser.parse_args()
    out = args.out.resolve()
    if args.range:
        range_pass(out, args.range[0], args.range[1], args.fps)
    else:
        full_pass(out)


if __name__ == "__main__":
    main()
