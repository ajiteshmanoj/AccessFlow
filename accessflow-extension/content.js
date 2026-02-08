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

    // Stop Focus Mode observer
    stopFocusModeObserver();

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
    stopTunnelVoice();

    // Additional cleanup for other modes
    setTimeout(() => {
      document.getElementById(OVERLAY_ID)?.remove();
      document.getElementById(SIMPLIFY_STYLE_ID)?.remove();

      // Remove color blind filter
      document.getElementById("accessflow-cb-svg")?.remove();
      document.getElementById("accessflow-colorblind")?.remove();

      // Remove highlights
      document.querySelectorAll("." + HILITE_CLASS).forEach((e) => e.classList.remove(HILITE_CLASS));

      // Remove inline hiding used by Focus Mode
      document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
        e.style.removeProperty("display");
        e.style.removeProperty("opacity");
        e.style.removeProperty("pointer-events");
        e.style.removeProperty("transition");
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

  // ========== FOCUS MODE OBSERVER ==========
  let focusModeObserver = null;
  let focusModeSelectors = [];
  let focusModeIntensity = "medium";
  let focusModeScrollListener = null;
  let focusModeInterval = null;

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

      /* Highlight class - VERY prominent and impossible to miss */
      .${HILITE_CLASS} {
        outline: 5px solid #f59e0b !important;
        outline-offset: 3px !important;
        background-color: rgba(251, 191, 36, 0.25) !important;
        box-shadow: 0 0 0 6px rgba(251, 191, 36, 0.3), 0 0 30px rgba(251, 191, 36, 0.5) !important;
        border-radius: 8px !important;
        position: relative !important;
        z-index: 1000 !important;
        transition: all 0.2s ease !important;
      }

      /* Ensure the highlight is visible even on elements with backgrounds */
      .${HILITE_CLASS}::before {
        content: '' !important;
        position: absolute !important;
        inset: -3px !important;
        border: 3px solid #f59e0b !important;
        border-radius: 8px !important;
        pointer-events: none !important;
        z-index: 1 !important;
      }
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

  // Helper function to detect if element contains article/news content
  function isArticleContent(el) {
    // Check for article-like structure
    const hasHeading = el.querySelector('h1, h2, h3, h4');
    const hasLinks = el.querySelector('a[href*="article"], a[href*="story"], a[href*="news"]');
    const hasParagraphs = el.querySelectorAll('p').length > 0;

    // If it has article-like content, protect it
    if (hasHeading && (hasLinks || hasParagraphs)) {
      return true;
    }

    // Check for substantial text content (likely an article)
    const textContent = el.textContent?.trim() || '';
    if (textContent.length > 200) {
      // Has enough text to be meaningful content
      return true;
    }

    return false;
  }

  // Helper function to check if element should be hidden by Focus Mode
  function shouldHideElement(el) {
    // Never hide body
    if (el === document.body) return false;

    // Check if element contains article content
    if (isArticleContent(el)) {
      return false; // Protect article content
    }

    // Check if element has ad-related keywords in attributes (strong signal it's an ad)
    const allAttrs = Array.from(el.attributes || []).map(attr =>
      `${attr.name}=${attr.value}`.toLowerCase()
    ).join(' ');

    const adKeywords = ['ad-', 'advert', 'sponsor', 'commercial', 'banner'];
    const hasStrongAdKeywords = adKeywords.some(keyword => allAttrs.includes(keyword));

    // If it has strong ad indicators AND doesn't contain article content, hide it
    if (hasStrongAdKeywords) {
      return true;
    }

    // CONSERVATIVE: Protect all content inside main/article unless it's clearly an ad
    // This prevents hiding legitimate news content
    if (el.closest("main") || el.closest("article") || el.closest("[role='main']")) {
      return false;
    }

    // Don't hide if it's a large content container (might be the article itself)
    const rect = el.getBoundingClientRect();
    if (rect.height > window.innerHeight * 0.5) return false;

    // For elements outside main/article (like nav, footer, true sidebars)
    // Only hide if they match our selectors
    // But be extra careful with "aside" - many sites use it for related content
    const tagName = el.tagName.toLowerCase();
    if (tagName === 'aside') {
      // Only hide aside if it's clearly not content (has ad keywords or is in header/footer)
      // AND doesn't contain article content
      const inHeaderOrFooter = el.closest('header') || el.closest('footer');
      return inHeaderOrFooter || hasStrongAdKeywords;
    }

    // Safe to hide: nav, footer, and elements with explicit ad classes
    return true;
  }

  // Helper function to hide an element with Focus Mode styling
  function hideElementForFocus(el) {
    if (!shouldHideElement(el)) return;

    // Use opacity instead of display:none to avoid layout shifts and white boxes
    el.style.opacity = "0.15";
    el.style.pointerEvents = "none";
    el.style.transition = "opacity 0.3s ease";
    el.setAttribute("data-accessflow-hidden", "1");
  }

  // Apply Focus Mode hiding to existing elements
  function applyFocusHiding() {
    focusModeSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (!el.hasAttribute("data-accessflow-hidden")) {
          hideElementForFocus(el);
        }
      });
    });
  }

  // Start monitoring for dynamically loaded elements
  function startFocusModeObserver() {
    if (focusModeObserver) {
      focusModeObserver.disconnect();
    }

    focusModeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) { // Element node
            // Check if the node itself matches any selector
            focusModeSelectors.forEach((sel) => {
              try {
                if (node.matches && node.matches(sel)) {
                  hideElementForFocus(node);
                }
                // Also check descendants
                node.querySelectorAll && node.querySelectorAll(sel).forEach((el) => {
                  hideElementForFocus(el);
                });
              } catch (e) {
                // Invalid selector, skip
              }
            });
          }
        });
      });
    });

    focusModeObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Add scroll listener to catch ads that become visible as user scrolls
  function startFocusModeScrollListener() {
    if (focusModeScrollListener) {
      window.removeEventListener('scroll', focusModeScrollListener);
    }

    let scrollTimeout;
    focusModeScrollListener = () => {
      // Debounce: only re-apply after user stops scrolling for 100ms
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        applyFocusHiding();
      }, 100);
    };

    window.addEventListener('scroll', focusModeScrollListener, { passive: true });
  }

  function stopFocusModeScrollListener() {
    if (focusModeScrollListener) {
      window.removeEventListener('scroll', focusModeScrollListener);
      focusModeScrollListener = null;
    }
  }

  function stopFocusModeObserver() {
    if (focusModeObserver) {
      focusModeObserver.disconnect();
      focusModeObserver = null;
    }
    stopFocusModeScrollListener();
    if (focusModeInterval) {
      clearInterval(focusModeInterval);
      focusModeInterval = null;
    }
    focusModeSelectors = [];
  }

  function focusMode(intensity = "medium") {
    // Stop any existing observer
    stopFocusModeObserver();

    // Store intensity globally
    focusModeIntensity = intensity;

    // Detect site type for specialized handling
    const hostname = window.location.hostname.toLowerCase();
    const isEcommerce = hostname.includes('amazon') || hostname.includes('ebay') ||
                       hostname.includes('walmart') || hostname.includes('target') ||
                       hostname.includes('etsy') || hostname.includes('alibaba') ||
                       hostname.includes('shop') || hostname.includes('store');

    // E-commerce sites: only hide obvious ads, not product content
    if (isEcommerce) {
      focusModeSelectors = [
        // Only hide very obvious ads
        "[class*='ad-banner']", "[class*='adbanner']",
        "[id*='ad-banner']", "[id*='adbanner']",
        "[class*='sponsored-ad']", "[class*='display-ad']",
        "[data-component*='ad-banner']",
        "iframe[src*='ads']", "iframe[src*='doubleclick']", "iframe[src*='googlesyndication']",
        // Popups & cookies (still relevant)
        "[class*='cookie']", "[id*='cookie']",
        "[class*='gdpr']", "[id*='gdpr']",
        "[class*='consent']", "[id*='consent']",
        "[role='dialog']:not([aria-label*='cart']):not([aria-label*='Cart'])",
        ".modal:not([class*='cart']):not([class*='checkout'])",
        ".popup:not([class*='cart'])"
      ];

      // Apply hiding and start observers
      applyFocusHiding();
      startFocusModeObserver();
      startFocusModeScrollListener();
      focusModeInterval = setInterval(() => { applyFocusHiding(); }, 2000);

      return; // Skip the news site logic below
    }

    // Light mode - minimal hiding (ads, popups, cookies only)
    if (intensity === "light") {
      focusModeSelectors = [
        // Ad variations - only very obvious ads
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='ad_']", "[id*='ad_']",
        "[class*='_ad']", "[id*='_ad']",
        "[class*='sponsor']", "[id*='sponsor']",
        "[class*='commercial']", "[id*='commercial']",
        "[class*='ad-banner']", "[class*='adbanner']",
        "[data-component*='ad']",
        "[aria-label*='advertisement']", "[aria-label*='sponsored']",
        "iframe[src*='ads']", "iframe[src*='doubleclick']", "iframe[src*='googlesyndication']",
        // Cookies & popups
        "[class*='cookie']", "[id*='cookie']",
        "[class*='gdpr']", "[id*='gdpr']",
        "[class*='consent']", "[id*='consent']",
        "[role='dialog']", ".modal", ".popup"
      ];
    }
    // Medium mode - current behavior (default)
    else if (intensity === "medium") {
      focusModeSelectors = [
        // Only hide very obvious ads - no nav/footer/sidebars by default
        // This prevents accidentally hiding article listings
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='ad_']", "[id*='ad_']",
        "[class*='_ad']", "[id*='_ad']",
        "[class*='sponsor']", "[id*='sponsor']",
        "[class*='commercial']", "[id*='commercial']",
        "[class*='ad-banner']", "[class*='adbanner']",
        "[data-component*='ad']",
        "[data-testid*='ad']",
        "[aria-label*='advertisement']", "[aria-label*='sponsored']",
        "iframe[src*='ads']", "iframe[src*='doubleclick']", "iframe[src*='googlesyndication']",
        // Cookies & popups
        "[class*='cookie']", "[id*='cookie']",
        "[class*='gdpr']", "[id*='gdpr']",
        "[class*='consent']", "[id*='consent']",
        "[role='dialog']", ".modal", ".popup"
      ];
    }
    // Aggressive mode - maximum hiding
    else if (intensity === "aggressive") {
      focusModeSelectors = [
        // Include page structure elements (nav, footer, sidebar)
        "nav:not(main nav):not(article nav)",
        "footer",
        "[class*='sidebar']:not(main *):not(article *)",
        "[id*='sidebar']:not(main *):not(article *)",
        // Ad variations
        "[class*='advert']", "[id*='advert']",
        "[class*='ad-']", "[id*='ad-']",
        "[class*='ad_']", "[id*='ad_']",
        "[class*='_ad']", "[id*='_ad']",
        "[class*='sponsor']", "[id*='sponsor']",
        "[class*='commercial']", "[id*='commercial']",
        "[class*='ad-banner']", "[class*='adbanner']",
        "[data-component*='ad']",
        "[data-testid*='ad']",
        "[aria-label*='advertisement']", "[aria-label*='sponsored']",
        "iframe[src*='ads']", "iframe[src*='doubleclick']", "iframe[src*='googlesyndication']",
        // Cookies & popups
        "[class*='cookie']", "[id*='cookie']",
        "[class*='gdpr']", "[id*='gdpr']",
        "[class*='consent']", "[id*='consent']",
        "[role='dialog']", ".modal", ".popup",

        // Additional aggressive selectors - more specific to avoid hiding main content
        "header:not(main header):not(article header)",
        "section[class*='comment']:not(main section):not(article section)",
        "div[class*='comment']:not(main div):not(article div)",
        "div[class*='social-share']:not(main *):not(article *)",
        "div[class*='share-buttons']:not(main *):not(article *)",
        "nav[class*='breadcrumb']",
        "div[class*='newsletter']:not(main *):not(article *)",
        "form[class*='subscribe']:not(main *):not(article *)",
        "[class*='recommended']:not(main *):not(article *)",
        "[class*='trending']:not(main *):not(article *)",
        "[class*='popular']:not(main *):not(article *)"
      ];
    }

    // Apply hiding to existing elements
    applyFocusHiding();

    // Start observing for new elements (catches dynamically added ads)
    startFocusModeObserver();

    // Start scroll listener (catches ads that were already in DOM but become visible on scroll)
    startFocusModeScrollListener();

    // Periodically re-apply hiding to catch ads loaded via timers or other async mechanisms
    focusModeInterval = setInterval(() => {
      applyFocusHiding();
    }, 2000); // Re-check every 2 seconds

    // Highlight main content if available, but DON'T auto-scroll (avoid jarring behavior)
    const main = document.querySelector("main") || document.querySelector("article");

    // Only highlight if we found a specific main/article element (not body)
    if (main) {
      const rect = main.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;

      // Only highlight if it's not a full-screen element (avoids white box effect)
      // Removed auto-scroll to prevent page jumping
      if (!isFullScreen) {
        highlightElement(main);
      }
    }
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

  // Tunnel Voice: auto voice input for text fields in Task Tunnel
  let tunnelVoiceActive = false;
  let tunnelVoiceMicEnabled = true;
  let tunnelVoiceRecognition = null;

  function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      return ["text","email","url","search","tel","password","number"].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function collectTunnelInputs() {
    // Collect standard form inputs
    const standardInputs = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .filter(el => !["hidden","submit","button","image","file","reset"].includes((el.type || "").toLowerCase()));

    // Also collect custom option elements (ARIA roles, button groups, etc.)
    const customOptions = Array.from(document.querySelectorAll(`
      [role="radio"],
      [role="checkbox"],
      [role="option"],
      button[data-option],
      button[data-answer],
      div[data-option],
      div[data-answer],
      .option-button,
      .answer-choice,
      .quiz-option
    `)).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    // Merge both lists and remove duplicates
    const allInputs = [...new Set([...standardInputs, ...customOptions])];

    // Each element is its own step — no grouping, so users can navigate individually
    const finalInputs = [...allInputs];

    // Sort by DOM order (top to bottom)
    finalInputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    return finalInputs;
  }

  function refreshTunnelInputs() {
    const currentItem = tunnelState.inputs[tunnelState.idx];
    const newInputs = collectTunnelInputs();

    // Try to maintain position based on current field
    if (currentItem) {
      let foundIdx = -1;

      // Match by element reference
      foundIdx = newInputs.indexOf(currentItem);

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
        <div id="af-voice-preview" style="font-size:11px;color:#6b7280;margin-top:4px;min-height:14px;font-style:italic;"></div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="af-prev" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#f3f4f6;cursor:pointer;">Prev</button>
          <button id="af-next" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#eef2ff;cursor:pointer;">Next</button>
          <button id="af-mic" style="padding:6px 10px;border:1px solid #10b981;border-radius:10px;background:#d1fae5;cursor:pointer;">🎤 Ready</button>
          <button id="af-exit" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff1f2;cursor:pointer;">Exit</button>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector("#af-prev").onclick = () => { tunnelState.idx = Math.max(0, tunnelState.idx - 1); focusTunnelCurrent(); };
      overlay.querySelector("#af-next").onclick = () => { tunnelState.idx = Math.min(tunnelState.inputs.length - 1, tunnelState.idx + 1); focusTunnelCurrent(); };
      overlay.querySelector("#af-mic").onclick = () => {
        tunnelVoiceMicEnabled = !tunnelVoiceMicEnabled;
        if (!tunnelVoiceMicEnabled) {
          stopTunnelVoice();
        } else {
          const item = tunnelState.inputs[tunnelState.idx];
          if (item && isTextInput(item)) {
            startTunnelVoice();
          }
        }
        updateTunnelMicUI(tunnelVoiceActive);
      };
      overlay.querySelector("#af-exit").onclick = () => {
        stopTunnelVoice();
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

    // Find the best container to highlight (full option area)
    let container = null;

    // Try to find a label that wraps or is associated with this input
    const wrappingLabel = item.closest("label");
    const associatedLabel = item.id ? document.querySelector(`label[for="${item.id}"]`) : null;

    // Try to find a parent container that looks like an option
    const optionContainer = item.closest(`
      .option, .answer, .choice,
      [class*="option"], [class*="answer"], [class*="choice"],
      [role="radio"], [role="checkbox"],
      li, div[onclick], button,
      .form-group, .input-group, .field
    `.trim());

    // Choose the best container (prefer specific option containers, then labels, then the element itself)
    if (wrappingLabel && wrappingLabel !== document.body) {
      container = wrappingLabel;
    } else if (associatedLabel) {
      container = associatedLabel;
    } else if (optionContainer && optionContainer !== document.body && optionContainer.offsetHeight < window.innerHeight * 0.8) {
      container = optionContainer;
    } else {
      container = item;
    }

    // Highlight the container
    container.classList.add(HILITE_CLASS);

    // Scroll and focus
    item.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      item.focus();
    } catch (e) {
      // Some elements can't be focused, that's ok
    }

    console.log(`[Task Tunnel] Focused step ${tunnelState.idx + 1}/${tunnelState.inputs.length}`);

    // Auto-start voice on text fields
    if (tunnelVoiceMicEnabled && isTextInput(item)) {
      setTimeout(() => startTunnelVoice(), 200);
    } else {
      stopTunnelVoice();
    }
  }

  // ========== TUNNEL VOICE INPUT ==========

  function startTunnelVoice() {
    if (!SpeechRecognition) return;
    // Abort any existing tunnel voice session
    if (tunnelVoiceRecognition) {
      try { tunnelVoiceRecognition.abort(); } catch (_) {}
      tunnelVoiceRecognition = null;
    }
    // Also stop sidepanel voice so they don't conflict
    if (voiceRecognition) {
      try { voiceRecognition.abort(); } catch (_) {}
      voiceRecognition = null;
    }

    const targetEl = tunnelState.inputs[tunnelState.idx];
    if (!targetEl || !isTextInput(targetEl)) return;

    tunnelVoiceRecognition = new SpeechRecognition();
    tunnelVoiceRecognition.continuous = false;
    tunnelVoiceRecognition.interimResults = true;
    tunnelVoiceRecognition.lang = "en-US";

    tunnelVoiceActive = true;
    updateTunnelMicUI(true);

    tunnelVoiceRecognition.onresult = (event) => {
      let transcript = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }

      if (isFinal) {
        // Commit final text into the field (use saved original + final transcript)
        typeInto(targetEl, (targetEl.dataset.afOriginal || "") + transcript);
        updateTunnelVoicePreview("");
        console.log(`[Tunnel Voice] Final: "${transcript}"`);

        // Auto-advance to the next text field after a short delay
        setTimeout(() => {
          if (!tunnelState.active) return;
          // Find the next text input, skipping non-text fields
          for (let i = tunnelState.idx + 1; i < tunnelState.inputs.length; i++) {
            if (isTextInput(tunnelState.inputs[i])) {
              tunnelState.idx = i;
              focusTunnelCurrent();
              return;
            }
          }
          // No more text fields ahead — stay put
        }, 500);
      } else {
        // Show interim preview
        updateTunnelVoicePreview(transcript);
        // Also live-update the field with interim text
        if (targetEl.isContentEditable) {
          targetEl.textContent = (targetEl.dataset.afOriginal || "") + transcript;
        } else {
          targetEl.value = (targetEl.dataset.afOriginal || "") + transcript;
          targetEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    };

    tunnelVoiceRecognition.onstart = () => {
      // Save original field value so interim updates append correctly
      const el = tunnelState.inputs[tunnelState.idx];
      if (el) {
        el.dataset.afOriginal = el.isContentEditable ? (el.textContent || "") : (el.value || "");
      }
    };

    tunnelVoiceRecognition.onend = () => {
      tunnelVoiceActive = false;
      tunnelVoiceRecognition = null;
      updateTunnelMicUI(false);
      updateTunnelVoicePreview("");
    };

    tunnelVoiceRecognition.onerror = (event) => {
      if (event.error === "aborted") return;
      console.warn(`[Tunnel Voice] Error: ${event.error}`);
      tunnelVoiceActive = false;
      tunnelVoiceRecognition = null;
      updateTunnelMicUI(false);
      updateTunnelVoicePreview("");
    };

    try {
      tunnelVoiceRecognition.start();
      console.log("[Tunnel Voice] Started listening");
    } catch (e) {
      console.warn("[Tunnel Voice] Failed to start:", e);
      tunnelVoiceActive = false;
      tunnelVoiceRecognition = null;
      updateTunnelMicUI(false);
    }
  }

  function stopTunnelVoice() {
    if (tunnelVoiceRecognition) {
      try { tunnelVoiceRecognition.abort(); } catch (_) {}
      tunnelVoiceRecognition = null;
    }
    tunnelVoiceActive = false;
    updateTunnelMicUI(false);
    updateTunnelVoicePreview("");
  }

  function updateTunnelMicUI(listening) {
    const btn = document.getElementById("af-mic");
    if (!btn) return;
    if (!tunnelVoiceMicEnabled) {
      btn.style.background = "#e5e7eb";
      btn.textContent = "Mic Off";
    } else if (listening) {
      btn.style.background = "#fee2e2";
      btn.style.borderColor = "#ef4444";
      btn.textContent = "🎤 Listening";
    } else {
      btn.style.background = "#d1fae5";
      btn.style.borderColor = "#10b981";
      btn.textContent = "🎤 Ready";
    }
  }

  function updateTunnelVoicePreview(text) {
    const el = document.getElementById("af-voice-preview");
    if (!el) return;
    el.textContent = text ? `"${text}"` : "";
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

    // Stop tunnel voice so sidepanel can take over cleanly
    if (tunnelVoiceActive) {
      stopTunnelVoice();
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
          e.style.removeProperty("opacity");
          e.style.removeProperty("pointer-events");
          e.style.removeProperty("transition");
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
        // Stop the Focus Mode observer
        stopFocusModeObserver();

        // Remove hidden elements and restore their properties
        document.querySelectorAll("[data-accessflow-hidden='1']").forEach((e) => {
          e.style.removeProperty("display");
          e.style.removeProperty("opacity");
          e.style.removeProperty("pointer-events");
          e.style.removeProperty("transition");
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
        stopTunnelVoice();
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
      // ========== COLOR BLIND FILTER HANDLERS ==========
      if (msg?.type === "COLORBLIND_ON") {
        // Remove any existing filter
        document.getElementById("accessflow-cb-svg")?.remove();
        document.getElementById("accessflow-colorblind")?.remove();
        document.documentElement.style.removeProperty("filter");

        const filter = msg.filter || "deuteranopia";
        const mode = msg.mode || "correct";

        // Machado 2009 simulation matrices & daltonization correction matrices
        const matrices = {
          deuteranopia: {
            simulate: "0.367  0.861 -0.228  0  0  0.280  0.673  0.047  0  0 -0.012  0.043  0.969  0  0  0  0  0  1  0",
            correct:  "0.625  0.375  0      0  0  0.700  0.300  0      0  0  0      0.300  0.700  0  0  0  0  0  1  0"
          },
          protanopia: {
            simulate: "0.152  1.053 -0.205  0  0  0.115  0.786  0.099  0  0 -0.004 -0.048  1.052  0  0  0  0  0  1  0",
            correct:  "0.567  0.433  0      0  0  0.558  0.442  0      0  0  0      0.242  0.758  0  0  0  0  0  1  0"
          },
          tritanopia: {
            simulate: "1.256 -0.077 -0.179  0  0 -0.078  0.931  0.148  0  0  0.005  0.691  0.304  0  0  0  0  0  1  0",
            correct:  "0.950  0.050  0      0  0  0      0.433  0.567  0  0  0      0.475  0.525  0  0  0  0  0  1  0"
          }
        };

        const matrixValues = matrices[filter]?.[mode];
        if (!matrixValues) {
          sendResponse({ ok: false, message: "Unknown filter/mode combination." });
          return true;
        }

        // Create SVG with feColorMatrix filter
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.id = "accessflow-cb-svg";
        svg.setAttribute("style", "position:absolute;width:0;height:0;");
        svg.innerHTML = `<defs><filter id="af-cb-filter"><feColorMatrix type="matrix" values="${matrixValues}"/></filter></defs>`;
        document.body.appendChild(svg);

        // Apply filter via dedicated style element
        const style = document.createElement("style");
        style.id = "accessflow-colorblind";
        style.textContent = "html { filter: url(#af-cb-filter) !important; }";
        document.head.appendChild(style);

        sendResponse({ ok: true, message: `Color blind filter applied: ${filter} (${mode}).` });
        return true;
      }
      if (msg?.type === "COLORBLIND_OFF") {
        document.getElementById("accessflow-cb-svg")?.remove();
        document.getElementById("accessflow-colorblind")?.remove();
        document.documentElement.style.removeProperty("filter");
        sendResponse({ ok: true, message: "Color blind filter removed." });
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
