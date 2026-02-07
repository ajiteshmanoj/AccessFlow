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

  // Shared function for aggressive cleanup of Inclusive Mode styles
  function cleanupInclusiveMode() {
    console.log("[AccessFlow] Cleaning up Inclusive Mode...");

    // Stop observer and interval FIRST (critical!)
    if (inclusiveModeObserver) {
      console.log("[AccessFlow] Stopping Inclusive Mode observer");
      inclusiveModeObserver.disconnect();
      inclusiveModeObserver = null;
    }
    if (inclusiveModeInterval) {
      console.log("[AccessFlow] Stopping Inclusive Mode interval");
      clearInterval(inclusiveModeInterval);
      inclusiveModeInterval = null;
    }

    // Wait a brief moment to ensure interval doesn't fire again
    setTimeout(() => {
      // Remove style elements
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) {
        console.log("[AccessFlow] Removing main style tag");
        styleEl.remove();
      }

      // Remove styles from Shadow DOM
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          el.shadowRoot.getElementById(STYLE_ID)?.remove();
        }
      });

      // AGGRESSIVE: Remove ALL inline styles from EVERY element
      const allElements = document.querySelectorAll('*');
      console.log(`[AccessFlow] Cleaning styles from ${allElements.length} elements`);

      allElements.forEach(el => {
        // Check if element has any inline styles
        if (el.style && el.style.length > 0) {
          // Remove all inline styles that were added by AccessFlow
          const styledProps = Array.from(el.style);
          styledProps.forEach(prop => {
            const priority = el.style.getPropertyPriority(prop);
            // Remove if it has !important (likely from our script)
            if (priority === 'important') {
              el.style.removeProperty(prop);
            }
            // Also remove specific properties we know we set
            if (['font-size', 'line-height', 'letter-spacing', 'padding', 'min-height', 'min-width'].includes(prop)) {
              el.style.removeProperty(prop);
            }
          });
        }
      });

      // Remove ALL styles from html and body (complete reset)
      document.documentElement.removeAttribute('style');
      document.body.removeAttribute('style');

      // Force browser to recalculate all styles (trigger reflow)
      document.body.offsetHeight; // Reading this forces a reflow

      console.log("[AccessFlow] Inclusive Mode cleanup complete!");
    }, 50); // Small delay to ensure interval/observer are truly stopped
  }

  function resetAll() {
    console.log("[AccessFlow] Starting full reset...");

    // Clean up Inclusive Mode
    cleanupInclusiveMode();

    // Stop Task Tunnel observer
    if (tunnelObserver) {
      tunnelObserver.disconnect();
      tunnelObserver = null;
    }
    if (tunnelRefreshTimeout) {
      clearTimeout(tunnelRefreshTimeout);
      tunnelRefreshTimeout = null;
    }
    tunnelState.active = false;

    // Additional cleanup for other modes
    setTimeout(() => {
      document.getElementById(OVERLAY_ID)?.remove();
      document.getElementById(SIMPLIFY_STYLE_ID)?.remove();

      // Remove highlights
      document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));

      // Remove inline hiding used by Focus Mode
      document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
        e.style.removeProperty("display");
        e.removeAttribute("data-accessflow-hidden");
      });

      // Remove finger cursor hover outlines
      clearHoverOutline();

      console.log("[AccessFlow] Reset complete! Styles should be fully cleared.");
    }, 60); // Slight delay after Inclusive Mode cleanup
  }

  // ========== ENHANCED INCLUSIVE MODE (Works on Google & Dynamic Sites) ==========
  let inclusiveModeObserver = null;
  let inclusiveModeInterval = null;
  let currentInclusiveFontSize = 18;

  function generateInclusiveCSS(fontSize) {
    return `
      /* CSS Variables for better inheritance */
      :root {
        --af-font-size: ${fontSize}px !important;
        --af-line-height: 1.7 !important;
        --af-letter-spacing: 0.02em !important;
      }

      /* Readability baseline - very high specificity */
      html, html body {
        font-size: ${fontSize}px !important;
        line-height: 1.7 !important;
      }

      /* Apply to all text elements with high specificity */
      html body p, html body span, html body div, html body a,
      html body li, html body td, html body th,
      html body h1, html body h2, html body h3, html body h4, html body h5, html body h6,
      html body label, html body button {
        font-size: ${fontSize}px !important;
        line-height: 1.7 !important;
      }

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
    `;
  }

  function applyDirectStyles(fontSize) {
    // Apply to html and body
    document.documentElement.style.setProperty('font-size', `${fontSize}px`, 'important');
    document.body.style.setProperty('font-size', `${fontSize}px`, 'important');
    document.body.style.setProperty('line-height', '1.7', 'important');

    // Set CSS variables at root
    document.documentElement.style.setProperty('--af-font-size', `${fontSize}px`);
    document.documentElement.style.setProperty('--af-line-height', '1.7');

    // Apply to ALL text-containing elements (more aggressive)
    const textElements = document.querySelectorAll('p, span, div, a, li, td, th, h1, h2, h3, h4, h5, h6, label, button, input, textarea');
    textElements.forEach(el => {
      el.style.setProperty('font-size', `${fontSize}px`, 'important');
      el.style.setProperty('line-height', '1.7', 'important');
    });
  }

  function injectIntoShadowRoots(cssText) {
    // Traverse all elements and inject into shadow roots
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        let style = el.shadowRoot.getElementById(STYLE_ID);
        if (!style) {
          style = document.createElement('style');
          style.id = STYLE_ID;
          el.shadowRoot.appendChild(style);
        }
        style.textContent = cssText;
      }
    });
  }

  function applySiteSpecificOverrides(fontSize) {
    const hostname = window.location.hostname;

    // Google-specific overrides (search results, Gmail, etc.)
    if (hostname.includes('google.com')) {
      const googleSelectors = [
        '.g', '#rcnt', '.s', '#search', 'body',
        '.RNNXgb', '.gLFyf', // Search box
        '.v7W49e', // Result snippets
        '#center_col', // Main column
      ];

      googleSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('font-size', `${fontSize}px`, 'important');
          el.style.setProperty('line-height', '1.7', 'important');
        });
      });
    }
  }

  function startInclusiveModeObserver(fontSize) {
    // Stop existing observer
    if (inclusiveModeObserver) {
      inclusiveModeObserver.disconnect();
    }

    const cssText = generateInclusiveCSS(fontSize);

    // Create observer to handle dynamic content
    inclusiveModeObserver = new MutationObserver(() => {
      // Re-inject into new shadow roots
      injectIntoShadowRoots(cssText);
      // Re-apply site-specific overrides
      applySiteSpecificOverrides(fontSize);
    });

    // Start observing
    inclusiveModeObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function inclusiveMode(fontSize = 18) {
    currentInclusiveFontSize = fontSize;

    // 1. Generate CSS
    const cssText = generateInclusiveCSS(fontSize);

    // 2. Inject into main document
    setStyle(cssText);

    // 3. Apply direct styles (harder to override)
    applyDirectStyles(fontSize);

    // 4. Inject into Shadow DOM
    injectIntoShadowRoots(cssText);

    // 5. Apply site-specific overrides
    applySiteSpecificOverrides(fontSize);

    // 6. Watch for dynamic content
    startInclusiveModeObserver(fontSize);

    // 7. Continuous re-application (for stubborn sites)
    if (inclusiveModeInterval) clearInterval(inclusiveModeInterval);
    inclusiveModeInterval = setInterval(() => {
      applyDirectStyles(fontSize);
      applySiteSpecificOverrides(fontSize);
    }, 300); // Re-apply every 300ms
  }
  // ========== END ENHANCED INCLUSIVE MODE ==========

  function focusMode(intensity = "medium") {
    let selectorsToHide = [];

    // Light mode - minimal hiding (ads, popups, cookies only)
    if (intensity === "light") {
      selectorsToHide = [
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='cookie']", "[id*='cookie']",
        "[role='dialog']", ".modal", ".popup"
      ];
    }
    // Medium mode - current behavior (default)
    else if (intensity === "medium") {
      selectorsToHide = [
        "aside", "nav", "footer",
        "[class*='sidebar']", "[id*='sidebar']",
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='cookie']", "[id*='cookie']",
        "[role='dialog']", ".modal", ".popup"
      ];
    }
    // Aggressive mode - maximum hiding
    else if (intensity === "aggressive") {
      selectorsToHide = [
        // Everything from medium
        "aside", "nav", "footer",
        "[class*='sidebar']", "[id*='sidebar']",
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='cookie']", "[id*='cookie']",
        "[role='dialog']", ".modal", ".popup",

        // Additional aggressive selectors - more specific to avoid hiding main content
        "header:not(main header):not(article header)",
        "section[class*='comment']:not(main section):not(article section)",
        "div[class*='comment']:not(main div):not(article div)",
        "aside[class*='related']",
        "div[class*='social-share']",
        "div[class*='share-buttons']",
        "nav[class*='breadcrumb']",
        "div[class*='author-bio']",
        "div[class*='newsletter']",
        "form[class*='subscribe']"
      ];
    }

    selectorsToHide.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        // Triple check: don't hide main content or body
        if (el === document.body) return;
        if (el.closest("main")) return;
        if (el.closest("article")) return;
        if (el.closest("[role='main']")) return;

        // Don't hide if it's a large content container
        const rect = el.getBoundingClientRect();
        if (rect.height > window.innerHeight * 0.5) return; // Don't hide large containers

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

  function getAllElementsIncludingShadow(root = document.body) {
    const elements = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    let node;
    while (node = walker.nextNode()) {
      elements.push(node);
      // Traverse into shadow DOM if present
      if (node.shadowRoot) {
        elements.push(...getAllElementsIncludingShadow(node.shadowRoot));
      }
    }
    return elements;
  }

  function isElementClickable(el) {
    // Check if element has click-related attributes or styles
    if (el.onclick || el.getAttribute("onclick")) return true;
    if (el.hasAttribute("role") && ["button", "link", "menuitem", "tab"].includes(el.getAttribute("role"))) return true;

    // Check computed style for cursor:pointer
    const style = window.getComputedStyle(el);
    if (style.cursor === "pointer") return true;

    // Check for React/Vue event listeners (heuristic)
    const attrs = el.getAttributeNames();
    if (attrs.some(attr => attr.startsWith("@click") || attr.startsWith("v-on:") || attr.includes("onclick"))) return true;

    return false;
  }

  function getClickableCandidates() {
    const allElements = getAllElementsIncludingShadow();

    // Standard clickable selectors
    const standardClickable = allElements.filter(el => {
      const tag = el.tagName?.toLowerCase();
      if (tag === "button" || tag === "a") return true;
      if (tag === "input" && ["submit", "button"].includes(el.type)) return true;
      if (el.getAttribute("role") === "button") return true;
      return false;
    });

    // Custom clickable elements (divs/spans with handlers or cursor:pointer)
    const customClickable = allElements.filter(el => {
      const tag = el.tagName?.toLowerCase();
      if (["button", "a", "input"].includes(tag)) return false; // already covered
      return isElementClickable(el);
    });

    const allClickable = [...standardClickable, ...customClickable];
    return allClickable.filter(n => n && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0);
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

    let best = null;
    let bestScore = 0;

    // Score each input and pick the best match
    for (const el of inputs) {
      const ph = normalize(el.getAttribute("placeholder") || "");
      const aria = normalize(el.getAttribute("aria-label") || "");
      const name = normalize(el.getAttribute("name") || "");
      const id = normalize(el.getAttribute("id") || "");

      // Check all attributes and pick the best score
      const texts = [ph, aria, name, id].filter(t => t);
      let score = 0;

      for (const text of texts) {
        if (text === q) {
          score = Math.max(score, 4); // Exact match
        } else if (text.startsWith(q)) {
          score = Math.max(score, 3); // Starts with query
        } else if (text.includes(q)) {
          score = Math.max(score, 2); // Contains query
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    // If we found a match, return it
    if (best) return best;

    // Fallback: first text input
    return inputs.find(i => i.tagName === "TEXTAREA" || (i.tagName === "INPUT" && ["text","search","email","tel","url","password"].includes(i.type))) || null;
  }

  function clickElement(el) {
    if (!el) return false;
    highlightElement(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Try multiple click methods for better compatibility
    setTimeout(() => {
      // Method 1: Standard click
      el.click();

      // Method 2: Dispatch mouse events (for React/Vue components)
      const clickEvent = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true,
        composed: true  // Important for Shadow DOM
      });
      el.dispatchEvent(clickEvent);

      // Method 3: Dispatch pointer events (modern approach)
      const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true });
      const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(pointerDown);
      el.dispatchEvent(pointerUp);
    }, 300);

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
  let tunnelObserver = null;

  function collectTunnelInputs() {
    const allInputs = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .filter(el => !["hidden","submit","button","image","file","reset"].includes((el.type || "").toLowerCase()));

    // Group radio buttons by name attribute (each group = 1 field)
    const radioGroups = new Map();
    const checkboxGroups = new Map();
    const otherInputs = [];

    for (const input of allInputs) {
      const type = (input.type || "").toLowerCase();

      if (type === "radio") {
        const groupName = input.name || `radio_${Math.random()}`;
        if (!radioGroups.has(groupName)) {
          radioGroups.set(groupName, []);
        }
        radioGroups.get(groupName).push(input);
      } else if (type === "checkbox") {
        const groupName = input.name || `checkbox_${input.id || Math.random()}`;
        // Group checkboxes with same name together
        if (input.name) {
          if (!checkboxGroups.has(groupName)) {
            checkboxGroups.set(groupName, []);
          }
          checkboxGroups.get(groupName).push(input);
        } else {
          // Standalone checkbox (no group)
          otherInputs.push(input);
        }
      } else {
        otherInputs.push(input);
      }
    }

    // Build final list: wrap groups as pseudo-elements
    const finalInputs = [];

    for (const [name, radios] of radioGroups) {
      // Create a pseudo-element representing the entire radio group
      finalInputs.push({
        _isGroup: true,
        _type: "radio",
        _name: name,
        _elements: radios,
        _primary: radios[0] // Focus on first element for positioning
      });
    }

    for (const [name, checkboxes] of checkboxGroups) {
      if (checkboxes.length > 1) {
        // Multiple checkboxes with same name = group
        finalInputs.push({
          _isGroup: true,
          _type: "checkbox",
          _name: name,
          _elements: checkboxes,
          _primary: checkboxes[0]
        });
      } else {
        // Single checkbox with name = standalone
        otherInputs.push(checkboxes[0]);
      }
    }

    // Add all other inputs (text, textarea, select, standalone checkboxes)
    finalInputs.push(...otherInputs);

    // Sort by DOM order (top to bottom) - cache positions to avoid layout thrashing
    const positions = new Map();
    for (const item of finalInputs) {
      const el = item._primary || item;
      positions.set(item, el.getBoundingClientRect().top);
    }

    finalInputs.sort((a, b) => positions.get(a) - positions.get(b));

    return finalInputs;
  }

  function refreshTunnelInputs() {
    const currentItem = tunnelState.inputs[tunnelState.idx];
    const newInputs = collectTunnelInputs();

    // Try to maintain position based on current field
    if (currentItem) {
      let foundIdx = -1;

      // Check if current item still exists
      if (currentItem._isGroup) {
        // For groups, match by name and type
        foundIdx = newInputs.findIndex(item =>
          item._isGroup && item._type === currentItem._type && item._name === currentItem._name
        );
      } else {
        // For regular inputs, match by element reference
        foundIdx = newInputs.indexOf(currentItem);
      }

      if (foundIdx >= 0) {
        tunnelState.idx = foundIdx;
      } else {
        // Current item disappeared, stay at same index or clamp
        tunnelState.idx = Math.min(tunnelState.idx, Math.max(0, newInputs.length - 1));
      }
    }

    tunnelState.inputs = newInputs;
    updateTunnelStep();
    console.log(`[Task Tunnel] Refreshed input list: ${newInputs.length} fields found`);
  }

  let tunnelRefreshTimeout = null;

  function startTunnelObserver() {
    // Stop existing observer
    if (tunnelObserver) {
      tunnelObserver.disconnect();
    }

    // Create observer to detect new fields being added (debounced)
    tunnelObserver = new MutationObserver((mutations) => {
      if (!tunnelState.active) return;

      // Check if mutations actually added/removed input elements
      let hasRelevantChanges = false;
      for (const mutation of mutations) {
        // Ignore attribute changes (like class changes for highlights)
        if (mutation.type === 'attributes') continue;

        // Check if added/removed nodes contain inputs
        const addedInputs = Array.from(mutation.addedNodes).some(node =>
          node.nodeType === 1 && (
            node.matches?.('input, select, textarea') ||
            node.querySelector?.('input, select, textarea')
          )
        );
        const removedInputs = Array.from(mutation.removedNodes).some(node =>
          node.nodeType === 1 && (
            node.matches?.('input, select, textarea') ||
            node.querySelector?.('input, select, textarea')
          )
        );

        if (addedInputs || removedInputs) {
          hasRelevantChanges = true;
          break;
        }
      }

      // Only refresh if we detected actual input changes, and debounce
      if (hasRelevantChanges) {
        clearTimeout(tunnelRefreshTimeout);
        tunnelRefreshTimeout = setTimeout(() => {
          refreshTunnelInputs();
        }, 300); // Wait 300ms after last change
      }
    });

    // Start observing DOM changes (only childList, not attributes)
    tunnelObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false // Don't watch attribute changes (highlight class changes)
    });
  }

  function startTunnel() {
    tunnelState.inputs = collectTunnelInputs();
    tunnelState.active = true;
    tunnelState.idx = 0;

    console.log(`[Task Tunnel] Started with ${tunnelState.inputs.length} fields`);

    showTunnelOverlay();
    focusTunnelCurrent();

    // Watch for dynamic fields
    startTunnelObserver();
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
      overlay.querySelector("#af-exit").onclick = () => {
        tunnelState.active = false;
        if (tunnelObserver) {
          tunnelObserver.disconnect();
          tunnelObserver = null;
        }
        if (tunnelRefreshTimeout) {
          clearTimeout(tunnelRefreshTimeout);
          tunnelRefreshTimeout = null;
        }
        document.getElementById(OVERLAY_ID)?.remove();
        console.log("[Task Tunnel] Exited and observer stopped");
      };
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
    const item = tunnelState.inputs[tunnelState.idx];
    if (!item) return;

    // Clear previous highlights
    document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));

    // Handle grouped inputs (radio/checkbox groups)
    if (item._isGroup) {
      // Highlight ALL elements in the group
      item._elements.forEach(el => {
        el.classList.add(HILITE_CLASS);
        // Also highlight parent label if exists
        const label = el.closest("label") || document.querySelector(`label[for="${el.id}"]`);
        if (label) label.classList.add(HILITE_CLASS);
      });

      // Scroll to the first element in the group
      item._primary.scrollIntoView({ behavior: "smooth", block: "center" });
      item._primary.focus();

      console.log(`[Task Tunnel] Focused ${item._type} group "${item._name}" with ${item._elements.length} options`);
    } else {
      // Regular input
      highlightElement(item);
      item.scrollIntoView({ behavior: "smooth", block: "center" });
      item.focus();
    }
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

    // "search for X", "find X", "look for X" - built-in search command
    const mSearch = c.match(/^(?:search|find|look)\s+(?:for\s+)?(.+)$/);
    if (mSearch) {
      const searchQuery = mSearch[1].trim();

      // Find search input using the same reliable logic as "type" command
      const inputs = Array.from(document.querySelectorAll("input, textarea"));
      const searchInput = inputs.find(i => {
        const type = (i.type || "").toLowerCase();
        const ph = (i.getAttribute("placeholder") || "").toLowerCase();
        const name = (i.getAttribute("name") || "").toLowerCase();
        // Prioritize search boxes
        if (type === "search" || ph.includes("search") || name.includes("search") || name === "q") return true;
        return false;
      }) || inputs.find(i => {
        const type = (i.type || "").toLowerCase();
        return type === "text" || type === "" || i.tagName === "TEXTAREA";
      });

      if (!searchInput) return { ok: false, message: `No search box found on this page.` };
      typeInto(searchInput, searchQuery);
      return { ok: true, message: `Searching for "${searchQuery}".` };
    }

    const mType = c.match(/^type\s+(.+)$/); // type <text> or type <field> <text>
    if (mType) {
      const fullText = cmd.trim().slice(4).trim(); // Everything after "type"

      // Try to split into field + text (look for space)
      const spaceIdx = fullText.indexOf(" ");
      if (spaceIdx > 0) {
        const possibleField = fullText.slice(0, spaceIdx).toLowerCase();
        const possibleText = fullText.slice(spaceIdx + 1);
        const input = findInputLike(possibleField);

        // If we found a field, use the split approach
        if (input) {
          typeInto(input, possibleText);
          return { ok: true, message: `Typed into "${possibleField}".` };
        }
      }

      // Otherwise, treat entire text as content to type into first search/text input
      const inputs = Array.from(document.querySelectorAll("input, textarea"));
      const searchInput = inputs.find(i => {
        const type = (i.type || "").toLowerCase();
        const ph = (i.getAttribute("placeholder") || "").toLowerCase();
        const name = (i.getAttribute("name") || "").toLowerCase();
        // Prioritize search boxes, then text inputs
        if (type === "search" || ph.includes("search") || name.includes("search")) return true;
        return false;
      }) || inputs.find(i => {
        const type = (i.type || "").toLowerCase();
        return type === "text" || type === "" || i.tagName === "TEXTAREA";
      });

      if (!searchInput) return { ok: false, message: `Couldn't find an input field.` };
      typeInto(searchInput, fullText);
      return { ok: true, message: `Typed "${fullText}".` };
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

    // Close ads, popups, modals
    if (c === "close ad" || c === "close popup" || c === "dismiss ad" || c === "close modal" || c === "close this") {
      // Find close buttons using common patterns
      const closeButtons = Array.from(document.querySelectorAll([
        // Common close button patterns
        'button[aria-label*="close" i]',
        'button[aria-label*="dismiss" i]',
        'button[title*="close" i]',
        'button[class*="close" i]',
        'button[id*="close" i]',
        'a[class*="close" i]',
        'div[class*="close" i][role="button"]',
        // X buttons
        'button:has(svg[aria-label*="close" i])',
        'button:has(span:is([class*="close" i], [class*="x" i]))',
        // Common ad/modal close patterns
        '[class*="modal"] button[class*="close" i]',
        '[class*="popup"] button[class*="close" i]',
        '[role="dialog"] button[aria-label*="close" i]',
        // Text-based close buttons
        'button:is(:has-text("✕"), :has-text("×"), :has-text("Close"), :has-text("Dismiss"))'
      ].join(', ')));

      // Filter for visible buttons only
      const visibleCloseButtons = closeButtons.filter(btn => {
        const rect = btn.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (visibleCloseButtons.length === 0) {
        return { ok: false, message: "No close button found. Try 'Focus Mode' to hide ads." };
      }

      // Click the first visible close button (usually the topmost popup)
      const btn = visibleCloseButtons[0];
      highlightElement(btn);
      btn.click();
      return { ok: true, message: "Closed ad/popup." };
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
    // For input elements, prioritize placeholder/name/aria-label (they often have no innerText)
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const ariaLabel = (el.getAttribute("aria-label") || "").trim();
      const placeholder = (el.getAttribute("placeholder") || "").trim();
      const name = (el.getAttribute("name") || "").trim();
      const type = (el.getAttribute("type") || "text").trim();
      const value = (el.value || "").trim();

      // Build descriptive text for input fields
      const parts = [];
      if (ariaLabel) parts.push(ariaLabel);
      else if (placeholder) parts.push(placeholder);
      else if (name) parts.push(name);
      else if (type) parts.push(type + " input");

      if (value && parts.length === 0) parts.push(value);

      return parts.join(" ") || type + " field";
    }

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
    const allElements = getAllElementsIncludingShadow();

    // Filter for interactive elements (including Shadow DOM elements)
    const nodes = allElements.filter(el => {
      const tag = el.tagName?.toLowerCase();
      // Standard interactive elements
      if (["a", "button", "input", "select", "textarea"].includes(tag)) return true;
      if (el.getAttribute("role") === "button") return true;
      if (el.onclick || el.getAttribute("onclick")) return true;
      if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return true;
      // Custom clickable elements
      if (isElementClickable(el)) return true;
      return false;
    });

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

      // CRITICAL: Boost search inputs regardless of region!
      if (el.tagName === "INPUT") {
        const type = (el.getAttribute("type") || "").toLowerCase();
        const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();

        // Search box indicators - give HIGHEST priority
        if (type === "search" ||
            placeholder.includes("search") || placeholder.includes("find") || placeholder.includes("query") ||
            name.includes("search") || name.includes("q") || name === "query" ||
            ariaLabel.includes("search")) {
          score += 100; // Search boxes get massive boost!
        }
      }

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

      // For input elements, include additional attributes to help identify search boxes
      const inputAttrs = {};
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        inputAttrs.placeholder = el.getAttribute("placeholder") || null;
        inputAttrs.name = el.getAttribute("name") || null;
        inputAttrs.ariaLabel = el.getAttribute("aria-label") || null;
        inputAttrs.className = el.className || null;
      }

      elements.push({
        index: idx,
        tag: el.tagName.toLowerCase(),
        text,
        type: el.getAttribute("type") || null,
        ...inputAttrs,
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
      setTimeout(() => {
        // Single click with pointer events for better compatibility
        const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true });
        const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true });
        el.dispatchEvent(pointerDown);
        el.dispatchEvent(pointerUp);

        // Single click event (not el.click() to avoid duplicate)
        const clickEvent = new MouseEvent("click", {
          view: window,
          bubbles: true,
          cancelable: true,
          composed: true
        });
        el.dispatchEvent(clickEvent);
      }, 400);
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

      // Set value with React/Vue compatibility
      // Method 1: Native setter (triggers React's internal tracking)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value || "");
      }

      // Method 2: Direct assignment (fallback)
      el.value = value || "";

      // Trigger all relevant events for framework compatibility
      el.dispatchEvent(new Event("focus", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));

      // Re-focus for form validation
      el.focus();

      // Auto-submit the search after typing
      setTimeout(() => {
        // Method 1: Press Enter key
        el.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        }));
        el.dispatchEvent(new KeyboardEvent("keyup", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        }));

        // Method 2: Click search button
        setTimeout(() => {
          const searchButton =
            el.nextElementSibling?.tagName === 'BUTTON' ? el.nextElementSibling :
            el.closest('form')?.querySelector('button[type="submit"]') ||
            el.closest('[class*="search"]')?.querySelector('button') ||
            el.parentElement?.querySelector('button');

          if (searchButton) {
            searchButton.click();
          } else {
            // Method 3: Submit form
            const form = el.closest('form');
            if (form) form.submit();
          }
        }, 100);
      }, 200);

      return { ok: true, message: `Searching for "${value}".` };
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

  function getFullPageSections() {
    const headingTags = ["H1", "H2", "H3", "H4", "H5", "H6"];
    const allElements = Array.from(document.body.querySelectorAll("*"));
    const sections = [];
    let current = null;

    for (const el of allElements) {
      if (headingTags.includes(el.tagName)) {
        if (current) sections.push(current);
        current = { heading: el.textContent.trim(), level: parseInt(el.tagName[1]), texts: [] };
      } else if (current && el.children.length === 0) {
        const text = el.textContent.trim();
        if (text) current.texts.push(text);
      }
    }
    if (current) sections.push(current);

    if (sections.length === 0) {
      sections.push({
        heading: document.title || "Page Content",
        level: 1,
        texts: [document.body.innerText.slice(0, 5000)]
      });
    }

    return sections.map((s) => ({
      heading: s.heading,
      level: s.level,
      text: s.texts.join(" ").slice(0, 5000)
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

  function findNearestClickable(px, py, radius) {
    const clickableSelector = 'a, button, [role="button"], input, select, textarea, [onclick], [tabindex]';
    const candidates = document.querySelectorAll(clickableSelector);
    let best = null;
    let bestDist = radius;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Distance from point to nearest edge of the element's bounding box
      const closestX = Math.max(rect.left, Math.min(px, rect.right));
      const closestY = Math.max(rect.top, Math.min(py, rect.bottom));
      const dist = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);

      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }

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
      cursor.style.background = "rgba(34, 197, 94, 0.8)";
      cursor.style.border = "3px solid #22c55e";
      cursor.style.transform = "translate(-50%, -50%) scale(1.4)";

      // Hide cursor so elementFromPoint can't return it
      cursor.style.display = "none";
      const rawEl = document.elementFromPoint(pixelX, pixelY);
      cursor.style.display = "block";

      // Walk up to find a clickable ancestor (link, button, etc.)
      let clickTarget = null;
      let el = rawEl;
      while (el && el !== document.body && el !== document.documentElement) {
        const tag = el.tagName.toLowerCase();
        if (tag === "a" || tag === "button" || tag === "input" ||
            tag === "select" || tag === "textarea" ||
            el.getAttribute("role") === "button" ||
            el.getAttribute("onclick") || el.getAttribute("tabindex")) {
          clickTarget = el;
          break;
        }
        el = el.parentElement;
      }

      // Fall back to snap-to-nearest, then raw element
      if (!clickTarget) clickTarget = findNearestClickable(pixelX, pixelY, 40);
      if (!clickTarget) clickTarget = rawEl;

      if (clickTarget) {
        // Full mouse event sequence: pointerdown → mousedown → pointerup → mouseup → click
        const rect = clickTarget.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const eventOpts = { view: window, bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };

        clickTarget.dispatchEvent(new PointerEvent("pointerdown", eventOpts));
        clickTarget.dispatchEvent(new MouseEvent("mousedown", eventOpts));
        clickTarget.dispatchEvent(new PointerEvent("pointerup", eventOpts));
        clickTarget.dispatchEvent(new MouseEvent("mouseup", eventOpts));
        clickTarget.dispatchEvent(new MouseEvent("click", eventOpts));
        clickTarget.click();

        if (clickTarget.focus) clickTarget.focus();
        console.log("[AccessFlow] Clicked:", clickTarget.tagName, clickTarget.textContent?.slice(0, 40));
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
        const fontSize = msg.fontSize || 18;
        inclusiveMode(fontSize);
        sendResponse({ ok: true, message: `Inclusive Mode applied with ${fontSize}px font.` });
        return true;
      }
      if (msg?.type === "INCLUSIVE_OFF") {
        // Use the same aggressive cleanup as reset
        cleanupInclusiveMode();
        sendResponse({ ok: true, message: "Inclusive Mode removed." });
        return true;
      }
      if (msg?.type === "FOCUS_ON") {
        // First, restore all previously hidden elements
        document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
          e.style.removeProperty("display");
          e.removeAttribute("data-accessflow-hidden");
        });
        // Remove old highlights
        document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));

        // Then apply new intensity
        const intensity = msg.intensity || "medium";
        focusMode(intensity);
        sendResponse({ ok: true, message: `Focus Mode applied (${intensity}).` });
        return true;
      }
      if (msg?.type === "FOCUS_OFF") {
        // Remove hidden elements
        document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
          e.style.removeProperty("display");
          e.removeAttribute("data-accessflow-hidden");
        });
        // Remove highlight
        document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));
        sendResponse({ ok: true, message: "Focus Mode removed." });
        return true;
      }
      if (msg?.type === "TUNNEL_ON") {
        startTunnel();
        sendResponse({ ok: true, message: "Task Tunnel started." });
        return true;
      }
      if (msg?.type === "TUNNEL_OFF") {
        tunnelState.active = false;
        if (tunnelObserver) {
          tunnelObserver.disconnect();
          tunnelObserver = null;
        }
        if (tunnelRefreshTimeout) {
          clearTimeout(tunnelRefreshTimeout);
          tunnelRefreshTimeout = null;
        }
        document.getElementById(OVERLAY_ID)?.remove();
        document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));
        sendResponse({ ok: true, message: "Task Tunnel stopped." });
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
      if (msg?.type === "GET_FULL_SECTIONS") {
        const sections = getFullPageSections();
        sendResponse({ ok: true, sections, page_title: document.title, page_url: window.location.href });
        return true;
      }
      if (msg?.type === "ANALYZE_PAGE") {
        try {
          // 1. Sample font sizes from visible text elements
          const textEls = document.querySelectorAll("p, span, li, td, div, a, label");
          const fontSizes = [];
          let sampled = 0;
          for (const el of textEls) {
            if (sampled >= 80) break;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size > 0) { fontSizes.push(size); sampled++; }
          }
          fontSizes.sort((a, b) => a - b);
          const medianFontSize = fontSizes.length > 0
            ? fontSizes[Math.floor(fontSizes.length / 2)]
            : 16;

          // 2. Count nav links
          const navContainers = document.querySelectorAll(
            "nav, header, [role='navigation'], .navbar, .nav, #nav"
          );
          let navLinkCount = 0;
          navContainers.forEach(container => {
            navLinkCount += container.querySelectorAll("a").length;
          });

          // 3. Count words and headings
          const bodyText = document.body.innerText || "";
          const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
          const headingCount = document.querySelectorAll("h1, h2, h3, h4, h5, h6").length;

          // 4. Count images missing alt with visible size > 50x50
          const allImages = document.querySelectorAll("img");
          let missingAltCount = 0;
          allImages.forEach(img => {
            const hasAlt = img.hasAttribute("alt") && img.alt.trim().length > 0;
            if (!hasAlt && img.naturalWidth > 50 && img.naturalHeight > 50) {
              missingAltCount++;
            }
          });

          // Build suggestions
          const suggestions = [];

          if (medianFontSize < 14) {
            suggestions.push({
              mode: "Inclusive Mode",
              reason: `Median font size is only ${Math.round(medianFontSize)}px — may be hard to read`,
              buttonId: "inclusive"
            });
          }

          if (navLinkCount > 40) {
            suggestions.push({
              mode: "Focus Mode",
              reason: `${navLinkCount} navigation links detected — page may feel cluttered`,
              buttonId: "focus"
            });
          }

          if (wordCount > 3000 && headingCount < wordCount / 500) {
            suggestions.push({
              mode: "Simplify Page",
              reason: `${wordCount.toLocaleString()} words with few headings — dense content`,
              buttonId: "simplify"
            });
          }

          if (missingAltCount > 5) {
            suggestions.push({
              mode: "Describe Images",
              reason: `${missingAltCount} images lack alt text`,
              buttonId: "describe-images"
            });
          }

          sendResponse({
            ok: true,
            suggestions,
            stats: { medianFontSize, navLinkCount, wordCount, headingCount, missingAltCount }
          });
        } catch (e) {
          sendResponse({ ok: false, suggestions: [], stats: {}, message: e.message });
        }
        return true;
      }
      sendResponse({ ok: false, message: "Unknown message." });
    } catch (e) {
      sendResponse({ ok: false, message: "Error: " + (e?.message || String(e)) });
    }
    return true;
  });
