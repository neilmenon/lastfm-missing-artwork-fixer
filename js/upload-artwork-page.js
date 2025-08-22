let settings = {},
    constants = {},
    chooseFileContainer = null,
    artworkWidgetContainer = null,
    searchInputElement = null,
    sourceSelectElement = null,
    resultsContainer = null,
    messagesContainer = null,
    results = null,
    loadingElement = null,
    lastfmFileInputElement = null,
    lastfmUploadButton = null,
    lastfmArtist = null,
    lastfmAlbum = null,
    buttonFocusedOnInitialLoad = false,
    countingInitialized = false; // Global flag to prevent multiple counting setups

async function uploadArtworkPage() {
    settings = await getSettings();
    constants = await getConstants();
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
    return true;
}

async function injectArtworkWidget() {
    const res = await fetch(chrome.runtime.getURL('html/upload-artwork-widget.html'));
    const htmlText = await res.text();

    const widget = document.createElement('div');
    widget.innerHTML = htmlText;
    widget.querySelector('img.lfmmaf-extension-icon').src = chrome.runtime.getURL('icons/icon16.png');

    if (!chooseFileContainer || !chooseFileContainer.parentElement) {
        extensionError("Cannot inject artwork widget: chooseFileContainer or its parent not found");
        return;
    }
    chooseFileContainer.parentElement.insertBefore(widget, chooseFileContainer);

    searchInputElement = document.getElementById('lfmmaf-artwork-search');
    sourceSelectElement = document.getElementById('lfmmaf-artwork-source');
    resultsContainer = document.getElementById('lfmmaf-results-container');
    messagesContainer = document.getElementById('lfmmaf-messages-container');
    loadingElement = document.getElementById('lffmaf-input-loading');
    lastfmFileInputElement = document.getElementById('id_image');
    lastfmUploadButton = document.querySelector('button[type="submit"].btn-primary');
    lastfmUploadButton.classList.add('lfmmaf-lastfm-upload-image-button');

    for (const source of constants.artworkSourceOptions) {
        sourceSelectElement.innerHTML += `
            <option value="${source.name}" title="${source.name}" ${settings.selectedArtworkSource === source.name ? 'selected' : ''}>
                ${source.shortName}
            </option>
        `;
    }

    document.addEventListener("click", function (e) {
        const link = e.target.closest("a.lfmmaf-link");
        if (!link) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (link.target === "_blank") {
            window.open(link.href, "_blank");
        } else {
            window.location.href = link.href;
        }
    }, true);

    sourceSelectElement.addEventListener('change', async () => {
        await executeSearchAndDisplayResults();
    });

    // Initialize counting logic only once globally
    initializeUploadCounting();
    
    // Add auto-close functionality after successful submission
    initializeAutoCloseOnSubmit();
}

function injectDefaultSearchQuery() {
    const searchQuery = `${ lastfmArtist ?? '' } ${ lastfmAlbum ?? '' }`
        .replaceAll('[Explicit]', '')
        .trim()
    ;
    searchInputElement.value = searchQuery
}

async function searchForArtwork(searchQuery) {
    const searchFunctionsMap = {
        "Apple Music": searchAppleMusic,
        "Bandcamp": searchBandcamp,
        "Deezer": searchDeezer,
        "Discogs": searchDiscogs,
    }

    let results = [];
    let failedSources = [];
    if (sourceSelectElement.value === 'All Sources Combined') {
        const resultsBySource = {};
        for (const source of Object.keys(searchFunctionsMap)) {
            resultsBySource[source] = await searchFunctionsMap[source](searchQuery);
            if (!resultsBySource[source]) {
                failedSources.push(source);
                resultsBySource[source] = [];
            }
        }

        results = Array.from({ length: Math.max(...Object.values(resultsBySource).map(r => r.length)) })
            .flatMap((_, i) => Object.values(resultsBySource).map(r => r[i]).filter(Boolean));
    } else {
        results = await searchFunctionsMap[sourceSelectElement.value](searchQuery);
    }

    if (results) {
        if (!results.length) {
            if (!searchInputElement.value?.trim()?.length) {
                clearMessageContainer();
            } else {
                showMessage(`No results found for the given search terms. Try another artwork source. Or, <a href="${constants.googleImagesSearchUrl + searchInputElement.value}" target="_blank">here's a quick link</a> to search on Google Images. If you find something there, hit <strong>Copy image address</strong> and paste it in the box above, we'll auto-fetch and attach it for you!`, 'info');
            }
        } else {
            const sourceSelectedText = sourceSelectElement.value === 'All Sources Combined' ? 'all sources' : sourceSelectElement.value;
            const failedSourcesText = failedSources.length ? ` (failed sources: ${failedSources.join(', ')})` : '';
            showMessage(`Displaying ${results.length} result${results.length == 1 ? '' : 's'} from ${sourceSelectedText}${failedSourcesText}.`, failedSources.length ? 'warning' : 'info');
        }
    }

    return results;
}

