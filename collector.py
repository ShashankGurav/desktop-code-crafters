import time
import threading
import ctypes
import ctypes.wintypes

from pynput import keyboard, mouse

user32 = ctypes.windll.user32

try:
    import psutil
    psutil_available = True
except ImportError:
    psutil_available = False


# ── Win32 helpers ──────────────────────────────────────────────────────────────

def get_active_window_win():
    """Returns (app_name, window_title) using Win32 API."""
    try:
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        title_buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title_buf, length + 1)
        title = title_buf.value.strip()

        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        if psutil_available:
            try:
                proc = psutil.Process(pid.value)
                app = proc.name().replace(".exe", "")
            except Exception:
                app = "Unknown"
        else:
            app = f"PID:{pid.value}"

        return app, title
    except Exception:
        return "Unknown", ""


# ── Keys that signal errors / corrections ──────────────────────────────────────

_ERROR_KEYS = {
    keyboard.Key.backspace,
    keyboard.Key.delete,
}

_MODIFIER_KEYS = {
    keyboard.Key.shift, keyboard.Key.shift_r,
    keyboard.Key.ctrl,  keyboard.Key.ctrl_r,
    keyboard.Key.alt,   keyboard.Key.alt_r,
    keyboard.Key.cmd,   keyboard.Key.cmd_r,
}


# ── Main collector ─────────────────────────────────────────────────────────────

