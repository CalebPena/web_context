// Runs in the page's MAIN world at document_start so we can intercept every
// console.* call made by the page. The buffer lives on `window` and is
// delivered to the isolated-world content script via window.postMessage.

(() => {
  if (window.__wcpConsoleHook) return;
  window.__wcpConsoleHook = true;

  const MAX_ENTRIES = 2000;
  const buf = [];
  const startedAt = Date.now();

  const methods = ["log", "info", "warn", "error", "debug"];
  for (const m of methods) {
    const orig = console[m];
    if (typeof orig !== "function") continue;
    console[m] = function (...args) {
      try {
        push(m, args);
      } catch {}
      return orig.apply(this, args);
    };
  }

  window.addEventListener("error", (e) => {
    push("uncaught", [
      (e.message || "Error") +
        (e.error && e.error.stack ? "\n" + e.error.stack : ""),
    ]);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = r && r.stack ? r.stack : r && r.message ? r.message : String(r);
    push("unhandled-rejection", [msg]);
  });

  function push(level, args) {
    buf.push({
      level,
      t: Date.now() - startedAt,
      args: args.map(formatArg),
    });
    if (buf.length > MAX_ENTRIES) buf.splice(0, buf.length - MAX_ENTRIES);
  }

  function formatArg(a) {
    if (a === null) return "null";
    if (a === undefined) return "undefined";
    const t = typeof a;
    if (t === "string") return a;
    if (t === "number" || t === "boolean" || t === "bigint") return String(a);
    if (t === "function") return `[Function ${a.name || "anonymous"}]`;
    if (a instanceof Error) {
      return `${a.name || "Error"}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
    }
    const seen = new WeakSet();
    try {
      return JSON.stringify(
        a,
        (_k, v) => {
          if (typeof v === "bigint") return String(v);
          if (typeof v === "function") return `[Function ${v.name || ""}]`;
          if (v && typeof v === "object") {
            if (v instanceof Node) return `[${v.nodeName || "Node"}]`;
            if (typeof Window !== "undefined" && v instanceof Window) return "[Window]";
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          return v;
        },
        2
      );
    } catch {
      try {
        return String(a);
      } catch {
        return "[Unserializable]";
      }
    }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.wcp !== "get-console") return;
    window.postMessage(
      { wcp: "console-data", id: d.id, logs: buf.slice() },
      "*"
    );
  });
})();
