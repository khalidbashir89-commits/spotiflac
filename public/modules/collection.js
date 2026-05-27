/**
 * Collection Module — Album, Artist, Playlist detail pages
 */

import { showToast, showView } from './ui.js';
import { setQueue } from './player.js';

// ── State ─────────────────────────────────────────────────────
const state = {
  current: null,
  selectMode: false,
  selected: new Set(),
};

// ── DOM helpers ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Safe event binding — silently skips if element is null
function on(id, event, fn) {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
}

// ── Init (runs after DOM is ready) ───────────────────────────
function init() {
  // Hash-based routing
  window.addEventListener('hashchange', () => {
    const p = parseHash(location.hash);
    if (p) openCollection(p.type, p.id, p.source, false);
  });

  // Toolbar buttons — checkboxes are always visible; toolbar auto-shows when any are checked
  on('btn-collection-select', 'click', () => {
    // "Select All" shortcut in the hero bar
    const tracks = state.current?.tracks || [];
    if (state.selected.size === tracks.length && tracks.length > 0) {
      // All selected → deselect all
      state.selected.clear();
      document.querySelectorAll('.track-checkbox').forEach(cb => { cb.checked = false; });
    } else {
      // Select all
      tracks.forEach(t => state.selected.add(t.id));
      document.querySelectorAll('.track-checkbox').forEach(cb => { cb.checked = true; });
    }
    updateToolbar();
    const btn = $('btn-collection-select');
    if (btn) btn.textContent = state.selected.size > 0 ? 'Deselect All' : 'Select All';
  });

  on('btn-collection-deselect', 'click', () => {
    state.selected.clear();
    document.querySelectorAll('.track-checkbox').forEach(cb => { cb.checked = false; });
    const btn = $('btn-collection-select');
    if (btn) btn.textContent = 'Select All';
    updateToolbar();
  });

  on('btn-collection-select-all', 'click', () => {
    const tracks = state.current?.tracks || [];
    tracks.forEach(t => state.selected.add(t.id));
    document.querySelectorAll('.track-checkbox').forEach(cb => { cb.checked = true; });
    const btn = $('btn-collection-select');
    if (btn) btn.textContent = 'Deselect All';
    updateToolbar();
  });

  on('btn-collection-download-all', 'click', () => {
    const tracks = state.current?.tracks || [];
    if (!tracks.length) { showToast('No tracks to download', 'info'); return; }
    batchDownload(tracks);
  });

  on('btn-collection-download-selected', 'click', () => {
    const tracks = (state.current?.tracks || []).filter(t => state.selected.has(t.id));
    if (!tracks.length) { showToast('No tracks selected', 'info'); return; }
    batchDownload(tracks);
  });

  // Play button — set by renderAlbum/renderArtist/renderPlaylist
  // (handler set dynamically when content loads)

  // URL input bar
  on('btn-open-url-input', 'click', () => {
    const bar = $('url-input-bar');
    if (!bar) return;
    const visible = bar.style.display !== 'none' && bar.style.display !== '';
    bar.style.display = visible ? 'none' : 'flex';
    if (!visible) { const inp = $('url-input'); if (inp) inp.focus(); }
  });

  on('btn-url-close', 'click', () => {
    const bar = $('url-input-bar'); if (bar) bar.style.display = 'none';
    const inp = $('url-input'); if (inp) inp.value = '';
  });

  on('btn-url-go', 'click', () => {
    const inp = $('url-input'); if (!inp) return;
    const url = inp.value.trim();
    if (!url) return;
    const bar = $('url-input-bar'); if (bar) bar.style.display = 'none';
    inp.value = '';
    openUrl(url);
  });

  const urlInp = $('url-input');
  if (urlInp) {
    urlInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = urlInp.value.trim();
        if (!url) return;
        const bar = $('url-input-bar'); if (bar) bar.style.display = 'none';
        urlInp.value = '';
        openUrl(url);
      }
      if (e.key === 'Escape') {
        const bar = $('url-input-bar'); if (bar) bar.style.display = 'none';
        urlInp.value = '';
      }
    });
  }

  // Global click delegation for artist/album links (backup — direct handlers in ui.js are primary)
  document.addEventListener('click', (e) => {
    const artistLink = e.target.closest('.track-artist-link, .ctrack-artist-link');
    if (artistLink?.dataset?.artistId) {
      e.preventDefault();
      openCollection('artist', artistLink.dataset.artistId, artistLink.dataset.source || 'Apple Music');
      return;
    }
    const albumLink = e.target.closest('.track-album-link, .ctrack-album-link');
    if (albumLink?.dataset?.albumId) {
      e.preventDefault();
      openCollection('album', albumLink.dataset.albumId, albumLink.dataset.source || 'Apple Music');
    }
  });
}

