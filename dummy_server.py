from fastapi import FastAPI
import json
import threading
from collections import deque
from typing import List, Dict, Any

from session_memory import SessionMemory

app = FastAPI()
history = deque(maxlen=60)
history_lock = threading.Lock()
trend_memory = SessionMemory(max_windows=60)

@app.get("/")
def root():
    return {"message": "Dummy backend running"}


@app.get("/latest")
def latest() -> Dict[str, Any]:
    with history_lock:
        if history:
            return history[-1]
    return {
        "state": "normal",
        "features": {},
        "state_result": {
            "state": "normal",
            "confidence": 0.0,
            "signals": [],
        },
        "summary": {
            "keyboard": {},
            "mouse": {},
            "focus": {},
            "system": {},
            "state_indicators": {},
        },
    }


@app.get("/trend")
def trend() -> Dict[str, Any]:
    with history_lock:
        snapshot = list(history)

    temp_memory = SessionMemory(max_windows=60)
    for item in snapshot:
        temp_memory.push(item)
    return temp_memory.get_trend()


@app.get("/history")
def get_history(n: int = 10) -> Dict[str, Any]:
    n = max(1, min(int(n), 60))
    with history_lock:
        items = list(history)[-n:]
    return {
        "count": len(items),
        "items": items,
    }

@app.post("/data")
async def receive_data(payload: List[Dict[str, Any]]):
    print("\n📥 RECEIVED JSON ARRAY:\n")
    print(json.dumps(payload, indent=2))
    print(f"[INFO] Items received: {len(payload)}")

    if payload:
        with history_lock:
            for item in payload:
                history.append(item)
                trend_memory.push(item)

    return {
        "status": "success",
        "items_received": len(payload)
    }