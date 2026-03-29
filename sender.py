import json
import os
from typing import Any, Dict, List
import requests

BACKEND_URL = os.getenv("COGNISENSE_DATA_URL", "http://127.0.0.1:8001/data")
DEBUG = False

def send_to_backend(data: List[Dict[str, Any]]) -> bool:
    """Send payload to backend as JSON. Returns True on HTTP 2xx."""
    try:
        assert isinstance(data, list), f"Payload must be list, got {type(data)}"

        print(f"[DEBUG] Payload Python type: {type(data)}")

        if DEBUG:
            print("\n🚀 PAYLOAD SENT TO BACKEND:\n")
            print(json.dumps(data, indent=2))

        payload_size = len(json.dumps(data))
        print(f"[DEBUG] Payload size: {payload_size} bytes\n")
        print(f"[INFO] Sending to: {BACKEND_URL}")

        # ✅ Clean way to send JSON
        resp = requests.post(
            BACKEND_URL,
            json=data,   # auto handles serialization + headers
            timeout=10,
        )

        print(f"[INFO] Backend response status: {resp.status_code}")

        if not (200 <= resp.status_code < 300):
            print(f"[WARN] Backend response body: {resp.text}")

        return 200 <= resp.status_code < 300

    except requests.exceptions.RequestException as err:
        print(f"[ERROR] Request failed while sending batch: {err}")
    except Exception as err:
        print(f"[ERROR] Unexpected send failure: {err}")

    return False