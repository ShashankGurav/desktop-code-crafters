from fastapi import FastAPI
import json
from typing import List, Dict, Any

app = FastAPI()
latest_item: Dict[str, Any] = {}

@app.get("/")
def root():
    return {"message": "Dummy backend running"}


@app.get("/latest")
def latest() -> Dict[str, Any]:
    if latest_item:
        return latest_item
    return {
        "state": "normal",
        "summary": {
            "keyboard": {},
            "mouse": {},
            "focus": {},
            "system": {},
            "state_indicators": {},
        },
    }

@app.post("/data")
async def receive_data(payload: List[Dict[str, Any]]):
    global latest_item

    print("\n📥 RECEIVED JSON ARRAY:\n")
    print(json.dumps(payload, indent=2))
    print(f"[INFO] Items received: {len(payload)}")

    if payload:
        latest_item = payload[-1]

    return {
        "status": "success",
        "items_received": len(payload)
    }