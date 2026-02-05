const BACKEND = "http://localhost:8000";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function log(msg) {
  const el = document.getElementById("log");
  const div = document.createElement("div");
  div.textContent = msg;
  el.prepend(div);
}

function isRestrictedUrl(url = "") {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("brave://") ||
    url.startsWith("opera://") ||
    url.startsWith("vivaldi://") ||
    url.includes("chrome.google.com/webstore")
  );
}

async function sendMessage(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) resolve({ ok: false, __lastError: err.message });
      else resolve(response || { ok: true, message: "Done." });
    });
  });
}

async function ensureContentScript(tabId) {
  // Try a lightweight ping; if it fails, inject content.js and try again
  const ping = await sendMessage(tabId, { type: "PING" });
  if (ping?.ok) return true;

  // Injection only works on normal web pages
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function sendToActiveTab(payload) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, message: "No active tab found." };

  if (isRestrictedUrl(tab.url || "")) {
    return {
      ok: false,
      message: "This page is restricted by the browser (e.g., chrome:// pages / Web Store). Open a normal website (https://...) and try again."
    };
  }

  const ok = await ensureContentScript(tab.id);
  if (!ok) return { ok: false, message: "Could not inject content script into this page." };

  const res = await sendMessage(tab.id, payload);
  if (res?.__lastError) {
    return { ok: false, message: "Could not establish connection. Reload the page and try again." };
  }
  return res;
}

document.getElementById("inclusive").onclick = async () => {
  const res = await sendToActiveTab({ type: "INCLUSIVE_ON" });
  log(res?.message || "Inclusive Mode applied.");
};

document.getElementById("focus").onclick = async () => {
  const res = await sendToActiveTab({ type: "FOCUS_ON" });
  log(res?.message || "Focus Mode applied.");
};

document.getElementById("tunnel").onclick = async () => {
  const res = await sendToActiveTab({ type: "TUNNEL_ON" });
  log(res?.message || "Task Tunnel started.");
};

document.getElementById("reset").onclick = async () => {
  const res = await sendToActiveTab({ type: "RESET" });
  isSimplifyActive = false;
  document.getElementById("simplify").classList.remove("active");
  log(res?.message || "Reset.");
};

// ========== INTELLIGENT PAGE SIMPLIFICATION ==========
let isSimplifyActive = false;

document.getElementById("simplify").onclick = async () => {
  if (isSimplifyActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "SIMPLIFY_OFF" });
    document.getElementById("simplify").classList.remove("active");
    isSimplifyActive = false;
    log("Simplification removed.");
    return;
  }

  // Toggle ON - Get page content
  log("Analyzing page with AI...");
  const res = await sendToActiveTab({ type: "SIMPLIFY_ON" });

  if (res?.pageData) {
    try {
      // Call backend API
      const apiRes = await fetch("http://localhost:8000/api/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_url: res.pageData.url,
          page_title: res.pageData.title,
          page_content: res.pageData.content
        })
      });

      if (!apiRes.ok) {
        throw new Error(`API returned ${apiRes.status}`);
      }

      const data = await apiRes.json();

      // Apply CSS rules to page
      await sendToActiveTab({
        type: "APPLY_SIMPLIFY_RULES",
        rules: data.css_rules
      });

      document.getElementById("simplify").classList.add("active");
      isSimplifyActive = true;
      log("Page simplified: " + data.summary);

      // Log individual changes
      if (data.changes_description && data.changes_description.length > 0) {
        data.changes_description.forEach(change => log("  • " + change));
      }
    } catch (err) {
      log("Error: " + err.message + ". Make sure backend is running on localhost:8000");
    }
  } else {
    log("Could not get page content: " + (res?.message || "Unknown error"));
  }
};

// Voice-friendly aliases for side panel buttons
const PANEL_COMMANDS = {
  "inclusive mode":   "inclusive",
  "inclusive":        "inclusive",
  "bigger text":     "inclusive",
  "focus mode":      "focus",
  "focus":           "focus",
  "hide clutter":    "focus",
  "task tunnel":     "tunnel",
  "tunnel":          "tunnel",
  "step by step":    "tunnel",
  "simplify page":   "simplify",
  "simplify":        "simplify",
  "reset page":      "reset",
  "reset":           "reset",
  "describe images": "describe-images",
  "describe":        "describe-images",
  "read page":       "narrate-page",
  "read aloud":      "narrate-page",
  "narrate":         "narrate-page",
};

// Track whether the current command was voice-initiated
let voiceInitiated = false;

// Conversation history for contextual AI understanding (capped at 10 entries)
let conversationHistory = [];

