let constants;

// TODO: investigate race condition on tab selection where these are not loaded from constants in time
const leaderboardAPIUrl = 'https://api.neilmenon.com/lfmmaf-leaderboard/';
const leaderboardAPIHeader = '2i8GivN4miVZyNXT0G1+ORbpwzYk/xeo44Yhu50RjFE=';

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
        if (sender.tab && sender.tab.id) {
            chrome.action.setBadgeText({ text: request.text, tabId: sender.tab.id });
        }
    }

    if (request.action === "setTitle") {
        if (sender.tab && sender.tab.id) {
            chrome.action.setTitle({ title: request.text, tabId: sender.tab.id });
        }
    }

    if (request.action === "fetchImage") {
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

    if (request.action === "fetchDiscogsReleaseImageUrl") {
        fetchFullSizeImageUrlFromDiscogsReleaseLink(request.discogsReleaseLink)
            .then(url => sendResponse({ success: true, url }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchArtistBandcamp") {
        fetchArtistBandcamp(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchArtistDeezer") {
        fetchArtistDeezer(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchArtistDiscogs") {
        fetchArtistDiscogs(request.searchQuery)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchDiscogsArtistImageUrl") {
        fetchFullSizeImageUrlFromDiscogsArtistLink(request.discogsArtistLink)
            .then(url => sendResponse({ success: true, url }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "fetchLeaderboard") {
        fetchLeaderboard()
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "updateLeaderboard") {
        updateLeaderboard(request.payload)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "deleteFromLeaderboard") {
        deleteFromLeaderboard(request.payload)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// album artwork fetch methods
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

// artist image fetch methods
async function fetchArtistBandcamp(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Bandcamp').artistSearchUrl;
    const body = {
        search_text: searchQuery,
        search_filter: "b",
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

async function fetchArtistDeezer(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Deezer').artistSearchUrl;
    const response = await fetch(`${url}${encodeURIComponent(searchQuery)}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results?.data ?? [];
}

async function fetchArtistDiscogs(searchQuery) {
    const url = constants.artworkSourceOptions.find(source => source.name === 'Discogs').artistSearchUrl;
    const response = await fetch(`${url}${encodeURIComponent(searchQuery)}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results?.autocomplete ?? [];
}

async function fetchFullSizeImageUrlFromDiscogsArtistLink(discogsArtistLink) {
    const response = await fetch(discogsArtistLink);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const htmlText = await response.text();

    const match = htmlText.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    return match ? match[1] : null;
}

async function fetchLeaderboard() {
    const response = await fetch(leaderboardAPIUrl, {
        headers: { 'Content-Type': 'application/json', 'Authorization': leaderboardAPIHeader }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = (await response.json());
    return results || [];
}

async function updateLeaderboard(body) {
    const response = await fetch(leaderboardAPIUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': leaderboardAPIHeader },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return true;
}

async function deleteFromLeaderboard(body) {
    const response = await fetch(leaderboardAPIUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': leaderboardAPIHeader },
        body: JSON.stringify(body),
    });
}

async function getConstants() {
    return await (await fetch(chrome.runtime.getURL('json/constants.json'))).json();
}