// ── Hash Routing ──────────────────────────────────────────────
function buildHash(type, source, id) {
  return `#collection|${type}|${encodeURIComponent(source)}|${encodeURIComponent(id)}`;
}
function parseHash(hash) {
  if (!hash?.startsWith('#collection|')) return null;
  const parts = hash.slice(1).split('|');
  if (parts.length < 4) return null;
  return { type: parts[1], source: decodeURIComponent(parts[2]), id: decodeURIComponent(parts[3]) };
}

// ── Main Open ─────────────────────────────────────────────────
export async function openCollection(type, id, source = 'Apple Music', pushHistory = true) {
  showView('collection');

  // Reset UI
  const title = $('collection-title'); if (title) title.textContent = 'Loading…';
  const label = $('collection-type-label'); if (label) label.textContent = type.charAt(0).toUpperCase() + type.slice(1);
  const list = $('collection-track-list'); if (list) list.innerHTML = '<div class="collection-loading"><div class="spinner-ring"></div><p>Loading…</p></div>';
  const ts = $('artist-topsongs-section'); if (ts) ts.style.display = 'none';
  const as_ = $('artist-albums-section'); if (as_) as_.style.display = 'none';
  const tb = $('collection-toolbar'); if (tb) tb.style.display = 'none';
  state.selectMode = false;
  state.selected.clear();
  const selBtn = $('btn-collection-select'); if (selBtn) selBtn.textContent = 'Select All';

  if (pushHistory) history.pushState(null, '', buildHash(type, source, id));

  try {
    const params = new URLSearchParams({ type, id, source });
    const res = await fetch(`/api/collection?${params}`);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const data = await res.json();

    state.current = { type, id, source, data, tracks: data.tracks || data.topSongs || [] };
    renderCollection(data);
  } catch (err) {
    console.error('[Collection]', err);
    const title2 = $('collection-title'); if (title2) title2.textContent = 'Error loading';
    const list2 = $('collection-track-list'); if (list2) list2.innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger)">${esc(err.message)}</div>`;
    showToast('Failed: ' + err.message, 'error');
  }
}

