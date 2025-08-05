

let settings = {},
    chooseFileContainer = null,
    artworkWidgetContainer = null,
    searchInputElement = null,
    resultsContainer = null,
    messagesContainer = null,
    results = null,
    loadingElement = null,
    lastfmFileInputElement = null,
    lastfmUploadButton = null,
    lastfmArtist = null,
    lastfmAlbum = null
;

async function uploadArtworkPage() {
    settings = await getSettings();
    extensionLog(`Extension settings loaded. ${JSON.stringify(settings)}`);

    extensionLog("Injecting artwork finder widget into DOM.")
    await injectArtworkWidget();
    extensionLog('Artwork uploader injected!');

    extensionLog("Setting initial search query.")
    injectDefaultSearchQuery()
    extensionLog("Initial search query set.")

    executeSearchAndDisplayResults();

    extensionLog("Listening for new searches and artwork selection.");
    listenForNewSearches();
    listenForArtworkSelection();
}

async function injectArtworkWidget() {
    const res = await fetch(chrome.runtime.getURL('html/upload-artwork-widget.html'));
    const htmlText = await res.text();

    const widget = document.createElement('div');
    widget.innerHTML = htmlText;

    widget.querySelector('img.lfmmaf-extension-icon').src = chrome.runtime.getURL('icons/icon16.png');

    chooseFileContainer.parentElement.insertBefore(widget, chooseFileContainer);
    searchInputElement = document.getElementById('lfmmaf-artwork-search');
    resultsContainer = document.getElementById('lfmmaf-results-container');
    messagesContainer = document.getElementById('lfmmaf-messages-container');
    loadingElement = document.getElementById('lffmaf-input-loading');
    lastfmFileInputElement = document.getElementById('id_image');
    lastfmUploadButton = document.querySelector('button[type="submit"].btn-primary');

    lastfmUploadButton.addEventListener('click', () => {
        settings = { ...settings, userFixedArtworksCount: settings.userFixedArtworksCount + 1 }
        saveSettings(settings);
        chrome.runtime.sendMessage({ action: "setBadgeText", text: `${settings.userFixedArtworksCount}` });
    });
}

function injectDefaultSearchQuery() {
    lastfmArtist = document.querySelector("span[itemprop=byArtist] span[itemprop=name]")?.textContent?.trim()
    lastfmAlbum = document.querySelector("h1.header-new-title[itemprop=name]")?.textContent?.trim()
    const searchQuery = `${ lastfmArtist ?? '' } ${ lastfmAlbum ?? '' }`.trim()

    searchInputElement.value = searchQuery
}

async function searchForArtwork() {
    const searchFunctionsMap = {
        "Apple Music": searchAppleMusic
    }

    return searchFunctionsMap[settings.selectedArtworkSource](searchInputElement.value);
}

async function searchAppleMusic(searchQuery) {
    const query = searchQuery?.trim();
    if (!query?.length) {
        hideLoadingPulse();
        return [];
    }
    extensionLog(`Searching Apple Music for artwork with query: ${query}`)
    showLoadingPulse();
    clearMessageContainer();
    const url = settings.artworkSourceOptions.find(source => source.name === 'Apple Music').searchUrl;
    const response = await fetch(`${url}&country=${settings.selectedCountry}&term=${query}`)
        .catch(error => {
            extensionError("Error fetching Apple Music artwork.", error);
            return null;
        });
    hideLoadingPulse();
    if (!response) {
        return;
    }

    const resultText = await response.text();
    const results = JSON.parse(resultText)?.results ?? [];
    return results.map(album => ({
        artist: album.artistName,
        album: album.collectionName,
        releaseDate: album.releaseDate,
        trackCount: album.trackCount,
        artworkUrl: album.artworkUrl100.replace("100x100bb", `${settings.selectedArtworkSize}x${settings.selectedArtworkSize}bb`),
        artistUrl: album.artistViewUrl,
        albumUrl: album.collectionViewUrl,
        id: `${album.collectionId}`
    }))
}

