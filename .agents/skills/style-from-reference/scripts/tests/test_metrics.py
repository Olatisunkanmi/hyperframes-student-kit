"""Unit tests for the pure metrics. Run with: style-ref selftest"""
import unittest

from sfr.metrics import (
    classify_onsets,
    frame_plan,
    is_near,
    on_beat_ratio,
    parse_scene_scores,
    pick_cuts,
    shot_stats,
    speech_stats,
    spread,
)

FFMPEG_OUTPUT = """frame:0    pts:0       pts_time:0
lavfi.scene_score=0.000000
frame:1    pts:512     pts_time:0.033333
lavfi.scene_score=0.012000
frame:2    pts:1024    pts_time:1.5
lavfi.scene_score=0.640000
"""


class SceneScores(unittest.TestCase):
    def test_parses_time_and_score_pairs(self):
        self.assertEqual(parse_scene_scores(FFMPEG_OUTPUT), [(0.0, 0.0), (0.033333, 0.012), (1.5, 0.64)])

    def test_keeps_only_scores_at_or_above_threshold(self):
        self.assertEqual(pick_cuts([(1.0, 0.29), (2.0, 0.3), (3.0, 0.9)], 0.3), [2.0, 3.0])

    def test_drops_a_second_cut_inside_the_minimum_gap(self):
        self.assertEqual(pick_cuts([(2.0, 0.8), (2.1, 0.9), (2.5, 0.8)], 0.3), [2.0, 2.5])

    def test_never_reports_a_cut_at_time_zero(self):
        self.assertEqual(pick_cuts([(0.0, 1.0)], 0.3), [])


class ShotStats(unittest.TestCase):
    def test_cuts_become_shots_that_cover_the_whole_video(self):
        stats = shot_stats([2.0, 5.0], 10.0)
        self.assertEqual([s["length"] for s in stats["shots"]], [2.0, 3.0, 5.0])
        self.assertEqual(stats["shot_count"], 3)
        self.assertEqual(stats["median_shot"], 3.0)
        self.assertEqual(stats["cuts_per_10s"], 2.0)
        self.assertEqual(stats["cuts_in_first_3s"], 1)

    def test_a_video_without_cuts_is_one_shot(self):
        stats = shot_stats([], 8.0)
        self.assertEqual(stats["shot_count"], 1)
        self.assertEqual(stats["longest_shot"], 8.0)


class Beats(unittest.TestCase):
    def test_is_near_checks_both_neighbours(self):
        self.assertTrue(is_near(1.05, [0.0, 1.0, 2.0], 0.08))
        self.assertTrue(is_near(0.95, [0.0, 1.0, 2.0], 0.08))
        self.assertFalse(is_near(1.5, [0.0, 1.0, 2.0], 0.08))

    def test_ratio_counts_cuts_on_beats_and_reports_the_chance_level(self):
        result = on_beat_ratio([1.0, 2.02, 2.5, 3.5], [0.0, 1.0, 2.0, 3.0, 4.0])
        self.assertEqual(result["ratio"], 0.5)
        self.assertEqual(result["chance"], 0.16)

    def test_ratio_is_unknown_without_beats(self):
        self.assertIsNone(on_beat_ratio([1.0], [])["ratio"])


class Onsets(unittest.TestCase):
    def setUp(self):
        # A sparse bed of quiet onsets, then a stretch of steady loud drums from 20 s to 30 s.
        quiet = [{"t": 0.5 + i, "strength": 1.0} for i in range(20)]
        drums = [{"t": 20.0 + i * 0.5, "strength": 9.0} for i in range(20)]
        self.bed = [*quiet, *drums]
        self.beats = [i * 0.5 for i in range(60)]

    def times(self, onsets, cuts=()):
        return [found["t"] for found in classify_onsets(onsets, self.beats, list(cuts))]

    def test_keeps_a_one_off_loud_sound_over_a_quiet_bed(self):
        self.assertEqual(self.times([*self.bed, {"t": 7.3, "strength": 9.0}]), [7.3])

    def test_keeps_it_even_when_it_falls_exactly_on_a_beat(self):
        self.assertEqual(self.times([*self.bed, {"t": 7.0, "strength": 9.0}]), [7.0])

    def test_drops_steady_drums_that_are_as_loud_as_their_neighbours(self):
        self.assertEqual(self.times(self.bed), [])

    def test_keeps_a_drum_hit_that_lands_on_a_cut(self):
        self.assertEqual(self.times(self.bed, cuts=[25.0]), [25.0])

    def test_two_onsets_from_one_sound_count_once(self):
        doubled = [*self.bed, {"t": 7.3, "strength": 9.0}, {"t": 7.39, "strength": 5.0}]
        self.assertEqual(self.times(doubled), [7.3])

    def test_no_onsets_gives_no_candidates(self):
        self.assertEqual(classify_onsets([], [], []), [])


class Speech(unittest.TestCase):
    WORDS = [
        {"text": "Stop", "start": 0.2, "end": 0.5},
        {"text": "scrolling", "start": 0.5, "end": 1.0},
        {"text": "now", "start": 4.0, "end": 4.2},
    ]

    def test_pace_hook_and_pause(self):
        stats = speech_stats(self.WORDS, 10.0)
        self.assertEqual(stats["hook_text"], "Stop scrolling")
        self.assertEqual(stats["first_word_at"], 0.2)
        self.assertEqual(stats["longest_pause"], 3.0)
        self.assertEqual(stats["words_per_second"], 0.75)

    def test_silent_video_has_no_speech(self):
        self.assertEqual(speech_stats([], 10.0)["word_count"], 0)


class FramePlan(unittest.TestCase):
    def test_spread_keeps_first_and_last(self):
        self.assertEqual(spread(list(range(10)), 4), [0, 3, 6, 9])
        self.assertEqual(spread([1, 2], 4), [1, 2])

    def test_plan_stays_inside_the_video(self):
        shots = shot_stats([1.0], 2.0)["shots"]
        plan = frame_plan(shots, [1.0], 2.0, 30.0)
        self.assertEqual(plan["shots"], [0.5, 1.5])
        self.assertEqual(len(plan["cut-01"]), 6)
        self.assertTrue(all(0 <= t <= 1.9 for times in plan.values() for t in times))


if __name__ == "__main__":
    unittest.main()
