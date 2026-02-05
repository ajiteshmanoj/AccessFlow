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
