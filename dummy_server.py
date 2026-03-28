from fastapi import FastAPI
import json
from typing import List, Dict, Any

app = FastAPI()

@app.get("/")
def root():
    return {"message": "Dummy backend running"}

@app.post("/data")
async def receive_data(payload: List[Dict[str, Any]]):
    print("\n📥 RECEIVED JSON ARRAY:\n")
    print(json.dumps(payload, indent=2))
    print(f"[INFO] Items received: {len(payload)}")

    return {
        "status": "success",
        "items_received": len(payload)
    }