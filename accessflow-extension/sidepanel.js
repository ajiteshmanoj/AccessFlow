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
    if (narrationMode) exitNarrationMode();
    else log("Stopped listening.");
    return;
  }

  // ========== NARRATION MODE ROUTING ==========
  if (narrationMode) {
    // Exit phrases
    if (/\b(done|exit|quit|close|stop reading|stop narration)\b/.test(key)) {
      stopSpeaking();
      exitNarrationMode();
      return;
    }

    // Page commands bypass narration mode
    const isPageCommand = /^(click|scroll|go to|go back|go forward|highlight|tab|next element|page up|page down)\b/.test(key);
    if (isPageCommand) {
      resetNarrationIdleTimer();
      // Fall through to normal command handling below
    } else {
      // Handle as narration follow-up
      await handleNarrationFollowUp(cmd);
      return;
    }
  }
  // ========== END NARRATION MODE ROUTING ==========

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
let isSpeaking = false;  // Track if system is currently speaking
let lastSpokenText = "";  // Track what we just said to filter echo

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

function stopSpeaking() {
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  window.speechSynthesis.cancel();
  isSpeaking = false;
}

async function speak(text) {
  stopSpeaking();
  isSpeaking = true;
  lastSpokenText = text.toLowerCase();  // Track for echo filtering

  // Turn off mic while speaking to prevent echo
  shouldResumeListening = isListening;
  if (isListening) {
    stopListening();
  }

  try {
    const res = await fetch(`${BACKEND}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error("TTS API failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      currentAudio = new Audio(url);
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        isSpeaking = false;
        // Clear lastSpokenText after a delay
        setTimeout(() => { lastSpokenText = ""; }, 2000);
        resolve();
      };
      currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        isSpeaking = false;
        lastSpokenText = "";
        resolve();
      };
      currentAudio.play();
    });
  } catch (_) {
    // Fallback to browser TTS
    await speakBrowser(text);
    isSpeaking = false;
    setTimeout(() => { lastSpokenText = ""; }, 2000);
  }

  // Resume listening after speaking completes
  if (shouldResumeListening) {
    shouldResumeListening = false;
    await startListening();
  }
}

// ========== CONVERSATIONAL NARRATION STATE ==========
let narrationMode = false;
let narrationTopics = [];       // [{name, heading_match}]
let narrationOverview = "";
let narrationFullSections = []; // [{heading, level, text}]
let narrationPageTitle = "";
let narrationPageUrl = "";
let narrationHistory = [];      // [{role, text}]
let narrationHeardTopics = [];
let narrationModeTimeout = null;
let narrationLastResponse = "";

// ========== IMAGE DESCRIPTION STATE ==========
let imageDescriptions = [];     // Array of {description} objects
let currentImageIndex = 0;
let isDescribingImages = false;

function showNarrationPanel(visible) {
  const panel = document.getElementById("narration-panel");
  if (panel) panel.style.display = visible ? "block" : "none";
}

function showImageDescriptionControls(visible) {
  const controls = document.getElementById("image-description-controls");
  if (controls) controls.style.display = visible ? "block" : "none";
}

async function describeCurrentImage() {
  if (currentImageIndex >= imageDescriptions.length) {
    // All images described
    isDescribingImages = false;
    showImageDescriptionControls(false);
    log("All images described.");
    return;
  }

  const desc = imageDescriptions[currentImageIndex];
  const imageText = `Image ${currentImageIndex + 1} of ${imageDescriptions.length}: ${desc.description}`;

  log(imageText);

  await speak(imageText);

  // After speaking completes, automatically move to next image if still in description mode
  if (isDescribingImages) {
    currentImageIndex++;
    if (currentImageIndex < imageDescriptions.length) {
      // Small delay before next image
      await new Promise(resolve => setTimeout(resolve, 500));
      if (isDescribingImages) {
        await describeCurrentImage();
      }
    } else {
      // All done
      isDescribingImages = false;
      showImageDescriptionControls(false);
      log("All images described.");
    }
  }
}

function stopImageDescription() {
  isDescribingImages = false;
  imageDescriptions = [];
  currentImageIndex = 0;
  stopSpeaking();
  showImageDescriptionControls(false);
}

function buildTopicChips() {
  const container = document.getElementById("topic-chips");
  if (!container) return;
  container.innerHTML = "";
  for (const topic of narrationTopics) {
    const chip = document.createElement("button");
    chip.className = "topic-chip" + (narrationHeardTopics.includes(topic.name) ? " heard" : "");
    chip.textContent = topic.name;
    chip.onclick = () => narrateTopic(topic);
    container.appendChild(chip);
  }
}

function resetNarrationIdleTimer() {
  if (narrationModeTimeout) clearTimeout(narrationModeTimeout);
  narrationModeTimeout = setTimeout(() => {
    if (narrationMode) exitNarrationMode(true);
  }, 60000);
}

function exitNarrationMode(silent = false) {
  narrationMode = false;
  narrationTopics = [];
  narrationOverview = "";
  narrationFullSections = [];
  narrationHistory = [];
  narrationHeardTopics = [];
  narrationLastResponse = "";
  if (narrationModeTimeout) { clearTimeout(narrationModeTimeout); narrationModeTimeout = null; }
  showNarrationPanel(false);
  if (!silent) {
    log("Narration mode ended.");
  }
}

function findMatchingTopic(input) {
  const words = input.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return null;

  let bestTopic = null;
  let bestScore = 0;

  for (const topic of narrationTopics) {
    const topicWords = topic.name.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    let score = 0;
    for (const tw of topicWords) {
      for (const iw of words) {
        if (tw.includes(iw) || iw.includes(tw)) { score++; break; }
      }
    }
    // Normalize by topic word count for fair comparison
    const normalized = topicWords.length > 0 ? score / topicWords.length : 0;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestTopic = topic;
    }
  }

  return bestScore >= 0.5 ? bestTopic : null;
}

function findSectionForTopic(topic) {
  // Try exact heading match first
  let section = narrationFullSections.find(s =>
    s.heading.toLowerCase() === topic.heading_match.toLowerCase()
  );
  if (section) return section;

  // Fuzzy match
  const matchWords = topic.heading_match.toLowerCase().split(/\s+/);
  section = narrationFullSections.find(s => {
    const hWords = s.heading.toLowerCase().split(/\s+/);
    const overlap = matchWords.filter(w => hWords.some(hw => hw.includes(w) || w.includes(hw))).length;
    return overlap >= Math.ceil(matchWords.length * 0.5);
  });
  return section || null;
}

async function narrateTopic(topic) {
  resetNarrationIdleTimer();
  const section = findSectionForTopic(topic);
  if (!section) {
    await respond(`I couldn't find the section for "${topic.name}". Try another topic.`);
    return;
  }

  log(`Narrating: ${topic.name}...`);

  try {
    const apiRes = await fetch(`${BACKEND}/api/narrate-topic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic_name: topic.name,
        section_text: section.text,
        conversation_history: narrationHistory.slice(-6),
        heard_topics: narrationHeardTopics,
        available_topics: narrationTopics.map(t => t.name)
      })
    });
    const data = await apiRes.json();

    if (!narrationHeardTopics.includes(topic.name)) {
      narrationHeardTopics.push(topic.name);
    }
    buildTopicChips();

    const fullResponse = data.narration + " " + data.follow_up;
    narrationLastResponse = fullResponse;
    narrationHistory.push({ role: "assistant", text: fullResponse });

    await respond(fullResponse);
  } catch (e) {
    await respond("Error narrating topic: " + e.message);
  }
}

async function readAllTopicsSequentially() {
  resetNarrationIdleTimer();
  for (const topic of narrationTopics) {
    if (!narrationMode) break; // User exited
    if (narrationHeardTopics.includes(topic.name)) continue;
    await narrateTopic(topic);
    if (!narrationMode) break;
  }
  if (narrationMode) {
    await respond("That covers everything on this page. Say 'done' when you're finished.");
  }
}

async function handleNarrationFollowUp(cmd) {
  resetNarrationIdleTimer();
  const lower = cmd.toLowerCase().trim();

  // "everything" / "all" / "read all"
  if (/\b(everything|all|read all)\b/.test(lower)) {
    narrationHistory.push({ role: "user", text: cmd });
    await readAllTopicsSequentially();
    return;
  }

  // "topics" / "options" / "menu" / "what can i hear"
  if (/\b(topics|options|menu|what can i hear|list)\b/.test(lower)) {
    narrationHistory.push({ role: "user", text: cmd });
    const available = narrationTopics
      .filter(t => !narrationHeardTopics.includes(t.name))
      .map(t => t.name);
    const msg = available.length > 0
      ? "Available topics: " + available.join(", ") + ". What would you like to hear about?"
      : "You've heard all the topics! Say 'done' to exit.";
    narrationLastResponse = msg;
    narrationHistory.push({ role: "assistant", text: msg });
    await respond(msg);
    return;
  }

  // "repeat" / "again" / "say that again"
  if (/\b(repeat|again|say that again)\b/.test(lower)) {
    if (narrationLastResponse) {
      await respond(narrationLastResponse);
    } else {
      await respond(narrationOverview);
    }
    return;
  }

  // Try to match a topic
  const matchedTopic = findMatchingTopic(cmd);
  if (matchedTopic) {
    narrationHistory.push({ role: "user", text: cmd });
    await narrateTopic(matchedTopic);
    return;
  }

  // Free-form follow-up about last topic — send to narrate-topic with conversation context
  narrationHistory.push({ role: "user", text: cmd });
  const lastHeard = narrationHeardTopics[narrationHeardTopics.length - 1];
  if (lastHeard) {
    const topic = narrationTopics.find(t => t.name === lastHeard);
    if (topic) {
      await narrateTopic(topic);
      return;
    }
  }

  // Fallback
  await respond("I didn't catch that. You can say a topic name, 'read everything', 'topics' to see the list, or 'done' to exit.");
}
// ========== END CONVERSATIONAL NARRATION ==========

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

    // Initialize image description state
    imageDescriptions = data.descriptions || [];
    currentImageIndex = 0;
    isDescribingImages = true;

    // Show controls and start describing images sequentially
    showImageDescriptionControls(true);
    await describeCurrentImage();
  } catch (e) {
    stopImageDescription();
    log("Error calling describe-images API: " + e.message);
  }
};

document.getElementById("narrate-page").onclick = async () => {
  log("Analyzing page...");
  exitNarrationMode(true);

  // Fetch brief sections + full sections in parallel
  const [briefRes, fullRes] = await Promise.all([
    sendToActiveTab({ type: "GET_SECTIONS" }),
    sendToActiveTab({ type: "GET_FULL_SECTIONS" })
  ]);

  if (!briefRes?.ok || !fullRes?.ok) {
    log(briefRes?.message || fullRes?.message || "Could not access the page.");
    return;
  }

  const sections = briefRes.sections || [];
  narrationFullSections = fullRes.sections || [];
  narrationPageTitle = briefRes.page_title || "";
  narrationPageUrl = briefRes.page_url || "";

  if (sections.length === 0) { log("No content found on this page."); return; }

  log("Generating overview...");

  try {
    const resp = await fetch(`${BACKEND}/api/narrate-overview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sections,
        page_title: narrationPageTitle,
        page_url: narrationPageUrl
      })
    });
    const data = await resp.json();

    narrationOverview = data.overview || "Here's what's on this page.";
    narrationTopics = data.topics || [];
    narrationMode = true;
    narrationHistory = [{ role: "assistant", text: narrationOverview }];
    narrationLastResponse = narrationOverview;

    buildTopicChips();
    showNarrationPanel(true);
    resetNarrationIdleTimer();

    await respond(narrationOverview);
  } catch (e) {
    log("Error calling narrate-overview API: " + e.message);
  }
};

