async function missingArtworkIdentifier() {
    settings = await getSettings();
    constants = await getConstants();

    if (!settings.highlightMissingArtworks) {
        return;
    }

    const albumLinkSelector = 'a[href*="/music/"]';
    
    // Store interval ID for cleanup
    let scanInterval;
    
    // Cleanup function
    const cleanup = () => {
        if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = null;
        }
    };
    
    // Clean up when page is unloaded
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);

    scanInterval = setInterval(async () => {
        // Get fresh settings each time to ensure we have the latest user preferences
        settings = await getSettings();
        
        const imageElementsMissingArtwork = document.querySelectorAll(`img[src*="${constants.missingArtworkImageId}"]:not(.lfmmaf-missing-artwork), img[src*="${constants.noLastfmAlbumExistsImageId}"]:not(.lfmmaf-missing-artwork)`);
        for (const element of imageElementsMissingArtwork) {
            element.classList.add('lfmmaf-missing-artwork');

            const albumLink = element.closest(albumLinkSelector)
                ?? element.parentElement?.querySelector(albumLinkSelector)
                ?? element.parentElement?.parentElement?.querySelector(albumLinkSelector)
                ?? element.parentElement?.parentElement?.parentElement?.querySelector(albumLinkSelector)
            ;

            // If no album link found, try to get the current page URL for track pages
            const linkToUse = albumLink?.href || window.location.href;
            
            if (!linkToUse || !linkToUse.includes('/music/')) {
                extensionError("Unable to find valid music link for missing artwork image!", element);
                continue;
            }

            // Enhanced check for /_/ URLs to see if artwork already exists elsewhere
            const isUnknownAlbumUrl = linkToUse.includes('/_/');
            if (isUnknownAlbumUrl) {
                const artworkCheck = await checkExistingArtworkForUnknownAlbum(linkToUse);
                if (artworkCheck.hasExistingArtwork) {
                    // Skip this element - artwork already exists for this track
                    console.log(`Skipping /_/ URL ${linkToUse} - artwork exists at ${artworkCheck.trackUrl}`);
                    continue;
                }
            }

            const missingArtworkAddButtonElement = document.createElement('div');
            missingArtworkAddButtonElement.innerHTML = `
                <button class="lfmmaf-missing-artwork-button${element.width < 75 ? ' lfmmaf-btn-small' : ''}" title="Fix this missing artwork" data-lfmmaf-album-link="${linkToUse}">
                    <img src="${constants.lastfmIconUrls.add}">
                </button>
            `

            element.parentElement.appendChild(missingArtworkAddButtonElement);
        }

        if (imageElementsMissingArtwork.length) {
            if (settings.autoFocusOnPageLoad) {
                await new Promise(resolve => setTimeout(resolve, 100));
                focusNextMissingArtworkButton(true);
            }
        }

        // Store missing artwork URLs for bulk opening
        const missingArtworkUrls = [];
        document.querySelectorAll('.lfmmaf-missing-artwork-button').forEach(button => {
            const albumLink = button.dataset?.lfmmafAlbumLink;
            if (albumLink) {
                // Check if this is an unknown album URL (contains /_/)
                const isUnknownAlbumUrl = albumLink.includes('/_/');
                
                // Only include unknown album URLs if the setting is enabled
                if (isUnknownAlbumUrl && !settings.includeUnknownAlbumUrls) {
                    return; // Skip this URL
                }
                
                // For track URLs with /_/, convert to album URL format for upload only if setting is enabled
                const uploadUrl = (isUnknownAlbumUrl && settings.includeUnknownAlbumUrls)
                    ? albumLink.replace('/_/', '/') + '/+images/upload'
                    : albumLink + '/+images/upload';
                if (!missingArtworkUrls.includes(uploadUrl)) {
                    missingArtworkUrls.push(uploadUrl);
                }
            }
        });
        
        // Use deduplicated count for badge and title
        const totalUnfixedArtworks = missingArtworkUrls.length;
        chrome.runtime.sendMessage({ action: "setBadgeText", text: `${totalUnfixedArtworks}` });
        chrome.runtime.sendMessage({ action: "setTitle", text: `${totalUnfixedArtworks} missing artwork(s) on this page.` });
        chrome.runtime.sendMessage({ action: "updateMissingArtworkUrls", urls: missingArtworkUrls });
    }, 1000);

    document.addEventListener('click', (event) => {
        if (event.target.matches('.lfmmaf-missing-artwork-button')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            const clickedButtonAlbumLink = event.target?.dataset?.lfmmafAlbumLink;
            const imageUploadLink = clickedButtonAlbumLink.includes('/_/') 
                ? clickedButtonAlbumLink.replace('/_/', '/') + '/+images/upload'
                : clickedButtonAlbumLink + '/+images/upload';
            
            openAndMonitorUploadTab(imageUploadLink, clickedButtonAlbumLink);
        }
    }, true);

    // Listen for bulk open all message from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "openAllMissingArtworks") {
            const urls = request.urls || [];
            urls.forEach((url, index) => {
                setTimeout(() => {
                    // Extract album link from upload URL
                    const albumLink = url.replace('/+images/upload', '');
                    openAndMonitorUploadTab(url, albumLink);
                }, index * 100);
            });
        }
    });

    function openAndMonitorUploadTab(imageUploadLink, clickedButtonAlbumLink) {
        const uploadTab = window.open(imageUploadLink, '_blank');

        const checkInterval = setInterval(() => {
            try {
                const isOnUploadedImagePage = !uploadTab.location.href.includes('/+images/upload') && uploadTab.location.href.includes('/+images/')

                if (isOnUploadedImagePage) {
                    const imageIDUploaded = uploadTab.location.href?.split('/').pop();
                    
                    if (!uploadTab.closed && settings.autoCloseUploadTabWhenArtworkUploaded) {
                        uploadTab.close();
                    }

                    const buttonElementsMatchingThisAlbum = document.querySelectorAll(`.lfmmaf-missing-artwork-button[data-lfmmaf-album-link="${clickedButtonAlbumLink}"]`);
                    for (const buttonElement of buttonElementsMatchingThisAlbum) {
                        buttonElement.parentElement.previousElementSibling.src = `${constants.lastfmCdnUrl}${imageIDUploaded}.jpg`;
                        buttonElement.parentElement.previousElementSibling.classList.add('lfmmaf-missing-artwork-fixed');
                        buttonElement.firstElementChild.src = constants.lastfmIconUrls.accept;
                        buttonElement.classList.add('lfmmaf-selected');
                    }

                    if (settings.autoFocusNextMissingArtworkButton) {
                        setTimeout(() => focusNextMissingArtworkButton(), 250);
                    }
                }
                
                if (uploadTab.closed || isOnUploadedImagePage) {
                    clearInterval(checkInterval);
                }
            } catch (err) { }
        }, 2000);
    }
}

