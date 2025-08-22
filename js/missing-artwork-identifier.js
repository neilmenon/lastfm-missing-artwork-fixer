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
                // For track URLs with /_/, convert to album URL format for upload
                const uploadUrl = albumLink.includes('/_/') 
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

missingArtworkIdentifier();