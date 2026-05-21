let settings, constants, manifest, themeLink;

async function initialize() {
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
    document.getElementById('autoFocusNextPageButton').checked = settings.autoFocusNextPageButton;
    document.getElementById('publishToLeaderboard').checked = settings.publishToLeaderboard;

    const extensionThemeRadio = document.querySelector(`input[name="extensionTheme"][value="${settings.extensionTheme}"]`);
    if (extensionThemeRadio) {
      extensionThemeRadio.checked = true;
    }
    
    document.getElementById('userFixedArtworksCount').innerText = settings.userFixedArtworksCount?.toLocaleString();

    document.getElementById('saveSettingsButton').addEventListener('click', async (event) => {
        event.preventDefault();
        
        document.getElementById('selectedArtworkSize').classList.remove('is-invalid');

        const newSettings = {
            ...settings,
            selectedArtworkSource: artworkSelect.value,
            selectedCountry: countrySelect.value,
            // selectedArtworkSize: parseInt(document.getElementById('selectedArtworkSize').value, 10),
            populateTitleField: document.getElementById('populateTitleField').checked,
            populateDescriptionField: document.getElementById('populateDescriptionField').checked,
            highlightMissingArtworks: document.getElementById('highlightMissingArtworks').checked,
            autoCloseUploadTabWhenArtworkUploaded: document.getElementById('autoCloseUploadTabWhenArtworkUploaded').checked,
            autoFocusNextMissingArtworkButton: document.getElementById('autoFocusNextMissingArtworkButton').checked,
            autoFocusOnPageLoad: document.getElementById('autoFocusOnPageLoad').checked,
            autoFocusNextPageButton: document.getElementById('autoFocusNextPageButton').checked,
            publishToLeaderboard: document.getElementById('publishToLeaderboard').checked,
        };

        if (newSettings.selectedArtworkSize < 800 || newSettings.selectedArtworkSize > 10000) {
            document.getElementById('selectedArtworkSize').classList.add('is-invalid');
            return;
        }

        event.target.classList.add('disabled');
        event.target.innerHTML = 'Saving...';

        await saveSettings(newSettings);

        if (!newSettings.publishToLeaderboard && settings.username) {
            try {
                await performLeaderboardOperation("deleteFromLeaderboard", { username: settings.username });
            } catch (error) {
                console.error("Error removing user from leaderboard:", error);
            }
        }
        
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

    document.getElementById('leaderboardTab').addEventListener('shown.bs.tab', async (event) => {
        settings = await getSettings();
        const leaderboardTableContainer = document.getElementById('leaderboardTableContainer');
        leaderboardTableContainer.innerHTML = `
            <div class="text-center">
                <output class="spinner-border spinner-border-sm" role="status"></output>
            </div>
        `;

        let leaderboardResults;
        try {
            leaderboardResults = await performLeaderboardOperation("fetchLeaderboard");
        } catch (error) {
            console.error("Error fetching leaderboard data:", error);
            leaderboardTableContainer.innerHTML = `
                <div class="text-center" role="alert">
                    <em>Failed to load leaderboard data. This is usually temporary. Please re-open popup and try again.</em>
                </div>
            `;
            return;
        }

        if ((leaderboardResults?.length ?? 0) >= 0) {
            leaderboardTableContainer.innerHTML = `
                <table class="table table-striped table-hover table-sm table-responsive">
                    <thead>
                        <tr>
                            <th scope="col">#</th>
                            <th scope="col">Last.fm Username</th>
                            <th scope="col">Artworks Fixed</th>
                            <th scope="col">Last Fixed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            leaderboardResults.map((entry, index) => `
                                <tr>
                                    <th scope="row">${index + 1}</th>
                                    <td><a href="https://www.last.fm/user/${entry.username}" target="_blank" class="text-secondary ${entry.username == settings.username ? ' fw-bold' : ''}" title="Open Last.fm profile">${entry.username}</a></td>
                                    <td>${entry.artworksFixed.toLocaleString()}</td>
                                    <td>${moment.unix(entry.lastFixed).fromNow()}</td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                    <tfoot>
                        <tr>
                            <th scope="row"></th>
                            <td></td>
                            <td>${leaderboardResults.reduce((sum, entry) => sum + entry.artworksFixed, 0).toLocaleString()} total</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            `
        }
    }, { once: false});
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

async function performLeaderboardOperation(operation, payload = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: operation, payload },
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

function loadTheme() {
    const themeBySystemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'darkly' : 'flatly';
    themeLink.href = `/js/vendor/bootstrap-${ settings.extensionTheme === 'auto' ? themeBySystemPreference : settings.extensionTheme }.min.css`;
}

async function main() {
    await initialize();

    // Theme Loader
    const head = document.head || document.getElementsByTagName('head')[0];
    
    themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', loadTheme);
    
    loadTheme();
    head.appendChild(themeLink);
}


main();