export async function openUrl(url) {
  try {
    showToast('Resolving URL…', 'info', 2000);
    const res = await fetch('/api/apple-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const { type, id, source } = await res.json();
    if (type === 'song') { showToast('Single songs cannot be viewed as a collection', 'info'); return; }
    await openCollection(type, id, source || 'Apple Music');
  } catch (err) {
    showToast('URL error: ' + err.message, 'error');
  }
}

// ── Apple Music URL helpers ───────────────────────────────────
function appleUrl(type, rawId) {
  if (!rawId) return null;
  const id = rawId.replace(/^apm-(artist|album|playlist):/, '');
  if (type === 'artist')   return `https://music.apple.com/us/artist/${id}`;
  if (type === 'album')    return `https://music.apple.com/us/album/${id}`;
  if (type === 'playlist') return `https://music.apple.com/us/playlist/${id}`;
  return null;
}

const APM_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" style="vertical-align:middle"><path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`;

// Inject or update the "Open in Apple Music" button in the collection hero
function setAppleMusicHeroBtn(url) {
  const existing = document.getElementById('btn-open-apple-music');
  if (existing) existing.remove();
  if (!url) return;
  const actions = $('collection-actions');
  if (!actions) return;
  const a = document.createElement('a');
  a.id = 'btn-open-apple-music';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = 'btn-secondary collection-action-btn';
  a.title = 'Open in Apple Music';
  a.innerHTML = `${APM_ICON} <span style="margin-left:5px">Open in Apple Music</span>`;
  actions.appendChild(a);
}

// ── Render Dispatch ───────────────────────────────────────────
function renderCollection(data) {
  if (data.type === 'album') renderAlbum(data);
  else if (data.type === 'artist') renderArtist(data);
  else if (data.type === 'playlist') renderPlaylist(data);
}

function setHeroArt(url) {
  const art = $('collection-art');
  if (!art) return;
  art.src = url || '';
  art.style.display = url ? '' : 'none';
}

function setMeta(artistName, artistId, extraText, source) {
  const link = $('collection-artist-link');
  if (link) {
    link.textContent = artistName || '';
    link.style.display = artistName ? '' : 'none';
    link.onclick = (e) => {
      e.preventDefault();
      if (artistId) openCollection('artist', artistId, source || 'Apple Music');
    };
  }
  // ↗ link to open artist page directly in Apple Music
  const existingApmArtist = document.getElementById('hero-artist-apm-link');
  if (existingApmArtist) existingApmArtist.remove();
  if (artistId && artistName) {
    const apmLink = document.createElement('a');
    apmLink.id = 'hero-artist-apm-link';
    apmLink.href = appleUrl('artist', artistId);
    apmLink.target = '_blank';
    apmLink.rel = 'noopener';
    apmLink.className = 'apm-ext-link apm-ext-link--hero';
    apmLink.title = 'Open artist in Apple Music';
    apmLink.innerHTML = APM_ICON;
    if (link) link.insertAdjacentElement('afterend', apmLink);
  }
  const extra = $('collection-meta-extra');
  if (extra) extra.textContent = extraText || '';
}

// ── Album ─────────────────────────────────────────────────────
function renderAlbum(data) {
  const title = $('collection-title'); if (title) title.textContent = data.title || 'Unknown Album';
  const label = $('collection-type-label'); if (label) label.textContent = 'Album';
  setHeroArt(data.artwork || data.artworkHero);

  const extra = [data.releaseDate, data.trackCount ? `${data.trackCount} songs` : ''].filter(Boolean).join(' · ');
  setMeta(data.artist, data.artistId, extra, data.source);
  setAppleMusicHeroBtn(appleUrl('album', data.id));

  state.current.tracks = data.tracks || [];
  renderTrackTable(data.tracks || [], $('collection-track-list'), { showTrackNumber: true });

  const playBtn = $('btn-collection-play');
  if (playBtn) playBtn.onclick = () => { if (data.tracks?.length) setQueue(data.tracks, 0); };
}

// ── Artist ────────────────────────────────────────────────────
function renderArtist(data) {
  const title = $('collection-title'); if (title) title.textContent = data.name || 'Unknown Artist';
  const label = $('collection-type-label'); if (label) label.textContent = 'Artist';
  setHeroArt(data.artwork);
  setMeta('', null, data.albums ? `${data.albums.length} albums` : '', data.source);
  setAppleMusicHeroBtn(appleUrl('artist', data.id));

  const list = $('collection-track-list'); if (list) list.innerHTML = '';

  // Top songs
  const tsSection = $('artist-topsongs-section');
  const tsList = $('artist-topsongs-list');
  if (data.topSongs?.length && tsSection && tsList) {
    tsSection.style.display = '';
    state.current.tracks = data.topSongs;
    renderTrackTable(data.topSongs, tsList, { showTrackNumber: false });
  } else if (tsSection) {
    tsSection.style.display = 'none';
  }

  // Albums grid
  const asSection = $('artist-albums-section');
  const asGrid = $('artist-albums-grid');
  if (data.albums?.length && asSection && asGrid) {
    asSection.style.display = '';
    asGrid.innerHTML = '';
    data.albums.forEach(album => {
      const card = document.createElement('div');
      card.className = 'card collection-album-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <div class="card-art-wrap" style="position:relative;overflow:hidden">
          ${album.artwork
            ? `<img src="${esc(album.artwork)}" alt="" class="card-art" loading="lazy" onerror="this.style.display='none'" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px">`
            : `<div class="card-art-placeholder"><svg viewBox="0 0 24 24" width="40" height="40" style="opacity:.35"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v10.185a3.5 3.5 0 1 0 2 3.115V9h8V6a3 3 0 0 0-3-3H9z"/></svg></div>`}
        </div>
        <div class="card-title">${esc(album.title)}</div>
        <div class="card-subtitle">${esc(album.year || '')}${album.trackCount ? ` · ${album.trackCount} songs` : ''}</div>
        ${appleUrl('album', album.id) ? `<a href="${esc(appleUrl('album', album.id))}" target="_blank" rel="noopener" class="card-apm-link" title="Open in Apple Music">${APM_ICON}</a>` : ''}
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-apm-link')) return;
        openCollection('album', album.id, data.source || 'Apple Music');
      });
      asGrid.appendChild(card);
    });
  } else if (asSection) {
    asSection.style.display = 'none';
  }

  const playBtn = $('btn-collection-play');
  if (playBtn) playBtn.onclick = () => { if (data.topSongs?.length) setQueue(data.topSongs, 0); };
}

