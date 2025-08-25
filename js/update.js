(async () => {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");
  const to = params.get("to");

  const versionInfo = document.getElementById("version-info");
  const releaseLink = document.getElementById("release-link");
  const notes = document.getElementById("releaseNotes");

  if (from && to) {
    versionInfo.innerHTML = `<span class="text-danger">${from}</span> → <span class="text-success">${to}</span>`;
    releaseLink.href = `https://github.com/neilmenon/lastfm-missing-artwork-fixer/releases/tag/${to}`;

    try {
      const res = await fetch(`https://api.github.com/repos/neilmenon/lastfm-missing-artwork-fixer/releases/tags/${to}`);
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const data = await res.json();
      if (data.body) {
        notes.innerHTML = `
          <pre class="p-3 bg-light border rounded">${data.body}</pre>
        `;
      } else {
        notes.innerHTML = '<p class="text-center">No release notes found.</p>';
      }
    } catch (err) {
      notes.innerHTML = "<p class='text-danger text-center'>Failed to fetch release notes.</p>";
    }
  } else {
    versionInfo.textContent = "Extension was updated.";
    releaseLink.style.display = "none";
  }
})();
