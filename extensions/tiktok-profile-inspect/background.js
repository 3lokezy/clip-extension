chrome.action.onClicked.addListener(async function(tab) {
  if (!tab || !tab.id || !tab.url) return;
  if (!/tiktok\.com/i.test(tab.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          window.alert("Open a tiktok.com tab (e.g. a user profile), then click the extension icon again.");
        }
      });
    } catch (e) {}
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ["inject.js"],
      world: "MAIN"
    });
  } catch (e) {
    console.error("TikTok profile inspect:", e);
  }
});
