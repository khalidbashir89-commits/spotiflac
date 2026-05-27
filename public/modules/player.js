/**
 * Audio Player Module — wraps HTML5 <audio> with SpotiFLAC state
 */

const audio = document.getElementById('audio-engine');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const progressBar = document.getElementById('player-progress-bar');
const progressFill = document.getElementById('player-progress-fill');
const progressThumb = document.getElementById('player-progress-thumb');
const currentTimeEl = document.getElementById('player-current-time');
const totalTimeEl = document.getElementById('player-total-time');
const playerTitle = document.getElementById('player-track-title');
const playerArtist = document.getElementById('player-track-artist');
const playerArt = document.getElementById('player-art');
const playerArtPlaceholder = document.getElementById('player-art-placeholder');
const btnDownload = document.getElementById('btn-download-flac');
const downloadFormatBadge = document.getElementById('download-format-badge');
const volumeSlider = document.getElementById('volume-slider');
const volumeFill = document.getElementById('volume-fill');
const volumeThumb = document.getElementById('volume-thumb');

export const playerState = {
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isShuffle: false,
  repeatMode: 'none',
  volume: 0.8,
};

// ── Playback Controls ──────────────────────────────────────────

export async function loadTrack(track, autoplay = true) {
  playerState.currentTrack = track;

  playerTitle.textContent = track.title || 'Unknown Track';
  playerArtist.textContent = track.artist || '';

  if (track.thumbnail) {
    playerArt.src = track.thumbnail;
    playerArt.style.display = 'block';
    playerArtPlaceholder.style.display = 'none';
  } else {
    playerArt.style.display = 'none';
    playerArtPlaceholder.style.display = 'flex';
  }

  btnDownload.disabled = true;
  updateDownloadBadge('FLAC');

  // Resolve stream URL if not already available
  let streamUrl = track.streamUrl;
  if (!streamUrl && track.id && track.source) {
    try {
      window.showToast('Resolving stream...', 'info', 1500);
      const res = await fetch(`/api/resolve?trackId=${encodeURIComponent(track.id)}&source=${encodeURIComponent(track.source)}`);
      const data = await res.json();
      if (data.streamUrl) { track.streamUrl = data.streamUrl; streamUrl = data.streamUrl; }
      if (data.downloadUrl) track.downloadUrl = data.downloadUrl;
      if (data.ytVideoId) track._ytVideoId = data.ytVideoId;
      if (data.iosUserAgent) track._iosUA = data.iosUserAgent;
    } catch (e) { console.warn('Resolve failed:', e); }
  }

  btnDownload.disabled = false;
  updateDownloadBadge('FLAC');

  if (streamUrl) {
    let proxyUrl;

    if (streamUrl.startsWith('apm://')) {
      // Apple Music — gamdl fetches and serves M4A (~15-30s first time)
      const songId = streamUrl.replace('apm://', '');
      proxyUrl = `/api/apple-stream?songId=${encodeURIComponent(songId)}`;
      if (window.showToast) window.showToast('Loading Apple Music stream — please wait...', 'info', 20000);
    } else if (streamUrl.startsWith('ytm://')) {
      proxyUrl = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`;
    } else if (streamUrl.includes('saavncdn.com') || streamUrl.includes('jiosaavn.com')) {
      proxyUrl = `/api/proxy-stream?url=${encodeURIComponent(streamUrl)}`;
    } else {
      proxyUrl = streamUrl;
    }

    audio.src = proxyUrl;
    audio.load();
    if (autoplay) play();
  }

  highlightPlayingTrack(track.id);
  window.dispatchEvent(new CustomEvent('trackLoaded', { detail: track }));
}

function updateDownloadBadge(text) {
  if (downloadFormatBadge) downloadFormatBadge.textContent = text;
}

export function play() {
  if (!audio.src) return;
  audio.play().catch(err => {
    console.warn('Playback error:', err);
    if (window.showToast) window.showToast('Could not play audio stream.', 'error');
  });
}

export function pause() { audio.pause(); }

export function togglePlay() { if (audio.paused) play(); else pause(); }

export function seek(ratio) {
  if (!audio.duration) return;
  audio.currentTime = ratio * audio.duration;
}

export function setVolume(v) {
  playerState.volume = Math.max(0, Math.min(1, v));
  audio.volume = playerState.volume;
  updateVolumeUI();
}

export function playNext() {
  if (!playerState.queue.length) return;
  if (playerState.isShuffle) {
    playerState.queueIndex = Math.floor(Math.random() * playerState.queue.length);
  } else {
    playerState.queueIndex = (playerState.queueIndex + 1) % playerState.queue.length;
  }
  loadTrack(playerState.queue[playerState.queueIndex]);
}

export function playPrev() {
  if (!playerState.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  playerState.queueIndex = Math.max(0, playerState.queueIndex - 1);
  loadTrack(playerState.queue[playerState.queueIndex]);
}

export function setQueue(tracks, startIndex = 0) {
  playerState.queue = [...tracks];
  playerState.queueIndex = startIndex;
  if (tracks.length) loadTrack(tracks[startIndex]);
}

// ── FLAC Download ──────────────────────────────────────────────

export async function downloadCurrentTrack() {
  const track = playerState.currentTrack;
  if (!track) return;

  btnDownload.classList.add('downloading');
  btnDownload.disabled = true;
  updateDownloadBadge('...');

  try {
    // Resolve if needed
    if (!track.id || !track.source) {
      throw new Error('Track has no source information');
    }

    window.showToast(`Saving: ${track.title}…`, 'info', 3000);

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

    window.showToast(data.skipped ? `Already saved: ${track.title}` : `Saved to FLAC Music / ${data.folder}`, 'success', 3000);
    window.dispatchEvent(new CustomEvent('trackDownloaded', { detail: track }));
  } catch (err) {
    console.error('Download failed:', err);
    if (window.showToast) window.showToast(`Download failed: ${err.message}`, 'error');
  } finally {
    btnDownload.classList.remove('downloading');
    btnDownload.disabled = false;
    updateDownloadBadge('FLAC');
  }
}

// ── Audio Events ───────────────────────────────────────────────

audio.addEventListener('play', () => {
  playerState.isPlaying = true;
  iconPlay.style.display = 'none';
  iconPause.style.display = 'block';
  updatePlayingRows(true);
});

audio.addEventListener('pause', () => {
  playerState.isPlaying = false;
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
  updatePlayingRows(false);
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = pct + '%';
  progressThumb.style.left = pct + '%';
  currentTimeEl.textContent = formatTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
  if (playerState.repeatMode === 'one') {
    audio.currentTime = 0; play();
  } else if (playerState.repeatMode === 'all' || playerState.queueIndex < playerState.queue.length - 1) {
    playNext();
  }
});

audio.addEventListener('error', (e) => {
  const src = audio.src || '';
  let msg = 'Stream error.';
  if (src.includes('apple-stream')) {
    msg = 'Apple Music stream failed — cookies may be expired. Visit /apple-setup to refresh.';
  } else if (src.includes('proxy-stream') || src.includes('saavncdn')) {
    msg = 'Stream unavailable. Try downloading instead.';
  }
  if (window.showToast) window.showToast(msg, 'error', 5000);
  playerState.isPlaying = false;
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
});

// ── UI Control Events ──────────────────────────────────────────

btnPlayPause.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', playPrev);
btnNext.addEventListener('click', playNext);

btnShuffle.addEventListener('click', () => {
  playerState.isShuffle = !playerState.isShuffle;
  btnShuffle.classList.toggle('active', playerState.isShuffle);
});

btnRepeat.addEventListener('click', () => {
  const modes = ['none', 'all', 'one'];
  const idx = (modes.indexOf(playerState.repeatMode) + 1) % modes.length;
  playerState.repeatMode = modes[idx];
  btnRepeat.classList.toggle('active', playerState.repeatMode !== 'none');
  btnRepeat.title = playerState.repeatMode === 'one' ? 'Repeat One' : playerState.repeatMode === 'all' ? 'Repeat All' : 'Repeat';
});

btnDownload.addEventListener('click', downloadCurrentTrack);

// Progress scrubbing
let scrubbing = false;
progressBar.addEventListener('mousedown', e => { scrubbing = true; applyScrub(e); });
document.addEventListener('mousemove', e => { if (scrubbing) applyScrub(e); });
document.addEventListener('mouseup', () => { scrubbing = false; });
function applyScrub(e) {
  const rect = progressBar.getBoundingClientRect();
  seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
}

// Volume
let draggingVolume = false;
volumeSlider.addEventListener('mousedown', e => { draggingVolume = true; applyVolume(e); });
document.addEventListener('mousemove', e => { if (draggingVolume) applyVolume(e); });
document.addEventListener('mouseup', () => { draggingVolume = false; });
function applyVolume(e) {
  const rect = volumeSlider.getBoundingClientRect();
  setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
}
function updateVolumeUI() {
  const pct = playerState.volume * 100;
  volumeFill.style.width = pct + '%';
  volumeThumb.style.left = pct + '%';
}

// ── Utilities ──────────────────────────────────────────────────

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function sanitizeFilename(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

function highlightPlayingTrack(id) {
  document.querySelectorAll('.track-row.playing').forEach(el => el.classList.remove('playing'));
  if (id) document.querySelectorAll(`[data-track-id="${CSS.escape(id)}"]`).forEach(el => el.classList.add('playing'));
}

function updatePlayingRows(isPlaying) {
  const id = playerState.currentTrack?.id;
  if (!id) return;
  document.querySelectorAll(`[data-track-id="${CSS.escape(id)}"]`).forEach(row => {
    row.classList.toggle('playing', isPlaying);
  });
}

setVolume(playerState.volume);
audio.volume = playerState.volume;
