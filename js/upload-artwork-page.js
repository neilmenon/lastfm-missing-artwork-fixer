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

    await injectArtworkWidget();

    injectDefaultSearchQuery()

    executeSearchAndDisplayResults();

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
        
        // Update the clicked button to show success state
        clickedElement.classList.add('lfmmaf-selected');
        clickedElement.innerHTML = `<img src="${constants.lastfmIconUrls.accept}">`;
        
        scrollAndFocusUploadButton();
    } catch (e) {
        extensionError("Error while fetching or attaching image.", e)
        showMessage("There was an issue downloading and/or attaching the image to Last.fm. Please try again.", 'danger')
        return;
    } finally {
        hideLoadingPulse();
    }
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
    // Removed console.log for production
}

function extensionError(message, error) {
    // Removed console.error for production
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
    // Use a more robust initialization check with unique key per tab
    const initKey = `lfmmafCountingInitialized_${Date.now()}_${Math.random()}`;
    
    // Prevent multiple initializations in the same tab
    if (window.lfmmafCountingActive) {
        return;
    }
    
    window.lfmmafCountingActive = true;
    
    // Function to check and count if on success page
    const checkAndCount = (source) => {
        const currentUrl = window.location.href;
        
        if (currentUrl.includes('/+images/') && !currentUrl.includes('/upload')) {
            const urlParts = currentUrl.split('/');
            const imageId = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
            
            // More flexible image ID validation - allow alphanumeric IDs
            if (imageId && imageId.length > 0 && !hasBeenCounted(imageId)) {
                incrementFixedArtworksCounter(imageId);
            }
        }
    };
    
    // Check immediately if we're already on a successful upload page
    checkAndCount('initial-load');
    
    // Monitor URL changes more reliably using multiple methods
    let lastUrl = window.location.href;
    
    // Method 1: MutationObserver for DOM changes
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            checkAndCount('mutation-observer');
        }
    });
    observer.observe(document, { childList: true, subtree: true });
    
    // Method 2: Interval checking (fallback)
    const urlCheckInterval = setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            checkAndCount('interval-check');
        }
    }, 500);
    
    // Method 3: PopState events
    window.addEventListener('popstate', () => {
        setTimeout(() => checkAndCount('popstate'), 50);
    });
    
    // Method 4: HashChange events
    window.addEventListener('hashchange', () => {
        setTimeout(() => checkAndCount('hashchange'), 50);
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        observer.disconnect();
        clearInterval(urlCheckInterval);
        window.lfmmafCountingActive = false;
    });
}

function incrementFixedArtworksCounter(imageId) {
    // Use image-specific locking to prevent double counting the same image
    const lockKey = `lfmmafCountingLock_${imageId}`;
    const lockTimeout = 5000; // 5 seconds timeout per image
    const now = Date.now();
    const currentLock = window[lockKey];
    
    // Check if this specific image is already being processed
    if (currentLock && (now - currentLock) < lockTimeout) {
        return;
    }
    
    // Set lock for this specific image
    window[lockKey] = now;
    
    // Double-check to prevent race conditions
    if (hasBeenCounted(imageId)) {
        delete window[lockKey];
        return;
    }
    
    // Store the image ID immediately to prevent double counting
    markAsCounted(imageId);
    
    // Get fresh settings to avoid stale data
    getSettings().then(freshSettings => {
        const currentCount = freshSettings.userFixedArtworksCount || 0;
        const newCount = currentCount + 1;
        const updatedSettings = { ...freshSettings, userFixedArtworksCount: newCount };
        
        return saveSettings(updatedSettings).then(() => {
            settings = updatedSettings; // Update local copy
            
            // Clear lock after successful save
            setTimeout(() => {
                delete window[lockKey];
            }, 1000);
            
            return newCount;
        });
    }).catch(error => {
        extensionError(`Failed to increment counter for image ${imageId}:`, error);
        
        // On error, remove from counted list so it can be retried
        const countedImages = JSON.parse(localStorage.getItem('lfmmaf-counted-images') || '[]');
        const index = countedImages.indexOf(imageId);
        if (index > -1) {
            countedImages.splice(index, 1);
            localStorage.setItem('lfmmaf-counted-images', JSON.stringify(countedImages));
        }
        
        // Clear lock even on error
        delete window[lockKey];
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
            return;
        }
        uploadArtworkPage();
    }
}, 1000);

function initializeAutoCloseOnSubmit() {
    // Monitor for successful form submission and redirect
    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;
        
        // Check if we've been redirected to a successful upload page
        if (currentUrl.includes('/+images/') && !currentUrl.includes('/upload')) {
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