async function searchAppleMusic(searchQuery) {
    extensionLog(`Searching Apple Music for artwork with query: ${searchQuery}`);

    const artworkSource = constants.artworkSourceOptions.find(source => source.name === 'Apple Music');
    const url = artworkSource.searchUrl;
    let response;
    try {
        response = await fetch(`${url}&country=${settings.selectedCountry}&term=${encodeURIComponent(searchQuery)}`)
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        extensionError("Error fetching Apple Music artwork.", error);
        response = null;
    }
    
    if (!response) {
        return;
    }

    const resultText = await response.text();
    let parsedData;
    try {
        parsedData = JSON.parse(resultText);
    } catch (error) {
        extensionError("Failed to parse Apple Music API response", error);
        return [];
    }
    
    const results = parsedData?.results ?? [];
    if (!Array.isArray(results)) {
        extensionError("Apple Music API returned invalid results format", parsedData);
        return [];
    }
    
    return results.filter(album => album && album.artistName && album.collectionName).map(album => ({
        artist: album.artistName || 'Unknown Artist',
        album: album.collectionName || 'Unknown Album',
        releaseDate: album.releaseDate || null,
        trackCount: album.trackCount || null,
        artworkUrl: album.artworkUrl100 ? album.artworkUrl100.replace("100x100bb", `${settings.selectedArtworkSize}x${settings.selectedArtworkSize}bb`) : null,
        artistUrl: album.artistViewUrl || null,
        albumUrl: album.collectionViewUrl || null,
        id: `am-${album.collectionId || Math.random().toString(36).substr(2, 9)}`,
        source: artworkSource,
    }))
}

async function searchBandcamp(searchQuery) {
    extensionLog(`Searching Bandcamp for artwork with query: ${searchQuery}`);

    const artworkSource = constants.artworkSourceOptions.find(source => source.name === 'Bandcamp');
    const results = await fetchArtworkResultsFromBackgroundScript(searchQuery, 'fetchBandcamp')
        .catch(error => {
            extensionError("Error fetching Bandcamp artwork.", error);
            return null;
        });

    if (!results) {
        return;
    }

    if (!Array.isArray(results)) {
        extensionError("Bandcamp API returned invalid results format", results);
        return [];
    }
    
    return results.filter(x => x && ['a', 't'].includes(x.type) && x.band_name && x.name).map(album => ({
        artist: album.band_name || 'Unknown Artist',
        album: album.name || 'Unknown Album',
        releaseDate: null,
        trackCount: null,
        artworkUrl: album.art_id ? `${constants.bandcampImageUrl}${album.art_id}_10.jpg` : null,
        artistUrl: album.item_url_root || null,
        albumUrl: album.item_url_path || null,
        id: `bc-${album.id || Math.random().toString(36).substr(2, 9)}`,
        source: artworkSource,
    }));
}

