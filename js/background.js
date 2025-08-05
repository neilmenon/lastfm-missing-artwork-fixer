chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "setBadgeText") {
        chrome.action.setBadgeText({ text: request.text });
    }
});