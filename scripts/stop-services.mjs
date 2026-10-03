#!/usr/bin/env node
// End-of-session cleanup: stop every local process THIS repo's pipeline may have left running
// (HyperFrames preview/render servers, headless Chrome, preview file servers, ffmpeg, whisper, the builder).
//
//   node scripts/stop-services.mjs [--dry-run] [--quiet] [--json] [--root <dir>]
//   npm run stop
//
// Safety rules (so it can never hurt anything that is not ours):
//   - A process is only a candidate when it is a KNOWN pipeline tool (hyperframes, chrome-headless-shell, ffmpeg,
//     ffprobe, whisper-cli, serve/http-server, vite, scripts/build-video.mjs) AND it belongs to this repo:
//     its working directory is inside the repo, or its command line mentions the repo path, or it is a descendant
//     of such a process, or it is an ORPHANED headless-Chrome shell (parent pid 1).
//   - Never touched: this script and its ancestors, shells, Claude Code, editors and their extensions (VS Code,
//     SonarLint, ...), Raycast, and Playwright/MCP browsers.
//   - SIGTERM first, SIGKILL only for survivors after a short grace period.
// Exit code 0 = nothing of ours left running; 1 = something survived (listed).
//
// Wired to run automatically when a Claude Code session ends (.claude/settings.json, SessionEnd hook).
// Codex has no session-end hook: its instructions (AGENTS.md) require running this before finishing.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit, pid as selfPid } from "node:process";

const args = new Set(argv.slice(2));
const DRY = args.has("--dry-run"), QUIET = args.has("--quiet"), JSON_OUT = args.has("--json");
// --root <dir> scopes the cleanup to another folder (used by the tests so they never touch the live repo).
const rootIdx = argv.indexOf("--root");
const ROOT = realpathSync(rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const KNOWN = /(hyperframes|chrome-headless-shell|Chrome Headless Shell|\bffmpeg\b|\bffprobe\b|whisper-cli|http-server|\bserve\b|\bvite\b|scripts\/build-video\.mjs)/i;
// Programs that are unambiguously pipeline tools: only the Playwright/MCP browser exemption applies to them, so a
// stray ffmpeg working on a path that happens to contain "claude" (scratch dirs do) is still ours to stop.
const TOOL_EXE = /^(ffmpeg|ffprobe|whisper-cli|chrome-headless-shell|Chrome Headless Shell)$/i;
const BROWSER_OF_OTHERS = /(playwright|\bmcp\b)/i;
const PROTECTED_RE = /(claude|\.vscode|sonarlint|raycast|playwright|\bmcp\b|\/bin\/(zsh|bash|sh|fish)\b|^-?(zsh|bash|sh)\b|tmux|sshd|Visual Studio Code|Code Helper|cursor)/i;
const exeOf = (cmd) => (cmd.split(/\s+/)[0] ?? "").split("/").pop();
const isProtected = (cmd) => (TOOL_EXE.test(exeOf(cmd)) ? BROWSER_OF_OTHERS.test(cmd) : PROTECTED_RE.test(cmd));

function ps() {
  const r = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return r.stdout.split("\n").map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
}
function cwds() {
  const r = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpn"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const map = new Map(); let cur = null;
  for (const line of r.stdout.split("\n")) { if (line[0] === "p") cur = +line.slice(1); else if (line[0] === "n" && cur) map.set(cur, line.slice(1)); }
  return map;
}
const inRoot = (p) => p === ROOT || p.startsWith(ROOT + sep);

function findOurs() {
  const procs = ps(), byPid = new Map(procs.map((p) => [p.pid, p])), cw = cwds();
  // self + ancestors are never touched
  const safe = new Set(); for (let p = selfPid; p && byPid.has(p); p = byPid.get(p).ppid) safe.add(p);
  const ours = new Map();
  for (const p of procs) {
    if (safe.has(p.pid) || isProtected(p.cmd) || !KNOWN.test(p.cmd)) continue;
    const mine = inRoot(cw.get(p.pid) ?? "") || p.cmd.includes(ROOT) || (/chrome-headless-shell|Chrome Headless Shell/i.test(p.cmd) && p.ppid === 1);
    if (mine) ours.set(p.pid, p);
  }
  // descendants of ours (still excluding protected and self)
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) if (!ours.has(p.pid) && ours.has(p.ppid) && !safe.has(p.pid) && !isProtected(p.cmd)) { ours.set(p.pid, p); grew = true; }
  }
  return [...ours.values()];
}
// "Running" means not gone and not a zombie: a killed child lingers as a zombie until its parent reaps it.
const alive = (pid) => {
  const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
  return stat !== "" && !stat.startsWith("Z");
};
const sleep = (ms) => spawnSync("sleep", [String(ms / 1000)]);
const ports = (pids) => {
  if (!pids.length) return [];
  const r = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(",")], { encoding: "utf8" });
  return [...new Set((r.stdout.match(/:(\d+) \(LISTEN\)/g) ?? []).map((s) => s.replace(/[^0-9]/g, "")))];
};

const found = findOurs();
const report = { root: ROOT, found: found.map((p) => ({ pid: p.pid, cmd: p.cmd.slice(0, 140) })), ports: ports(found.map((p) => p.pid)), killed: [], survivors: [] };

if (!DRY && found.length) {
  for (const p of found) { try { process.kill(p.pid, "SIGTERM"); } catch {} }
  for (let i = 0; i < 10 && found.some((p) => alive(p.pid)); i++) sleep(300);
  for (const p of found) if (alive(p.pid)) { try { process.kill(p.pid, "SIGKILL"); } catch {} }
  sleep(300);
  for (const p of found) (alive(p.pid) ? report.survivors : report.killed).push({ pid: p.pid, cmd: p.cmd.slice(0, 140) });
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else if (!QUIET || report.survivors.length || (DRY && found.length)) {
  if (!found.length) console.log("stop-services: nothing of this repo is running.");
  else if (DRY) { console.log(`stop-services (dry run): would stop ${found.length} process(es)${report.ports.length ? `, ports ${report.ports.join(", ")}` : ""}:`); for (const p of report.found) console.log(`  ${p.pid}  ${p.cmd}`); }
  else {
    console.log(`stop-services: stopped ${report.killed.length} process(es)${report.ports.length ? ` (freed ports ${report.ports.join(", ")})` : ""}.`);
    for (const p of report.survivors) console.log(`  STILL RUNNING ${p.pid}  ${p.cmd}`);
  }
}
exit(report.survivors.length ? 1 : 0);
