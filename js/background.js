chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "setBadgeText") {
        chrome.action.setBadgeText({ text: request.text, tabId: sender.tab.id });
    }
    if (request.action === "setTitle") {
        chrome.action.setTitle({ title: request.text, tabId: sender.tab.id });
    }
});