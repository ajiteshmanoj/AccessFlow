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

// Initial hint
log("Tip: Open any normal https:// website, then click a mode.");
