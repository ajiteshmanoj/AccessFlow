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

  function typeInto(el, text) {
    if (!el) return false;
    highlightElement(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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

    return { ok: false, message: `Unknown command. Try: "highlight search", "click login", "type email john@example.com".` };
  }

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
        sendResponse({ ok: true, message: "Reset complete." });
        return true;
      }
      if (msg?.type === "CMD") {
        const res = handleCommand(msg.cmd || "");
        sendResponse(res);
        return true;
      }
      sendResponse({ ok: false, message: "Unknown message." });
    } catch (e) {
      sendResponse({ ok: false, message: "Error: " + (e?.message || String(e)) });
    }
    return true;
  });
