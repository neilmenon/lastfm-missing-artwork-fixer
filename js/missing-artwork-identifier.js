async function missingArtworkIdentifier() {
    settings = await getSettings();
    constants = await getConstants();

    if (!settings.highlightMissingArtworks) {
        extensionLog("Highlighting of missing artworks has been disabled in extension settings. Exiting here.");
        return;
    }

    const albumLinkSelector = 'a[href*="/music/"]';

    setInterval(async () => {
        const imageElementsMissingArtwork = document.querySelectorAll(`img[src*="${constants.missingArtworkImageId}"]:not(.lfmmaf-missing-artwork)`);
        for (const element of imageElementsMissingArtwork) {
            element.classList.add('lfmmaf-missing-artwork');

            const albumLink = element.closest(albumLinkSelector)
                ?? element.parentElement?.querySelector(albumLinkSelector)
                ?? element.parentElement?.parentElement?.querySelector(albumLinkSelector)
                ?? element.parentElement?.parentElement?.parentElement?.querySelector(albumLinkSelector)
            ;

            if (!albumLink) {
                extensionError("Unable to find album link for missing artwork image!", element);
            }

            const missingArtworkAddButtonElement = document.createElement('div');
            missingArtworkAddButtonElement.innerHTML = `
                <button class="lfmmaf-missing-artwork-button${element.width < 75 ? ' lfmmaf-btn-small' : ''}" title="Fix this missing artwork" data-lfmmaf-album-link="${albumLink}">
                    <img src="https://www.last.fm/static/images/icons/add_fff_16.png">
                </button>
            `

            element.parentElement.appendChild(missingArtworkAddButtonElement);
        }

        if (imageElementsMissingArtwork.length) {
            extensionLog(`Found and highlighted ${imageElementsMissingArtwork.length} missing artwork entries.`);
            if (settings.autoFocusOnPageLoad) {
                await new Promise(resolve => setTimeout(resolve, 100));
                focusNextMissingArtworkButton(true);
            }
        }

        const totalUnfixedArtworks = document.querySelectorAll(`img[src*="${constants.missingArtworkImageId}"]`).length;
        chrome.runtime.sendMessage({ action: "setBadgeText", text: `${totalUnfixedArtworks}` });
        chrome.runtime.sendMessage({ action: "setTitle", text: `${totalUnfixedArtworks} missing artwork(s) on this page.` });
    }, 1000);

    document.addEventListener('click', (event) => {
        if (event.target.matches('.lfmmaf-missing-artwork-button')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            const clickedButtonAlbumLink = event.target?.dataset?.lfmmafAlbumLink;
            extensionLog(`User clicked add button on missing artwork image with URL: ${clickedButtonAlbumLink}`);
            const imageUploadLink = clickedButtonAlbumLink + (clickedButtonAlbumLink.includes('/_/') ? '' : '/+images/upload');
            const uploadTab = window.open(imageUploadLink, '_blank');

            if (clickedButtonAlbumLink.includes('/_/')) {
                return;
            }

            const checkInterval = setInterval(() => {
                extensionLog(`Polling for new tab ${imageUploadLink} image upload and/or closure.`)
                try {
                    const isOnUploadedImagePage = !uploadTab.location.href.includes('/+images/upload') && uploadTab.location.href.includes('/+images/')

                    if (isOnUploadedImagePage) {
                        const imageIDUploaded = uploadTab.location.href?.split('/').pop();
                        
                        if (!uploadTab.closed && settings.autoCloseUploadTabWhenArtworkUploaded) {
                            uploadTab.close();
                        }

                        const buttonElementsMatchingThisAlbum = document.querySelectorAll(`.lfmmaf-missing-artwork-button[data-lfmmaf-album-link="${clickedButtonAlbumLink}"]`);
                        for (const buttonElement of buttonElementsMatchingThisAlbum) {
                            buttonElement.parentElement.previousElementSibling.src = `https://lastfm.freetls.fastly.net/i/u/300x300/${imageIDUploaded}.jpg`;
                            buttonElement.parentElement.previousElementSibling.classList.add('lfmmaf-missing-artwork-fixed');
                            buttonElement.firstElementChild.src = 'https://www.last.fm/static/images/icons/accept_fff_16.png';
                            buttonElement.classList.add('lfmmaf-selected');
                        }

                        if (settings.autoFocusNextMissingArtworkButton) {
                            setTimeout(() => focusNextMissingArtworkButton(), 250);
                        }
                    }
                    
                    if (uploadTab.closed || isOnUploadedImagePage) {
                        extensionLog("User uploaded an image in the new tab and/or closed the tab.");
                        clearInterval(checkInterval);
                    }
                } catch (err) { }
            }, 2000);
        }
    }, true);
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