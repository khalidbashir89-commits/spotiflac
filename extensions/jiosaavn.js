'use strict';

/**
 * JioSaavn Extension for SpotiFLAC
 * Searches JioSaavn and delivers 320kbps AAC streams.
 */

const fetch = require('node-fetch');

const API = 'https://www.jiosaavn.com/api.php';
const CDN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': CDN_UA,
  'Accept': 'application/json',
  'Referer': 'https://www.jiosaavn.com/',
};

function apiUrl(params) {
  const base = API + '?_format=json&_marker=0&ctx=wap6dot0&';
  return base + Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

async function jioGet(params) {
  const url = apiUrl(params);
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`JioSaavn API error: ${res.status}`);
  return res.json();
}

function mapImage(img) {
  if (!img) return null;
  return img.replace(/150x150/g, '500x500').replace(/50x50/g, '500x500');
}

function mapSong(s) {
  if (!s || !s.id) return null;
  const enc = s.encrypted_media_url;
  if (!enc) return null;
  // Embed song ID and encrypted URL in track ID (separated by |||)
  const id = `${s.id}|||${enc}`;
  const artist = s.primary_artists || s.music || s.singers || '';
  const album = s.album || s.song || '';
  return {
    id,
    title: decodeHTMLEntities(s.song || s.title || 'Unknown'),
    artist: decodeHTMLEntities(artist),
    album: decodeHTMLEntities(album),
    duration: parseInt(s.duration || 0, 10),
    thumbnail: mapImage(s.image),
    format: 'm4a',
    bitrate: 320,
  };
}

function decodeHTMLEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

async function getAuthUrl(encryptedMediaUrl) {
  const data = await jioGet({
    __call: 'song.generateAuthToken',
    url: encryptedMediaUrl,
    bitrate: '320',
    api_version: '4',
  });
  return data.auth_url || null;
}

class JioSaavnExtension {
  constructor() {
    this.name = 'JioSaavn';
    this.version = '2.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'JioSaavn 320kbps music provider — excellent for Indian/Bollywood music';
    this.capabilities = ['search', 'download', 'stream'];
  }

  async search(query) {
    try {
      const data = await jioGet({ __call: 'search.getResults', q: query, p: '1', n: '20' });
      const results = data.results || [];
      return results.map(mapSong).filter(Boolean);
    } catch (err) {
      console.error('[JioSaavn] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    try {
      const sep = trackId.indexOf('|||');
      if (sep === -1) throw new Error('Invalid JioSaavn track ID');
      const enc = trackId.slice(sep + 3);
      const authUrl = await getAuthUrl(enc);
      if (!authUrl) throw new Error('Failed to get JioSaavn auth URL');
      return {
        streamUrl: authUrl,
        downloadUrl: authUrl,
        format: 'm4a',
        bitrate: 320,
        cdnHeaders: { 'User-Agent': CDN_UA, 'Referer': 'https://www.jiosaavn.com/' },
      };
    } catch (err) {
      console.error('[JioSaavn] resolve error:', err.message);
      return { streamUrl: null, downloadUrl: null };
    }
  }
}

module.exports = JioSaavnExtension;
