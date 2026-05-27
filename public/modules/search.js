/**
 * Search Module — communicates with backend extension system
 */

import { loadTrack, setQueue } from './player.js';
import { showToast, renderTrackRow, showView } from './ui.js';
import { openCollection } from './collection.js';

export const searchState = {
  query: '',
  results: [],
  allResults: [],
  activeFilter: 'all',
  extensions: [],
  isSearching: false,
};

const searchInput = document.getElementById('search-input');
const btnClear = document.getElementById('btn-clear-search');
const searchStateEmpty = document.getElementById('search-state-empty');
const searchStateLoading = document.getElementById('search-state-loading');
const searchStateError = document.getElementById('search-state-error');
const searchResults = document.getElementById('search-results');
const trackList = document.getElementById('results-track-list');
const resultsMeta = document.getElementById('results-meta');
const extensionFilter = document.getElementById('extension-filter');
const topTrackEl = document.getElementById('results-top-track');

let searchTimeout = null;

// ── Select Mode ────────────────────────────────────────────────

const selectState = { active: false, selected: new Set() };

const btnSelect        = document.getElementById('btn-search-select');
const selectToolbar    = document.getElementById('search-select-toolbar');
const selectCount      = document.getElementById('search-select-count');
const btnDownloadSel   = document.getElementById('btn-search-download-selected');
const btnSelectAll     = document.getElementById('btn-search-select-all');
const btnDeselectAll   = document.getElementById('btn-search-deselect');

function updateSelectToolbar() {
  const n = selectState.selected.size;
  if (selectCount) selectCount.textContent = `${n} selected`;
}

function enterSelectMode() {
  selectState.active = true;
  selectState.selected.clear();
  if (btnSelect) btnSelect.textContent = 'Cancel';
  if (selectToolbar) selectToolbar.style.display = 'flex';
  document.getElementById('results-table')?.classList.add('select-mode');
  updateSelectToolbar();
}

function exitSelectMode() {
  selectState.active = false;
  selectState.selected.clear();
  if (btnSelect) btnSelect.textContent = 'Select';
  if (selectToolbar) selectToolbar.style.display = 'none';
  document.getElementById('results-table')?.classList.remove('select-mode');
  document.querySelectorAll('.search-track-checkbox').forEach(cb => { cb.checked = false; });
  updateSelectToolbar();
}

if (btnSelect) {
  btnSelect.addEventListener('click', () => {
    selectState.active ? exitSelectMode() : enterSelectMode();
  });
}

if (btnSelectAll) {
  btnSelectAll.addEventListener('click', () => {
    searchState.results.forEach(t => selectState.selected.add(t.id));
    document.querySelectorAll('.search-track-checkbox').forEach(cb => { cb.checked = true; });
    updateSelectToolbar();
  });
}

if (btnDeselectAll) {
  btnDeselectAll.addEventListener('click', () => {
    selectState.selected.clear();
    document.querySelectorAll('.search-track-checkbox').forEach(cb => { cb.checked = false; });
    updateSelectToolbar();
  });
}

if (btnDownloadSel) {
  btnDownloadSel.addEventListener('click', async () => {
    const tracks = searchState.results.filter(t => selectState.selected.has(t.id));
    if (!tracks.length) { showToast('No tracks selected', 'info'); return; }
    await batchDownloadTracks(tracks);
  });
}

async function batchDownloadTracks(tracks) {
  if (!tracks?.length) return;

  if (tracks.length === 1) {
    await downloadTrack(tracks[0], null);
    return;
  }

  const toast = showToast(`Saving 1/${tracks.length}…`, 'info', 999999);
  function dismissToast() {
    if (toast?.isConnected) { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }
  }

  let saved = 0, skipped = 0, failed = 0;
  for (const track of tracks) {
    if (toast?.isConnected) toast.textContent = `Saving ${saved + skipped + failed + 1}/${tracks.length}: ${track.title || 'Track'}…`;
    try {
      const res = await fetch('/api/save-flac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: track.id, source: track.source,
          title: track.title || 'Track', artist: track.artist || 'Unknown',
          album: track.album || '', trackNumber: track.trackNumber || null,
          collectionName: track.album || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.skipped) skipped++; else saved++;
    } catch (err) {
      console.error('[Save] failed:', track.title, err.message);
      failed++;
    }
  }

  dismissToast();
  const parts = [];
  if (saved)   parts.push(`${saved} saved`);
  if (skipped) parts.push(`${skipped} already existed`);
  if (failed)  parts.push(`${failed} failed`);
  showToast(`Downloads/FLAC Music: ${parts.join(', ')}`, 'success', 6000);
}

function triggerDownload(track) {
  downloadTrack(track, null);
}

function sanitizeFilename(s) { return String(s || '').replace(/[<>:"/\\|?*]/g, '_'); }

// ── Input Handlers ─────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchState.query = q;
  btnClear.style.display = q ? 'flex' : 'none';

  if (!q) {
    showSearchEmpty();
    return;
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(q), 450);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchState.query) {
    clearTimeout(searchTimeout);
    performSearch(searchState.query);
  }
  if (e.key === 'Escape') clearSearch();
});

