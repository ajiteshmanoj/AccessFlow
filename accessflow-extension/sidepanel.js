const BACKEND = "http://localhost:8000";

// Mode state tracking
let inclusiveFontSize = 18; // Default font size
let isInclusiveModeActive = false;
let isFocusModeActive = false;
let isTunnelModeActive = false;
let focusIntensity = "medium"; // Default: medium intensity
let isColorBlindActive = false;
let colorBlindFilter = "deuteranopia";
let colorBlindMode = "correct";
let isDyslexiaModeActive = false;
let dyslexiaFeatures = { font: true, ruler: false, overlay: false, bionic: false };
let dyslexiaOverlayColor = "yellow";

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

// ========== USER PROFILE PERSISTENCE ==========
const PROFILE_DEFAULTS = {
  inclusiveMode: false,
  focusMode: false,
  simplifyPage: false,
  colorBlindActive: false,
  dyslexiaMode: false,
  autoListen: false,
  autoReadPage: false
};

async function loadProfile() {
  try {
    const result = await chrome.storage.local.get("userProfile");
    return { ...PROFILE_DEFAULTS, ...(result.userProfile || {}) };
  } catch (_) {
    return { ...PROFILE_DEFAULTS };
  }
}

async function saveProfile(updates) {
  const current = await loadProfile();
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ userProfile: updated });
  updateProfileUI(updated);
}

async function applyProfile(profile) {
  // Auto-apply saved modes by clicking their buttons (with delay for content script)
  await new Promise(resolve => setTimeout(resolve, 500));

  if (profile.inclusiveMode) {
    document.getElementById("inclusive").click();
  }
  if (profile.focusMode) {
    document.getElementById("focus").click();
  }
  if (profile.simplifyPage) {
    document.getElementById("simplify").click();
  }
  if (profile.colorBlindActive) {
    document.getElementById("colorblind").click();
  }
  if (profile.dyslexiaMode) {
    document.getElementById("dyslexia").click();
  }
  if (profile.autoListen) {
    await startListening();
  }
  if (profile.autoReadPage) {
    document.getElementById("narrate-page").click();
  }
}

function updateProfileUI(profile) {
  if (!profile) return;

  // Sync checkboxes
  const autoListenEl = document.getElementById("pref-auto-listen");
  const autoReadEl = document.getElementById("pref-auto-read");
  if (autoListenEl) autoListenEl.checked = profile.autoListen;
  if (autoReadEl) autoReadEl.checked = profile.autoReadPage;

  // Update status pill
  const statusEl = document.getElementById("profile-status");
  const hasSavedPrefs = profile.inclusiveMode || profile.focusMode ||
    profile.simplifyPage || profile.colorBlindActive || profile.dyslexiaMode || profile.autoListen || profile.autoReadPage;

  if (statusEl) {
    if (hasSavedPrefs) {
      statusEl.textContent = "Preferences saved";
      statusEl.classList.add("saved");
    } else {
      statusEl.textContent = "No preferences saved";
      statusEl.classList.remove("saved");
    }
  }

  // Update active modes indicator
  const modesEl = document.getElementById("profile-active-modes");
  if (modesEl) {
    modesEl.innerHTML = "";
    const modes = [
      { key: "inclusiveMode", label: "Inclusive Mode will auto-apply" },
      { key: "focusMode", label: "Focus Mode will auto-apply" },
      { key: "simplifyPage", label: "Simplify Page will auto-apply" },
      { key: "colorBlindActive", label: "Color Blind Filter will auto-apply" },
      { key: "dyslexiaMode", label: "Dyslexia Mode will auto-apply" }
    ];
    for (const mode of modes) {
      if (profile[mode.key]) {
        const div = document.createElement("div");
        div.className = "mode-indicator";
        div.textContent = mode.label;
        modesEl.appendChild(div);
      }
    }
  }
}

async function clearProfile() {
  await chrome.storage.local.remove("userProfile");
  updateProfileUI(PROFILE_DEFAULTS);
  // Reset page
  await sendToActiveTab({ type: "RESET" });
  isSimplifyActive = false;
  document.getElementById("simplify").classList.remove("active");
  log("All preferences cleared.");
}
// ========== END USER PROFILE PERSISTENCE ==========

