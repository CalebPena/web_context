// Toggles the picker on the active tab when the toolbar button is clicked
// or the keyboard shortcut is pressed.

async function togglePickerOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  if (!/^https?:|^file:/.test(tab.url || "")) {
    // Content scripts don't run on chrome:// or about: pages.
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "WCP_TOGGLE" });
  } catch (err) {
    // Content script may not be injected yet (e.g. extension was just installed
    // and the tab hasn't reloaded). Inject on demand and retry once.
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["picker.css"],
    });
    // MAIN-world hook (won't catch logs made before this moment, but future
    // ones will be buffered).
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["console_hook.js"],
        world: "MAIN",
      });
    } catch {}
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "WCP_TOGGLE" });
  }
}

chrome.action.onClicked.addListener(togglePickerOnActiveTab);

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-picker") togglePickerOnActiveTab();
});

// Content script asks us to capture the visible viewport; only the background
// (with `activeTab`) is allowed to call tabs.captureVisibleTab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "WCP_CAPTURE") return;
  const windowId = sender?.tab?.windowId;
  chrome.tabs
    .captureVisibleTab(windowId, { format: "png" })
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep channel open for async response
});
