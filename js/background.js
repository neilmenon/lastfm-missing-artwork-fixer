let constants;
let missingArtworkUrls = {}; // Store URLs by tab ID

async function init() {
    constants = await getConstants();
}

init();

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "update") {
        const manifest = await (await fetch(chrome.runtime.getURL('manifest.json'))).json();
        if (details.previousVersion !== manifest.version) {
            chrome.tabs.create({
                url: chrome.runtime.getURL("html/update.html?from=" + details.previousVersion + "&to=" + manifest.version)
            });
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "setBadgeText") {
        chrome.action.setBadgeText({ text: request.text, tabId: sender.tab.id });
    }

    if (request.action === "setTitle") {
        chrome.action.setTitle({ title: request.text, tabId: sender.tab.id });
    }

    if (request.action === "fetchImage") {
        // Validate URL format and allowed domains
        if (!isValidImageUrl(request.url)) {
            sendResponse({ success: false, error: "Invalid or unsafe URL" });
            return true;
        }

        fetch(request.url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            // Validate content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.startsWith('image/')) {
                throw new Error(`Invalid content type: ${contentType}`);
            }
            
            return response.blob();
        })
        .then(blob => {
            // Additional size check (max 10MB)
            if (blob.size > 10 * 1024 * 1024) {
                throw new Error('Image too large (max 10MB)');
            }
            
            const reader = new FileReader();
            reader.onloadend = () => {
                sendResponse({ success: true, dataUrl: reader.result });
            };
            reader.readAsDataURL(blob);
        })
        .catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (request.action === "fetchBandcamp") {
        fetchBandcamp(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchDeezer") {
        fetchDeezer(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchDiscogs") {
        fetchDiscogs(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchDiscogsImageUrl") {
        fetchFullSizeImageUrlFromDiscogsReleaseLink(request.discogsReleaseLink)
            .then(url => sendResponse({ success: true, url }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "updateMissingArtworkUrls") {
        missingArtworkUrls[sender.tab.id] = request.urls;
    }

    if (request.action === "getMissingArtworkUrls") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const urls = missingArtworkUrls[tabs[0].id] || [];
            sendResponse({ urls });
        });
        return true;
    }

    if (request.action === "openAllMissingArtworks") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const urls = missingArtworkUrls[tabs[0].id] || [];
            urls.forEach((url, index) => {
                setTimeout(() => {
                    chrome.tabs.create({ url, active: false });
                }, index * 100); // Stagger tab creation to avoid overwhelming the browser
            });
        });
    }
});

async function fetchBandcamp(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Bandcamp').searchUrl;
    const body = {
        search_text: searchQuery,
        search_filter: "",
        fan_id: null,
        full_page: false
    };

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results?.auto?.results ?? [];
}

async function fetchDeezer(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Deezer').searchUrl;
    const response = await fetch(`${url}${encodeURIComponent(searchQuery)}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results?.data ?? [];
}

async function fetchDiscogs(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Discogs').searchUrl;
    const response = await fetch(`${url}${encodeURIComponent(searchQuery)}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results?.autocomplete ?? [];
}

async function fetchFullSizeImageUrlFromDiscogsReleaseLink(discogsReleaseLink) {
    const response = await fetch(discogsReleaseLink);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const htmlText = await response.text();

    const match = htmlText.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    return match ? match[1] : null;
}

function isValidImageUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // Only allow HTTPS URLs for security
        if (urlObj.protocol !== 'https:') {
            return false;
        }
        
        // Allow common image hosting domains and music service domains
        const allowedDomains = [
            'lastfm.freetls.fastly.net',
            'last.fm',
            'bcbits.com',
            'bandcamp.com',
            'discogs.com',
            'apple.com',
            'mzstatic.com',
            'deezer.com',
            'dzcdn.net',
            'imgur.com',
            'googleusercontent.com',
            'wikimedia.org',
            'wikipedia.org'
        ];
        
        const hostname = urlObj.hostname.toLowerCase();
        const isAllowed = allowedDomains.some(domain => 
            hostname === domain || hostname.endsWith('.' + domain)
        );
        
        return isAllowed;
    } catch (error) {
        return false;
    }
}

async function getConstants() {
    return await (await fetch(chrome.runtime.getURL('json/constants.json'))).json();
}