// ── Playlist ──────────────────────────────────────────────────
function renderPlaylist(data) {
  const title = $('collection-title'); if (title) title.textContent = data.title || 'Unknown Playlist';
  const label = $('collection-type-label'); if (label) label.textContent = 'Playlist';
  setHeroArt(data.artwork || data.artworkHero);

  const extra = [data.trackCount ? `${data.trackCount} songs` : ''].filter(Boolean).join(' · ');
  setMeta(data.curatorName || '', null, extra, data.source);
  setAppleMusicHeroBtn(appleUrl('playlist', data.id));

  state.current.tracks = data.tracks || [];
  renderTrackTable(data.tracks || [], $('collection-track-list'), { showAlbum: true });

  const playBtn = $('btn-collection-play');
  if (playBtn) playBtn.onclick = () => { if (data.tracks?.length) setQueue(data.tracks, 0); };
}

// ── Track Table ───────────────────────────────────────────────
function renderTrackTable(tracks, container, opts = {}) {
  if (!container) return;
  container.innerHTML = '';

  if (!tracks?.length) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-subdued)">No tracks found.</div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'collection-track-header' + (opts.showAlbum ? ' has-album' : '');
  header.innerHTML = `
    <span class="ctcol-check"></span>
    <span class="ctcol-num">#</span>
    <span class="ctcol-title">Title</span>
    ${opts.showAlbum ? '<span class="ctcol-album">Album</span>' : ''}
    <span class="ctcol-duration"><svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path fill="currentColor" d="M8 3.25a.75.75 0 0 1 .75.75v3.25H11a.75.75 0 0 1 0 1.5H7.25V4A.75.75 0 0 1 8 3.25z"/></svg></span>
    <span class="ctcol-actions"></span>
  `;
  container.appendChild(header);

  tracks.forEach((track, idx) => {
    container.appendChild(buildRow(track, idx + 1, tracks, opts));
  });
}

function buildRow(track, index, allTracks, opts = {}) {
  const row = document.createElement('div');
  row.className = 'collection-track-row' + (opts.showAlbum ? ' has-album' : '');
  row.dataset.trackId = track.id;

  const thumb = track.thumbnail
    ? `<img src="${esc(track.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="ctrack-art-placeholder">♪</div>`;

  const num = opts.showTrackNumber && track.trackNumber ? track.trackNumber : index;

  const artistHtml = track.artistId
    ? `<a href="#" class="ctrack-artist-link" data-artist-id="${esc(track.artistId)}" data-source="${esc(track.source||'Apple Music')}">${esc(track.artist||'')}</a>`
    : `<span>${esc(track.artist||'')}</span>`;

  const albumCol = opts.showAlbum
    ? `<span class="ctcol-album">${track.albumId
        ? `<a href="#" class="ctrack-album-link" data-album-id="${esc(track.albumId)}" data-source="${esc(track.source||'Apple Music')}">${esc(track.album||'—')}</a>`
        : esc(track.album||'—')}</span>`
    : '';

  row.innerHTML = `
    <span class="ctcol-check"><input type="checkbox" class="track-checkbox" /></span>
    <span class="ctcol-num">
      <span class="ctrack-index">${num}</span>
      <span class="ctrack-play-icon"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/></svg></span>
    </span>
    <span class="ctcol-title">
      <div class="ctrack-art">${thumb}</div>
      <div class="ctrack-meta">
        <div class="ctrack-name">${esc(track.title)}</div>
        <div class="ctrack-artist">${artistHtml}</div>
      </div>
    </span>
    ${albumCol}
    <span class="ctcol-duration">${fmtDur(track.duration)}</span>
    <span class="ctcol-actions">
      <button class="track-action-btn ctrack-dl-btn" title="Download FLAC"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 16.5l-6-6h4V3h4v7.5h4l-6 6zM5 19h14v2H5v-2z"/></svg></button>
      <button class="track-action-btn ctrack-more-btn" title="More options"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM16 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg></button>
    </span>
  `;

  // Checkbox
  const cb = row.querySelector('.track-checkbox');
  cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(track.id); else state.selected.delete(track.id);
    updateToolbar();
  });

  // Row click toggles checkbox (not on action elements)
  row.addEventListener('click', (e) => {
    if (e.target.closest('.track-checkbox, .ctrack-dl-btn, .ctrack-more-btn, .ctrack-artist-link, .ctrack-album-link, .ctrack-play-icon')) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  });

  // Dbl-click to play
  row.addEventListener('dblclick', (e) => {
    if (e.target.closest('.ctrack-dl-btn, .ctrack-artist-link, .ctrack-album-link')) return;
    const idx = allTracks.indexOf(track);
    if (idx !== -1) setQueue(allTracks, idx);
  });

  // Play icon click
  row.querySelector('.ctrack-play-icon').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = allTracks.indexOf(track);
    if (idx !== -1) setQueue(allTracks, idx);
  });

  // Download button
  row.querySelector('.ctrack-dl-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    downloadOne(track);
  });

  // 3-dot menu
  row.querySelector('.ctrack-more-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showCollectionContextMenu(e, track);
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCollectionContextMenu(e, track);
  });

  // Artist link
  const artistLink = row.querySelector('.ctrack-artist-link');
  if (artistLink) {
    artistLink.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openCollection('artist', artistLink.dataset.artistId, artistLink.dataset.source || 'Apple Music');
    });
  }

  // Album link
  const albumLink = row.querySelector('.ctrack-album-link');
  if (albumLink) {
    albumLink.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openCollection('album', albumLink.dataset.albumId, albumLink.dataset.source || 'Apple Music');
    });
  }

  return row;
}

