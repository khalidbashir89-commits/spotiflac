/**
 * UI Module — view switching, toasts, Extension Manager modal
 */

// ── Toast System ───────────────────────────────────────────────

let toastContainer = document.getElementById('toast-container');
if (!toastContainer) {
  toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  document.body.appendChild(toastContainer);
}

export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
  return toast;
}

window.showToast = showToast;

// ── View System ────────────────────────────────────────────────

const views = {
  home: document.getElementById('view-home'),
  search: document.getElementById('view-search'),
  library: document.getElementById('view-library'),
  collection: document.getElementById('view-collection'),
};

const navItems = document.querySelectorAll('.nav-item');

export function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === name);
  });
  // For nav highlight, collection page doesn't highlight any nav item (or keep previous)
  if (name !== 'collection') {
    navItems.forEach(item => item.classList.toggle('active', item.dataset.view === name));
  }
}

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    showView(item.dataset.view);
    if (item.dataset.view === 'library') renderLibraryView();
  });
});

// ── Track Row Renderer ─────────────────────────────────────────

export function renderTrackRow(track, index) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.trackId = track.id;

  const thumb = track.thumbnail
    ? `<img src="${escapeHtml(track.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div style="width:40px;height:40px;background:#282828;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:18px">♪</div>`;

  // Build clickable artist/album links if IDs are present
  const artistHtml = track.artistId
    ? `<a href="#" class="track-artist-link" data-artist-id="${escapeHtml(track.artistId)}" data-source="${escapeHtml(track.source || '')}">${escapeHtml(track.artist || '—')}</a>`
    : escapeHtml(track.artist || '—');

  const albumHtml = track.albumId
    ? `<a href="#" class="track-album-link" data-album-id="${escapeHtml(track.albumId)}" data-source="${escapeHtml(track.source || '')}">${escapeHtml(track.album || '—')}</a>`
    : escapeHtml(track.album || '—');

  row.innerHTML = `
    <div class="col-check">
      <input type="checkbox" class="search-track-checkbox" />
    </div>
    <div class="col-num">
      <span class="track-index">${index}</span>
      <span class="play-icon" style="cursor:pointer">
        <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/></svg>
      </span>
      <span class="playing-icon"><span class="bar-anim"><span></span><span></span><span></span></span></span>
    </div>
    <div class="col-title">
      ${thumb}
      <div class="col-title-meta">
        <div class="col-title-name">${escapeHtml(track.title)}</div>
        <div class="col-title-artist">${escapeHtml(track.artist || '')}</div>
      </div>
    </div>
    <div class="col-artist">${artistHtml}</div>
    <div class="col-album">${albumHtml}</div>
    <div class="col-duration">${formatDuration(track.duration)}</div>
    <div class="col-actions">
      <button class="track-action-btn download-btn" title="Download FLAC">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 16.5l-6-6h4V3h4v7.5h4l-6 6zM5 19h14v2H5v-2z"/></svg>
      </button>
      <button class="track-action-btn more-btn" title="More options">
        <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM16 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>
      </button>
    </div>
  `;

  if (track.source) {
    const badge = document.createElement('span');
    badge.className = 'source-badge';
    badge.textContent = track.source;
    row.querySelector('.col-title-artist').appendChild(badge);
  }

  // Direct click handlers — call global exposed by collection.js (no dynamic import needed)
  const artistLinkEl = row.querySelector('.track-artist-link');
  if (artistLinkEl) {
    artistLinkEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__openCollection?.('artist', artistLinkEl.dataset.artistId, artistLinkEl.dataset.source || 'Apple Music');
    });
  }

  const albumLinkEl = row.querySelector('.track-album-link');
  if (albumLinkEl) {
    albumLinkEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__openCollection?.('album', albumLinkEl.dataset.albumId, albumLinkEl.dataset.source || 'Apple Music');
    });
  }

  return row;
}

// ── Library View ───────────────────────────────────────────────

const downloadedTracks = new Map();

export function addToLibrary(track) {
  downloadedTracks.set(track.id, track);
  renderSidebarDownloads();
}

