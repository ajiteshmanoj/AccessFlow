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
  log(res?.message || "Reset.");
};

document.getElementById("send").onclick = async () => {
  const cmd = document.getElementById("cmd").value.trim();
  if (!cmd) return;
  const res = await sendToActiveTab({ type: "CMD", cmd });
  log(res?.message || "Done.");
};

document.getElementById("cmd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("send").click();
});

// --- Content Description & Narration (GPT-4o-mini) ---

const BACKEND = "http://localhost:8000";

function speak(text) {
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = 0.9;
  utt.pitch = 1;
  window.speechSynthesis.speak(utt);
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

// Initial hint
log("Tip: Open any normal https:// website, then click a mode.");