document.getElementById("read-all").onclick = async () => {
  if (narrationMode) {
    await readAllTopicsSequentially();
  }
};

document.getElementById("narration-done").onclick = () => {
  stopSpeaking();
  exitNarrationMode();
};

document.getElementById("next-image").onclick = async () => {
  if (!isDescribingImages) return;

  stopSpeaking();
  currentImageIndex++;

  if (currentImageIndex >= imageDescriptions.length) {
    // No more images
    isDescribingImages = false;
    showImageDescriptionControls(false);
    log("All images described.");
  } else {
    // Describe next image
    await describeCurrentImage();
  }
};

document.getElementById("stop-image-description").onclick = () => {
  stopImageDescription();
  log("Image description stopped.");
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
let voiceAutoSubmitTimer = null; // Timer for auto-submitting after user stops speaking
let shouldResumeListening = false; // Track if we should resume listening after speaking

function stopListening() {
  if (isListening) playStopTone();
  isListening = false;
  micBtn.classList.remove("listening");
  if (voicePort) {
    try { voicePort.disconnect(); } catch (_) {}
    voicePort = null;
  }
  // Clear status and timer
  const statusEl = document.getElementById("voice-status");
  if (statusEl) statusEl.textContent = "";
  if (voiceAutoSubmitTimer) {
    clearTimeout(voiceAutoSubmitTimer);
    voiceAutoSubmitTimer = null;
  }
}

// Calculate how many words from transcript appear in the spoken text
function calculateEchoScore(transcript, spokenText) {
  if (!spokenText || transcript.length < 3) return 0;

  const transcriptWords = transcript.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const spokenWords = spokenText.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (transcriptWords.length === 0) return 0;

  let matches = 0;
  for (const word of transcriptWords) {
    if (spokenWords.includes(word)) {
      matches++;
    }
  }

  // Return percentage of matching words
  return matches / transcriptWords.length;
}

function handleVoiceMessage(msg) {
  if (msg.type === "VOICE_RESULT") {
    const transcript = msg.transcript.trim();

    // AGGRESSIVE ECHO CANCELLATION while allowing interrupts
    if (isSpeaking && lastSpokenText) {
      const echoScore = calculateEchoScore(transcript, lastSpokenText);

      // If >25% of words match what we're saying, it's likely echo (more aggressive)
      if (echoScore > 0.25) {
        // This is echo - ignore it completely
        return;
      }

      // If <25% match, it's likely a user interrupt
      if (transcript.length > 3 && echoScore < 0.25) {
        stopSpeaking();
        log("(interrupted)");
      }
    }

    document.getElementById("cmd").value = msg.transcript;

    // Clear any existing auto-submit timer
    if (voiceAutoSubmitTimer) {
      clearTimeout(voiceAutoSubmitTimer);
      voiceAutoSubmitTimer = null;
    }

    // If user has said something substantial, set timer to auto-submit after 1.5 seconds of silence
    if (!msg.isFinal && transcript.length > 5) {
      // Show status that we're waiting
      const statusEl = document.getElementById("voice-status");
      if (statusEl) statusEl.textContent = "🎤 Listening... (pause to submit)";

      voiceAutoSubmitTimer = setTimeout(() => {
        const currentText = document.getElementById("cmd").value.trim();
        if (currentText.length > 5 && isListening) {
          if (statusEl) statusEl.textContent = "✅ Sending...";
          log("(auto-submitting after pause)");
          voiceInitiated = true;
          document.getElementById("send").click();
          setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 1000);
        }
      }, 1500); // Auto-submit after 1.5 seconds of silence
    }
    if (msg.isFinal) {
      // Final verification before submitting
      if (lastSpokenText && isSpeaking) {
        // Only check echo if AI is CURRENTLY speaking
        const echoScore = calculateEchoScore(transcript, lastSpokenText);

        // If it still looks like echo, don't submit (more aggressive threshold)
        if (echoScore > 0.3) {
          document.getElementById("cmd").value = "";
          return;
        }
      }

      // Clear lastSpokenText after 4 seconds to avoid blocking future commands
      setTimeout(() => { lastSpokenText = null; }, 4000);

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
    // If turning mic on while speaking, interrupt the speech
    if (isSpeaking) {
      stopSpeaking();
      shouldResumeListening = false; // Don't auto-resume after interruption
      log("(interrupted)");
    }
    await startListening();
  }
};

// Global keyboard shortcut (Ctrl+Shift+V) forwarded from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_MIC") {
    micBtn.click();
  }
  // Finger tracking status updates
  if (msg.type === "FINGER_TRACKER_STATUS") {
    const btn = document.getElementById("finger-tracking");
    if (msg.active) {
      btn.textContent = "🛑 Stop Finger Tracking";
      btn.classList.add("active");
      isFingerTrackingActive = true;
      log("Finger tracking started. Point at the screen to move the cursor.");
    } else {
      btn.innerHTML = "👆 Finger Tracking<br><span class='pill'>hand gestures</span>";
      btn.classList.remove("active");
      isFingerTrackingActive = false;
      log("Finger tracking stopped.");
    }
  }
  if (msg.type === "FINGER_TRACKER_ERROR") {
    log("Finger tracking error: " + msg.error);
  }
  if (msg.type === "FINGER_TRACKER_RETRY") {
    log(`Retrying connection... (attempt ${msg.attempt}/${msg.maxAttempts})`);
  }
});