// ── Context Menu ─────────────────────────────────────────────
function showCollectionContextMenu(e, track) {
  const menu = document.getElementById('context-menu');
  const list = document.getElementById('context-menu-list');
  if (!menu || !list) return;

  list.innerHTML = `
    <li class="context-item" data-action="play">
      <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/></svg>
      Play
    </li>
    <li class="context-item" data-action="download">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 16.5l-6-6h4V3h4v7.5h4l-6 6zM5 19h14v2H5v-2z"/></svg>
      Download FLAC
    </li>
    ${track.artistId ? `<li class="context-item context-item--apm" data-action="apm-artist">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      Browse Artist
    </li>` : ''}
    ${track.albumId ? `<li class="context-item context-item--apm" data-action="apm-album">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      Browse Album
    </li>` : ''}
  `;

  list.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', () => {
      menu.style.display = 'none';
      const action = item.dataset.action;
      if (action === 'play') {
        const tracks = state.current?.tracks || [];
        const idx = tracks.indexOf(track);
        if (idx !== -1) setQueue(tracks, idx);
      } else if (action === 'download') {
        downloadOne(track);
      } else if (action === 'apm-artist') {
        openCollection('artist', track.artistId, 'Apple Music');
      } else if (action === 'apm-album') {
        openCollection('album', track.albumId, 'Apple Music');
      }
    });
  });

  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 220) + 'px';

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

// ── Toolbar ───────────────────────────────────────────────────
function updateToolbar() {
  const count = state.selected.size;
  const el = $('collection-select-count');
  if (el) el.textContent = `${count} selected`;
  // Show toolbar whenever anything is selected
  const tb = $('collection-toolbar');
  if (tb) tb.style.display = count > 0 ? 'flex' : 'none';
}

// ── Download ──────────────────────────────────────────────────

function collectionName() {
  if (!state.current) return null;
  return state.current.title || state.current.name || null;
}

async function saveFlac(track, folderName) {
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
      collectionName: folderName || track.album || null,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function batchDownload(tracks) {
  if (!tracks?.length) return;

  if (tracks.length === 1) {
    await downloadOne(tracks[0]);
    return;
  }

  const folder = collectionName();
  const toast = showToast(`Saving 1/${tracks.length}…`, 'info', 999999);
  function dismissToast() {
    if (toast?.isConnected) { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }
  }

  let saved = 0, skipped = 0, failed = 0;
  for (const track of tracks) {
    if (toast?.isConnected) {
      toast.textContent = `Saving ${saved + skipped + failed + 1}/${tracks.length}: ${track.title || 'Track'}…`;
    }
    try {
      const data = await saveFlac(track, folder);
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
  showToast(`FLAC Music / ${folder || 'Singles'}: ${parts.join(', ')}`, 'success', 6000);
}

async function downloadOne(track, silent = false) {
  if (!track.id || !track.source) { if (!silent) showToast('No source info for track', 'error'); return; }
  if (!silent) showToast(`Saving: ${track.title}…`, 'info', 3000);
  try {
    const data = await saveFlac(track, collectionName());
    if (!silent) {
      showToast(data.skipped ? `Already saved: ${track.title}` : `Saved to FLAC Music / ${data.folder}`, 'success', 3000);
    }
    window.dispatchEvent(new CustomEvent('trackDownloaded', { detail: track }));
  } catch (err) {
    if (!silent) showToast(`Save failed: ${err.message}`, 'error');
  }
}

// ── Utilities ─────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function san(s) { return String(s||'').replace(/[<>:"/\\|?*]/g,'_'); }
function fmtDur(s) { if (!s) return '—'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }

// ── Boot ──────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose globally so ui.js can call without dynamic import (avoids circular dep)
window.__openCollection = openCollection;
window.__openUrl = openUrl;
