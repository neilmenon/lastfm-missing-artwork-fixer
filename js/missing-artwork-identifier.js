async function missingArtworkIdentifier() {
    settings = await getSettings();

    if (!settings.highlightMissingArtworks) {
        extensionLog("Highlighting of missing artworks has been disabled in extension settings. Exiting here.");
        return;
    }

    const albumLinkSelector = 'a[href*="/music/"]';

    setInterval(() => {
        const imageElementsMissingArtwork = document.querySelectorAll(`img[src*="${settings.missingArtworkImageId}"]:not(.lfmmaf-missing-artwork)`);
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
        }

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

            if (settings.autoCloseUploadTabWhenArtworkUploaded) {
                const checkInterval = setInterval(() => {
                    extensionLog("Checking if new tab has been closed...")
                    try {
                        if (uploadTab.closed) {
                            clearInterval(checkInterval);
                            extensionLog("Tab manually closed by user.")
                            return;
                        }
    
                        if (!uploadTab.location.href.includes('/+images/upload') && uploadTab.location.href.includes('/+images/')) {
                            const imageIDUploaded = uploadTab.location.href?.split('/').pop();
                            clearInterval(checkInterval);
                            uploadTab.close();

                            const buttonElementsMatchingThisAlbum = document.querySelectorAll(`.lfmmaf-missing-artwork-button[data-lfmmaf-album-link="${clickedButtonAlbumLink}"]`);
                            for (const buttonElement of buttonElementsMatchingThisAlbum) {
                                buttonElement.parentElement.previousElementSibling.src = `https://lastfm.freetls.fastly.net/i/u/300x300/${imageIDUploaded}.jpg`;
                                buttonElement.parentElement.previousElementSibling.classList.add('lfmmaf-missing-artwork-fixed');
                                buttonElement.firstElementChild.src = 'https://www.last.fm/static/images/icons/accept_fff_16.png';
                                buttonElement.classList.add('lfmmaf-selected');
                            }

                        }
                    } catch (err) { }
                }, 2000);
            }
        }
    }, true);
}

missingArtworkIdentifier();