async function searchDeezer(searchQuery) {
    extensionLog(`Searching Deezer for artwork with query: ${searchQuery}`);
    
    const artworkSource = constants.artworkSourceOptions.find(source => source.name === 'Deezer');
    const results = await fetchArtworkResultsFromBackgroundScript(searchQuery, 'fetchDeezer')
        .catch(error => {
            extensionError("Error fetching Deezer artwork.", error);
            return null;
        });

    if (!results) {
        return;
    }

    if (!Array.isArray(results)) {
        extensionError("Deezer API returned invalid results format", results);
        return [];
    }

    return results.filter(album => album && album.artist && album.title).map(album => ({
        artist: album.artist?.name || 'Unknown Artist',
        album: album.title || 'Unknown Album',
        releaseDate: null,
        trackCount: album.nb_tracks || null,
        artworkUrl: album.cover_xl || null,
        artistUrl: album.artist?.link || null,
        albumUrl: album.link || null,
        id: `dz-${album.id || Math.random().toString(36).substr(2, 9)}`,
        source: artworkSource,
    }));
}

async function searchDiscogs(searchQuery) {
    extensionLog(`Searching Discogs for artwork with query: ${searchQuery}`);
    
    const artworkSource = constants.artworkSourceOptions.find(source => source.name === 'Discogs');
    const results = await fetchArtworkResultsFromBackgroundScript(searchQuery, 'fetchDiscogs')
        .catch(error => {
            extensionError("Error fetching Discogs artwork.", error);
            return null;
        });

    if (!results) {
        return;
    }

    if (!Array.isArray(results)) {
        extensionError("Discogs API returned invalid results format", results);
        return [];
    }

    return results
        .filter(album => album && (album?.images?.edges?.at(0)?.node?.tiny?.sourceUrl?.length ?? 0) > 0)
        .map(album => ({
            artist: album?.primaryArtists?.map(artist => artist?.artist?.name).filter(Boolean).join(', ') || 'Unknown Artist',
            album: album?.title || 'Unknown Album',
            releaseDate: album?.released || null,
            extraInfo: `${album?.country || ''} • ${album?.formats?.map(format => format?.name).filter(Boolean).join(', ') || ''}`,
            trackCount: null,
            artworkUrl: album?.images?.edges?.at(0)?.node?.tiny?.sourceUrl || null,
            artistUrl: album?.primaryArtists?.at(0)?.artist?.discogsId ? `https://www.discogs.com/artist/${album.primaryArtists.at(0).artist.discogsId}` : null,
            albumUrl: album?.siteUrl ? `https://www.discogs.com${album.siteUrl}` : null,
            id: `dc-${album?.discogsId || Math.random().toString(36).substr(2, 9)}`,
            source: artworkSource,
    }));
}

