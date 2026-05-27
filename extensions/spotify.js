'use strict';

/**
 * Spotify Extension for SpotiFLAC
 * Search via Spotify Web API (no login needed — uses app-level access token).
 * Download via spotDL which sources audio from YouTube.
 *
 * Note: spotDL output is NOT lossless (YouTube-sourced AAC converted to FLAC).
 * Quality matches best available YouTube stream (~128-256kbps).
 *
 * Setup:
 *  1. pip install spotdl
 *  2. Create a Spotify app at https://developer.spotify.com/dashboard
 *  3. Save Client ID and Secret to C:\Users\<you>\.spotiflac\spotify-credentials.json
 *     { "clientId": "...", "clientSecret": "..." }
 *
 * OR — skip the credentials file entirely and just paste Spotify URLs
 * into the "Open URL" field to load playlists/albums.
 */

const fetch = require('node-fetch');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const CREDS_PATH = path.join(os.homedir(), '.spotiflac', 'spotify-credentials.json');

let _token = null;
let _tokenExpiry = 0;

function getCreds() {
  if (!fs.existsSync(CREDS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  } catch { return null; }
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const creds = getCreds();
  if (!creds || !creds.clientId || !creds.clientSecret) {
    throw new Error('Spotify credentials not configured. Save clientId/clientSecret to ~/.spotiflac/spotify-credentials.json');
  }

  const b64 = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${b64}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`Spotify token error: ${r.status}`);
  const data = await r.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

async function spotifyGet(endpoint) {
  const token = await getToken();
  const r = await fetch(`${SPOTIFY_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!r.ok) throw new Error(`Spotify API ${r.status} for ${endpoint}`);
  return r.json();
}

function mapTrack(t) {
  const album = t.album || {};
  const artwork = (album.images && album.images[0] && album.images[0].url) || null;
  const artists = (t.artists || []).map(a => a.name).join(', ');
  const firstArtist = t.artists && t.artists[0];
  return {
    id: `spf:${t.id}`,
    title: t.name || 'Unknown',
    artist: artists,
    album: album.name || '',
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
    thumbnail: artwork,
    trackNumber: t.track_number || null,
    format: 'flac',
    quality: 'YouTube (via spotDL)',
    source: 'Spotify',
    artistId: firstArtist ? `spf-artist:${firstArtist.id}` : null,
    albumId: album.id ? `spf-album:${album.id}` : null,
    spotifyUrl: t.external_urls && t.external_urls.spotify || null,
  };
}

class SpotifyExtension {
  constructor() {
    this.name = 'Spotify';
    this.version = '1.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'Spotify search (requires credentials) + spotDL downloads. Audio sourced from YouTube — not lossless.';
    this.capabilities = ['search', 'stream'];
  }

  async search(query) {
    try {
      const data = await spotifyGet(`/search?q=${encodeURIComponent(query)}&type=track&limit=20`);
      return (data.tracks && data.tracks.items || []).filter(Boolean).map(mapTrack);
    } catch (err) {
      console.error('[Spotify] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    const rawId = trackId.replace(/^spf:/, '');
    return {
      streamUrl: `spotdl://${rawId}`,
      downloadUrl: `spotdl://${rawId}`,
      format: 'flac',
      lossless: false,
      quality: 'YouTube via spotDL',
      spotifyId: rawId,
    };
  }

  async resolveUrl(url) {
    // Handle pasted Spotify URLs
    const trackMatch = url.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
    const albumMatch = url.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/);
    const artistMatch = url.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]+)/);
    const playlistMatch = url.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);

    if (trackMatch) return { type: 'song', id: `spf:${trackMatch[1]}`, source: 'Spotify' };
    if (albumMatch) return { type: 'album', id: `spf-album:${albumMatch[1]}`, source: 'Spotify' };
    if (artistMatch) return { type: 'artist', id: `spf-artist:${artistMatch[1]}`, source: 'Spotify' };
    if (playlistMatch) return { type: 'playlist', id: `spf-playlist:${playlistMatch[1]}`, source: 'Spotify' };
    throw new Error('Unrecognised Spotify URL');
  }

  async getAlbum(albumId) {
    try {
      const rawId = albumId.replace(/^spf-album:/, '');
      const data = await spotifyGet(`/albums/${rawId}`);

      const artwork = data.images && data.images[0] && data.images[0].url || null;
      const artistId = data.artists && data.artists[0] ? `spf-artist:${data.artists[0].id}` : null;
      const tracks = (data.tracks && data.tracks.items || []).map((t, i) => ({
        ...mapTrack({ ...t, album: data }),
        trackNumber: t.track_number || i + 1,
        thumbnail: artwork,
      }));

      return {
        type: 'album',
        id: `spf-album:${data.id}`,
        title: data.name || 'Unknown Album',
        artist: (data.artists || []).map(a => a.name).join(', '),
        artistId,
        artwork,
        artworkHero: artwork,
        releaseDate: data.release_date ? data.release_date.slice(0, 4) : '',
        trackCount: tracks.length,
        tracks,
        source: 'Spotify',
      };
    } catch (err) {
      console.error('[Spotify] getAlbum error:', err.message);
      throw err;
    }
  }

  async getArtist(artistId) {
    try {
      const rawId = artistId.replace(/^spf-artist:/, '');
      const [artist, albumsData, topData] = await Promise.all([
        spotifyGet(`/artists/${rawId}`),
        spotifyGet(`/artists/${rawId}/albums?limit=50&include_groups=album,single`),
        spotifyGet(`/artists/${rawId}/top-tracks?market=US`),
      ]);

      const artwork = artist.images && artist.images[0] && artist.images[0].url || null;
      const albums = (albumsData.items || []).map(alb => ({
        id: `spf-album:${alb.id}`,
        title: alb.name,
        artwork: alb.images && alb.images[0] && alb.images[0].url || null,
        releaseDate: alb.release_date ? alb.release_date.slice(0, 4) : '',
        trackCount: alb.total_tracks || 0,
        source: 'Spotify',
      }));
      const topSongs = (topData.tracks || []).map(mapTrack);

      return {
        type: 'artist',
        id: `spf-artist:${artist.id}`,
        name: artist.name,
        artwork,
        artworkHero: artwork,
        albums,
        topSongs,
        source: 'Spotify',
      };
    } catch (err) {
      console.error('[Spotify] getArtist error:', err.message);
      throw err;
    }
  }

  async getPlaylist(playlistId) {
    try {
      const rawId = playlistId.replace(/^spf-playlist:/, '');
      const data = await spotifyGet(`/playlists/${rawId}`);

      const artwork = data.images && data.images[0] && data.images[0].url || null;
      let items = data.tracks && data.tracks.items || [];

      // Paginate
      let nextUrl = data.tracks && data.tracks.next;
      while (nextUrl) {
        const token = await getToken();
        const pr = await fetch(nextUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        const pd = await pr.json();
        items = items.concat(pd.items || []);
        nextUrl = pd.next || null;
      }

      const tracks = items
        .filter(item => item && item.track && item.track.id)
        .map(item => mapTrack(item.track));

      return {
        type: 'playlist',
        id: `spf-playlist:${data.id}`,
        title: data.name || 'Unknown Playlist',
        artist: data.owner && data.owner.display_name || 'Spotify',
        artwork,
        artworkHero: artwork,
        trackCount: tracks.length,
        tracks,
        source: 'Spotify',
      };
    } catch (err) {
      console.error('[Spotify] getPlaylist error:', err.message);
      throw err;
    }
  }

  hasCredentials() {
    return getCreds() !== null;
  }
}

module.exports = SpotifyExtension;
