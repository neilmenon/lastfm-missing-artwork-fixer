let settings, themeLink;

async function initForm() {
    settings = await getSettings();

    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    const artworkSelect = document.getElementById('selectedArtworkSource');
    settings.artworkSourceOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.name;
        opt.textContent = option.name;
        if (option.name === settings.selectedArtworkSource) {
            opt.selected = true;
        }
        artworkSelect.appendChild(opt);
    });

    const countrySelect = document.getElementById('selectedCountry');
    settings.countryOptions.forEach(optData => {
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

    const extensionThemeRadio = document.querySelector(`input[name="extensionTheme"][value="${settings.extensionTheme}"]`);
    if (extensionThemeRadio) {
      extensionThemeRadio.checked = true;
    }
    document.getElementById('userFixedArtworksCount').innerText = `${settings.userFixedArtworksCount}`;

    let debounceTimeout;

    document.getElementById('settingsForm').addEventListener('change', () => {
        clearTimeout(debounceTimeout);

        debounceTimeout = setTimeout(async () => {
            document.getElementById('selectedArtworkSize').classList.remove('is-invalid');
            const newSettings = {
                ...settings,
                selectedArtworkSource: artworkSelect.value,
                selectedCountry: countrySelect.value,
                selectedArtworkSize: parseInt(document.getElementById('selectedArtworkSize').value, 10),
                populateTitleField: document.getElementById('populateTitleField').checked,
                populateDescriptionField: document.getElementById('populateDescriptionField').checked,
                highlightMissingArtworks: document.getElementById('highlightMissingArtworks').checked,
                autoCloseUploadTabWhenArtworkUploaded: document.getElementById('autoCloseUploadTabWhenArtworkUploaded').checked
            };

            if (newSettings.selectedArtworkSize < 800 || newSettings.selectedArtworkSize > 10000) {
                document.getElementById('selectedArtworkSize').classList.add('is-invalid');
                return;
            }
    
            await saveSettings(newSettings);
        }, 100);
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

function loadTheme() {
    const themeBySystemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'darkly' : 'flatly';
    themeLink.href = `https://bootswatch.com/5/${ settings.extensionTheme === 'auto' ? themeBySystemPreference : settings.extensionTheme }/bootstrap.min.css`;
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