btnClear.addEventListener('click', clearSearch);

export function clearSearch() {
  searchInput.value = '';
  searchState.query = '';
  btnClear.style.display = 'none';
  showSearchEmpty();
}

function showSearchEmpty() {
  searchStateEmpty.style.display = 'flex';
  searchStateLoading.style.display = 'none';
  searchStateError.style.display = 'none';
  searchResults.style.display = 'none';
}

// ── Search Execution ───────────────────────────────────────────

export async function performSearch(query) {
  if (!query) return;

  showView('search');
  searchStateEmpty.style.display = 'none';
  searchStateLoading.style.display = 'flex';
  searchStateError.style.display = 'none';
  searchResults.style.display = 'none';
  searchState.isSearching = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();

    if (data.error) throw new Error(data.error);

    searchState.allResults = data.results || [];
    searchState.extensions = data.extensions || [];
    searchState.activeFilter = 'all';

    renderResults();
  } catch (err) {
    console.error('Search failed:', err);
    searchStateLoading.style.display = 'none';
    searchStateError.style.display = 'block';
    document.querySelector('.error-msg').textContent = `Search failed: ${err.message}`;
    showToast(`Search error: ${err.message}`, 'error');
  } finally {
    searchState.isSearching = false;
  }
}

// ── Results Rendering ──────────────────────────────────────────

function renderResults() {
  searchStateLoading.style.display = 'none';
  searchStateError.style.display = 'none';

  const filtered = filterResults();
  searchState.results = filtered;

  if (filtered.length === 0) {
    searchResults.style.display = 'block';
    trackList.innerHTML = `<div style="padding:32px;text-align:center;color:#a7a7a7">No results found for "<strong>${escapeHtml(searchState.query)}</strong>"</div>`;
    resultsMeta.textContent = '';
    topTrackEl.innerHTML = '';
    renderExtensionFilter();
    return;
  }

  searchResults.style.display = 'block';
  resultsMeta.textContent = `${filtered.length} track${filtered.length !== 1 ? 's' : ''}`;

  renderExtensionFilter();
  renderTopTrack(filtered[0]);
  renderTrackList(filtered);
}

function filterResults() {
  if (searchState.activeFilter === 'all') return searchState.allResults;
  return searchState.allResults.filter(t => t.source === searchState.activeFilter);
}

function renderExtensionFilter() {
  extensionFilter.innerHTML = '';

  const sources = ['all', ...new Set(searchState.allResults.map(t => t.source))];

  sources.forEach(src => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (src === searchState.activeFilter ? ' active' : '');
    chip.textContent = src === 'all' ? `All (${searchState.allResults.length})` : src;
    chip.addEventListener('click', () => {
      searchState.activeFilter = src;
      renderResults();
    });
    extensionFilter.appendChild(chip);
  });
}

function renderTopTrack(track) {
  if (!track) { topTrackEl.innerHTML = ''; return; }

  topTrackEl.innerHTML = `
    <div class="top-result-card" data-track-id="${escapeHtml(track.id)}">
      <div style="display:flex;align-items:center;gap:16px">
        ${track.thumbnail
          ? `<img src="${escapeHtml(track.thumbnail)}" alt="" style="width:80px;height:80px;border-radius:6px;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,0.5)">`
          : `<div style="width:80px;height:80px;border-radius:6px;background:#282828;display:flex;align-items:center;justify-content:center">♪</div>`}
        <div>
          <div style="font-size:12px;color:#a7a7a7;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Top Result</div>
          <div style="font-size:28px;font-weight:800;margin-bottom:4px">${escapeHtml(track.title)}</div>
          <div style="font-size:14px;color:#a7a7a7">${escapeHtml(track.artist || '')}${track.album ? ' · ' + escapeHtml(track.album) : ''}</div>
        </div>
      </div>
    </div>
  `;

  topTrackEl.querySelector('.top-result-card').addEventListener('dblclick', () => {
    playTrackFromResults(track);
  });
}

function renderTrackList(tracks) {
  trackList.innerHTML = '';
  const queue = [...tracks];

  tracks.forEach((track, idx) => {
    const row = renderTrackRow(track, idx + 1);

    // Checkbox wiring
    const cb = row.querySelector('.search-track-checkbox');
    if (cb) {
      cb.addEventListener('change', () => {
        if (cb.checked) selectState.selected.add(track.id);
        else selectState.selected.delete(track.id);
        updateSelectToolbar();
      });
      // Click on row in select mode toggles checkbox
      row.addEventListener('click', (e) => {
        if (!selectState.active) return;
        if (e.target.closest('.download-btn, .more-btn, .track-artist-link, .track-album-link, .play-icon, .search-track-checkbox')) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
    }

    row.addEventListener('dblclick', (e) => {
      if (selectState.active) return;
      setQueue(queue, idx);
    });
    row.querySelector('.play-icon')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectState.active) setQueue(queue, idx);
    });
    row.querySelector('.download-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await downloadTrack(track, row);
    });
    row.querySelector('.more-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showTrackContextMenu(e, track);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTrackContextMenu(e, track);
    });
    trackList.appendChild(row);
  });
}

