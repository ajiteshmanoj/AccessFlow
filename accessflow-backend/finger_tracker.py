"""
Finger Tracker Service for AccessFlow
Tracks index finger position via webcam using MediaPipe Hands.
Sends real-time position + click events to Chrome extension via WebSocket.
"""

import cv2
import mediapipe as mp
import asyncio
import websockets
import json
import math
from collections import deque

# MediaPipe setup
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

# WebSocket clients
connected_clients = set()

# Gesture detection state
last_position = None
dwell_timer = 0
scroll_reference_y = None
DWELL_THRESHOLD = 15  # frames (~0.5 seconds at 30fps)
PINCH_THRESHOLD = 0.05  # normalized distance threshold
SCROLL_THRESHOLD = 0.05  # minimum vertical movement to trigger scroll


def calculate_distance(point1, point2):
    """Calculate Euclidean distance between two landmarks."""
    return math.sqrt((point1.x - point2.x)**2 + (point1.y - point2.y)**2)


def detect_pinch(hand_landmarks):
    """Detect if thumb and index finger are pinched together."""
    thumb_tip = hand_landmarks.landmark[4]
    index_tip = hand_landmarks.landmark[8]
    distance = calculate_distance(thumb_tip, index_tip)
    return distance < PINCH_THRESHOLD


def detect_dwell(current_pos, last_pos, timer):
    """Detect if finger has stayed in same position (dwell click)."""
    if last_pos is None:
        return False, 0

    distance = math.sqrt((current_pos[0] - last_pos[0])**2 + (current_pos[1] - last_pos[1])**2)

    if distance < 0.02:  # Stayed in roughly same spot
        timer += 1
        if timer >= DWELL_THRESHOLD:
            return True, 0  # Click triggered, reset timer
        return False, timer
    else:
        return False, 0  # Moved, reset timer


def count_extended_fingers(hand_landmarks):
    """Count how many fingers are extended (straightened)."""
    # Finger tip and PIP (middle joint) landmark indices
    fingers = [
        (8, 6),   # Index finger
        (12, 10), # Middle finger
        (16, 14), # Ring finger
        (20, 18)  # Pinky
    ]

    extended_count = 0
    for tip_idx, pip_idx in fingers:
        tip = hand_landmarks.landmark[tip_idx]
        pip = hand_landmarks.landmark[pip_idx]
        # Finger is extended if tip is higher than middle joint (lower y value)
        if tip.y < pip.y - 0.03:
            extended_count += 1

    return extended_count


def detect_scroll(current_y, reference_y):
    """Detect scroll gesture based on vertical hand movement."""
    if reference_y is None:
        return None, current_y

    delta = current_y - reference_y

    if delta < -SCROLL_THRESHOLD:  # Moved up significantly
        return "scroll_down", current_y  # Mirror: hand up = page down
    elif delta > SCROLL_THRESHOLD:  # Moved down significantly
        return "scroll_up", current_y  # Mirror: hand down = page up

    return None, reference_y  # No significant movement


async def broadcast(message):
    """Send message to all connected WebSocket clients."""
    if connected_clients:
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )


async def websocket_handler(websocket):
    """Handle WebSocket connections from Chrome extension."""
    connected_clients.add(websocket)
    print(f"Client connected. Total clients: {len(connected_clients)}")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print(f"Client disconnected. Total clients: {len(connected_clients)}")


async def finger_tracker():
    """Main finger tracking loop."""
    global last_position, dwell_timer, scroll_reference_y

    cap = cv2.VideoCapture(0)

    with mp_hands.Hands(
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        max_num_hands=1
    ) as hands:

        print("Finger tracker started. Show your hand to the camera.")
        print("1 finger = cursor control (pinch or dwell to click)")
        print("2+ fingers = scroll (move hand up/down to scroll)")

        while cap.isOpened():
            success, image = cap.read()
            if not success:
                continue

            # Flip image horizontally for mirror effect
            image = cv2.flip(image, 1)

            # Convert to RGB for MediaPipe
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            results = hands.process(image_rgb)

            # Default: no hand detected
            data = {"detected": False}

            if results.multi_hand_landmarks:
                hand_landmarks = results.multi_hand_landmarks[0]

                # Get index finger tip position (landmark 8)
                index_tip = hand_landmarks.landmark[8]
                x, y = index_tip.x, index_tip.y

                # Count extended fingers to determine mode
                extended_fingers = count_extended_fingers(hand_landmarks)

                # SCROLL MODE: 2+ fingers extended
                if extended_fingers >= 2:
                    scroll_action, scroll_reference_y = detect_scroll(y, scroll_reference_y)

                    data = {
                        "detected": True,
                        "mode": "scroll",
                        "x": x,
                        "y": y,
                        "scroll": scroll_action  # "scroll_up", "scroll_down", or None
                    }

                    # Visual feedback for scroll mode
                    cv2.putText(image, f"SCROLL MODE ({extended_fingers} fingers)",
                               (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 165, 0), 2)
                    if scroll_action:
                        arrow = "↑" if scroll_action == "scroll_up" else "↓"
                        cv2.putText(image, arrow, (int(x * image.shape[1]), int(y * image.shape[0])),
                                   cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 255, 255), 3)

                    # Reset cursor state
                    last_position = None
                    dwell_timer = 0

                # CURSOR MODE: 1 finger extended
                else:
                    # Detect click gestures
                    pinch_detected = detect_pinch(hand_landmarks)
                    dwell_detected, dwell_timer = detect_dwell((x, y), last_position, dwell_timer)

                    click = pinch_detected or dwell_detected

                    # Update state
                    last_position = (x, y)

                    # Prepare data to send
                    data = {
                        "detected": True,
                        "mode": "cursor",
                        "x": x,
                        "y": y,
                        "click": click
                    }

                    # Visual feedback for click
                    if click:
                        cv2.circle(image, (int(x * image.shape[1]), int(y * image.shape[0])), 20, (0, 255, 0), -1)
                        dwell_timer = 0  # Reset after click

                    # Reset scroll state
                    scroll_reference_y = None

                # Draw hand landmarks on preview
                mp_drawing.draw_landmarks(image, hand_landmarks, mp_hands.HAND_CONNECTIONS)

            else:
                # No hand detected, reset state
                last_position = None
                dwell_timer = 0
                scroll_reference_y = None

            # Broadcast to WebSocket clients
            await broadcast(json.dumps(data))

            # Display preview window
            cv2.imshow('AccessFlow Finger Tracker', image)

            # Exit on 'q' or ESC
            if cv2.waitKey(5) & 0xFF in [27, ord('q')]:
                break

            # Small delay to prevent overwhelming WebSocket
            await asyncio.sleep(0.033)  # ~30fps

    cap.release()
    cv2.destroyAllWindows()


async def main():
    """Start WebSocket server and finger tracking."""
    # Start WebSocket server
    server = await websockets.serve(websocket_handler, "localhost", 9000)
    print("WebSocket server started on ws://localhost:9000")

    # Start finger tracking
    await finger_tracker()


if __name__ == "__main__":
    asyncio.run(main())