// Log a message and speak it aloud.
// Mic stays open continuously — no need to restart after each response.
async function respond(msg) {
  log(msg);
  await speak(msg);
  voiceInitiated = false;
}

document.getElementById("send").onclick = async () => {
  const cmd = document.getElementById("cmd").value.trim();
  if (!cmd) return;

  // Check if the command matches a panel button
  const key = cmd.toLowerCase().replace(/\s+/g, " ").trim();
  const btnId = PANEL_COMMANDS[key];
  if (btnId) {
    document.getElementById(btnId).click();
    return;
  }

  // Help command
  if (key === "help" || key === "what can i say" || key === "what can i do") {
    await respond("You can say: click, highlight, scroll down, scroll up, go back, focus mode, simplify page, read page, describe images, or say an article title to open it.");
    return;
  }

  // Stop voice / stop listening
  if (key === "stop" || key === "stop listening" || key === "nevermind" || key === "never mind") {
    voiceInitiated = false;
    stopListening();
    log("Stopped listening.");
    return;
  }

  // Try the built-in command handler first
  const res = await sendToActiveTab({ type: "CMD", cmd });

  // If built-in handler didn't recognize it, ask AI to interpret
  if (res?.ok === false && res?.message?.startsWith("Unknown command")) {
    log("Thinking...");
    try {
      // Get interactive elements from the page
      const pageRes = await sendToActiveTab({ type: "GET_PAGE_ELEMENTS" });
      if (!pageRes?.ok) { await respond("Could not read page elements."); return; }

      // Call the AI interpreter
      const apiRes = await fetch(`${BACKEND}/api/interpret-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          elements: pageRes.elements,
          page_title: pageRes.page_title,
          page_url: pageRes.page_url,
          conversation_history: conversationHistory
        })
      });
      const data = await apiRes.json();

      if (data.action === "none") {
        conversationHistory.push({ role: "user", text: cmd });
        conversationHistory.push({ role: "assistant", text: data.explanation || "Could not understand that command." });
        if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);
        await respond(data.explanation || "Could not understand that command.");
        return;
      }

      // Execute the AI-interpreted action on the page
      const execRes = await sendToActiveTab({
        type: "EXECUTE_ACTION",
        action: data.action,
        target_index: data.target_index,
        value: data.value
      });

      // Build spoken response, appending suggestion if present
      let spokenResponse = data.explanation || execRes?.message || "Done.";
      if (data.suggestion) {
        spokenResponse += ". " + data.suggestion;
      }

      // Push to conversation history
      conversationHistory.push({ role: "user", text: cmd });
      conversationHistory.push({ role: "assistant", text: spokenResponse });
      if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

      await respond(spokenResponse);
    } catch (err) {
      await respond("AI error: " + err.message + ". Is the backend running?");
    }
    return;
  }

  await respond(res?.message || "Done.");
};

document.getElementById("cmd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("send").click();
});

// --- Content Description & Narration (GPT-4o-mini) ---

// Natural TTS via OpenAI, falls back to browser TTS
let currentAudio = null;

function speakBrowser(text) {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate  = 0.9;
    utt.pitch = 1;
    utt.onend = resolve;
    utt.onerror = resolve;
    window.speechSynthesis.speak(utt);
  });
}

async function speak(text) {
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  window.speechSynthesis.cancel();

  try {
    const res = await fetch(`${BACKEND}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error("TTS API failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      currentAudio = new Audio(url);
      currentAudio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      currentAudio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      currentAudio.play();
    });
  } catch (_) {
    // Fallback to browser TTS
    return speakBrowser(text);
  }
}

// Narration state — tracks section-by-section progress
let narrationSections = [];
let narrationIndex   = 0;

function showNextBtn(visible) {
  document.getElementById("next-section").style.display = visible ? "block" : "none";
}

function speakSection(idx) {
  if (idx >= narrationSections.length) {
    showNextBtn(false);
    log("That's the end of the page.");
    return;
  }
  const section = narrationSections[idx];
  log(`[${section.heading}] ${section.text}`);
  speak(section.heading + ". " + section.text);
  narrationIndex = idx + 1;
  showNextBtn(narrationIndex < narrationSections.length);
}

document.getElementById("describe-images").onclick = async () => {
  log("Looking for images on this page...");

  const res = await sendToActiveTab({ type: "DESCRIBE_IMAGES" });
  if (!res?.ok) { log(res?.message || "Could not access the page."); return; }

  const images = res.images || [];
  if (images.length === 0) { log("No meaningful images found on this page."); return; }

  log(`Found ${images.length} image(s). Describing...`);

  try {
    const resp = await fetch(`${BACKEND}/api/describe-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, page_title: document.title })
    });
    const data = await resp.json();

    const allText = data.descriptions.map((d, i) =>
      `Image ${i + 1}: ${d.description}`
    ).join("\n");

    log(allText);
    speak(allText);
  } catch (e) {
    log("Error calling describe-images API: " + e.message);
  }
};

document.getElementById("narrate-page").onclick = async () => {
  log("Reading page content...");
  narrationSections = [];
  narrationIndex = 0;
  showNextBtn(false);

  const res = await sendToActiveTab({ type: "GET_SECTIONS" });
  if (!res?.ok) { log(res?.message || "Could not access the page."); return; }

  const sections  = res.sections || [];
  const pageTitle = res.page_title || "";
  const pageUrl   = res.page_url  || "";

  if (sections.length === 0) { log("No content found on this page."); return; }

  log("Generating narration...");

  try {
    const resp = await fetch(`${BACKEND}/api/narrate-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections, page_title: pageTitle, page_url: pageUrl })
    });
    const data = await resp.json();
    const narration = data.narration || "";

    // Split narration into sections by numbered lines (1. ... 2. ... etc.)
    const parts = narration.split(/\n(?=\d+\.)/).map(s => s.trim()).filter(Boolean);
    narrationSections = parts.map((part, i) => ({
      heading: `Part ${i + 1}`,
      text: part
    }));

    // Speak the first section immediately
    speakSection(0);
  } catch (e) {
    log("Error calling narrate-page API: " + e.message);
  }
};

