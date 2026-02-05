  // AccessFlow content script (hackathon starter)
  // Provides Inclusive Mode, Focus Mode, Task Tunnel + simple command handler.

  const STYLE_ID = "accessflow-styles";
  const HILITE_CLASS = "accessflow-highlight";
  const OVERLAY_ID = "accessflow-overlay";

  function setStyle(cssText) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = cssText;
  }

  function resetAll() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));
    // remove inline hiding used by Focus Mode
    document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
      e.style.removeProperty("display");
      e.removeAttribute("data-accessflow-hidden");
    });
  }

  function inclusiveMode() {
    setStyle(`
      /* Readability baseline */
      html, body { font-size: 18px !important; line-height: 1.7 !important; }
      body { padding: 16px !important; }
      p, li { letter-spacing: 0.02em !important; }

      /* Limit line length for readability */
      main, article, .content, #content { max-width: 80ch !important; margin: 0 auto !important; }

      /* Bigger tap targets */
      a, button, input, select, textarea, [role="button"] {
        min-height: 44px !important;
        min-width: 44px !important;
      }
      button, a, [role="button"] { padding: 10px 14px !important; }

      /* Spacing & focus */
      * { scroll-margin-top: 80px; }
      :focus { outline: 3px solid #2563eb !important; outline-offset: 2px !important; }

      /* Reduce motion */
      *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }

      /* Highlight class */
      .${HILITE_CLASS} { outline: 4px solid #f59e0b !important; outline-offset: 3px !important; border-radius: 8px !important; }
    `);
  }

  function focusMode() {
    // Simple heuristic: hide common clutter containers (ads, sidebars, popups)
    const selectorsToHide = [
      "aside", "nav", "footer",
      "[class*='sidebar']", "[id*='sidebar']",
      "[class*='advert']", "[id*='advert']", "[class*='ad-']", "[id*='ad-']",
      "[class*='cookie']", "[id*='cookie']",
      "[role='dialog']", ".modal", ".popup"
    ];

    selectorsToHide.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        // Don't hide the primary nav if it's the only way to reach content; keep it simple for demo
        if (el.closest("main")) return;
        el.style.display = "none";
        el.setAttribute("data-accessflow-hidden", "1");
      });
    });

    // Highlight main content if available
    const main = document.querySelector("main") || document.querySelector("article") || document.body;
    highlightElement(main);
    main.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function highlightElement(el) {
    if (!el) return;
    document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));
    el.classList.add(HILITE_CLASS);
  }

  function normalize(s) {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function getClickableCandidates() {
    const nodes = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']"));
    return nodes.filter(n => n && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0);
  }

  function findByText(query) {
    const q = normalize(query);
    const candidates = getClickableCandidates();
    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const text = normalize(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || el.getAttribute("title"));
      if (!text) continue;
      let score = 0;
      if (text === q) score = 3;
      else if (text.startsWith(q)) score = 2;
      else if (text.includes(q)) score = 1;

      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }


function findSearchInput() {
  // Look for a likely search input on the page
  return (
    findInputLike("search") ||
    document.querySelector("input[type='search']") ||
    findInputLike("query") ||
    document.querySelector("input[name*='search' i]") ||
    document.querySelector("input[placeholder*='search' i]") ||
    document.querySelector("input[class*='search' i]") ||
    document.querySelector("input[aria-label*='search' i]") ||
    // fallback: prominent text input near top
    Array.from(document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])"))
      .filter(inp => {
        const rect = inp.getBoundingClientRect();
        return rect.width > 120 && rect.height > 20;
      })
      .sort((a,b)=>a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] ||
    null
  );
}

