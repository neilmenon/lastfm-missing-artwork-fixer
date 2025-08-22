let settings, constants, manifest, themeLink;

async function initForm() {
    settings = await getSettings();
    constants = await getConstants();
    manifest = await getManifest();
    document.getElementById('extensionVersion').innerText = `v${manifest.version}`;
    document.getElementById('extensionVersion').href = `https://github.com/neilmenon/lastfm-missing-artwork-fixer/releases/tag/${manifest.version}`;

    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

    const artworkSelect = document.getElementById('selectedArtworkSource');
    constants.artworkSourceOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.name;
        opt.textContent = option.name;
        if (option.name === settings.selectedArtworkSource) {
            opt.selected = true;
        }
        artworkSelect.appendChild(opt);
    });

    const countrySelect = document.getElementById('selectedCountry');
    constants.countryOptions.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.value;
        opt.textContent = optData.label;
        if (optData.value === settings.selectedCountry) {
            opt.selected = true;
        }
        countrySelect.appendChild(opt);
    });

    document.getElementById('selectedArtworkSize').value = settings.selectedArtworkSize;
    document.getElementById('populateTitleField').checked = settings.populateTitleField;
    document.getElementById('populateDescriptionField').checked = settings.populateDescriptionField;
    document.getElementById('highlightMissingArtworks').checked = settings.highlightMissingArtworks;
    document.getElementById('autoCloseUploadTabWhenArtworkUploaded').checked = settings.autoCloseUploadTabWhenArtworkUploaded;
    document.getElementById('autoFocusNextMissingArtworkButton').checked = settings.autoFocusNextMissingArtworkButton;
    document.getElementById('autoFocusOnPageLoad').checked = settings.autoFocusOnPageLoad;

    const extensionThemeRadio = document.querySelector(`input[name="extensionTheme"][value="${settings.extensionTheme}"]`);
    if (extensionThemeRadio) {
      extensionThemeRadio.checked = true;
    }
    
    document.getElementById('userFixedArtworksCount').innerText = `${settings.userFixedArtworksCount}`;

    // Check for missing artworks on current page and show bulk open button
    setTimeout(() => {
        chrome.runtime.sendMessage({ action: "getMissingArtworkUrls" }, (response) => {
            const urls = response?.urls || [];
            const openAllButtonMain = document.getElementById('openAllMissingArtworksMain');
            const missingArtworkCount = document.getElementById('missingArtworkCount');
            const missingArtworkCountMain = document.getElementById('missingArtworkCountMain');
            
            if (missingArtworkCount) missingArtworkCount.textContent = urls.length;
            if (missingArtworkCountMain) missingArtworkCountMain.textContent = urls.length;
            
            if (urls.length > 0) {
                if (openAllButtonMain) {
                    openAllButtonMain.style.display = 'block';
                    openAllButtonMain.disabled = false;
                }
            } else {
                if (openAllButtonMain) {
                    openAllButtonMain.style.display = 'block';
                    openAllButtonMain.disabled = true;
                    openAllButtonMain.innerHTML = '<i class="bi bi-box-arrow-up-right"></i> No Missing Artworks Found';
                }
            }
        });
    }, 500);

    document.getElementById('saveSettingsButton').addEventListener('click', async (event) => {
        event.preventDefault();
        
        document.getElementById('selectedArtworkSize').classList.remove('is-invalid');

        const artworkSizeValue = parseInt(document.getElementById('selectedArtworkSize').value, 10);
        
        // Validate artwork size before creating settings object
        if (isNaN(artworkSizeValue) || artworkSizeValue < 800 || artworkSizeValue > 10000) {
            document.getElementById('selectedArtworkSize').classList.add('is-invalid');
            return;
        }

        const newSettings = {
            ...settings,
            selectedArtworkSource: artworkSelect.value,
            selectedCountry: countrySelect.value,
            selectedArtworkSize: artworkSizeValue,
            populateTitleField: document.getElementById('populateTitleField').checked,
            populateDescriptionField: document.getElementById('populateDescriptionField').checked,
            highlightMissingArtworks: document.getElementById('highlightMissingArtworks').checked,
            autoCloseUploadTabWhenArtworkUploaded: document.getElementById('autoCloseUploadTabWhenArtworkUploaded').checked,
            autoFocusNextMissingArtworkButton: document.getElementById('autoFocusNextMissingArtworkButton').checked,
            autoFocusOnPageLoad: document.getElementById('autoFocusOnPageLoad').checked,
        };

        await saveSettings(newSettings);

        event.target.classList.add('disabled');
        event.target.innerHTML = '<i class="bi bi-check-lg"></i> Settings saved';
        await new Promise(res => setTimeout(res, 1500));
        event.target.classList.remove('disabled');
        event.target.innerHTML = 'Save settings';
    });

    document.querySelectorAll('input[name="extensionTheme"]').forEach((radio) => {
        radio.addEventListener('change', (event) => {
            if (event.target.checked) {
                const selectedTheme = event.target.value;
                settings = { ...settings, extensionTheme: selectedTheme };
                saveSettings(settings);
                loadTheme();
            }
        });
    });

    // Handle bulk open all missing artworks
    const openAllHandler = () => {
        chrome.runtime.sendMessage({ action: "openAllMissingArtworks" });
        // Close popup after opening tabs
        setTimeout(() => window.close(), 100);
    };
    
    const openAllButtonMain = document.getElementById('openAllMissingArtworksMain');
    if (openAllButtonMain) {
        openAllButtonMain.addEventListener('click', openAllHandler);
    }
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

async function getManifest() {
    return await (await fetch(chrome.runtime.getURL('manifest.json'))).json();
}

async function saveSettings(newSettings) {
    return new Promise((resolve) =>
        chrome.storage.sync.set({ settings: newSettings }, resolve)
    );
}

function loadTheme() {
    const themeBySystemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'darkly' : 'flatly';
    themeLink.href = `/js/vendor/bootstrap-${ settings.extensionTheme === 'auto' ? themeBySystemPreference : settings.extensionTheme }.min.css`;
}

async function main() {
    await initForm();

    // Theme Loader
    const head = document.head || document.getElementsByTagName('head')[0];
    
    themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', loadTheme);
    
    loadTheme();
    head.appendChild(themeLink);
}


main();