// --- end Voice Input ---

// ========== FINGER TRACKING ==========
let isFingerTrackingActive = false;

document.getElementById("finger-tracking").onclick = async () => {
  if (isFingerTrackingActive) {
    // Stop tracking - call API to stop the process
    log("Stopping finger tracker...");
    try {
      const stopRes = await fetch(`${BACKEND}/api/finger-tracker/stop`, { method: "POST" });
      const stopData = await stopRes.json();
      log("Finger tracker stopped: " + stopData.message);
    } catch (e) {
      log("Error stopping tracker: " + e.message);
    }

    // Disconnect WebSocket
    chrome.runtime.sendMessage({ type: "STOP_FINGER_TRACKING" });
    isFingerTrackingActive = false;

    // Remove cursor from page
    await sendToActiveTab({ type: "STOP_FINGER_CURSOR" });

  } else {
    // Start tracking - call API to start the process
    log("Starting finger tracker (camera will open)...");
    try {
      const startRes = await fetch(`${BACKEND}/api/finger-tracker/start`, { method: "POST" });
      const startData = await startRes.json();

      if (startData.status === "started" || startData.status === "already_running") {
        log("Finger tracker started! Point your finger at the camera.");

        // Wait for WebSocket server to initialize (with auto-retry fallback)
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Connect WebSocket from background.js (will auto-retry if needed)
        chrome.runtime.sendMessage({ type: "START_FINGER_TRACKING" });
        isFingerTrackingActive = true;
      } else {
        log("Error: " + startData.message);
      }
    } catch (e) {
      log("Error starting tracker: " + e.message + ". Is the main backend running?");
    }
  }
};
// ========== END FINGER TRACKING ==========