document.getElementById("inclusive").onclick = async () => {
  if (isInclusiveModeActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "INCLUSIVE_OFF" });
    document.getElementById("inclusive").classList.remove("active");
    document.getElementById("inclusive-controls").style.display = "none";
    isInclusiveModeActive = false;
    log("Inclusive Mode removed.");
    saveProfile({ inclusiveMode: false });
    return;
  }

  // Toggle ON
  const res = await sendToActiveTab({ type: "INCLUSIVE_ON", fontSize: inclusiveFontSize });
  document.getElementById("inclusive").classList.add("active");
  document.getElementById("inclusive-controls").style.display = "block";
  isInclusiveModeActive = true;
  log(res?.message || "Inclusive Mode applied.");
  saveProfile({ inclusiveMode: true, focusMode: false });
};

document.getElementById("focus").onclick = async () => {
  if (isFocusModeActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "FOCUS_OFF" });
    document.getElementById("focus").classList.remove("active");
    document.getElementById("focus-controls").style.display = "none";
    isFocusModeActive = false;
    log("Focus Mode removed.");
    saveProfile({ focusMode: false });
    return;
  }

  // Toggle ON
  const res = await sendToActiveTab({ type: "FOCUS_ON", intensity: focusIntensity });
  document.getElementById("focus").classList.add("active");
  document.getElementById("focus-controls").style.display = "block";
  isFocusModeActive = true;
  log(res?.message || "Focus Mode applied.");
  saveProfile({ focusMode: true, inclusiveMode: false });
};

document.getElementById("tunnel").onclick = async () => {
  if (isTunnelModeActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "TUNNEL_OFF" });
    document.getElementById("tunnel").classList.remove("active");
    isTunnelModeActive = false;
    log("Task Tunnel stopped.");
    return;
  }

  // Toggle ON
  const res = await sendToActiveTab({ type: "TUNNEL_ON" });
  document.getElementById("tunnel").classList.add("active");
  isTunnelModeActive = true;
  log(res?.message || "Task Tunnel started.");
};

document.getElementById("colorblind").onclick = async () => {
  if (isColorBlindActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "COLORBLIND_OFF" });
    document.getElementById("colorblind").classList.remove("active");
    document.getElementById("colorblind-controls").style.display = "none";
    isColorBlindActive = false;
    log("Color blind filter removed.");
    saveProfile({ colorBlindActive: false });
    return;
  }

  // Toggle ON
  const res = await sendToActiveTab({ type: "COLORBLIND_ON", filter: colorBlindFilter, mode: colorBlindMode });
  document.getElementById("colorblind").classList.add("active");
  document.getElementById("colorblind-controls").style.display = "block";
  isColorBlindActive = true;
  log(res?.message || "Color blind filter applied.");
  saveProfile({ colorBlindActive: true });
};

document.getElementById("dyslexia").onclick = async () => {
  if (isDyslexiaModeActive) {
    // Toggle OFF
    await sendToActiveTab({ type: "DYSLEXIA_OFF" });
    document.getElementById("dyslexia").classList.remove("active");
    document.getElementById("dyslexia-controls").style.display = "none";
    isDyslexiaModeActive = false;
    log("Dyslexia Mode removed.");
    saveProfile({ dyslexiaMode: false });
    return;
  }

  // Toggle ON
  const res = await sendToActiveTab({
    type: "DYSLEXIA_ON",
    features: dyslexiaFeatures,
    overlayColor: dyslexiaOverlayColor
  });
  document.getElementById("dyslexia").classList.add("active");
  document.getElementById("dyslexia-controls").style.display = "block";
  isDyslexiaModeActive = true;
  log(res?.message || "Dyslexia Mode applied.");
  saveProfile({ dyslexiaMode: true });
};

// Dyslexia feature toggle handlers (multi-select)
document.querySelectorAll('.dyslexia-feat-btn').forEach(btn => {
  btn.onclick = () => {
    const feature = btn.dataset.feature;
    // Toggle active class (multi-select)
    btn.classList.toggle('active');
    dyslexiaFeatures[feature] = btn.classList.contains('active');

    // Show/hide overlay color picker when overlay is toggled
    const overlayColors = document.getElementById('dyslexia-overlay-colors');
    if (feature === 'overlay') {
      overlayColors.style.display = dyslexiaFeatures.overlay ? 'flex' : 'none';
    }

    // Save to storage
    chrome.storage.sync.set({ dyslexiaFeatures });

    // If mode is active, re-apply with updated features
    if (isDyslexiaModeActive) {
      sendToActiveTab({
        type: "DYSLEXIA_ON",
        features: dyslexiaFeatures,
        overlayColor: dyslexiaOverlayColor
      });
    }
  };
});

