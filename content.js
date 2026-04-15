// Element picker: on toggle, hovering shows an outline. Press a letter to copy
// context for the hovered element. Clicks are swallowed so the page doesn't
// receive them while the picker is active.
//
// Letter keys (hover an element first):
//   h → raw HTML (outerHTML)
//   b → HTML with attributes stripped
//   t → plain text (innerText)
//   c → buffered console logs (page-wide)
//   s → computed styles of the hovered element
//   p → CSS-selector for the hovered element
//   n → network resource log (page-wide)
//   i → PNG screenshot cropped to the hovered element
//   esc → cancel

(() => {
  if (window.__wcpInstalled) return;
  window.__wcpInstalled = true;

  let active = false;
  let overlay = null;
  let legend = null;
  let legendTitle = null;
  let lastTarget = null;

  // ---------- UI ----------

  function ensureUI() {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "wcp-overlay";
      overlay.style.display = "none";
      document.documentElement.appendChild(overlay);
    }
    if (!legend) {
      legend = document.createElement("div");
      legend.className = "wcp-legend";
      legend.innerHTML = LEGEND_HTML;
      // Hidden until the first hover positions it.
      legend.style.display = "none";
      document.documentElement.appendChild(legend);
      legendTitle = legend.querySelector(".wcp-legend-title");
    }
  }

  const LEGEND_HTML = `
    <div class="wcp-legend-title">—</div>
    <div class="wcp-legend-row"><span class="wcp-k">h</span><span>html</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">b</span><span>bare html</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">t</span><span>text</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">c</span><span>console</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">s</span><span>styles</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">p</span><span>selector</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">n</span><span>network</span></div>
    <div class="wcp-legend-row"><span class="wcp-k">i</span><span>screenshot</span></div>
    <div class="wcp-legend-sep"></div>
    <div class="wcp-legend-row"><span class="wcp-k">esc</span><span>cancel</span></div>
  `;

  function removeUI() {
    if (overlay) overlay.remove();
    if (legend) legend.remove();
    overlay = null;
    legend = null;
    legendTitle = null;
  }

  function positionOverlay(el) {
    const rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    // Title = element selector (like DevTools' inspector tooltip).
    const tag = el.tagName.toLowerCase();
    const id = el.id ? "#" + el.id : "";
    const classes = el.classList
      ? [...el.classList].filter((c) => !c.startsWith("wcp-")).slice(0, 3)
      : [];
    const cls = classes.length ? "." + classes.join(".") : "";
    const dim = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    if (legendTitle) {
      legendTitle.textContent = `${tag}${id}${cls}  ·  ${dim}`;
    }

    positionLegend(rect);
  }

  function positionLegend(rect) {
    if (!legend) return;
    legend.style.display = "block";

    // Measure the legend's natural size (it needs to be rendered first).
    // Using getBoundingClientRect after display:block gives accurate dimensions.
    const lr = legend.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const gap = 6;

    // Vertical: prefer above the element (DevTools-style); flip below if it
    // wouldn't fit.
    let top;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceAbove >= lr.height + gap) {
      top = rect.top - lr.height - gap;
    } else if (spaceBelow >= lr.height + gap) {
      top = rect.bottom + gap;
    } else {
      // Neither side has room; clamp to viewport and let it overlap.
      top = Math.max(4, Math.min(rect.bottom + gap, vh - lr.height - 4));
    }

    // Horizontal: align with element's left edge, clamp to viewport.
    let left = Math.max(4, Math.min(rect.left, vw - lr.width - 4));

    legend.style.top = top + "px";
    legend.style.left = left + "px";
  }

  function showToast(msg, isError) {
    const t = document.createElement("div");
    t.className = "wcp-toast" + (isError ? " wcp-error" : "");
    t.textContent = msg;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => t.classList.add("wcp-visible"));
    setTimeout(() => {
      t.classList.remove("wcp-visible");
      setTimeout(() => t.remove(), 220);
    }, 1800);
  }

  // ---------- Event handlers ----------

  function onMouseMove(e) {
    if (!active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === lastTarget) return;
    if (isOurUI(el)) return;
    lastTarget = el;
    positionOverlay(el);
  }

  function isOurUI(el) {
    if (!el || !el.classList) return false;
    return (
      el.classList.contains("wcp-overlay") ||
      el.classList.contains("wcp-legend") ||
      el.classList.contains("wcp-toast") ||
      el.closest?.(".wcp-legend")
    );
  }

  function onClick(e) {
    // Swallow clicks so the page doesn't receive them during picker mode.
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onAuxClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onContextMenu(e) {
    // Swallow right-click menu during picker mode.
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  async function onKey(e) {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
      showToast("Picker cancelled");
      return;
    }
    // Ignore modified letter presses so browser shortcuts still work.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = (e.key || "").toLowerCase();
    if (!MODE_KEYS.has(key)) return;
    e.preventDefault();
    e.stopPropagation();
    await runMode(key);
  }

  const MODE_KEYS = new Set(["h", "b", "t", "c", "s", "p", "n", "i"]);

  async function runMode(key) {
    const el = lastTarget;
    // Modes that need an element.
    const needsElement = new Set(["h", "b", "t", "s", "p", "i"]);
    if (needsElement.has(key) && !el) {
      showToast("Hover an element first", true);
      return;
    }

    if (key === "i") {
      await doScreenshot(el);
      return;
    }

    let body;
    let kind;
    let bodyTag = "content";

    switch (key) {
      case "h":
        body = el.outerHTML || "";
        kind = "html";
        break;
      case "b":
        body = stripAttributes(el);
        kind = "html-bare";
        break;
      case "t":
        body = (el.innerText || "").trim();
        kind = "text";
        break;
      case "c": {
        const logs = await getConsoleLogs();
        body = formatLogs(logs);
        kind = "console";
        bodyTag = "console";
        break;
      }
      case "s":
        body = computedStylesText(el);
        kind = "styles";
        bodyTag = "styles";
        break;
      case "p":
        body = selectorPathText(el);
        kind = "selector";
        bodyTag = "selector";
        break;
      case "n":
        body = getNetworkLog();
        kind = "network";
        bodyTag = "network";
        break;
    }

    const payload = buildXml(bodyTag, body, kind);
    deactivate();
    const ok = await copyTextToClipboard(payload);
    toast(ok, payload.length, kind);
  }

  function onScroll() {
    if (active && lastTarget) positionOverlay(lastTarget);
  }

  function toast(ok, bytes, kind) {
    if (ok) showToast(`Copied ${bytes.toLocaleString()} chars as ${kind}`);
    else showToast("Copy failed", true);
  }

  function activate() {
    if (active) return;
    active = true;
    lastTarget = null;
    ensureUI();
    document.documentElement.classList.add("wcp-active");
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAuxClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.documentElement.classList.remove("wcp-active");
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onAuxClick, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
    lastTarget = null;
    removeUI();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "WCP_TOGGLE") {
      if (active) deactivate();
      else activate();
    }
  });

  // ---------- XML payload ----------

  function buildXml(bodyTag, body, kind) {
    const title = xmlEscape(document.title || "Untitled");
    const link = xmlEscape(location.href);
    const inner =
      kind === "html" || kind === "html-bare"
        ? "<![CDATA[" + body.split("]]>").join("]]]]><![CDATA[>") + "]]>"
        : body;
    return (
      `<context>\n` +
      `<link>${link}</link>\n` +
      `<title>${title}</title>\n` +
      `<${bodyTag}>\n${inner}\n</${bodyTag}>\n` +
      `</context>\n`
    );
  }

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- HTML variants ----------

  function stripAttributes(el) {
    const clone = el.cloneNode(true);
    const drop = (n) => {
      if (!n.attributes) return;
      for (let i = n.attributes.length - 1; i >= 0; i--) {
        n.removeAttribute(n.attributes[i].name);
      }
    };
    drop(clone);
    for (const desc of clone.querySelectorAll("*")) drop(desc);
    return clone.outerHTML;
  }

  // ---------- Network log ----------

  function getNetworkLog() {
    const nav = performance.getEntriesByType("navigation")[0];
    const entries = performance.getEntriesByType("resource");
    const lines = [];
    if (nav) {
      lines.push(
        `[nav ${nav.responseStatus || "?"}] ${nav.name}  (${Math.round(
          nav.duration
        )}ms)`
      );
    }
    for (const e of entries) {
      const size = e.transferSize
        ? ` ${formatBytes(e.transferSize)}`
        : e.decodedBodySize
        ? ` ${formatBytes(e.decodedBodySize)}*`
        : "";
      const status = e.responseStatus ? `[${e.responseStatus}] ` : "";
      const type = e.initiatorType ? `(${e.initiatorType})` : "";
      lines.push(
        `${status}${type} ${e.name}  ${Math.round(e.duration)}ms${size}`
      );
    }
    if (!lines.length) return "(no network entries)";
    lines.push("");
    lines.push(`${entries.length} resource${entries.length === 1 ? "" : "s"}`);
    return lines.join("\n");
  }

  function formatBytes(n) {
    if (!n) return "0B";
    if (n < 1024) return n + "B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
    return (n / (1024 * 1024)).toFixed(2) + "MB";
  }

  // ---------- Selector path ----------

  function selectorPathText(el) {
    const chain = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      chain.unshift(formatSelectorSegment(node));
      if (node === document.documentElement) break;
      node = node.parentElement;
    }
    return chain.join(" > ");
  }

  function formatSelectorSegment(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + CSS.escape(el.id);
    const classes = [...(el.classList || [])].filter(
      (c) => !c.startsWith("wcp-")
    );
    if (classes.length) {
      s += "." + classes.slice(0, 3).map((c) => CSS.escape(c)).join(".");
    }
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) {
        const idx = same.indexOf(el) + 1;
        s += `:nth-of-type(${idx})`;
      }
    }
    return s;
  }

  // ---------- Computed styles ----------

  const STYLE_KEYS = [
    "display", "position", "top", "right", "bottom", "left",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border", "border-radius", "box-sizing", "overflow", "overflow-x", "overflow-y",
    "z-index", "float", "clear",
    "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "justify-content", "align-items", "align-content", "align-self", "gap",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
    "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "word-spacing",
    "color", "background-color", "background-image",
    "opacity", "visibility", "pointer-events", "cursor",
    "transform", "transition", "animation",
    "text-align", "text-decoration", "text-transform",
    "white-space", "word-wrap", "word-break",
    "box-shadow", "filter", "backdrop-filter",
  ];

  function computedStylesText(el) {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const header = [
      `element: ${formatSelectorSegment(el)}`,
      `bounds: ${Math.round(rect.width)}×${Math.round(rect.height)} @ (${Math.round(rect.left)},${Math.round(rect.top)})`,
      "",
    ];
    const props = [];
    for (const key of STYLE_KEYS) {
      const val = cs.getPropertyValue(key);
      if (val !== "") props.push(`${key}: ${val}`);
    }
    return header.concat(props).join("\n");
  }

  // ---------- Screenshot ----------

  async function doScreenshot(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      showToast("Element has zero size", true);
      return;
    }

    // Hide our UI so it doesn't appear in the screenshot.
    const prevOverlay = overlay?.style.display;
    const prevLegend = legend?.style.display;
    if (overlay) overlay.style.display = "none";
    if (legend) legend.style.display = "none";

    // Give the browser two frames to paint without our UI.
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );

    let dataUrl;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "WCP_CAPTURE" });
      dataUrl = resp?.dataUrl;
    } catch (e) {
      // fall through
    }

    // Restore UI.
    if (overlay) overlay.style.display = prevOverlay || "block";
    if (legend) legend.style.display = prevLegend || "";

    if (!dataUrl) {
      showToast("Screenshot capture failed", true);
      return;
    }

    try {
      const blob = await cropDataUrl(dataUrl, rect, window.devicePixelRatio || 1);
      const metaXml = buildXml(
        "screenshot",
        `element: ${formatSelectorSegment(el)}\nsize: ${Math.round(rect.width)}×${Math.round(rect.height)} px`,
        "screenshot-meta"
      );
      const ok = await copyImageAndTextToClipboard(blob, metaXml);
      deactivate();
      if (ok) {
        showToast(
          `Copied ${Math.round(rect.width)}×${Math.round(rect.height)} screenshot`
        );
      } else {
        showToast("Clipboard write failed", true);
      }
    } catch (err) {
      deactivate();
      showToast("Screenshot failed: " + err.message, true);
    }
  }

  function cropDataUrl(dataUrl, rect, dpr) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        const sx = Math.max(0, Math.round(rect.left * dpr));
        const sy = Math.max(0, Math.round(rect.top * dpr));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob returned null"));
        }, "image/png");
      };
      img.onerror = () => reject(new Error("failed to load capture"));
      img.src = dataUrl;
    });
  }

  // ---------- Console log bridge ----------

  function getConsoleLogs() {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        resolve(null);
      }, 500);
      function onMsg(e) {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.wcp !== "console-data" || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve(d.logs || []);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ wcp: "get-console", id }, "*");
    });
  }

  function formatLogs(logs) {
    if (logs === null) {
      return "(console hook not installed — reload the tab after installing the extension)";
    }
    if (!logs.length) return "(no console output captured)";
    return logs
      .map((e) => {
        const joined = (e.args || []).join(" ");
        return `[${formatElapsed(e.t)}] [${e.level}] ${joined}`;
      })
      .join("\n");
  }

  function formatElapsed(ms) {
    if (typeof ms !== "number") return "?";
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    const mmm = String(ms % 1000).padStart(3, "0");
    return `${mm}:${ss}.${mmm}`;
  }

  // ---------- Clipboard ----------

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function copyImageAndTextToClipboard(blob, text) {
    try {
      const item = new ClipboardItem({
        "image/png": blob,
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Some browsers won't allow multi-type; try image only.
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        return true;
      } catch {
        return false;
      }
    }
  }
})();
