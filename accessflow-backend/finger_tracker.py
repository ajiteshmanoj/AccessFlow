"""
Finger Tracker Service for AccessFlow
Tracks index finger position via webcam using MediaPipe Hands.
Sends real-time position + gesture events to Chrome extension via WebSocket.

Gestures:
  - Point (index finger)        → cursor follows finger tip
  - L-shape (extend thumb)      → click element under cursor
  - Peace sign (2 fingers)      → scroll up/down

Requires: mediapipe >= 0.10.9, opencv-python, websockets
Model:    hand_landmarker.task (downloaded automatically on first run)
"""

import cv2
import numpy as np
import mediapipe as mp
import asyncio
import websockets
import json
import math
import os
import time
import urllib.request

# ── MediaPipe Tasks API aliases ──────────────────────────────────────
BaseOptions           = mp.tasks.BaseOptions
HandLandmarker        = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
HandLandmarkerResult  = mp.tasks.vision.HandLandmarkerResult
VisionRunningMode     = mp.tasks.vision.RunningMode

# ── Model path ───────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "hand_landmarker.task")
MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

# ── WebSocket clients ────────────────────────────────────────────────
connected_clients = set()

# ── Thresholds ───────────────────────────────────────────────────────
SCROLL_SENSITIVITY   = 0.020  # min vertical delta per frame to trigger scroll
THUMB_EXTEND_THRESHOLD = 0.08 # horizontal distance from thumb tip to index MCP to count as "L-shape"

# ── Shared result from async callback ────────────────────────────────
latest_result = None

# ── Gesture state machine ────────────────────────────────────────────
thumb_was_out     = False      # was thumb extended last frame?
scroll_last_y     = None       # previous y-position for scroll delta


def ensure_model():
    """Download the hand_landmarker.task model if it doesn't exist."""
    if os.path.exists(MODEL_PATH):
        return
    print(f"Downloading hand landmarker model to {MODEL_PATH}...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("Model downloaded.")


def on_result(result: HandLandmarkerResult, output_image: mp.Image, timestamp_ms: int):
    global latest_result
    latest_result = result


# ── Drawing ──────────────────────────────────────────────────────────
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (0,9),(9,10),(10,11),(11,12),
    (0,13),(13,14),(14,15),(15,16),
    (0,17),(17,18),(18,19),(19,20),
    (5,9),(9,13),(13,17),
]


def draw_landmarks(image, detection_result):
    if detection_result is None or not detection_result.hand_landmarks:
        return image
    annotated = np.copy(image)
    h, w, _ = annotated.shape
    for hand_landmarks in detection_result.hand_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand_landmarks]
        for i, j in HAND_CONNECTIONS:
            cv2.line(annotated, pts[i], pts[j], (144, 238, 144), 2)
        for px, py in pts:
            cv2.circle(annotated, (px, py), 4, (255, 255, 255), -1)
            cv2.circle(annotated, (px, py), 2, (0, 128, 255), -1)
    return annotated


# ── Gesture helpers ──────────────────────────────────────────────────
def is_thumb_extended(hand_landmarks):
    """
    Detect L-shape: thumb sticking out sideways while index points up.
    Checks horizontal distance between thumb tip (4) and index MCP (5).
    Works for both left and right hands (uses absolute distance).
    """
    thumb_tip = hand_landmarks[4]
    index_mcp = hand_landmarks[5]
    # Thumb must also be above its IP joint (not curled under)
    thumb_ip = hand_landmarks[3]
    thumb_up = thumb_tip.y < thumb_ip.y + 0.02
    horiz_dist = abs(thumb_tip.x - index_mcp.x)
    return thumb_up and horiz_dist > THUMB_EXTEND_THRESHOLD


def reset_gesture_state():
    global thumb_was_out, scroll_last_y
    thumb_was_out = False
    scroll_last_y = None


def is_finger_extended(hand_landmarks, tip_idx, pip_idx):
    """Check if a finger is extended (tip higher than PIP joint)."""
    tip = hand_landmarks[tip_idx]
    pip = hand_landmarks[pip_idx]
    return tip.y < pip.y - 0.03


def is_two_finger_scroll(hand_landmarks):
    """Detect peace sign: index + middle extended, ring + pinky curled."""
    index_up  = is_finger_extended(hand_landmarks, 8, 6)
    middle_up = is_finger_extended(hand_landmarks, 12, 10)
    ring_up   = is_finger_extended(hand_landmarks, 16, 14)
    pinky_up  = is_finger_extended(hand_landmarks, 20, 18)
    return index_up and middle_up and not ring_up and not pinky_up