// Dyslexia overlay color handlers (single-select)
document.querySelectorAll('.dyslexia-color-btn').forEach(btn => {
  btn.onclick = () => {
    dyslexiaOverlayColor = btn.dataset.color;

    // Update UI - highlight selected button (single-select)
    document.querySelectorAll('.dyslexia-color-btn').forEach(b =>
      b.classList.remove('active')
    );
    btn.classList.add('active');

    // Save preference
    chrome.storage.sync.set({ dyslexiaOverlayColor });

    // If mode is active, re-apply with new color
    if (isDyslexiaModeActive) {
      sendToActiveTab({
        type: "DYSLEXIA_ON",
        features: dyslexiaFeatures,
        overlayColor: dyslexiaOverlayColor
      });
    }
  };
});

document.getElementById("reset").onclick = async () => {
  const res = await sendToActiveTab({ type: "RESET" });

  // Reset all mode states
  isSimplifyActive = false;
  isInclusiveModeActive = false;
  isFocusModeActive = false;
  isTunnelModeActive = false;
  isColorBlindActive = false;
  isDyslexiaModeActive = false;

  // Remove active classes from all buttons
  document.getElementById("simplify").classList.remove("active");
  document.getElementById("inclusive").classList.remove("active");
  document.getElementById("focus").classList.remove("active");
  document.getElementById("tunnel").classList.remove("active");
  document.getElementById("colorblind").classList.remove("active");
  document.getElementById("dyslexia").classList.remove("active");

  // Hide controls
  document.getElementById("inclusive-controls").style.display = "none";
  document.getElementById("focus-controls").style.display = "none";
  document.getElementById("colorblind-controls").style.display = "none";
  document.getElementById("dyslexia-controls").style.display = "none";

  log(res?.message || "Reset.");
  // Clear mode preferences but preserve autoListen and autoReadPage
  saveProfile({ inclusiveMode: false, focusMode: false, simplifyPage: false, colorBlindActive: false, dyslexiaMode: false });
};

document.getElementById("reset-defaults").onclick = async () => {
  // Reset to default values
  const defaultFontSize = 18;
  const defaultIntensity = "medium";

  // Update state
  inclusiveFontSize = defaultFontSize;
  focusIntensity = defaultIntensity;

  // Update UI - Font size slider
  document.getElementById('font-size-slider').value = defaultFontSize;
  document.getElementById('font-size-value').textContent = defaultFontSize;

  // Update UI - Intensity buttons
  document.querySelectorAll('.intensity-btn').forEach(btn => {
    if (btn.dataset.level === defaultIntensity) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Reset color blind to defaults
  colorBlindFilter = "deuteranopia";
  colorBlindMode = "correct";
  document.querySelectorAll('.cb-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === "deuteranopia");
  });
  document.querySelectorAll('.cb-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === "correct");
  });

  // Reset dyslexia to defaults
  dyslexiaFeatures = { font: true, ruler: false, overlay: false, bionic: false };
  dyslexiaOverlayColor = "yellow";
  document.querySelectorAll('.dyslexia-feat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.feature === 'font');
  });
  document.querySelectorAll('.dyslexia-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === 'yellow');
  });
  document.getElementById('dyslexia-overlay-colors').style.display = 'none';

  // Save to Chrome storage
  chrome.storage.sync.set({
    inclusiveFontSize: defaultFontSize,
    focusIntensity: defaultIntensity,
    colorBlindFilter: "deuteranopia",
    colorBlindMode: "correct",
    dyslexiaFeatures: { font: true, ruler: false, overlay: false, bionic: false },
    dyslexiaOverlayColor: "yellow"
  });

  // Re-apply modes if they're active
  if (isInclusiveModeActive) {
    await sendToActiveTab({ type: "INCLUSIVE_ON", fontSize: defaultFontSize });
  }
  if (isFocusModeActive) {
    await sendToActiveTab({ type: "FOCUS_ON", intensity: defaultIntensity });
  }
  if (isColorBlindActive) {
    await sendToActiveTab({ type: "COLORBLIND_ON", filter: colorBlindFilter, mode: colorBlindMode });
  }
  if (isDyslexiaModeActive) {
    await sendToActiveTab({ type: "DYSLEXIA_ON", features: dyslexiaFeatures, overlayColor: dyslexiaOverlayColor });
  }

  log("Settings reset to defaults (18px font, Medium intensity, Deuteranopia Correct).");
};

