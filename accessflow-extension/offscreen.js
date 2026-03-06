// Offscreen document for Speech Recognition on restricted pages.
// Chrome extension pages can't directly access the mic via SpeechRecognition,
// but offscreen documents (with USER_MEDIA reason) can after acquiring
// getUserMedia permission first.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let keepAlive = false;
let micStream = null; // Keep the getUserMedia stream alive

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen-voice") return;

  if (msg.type === "START_VOICE") {
    // Must use async handling with sendResponse
    startRecognition().then(() => sendResponse({ ok: true }))
                      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // Keep the message channel open for async response
  }
  if (msg.type === "STOP_VOICE") {
    stopRecognition();
    sendResponse({ ok: true });
  }
});

async function startRecognition() {
  if (!SpeechRecognition) {
    chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: "Speech recognition not supported." });
    return;
  }
  stopRecognition(); // clean up any previous instance

  // First, acquire microphone access via getUserMedia.
  // This triggers Chrome's permission prompt for the extension origin
  // and is required before SpeechRecognition will work in extension contexts.
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_VOICE_ERROR",
      error: "Microphone access denied. Allow mic for this extension in browser settings."
    });
    return;
  }

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
      chrome.runtime.sendMessage({
        type: "OFFSCREEN_VOICE_ERROR",
        error: "Microphone access denied. Allow mic for this extension in browser settings."
      });
      keepAlive = false;
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_VOICE_ERROR", error: event.error });
    }
  };

  recognition.onend = () => {
    if (keepAlive) {
      try { recognition.start(); } catch (err) { console.warn("[AccessFlow]", err); }
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
    try { recognition.abort(); } catch (err) { console.warn("[AccessFlow]", err); }
    recognition = null;
  }
  // Release the mic stream
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
}
