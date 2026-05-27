'use strict';

/**
 * Apple Music Extension for SpotiFLAC
 * Delivers true lossless ALAC (Apple Lossless) via gamdl.
 * Quality: 16-bit/44.1kHz CD lossless OR 24-bit/192kHz Hi-Res Lossless.
 *
 * One-time setup required:
 *  1. Log into music.apple.com in your browser
 *  2. Export cookies using "Get cookies.txt LOCALLY" browser extension
 *  3. Save to: C:\Users\<you>\.spotiflac\apple-music-cookies.txt
 */

const fetch = require('node-fetch');

const AMP_BASE = 'https://amp-api.music.apple.com';
const HOME_URL = 'https://music.apple.com';

let _jwt = null;
let _jwtExpiry = 0;

async function fetchJWT() {
  if (_jwt && Date.now() < _jwtExpiry) return _jwt;

  const r = await fetch(`${HOME_URL}/us/browse`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Encoding': 'identity',
      'Accept': 'text/html',
    }
  });

  if (!r.ok) throw new Error('Failed to fetch music.apple.com: ' + r.status);
  const html = await r.text();

  // Strategy 1: devToken= in iframes
  let m = html.match(/devToken=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (m) { _jwt = m[1]; _jwtExpiry = Date.now() + 3600000; return _jwt; }

  // Strategy 2: Known header prefix in HTML
  m = html.match(/(eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (m) { _jwt = m[1]; _jwtExpiry = Date.now() + 3600000; return _jwt; }

  // Strategy 3: Search JS bundles
  const bundles = [...html.matchAll(/src="(\/assets\/(?!.*-legacy)[^"]*\.js)"/g)].map(b => b[1]).slice(0, 6);
  for (const bundle of bundles) {
    const br = await fetch(`${HOME_URL}${bundle}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }
    });
    if (!br.ok) continue;
    const text = await br.text();
    const bm = text.match(/(eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    if (bm) { _jwt = bm[1]; _jwtExpiry = Date.now() + 3600000; return _jwt; }
  }

  throw new Error('Could not find Apple Music developer JWT');
}

async function ampGet(path, jwt) {
  // `path` may be a relative path or a full URL from the `next` pagination cursor
  const url = path.startsWith('https://') ? path : `${AMP_BASE}${path}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Origin': HOME_URL,
      'User-Agent': 'Mozilla/5.0',
    }
  });
  if (!r.ok) throw new Error(`amp-api ${r.status} for ${url}`);
  return r.json();
}

function artworkUrl(artwork, size) {
  if (!artwork || !artwork.url) return null;
  return artwork.url.replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg');
}

function mapSong(song, extraIds, storefront) {
  const a = song.attributes || {};
  const artUrl = artworkUrl(a.artwork, 500);
  const durationMs = a.durationInMillis || 0;

  const track = {
    id: `apm:${song.id}`,
    title: a.name || 'Unknown',
    artist: a.artistName || '',
    album: a.albumName || '',
    duration: Math.round(durationMs / 1000),
    thumbnail: artUrl,
    format: 'flac',
    bitrate: 0,
    quality: 'Lossless ALAC',
    source: 'Apple Music',
    trackNumber: a.trackNumber || null,
  };

  // Include relationship IDs when available (from search results or collection)
  if (extraIds) {
    if (extraIds.artistId) track.artistId = extraIds.artistId;
    if (extraIds.albumId) track.albumId = extraIds.albumId;
  } else {
    // Try to extract from relationships
    const sf = storefront || 'us';
    const rels = song.relationships || {};
    const artistData = rels.artists && rels.artists.data && rels.artists.data[0];
    const albumData = rels.albums && rels.albums.data && rels.albums.data[0];
    if (artistData) track.artistId = `apm-artist-${sf}:${artistData.id}`;
    if (albumData) track.albumId = `apm-album-${sf}:${albumData.id}`;
  }

  return track;
}

class AppleMusicExtension {
  constructor() {
    this.name = 'Apple Music';
    this.version = '1.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'True lossless ALAC downloads — 16-bit/44.1kHz or 24-bit/192kHz Hi-Res. Requires Apple Music cookies (one-time setup at /apple-setup).';
    this.capabilities = ['search', 'download', 'lossless'];
  }

  async search(query) {
    try {
      const jwt = await fetchJWT();
      const data = await ampGet(
        `/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=20&include[songs]=artists,albums`,
        jwt
      );
      const songs = (data.results && data.results.songs && data.results.songs.data) || [];
      return songs.map(s => mapSong(s, null));
    } catch (err) {
      console.error('[AppleMusic] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    try {
      const songId = trackId.replace(/^apm:/, '');
      return {
        streamUrl: `apm://${songId}`,
        downloadUrl: `apm://${songId}`,
        format: 'flac',
        lossless: true,
        quality: 'ALAC Lossless',
      };
    } catch (err) {
      console.error('[AppleMusic] resolve error:', err.message);
      return { streamUrl: null, downloadUrl: null };
    }
  }

  async getAlbum(albumId) {
    try {
      const sfMatch = albumId.match(/^apm-album(?:-([a-z]{2}))?:/);
      const storefront = (sfMatch && sfMatch[1]) || 'us';
      const rawId = albumId.replace(/^apm-album(?:-[a-z]{2})?:/, '');
      const jwt = await fetchJWT();
      const data = await ampGet(`/v1/catalog/${storefront}/albums/${rawId}?include=tracks,artists`, jwt);
      const album = data.data && data.data[0];
      if (!album) throw new Error('Album not found');

      const a = album.attributes || {};
      const artwork = artworkUrl(a.artwork, 500);
      const artworkHero = artworkUrl(a.artwork, 800);

      const artistRel = album.relationships && album.relationships.artists && album.relationships.artists.data && album.relationships.artists.data[0];
      const artistId = artistRel ? `apm-artist-${storefront}:${artistRel.id}` : null;
      const artistName = a.artistName || (artistRel && artistRel.attributes && artistRel.attributes.name) || 'Unknown Artist';

      // Paginate tracks — Apple Music API returns max 100 per page
      let tracksData = (album.relationships && album.relationships.tracks && album.relationships.tracks.data) || [];
      let nextUrl = album.relationships && album.relationships.tracks && album.relationships.tracks.next;
      while (nextUrl) {
        const page = await ampGet(nextUrl, jwt);
        tracksData = tracksData.concat(page.data || []);
        nextUrl = page.next || null;
      }
      const tracks = tracksData.map(s => mapSong(s, { artistId, albumId: `apm-album-${storefront}:${rawId}` }, storefront));

      return {
        type: 'album',
        id: `apm-album:${rawId}`,
        title: a.name || 'Unknown Album',
        artist: artistName,
        artistId,
        artwork,
        artworkHero,
        releaseDate: a.releaseDate ? a.releaseDate.slice(0, 4) : '',
        trackCount: tracks.length || a.trackCount || 0,
        tracks,
        source: 'Apple Music',
      };
    } catch (err) {
      console.error('[AppleMusic] getAlbum error:', err.message);
      throw err;
    }
  }

  async getArtist(artistId) {
    try {
      const sfMatch = artistId.match(/^apm-artist(?:-([a-z]{2}))?:/);
      const storefront = (sfMatch && sfMatch[1]) || 'us';
      const rawId = artistId.replace(/^apm-artist(?:-[a-z]{2})?:/, '');
      const jwt = await fetchJWT();

      // Fetch artist + albums in one call
      const data = await ampGet(`/v1/catalog/${storefront}/artists/${rawId}?include=albums`, jwt);
      const artist = data.data && data.data[0];
      if (!artist) throw new Error('Artist not found');

      const a = artist.attributes || {};
      const artwork = a.artwork ? artworkUrl(a.artwork, 500) : null;

      const albumsData = (artist.relationships && artist.relationships.albums && artist.relationships.albums.data) || [];
      const albums = albumsData.map(alb => {
        const aa = alb.attributes || {};
        return {
          id: `apm-album:${alb.id}`,
          title: aa.name || 'Unknown',
          artwork: artworkUrl(aa.artwork, 300),
          year: aa.releaseDate ? aa.releaseDate.slice(0, 4) : '',
          trackCount: aa.trackCount || 0,
        };
      });

      // Fetch top songs via the view endpoint (separate call)
      let topSongs = [];
      try {
        const tsData = await ampGet(`/v1/catalog/${storefront}/artists/${rawId}/view/top-songs?limit=10`, jwt);
        const tsSongs = (tsData.data) || [];
        topSongs = tsSongs.map(s => mapSong(s, { artistId: `apm-artist-${storefront}:${rawId}` }, storefront));
      } catch (tsErr) {
        console.warn('[AppleMusic] top-songs fetch failed:', tsErr.message);
      }

      return {
        type: 'artist',
        id: `apm-artist-${storefront}:${rawId}`,
        name: a.name || 'Unknown Artist',
        artwork,
        albums,
        topSongs,
        source: 'Apple Music',
      };
    } catch (err) {
      console.error('[AppleMusic] getArtist error:', err.message);
      throw err;
    }
  }

  async getPlaylist(playlistId) {
    try {
      const sfMatch = playlistId.match(/^apm-playlist(?:-([a-z]{2}))?:/);
      const storefront = (sfMatch && sfMatch[1]) || 'us';
      const rawId = playlistId.replace(/^apm-playlist(?:-[a-z]{2})?:/, '');
      const jwt = await fetchJWT();
      const data = await ampGet(`/v1/catalog/${storefront}/playlists/${rawId}?include=tracks`, jwt);
      const playlist = data.data && data.data[0];
      if (!playlist) throw new Error('Playlist not found');

      const a = playlist.attributes || {};
      const artwork = a.artwork ? artworkUrl(a.artwork, 500) : null;
      const artworkHero = a.artwork ? artworkUrl(a.artwork, 800) : null;

      // Paginate tracks — Apple Music API returns max 100 per page
      let tracksData = (playlist.relationships && playlist.relationships.tracks && playlist.relationships.tracks.data) || [];
      let nextUrl = playlist.relationships && playlist.relationships.tracks && playlist.relationships.tracks.next;
      console.log(`[AppleMusic] Playlist "${a.name}" — page 1: ${tracksData.length} tracks, next: ${nextUrl || 'none'}`);
      let page = 2;
      while (nextUrl) {
        const resp = await ampGet(nextUrl, jwt);
        const pageData = resp.data || [];
        tracksData = tracksData.concat(pageData);
        nextUrl = resp.next || null;
        console.log(`[AppleMusic] Playlist page ${page}: +${pageData.length} tracks (total ${tracksData.length}), next: ${nextUrl || 'none'}`);
        page++;
      }
      const tracks = tracksData.map(s => mapSong(s, null, storefront));

      return {
        type: 'playlist',
        id: `apm-playlist:${rawId}`,
        title: a.name || 'Unknown Playlist',
        description: a.description ? a.description.standard : '',
        curatorName: a.curatorName || '',
        artwork,
        artworkHero,
        trackCount: tracks.length,  // real count after full pagination
        tracks,
        source: 'Apple Music',
      };
    } catch (err) {
      console.error('[AppleMusic] getPlaylist error:', err.message);
      throw err;
    }
  }

  async resolveUrl(url) {
    // Parse Apple Music URLs:
    // https://music.apple.com/us/album/{name}/{id}
    // https://music.apple.com/us/album/{name}/{albumId}?i={songId}
    // https://music.apple.com/us/playlist/{name}/pl.{id}
    // https://music.apple.com/us/artist/{name}/{id}
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // parts = ['us'|'in'|..., 'album'|'artist'|'playlist', name, id]
      const storefront = parts[0] || 'us';
      const type = parts[1];
      const rawId = parts[3] || parts[2];
      const songId = u.searchParams.get('i');

      if (type === 'album') {
        if (songId) {
          return { type: 'song', id: `apm:${songId}`, source: 'Apple Music' };
        }
        return { type: 'album', id: `apm-album-${storefront}:${rawId}`, source: 'Apple Music' };
      } else if (type === 'artist') {
        return { type: 'artist', id: `apm-artist-${storefront}:${rawId}`, source: 'Apple Music' };
      } else if (type === 'playlist') {
        const plId = parts[3] || parts[2];
        return { type: 'playlist', id: `apm-playlist-${storefront}:${plId}`, source: 'Apple Music' };
      } else if (type === 'song') {
        return { type: 'song', id: `apm:${rawId}`, source: 'Apple Music' };
      }
      throw new Error(`Unknown Apple Music URL type: ${type}`);
    } catch (err) {
      console.error('[AppleMusic] resolveUrl error:', err.message);
      throw err;
    }
  }
}

module.exports = AppleMusicExtension;