function renderSidebarDownloads() {
  const list = document.getElementById('downloaded-list');
  if (!list) return;
  list.innerHTML = '';
  if (downloadedTracks.size === 0) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#6a6a6a">No downloads yet</div>';
    return;
  }
  downloadedTracks.forEach(track => {
    const item = document.createElement('div');
    item.className = 'library-track-item';
    item.innerHTML = `
      ${track.thumbnail ? `<img src="${escapeHtml(track.thumbnail)}" alt="">` : '<div style="width:40px;height:40px;background:#282828;border-radius:4px"></div>'}
      <div class="library-track-meta">
        <div class="library-track-name">${escapeHtml(track.title)}</div>
        <div class="library-track-artist">${escapeHtml(track.artist || '')}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      import('./player.js').then(({ loadTrack }) => loadTrack(track));
    });
    list.appendChild(item);
  });
}

export function renderLibraryView() {
  const listEl = document.getElementById('library-track-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (downloadedTracks.size === 0) {
    listEl.innerHTML = `<div style="padding:48px;text-align:center;color:#a7a7a7"><div style="font-size:48px;margin-bottom:16px">📁</div><p>No downloaded tracks yet.</p></div>`;
    return;
  }
  const header = document.createElement('div');
  header.className = 'track-row track-header';
  header.innerHTML = `<span class="col-num">#</span><span class="col-title">Title</span><span class="col-artist">Artist</span><span class="col-album">Album</span><span class="col-duration">Duration</span><span class="col-actions"></span>`;
  listEl.appendChild(header);
  let i = 1;
  downloadedTracks.forEach(track => {
    const row = renderTrackRow(track, i++);
    row.addEventListener('dblclick', () => import('./player.js').then(({ loadTrack }) => loadTrack(track)));
    listEl.appendChild(row);
  });
}

// ── Extension Manager Modal ────────────────────────────────────

const modalOverlay = document.getElementById('modal-overlay');
const btnInstallExt = document.getElementById('btn-install-ext');
const btnCloseModal = document.getElementById('btn-close-modal');

btnInstallExt.addEventListener('click', openExtensionManager);
btnCloseModal.addEventListener('click', closeExtensionManager);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeExtensionManager(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOverlay.style.display !== 'none') closeExtensionManager(); });

// Rewrite modal body to support tabs
const modalBody = document.getElementById('modal-body');
modalBody.innerHTML = `
  <div id="ext-tabs">
    <button class="ext-tab active" data-tab="installed">Installed</button>
    <button class="ext-tab" data-tab="browse">Browse GitHub</button>
  </div>
  <div id="ext-tab-installed" class="ext-tab-panel active">
    <div id="ext-installed-list"></div>
  </div>
  <div id="ext-tab-browse" class="ext-tab-panel">
    <div id="ext-browse-toolbar">
      <span id="ext-browse-meta"></span>
      <button id="btn-refresh-registry" class="btn-secondary btn-sm">
        <svg viewBox="0 0 16 16" width="14" height="14" style="margin-right:4px">
          <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zm.75-7.75V4.5a.75.75 0 0 0-1.5 0v2.25H5a.75.75 0 0 0 0 1.5h2.25V10.5a.75.75 0 0 0 1.5 0V8.25H11a.75.75 0 0 0 0-1.5H8.75z"/>
        </svg>
        Refresh from GitHub
      </button>
    </div>
    <div id="ext-browse-loading" style="display:none">
      <div class="spinner-ring" style="width:32px;height:32px;margin:32px auto"></div>
      <p style="text-align:center;color:#a7a7a7;margin-top:12px">Fetching from GitHub...</p>
    </div>
    <div id="ext-browse-list"></div>
  </div>
`;

// Remove old footer reload button; replace with just the hint
const modalFooter = document.getElementById('modal-footer');
modalFooter.innerHTML = `
  <p class="hint-text">Drop a <code>.js</code> extension into <code>/extensions</code> folder, or install directly from GitHub above.</p>
  <button id="btn-reload-extensions" class="btn-secondary btn-sm">Reload All</button>
`;

// Tab switching
modalBody.querySelectorAll('.ext-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    modalBody.querySelectorAll('.ext-tab').forEach(t => t.classList.remove('active'));
    modalBody.querySelectorAll('.ext-tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`ext-tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'browse') loadBrowseTab();
  });
});

// Reload all button
document.getElementById('btn-reload-extensions').addEventListener('click', async (btn) => {
  const el = document.getElementById('btn-reload-extensions');
  el.textContent = 'Reloading...';
  el.disabled = true;
  try {
    await fetch('/api/extensions/reload', { method: 'POST' });
    const { loadExtensions } = await import('./search.js');
    await loadExtensions();
    await renderInstalledTab();
    showToast('Extensions reloaded', 'success');
  } catch (err) {
    showToast('Reload failed: ' + err.message, 'error');
  } finally {
    el.textContent = 'Reload All';
    el.disabled = false;
  }
});

// Refresh registry button
document.getElementById('btn-refresh-registry').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-registry');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    await fetch('/api/registry/refresh', { method: 'POST' });
    await loadBrowseTab(true);
    showToast('Registry refreshed from GitHub', 'success');
  } catch (err) {
    showToast('Refresh failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" style="margin-right:4px"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zm.75-7.75V4.5a.75.75 0 0 0-1.5 0v2.25H5a.75.75 0 0 0 0 1.5h2.25V10.5a.75.75 0 0 0 1.5 0V8.25H11a.75.75 0 0 0 0-1.5H8.75z"/></svg>Refresh from GitHub`;
  }
});

