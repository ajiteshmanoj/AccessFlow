// background.js (MV3)
// Uses Side Panel API safely. Requires "sidePanel" permission in manifest.json.

chrome.runtime.onInstalled.addListener(async () => {
  // Open side panel when the extension icon is clicked (best practice)
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

// Guard: avoid crashing on browsers/versions without side panel support
chrome.action.onClicked.addListener(async (_tab) => {
  if (!chrome.sidePanel) {
    console.warn("Side Panel API not available. Check Chrome version and manifest permissions.");
  }
});

// Global keyboard shortcut → forward to side panel
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-mic") {
    chrome.runtime.sendMessage({ type: "TOGGLE_MIC" });
  }
});

// ========== FINGER TRACKER WEBSOCKET ==========
let ws = null;
let fingerTrackingActive = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "START_FINGER_TRACKING") {
    startFingerTracking();
    sendResponse({ ok: true });
  }
  if (msg?.type === "STOP_FINGER_TRACKING") {
    stopFingerTracking();
    sendResponse({ ok: true });
  }
});

function startFingerTracking() {
  if (ws) return; // Already connected

  ws = new WebSocket("ws://localhost:9000");

  ws.onopen = () => {
    console.log("Connected to finger tracker");
    fingerTrackingActive = true;
    chrome.runtime.sendMessage({ type: "FINGER_TRACKER_STATUS", active: true });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // Forward finger position to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "FINGER_POSITION",
          ...data
        });
      }
    });
  };

  ws.onerror = (err) => {
    console.error("Finger tracker WebSocket error:", err);
    chrome.runtime.sendMessage({ type: "FINGER_TRACKER_ERROR", error: "Connection failed. Is finger_tracker.py running?" });
  };

  ws.onclose = () => {
    console.log("Disconnected from finger tracker");
    ws = null;
    fingerTrackingActive = false;
    chrome.runtime.sendMessage({ type: "FINGER_TRACKER_STATUS", active: false });
  };
}

function stopFingerTracking() {
  if (ws) {
    ws.close();
    ws = null;
  }
}