function findPaginationButton(direction = "next", pageNum = null) {
  const dir = (direction || "next").toLowerCase();

  if (pageNum !== null && pageNum !== undefined) {
    const n = String(pageNum);
    const candidates = Array.from(document.querySelectorAll("a, button, [role='button']"))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const t = (el.innerText || "").trim();
        return t === n;
      });
    if (candidates.length) return candidates[0];
  }

  const relSel = (dir === "prev" || dir === "previous") ? "a[rel='prev'], a[rel='previous']" : "a[rel='next']";
  const relEl = document.querySelector(relSel);
  if (relEl) return relEl;

  const ariaNeedle = (dir === "prev" || dir === "previous") ? "prev" : "next";
  const ariaEl = document.querySelector(`a[aria-label*="${ariaNeedle}" i], button[aria-label*="${ariaNeedle}" i], [role='button'][aria-label*="${ariaNeedle}" i]`);
  if (ariaEl) return ariaEl;

  const host = (location.hostname || "").toLowerCase();
  if (host.includes("shopee")) {
    const shSel = (dir === "prev" || dir === "previous")
      ? ".shopee-mini-page-controller__prev-btn, .shopee-page-controller__prev-btn"
      : ".shopee-mini-page-controller__next-btn, .shopee-page-controller__next-btn";
    const sh = document.querySelector(shSel);
    if (sh) return sh;
  }

  const keywords = (dir === "prev" || dir === "previous")
    ? ["previous", "prev", "back", "‹", "«", "<"]
    : ["next", "more", "›", "»", ">", "→"];
  for (const k of keywords) {
    const el = findByText(k);
    if (el) return el;
  }
  return null;
}
  function findInputLike(query) {
    const q = normalize(query);
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    // Try matching by placeholder, aria-label, label text
    for (const el of inputs) {
      const ph = normalize(el.getAttribute("placeholder"));
      const aria = normalize(el.getAttribute("aria-label"));
      const name = normalize(el.getAttribute("name"));
      if (ph.includes(q) || aria.includes(q) || name.includes(q)) return el;
    }
    // fallback: first text input
    return inputs.find(i => i.tagName === "TEXTAREA" || (i.tagName === "INPUT" && ["text","search","email","tel","url","password"].includes(i.type))) || null;
  }

  function clickElement(el) {
    if (!el) return false;
    highlightElement(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.click();
    return true;
  }

  function typeInto(el, text, opts = {}) {
    if (!el) return false;
    highlightElement(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();

    // Clear existing value first (helps for search boxes with previous queries)
    try {
      if (opts.clear !== false) {
        if (typeof el.select === "function") el.select();
        if (typeof el.setSelectionRange === "function" && typeof el.value === "string") {
          el.setSelectionRange(0, el.value.length);
        }
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {}

    el.value = text;

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try { el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true })); } catch {}
    return true;
  }


  // Task Tunnel: walk inputs in a form-like order, highlighting one at a time.
  let tunnelState = { active: false, idx: 0, inputs: [] };

  function startTunnel() {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .filter(el => !["hidden","submit","button","image","file","reset"].includes((el.type || "").toLowerCase()));
    tunnelState = { active: true, idx: 0, inputs };
    showTunnelOverlay();
    focusTunnelCurrent();
  }

  function showTunnelOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.position = "fixed";
      overlay.style.bottom = "16px";
      overlay.style.right = "16px";
      overlay.style.zIndex = "2147483647";
      overlay.style.background = "white";
      overlay.style.border = "1px solid #e5e7eb";
      overlay.style.borderRadius = "12px";
      overlay.style.boxShadow = "0 10px 20px rgba(0,0,0,0.12)";
      overlay.style.padding = "10px";
      overlay.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      overlay.style.fontSize = "13px";
      overlay.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>Task Tunnel</strong>
          <span id="af-step" style="color:#6b7280;"></span>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="af-prev" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#f3f4f6;cursor:pointer;">Prev</button>
          <button id="af-next" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#eef2ff;cursor:pointer;">Next</button>
          <button id="af-exit" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff1f2;cursor:pointer;">Exit</button>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector("#af-prev").onclick = () => { tunnelState.idx = Math.max(0, tunnelState.idx - 1); focusTunnelCurrent(); };
      overlay.querySelector("#af-next").onclick = () => { tunnelState.idx = Math.min(tunnelState.inputs.length - 1, tunnelState.idx + 1); focusTunnelCurrent(); };
      overlay.querySelector("#af-exit").onclick = () => { tunnelState.active = false; document.getElementById(OVERLAY_ID)?.remove(); };
    }
    updateTunnelStep();
  }

  function updateTunnelStep() {
    const el = document.getElementById("af-step");
    if (!el) return;
    el.textContent = tunnelState.inputs.length ? `Step ${tunnelState.idx + 1}/${tunnelState.inputs.length}` : "No inputs found";
  }

  function focusTunnelCurrent() {
    updateTunnelStep();
    const el = tunnelState.inputs[tunnelState.idx];
    if (!el) return;
    highlightElement(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

  // ========== INTELLIGENT PAGE SIMPLIFICATION ==========
  const SIMPLIFY_STYLE_ID = "accessflow-simplify-styles";
  let isSimplified = false;

  function applySimplification(cssRules) {
    let styleEl = document.getElementById(SIMPLIFY_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = SIMPLIFY_STYLE_ID;
      document.head.appendChild(styleEl);
    }

    const cssText = cssRules.map(rule =>
      `${rule.selector} { ${rule.property}: ${rule.value} !important; }`
    ).join("\n");

    styleEl.textContent = cssText;
    isSimplified = true;
  }

  function removeSimplification() {
    const styleEl = document.getElementById(SIMPLIFY_STYLE_ID);
    if (styleEl) styleEl.remove();
    isSimplified = false;
  }

  function getPageContent() {
    return {
      url: window.location.href,
      title: document.title,
      content: document.body.innerText.substring(0, 5000) // First 5000 chars
    };
  }

  function handleCommand(cmd) {
    const c = normalize(cmd);

    // Simple patterns:
    // "highlight search", "click login", "type email john@x.com"
    const mHighlight = c.match(/^highlight\s+(.+)$/);
    if (mHighlight) {
      const target = findByText(mHighlight[1]) || findInputLike(mHighlight[1]);
      if (!target) return { ok: false, message: `Couldn't find "${mHighlight[1]}". Try another keyword.` };
      highlightElement(target);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return { ok: true, message: `Highlighted "${mHighlight[1]}".` };
    }

    const mClick = c.match(/^click\s+(.+)$/);
    if (mClick) {
      const target = findByText(mClick[1]);
      if (!target) return { ok: false, message: `Couldn't find a clickable element for "${mClick[1]}".` };
      clickElement(target);
      return { ok: true, message: `Clicked "${mClick[1]}".` };
    }

    const mType = c.match(/^type\s+(.+?)\s+(.+)$/); // type <field> <text>
    if (mType) {
      const field = mType[1];
      const text = cmd.trim().slice(cmd.toLowerCase().indexOf(field) + field.length).trim(); // keep original casing
      const input = findInputLike(field);
      if (!input) return { ok: false, message: `Couldn't find an input for "${field}".` };
      typeInto(input, text);
      return { ok: true, message: `Typed into "${field}".` };
    }

    if (c === "next" && tunnelState.active) {
      tunnelState.idx = Math.min(tunnelState.inputs.length - 1, tunnelState.idx + 1);
      focusTunnelCurrent();
      return { ok: true, message: "Next step." };
    }

    if (c === "prev" && tunnelState.active) {
      tunnelState.idx = Math.max(0, tunnelState.idx - 1);
      focusTunnelCurrent();
      return { ok: true, message: "Previous step." };
    }

    // Higher-level: "search for <query>"
const mSearch = c.match(/^(search for|search)\s+(.+)$/);
if (mSearch) {
  const query = cmd.replace(/^(search for|search)\s+/i, "").trim();
  if (!query) return { ok: false, message: "Please say what you want to search for." };

  const input = findSearchInput();
  if (!input) return { ok: false, message: "Couldn't find a search box on this page." };

  typeInto(input, query, { clear: true });

// Trigger search (some sites require keypress + keyCode/which and/or a submit button click)
try { input.focus(); } catch {}

const evOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
try {
  input.dispatchEvent(new KeyboardEvent("keydown", evOpts));
  input.dispatchEvent(new KeyboardEvent("keypress", evOpts));
  input.dispatchEvent(new KeyboardEvent("keyup", evOpts));
} catch {}

// If a submit button exists in the same form/container, click it as a fallback
try {
  const form = input.form;
  if (form) {
    const btn =
      form.querySelector("button[type='submit'], input[type='submit'], button[aria-label*='search' i]") ||
      form.querySelector("button, [role='button']");
    if (btn) btn.click();
  }
} catch {}

  return { ok: true, message: `Searching for "${query}"...` };
}

// In-site pagination (kept separate from browser back/forward)
if (c === "next results" || c === "next result page") {
  const el = findPaginationButton("next");
  if (!el) return { ok: false, message: "Couldn't find a Next button on this page." };
  clickElement(el);
  return { ok: true, message: "Going to next results page…" };
}
if (c === "previous results" || c === "prev results" || c === "previous result page") {
  const el = findPaginationButton("prev");
  if (!el) return { ok: false, message: "Couldn't find a Previous button on this page." };
  clickElement(el);
  return { ok: true, message: "Going to previous results page…" };
}
const mGoPage = c.match(/^(go to results page|results page)\s+(\d+)$/);
if (mGoPage) {
  const n = Number(mGoPage[2]);
  const el = findPaginationButton("page", n);
  if (!el) return { ok: false, message: `Couldn't find page ${n} on this page.` };
  clickElement(el);
  return { ok: true, message: `Going to results page ${n}…` };
}

// Scrolling
if (c === "scroll down") {
  window.scrollBy({ top: Math.max(300, window.innerHeight * 0.8), behavior: "smooth" });
  return { ok: true, message: "Scrolled down." };
}
if (c === "scroll up") {
  window.scrollBy({ top: -Math.max(300, window.innerHeight * 0.8), behavior: "smooth" });
  return { ok: true, message: "Scrolled up." };
}

return { ok: false, message: `Unknown command. Try: "highlight search", "click login", "type email john@example.com".` };
  }

  // --- Content Description & Narration helpers ---

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(",")[1]); // strip "data:...;base64," prefix
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageAsBase64(src) {
    try {
      const res  = await fetch(src, { credentials: "include" });
      const blob = await res.blob();
      return await blobToBase64(blob);
    } catch (_) {
      return null; // caller will fall back to raw URL
    }
  }

  async function getPageImages() {
    const imgs = Array.from(document.querySelectorAll("img"));
    const meaningful = imgs.filter((img) => {
      if (img.getAttribute("role") === "presentation") return false;
      if (img.getAttribute("alt") === "") return false; // explicitly decorative
      const rect = img.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 100;
    });

    const results = [];
    for (const img of meaningful) {
      const src = img.getAttribute("src");
      if (!src) continue;
      const absoluteSrc = new URL(src, document.baseURI).href;
      const base64 = await fetchImageAsBase64(absoluteSrc);
      results.push({
        base64: base64 || null,
        url: base64 ? null : absoluteSrc,  // only send URL if base64 failed
        original_alt: img.getAttribute("alt") || null
      });
    }
    return results;
  }

  function getPageSections() {
    const headingTags = ["H1", "H2", "H3", "H4", "H5", "H6"];
    const allElements = Array.from(document.body.querySelectorAll("*"));
    const sections = [];
    let current = null;

    for (const el of allElements) {
      if (headingTags.includes(el.tagName)) {
        if (current) sections.push(current);
        current = { heading: el.textContent.trim(), texts: [] };
      } else if (current && el.children.length === 0) {
        // leaf node — grab its text so we don't double-count nested elements
        const text = el.textContent.trim();
        if (text) current.texts.push(text);
      }
    }
    if (current) sections.push(current);

    // If no headings found at all, treat the whole body as one section
    if (sections.length === 0) {
      sections.push({
        heading: document.title || "Page Content",
        texts: [document.body.innerText.slice(0, 3000)]
      });
    }

    return sections.map((s) => ({
      heading: s.heading,
      text: s.texts.join(" ").slice(0, 1500)  // cap per-section length
    }));
  }

  // --- end Content Description & Narration helpers ---

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg?.type === "PING") {
        sendResponse({ ok: true, message: "pong" });
        return true;
      }
      if (msg?.type === "INCLUSIVE_ON") {
        inclusiveMode();
        sendResponse({ ok: true, message: "Inclusive Mode applied." });
        return true;
      }
      if (msg?.type === "FOCUS_ON") {
        focusMode();
        sendResponse({ ok: true, message: "Focus Mode applied." });
        return true;
      }
      if (msg?.type === "TUNNEL_ON") {
        startTunnel();
        sendResponse({ ok: true, message: "Task Tunnel started." });
        return true;
      }
      if (msg?.type === "RESET") {
        resetAll();
        removeSimplification(); // Also remove simplification on reset
        sendResponse({ ok: true, message: "Reset complete." });
        return true;
      }
      // ========== SIMPLIFY MESSAGE HANDLERS ==========
      if (msg?.type === "SIMPLIFY_ON") {
        const pageData = getPageContent();
        sendResponse({ ok: true, pageData });
        return true;
      }
      if (msg?.type === "SIMPLIFY_OFF") {
        removeSimplification();
        sendResponse({ ok: true, message: "Simplification removed" });
        return true;
      }
      if (msg?.type === "APPLY_SIMPLIFY_RULES") {
        applySimplification(msg.rules);
        sendResponse({ ok: true, message: "Page simplified" });
        return true;
      }
      if (msg?.type === "CMD") {
        const res = handleCommand(msg.cmd || "");
        sendResponse(res);
        return true;
      }
      if (msg?.type === "DESCRIBE_IMAGES") {
        getPageImages().then((images) => {
          sendResponse({ ok: true, images });
        });
        return true; // keep channel open for async
      }
      if (msg?.type === "GET_SECTIONS") {
        const sections = getPageSections();
        sendResponse({ ok: true, sections, page_title: document.title, page_url: window.location.href });
        return true;
      }
      sendResponse({ ok: false, message: "Unknown message." });
    } catch (e) {
      sendResponse({ ok: false, message: "Error: " + (e?.message || String(e)) });
    }
    return true;
  });