function focusNextMissingArtworkButton() {
    const seenAlbumLinks = new Set();
    const missingArtworkButtons = Array.from(document.querySelectorAll('.lfmmaf-missing-artwork-button')).filter(button => {
        const albumLink = button.getAttribute('data-lfmmaf-album-link');
        if (albumLink != null) {
            if (seenAlbumLinks.has(albumLink)) {
                return false;
            }
            seenAlbumLinks.add(albumLink);
        }
        return true;
    });
    const indexofLastSelectedButton = missingArtworkButtons.findLastIndex(button => button.classList.contains('lfmmaf-selected'));
    const nextMissingArtworkButton = missingArtworkButtons.at(indexofLastSelectedButton + 1)

    if (nextMissingArtworkButton) {
        const focusFunction = () => nextMissingArtworkButton.focus();
        document.addEventListener('scrollend', focusFunction, { once: true });
        const currentY = window.scrollY;
        setTimeout(() => {
            if (window.scrollY === currentY) {
                focusFunction();
                removeEventListener('scrollend', focusFunction);
            }
        }, 250);
        setTimeout(() => nextMissingArtworkButton.scrollIntoView({ behavior: 'smooth', block: 'center' }), 10);
        return true;
    }
    return false;
}

async function getSettings() {
    const userSettings = await new Promise((resolve) =>
        chrome.storage.sync.get('settings', resolve)
    );
    const defaultSettings = await (await fetch(chrome.runtime.getURL('json/default-settings.json'))).json();
    return {
        ...defaultSettings,
        ...(userSettings?.settings ?? {}),
    };
}

async function getConstants() {
    return await (await fetch(chrome.runtime.getURL('json/constants.json'))).json();
}

async function checkExistingArtworkForUnknownAlbum(trackUrl) {
    try {
        // Convert /_/ URL to direct track URL by removing the /_/ part entirely
        // e.g., https://www.last.fm/music/Jafunk/_/Satisfied -> https://www.last.fm/music/Jafunk/Satisfied
        const urlParts = trackUrl.split('/');
        const musicIndex = urlParts.findIndex(part => part === 'music');
        
        if (musicIndex === -1) return { hasExistingArtwork: false };
        
        // Reconstruct URL without the /_/ part
        const artist = urlParts[musicIndex + 1];
        const track = urlParts[musicIndex + 3]; // Skip the /_/ part at index musicIndex + 2
        
        if (!artist || !track) return { hasExistingArtwork: false };
        
        const directTrackUrl = `https://www.last.fm/music/${artist}/${track}`;
        
        console.log(`Checking /_/ URL: ${trackUrl} -> Direct URL: ${directTrackUrl}`);
        
        // Check if the direct track URL has artwork
        const hasArtwork = await checkTrackHasArtwork(directTrackUrl);
        if (!hasArtwork) {
            // No artwork found - this means the track page shows "Add artwork" message
            return { hasExistingArtwork: true, trackUrl: directTrackUrl };
        }
        
        // Artwork exists - don't skip the /_/ URL
        return { hasExistingArtwork: false };
    } catch (error) {
        console.warn('Error checking existing artwork for unknown album:', error);
        return { hasExistingArtwork: false };
    }
}

async function checkTrackHasArtwork(trackUrl) {
    try {
        const response = await fetch(trackUrl);
        if (!response.ok) return false;
        
        const html = await response.text();
        
        // Check directly in the HTML text for missing artwork indicators
        const htmlLower = html.toLowerCase();
        
        // Look for missing artwork indicators in the raw HTML
        const missingArtworkIndicators = [
            'do you have the artwork for this album',
            'add artwork',
            constants.missingArtworkImageId,
            constants.noLastfmAlbumExistsImageId,
            '2a96cbd8b46e442fc41c2b86b821562f' // Another common missing artwork ID
        ];
        
        for (const indicator of missingArtworkIndicators) {
            if (htmlLower.includes(indicator.toLowerCase())) {
                console.log(`Found missing artwork indicator: ${indicator} in ${trackUrl}`);
                return false; // Missing artwork
            }
        }
        
        // If no missing artwork indicators found, artwork exists
        console.log(`No missing artwork indicators found in ${trackUrl} - assuming artwork exists`);
        return true;
    } catch (error) {
        console.warn('Error checking track artwork:', error);
        return false;
    }
}

missingArtworkIdentifier();