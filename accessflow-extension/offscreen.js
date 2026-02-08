// Offscreen document for Speech Recognition on restricted pages.
// Chrome extension sidepanel/background pages can't access the mic,
// but offscreen documents (with USER_MEDIA reason) can.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let keepAlive = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen-voice") return;

  if (msg.type === "START_VOICE") {
    startRecognition();
    sendResponse({ ok: true });
  }
  if (msg.type === "STOP_VOICE") {
    stopRecognition();
    sendResponse({ ok: true });
  }
});

function startRecognition() {
  if (!SpeechRecognition) {
    chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: "Speech recognition not supported." });
    return;
  }
  stopRecognition(); // clean up any previous instance

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  keepAlive = true;

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const isFinal = event.results[event.results.length - 1].isFinal;
    chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_RESULT", transcript, isFinal });
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: "Microphone access denied. Allow mic for this extension in browser settings." });
      keepAlive = false;
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: event.error });
    }
  };

  recognition.onend = () => {
    if (keepAlive) {
      try { recognition.start(); } catch (_) {}
    }
  };

  try {
    recognition.start();
  } catch (e) {
    chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: e.message });
  }
}

function stopRecognition() {
  keepAlive = false;
  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
}