document.getElementById("next-section").onclick = () => {
  speakSection(narrationIndex);
};

// --- end Content Description & Narration ---

// --- Voice Input (Speech-to-Text) ---
// SpeechRecognition runs in the content script (web page context).
// Uses port-based messaging for reliable streaming of results.
// Supports continuous listening: after a command is processed and
// the response is spoken, listening restarts automatically.

// --- Sound Effects (Web Audio API) ---
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playTone(freq, durationMs, startDelay = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime + startDelay / 1000;
    osc.start(t);
    osc.stop(t + durationMs / 1000);
  } catch (_) { /* audio not available — safe to ignore */ }
}

function playStartChime() {
  playTone(440, 80, 0);    // first note
  playTone(580, 80, 90);   // rising second note
}

function playStopTone() {
  playTone(380, 100, 0);
}
// --- end Sound Effects ---

const micBtn = document.getElementById("mic");
let isListening = false;
let voicePort = null;
let voicePortId = 0; // monotonic ID to guard against stale disconnect events

function stopListening() {
  if (isListening) playStopTone();
  isListening = false;
  micBtn.classList.remove("listening");
  if (voicePort) {
    try { voicePort.disconnect(); } catch (_) {}
    voicePort = null;
  }
}

function handleVoiceMessage(msg) {
  if (msg.type === "VOICE_RESULT") {
    document.getElementById("cmd").value = msg.transcript;
    if (msg.isFinal) {
      // Don't stop listening — continuous mode keeps the mic open.
      // Just submit the command; after respond() finishes it will
      // keep the same port alive for the next utterance.
      voiceInitiated = true;
      document.getElementById("send").click();
    }
  }
  if (msg.type === "VOICE_END") {
    // Content script couldn't restart recognition — truly done
    stopListening();
  }
  if (msg.type === "VOICE_ERROR") {
    log("Speech error: " + msg.error);
    stopListening();
  }
}

async function startListening() {
  if (isListening) return;

  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    log("Open a normal https:// website first.");
    return;
  }
  await ensureContentScript(tab.id);

  try {
    voicePort = chrome.tabs.connect(tab.id, { name: "accessflow-voice" });
  } catch (e) {
    log("Could not connect to page. Reload and try again.");
    return;
  }

  const myPortId = ++voicePortId;
  voicePort.onMessage.addListener(handleVoiceMessage);
  voicePort.onDisconnect.addListener(() => {
    // Only stop if this is still the active port (prevents stale disconnect
    // from killing a new listening session started by continuous-listen)
    if (myPortId === voicePortId) stopListening();
  });

  isListening = true;
  micBtn.classList.add("listening");
  playStartChime();
  document.getElementById("cmd").value = "";
}

micBtn.onclick = async () => {
  if (isListening) {
    stopListening();
  } else {
    await startListening();
  }
};

// Global keyboard shortcut (Alt+Shift+M) forwarded from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_MIC") {
    micBtn.click();
  }
});

// --- end Voice Input ---

// Initial hint
log("Tip: Press Alt+Shift+M anytime to toggle voice input, or click the mic button.");
