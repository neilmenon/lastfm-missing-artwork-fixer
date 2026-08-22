async function missingArtworkIdentifier() {
    settings = await getSettings();
    constants = await getConstants();

    if (!settings.highlightMissingArtworks && !settings.highlightMissingArtistImages) {
        extensionLog("Highlighting of missing images has been disabled in extension settings. Exiting here.");
        return;
    }

    let missingImagesSelectors = [];

    if (settings.highlightMissingArtworks) {
        missingImagesSelectors.push(`img[src*="${constants.missingArtworkImageId}"]`);
    }

    if (settings.highlightMissingArtistImages) {
        missingImagesSelectors.push(`img[src*="${constants.missingArtistImageId}"]:not(span.gallery-preview-missing-image > img)`);
    }

    const lastfmLinkSelector = 'a[href*="/music/"]:not(a[href*="/library/music/"])';

    setInterval(async () => {
        const imageElementsMissingArtwork = document.querySelectorAll(
            missingImagesSelectors.map(s => `${s}:not(.lfmmaf-missing-artwork)`).join(', ')
        );
        for (const element of imageElementsMissingArtwork) {
            element.classList.add('lfmmaf-missing-artwork');

            const lastfmLink = element.closest(lastfmLinkSelector)
                ?? element.parentElement?.querySelector(lastfmLinkSelector)
                ?? element.parentElement?.parentElement?.querySelector(lastfmLinkSelector)
                ?? element.parentElement?.parentElement?.parentElement?.querySelector(lastfmLinkSelector)
            ;

            if (!lastfmLink) {
                extensionError("Unable to find album or artist link for missing artwork image!", element);
            }

            const missingArtworkAddButtonElement = document.createElement('div');
            missingArtworkAddButtonElement.innerHTML = `
                <button class="lfmmaf-missing-artwork-button${element.width < 75 ? ' lfmmaf-btn-small' : ''}" title="Fix this missing artwork" data-lfmmaf-lastfm-link="${lastfmLink}">
                    <img src="${constants.lastfmIconUrls.add}">
                </button>
            `

            element.parentElement.appendChild(missingArtworkAddButtonElement);
        }

        const totalUnfixedArtworks = document.querySelectorAll(missingImagesSelectors.join(', ')).length;

        if (imageElementsMissingArtwork.length) {
            extensionLog(`Found and highlighted ${imageElementsMissingArtwork.length} missing artwork entries.`);
        }

        if ((imageElementsMissingArtwork.length && settings.autoFocusOnPageLoad) || settings.autoFocusNextPageButton) {
            await new Promise(resolve => setTimeout(resolve, 100));
            focusNextMissingArtworkButton();
        }

        chrome.runtime.sendMessage({ action: "setBadgeText", text: `${totalUnfixedArtworks}` });
        chrome.runtime.sendMessage({ action: "setTitle", text: `${totalUnfixedArtworks} missing artwork(s) on this page.` });
    }, 1000);

    document.addEventListener('click', (event) => {
        if (event.target.matches('.lfmmaf-missing-artwork-button')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            const clickedButtonLastfmLink = event.target?.dataset?.lfmmafLastfmLink;
            extensionLog(`User clicked add button on missing artwork image with URL: ${clickedButtonLastfmLink}`);
            const imageUploadLink = clickedButtonLastfmLink + (clickedButtonLastfmLink.includes('/_/') ? '' : '/+images/upload');
            const uploadTab = window.open(imageUploadLink, '_blank');

            if (clickedButtonLastfmLink.includes('/_/')) {
                return;
            }

            const checkInterval = setInterval(() => {
                extensionLog(`Polling for new tab ${imageUploadLink} image upload and/or closure.`)
                try {
                    const stillOnUploadPageIndicators = ['/+images/upload', '/+images/image-upload'];
                    const isOnUploadedImagePage = !stillOnUploadPageIndicators.some(i => uploadTab.location.href.includes(i)) && uploadTab.location.href.includes('/+images/')

                    if (isOnUploadedImagePage) {
                        const imageIDUploaded = uploadTab.location.href?.split('/').pop();
                        
                        if (!uploadTab.closed && settings.autoCloseUploadTabWhenArtworkUploaded) {
                            uploadTab.close();
                        }

                        const buttonElementsMatchingThisItem = document.querySelectorAll(`.lfmmaf-missing-artwork-button[data-lfmmaf-lastfm-link="${clickedButtonLastfmLink}"]`);
                        for (const buttonElement of buttonElementsMatchingThisItem) {
                            buttonElement.parentElement.previousElementSibling.src = `${constants.lastfmCdnUrl}${imageIDUploaded}.jpg`;
                            buttonElement.parentElement.previousElementSibling.classList.add('lfmmaf-missing-artwork-fixed');
                            buttonElement.firstElementChild.src = constants.lastfmIconUrls.accept;
                            buttonElement.classList.add('lfmmaf-selected');
                        }
                    }
                    
                    if (uploadTab.closed || isOnUploadedImagePage) {
                        extensionLog("User uploaded an image in the new tab and/or closed the tab.");
                        setTimeout(() => focusNextMissingArtworkButton(isOnUploadedImagePage ? null : clickedButtonLastfmLink), 250);
                        clearInterval(checkInterval);
                    }
                } catch (err) { }
            }, 2000);
        }
    }, true);
}

function focusNextMissingArtworkButton(previousLink = null) {
    const seenLastfmLinks = new Set();
    const missingArtworkButtons = Array.from(document.querySelectorAll('.lfmmaf-missing-artwork-button')).filter(button => {
        const lastfmLink = button.getAttribute('data-lfmmaf-lastfm-link');
        if (lastfmLink != null) {
            if (seenLastfmLinks.has(lastfmLink)) {
                return false;
            }
            seenLastfmLinks.add(lastfmLink);
        }
        return true;
    });

    const indexofLastSelectedButton = previousLink ? 
        missingArtworkButtons.findIndex(button => button.getAttribute('data-lfmmaf-lastfm-link') === previousLink) :
        missingArtworkButtons.findLastIndex(button => button.classList.contains('lfmmaf-selected'))
    ;
    const nextMissingArtworkButton = missingArtworkButtons.at(indexofLastSelectedButton + 1);
    const nextPageInPagination = document.querySelector('li[aria-current="page"] + li.pagination-page > a');
    const buttonToFocus = nextMissingArtworkButton ?? (settings.autoFocusNextPageButton ? nextPageInPagination : null);

    if (document.activeElement === buttonToFocus) {
        return;
    }

    if (buttonToFocus) {
        const focusFunction = () => buttonToFocus.focus();
        document.addEventListener('scrollend', focusFunction, { once: true });
        const currentY = window.scrollY;
        setTimeout(() => {
            if (window.scrollY === currentY) {
                focusFunction();
                removeEventListener('scrollend', focusFunction);
            }
        }, 250);
        setTimeout(() => buttonToFocus.scrollIntoView({ behavior: 'smooth', block: 'center' }), 10);
    }
}

missingArtworkIdentifier();