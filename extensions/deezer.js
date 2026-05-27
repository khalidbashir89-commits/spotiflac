'use strict';

/**
 * Deezer Extension for SpotiFLAC
 * Search via Deezer public API (no auth needed).
 * Download via deemix CLI (requires Deezer ARL token + HiFi subscription for FLAC).
 *
 * Setup:
 *  1. pip install deemix
 *  2. Get your ARL token from Deezer browser cookies (deezer.com → DevTools → Application → Cookies → arl)
 *  3. Save to: C:\Users\<you>\.spotiflac\deezer-arl.txt
 *
 * FLAC quality requires an active Deezer HiFi (lossless) subscription.
 */

const fetch = require('node-fetch');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DEEZER_API = 'https://api.deezer.com';
const ARL_PATH = path.join(os.homedir(), '.spotiflac', 'deezer-arl.txt');

function getArl() {
  if (!fs.existsSync(ARL_PATH)) return null;
  const arl = fs.readFileSync(ARL_PATH, 'utf8').trim();
  return arl.length > 100 ? arl : null;
}

function mapTrack(t) {
  return {
    id: `dzr:${t.id}`,
    title: t.title || t.title_short || 'Unknown',
    artist: t.artist && t.artist.name || '',
    album: t.album && t.album.title || '',
    duration: t.duration || 0,
    thumbnail: t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium) || null,
    trackNumber: t.track_position || null,
    format: 'flac',
    quality: 'Deezer FLAC',
    source: 'Deezer',
    artistId: t.artist && t.artist.id ? `dzr-artist:${t.artist.id}` : null,
    albumId: t.album && t.album.id ? `dzr-album:${t.album.id}` : null,
  };
}

class DeezerExtension {
  constructor() {
    this.name = 'Deezer';
    this.version = '1.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'Deezer FLAC downloads via deemix. Requires ARL token (see /deezer-setup) and HiFi subscription.';
    this.capabilities = ['search', 'download', 'lossless'];
  }

  async search(query) {
    try {
      const url = `${DEEZER_API}/search/track?q=${encodeURIComponent(query)}&limit=20&output=json`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error(`Deezer API ${r.status}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message || 'Deezer API error');
      return (data.data || []).map(mapTrack);
    } catch (err) {
      console.error('[Deezer] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    const rawId = trackId.replace(/^dzr:/, '');
    return {
      streamUrl: `deemix://${rawId}`,
      downloadUrl: `deemix://${rawId}`,
      format: 'flac',
      lossless: true,
      quality: 'FLAC',
      deezerId: rawId,
    };
  }

  async getAlbum(albumId) {
    try {
      const rawId = albumId.replace(/^dzr-album:/, '');
      const r = await fetch(`${DEEZER_API}/album/${rawId}`, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error(`Deezer API ${r.status}`);
      const data = await r.json();

      const artwork = data.cover_xl || data.cover_big || data.cover_medium || null;
      const tracks = (data.tracks && data.tracks.data || []).map((t, i) => ({
        ...mapTrack({ ...t, album: { title: data.title, cover_xl: artwork, id: data.id }, artist: t.artist || { name: data.artist && data.artist.name || '' } }),
        trackNumber: t.track_position || i + 1,
        albumId: `dzr-album:${data.id}`,
        artistId: data.artist ? `dzr-artist:${data.artist.id}` : null,
      }));

      return {
        type: 'album',
        id: `dzr-album:${data.id}`,
        title: data.title || 'Unknown Album',
        artist: data.artist && data.artist.name || 'Unknown Artist',
        artistId: data.artist ? `dzr-artist:${data.artist.id}` : null,
        artwork,
        artworkHero: artwork,
        releaseDate: data.release_date ? data.release_date.slice(0, 4) : '',
        trackCount: tracks.length || data.nb_tracks || 0,
        tracks,
        source: 'Deezer',
      };
    } catch (err) {
      console.error('[Deezer] getAlbum error:', err.message);
      throw err;
    }
  }

  async getArtist(artistId) {
    try {
      const rawId = artistId.replace(/^dzr-artist:/, '');
      const [artistRes, albumsRes, topRes] = await Promise.all([
        fetch(`${DEEZER_API}/artist/${rawId}`, { headers: { 'Accept': 'application/json' } }),
        fetch(`${DEEZER_API}/artist/${rawId}/albums?limit=50`, { headers: { 'Accept': 'application/json' } }),
        fetch(`${DEEZER_API}/artist/${rawId}/top?limit=10`, { headers: { 'Accept': 'application/json' } }),
      ]);

      const artist = await artistRes.json();
      const albumsData = await albumsRes.json();
      const topData = await topRes.json();

      const artwork = artist.picture_xl || artist.picture_big || artist.picture_medium || null;
      const albums = (albumsData.data || []).map(alb => ({
        id: `dzr-album:${alb.id}`,
        title: alb.title,
        artwork: alb.cover_xl || alb.cover_big || alb.cover_medium || null,
        releaseDate: alb.release_date ? alb.release_date.slice(0, 4) : '',
        trackCount: alb.nb_tracks || 0,
        source: 'Deezer',
      }));
      const topSongs = (topData.data || []).map(mapTrack);

      return {
        type: 'artist',
        id: `dzr-artist:${artist.id}`,
        name: artist.name || 'Unknown Artist',
        artwork,
        artworkHero: artwork,
        albums,
        topSongs,
        source: 'Deezer',
      };
    } catch (err) {
      console.error('[Deezer] getArtist error:', err.message);
      throw err;
    }
  }

  hasArl() {
    return getArl() !== null;
  }
}

module.exports = DeezerExtension;
