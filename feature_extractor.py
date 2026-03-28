import math
from typing import Dict, List, Tuple


class FeatureExtractor:
    """Extracts higher-order behavioral features for state detection."""

    def __init__(self) -> None:
        self._feature_keys = (
            "iki_mean",
            "iki_std",
            "hold_duration_mean",
            "error_rate",
            "burst_avg_length",
            "modifier_ratio",
            "path_straightness",
            "scroll_reversal_rate",
            "click_rate",
            "pause_density",
        )

    def extract(self, raw: Dict) -> Dict[str, float]:
        """Computes robust keyboard and mouse features for each window.

        Returns rounded float features; returns zeros on low-data windows or any error.
        """
        try:
            key_presses = raw.get("key_presses", [])
            key_releases = raw.get("key_releases", [])
            error_keys = raw.get("error_keys", [])
            typing_bursts = raw.get("typing_bursts", [])
            modifier_keys = raw.get("modifier_keys", [])

            mouse_positions = raw.get("mouse_positions", [])
            click_events = raw.get("click_events", [])
            scroll_events = raw.get("scroll_events", [])
            mouse_pauses = raw.get("mouse_pauses", [])

            window_sec = float(raw.get("window_sec", 0.0))

            if len(key_presses) < 3 or len(mouse_positions) < 2:
                return self._zeros()

            key_times = sorted(float(t) for t, _ in key_presses)
            iki_values = [key_times[i] - key_times[i - 1] for i in range(1, len(key_times))]

            iki_mean = self._mean(iki_values)
            iki_std = self._std(iki_values, iki_mean)

            hold_duration_mean = self._hold_duration_mean(key_presses, key_releases)
            error_rate = len(error_keys) / max(len(key_presses), 1)
            burst_avg_length = self._mean([float(burst[2]) for burst in typing_bursts if len(burst) > 2])
            modifier_ratio = len(modifier_keys) / max(len(key_presses), 1)

            path_straightness = self._path_straightness(mouse_positions)
            scroll_reversal_rate = self._scroll_reversal_rate(scroll_events)
            click_rate = len(click_events) / max(window_sec, 1e-9)
            pause_density = len(mouse_pauses) / max(window_sec, 1e-9)

            features = {
                "iki_mean": iki_mean,
                "iki_std": iki_std,
                "hold_duration_mean": hold_duration_mean,
                "error_rate": error_rate,
                "burst_avg_length": burst_avg_length,
                "modifier_ratio": modifier_ratio,
                "path_straightness": path_straightness,
                "scroll_reversal_rate": scroll_reversal_rate,
                "click_rate": click_rate,
                "pause_density": pause_density,
            }
            return {k: round(float(v), 4) for k, v in features.items()}
        except Exception:
            return self._zeros()

    def _zeros(self) -> Dict[str, float]:
        """Returns a stable zero-feature vector for failed or low-data windows."""
        return {key: 0.0 for key in self._feature_keys}

    @staticmethod
    def _mean(values: List[float]) -> float:
        """Returns arithmetic mean to summarize feature central tendency."""
        if not values:
            return 0.0
        return sum(values) / len(values)

    @staticmethod
    def _std(values: List[float], mean_value: float) -> float:
        """Returns population standard deviation to capture feature variability."""
        if not values:
            return 0.0
        variance = sum((v - mean_value) ** 2 for v in values) / len(values)
        return math.sqrt(max(variance, 0.0))

    def _hold_duration_mean(
        self,
        key_presses: List[Tuple[float, str]],
        key_releases: List[Tuple[float, str]],
    ) -> float:
        """Approximates key hold duration by nearest forward release per key label."""
        releases_by_key: Dict[str, List[float]] = {}
        for rel_t, rel_key in key_releases:
            releases_by_key.setdefault(str(rel_key), []).append(float(rel_t))

        for times in releases_by_key.values():
            times.sort()

        indices = {k: 0 for k in releases_by_key}
        durations: List[float] = []

        for press_t, press_key in key_presses:
            key = str(press_key)
            rel_list = releases_by_key.get(key)
            if not rel_list:
                continue

            idx = indices.get(key, 0)
            while idx < len(rel_list) and rel_list[idx] < float(press_t):
                idx += 1
            if idx < len(rel_list):
                duration = rel_list[idx] - float(press_t)
                if duration >= 0:
                    durations.append(duration)
                idx += 1
            indices[key] = idx

        return self._mean(durations)

    def _path_straightness(self, mouse_positions: List[Tuple[float, int, int]]) -> float:
        """Returns path efficiency ratio, where higher values indicate more curved paths."""
        if len(mouse_positions) < 2:
            return 1.0

        total_distance = 0.0
        for i in range(1, len(mouse_positions)):
            _, x1, y1 = mouse_positions[i - 1]
            _, x2, y2 = mouse_positions[i]
            total_distance += math.hypot(x2 - x1, y2 - y1)

        _, x_start, y_start = mouse_positions[0]
        _, x_end, y_end = mouse_positions[-1]
        displacement = math.hypot(x_end - x_start, y_end - y_start)

        if displacement == 0:
            return 1.0
        return total_distance / displacement

    def _scroll_reversal_rate(self, scroll_events: List[Tuple[float, float, int]]) -> float:
        """Computes direction-change frequency to capture scroll indecision patterns."""
        if not scroll_events:
            return 0.0

        reversals = 0
        last_dir = None
        for event in scroll_events:
            if len(event) < 3:
                continue
            direction = int(event[2])
            if last_dir is not None and direction != last_dir:
                reversals += 1
            last_dir = direction

        return reversals / max(len(scroll_events), 1)