class RawCollector:
    """
    Passively collects raw behavioural signals from keyboard, mouse, and
    the active window.  Everything is stored as lightweight timestamped
    primitives — a separate FeatureExtractor turns them into vectors.

    Signals and their cognitive relevance
    ──────────────────────────────────────
    Keyboard
      key_press_times      — inter-key interval (IKI) → typing rhythm / focus
      key_release_times    — hold-duration per key    → fatigue, motor control
      error_key_times      — backspace / delete presses → confusion, fatigue
      modifier_key_times   — Ctrl/Alt combos          → shortcut fluency
      typing_bursts        — (start, end, key_count)  → burst vs pause pattern

    Mouse
      mouse_positions      — (t, x, y)  → velocity, path straightness
      click_events         — (t, x, y, btn, double?) → decision rate
      click_corrections    — rapid click near previous click → error / fatigue
      scroll_events        — (t, dy, direction)       → scroll depth & reversal
      mouse_pauses         — gaps > threshold in movement → hesitation / thinking

    System / window
      window_switches      — (t, app, title)          → context-switch freq
      app_time_log         — {app: seconds}            → dwell time per app
      system_snapshots     — (t, cpu%, ram%)           → workload context

    Derived at collection time (cheap)
      last_active_time     — for idle gap computation
      session_start        — session duration reference
    """

    # Thresholds (seconds)
    BURST_GAP        = 1.5   # gap that ends a typing burst
    PAUSE_THRESHOLD  = 2.0   # mouse stillness → micro-pause
    CORRECTION_WINDOW = 0.6  # rapid re-click within this window = correction
    SYSTEM_POLL_INTERVAL = 5.0  # how often CPU/RAM is sampled

    def __init__(self):
        # ── Keyboard ──
        self.key_press_times   = []   # [(t, key_char_or_name)]
        self.key_release_times = []   # [(t, key_char_or_name)]
        self.error_key_times   = []   # [t]  backspace / delete
        self.modifier_key_times= []   # [t]  ctrl/alt/shift
        self.typing_bursts     = []   # [(burst_start, burst_end, key_count)]

        self._burst_count      = 0
        self._burst_start      = None
        self._last_key_time    = None

        # ── Mouse ──
        self.mouse_positions   = []   # [(t, x, y)]
        self.click_events      = []   # [(t, x, y, button, is_double)]
        self.click_corrections = []   # [t]  rapid re-click near prev position
        self.scroll_events     = []   # [(t, dy, direction)]  direction: +1/-1
        self.mouse_pauses      = []   # [(t_start, duration_sec)]

        self._last_mouse_t     = None
        self._last_mouse_xy    = (0, 0)
        self._last_click_t     = None
        self._last_click_xy    = (0, 0)
        self._in_mouse_pause   = False
        self._mouse_pause_start= None

        # ── Window / app ──
        self.window_switches   = []   # [(t, app, title)]
        self.app_time_log      = {}   # {app: total_seconds}
        self._current_window   = None
        self._current_win_start= time.time()

        # ── System ──
        self.system_snapshots  = []   # [(t, cpu_pct, ram_pct)]

        # ── Session ──
        self.session_start     = time.time()
        self.last_active_time  = time.time()
        self._lock             = threading.Lock()

    # ── Keyboard handlers ──────────────────────────────────────────────────────

    def on_key_press(self, key):
        now = time.time()
        with self._lock:
            self.last_active_time = now

            key_label = self._key_label(key)
            self.key_press_times.append((now, key_label))

            if key in _ERROR_KEYS:
                self.error_key_times.append(now)

            if key in _MODIFIER_KEYS:
                self.modifier_key_times.append(now)

            # Typing burst tracking
            if self._burst_start is None:
                self._burst_start = now
                self._burst_count = 1
            else:
                gap = now - self._last_key_time if self._last_key_time else 0
                if gap > self.BURST_GAP:
                    # Close previous burst
                    self.typing_bursts.append(
                        (self._burst_start, self._last_key_time, self._burst_count)
                    )
                    self._burst_start = now
                    self._burst_count = 1
                else:
                    self._burst_count += 1

            self._last_key_time = now

    def on_key_release(self, key):
        now = time.time()
        with self._lock:
            self.key_release_times.append((now, self._key_label(key)))

    @staticmethod
    def _key_label(key):
        try:
            return key.char if key.char else key.name
        except AttributeError:
            return str(key)

    # ── Mouse handlers ─────────────────────────────────────────────────────────

    def on_mouse_move(self, x, y):
        now = time.time()
        with self._lock:
            self.last_active_time = now

            # Detect end of a micro-pause
            if self._in_mouse_pause and self._mouse_pause_start is not None:
                duration = now - self._mouse_pause_start
                self.mouse_pauses.append((self._mouse_pause_start, duration))
                self._in_mouse_pause = False
                self._mouse_pause_start = None

            self.mouse_positions.append((now, x, y))
            self._last_mouse_t  = now
            self._last_mouse_xy = (x, y)

    def on_mouse_click(self, x, y, button, pressed):
        if not pressed:
            return
        now = time.time()
        with self._lock:
            self.last_active_time = now

            # Detect double-click or click correction
            is_double = False
            is_correction = False
            if self._last_click_t is not None:
                dt = now - self._last_click_t
                dx = abs(x - self._last_click_xy[0])
                dy = abs(y - self._last_click_xy[1])
                dist = (dx**2 + dy**2) ** 0.5

                if dt < 0.35 and dist < 10:
                    is_double = True
                elif dt < self.CORRECTION_WINDOW and dist < 60:
                    is_correction = True
                    self.click_corrections.append(now)

            btn_name = str(button).split(".")[-1]
            self.click_events.append((now, x, y, btn_name, is_double))
            self._last_click_t  = now
            self._last_click_xy = (x, y)

    def on_scroll(self, x, y, dx, dy):
        now = time.time()
        with self._lock:
            self.last_active_time = now
            direction = 1 if dy > 0 else -1
            self.scroll_events.append((now, abs(dy), direction))

    # ── Background: mouse pause detector ──────────────────────────────────────

    def _detect_mouse_pauses(self):
        """Polls every 0.5 s; if no movement for PAUSE_THRESHOLD → record pause."""
        while True:
            time.sleep(0.5)
            now = time.time()
            with self._lock:
                if self._last_mouse_t is None:
                    continue
                gap = now - self._last_mouse_t
                if gap >= self.PAUSE_THRESHOLD and not self._in_mouse_pause:
                    self._in_mouse_pause    = True
                    self._mouse_pause_start = self._last_mouse_t

    # ── Background: active-window poller ──────────────────────────────────────

    def _poll_active_window(self):
        while True:
            app, title = get_active_window_win()
            now = time.time()
            with self._lock:
                if self._current_window:
                    elapsed = now - self._current_win_start
                    self.app_time_log[self._current_window] = (
                        self.app_time_log.get(self._current_window, 0) + elapsed
                    )
                if app != self._current_window:
                    self.window_switches.append((now, app, title))
                    self._current_window    = app
                    self._current_win_start = now
            time.sleep(0.5)

    # ── Background: system resource poller ────────────────────────────────────

    def _poll_system(self):
        while True:
            if psutil_available:
                try:
                    cpu = psutil.cpu_percent(interval=None)
                    ram = psutil.virtual_memory().percent
                    now = time.time()
                    with self._lock:
                        self.system_snapshots.append((now, cpu, ram))
                except Exception:
                    pass
            time.sleep(self.SYSTEM_POLL_INTERVAL)

    # ── Query helpers ──────────────────────────────────────────────────────────

    def get_app_summary(self):
        """Sorted [(app, seconds)] for full session."""
        with self._lock:
            summary = dict(self.app_time_log)
            if self._current_window:
                elapsed = time.time() - self._current_win_start
                summary[self._current_window] = (
                    summary.get(self._current_window, 0) + elapsed
                )
        return sorted(summary.items(), key=lambda x: x[1], reverse=True)

    def get_recent_apps(self, last_n_sec=60):
        """Apps seen in the last N seconds → {app: title}."""
        cutoff = time.time() - last_n_sec
        with self._lock:
            seen = {}
            for ts, app, title in self.window_switches:
                if ts > cutoff:
                    seen[app] = title
            if self._current_window:
                seen.setdefault(self._current_window, "")
        return seen

    def get_idle_duration(self):
        """Seconds since last keyboard/mouse activity."""
        with self._lock:
            return time.time() - self.last_active_time

    def trim_old_data(self, keep_seconds: int = 300) -> None:
        """Trims stale raw events so long-running sessions do not grow memory unbounded."""
        cutoff = time.time() - keep_seconds
        with self._lock:
            self._trim_old_data_locked(cutoff)

    def _trim_old_data_locked(self, cutoff: float) -> None:
        """Applies in-place trimming for all raw signal buffers using one cutoff timestamp."""
        self.key_press_times = [(t, k) for t, k in self.key_press_times if t > cutoff]
        self.key_release_times = [(t, k) for t, k in self.key_release_times if t > cutoff]
        self.error_key_times = [t for t in self.error_key_times if t > cutoff]
        self.modifier_key_times = [t for t in self.modifier_key_times if t > cutoff]
        self.mouse_positions = [(t, x, y) for t, x, y in self.mouse_positions if t > cutoff]
        self.click_events = [(t, x, y, b, d) for t, x, y, b, d in self.click_events if t > cutoff]
        self.click_corrections = [t for t in self.click_corrections if t > cutoff]
        self.scroll_events = [(t, dy, dr) for t, dy, dr in self.scroll_events if t > cutoff]
        self.mouse_pauses = [(ts, dur) for ts, dur in self.mouse_pauses if ts > cutoff]
        self.window_switches = [(t, a, ti) for t, a, ti in self.window_switches if t > cutoff]
        self.system_snapshots = [(t, c, r) for t, c, r in self.system_snapshots if t > cutoff]

        # Keep current burst metadata coherent with trimmed key history.
        if self._last_key_time is not None and self._last_key_time <= cutoff:
            self._last_key_time = None
            self._burst_start = None
            self._burst_count = 0

        if self._last_mouse_t is not None and self._last_mouse_t <= cutoff:
            self._last_mouse_t = None
            self._in_mouse_pause = False
            self._mouse_pause_start = None

    def flush_window(self, seconds=60):
        """
        Returns a dict of raw lists sliced to the last `seconds` window.
        Intended for the FeatureExtractor to consume without locking.
        """
        cutoff = time.time() - seconds
        with self._lock:
            idle_duration = time.time() - self.last_active_time
            payload = {
                "key_presses":      [(t, k) for t, k in self.key_press_times   if t > cutoff],
                "key_releases":     [(t, k) for t, k in self.key_release_times if t > cutoff],
                "error_keys":       [t       for t    in self.error_key_times   if t > cutoff],
                "modifier_keys":    [t       for t    in self.modifier_key_times if t > cutoff],
                "typing_bursts":    [(s, e, n) for s, e, n in self.typing_bursts if e and e > cutoff],
                "mouse_positions":  [(t, x, y) for t, x, y in self.mouse_positions if t > cutoff],
                "click_events":     [(t, x, y, b, d) for t, x, y, b, d in self.click_events if t > cutoff],
                "click_corrections":[t for t in self.click_corrections if t > cutoff],
                "scroll_events":    [(t, dy, dr) for t, dy, dr in self.scroll_events if t > cutoff],
                "mouse_pauses":     [(ts, dur) for ts, dur in self.mouse_pauses if ts > cutoff],
                "window_switches":  [(t, a, ti) for t, a, ti in self.window_switches if t > cutoff],
                "system_snapshots": [(t, c, r) for t, c, r in self.system_snapshots if t > cutoff],
                "idle_duration":    idle_duration,
                "window_sec":       seconds,
            }
            self._trim_old_data_locked(time.time() - 300)
            return payload

    # ── Start ─────────────────────────────────────────────────────────────────

    def start(self):
        kb = keyboard.Listener(
            on_press=self.on_key_press,
            on_release=self.on_key_release,
        )
        ms = mouse.Listener(
            on_move=self.on_mouse_move,
            on_click=self.on_mouse_click,
            on_scroll=self.on_scroll,
        )
        threads = [
            threading.Thread(target=self._poll_active_window, daemon=True),
            threading.Thread(target=self._detect_mouse_pauses, daemon=True),
            threading.Thread(target=self._poll_system,         daemon=True),
        ]
        kb.start()
        ms.start()
        for t in threads:
            t.start()
        return kb, ms