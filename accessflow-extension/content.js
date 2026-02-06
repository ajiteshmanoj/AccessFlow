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
      // Check multiple text sources (title often has clean product/article names)
      const textSources = [
        el.getAttribute("title"),
        el.getAttribute("aria-label"),
        el.innerText,
        el.getAttribute("value")
      ].filter(Boolean).map(t => normalize(t)).filter(t => t.length > 0);

      if (textSources.length === 0) continue;

      // Doubled base scores so tiebreakers don't override text match quality
      let score = 0;
      for (const text of textSources) {
        let s = 0;
        if (text === q) s = 6;
        else if (text.startsWith(q)) s = 4;
        else if (text.includes(q)) s = 2;
        if (s > score) score = s;
      }

      // Word-overlap fallback (handles truncated text like "Active Noise..." vs "Active Noise Cancellation")
      if (score === 0) {
        const qWords = q.split(/\s+/).filter(w => w.length > 2);
        if (qWords.length >= 2) {
          for (const text of textSources) {
            const tWords = text.split(/\s+/).filter(w => w.length > 2);
            const overlap = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length;
            const ratio = overlap / qWords.length;
            if (ratio >= 0.5 && ratio > score) score = ratio; // 0.5 to 1.0
          }
        }
      }

      if (score === 0) continue;

      // Viewport tiebreaker
      const rect = el.getBoundingClientRect();
      if (isInViewport(rect)) score += 1;

      // Region tiebreaker
      const region = detectRegion(el);
      if (region === "main" || region === "article") score += 0.5;

      // Finger proximity tiebreaker (0.4-1.0 range, won't override text scores)
      const fingerPos = window.__fingerPosition;
      if (fingerPos && (Date.now() - fingerPos.timestamp) < 2000) {
        const elCenterX = rect.left + rect.width / 2;
        const elCenterY = rect.top + rect.height / 2;
        const dist = Math.hypot(elCenterX - fingerPos.x, elCenterY - fingerPos.y);
        if (dist < 300) {
          score += 0.4 + (1.0 - 0.4) * (1 - dist / 300);
        }
      }

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

    // Deictic commands: "click this", "select this", "this one", "what is this"
    const fingerPos = window.__fingerPosition;
    const fingerRecent = fingerPos && (Date.now() - fingerPos.timestamp) < 2000;

    if (fingerRecent && (c === "click this" || c === "this one" || c === "select this")) {
      const el = document.elementFromPoint(fingerPos.x, fingerPos.y);
      if (el) {
        // Walk up to find a clickable ancestor
        let clickable = el;
        for (let i = 0; i < 5 && clickable; i++) {
          if (clickable.tagName === "A" || clickable.tagName === "BUTTON" ||
              clickable.getAttribute("role") === "button" || clickable.onclick) {
            break;
          }
          clickable = clickable.parentElement;
        }
        if (clickable) {
          highlightElement(clickable);
          clickable.scrollIntoView({ behavior: "smooth", block: "center" });
          clickable.click();
          const text = extractBestText(clickable).slice(0, 50);
          return { ok: true, message: `Clicked "${text}" at finger position.` };
        }
      }
      return { ok: false, message: "No clickable element found at finger position." };
    }

    if (fingerRecent && (c === "what is this" || c === "what's this" || c === "describe this")) {
      const el = document.elementFromPoint(fingerPos.x, fingerPos.y);
      if (el) {
        highlightElement(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const tag = el.tagName.toLowerCase();
        const text = extractBestText(el).slice(0, 120);
        const role = el.getAttribute("role") || tag;
        return { ok: true, message: `That's a ${role} element: "${text}".` };
      }
      return { ok: false, message: "No element found at finger position." };
    }

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

    if (c === "prev" || c === "previous") {
      if (tunnelState.active) {
        tunnelState.idx = Math.max(0, tunnelState.idx - 1);
        focusTunnelCurrent();
        return { ok: true, message: "Previous step." };
      }
    }

    // Scroll commands
    if (c === "scroll down" || c === "go down" || c === "page down") {
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
      return { ok: true, message: "Scrolled down." };
    }
    if (c === "scroll up" || c === "go up" || c === "page up") {
      window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" });
      return { ok: true, message: "Scrolled up." };
    }
    if (c === "go to top" || c === "scroll to top" || c === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return { ok: true, message: "Scrolled to top." };
    }
    if (c === "go to bottom" || c === "scroll to bottom" || c === "bottom") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return { ok: true, message: "Scrolled to bottom." };
    }

    // Navigation
    if (c === "go back" || c === "back") {
      window.history.back();
      return { ok: true, message: "Going back." };
    }
    if (c === "go forward" || c === "forward") {
      window.history.forward();
      return { ok: true, message: "Going forward." };
    }

    // Tab through focusable elements
    if (c === "tab" || c === "next element") {
      const focusable = Array.from(document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.getBoundingClientRect().width > 0);
      const current = focusable.indexOf(document.activeElement);
      const next = focusable[current + 1] || focusable[0];
      if (next) { next.focus(); next.scrollIntoView({ behavior: "smooth", block: "center" }); highlightElement(next); }
      return { ok: true, message: "Focused next element." };
    }

    // Ordinal pattern: "first article", "second link", "third result"
    const ordinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
    const ordMatch = c.match(/^(first|second|third|fourth|fifth)\s+(.+)$/);
    if (ordMatch) {
      const nth = ordinals[ordMatch[1]];
      const kind = ordMatch[2]; // e.g. "article", "link", "result"
      const tagMap = { article: "a", link: "a", button: "button", result: "a", item: "a" };
      const targetTag = tagMap[kind] || null;
      // Get visible elements in main/article regions
      const allEls = window.__accessflow_elements || [];
      const visible = allEls.filter(e => {
        const rect = e._el.getBoundingClientRect();
        const inMain = e.region === "main" || e.region === "article" || e.region === "other";
        return inMain && isInViewport(rect) && (!targetTag || e.tag === targetTag);
      });
      if (visible.length >= nth) {
        const target = visible[nth - 1];
        clickElement(target._el);
        return { ok: true, message: `Clicked ${ordMatch[1]} ${kind}: "${target.text.slice(0, 50)}".` };
      }
    }

    // Fuzzy fallback: try matching raw input as clickable text
    const fuzzyMatch = findByText(c);
    if (fuzzyMatch) {
      clickElement(fuzzyMatch);
      const matchText = normalize(fuzzyMatch.innerText || fuzzyMatch.getAttribute("aria-label") || "").slice(0, 50);
      return { ok: true, message: `Clicked "${matchText}".` };
    }

    return { ok: false, message: `Unknown command. Try: "click login", "highlight search", "scroll down", "go back".` };
  }

  // --- AI Command Interpreter helpers ---

  // Classify an element into a page region by walking up the DOM
  function detectRegion(el) {
    const regionMap = {
      NAV: "nav", HEADER: "header", FOOTER: "footer",
      MAIN: "main", ARTICLE: "article", ASIDE: "sidebar", FORM: "form"
    };
    const roleMap = {
      navigation: "nav", banner: "header", contentinfo: "footer",
      main: "main", complementary: "sidebar", form: "form"
    };
    const classHints = [
      [/\bnav(bar|igation)?\b/i, "nav"],
      [/\bheader\b/i, "header"],
      [/\bfooter\b/i, "footer"],
      [/\bmain[-_]?content\b/i, "main"],
      [/\barticle\b/i, "article"],
      [/\bsidebar\b/i, "sidebar"]
    ];

    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      // Check semantic tag
      const tag = node.tagName;
      if (regionMap[tag]) return regionMap[tag];
      // Check ARIA role
      const role = (node.getAttribute("role") || "").toLowerCase();
      if (roleMap[role]) return roleMap[role];
      // Check class/id heuristics
      const ci = ((node.className || "") + " " + (node.id || "")).toLowerCase();
      for (const [regex, region] of classHints) {
        if (regex.test(ci)) return region;
      }
      node = node.parentElement;
    }
    return "other";
  }

  function isInViewport(rect) {
    return rect.bottom > 0 && rect.top < window.innerHeight &&
           rect.right > 0 && rect.left < window.innerWidth;
  }

  function viewportOverlapScore(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overlapX = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const overlapY = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const elArea = rect.width * rect.height;
    if (elArea === 0) return 0;
    return Math.min(1, (overlapX * overlapY) / elArea);
  }

  // Extract the most meaningful text from an element (avoids noisy innerText on product cards)
  function extractBestText(el) {
    // For links/buttons, prefer title attribute (e-commerce sites put clean product names here)
    if (el.tagName === "A" || el.tagName === "BUTTON") {
      const title = (el.getAttribute("title") || "").trim();
      if (title.length > 3) return title;
    }
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel.length > 3) return ariaLabel;

    const innerText = (el.innerText || "").trim();
    // For links with very long innerText (product/article cards), try to find the primary text child
    if (el.tagName === "A" && innerText.length > 100) {
      const nameEl = el.querySelector("[class*='name' i], [class*='title' i], h1, h2, h3, h4");
      if (nameEl) {
        const nameText = (nameEl.innerText || "").trim();
        if (nameText.length > 5) return nameText;
      }
    }

    return innerText ||
      el.getAttribute("placeholder") ||
      el.getAttribute("value") ||
      el.getAttribute("alt") ||
      "";
  }

  function getInteractiveElements() {
    const selectors = "a, button, [role='button'], input, select, textarea, [onclick], [tabindex]";
    const nodes = Array.from(document.querySelectorAll(selectors));
    const elements = [];
    let idx = 0;
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = extractBestText(el).replace(/\s+/g, " ").slice(0, 120);
      if (!text) continue;

      const region = detectRegion(el);
      const inVP = isInViewport(rect);
      const overlap = inVP ? viewportOverlapScore(rect) : 0;

      // Priority score: viewport visibility dominates, then region
      let score = 0;
      if (inVP) score += 50 + Math.round(overlap * 30); // 50-80 for visible
      if (region === "main" || region === "article") score += 20;
      else if (region === "form") score += 15;
      else if (region === "other") score += 5;
      // nav/footer/header/sidebar get no bonus

      // Finger proximity bonus: elements near finger cursor get +40 to +100
      const fingerPos = window.__fingerPosition;
      if (fingerPos && (Date.now() - fingerPos.timestamp) < 2000) {
        const elCenterX = rect.left + rect.width / 2;
        const elCenterY = rect.top + rect.height / 2;
        const dist = Math.hypot(elCenterX - fingerPos.x, elCenterY - fingerPos.y);
        if (dist < 300) {
          score += Math.round(100 - (dist / 300) * 60); // +40 to +100
        }
      }

      elements.push({
        index: idx,
        tag: el.tagName.toLowerCase(),
        text,
        type: el.getAttribute("type") || null,
        region,
        _score: score,
        _el: el
      });
      idx++;
    }

    // Store ALL elements for execution (index = stable DOM order key)
    window.__accessflow_elements = elements;

    // Return sorted by score descending (highest priority first)
    const sorted = [...elements].sort((a, b) => b._score - a._score);
    return sorted.map(({ _el, _score, ...rest }) => rest);
  }

  function executeAIAction(action, targetIndex, value) {
    const elements = window.__accessflow_elements || [];

    if (action === "scroll") {
      if (value === "up") {
        window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" });
        return { ok: true, message: "Scrolled up." };
      }
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
      return { ok: true, message: "Scrolled down." };
    }

    if (action === "none") {
      return { ok: false, message: "Could not find a matching element." };
    }

    const entry = elements.find(e => e.index === targetIndex);
    if (!entry || !entry._el) {
      return { ok: false, message: "Element not found on page." };
    }

    const el = entry._el;

    if (action === "click") {
      highlightElement(el);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.click(), 400);
      return { ok: true, message: `Clicking "${entry.text.slice(0, 50)}".` };
    }

    if (action === "highlight") {
      highlightElement(el);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return { ok: true, message: `Highlighted "${entry.text.slice(0, 50)}".` };
    }

    if (action === "type") {
      highlightElement(el);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
      el.value = value || "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: `Typed into "${entry.text.slice(0, 50)}".` };
    }

    return { ok: false, message: "Unknown action: " + action };
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

  // --- Voice Input (Speech-to-Text) via port ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voiceRecognition = null;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "accessflow-voice") return;

    if (!SpeechRecognition) {
      port.postMessage({ type: "VOICE_ERROR", error: "Speech recognition not supported on this page." });
      return;
    }

    // Stop any previous session
    if (voiceRecognition) {
      try { voiceRecognition.abort(); } catch (_) {}
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = "en-US";

    let portOpen = true;

    voiceRecognition.onresult = (event) => {
      let transcript = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      if (portOpen) {
        try { port.postMessage({ type: "VOICE_RESULT", transcript, isFinal }); } catch (_) {}
      }
    };

    voiceRecognition.onend = () => {
      // In continuous mode the browser may still fire onend (e.g. network
      // hiccup, long silence timeout). Restart automatically while the
      // port is still open — the sidepanel controls the real stop via
      // port disconnect.
      if (portOpen && voiceRecognition) {
        try { voiceRecognition.start(); } catch (_) {
          try { port.postMessage({ type: "VOICE_END" }); } catch (_2) {}
          voiceRecognition = null;
        }
        return;
      }
      voiceRecognition = null;
    };

    voiceRecognition.onerror = (event) => {
      // "aborted" fires when we intentionally stop — not a real error
      if (event.error === "aborted") return;
      let errorMsg = event.error;
      if (event.error === "not-allowed") {
        errorMsg = "Microphone access denied. Allow mic permission and try again.";
      }
      if (portOpen) {
        try { port.postMessage({ type: "VOICE_ERROR", error: errorMsg }); } catch (_) {}
      }
    };

    port.onDisconnect.addListener(() => {
      portOpen = false;
      if (voiceRecognition) {
        try { voiceRecognition.abort(); } catch (_) {}
        voiceRecognition = null;
      }
    });

    voiceRecognition.start();
  });
  // --- end Voice Input ---

  // ========== FINGER TRACKING CURSOR ==========
  const CURSOR_ID = "accessflow-finger-cursor";
  let fingerCursor = null;

  function createFingerCursor() {
    if (fingerCursor) return fingerCursor;

    fingerCursor = document.createElement("div");
    fingerCursor.id = CURSOR_ID;
    fingerCursor.style.position = "fixed";
    fingerCursor.style.width = "30px";
    fingerCursor.style.height = "30px";
    fingerCursor.style.borderRadius = "50%";
    fingerCursor.style.background = "rgba(37, 99, 235, 0.6)";
    fingerCursor.style.border = "3px solid #2563eb";
    fingerCursor.style.zIndex = "2147483646";
    fingerCursor.style.pointerEvents = "none";
    fingerCursor.style.transition = "transform 0.1s ease-out, background 0.2s ease";
    fingerCursor.style.display = "none";
    document.body.appendChild(fingerCursor);
    return fingerCursor;
  }

  function removeFingerCursor() {
    if (fingerCursor) {
      fingerCursor.remove();
      fingerCursor = null;
    }
    window.__fingerPosition = null;
  }

  let lastHoveredElement = null;

  function updateFingerCursor(x, y, gesture) {
    const cursor = createFingerCursor();
    cursor.style.display = "block";

    const pixelX = x * window.innerWidth;
    const pixelY = y * window.innerHeight;

    cursor.style.left = `${pixelX}px`;
    cursor.style.top = `${pixelY}px`;

    // Store finger position for voice command scoring and deictic commands
    window.__fingerPosition = { x: pixelX, y: pixelY, timestamp: Date.now() };

    // Hover feedback — show what element is under the cursor
    const elUnder = document.elementFromPoint(pixelX, pixelY);
    if (elUnder && elUnder !== cursor && elUnder !== lastHoveredElement) {
      // Remove outline from previous element
      if (lastHoveredElement) lastHoveredElement.style.outline = "";
      // Subtle outline on hovered element
      if (elUnder.tagName !== "HTML" && elUnder.tagName !== "BODY") {
        elUnder.style.outline = "2px solid rgba(37, 99, 235, 0.4)";
      }
      lastHoveredElement = elUnder;
    }

    if (gesture === "click") {
      // Double-pinch → click
      cursor.style.background = "rgba(34, 197, 94, 0.8)";
      cursor.style.border = "3px solid #22c55e";
      cursor.style.transform = "translate(-50%, -50%) scale(1.4)";

      if (elUnder && elUnder !== cursor) {
        elUnder.click();
      }

      setTimeout(() => {
        cursor.style.background = "rgba(37, 99, 235, 0.6)";
        cursor.style.border = "3px solid #2563eb";
        cursor.style.transform = "translate(-50%, -50%)";
      }, 250);

    } else if (gesture === "highlight") {
      // Pinch + hold → highlight element
      cursor.style.background = "rgba(245, 158, 11, 0.8)";
      cursor.style.border = "3px solid #f59e0b";
      cursor.style.transform = "translate(-50%, -50%) scale(1.2)";

      if (elUnder && elUnder !== cursor) {
        elUnder.style.outline = "3px solid #f59e0b";
        elUnder.style.outlineOffset = "2px";
      }

      setTimeout(() => {
        cursor.style.background = "rgba(37, 99, 235, 0.6)";
        cursor.style.border = "3px solid #2563eb";
        cursor.style.transform = "translate(-50%, -50%)";
      }, 400);

    } else if (gesture === "pinch_start" || gesture === "pinch_hold") {
      // Pinching — show grab state
      cursor.style.background = "rgba(251, 191, 36, 0.6)";
      cursor.style.border = "3px solid #fbbf24";
      cursor.style.transform = "translate(-50%, -50%) scale(0.85)";

    } else {
      // Default pointing state
      cursor.style.background = "rgba(37, 99, 235, 0.6)";
      cursor.style.border = "3px solid #2563eb";
      cursor.style.transform = "translate(-50%, -50%)";
    }
  }

  function clearHoverOutline() {
    if (lastHoveredElement) {
      lastHoveredElement.style.outline = "";
      lastHoveredElement = null;
    }
  }
  // ========== END FINGER TRACKING CURSOR ==========

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
      // ========== FINGER TRACKING HANDLERS ==========
      if (msg?.type === "FINGER_POSITION") {
        if (msg.detected) {
          // SCROLL MODE: pinch + drag
          if (msg.mode === "scroll") {
            if (fingerCursor) fingerCursor.style.display = "none";
            window.__fingerPosition = null;
            clearHoverOutline();

            if (msg.scroll === "scroll_up") {
              window.scrollBy({ top: -100, behavior: "auto" });
            } else if (msg.scroll === "scroll_down") {
              window.scrollBy({ top: 100, behavior: "auto" });
            }
          }
          // CURSOR MODE: point, click, highlight
          else {
            updateFingerCursor(msg.x, msg.y, msg.gesture);
          }
        } else {
          // No hand — hide cursor and clear outlines
          if (fingerCursor) fingerCursor.style.display = "none";
          window.__fingerPosition = null;
          clearHoverOutline();
        }
        sendResponse({ ok: true });
        return true;
      }
      if (msg?.type === "STOP_FINGER_CURSOR") {
        removeFingerCursor();
        sendResponse({ ok: true });
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
      if (msg?.type === "GET_PAGE_ELEMENTS") {
        const elements = getInteractiveElements();
        sendResponse({ ok: true, elements, page_title: document.title, page_url: window.location.href });
        return true;
      }
      if (msg?.type === "EXECUTE_ACTION") {
        const res = executeAIAction(msg.action, msg.target_index, msg.value);
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