// ========== BACKEND STATUS CHECK ==========
let lastBackendStatus = null;
let isFirstCheck = true;

async function checkBackendStatus() {
  // Check main backend
  try {
    const mainRes = await fetch(`${BACKEND}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
      cache: "no-cache"
    });
    if (mainRes.ok) {
      // Only log if status changed OR first successful check
      if (lastBackendStatus !== true) {
        log("✅ Backend online and ready!");
        if (isFirstCheck) {
          log("📌 Finger tracking starts on-demand when you click the button.");
        }
        lastBackendStatus = true;
      }
    } else {
      throw new Error("Backend not responding");
    }
  } catch (e) {
    // Only log if status changed AND not first check (avoid startup noise)
    if (lastBackendStatus !== false && !isFirstCheck) {
      log("⚠️ Main backend not running!");
      log("📝 To start the backend, run this command in Terminal:");
      log("   cd ~/Desktop/AccessFlow && ./start-accessflow.sh");
      log("   (Or double-click start-accessflow.sh in Finder)");
    }
    lastBackendStatus = false;
  }
  isFirstCheck = false;
}

// Check backend status on load
checkBackendStatus();

// Re-check every 60 seconds
setInterval(checkBackendStatus, 60000);

// ========== END BACKEND STATUS CHECK ==========

// Initial hint
log("Tip: Press Ctrl+Shift+V anytime to toggle voice input, or click the mic button.");