function playTrackFromResults(track) {
  const idx = searchState.results.indexOf(track);
  if (idx !== -1) setQueue(searchState.results, idx);
}

// ── Download Individual Track (as FLAC via server) ────────────

async function downloadTrack(track, rowEl) {
  if (!track.id || !track.source) {
    showToast('Cannot download — track has no source', 'error');
    return;
  }

  const dlBtn = rowEl?.querySelector('.download-btn');
  if (dlBtn) { dlBtn.style.opacity = '0.5'; dlBtn.disabled = true; }

  try {
    showToast(`Saving: ${track.title}…`, 'info', 3000);

    const res = await fetch('/api/save-flac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: track.id,
        source: track.source,
        title: track.title || 'Track',
        artist: track.artist || 'Unknown',
        album: track.album || '',
        trackNumber: track.trackNumber || null,
        collectionName: track.album || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    showToast(data.skipped ? `Already saved: ${track.title}` : `Saved to FLAC Music / ${data.folder}`, 'success', 3000);
    window.dispatchEvent(new CustomEvent('trackDownloaded', { detail: track }));
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  } finally {
    if (dlBtn) { dlBtn.style.opacity = ''; dlBtn.disabled = false; }
  }
}

function sanitize(s) {
  return String(s || '').replace(/[<>:"/\\|?*]/g, '_');
}

// ── Context Menu ───────────────────────────────────────────────

function buildAppleUrl(type, rawId) {
  if (!rawId) return null;
  const id = rawId.replace(/^apm-(artist|album|playlist):/, '');
  if (type === 'artist') return `https://music.apple.com/us/artist/${id}`;
  if (type === 'album')  return `https://music.apple.com/us/album/${id}`;
  return null;
}

const APM_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`;

function showTrackContextMenu(e, track) {
  const menu = document.getElementById('context-menu');
  const list = document.getElementById('context-menu-list');

  list.innerHTML = `
    <li class="context-item" data-action="play">
      <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/></svg>
      Play
    </li>
    <li class="context-item" data-action="queue">
      <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M0 2h14v1.5H0V2zm0 5h14v1.5H0V7zm0 5h9v1.5H0V12z"/></svg>
      Add to Queue
    </li>
    <li class="context-item" data-action="download">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 16.5l-6-6h4V3h4v7.5h4l-6 6zM5 19h14v2H5v-2z"/></svg>
      Download FLAC
    </li>
    ${track.artistId ? `<li class="context-item context-item--apm" data-action="apm-artist">${APM_SVG} Browse Artist</li>` : ''}
    ${track.albumId  ? `<li class="context-item context-item--apm" data-action="apm-album">${APM_SVG} Browse Album</li>`  : ''}
    <li class="context-item" data-action="copy">
      <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M2.5 1h9a1 1 0 0 1 1 1v2h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-2h-2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 11h2V5a1 1 0 0 1 1-1h6V2h-9v10zm3-8v10h9V5h-9z"/></svg>
      Copy Link
    </li>
  `;

  list.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      menu.style.display = 'none';
      if (action === 'play') playTrackFromResults(track);
      else if (action === 'download') downloadTrack(track);
      else if (action === 'apm-artist') openCollection('artist', track.artistId, 'Apple Music');
      else if (action === 'apm-album')  openCollection('album',  track.albumId,  'Apple Music');
      else if (action === 'queue') {
        const idx = searchState.allResults.indexOf(track);
        if (idx !== -1) {
          import('./player.js').then(({ playerState }) => {
            playerState.queue.push(track);
            showToast('Added to queue', 'info');
          });
        }
      } else if (action === 'copy') {
        const url = track.downloadUrl || track.streamUrl || '';
        navigator.clipboard.writeText(url).then(() => showToast('Link copied', 'info'));
      }
    });
  });

  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';

  const hide = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.style.display = 'none';
      document.removeEventListener('click', hide);
      document.removeEventListener('contextmenu', hide);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', hide);
    document.addEventListener('contextmenu', hide);
  }, 0);
}

// ── Extension Status ───────────────────────────────────────────

export async function loadExtensions() {
  try {
    const res = await fetch('/api/extensions');
    const data = await res.json();
    searchState.extensions = data.extensions || [];
    updateExtensionIndicator(searchState.extensions);
    return searchState.extensions;
  } catch (err) {
    console.error('Failed to load extensions:', err);
    updateExtensionIndicator([]);
    return [];
  }
}

function updateExtensionIndicator(extensions) {
  const dot = document.getElementById('ext-indicator');
  const label = document.getElementById('ext-label');
  const active = extensions.filter(e => e.enabled && !e.error);

  if (active.length > 0) {
    dot.className = 'ext-dot active';
    label.textContent = `${active.length} Extension${active.length > 1 ? 's' : ''}`;
  } else if (extensions.length > 0) {
    dot.className = 'ext-dot error';
    label.textContent = 'Extension error';
  } else {
    dot.className = 'ext-dot';
    label.textContent = 'No Extensions';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
