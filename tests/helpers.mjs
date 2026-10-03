// Shared test helpers. CI runs on Ubuntu, Windows and macOS runners that do not all have ffmpeg, ps or lsof, so tests that
// need those tools skip with a reason instead of failing. Pure-logic tests always run.
import { spawnSync } from 'node:child_process';

const exists = (cmd, args = ['-version']) => spawnSync(cmd, args, { stdio: 'ignore' }).error === undefined;
export const hasFfmpeg = exists('ffmpeg') && exists('ffprobe');
export const hasPsLsof = process.platform !== 'win32' && exists('ps', ['-o', 'pid=', '-p', '1']) && exists('lsof', ['-v']);

/** node:test option objects: pass as the second argument of test(). */
export const NEEDS_FFMPEG = { skip: hasFfmpeg ? false : 'ffmpeg/ffprobe not installed' };
export const NEEDS_PROCESS_TOOLS = { skip: hasFfmpeg && hasPsLsof ? false : 'needs ffmpeg plus ps and lsof (macOS/Linux)' };