// ========== INTELLIGENT PAGE SIMPLIFICATION ==========
let isSimplifyActive = false;

document.getElementById("simplify").onclick = async () => {
  if (isSimplifyActive) {
    // Toggle OFF - Remove both focus mode and AI simplification
    await sendToActiveTab({ type: "FOCUS_OFF" });
    await sendToActiveTab({ type: "SIMPLIFY_OFF" });
    document.getElementById("simplify").classList.remove("active");
    isSimplifyActive = false;
    log("Simplification removed.");
    saveProfile({ simplifyPage: false });
    return;
  }

  // Toggle ON - First activate Light focus mode to hide ads
  log("Activating Light focus mode...");
  await sendToActiveTab({ type: "FOCUS_ON", intensity: "light" });

  // Then get page content for AI analysis
  log("Analyzing page with AI...");
  const res = await sendToActiveTab({ type: "SIMPLIFY_ON" });

  if (res?.pageData) {
    try {
      // Call backend API
      const apiRes = await fetch(`${BACKEND}/api/simplify`, {
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
      saveProfile({ simplifyPage: true });

      // Log individual changes
      if (data.changes_description && data.changes_description.length > 0) {
        data.changes_description.forEach(change => log("  • " + change));
      }
    } catch (err) {
      log("Error: " + err.message + ". Make sure backend is running on " + BACKEND);
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
  "color blind":     "colorblind",
  "color filter":    "colorblind",
  "colorblind":      "colorblind",
  "dyslexia mode":   "dyslexia",
  "dyslexia":        "dyslexia",
  "reading mode":    "dyslexia",
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

  // Debug logging for duplicate detection
  console.log("[AccessFlow] Send clicked, command:", cmd, "timestamp:", Date.now());

  // Clear input box immediately for next command
  document.getElementById("cmd").value = "";

  // Check if the command matches a panel button
  const key = cmd.toLowerCase().replace(/\s+/g, " ").trim();
  const btnId = PANEL_COMMANDS[key];
  if (btnId) {
    document.getElementById(btnId).click();
    return;
  }

  // Help command
  if (key === "help" || key === "what can i say" || key === "what can i do") {
    await respond("You can say: click, highlight, scroll down, scroll up, go back, go to [website], focus mode, simplify page, read page, describe images, or say an article title to open it.");
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

  // ========== EXTENSION FEATURE COMMANDS ==========
  // Check if command is for extension features (before webpage commands)
  const normalized = cmd.toLowerCase().trim();

  // Command aliases for natural language variations
  const extensionCommandAliases = {
    'inclusive mode': ['inclusive', 'inclusive mode', 'turn on inclusive', 'enable inclusive', 'activate inclusive'],
    'focus mode': ['focus', 'focus mode', 'turn on focus', 'enable focus', 'activate focus'],
    'task tunnel': ['task tunnel', 'task mode', 'form mode', 'enable task tunnel', 'start task tunnel'],
    'simplify page': ['simplify', 'simplify page', 'make simpler', 'simplify this page'],
    'read page': ['read page', 'read this page', 'read aloud', 'start reading', 'narrate page'],
    'describe images': ['describe images', 'describe pictures', 'explain images', 'what are the images'],
    'color blind': ['color blind', 'colorblind', 'color filter', 'color blind filter', 'enable color blind'],
    'reset page': ['reset', 'reset page', 'undo changes', 'restore page'],
    'finger tracking': ['finger tracking', 'start finger tracking', 'hand tracking', 'gesture control'],
    'stop finger tracking': ['stop finger tracking', 'stop tracking', 'stop gestures'],
    'bigger text': ['bigger text', 'increase text', 'larger font', 'make text bigger'],
    'smaller text': ['smaller text', 'decrease text', 'smaller font', 'make text smaller'],
    'go to website': ['go to', 'open', 'visit', 'navigate to'],
    'help': ['help', 'what can i say', 'commands', 'show commands']
  };

  // Find matching extension command
  for (const [canonical, aliases] of Object.entries(extensionCommandAliases)) {
    if (aliases.some(alias => normalized.includes(alias))) {
      // Execute extension command
      let executed = false;
      let message = '';

      switch(canonical) {
        case 'inclusive mode':
          document.getElementById("inclusive").click();
          message = isInclusiveModeActive ? "Inclusive Mode activated" : "Inclusive Mode deactivated";
          executed = true;
          break;
        case 'focus mode':
          document.getElementById("focus").click();
          message = isFocusModeActive ? "Focus Mode activated" : "Focus Mode deactivated";
          executed = true;
          break;
        case 'task tunnel':
          document.getElementById("tunnel").click();
          message = isTunnelModeActive ? "Task Tunnel started" : "Task Tunnel stopped";
          executed = true;
          break;
        case 'simplify page':
          document.getElementById("simplify").click();
          message = "Page simplification applied";
          executed = true;
          break;
        case 'read page':
          document.getElementById("narrate-page").click();
          message = "Starting to read the page";
          executed = true;
          break;
        case 'describe images':
          document.getElementById("describe-images").click();
          message = "Describing images on the page";
          executed = true;
          break;
        case 'color blind':
          document.getElementById("colorblind").click();
          message = isColorBlindActive ? "Color blind filter activated" : "Color blind filter deactivated";
          executed = true;
          break;
        case 'reset page':
          document.getElementById("reset").click();
          message = "Page reset to original state";
          executed = true;
          break;
        case 'finger tracking':
          document.getElementById("finger-tracking").click();
          message = "Finger tracking activated";
          executed = true;
          break;
        case 'stop finger tracking':
          await fetch(`${BACKEND}/api/finger-tracker/stop`, { method: "POST" });
          message = "Finger tracking stopped";
          executed = true;
          break;
        case 'bigger text':
          const currentSize = parseInt(document.getElementById('font-size-value').textContent);
          const newSize = Math.min(currentSize + 2, 40);
          document.getElementById('font-size-slider').value = newSize;
          document.getElementById('font-size-slider').dispatchEvent(new Event('input'));
          message = `Text size increased to ${newSize}px`;
          executed = true;
          break;
        case 'smaller text':
          const currentSize2 = parseInt(document.getElementById('font-size-value').textContent);
          const newSize2 = Math.max(currentSize2 - 2, 10);
          document.getElementById('font-size-slider').value = newSize2;
          document.getElementById('font-size-slider').dispatchEvent(new Event('input'));
          message = `Text size decreased to ${newSize2}px`;
          executed = true;
          break;
        case 'help':
          message = "You can say: inclusive mode, focus mode, task tunnel, read page, describe images, finger tracking, bigger text, smaller text, go to [website], or any webpage command like 'click login' or 'search for shoes'";
          executed = true;
          break;
      }

      if (executed) {
        // Show visual feedback
        log(`✓ ${message}`);

        // Speak confirmation if TTS is available
        await respond(message);

        // Add to conversation history
        conversationHistory.push({ role: "user", text: cmd });
        conversationHistory.push({ role: "assistant", text: message });
        if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

        return; // Don't send to GPT API
      }
    }
  }
  // ========== END EXTENSION FEATURE COMMANDS ==========

  // ========== URL NAVIGATION ==========
  // Check if command is to navigate to a website
  const urlNavigationPatterns = [
    /^(?:go to|open|visit|navigate to)\s+(.+)$/i,
    /^(.+\.(?:com|org|net|edu|gov|io|co|uk|us|ca|au))$/i  // Direct URL like "google.com"
  ];

  for (const pattern of urlNavigationPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      let url = match[1].trim();

      // Handle common shortcuts
      const shortcuts = {
        'google': 'google.com',
        'youtube': 'youtube.com',
        'github': 'github.com',
        'reddit': 'reddit.com',
        'twitter': 'twitter.com',
        'x': 'x.com',
        'facebook': 'facebook.com',
        'instagram': 'instagram.com',
        'linkedin': 'linkedin.com',
        'amazon': 'amazon.com',
        'wikipedia': 'wikipedia.org',
        'netflix': 'netflix.com',
        'gmail': 'mail.google.com',
        'email': 'mail.google.com',
        'mail': 'mail.google.com',
        'maps': 'maps.google.com',
        'google maps': 'maps.google.com',
        'drive': 'drive.google.com',
        'google drive': 'drive.google.com',
        'calendar': 'calendar.google.com',
        'spotify': 'open.spotify.com',
        'whatsapp': 'web.whatsapp.com',
        'telegram': 'web.telegram.org',
        'tiktok': 'tiktok.com',
        'pinterest': 'pinterest.com',
        'ebay': 'ebay.com',
        'stackoverflow': 'stackoverflow.com',
        'stack overflow': 'stackoverflow.com',
        'chatgpt': 'chatgpt.com',
        'claude': 'claude.ai',
        'news': 'news.google.com',
        'google news': 'news.google.com',
        'bbc': 'bbc.com',
        'cnn': 'cnn.com'
      };

      if (shortcuts[url.toLowerCase()]) {
        url = shortcuts[url.toLowerCase()];
      }

      // Add https:// if no protocol specified
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      try {
        const tab = await getActiveTab();
        await chrome.tabs.update(tab.id, { url: url });
        log(`✓ Navigating to ${url}`);
        await respond(`Opening ${url}`);

        // Add to conversation history
        conversationHistory.push({ role: "user", text: cmd });
        conversationHistory.push({ role: "assistant", text: `Navigating to ${url}` });
        if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

        return; // Don't process further
      } catch (err) {
        await respond(`Could not navigate to ${url}: ${err.message}`);
        return;
      }
    }
  }
  // ========== END URL NAVIGATION ==========

  // ========== SEARCH QUERY (works even on restricted pages) ==========
  const searchMatch = normalized.match(/^(?:search|search for|google|look up|find)\s+(.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    try {
      const tab = await getActiveTab();
      await chrome.tabs.update(tab.id, { url: searchUrl });
      log(`✓ Searching for "${query}"`);
      await respond(`Searching for ${query}`);
      conversationHistory.push({ role: "user", text: cmd });
      conversationHistory.push({ role: "assistant", text: `Searching for ${query}` });
      if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);
      return;
    } catch (err) {
      await respond(`Could not search: ${err.message}`);
      return;
    }
  }
  // ========== END SEARCH QUERY ==========

  // If on a restricted URL, page commands won't work — inform the user
  {
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url || "")) {
      await respond('Say "go to" followed by a website name, or "search for" something. Example: "go to youtube" or "search for weather".');
      return;
    }
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
  // Clean up local voice if active
  stopLocalVoice();
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
      // CRITICAL: Clear auto-submit timer to prevent duplicate submission!
      if (voiceAutoSubmitTimer) {
        console.log("[AccessFlow] Clearing auto-submit timer for isFinal");
        clearTimeout(voiceAutoSubmitTimer);
        voiceAutoSubmitTimer = null;
      }
      console.log("[AccessFlow] isFinal - submitting command:", msg.transcript);

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

// --- Sidepanel-local voice recognition (for restricted URLs like chrome://newtab) ---
let localVoiceRecognition = null;
let isLocalVoiceMode = false;

function startLocalVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    log("Speech recognition not supported in this browser.");
    return false;
  }

  localVoiceRecognition = new SpeechRecognition();
  localVoiceRecognition.continuous = true;
  localVoiceRecognition.interimResults = true;
  localVoiceRecognition.lang = "en-US";

  localVoiceRecognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const isFinal = event.results[event.results.length - 1].isFinal;
    handleVoiceMessage({ type: "VOICE_RESULT", transcript, isFinal });
  };

  localVoiceRecognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      log("Microphone access denied. Allow mic in browser settings.");
      stopListening();
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      handleVoiceMessage({ type: "VOICE_ERROR", error: event.error });
    }
  };

  localVoiceRecognition.onend = () => {
    // Auto-restart if still supposed to be listening
    if (isListening && isLocalVoiceMode) {
      try { localVoiceRecognition.start(); } catch (_) {}
    }
  };

  try {
    localVoiceRecognition.start();
    return true;
  } catch (e) {
    log("Could not start voice: " + e.message);
    return false;
  }
}