function displayResults() {
    let resultsHTML = '';
    for (const result of results) {
        const releaseDateMoment = moment(result.releaseDate);
        const releaseDateText = result.releaseDate && releaseDateMoment.isValid() ? (result.releaseDate.length === 4 ? result.releaseDate : releaseDateMoment.format("D MMM YYYY")) : '';
        const trackCountText = result.trackCount ? `${result.trackCount} track${result.trackCount == 1 ? '' : 's'}` : '';
        const extraInfoText = result.extraInfo ?? '';
        const subTitle = `<div class="lfmmaf-result-subtitle-text">${ [releaseDateText, trackCountText, extraInfoText].filter(x => x.length).join(' • ') }&nbsp;</div>`;

        const fullSizeDiscogsMessage = result.source.name === 'Discogs' ? `<div class="lfmmaf-discogs-fullsize-message" id="discogs-message-${result.id}">Full size image will be fetched from Discogs if this image is selected.</div>` : '';

        resultsHTML += `
            <div class="lffmaf-result-entry">
                ${fullSizeDiscogsMessage}
                <img 
                    src="${result.artworkUrl}"
                    title="Artwork for ${result.artist} - ${result.album}"
                >
                <button class="lfmmaf-upload-button" title="Select this artwork to upload" data-lfmmaf-album-id="${result.id}">
                    <img src="${constants.lastfmIconUrls.add}">
                </button>
                <div class="lffmaf-result-info">
                    <div class="lfmmaf-result-title-text">
                        <a tabindex="-1" href="${result.albumUrl}" target="_blank" title="Open ${result.album} in ${sourceSelectElement.value}" class="lfmmaf-link">${result.album}</a>
                        <img src="${result.source.iconUrl}" title="Source: ${result.source.name}" class="lfmmaf-source-icon">
                    </div>
                    <div>
                        <a tabindex="-1" href="${result.artistUrl}" target="_blank" title="Open ${result.artist} in ${sourceSelectElement.value}" class="lfmmaf-link">${result.artist}</a>
                    </div>
                    ${subTitle}
                </div>
            </div> 
        `;
    }
    resultsContainer.innerHTML = resultsHTML;

    if (!buttonFocusedOnInitialLoad) {
        document.querySelector('.lfmmaf-upload-button')?.focus();
        buttonFocusedOnInitialLoad = true;
    }
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

    showLoadingPulse();
    clearMessageContainer();

    const searchQuery = searchInputElement.value?.trim() ?? '';
    if (!searchQuery.length) {
        results = [];
        clearMessageContainer();
    } else {
        results = await searchForArtwork(searchQuery);
    }

    hideLoadingPulse();

    if (!results) {
        showMessage(`Failed to fetch artwork from ${sourceSelectElement.value}. Please try again.`, 'danger');
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
        }, 1250);
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

    if (selectedResult.source.name === 'Discogs') {
        showMessage(`Scraping full-size image URL from Discogs release page.`, 'info');

        document.getElementById(`discogs-message-${selectedResult.id}`)?.remove();

        const imageElement = document.querySelector(`img[src="${selectedResult.artworkUrl}"]`);
        imageElement.src = constants.loadingGifUrl;

        const fullSizeImageUrl = await fetchDiscogsFullSizeImageUrl(selectedResult.albumUrl)
            .catch(error => {
                extensionError("Error fetching full size image from Discogs.", error);
                return null;
            });

        if (!fullSizeImageUrl) {
            showMessage("There was an issue fetching the full size image from Discogs. Please try again.", 'danger');
            hideLoadingPulse();
            return;
        }

        selectedResult.artworkUrl = fullSizeImageUrl;
        imageElement.src = fullSizeImageUrl;
        showMessage(`Successfully fetched full-size image URL from Discogs release page. `, 'success');
    }

    try {
        const blob = await fetchImageBlob(selectedResult.artworkUrl);
        const file = new File([blob], `${selectedResult.artist} - ${selectedResult.album}.jpg`, { type: blob.type });

        const fileSizeHuman = (file.size / (1024 * 1024)).toFixed(2) + " MB";
        if (file.size > 5 * 1024 * 1024) {
            showMessage(`Artwork size exceeds the maximum allowed by Last.fm (${fileSizeHuman} / 5 MB). Please choose a smaller artwork size in the extension settings to proceed.`, 'danger');
            hideLoadingPulse();
            return;
        }

        const imageDimensions = await getImageDimensionsFromBlob(blob).catch(() => null);

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        lastfmFileInputElement.files = dataTransfer.files;
    
        await new Promise(resolve => setTimeout(resolve, 500));

        const previouslySelectedItems = document.querySelectorAll('.lfmmaf-selected');
        for (const element of previouslySelectedItems) {
            element.firstElementChild.src = constants.lastfmIconUrls.add;
            element.classList.remove('lfmmaf-selected');
        }
        clickedElement.firstElementChild.src = constants.lastfmIconUrls.accept;
        clickedElement.classList.add('lfmmaf-selected');

        const fileInputContainer = lastfmFileInputElement.closest('.btn-file');
        fileInputContainer.classList.add('lfmmaf-file-input-disabled');

        const fileInputLabel = document.querySelector('.btn-file-label');
        fileInputLabel.innerHTML = `File selected for upload, ${fileSizeHuman}${imageDimensions ? `, ${imageDimensions.width}x${imageDimensions.height}` : ''}.`

        if (settings.populateTitleField) {
            const lastfmTitleElement = document.getElementById('id_title');
            lastfmTitleElement.value = `${selectedResult.artist} - ${selectedResult.album}`;
        }

        if (settings.populateDescriptionField) {
            const lastfmDescriptionElement = document.getElementById('id_description');
            const releaseDateMoment = moment(selectedResult.releaseDate);
            const isDateValid = selectedResult.releaseDate && releaseDateMoment.isValid();
            const releaseDate = isDateValid ? (selectedResult.releaseDate.length === 4 ? selectedResult.releaseDate : releaseDateMoment.format("D MMM YYYY")) : '';
            const releasedDateText = isDateValid ? `, released ${releaseDate}` : '';
            lastfmDescriptionElement.value = `Artwork for ${selectedResult.album} by ${selectedResult.artist}${releasedDateText}.`
        }
        
        scrollAndFocusUploadButton();
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
        const blob = await fetchImageBlob(searchInputElement.value);

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
                    <img src="${constants.lastfmIconUrls.accept}">
                </button>
            </div> 
        `;

        scrollAndFocusUploadButton();

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

async function fetchImageBlob(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "fetchImage", url },
      (response) => {
        if (response && response.success) {
          fetch(response.dataUrl).then(r => r.blob()).then(resolve).catch(reject);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      }
    );
  });
}

async function fetchArtworkResultsFromBackgroundScript(searchQuery, backgroundScriptFunction) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: backgroundScriptFunction, searchQuery },
      (response) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else if (response && response.success) {
            resolve(response.results);
        } else {
            reject(response?.error || "Unknown error");
        }
      }
    );
  });
}

async function fetchDiscogsFullSizeImageUrl(discogsReleaseLink) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetchDiscogsImageUrl', discogsReleaseLink },
      (response) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else if (response && response.success) {
            resolve(response.url);
        } else {
            reject(response?.error || "Unknown error");
        }
      }
    );
  });
}

async function getImageDimensionsFromBlob(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.width, height: img.height });
            URL.revokeObjectURL(img.src); // cleanup
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
    });
}

function scrollAndFocusUploadButton() {
    const uploadButtonContainer = document.querySelector('.form-submit');
    lastfmUploadButton.firstElementChild.innerText = 'Upload Image (↩)';
    document.addEventListener("scrollend", () => lastfmUploadButton.focus(), { once: true });
    setTimeout(() => uploadButtonContainer.scrollIntoView({ behavior: 'smooth', block: 'end' }), 500)
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
        ...(userSettings?.settings ?? {})
    };
}

async function getConstants() {
    return await (await fetch(chrome.runtime.getURL('json/constants.json'))).json();
}

async function saveSettings(newSettings) {
    return new Promise((resolve) =>
        chrome.storage.sync.set({ settings: newSettings }, resolve)
    );
}

function initializeUploadCounting() {
    // Use a more robust initialization check with timestamp
    const initKey = 'lfmmafCountingInitialized';
    const now = Date.now();
    const lastInit = window[initKey];
    
    // Prevent multiple initializations within 5 seconds
    if (lastInit && (now - lastInit) < 5000) {
        extensionLog('Upload counting recently initialized, skipping.');
        return;
    }
    
    window[initKey] = now;
    extensionLog('Initializing upload counting with timestamp:', now);
    
    const currentPageUrl = window.location.href;
    
    // Check if we're already on a successful upload page when script loads
    if (currentPageUrl.includes('/+images/') && !currentPageUrl.includes('/upload')) {
        const imageId = currentPageUrl.split('/').pop();
        if (imageId && !hasBeenCounted(imageId)) {
            setTimeout(() => incrementFixedArtworksCounter(imageId), 100);
        }
    }
    
    // Monitor for navigation to successful upload pages (only once globally)
    const observer = new MutationObserver(() => {
        const newUrl = window.location.href;
        if (newUrl.includes('/+images/') && !newUrl.includes('/upload')) {
            const imageId = newUrl.split('/').pop();
            if (imageId && !hasBeenCounted(imageId)) {
                setTimeout(() => incrementFixedArtworksCounter(imageId), 100);
            }
        }
    });
    
    observer.observe(document, { childList: true, subtree: true });
    
    // Also monitor for popstate events (only once globally)
    window.addEventListener('popstate', () => {
        const newUrl = window.location.href;
        if (newUrl.includes('/+images/') && !newUrl.includes('/upload')) {
            const imageId = newUrl.split('/').pop();
            if (imageId && !hasBeenCounted(imageId)) {
                setTimeout(() => incrementFixedArtworksCounter(imageId), 100);
            }
        }
    });
}

function incrementFixedArtworksCounter(imageId) {
    // Use a more robust locking mechanism with timeout
    const lockKey = 'lfmmafCountingLock';
    const lockTimeout = 10000; // 10 seconds timeout
    const now = Date.now();
    const currentLock = window[lockKey];
    
    // Check if lock exists and hasn't timed out
    if (currentLock && (now - currentLock) < lockTimeout) {
        extensionLog(`Counting locked, skipping increment for ${imageId}`);
        return;
    }
    
    // Set lock with timestamp
    window[lockKey] = now;
    
    // Double-check to prevent race conditions
    if (hasBeenCounted(imageId)) {
        extensionLog(`Image ${imageId} already counted, skipping.`);
        delete window[lockKey];
        return;
    }
    
    // Store the image ID to prevent double counting
    markAsCounted(imageId);
    
    // Get fresh settings to avoid stale data
    getSettings().then(freshSettings => {
        const newCount = freshSettings.userFixedArtworksCount + 1;
        const updatedSettings = { ...freshSettings, userFixedArtworksCount: newCount };
        saveSettings(updatedSettings).then(() => {
            settings = updatedSettings; // Update local copy
            extensionLog(`Incremented fixed artworks counter for image ID: ${imageId}. New count: ${newCount}`);
            delete window[lockKey]; // Clear lock
        }).catch(error => {
            extensionError('Failed to save settings after incrementing counter:', error);
            delete window[lockKey]; // Clear lock even on error
        });
    });
}

function hasBeenCounted(imageId) {
    const countedImages = JSON.parse(localStorage.getItem('lfmmaf-counted-images') || '[]');
    return countedImages.includes(imageId);
}

function markAsCounted(imageId) {
    const countedImages = JSON.parse(localStorage.getItem('lfmmaf-counted-images') || '[]');
    if (!countedImages.includes(imageId)) {
        countedImages.push(imageId);
        // Keep only last 1000 entries to prevent localStorage bloat
        if (countedImages.length > 1000) {
            countedImages.splice(0, countedImages.length - 1000);
        }
        localStorage.setItem('lfmmaf-counted-images', JSON.stringify(countedImages));
    }
}

// Store interval ID for cleanup
let pageCheckInterval;

// Cleanup function
const cleanup = () => {
    if (pageCheckInterval) {
        clearInterval(pageCheckInterval);
        pageCheckInterval = null;
        extensionLog("Page check interval cleared");
    }
};

// Clean up when page is unloaded
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

pageCheckInterval = setInterval(() => {
    chooseFileContainer = document.querySelector('.form-group--image');
    artworkWidgetContainer = document.getElementById('lfmmaf-widget');
    lastfmArtist = document.querySelector("span[itemprop=byArtist] span[itemprop=name]")?.textContent?.trim();
    lastfmAlbum = document.querySelector("h1.header-new-title[itemprop=name]")?.textContent?.trim();

    if (chooseFileContainer && !artworkWidgetContainer) {
        if (!lastfmAlbum?.length || !lastfmArtist?.length) {
            extensionLog('Either artist or album is missing from page, this could be a non-album upload page. Skipping injection.');
            return;
        }
        extensionLog("Found artwork upload form, initiating script.")
        uploadArtworkPage();
    }
}, 1000);

function initializeAutoCloseOnSubmit() {
    // Monitor for successful form submission and redirect
    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;
        
        // Check if we've been redirected to a successful upload page
        if (currentUrl.includes('/+images/') && !currentUrl.includes('/upload')) {
            extensionLog('Successful upload detected, closing tab in 2 seconds...');
            
            // Close the tab after a short delay to allow user to see success
            setTimeout(() => {
                window.close();
            }, 2000);
            
            // Stop observing once we detect success
            observer.disconnect();
        }
    });
    
    // Start observing for URL changes
    observer.observe(document, { childList: true, subtree: true });
    
    // Also listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
        const currentUrl = window.location.href;
        if (currentUrl.includes('/+images/') && !currentUrl.includes('/upload')) {
            extensionLog('Successful upload detected via navigation, closing tab in 2 seconds...');
            setTimeout(() => {
                window.close();
            }, 2000);
        }
    });
    
    // Clean up observer when page unloads
    window.addEventListener('beforeunload', () => {
        observer.disconnect();
    });
}