export async function openExtensionManager() {
  modalOverlay.style.display = 'flex';
  // Always reset to Installed tab
  modalBody.querySelectorAll('.ext-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'installed'));
  modalBody.querySelectorAll('.ext-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'ext-tab-installed'));
  await renderInstalledTab();
}

function closeExtensionManager() {
  modalOverlay.style.display = 'none';
}

// ── Installed Tab ──────────────────────────────────────────────

async function renderInstalledTab() {
  const listEl = document.getElementById('ext-installed-list');
  listEl.innerHTML = '<div style="padding:16px;color:#a7a7a7">Loading...</div>';
  try {
    const res = await fetch('/api/extensions');
    const { extensions } = await res.json();
    renderInstalledList(extensions);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#e91429;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function renderInstalledList(extensions) {
  const listEl = document.getElementById('ext-installed-list');
  listEl.innerHTML = '';

  if (!extensions.length) {
    listEl.innerHTML = `<div style="padding:32px;text-align:center;color:#a7a7a7">No extensions installed. Browse GitHub to add some.</div>`;
    return;
  }

  extensions.forEach(ext => {
    const card = document.createElement('div');
    card.className = 'ext-installed-card';
    card.innerHTML = `
      <div class="ext-card-left">
        <div class="ext-icon-sm ${ext.enabled && !ext.error ? 'active' : ext.error ? 'error' : 'disabled'}">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v10.185a3.5 3.5 0 1 0 2 3.115V9h8V6a3 3 0 0 0-3-3H9z"/></svg>
        </div>
        <div class="ext-card-meta">
          <div class="ext-card-name">${escapeHtml(ext.name)}</div>
          <div class="ext-card-sub">
            v${escapeHtml(ext.version || '?')} · ${escapeHtml(ext.author || 'Unknown')}
            ${ext.error ? `<span style="color:#e91429"> · Error</span>` : ''}
          </div>
          ${ext.error ? `<div class="ext-card-error">${escapeHtml(ext.error)}</div>` : ''}
        </div>
      </div>
      <div class="ext-card-actions">
        <button class="ext-toggle-btn ${ext.enabled ? 'on' : 'off'}" data-file="${escapeHtml(ext.file)}" data-enabled="${ext.enabled}" title="${ext.enabled ? 'Disable' : 'Enable'}">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-label">${ext.enabled ? 'Enabled' : 'Disabled'}</span>
        </button>
        <button class="ext-uninstall-btn" data-file="${escapeHtml(ext.file)}" title="Uninstall">
          <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>
        </button>
      </div>
    `;

    // Toggle enable/disable
    card.querySelector('.ext-toggle-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const file = btn.dataset.file;
      const isEnabled = btn.dataset.enabled === 'true';
      btn.disabled = true;
      try {
        const res = await fetch('/api/extensions/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file, enabled: !isEnabled }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const { loadExtensions } = await import('./search.js');
        await loadExtensions();
        renderInstalledList(data.extensions);
        showToast(`${isEnabled ? 'Disabled' : 'Enabled'}: ${file.replace('.js', '')}`, 'success');
      } catch (err) {
        showToast('Toggle failed: ' + err.message, 'error');
        btn.disabled = false;
      }
    });

    // Uninstall
    card.querySelector('.ext-uninstall-btn').addEventListener('click', async (e) => {
      const file = e.currentTarget.dataset.file;
      if (!confirm(`Uninstall "${file}"? This will delete the file.`)) return;
      try {
        const res = await fetch('/api/extensions/uninstall', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const { loadExtensions } = await import('./search.js');
        await loadExtensions();
        renderInstalledList(data.extensions);
        showToast(`Uninstalled: ${file}`, 'info');
      } catch (err) {
        showToast('Uninstall failed: ' + err.message, 'error');
      }
    });

    listEl.appendChild(card);
  });
}

// ── Browse Tab (GitHub Registry) ───────────────────────────────

let registryCache = null;
let installedFiles = new Set();

async function loadBrowseTab(force = false) {
  if (registryCache && !force) { renderBrowseList(registryCache); return; }

  const loadingEl = document.getElementById('ext-browse-loading');
  const listEl = document.getElementById('ext-browse-list');
  loadingEl.style.display = 'block';
  listEl.innerHTML = '';

  try {
    // Fetch installed list for state tracking
    const instRes = await fetch('/api/extensions');
    const instData = await instRes.json();
    installedFiles = new Set((instData.extensions || []).map(e => e.file));

    const regRes = await fetch('/api/registry');
    const data = await regRes.json();
    registryCache = data;
    renderBrowseList(data);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#e91429;padding:16px">${escapeHtml(err.message)}</div>`;
  } finally {
    loadingEl.style.display = 'none';
  }
}

function renderBrowseList(data) {
  const listEl = document.getElementById('ext-browse-list');
  const metaEl = document.getElementById('ext-browse-meta');
  listEl.innerHTML = '';

  const extensions = data.extensions || [];
  const fetchedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : 'never';
  const ghCount = data.githubCount || 0;

  metaEl.innerHTML = `
    <span style="color:#a7a7a7;font-size:12px">${extensions.length} extension${extensions.length !== 1 ? 's' : ''} · ${ghCount} from GitHub · Last synced: ${fetchedAt}</span>
  `;

  if (!extensions.length) {
    listEl.innerHTML = `<div style="padding:32px;text-align:center;color:#a7a7a7">No extensions found. Try refreshing.</div>`;
    return;
  }

  // Group: GitHub results first, then curated
  const github = extensions.filter(e => !e.curated);
  const curated = extensions.filter(e => e.curated);
  const ordered = [...github, ...curated];

  if (github.length > 0) {
    const gh = document.createElement('div');
    gh.className = 'ext-section-label';
    gh.textContent = `From GitHub (${github.length})`;
    listEl.appendChild(gh);
  }

  let curatedHeaderAdded = false;

  ordered.forEach(ext => {
    if (ext.curated && github.length > 0 && !curatedHeaderAdded) {
      const lbl = document.createElement('div');
      lbl.className = 'ext-section-label';
      lbl.textContent = 'Curated List';
      listEl.appendChild(lbl);
      curatedHeaderAdded = true;
    }

    const suggestedFile = ext.name.toLowerCase().replace(/\s+/g, '-') + '.js';
    const isInstalled = ext.bundled || [...installedFiles].some(f => f === suggestedFile || f.includes(ext.name.toLowerCase().replace(/\s+/g, '-')));
    const canInstall = !ext.bundled && !!ext.rawUrl;

    const card = document.createElement('div');
    card.className = 'ext-browse-card';
    card.innerHTML = `
      <div class="ext-browse-left">
        <div class="ext-icon-sm ${isInstalled ? 'active' : ''}">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v10.185a3.5 3.5 0 1 0 2 3.115V9h8V6a3 3 0 0 0-3-3H9z"/></svg>
        </div>
        <div class="ext-browse-meta">
          <div class="ext-browse-name">
            ${escapeHtml(ext.name)}
            ${ext.curated ? '<span class="badge-curated">Curated</span>' : ''}
            ${ext.bundled ? '<span class="badge-bundled">Bundled</span>' : ''}
            ${ext.stars !== null && ext.stars !== undefined ? `<span class="badge-stars">★ ${ext.stars}</span>` : ''}
          </div>
          <div class="ext-browse-author">by ${escapeHtml(ext.author)}</div>
          <div class="ext-browse-desc">${escapeHtml(ext.description)}</div>
          <div class="ext-browse-tags">
            ${(ext.capabilities || []).map(c => `<span class="ext-cap-badge">${escapeHtml(c)}</span>`).join('')}
            ${ext.format ? `<span class="ext-cap-badge" style="color:#1DB954">${escapeHtml(ext.format)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="ext-browse-actions">
        ${ext.repoUrl ? `<a href="${escapeHtml(ext.repoUrl)}" target="_blank" rel="noopener" class="btn-secondary btn-sm ext-gh-link">GitHub</a>` : ''}
        ${ext.bundled
          ? `<span class="badge-installed">Installed</span>`
          : isInstalled
            ? `<span class="badge-installed">Installed</span>`
            : canInstall
              ? `<button class="btn-primary btn-sm ext-install-btn" data-url="${escapeHtml(ext.rawUrl)}" data-name="${escapeHtml(suggestedFile)}">Install</button>`
              : `<span style="font-size:12px;color:#6a6a6a">No direct URL</span>`
        }
      </div>
    `;

    // Install button handler
    const installBtn = card.querySelector('.ext-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        installBtn.textContent = 'Installing...';
        installBtn.disabled = true;
        try {
          const res = await fetch('/api/extensions/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUrl: installBtn.dataset.url, filename: installBtn.dataset.name }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          installedFiles.add(data.filename);
          installBtn.outerHTML = `<span class="badge-installed">Installed</span>`;
          const { loadExtensions } = await import('./search.js');
          await loadExtensions();
          showToast(`Installed: ${ext.name}`, 'success');
        } catch (err) {
          showToast('Install failed: ' + err.message, 'error');
          installBtn.textContent = 'Install';
          installBtn.disabled = false;
        }
      });
    }

    listEl.appendChild(card);
  });
}

// ── Greeting ───────────────────────────────────────────────────

export function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = greeting;
}

// ── Helpers ────────────────────────────────────────────────────

function formatDuration(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.addEventListener('trackDownloaded', (e) => addToLibrary(e.detail));
renderSidebarDownloads();