function stopLocalVoice() {
  if (localVoiceRecognition) {
    try { localVoiceRecognition.abort(); } catch (_) {}
    localVoiceRecognition = null;
  }
  isLocalVoiceMode = false;
}

async function startListening() {
  if (isListening) return;

  const tab = await getActiveTab();
  const restricted = !tab?.id || isRestrictedUrl(tab.url || "");

  if (restricted) {
    // Use sidepanel-local Speech Recognition (no content script needed)
    if (!startLocalVoice()) return;
    isLocalVoiceMode = true;
    isListening = true;
    micBtn.classList.add("listening");
    playStartChime();
    document.getElementById("cmd").value = "";
    log("🎤 Voice active — say \"go to youtube\" or \"open gmail.com\"");
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
  isLocalVoiceMode = false;
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

// ========== INCLUSIVE MODE FONT SIZE SETTINGS ==========
// Load saved font size preference on startup
chrome.storage.sync.get(['inclusiveFontSize'], (result) => {
  if (result.inclusiveFontSize) {
    inclusiveFontSize = result.inclusiveFontSize;
    document.getElementById('font-size-slider').value = inclusiveFontSize;
    document.getElementById('font-size-value').textContent = inclusiveFontSize;
  }
});

// Handle font size slider changes
document.getElementById('font-size-slider').addEventListener('input', (e) => {
  inclusiveFontSize = parseInt(e.target.value);
  document.getElementById('font-size-value').textContent = inclusiveFontSize;

  // Save to Chrome storage
  chrome.storage.sync.set({ inclusiveFontSize });

  // If Inclusive Mode is active, re-apply with new size
  if (isInclusiveModeActive) {
    sendToActiveTab({ type: "INCLUSIVE_ON", fontSize: inclusiveFontSize });
  }
});
// ========== END INCLUSIVE MODE SETTINGS ==========

// ========== FOCUS MODE INTENSITY SETTINGS ==========
// Load saved focus intensity preference on startup
chrome.storage.sync.get(['focusIntensity'], (result) => {
  if (result.focusIntensity) {
    focusIntensity = result.focusIntensity;
    // Update UI to show selected intensity
    document.querySelectorAll('.intensity-btn').forEach(btn => {
      if (btn.dataset.level === focusIntensity) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
});

// Handle intensity button clicks
document.querySelectorAll('.intensity-btn').forEach(btn => {
  btn.onclick = () => {
    focusIntensity = btn.dataset.level;

    // Update UI - highlight selected button
    document.querySelectorAll('.intensity-btn').forEach(b =>
      b.classList.remove('active')
    );
    btn.classList.add('active');

    // Save preference
    chrome.storage.sync.set({ focusIntensity });

    // If Focus Mode is active, re-apply with new intensity
    if (isFocusModeActive) {
      sendToActiveTab({ type: "FOCUS_ON", intensity: focusIntensity });
      log(`Focus Mode intensity changed to ${focusIntensity}.`);
    }
  };
});
// ========== END FOCUS MODE SETTINGS ==========

// ========== COLOR BLIND FILTER SETTINGS ==========
// Load saved color blind preferences on startup
chrome.storage.sync.get(['colorBlindFilter', 'colorBlindMode'], (result) => {
  if (result.colorBlindFilter) {
    colorBlindFilter = result.colorBlindFilter;
    document.querySelectorAll('.cb-filter-btn').forEach(btn => {
      if (btn.dataset.filter === colorBlindFilter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  if (result.colorBlindMode) {
    colorBlindMode = result.colorBlindMode;
    document.querySelectorAll('.cb-mode-btn').forEach(btn => {
      if (btn.dataset.mode === colorBlindMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
});

// Handle filter type button clicks
document.querySelectorAll('.cb-filter-btn').forEach(btn => {
  btn.onclick = () => {
    colorBlindFilter = btn.dataset.filter;

    // Update UI - highlight selected button
    document.querySelectorAll('.cb-filter-btn').forEach(b =>
      b.classList.remove('active')
    );
    btn.classList.add('active');

    // Save preference
    chrome.storage.sync.set({ colorBlindFilter });

    // If active, re-apply with new filter
    if (isColorBlindActive) {
      sendToActiveTab({ type: "COLORBLIND_ON", filter: colorBlindFilter, mode: colorBlindMode });
      log(`Color blind filter changed to ${colorBlindFilter}.`);
    }
  };
});

// Handle mode toggle button clicks
document.querySelectorAll('.cb-mode-btn').forEach(btn => {
  btn.onclick = () => {
    colorBlindMode = btn.dataset.mode;

    // Update UI - highlight selected button
    document.querySelectorAll('.cb-mode-btn').forEach(b =>
      b.classList.remove('active')
    );
    btn.classList.add('active');

    // Save preference
    chrome.storage.sync.set({ colorBlindMode });

    // If active, re-apply with new mode
    if (isColorBlindActive) {
      sendToActiveTab({ type: "COLORBLIND_ON", filter: colorBlindFilter, mode: colorBlindMode });
      log(`Color blind mode changed to ${colorBlindMode}.`);
    }
  };
});
// ========== END COLOR BLIND FILTER SETTINGS ==========

// ========== DYSLEXIA MODE SETTINGS ==========
// Load saved dyslexia preferences on startup
chrome.storage.sync.get(['dyslexiaFeatures', 'dyslexiaOverlayColor'], (result) => {
  if (result.dyslexiaFeatures) {
    dyslexiaFeatures = result.dyslexiaFeatures;
    document.querySelectorAll('.dyslexia-feat-btn').forEach(btn => {
      btn.classList.toggle('active', !!dyslexiaFeatures[btn.dataset.feature]);
    });
    // Show overlay colors if overlay is active
    if (dyslexiaFeatures.overlay) {
      document.getElementById('dyslexia-overlay-colors').style.display = 'flex';
    }
  }
  if (result.dyslexiaOverlayColor) {
    dyslexiaOverlayColor = result.dyslexiaOverlayColor;
    document.querySelectorAll('.dyslexia-color-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === dyslexiaOverlayColor);
    });
  }
});
// ========== END DYSLEXIA MODE SETTINGS ==========

// ========== AUTO-SUGGEST MODE ON PAGE LOAD ==========
async function analyzeAndSuggest() {
  try {
    // Skip if user already has modes active from profile
    const profile = await loadProfile();
    if (profile.inclusiveMode || profile.focusMode || profile.simplifyPage) return;

    const res = await sendToActiveTab({ type: "ANALYZE_PAGE" });
    if (!res?.ok || !res.suggestions || res.suggestions.length === 0) return;

    const banner = document.getElementById("suggestions-banner");
    if (!banner) return;

    // Build banner content
    let html = '<div class="suggest-header">Suggested for this page</div>';
    html += '<div class="suggest-chips">';
    for (const s of res.suggestions) {
      html += `<button class="suggest-chip" data-btn="${s.buttonId}" title="${s.reason}">${s.mode}</button>`;
    }
    html += '</div>';
    html += '<button class="suggest-dismiss">Dismiss</button>';

    banner.innerHTML = html;
    banner.style.display = "block";

    // Chip click handlers
    banner.querySelectorAll(".suggest-chip").forEach(chip => {
      chip.onclick = () => {
        const btnId = chip.dataset.btn;
        const target = document.getElementById(btnId);
        if (target) target.click();
        banner.style.display = "none";
      };
    });

    // Dismiss handler
    banner.querySelector(".suggest-dismiss").onclick = () => {
      banner.style.display = "none";
    };
  } catch (_) {
    // Silent fail — suggestion is non-critical
  }
}
// ========== END AUTO-SUGGEST ==========

// ========== PROFILE STARTUP & HANDLERS ==========
// Checkbox handlers
document.getElementById("pref-auto-listen").addEventListener("change", (e) => {
  saveProfile({ autoListen: e.target.checked });
});

document.getElementById("pref-auto-read").addEventListener("change", (e) => {
  saveProfile({ autoReadPage: e.target.checked });
});

// Clear profile button
document.getElementById("clear-profile").onclick = () => {
  clearProfile();
};

// Startup: load and apply saved profile
(async () => {
  const profile = await loadProfile();
  updateProfileUI(profile);

  const hasModes = profile.inclusiveMode || profile.focusMode ||
    profile.simplifyPage || profile.dyslexiaMode || profile.autoListen || profile.autoReadPage;
  if (hasModes) {
    log("Restoring your saved preferences...");
    await applyProfile(profile);
  }

  // Auto-suggest relevant modes after profile loads
  setTimeout(analyzeAndSuggest, 1000);
})();
// ========== END PROFILE STARTUP & HANDLERS ==========

// Initial hint
log("Tip: Press Ctrl+Shift+V anytime to toggle voice input, or click the mic button.");

// ========== CLEANUP ON SIDEPANEL CLOSE ==========
// Reset page modifications when sidepanel is closed
window.addEventListener('beforeunload', async () => {
  // Only reset if user hasn't saved modes in their profile
  const profile = await loadProfile();
  const hasSavedModes = profile.inclusiveMode || profile.focusMode || profile.simplifyPage;

  if (!hasSavedModes) {
    // User hasn't saved preferences, so reset the page
    await sendToActiveTab({ type: "RESET" });
  }
});