function displayResults() {
    if (!results.length) {
        if (!searchInputElement.value?.trim()?.length) {
            clearMessageContainer();
        } else {
            showMessage(`No results found for the given search terms. <a href="${settings.googleImagesSearchUrl + searchInputElement.value}" target="_blank">Here's a quick link</a> to search on Google Images. If you find something there, hit <strong>Copy image address</strong> and paste it in the box above, we'll auto-fetch and attach it for you!`, 'info');
        }
    } else {
        showMessage(`Displaying ${results.length} result${results.length == 1 ? '' : 's'} from ${settings.selectedArtworkSource}.`, 'info');
    }

    let resultsHTML = '';
    for (const result of results) {
        resultsHTML += `
            <div class="lffmaf-result-entry">
                <img 
                    src="${result.artworkUrl}"
                    title="Artwork for ${result.artist} - ${result.album}"
                >
                <button class="lfmmaf-upload-button" title="Select this artwork to upload" data-lfmmaf-album-id="${result.id}">
                    <img src="https://www.last.fm/static/images/icons/add_fff_16.png">
                </button>
                <div class="lffmaf-result-info">
                    <div class="lfmmaf-result-title-text">
                        <a href="${result.albumUrl}" target="_blank" title="Open ${result.album} in ${settings.selectedArtworkSource}">${result.album}</a>
                    </div>
                    <div>
                        <a href="${result.artistUrl}" target="_blank" title="Open ${result.artist} in ${settings.selectedArtworkSource}">${result.artist}</a>
                    </div>
                    <div class="lfmmaf-result-subtitle-text">${moment(result.releaseDate).format("D MMM YYYY")} · ${result.trackCount} track${result.trackCount == 1 ? '' : 's'}</div>
                </div>
            </div> 
        `;
    }
    resultsContainer.innerHTML = resultsHTML;
}

