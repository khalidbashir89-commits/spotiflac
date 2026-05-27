'use strict';

/**
 * SoundCloud Extension for SpotiFLAC
 * Search via SoundCloud v2 API, download via yt-dlp.
 * No account required for listening previews; SoundCloud Go+ for full streams.
 *
 * yt-dlp must be installed: pip install yt-dlp
 */

const fetch = require('node-fetch');
const { spawn } = require('child_process');

const YTDLP = (() => {
  for (const c of ['yt-dlp', 'yt-dlp.exe']) {
    try { require('child_process').execSync(`${c} --version`, { timeout: 3000 }); return c; } catch {}
  }
  return 'yt-dlp';
})();

// Fetch a rotating SoundCloud client_id from their main page
let _clientId = null;
let _clientIdTs = 0;

async function getClientId() {
  if (_clientId && Date.now() - _clientIdTs < 3600000) return _clientId;

  const r = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const html = await r.text();

  // Find JS bundles
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com[^"]+\.js)"/g)].map(m => m[1]);

  for (const scriptUrl of scripts.slice(-5)) {
    try {
      const sr = await fetch(scriptUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const js = await sr.text();
      const m = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (m) {
        _clientId = m[1];
        _clientIdTs = Date.now();
        return _clientId;
      }
    } catch {}
  }

  throw new Error('Could not extract SoundCloud client_id');
}

async function scSearch(query, limit = 15) {
  const clientId = await getClientId();
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });
  if (!r.ok) throw new Error(`SoundCloud API ${r.status}`);
  return r.json();
}

class SoundCloudExtension {
  constructor() {
    this.name = 'SoundCloud';
    this.version = '1.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'SoundCloud search and download via yt-dlp. Requires yt-dlp installed.';
    this.capabilities = ['search', 'stream'];
  }

  async search(query) {
    try {
      const data = await scSearch(query);
      return (data.collection || []).map(t => ({
        id: `sc:${t.permalink_url}`,
        title: t.title || 'Unknown',
        artist: t.user && t.user.username || '',
        album: '',
        duration: t.duration ? Math.round(t.duration / 1000) : 0,
        thumbnail: t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : null,
        format: 'flac',
        quality: t.policy === 'SNIP' ? 'Preview (30s)' : 'Full',
        source: 'SoundCloud',
      }));
    } catch (err) {
      console.error('[SoundCloud] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    try {
      const url = trackId.replace(/^sc:/, '');
      return {
        streamUrl: `sc://${encodeURIComponent(url)}`,
        downloadUrl: `sc://${encodeURIComponent(url)}`,
        format: 'flac',
        lossless: false,
        quality: 'SoundCloud',
        scUrl: url,
      };
    } catch (err) {
      console.error('[SoundCloud] resolve error:', err.message);
      return { streamUrl: null, downloadUrl: null };
    }
  }
}

module.exports = SoundCloudExtension;