def process_gestures(hand_landmarks, now):
    """
    State machine that processes hand landmarks into gesture events.

    Modes:
      - Two fingers (peace sign) → scroll: hand up/down
      - One finger (point)       → cursor follows index fingertip
      - L-shape (thumb out)      → click element under cursor
    """
    global thumb_was_out, scroll_last_y

    index_tip = hand_landmarks[8]
    x, y = index_tip.x, index_tip.y
    index_up = is_finger_extended(hand_landmarks, 8, 6)
    thumb_out = is_thumb_extended(hand_landmarks)

    # ── Two-finger scroll (peace sign) — simple delta tracking ────
    if is_two_finger_scroll(hand_landmarks):
        mid_y = (hand_landmarks[8].y + hand_landmarks[12].y) / 2

        scroll_dir = None
        if scroll_last_y is not None:
            dy = mid_y - scroll_last_y
            if dy > SCROLL_SENSITIVITY:
                scroll_dir = "scroll_down"
            elif dy < -SCROLL_SENSITIVITY:
                scroll_dir = "scroll_up"

        scroll_last_y = mid_y
        thumb_was_out = False

        return {"detected": True, "mode": "scroll", "x": x, "y": y,
                "scroll": scroll_dir}

    # Not scrolling — reset scroll state
    scroll_last_y = None

    # ── L-shape: thumb extends out → CLICK ────────────────────────
    if index_up and thumb_out and not thumb_was_out:
        thumb_was_out = True
        print(f"🖱️  CLICK! (L-shape at {x:.3f}, {y:.3f})")
        return {"detected": True, "mode": "cursor", "x": x, "y": y,
                "gesture": "click"}

    # Track thumb state for edge detection (only fire once)
    if thumb_out:
        thumb_was_out = True
    else:
        thumb_was_out = False

    # ── Default: index finger pointing → cursor ──────────────────
    return {"detected": True, "mode": "cursor", "x": x, "y": y,
            "gesture": "point"}


# ── Networking ───────────────────────────────────────────────────────
async def broadcast(message):
    if connected_clients:
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )


async def websocket_handler(websocket):
    connected_clients.add(websocket)
    print(f"Client connected. Total clients: {len(connected_clients)}")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print(f"Client disconnected. Total clients: {len(connected_clients)}")


# ── Main loop ────────────────────────────────────────────────────────
async def finger_tracker():
    global latest_result

    ensure_model()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Could not open webcam.")
        return

    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=VisionRunningMode.LIVE_STREAM,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        result_callback=on_result,
    )

    with HandLandmarker.create_from_options(options) as landmarker:
        print("\n  AccessFlow Finger Tracker")
        print("  ─────────────────────────────────")
        print("  Point (index finger)   → move cursor")
        print("  L-shape (extend thumb) → click element")
        print("  Peace sign (2 fingers) → scroll up/down")
        print("  Press q / ESC          → quit\n")

        # Create small window at top-left corner
        window_name = 'AccessFlow Finger Tracker'
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

        # Force window to be tiny
        cv2.resizeWindow(window_name, 240, 180)
        cv2.moveWindow(window_name, 10, 30)
        cv2.setWindowProperty(window_name, cv2.WND_PROP_TOPMOST, 1)

        frame_timestamp_ms = 0
        first_frame = True

        while cap.isOpened():
            success, image = cap.read()
            if not success:
                continue

            # Force resize on first frame to ensure it sticks
            if first_frame:
                cv2.resizeWindow(window_name, 240, 180)
                cv2.moveWindow(window_name, 10, 30)
                first_frame = False

            image = cv2.flip(image, 1)
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            landmarker.detect_async(mp_image, frame_timestamp_ms)
            frame_timestamp_ms += 33

            now = time.time()
            data = {"detected": False}
            result = latest_result

            if result and result.hand_landmarks:
                hand_landmarks = result.hand_landmarks[0]
                data = process_gestures(hand_landmarks, now)

                # ── Visual feedback on preview window ────────────
                h, w, _ = image.shape
                ix = int(data["x"] * w)
                iy = int(data["y"] * h)
                gesture = data.get("gesture", "")

                if gesture == "click":
                    cv2.circle(image, (ix, iy), 25, (0, 255, 0), -1)
                    cv2.putText(image, "CLICK!", (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                elif data.get("mode") == "scroll":
                    scroll = data.get("scroll")
                    label = "SCROLL " + ("UP" if scroll == "scroll_up" else "DOWN" if scroll == "scroll_down" else "...")
                    cv2.putText(image, label, (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 165, 0), 2)
                else:
                    cv2.circle(image, (ix, iy), 8, (255, 0, 0), -1)

                image = draw_landmarks(image, result)
            else:
                # Reset state when hand disappears
                reset_gesture_state()

            await broadcast(json.dumps(data))

            # Resize image for small display while maintaining aspect ratio
            h, w = image.shape[:2]
            display_width = 240
            display_height = int(h * (display_width / w))
            display_image = cv2.resize(image, (display_width, display_height))
            cv2.imshow('AccessFlow Finger Tracker', display_image)
            if cv2.waitKey(5) & 0xFF in [27, ord('q')]:
                break

            await asyncio.sleep(0.033)

    cap.release()
    cv2.destroyAllWindows()


async def main():
    server = await websockets.serve(websocket_handler, "localhost", 9000)
    print("WebSocket server started on ws://localhost:9000")
    await finger_tracker()


if __name__ == "__main__":
    asyncio.run(main())