async function executeSearchAndDisplayResults() {
    if (/https?:\/\/[^\s/$.?#].[^\s]*/gi.test(searchInputElement.value)) {
        extensionLog("User provided direct image link. Attempting to fetch it.");
        await fetchAndPopulateImageFromLink();
        return;
    }

    if (searchInputElement.value?.startsWith('data:')) {
        showMessage(`Whoops. You entered the image in BLOB format (starts with "data:"). Only direct links and text searches are allowed. If you're using Google Images, make sure you click on the image in the results <em>first</em> before doing "Copy image address".`, 'danger');
        hideLoadingPulse();
        return;
    }

    results = await searchForArtwork();
    if (!results) {
        showMessage(`Failed to fetch artwork from ${settings.selectedArtworkSource}. Please try again.`, 'danger');
        return;
    }
    extensionLog(`Found ${results.length} result(s).`)
    displayResults(results);
}

function listenForNewSearches() {
    let debounceTimeout;

    searchInputElement.addEventListener('input', () => {
        showLoadingPulse();
        clearTimeout(debounceTimeout);

        debounceTimeout = setTimeout(async () => {
            await executeSearchAndDisplayResults();
        }, 1000);
    });
}

function listenForArtworkSelection() {
    resultsContainer.addEventListener('click', (event) => {
        event.preventDefault();
        if (event.target.matches('.lfmmaf-upload-button')) {
            selectArtworkByAlbumId(event.target.dataset?.lfmmafAlbumId, event.target);
        }
    });
}

async function selectArtworkByAlbumId(albumId, clickedElement) {
    const selectedResult = results?.find(result => result.id === albumId);
    if (!selectedResult) {
        extensionError(`User clicked select button on album with ID: ${albumId}, but no entry was found in results list!`);
        return;
    }
    extensionLog(`User selected ${selectedResult.artist} - ${selectedResult.album} for upload. Fetching external image to upload.`);
    showLoadingPulse();

    try {
        const response = await fetch(selectedResult.artworkUrl);
        const blob = await response.blob();
        const file = new File([blob], `${selectedResult.artist} - ${selectedResult.album}.jpg`, { type: blob.type });

        const fileSizeHuman = (file.size / (1024 * 1024)).toFixed(2) + " MB";
        if (file.size > 5 * 1024 * 1024) {
            showMessage(`Artwork size exceeds the maximum allowed by Last.fm (${fileSizeHuman} / 5 MB). Please choose a smaller artwork size in the extension settings to proceed.`, 'danger');
            hideLoadingPulse();
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        lastfmFileInputElement.files = dataTransfer.files;
    
        await new Promise(resolve => setTimeout(resolve, 500));

        const previouslySelectedItems = document.querySelectorAll('.lfmmaf-selected');
        for (const element of previouslySelectedItems) {
            element.firstElementChild.src = 'https://www.last.fm/static/images/icons/add_fff_16.png';
            element.classList.remove('lfmmaf-selected');
        }
        clickedElement.firstElementChild.src = 'https://www.last.fm/static/images/icons/accept_fff_16.png';
        clickedElement.classList.add('lfmmaf-selected');

        const fileInputContainer = lastfmFileInputElement.closest('.btn-file');
        fileInputContainer.classList.add('lfmmaf-file-input-disabled');

        const fileInputLabel = document.querySelector('.btn-file-label');
        fileInputLabel.innerHTML = `File selected for upload, ${fileSizeHuman}.`

        if (settings.populateTitleField) {
            const lastfmTitleElement = document.getElementById('id_title');
            lastfmTitleElement.value = `${selectedResult.artist} - ${selectedResult.album}`;
        }

        if (settings.populateDescriptionField) {
            const lastfmDescriptionElement = document.getElementById('id_description');
            lastfmDescriptionElement.value = `Artwork for ${selectedResult.album} by ${selectedResult.artist}, released ${moment(selectedResult.releaseDate).format("D MMM YYYY")}.`
        }
    } catch (e) {
        extensionError("Error while fetching or attaching image.", e)
        showMessage("There was an issue downloading and/or attaching the image to Last.fm. Please try again.", 'danger')
        return;
    } finally {
        hideLoadingPulse();
    }

    extensionLog("Successfully attached image to Last.fm file input.");
}

async function fetchAndPopulateImageFromLink() {
    showLoadingPulse();

    try {
        const response = await fetch(searchInputElement.value);
        const blob = await response.blob();

        const mimeType = blob.type;
        const extensionMap = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif'
        };

        const extension = extensionMap[mimeType];

        if (!extension) {
            showMessage(`Unsupported image format: ${mimeType}.`, 'danger');
            hideLoadingPulse();
            return;
        }

        const fileName = `${lastfmArtist} - ${lastfmAlbum}.${extension}`;
        const file = new File([blob], fileName, { type: mimeType });

        const fileSizeHuman = (file.size / (1024 * 1024)).toFixed(2) + " MB";

        if (file.size > 5 * 1024 * 1024) {
            showMessage(`Artwork size exceeds the maximum allowed by Last.fm (${fileSizeHuman} / 5 MB). Please choose a smaller artwork size in the extension settings to proceed.`, 'danger');
            hideLoadingPulse();
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        lastfmFileInputElement.files = dataTransfer.files;
    
        await new Promise(resolve => setTimeout(resolve, 500));

        const fileInputContainer = lastfmFileInputElement.closest('.btn-file');
        fileInputContainer.classList.add('lfmmaf-file-input-disabled');

        const fileInputLabel = document.querySelector('.btn-file-label');
        fileInputLabel.innerHTML = `File selected for upload, ${fileSizeHuman}.`

        if (settings.populateTitleField) {
            const lastfmTitleElement = document.getElementById('id_title');
            lastfmTitleElement.value = `${lastfmArtist} - ${lastfmAlbum}`;
        }

        if (settings.populateDescriptionField) {
            const lastfmDescriptionElement = document.getElementById('id_description');
            lastfmDescriptionElement.value = `Artwork for ${lastfmAlbum} by ${lastfmArtist}.`
        }

        resultsContainer.innerHTML = `
            <div class="lffmaf-result-entry">
                <img 
                    src="${searchInputElement.value}"
                    title="Artwork for ${lastfmArtist} - ${lastfmAlbum}"
                >
                <button class="lfmmaf-upload-button lfmmaf-selected" title="Select this artwork to upload">
                    <img src="https://www.last.fm/static/images/icons/accept_fff_16.png">
                </button>
            </div> 
        `;
        showMessage(`Successfully fetched and attached ${extension?.toUpperCase()} image from provided URL.`, 'success');
    } catch (e) {
        extensionError("Error while fetching or attaching image.", e)
        showMessage("There was an issue downloading and/or attaching the image to Last.fm. Please check the URL you provided. Some websites block this type of fetching, so you can also try a different site.", 'danger')
        return;
    } finally {
        hideLoadingPulse();
    }

    extensionLog("Successfully attached image to Last.fm file input.")
}

function showLoadingPulse() {
    loadingElement.style.opacity = '100';
}

function hideLoadingPulse() {
    loadingElement.style.opacity = '0';
}

function clearMessageContainer() {
    messagesContainer.innerHTML = '';
}

function showMessage(message, type) {
    messagesContainer.innerHTML = `
        <div class="alert alert-${type}" style="width:100%">
            ${message}
        </div>
    `;
}

function extensionLog(message) {
    console.log(`[Last.fm Missing Artwork Fixer] 💿 ${message}`)
}

function extensionError(message, error) {
    console.error(`[Last.fm Missing Artwork Fixer] ❌ ${message}`, error)
}

async function getSettings() {
    const userSettings = await new Promise((resolve) =>
        chrome.storage.sync.get('settings', resolve)
    );
    const defaultSettings = await (await fetch(chrome.runtime.getURL('json/default-settings.json'))).json();
    return {
        ...defaultSettings,
        ...(userSettings.settings ?? {})
    };
}

async function saveSettings(newSettings) {
    return new Promise((resolve) =>
        chrome.storage.sync.set({ settings: newSettings }, resolve)
    );
}

setInterval(() => {
    chooseFileContainer = document.querySelector('.form-group--image');
    artworkWidgetContainer = document.getElementById('lfmmaf-widget');
    if (chooseFileContainer && !artworkWidgetContainer) {
        extensionLog("Found artwork upload form, initiating script.")
        uploadArtworkPage();
    }
}, 1000);