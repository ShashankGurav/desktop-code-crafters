import threading
from collections import Counter, deque
from typing import Deque, Dict, List


class SessionMemory:
    """Stores recent payload windows to provide temporal trend context."""

    def __init__(self, max_windows: int = 20) -> None:
        """Initializes bounded, thread-safe session memory for recent windows."""
        self._windows: Deque[Dict] = deque(maxlen=max_windows)
        self._lock = threading.Lock()

    def push(self, payload: Dict) -> None:
        """Appends the newest payload window so trends can be computed over time."""
        with self._lock:
            self._windows.append(payload)

    def get_dominant_state(self) -> str:
        """Returns most frequent state in the current memory horizon."""
        with self._lock:
            if not self._windows:
                return "normal"
            states = [self._extract_state(p) for p in self._windows]

        counts = Counter(states)
        return counts.most_common(1)[0][0] if counts else "normal"

    def get_trend(self) -> Dict:
        """Summarizes temporal state and feature trends from recent payload windows."""
        with self._lock:
            windows = list(self._windows)

        if not windows:
            return {
                "state_history": [],
                "dominant_state": "normal",
                "focus_streak": 0,
                "distraction_streak": 0,
                "avg_iki_mean_trend": 0.0,
                "avg_error_rate_trend": 0.0,
            }

        state_history = [self._extract_state(payload) for payload in windows]
        dominant_state = Counter(state_history).most_common(1)[0][0]

        focus_streak = self._count_suffix_streak(state_history, {"focused", "flow"})
        distraction_streak = self._count_suffix_streak(state_history, {"distracted", "stressed"})

        iki_values = [
            float(payload.get("features", {}).get("iki_mean", 0.0))
            for payload in windows
        ]
        error_values = [
            float(payload.get("features", {}).get("error_rate", 0.0))
            for payload in windows
        ]

        return {
            "state_history": state_history,
            "dominant_state": dominant_state,
            "focus_streak": focus_streak,
            "distraction_streak": distraction_streak,
            "avg_iki_mean_trend": round(sum(iki_values) / len(iki_values), 4),
            "avg_error_rate_trend": round(sum(error_values) / len(error_values), 4),
        }

    @staticmethod
    def _extract_state(payload: Dict) -> str:
        state_result = payload.get("state_result")
        if isinstance(state_result, dict):
            state = state_result.get("state")
            if isinstance(state, str) and state:
                return state
        state = payload.get("state")
        if isinstance(state, str) and state:
            return state
        return "normal"

    @staticmethod
    def _count_suffix_streak(state_history: List[str], bucket: set) -> int:
        streak = 0
        for state in reversed(state_history):
            if state in bucket:
                streak += 1
            else:
                break
        return streak
