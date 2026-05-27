/**
 * SpotiFLAC Demo Extension
 *
 * This extension demonstrates the SpotiFLAC extension API using the
 * Free Music Archive (FMA) public API, which provides genuinely free,
 * legally downloadable music including lossless formats.
 *
 * API docs: https://freemusicarchive.org/api
 */

class FreeHDMusicExtension {
  constructor() {
    this.name = 'Free HD Music';
    this.version = '1.2.0';
    this.author = 'SpotiFLAC';
    this.description = 'Searches the Free Music Archive for freely-downloadable high-quality tracks. Great for testing the extension framework.';
    this.capabilities = ['search', 'download'];
    this._baseUrl = 'https://freemusicarchive.org/api';
    this._apiKey = 'FMA_DEMO'; // Public demo key
  }

  async search(query) {
    try {
      // FMA public search endpoint
      const url = `${this._baseUrl}/get/tracks.json?track_title=${encodeURIComponent(query)}&limit=20&api_key=${this._apiKey}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SpotiFLAC/1.0' },
      });

      if (!res.ok) {
        // Fallback to demo tracks if FMA is unavailable
        return this._getDemoTracks(query);
      }

      const data = await res.json();
      if (!data.dataset || !data.dataset.length) return this._getDemoTracks(query);

      return data.dataset.map(track => this._mapTrack(track));
    } catch (err) {
      console.warn('[FreeHDMusic] FMA API unavailable, using demo tracks:', err.message);
      return this._getDemoTracks(query);
    }
  }

  async resolve(trackId) {
    // For FMA tracks, the download URL follows a predictable pattern
    // In a real extension this would make an API call to get the actual URL
    try {
      const res = await fetch(`${this._baseUrl}/get/tracks.json?track_id=${trackId}&api_key=${this._apiKey}`);
      if (res.ok) {
        const data = await res.json();
        if (data.dataset && data.dataset[0]) {
          const t = data.dataset[0];
          return {
            streamUrl: t.track_file || t.track_listen_url || null,
            downloadUrl: t.track_file || null,
          };
        }
      }
    } catch (err) {
      console.warn('[FreeHDMusic] resolve failed:', err.message);
    }
    return { streamUrl: null, downloadUrl: null };
  }

  _mapTrack(t) {
    return {
      id: String(t.track_id || t.id),
      title: t.track_title || t.title || 'Unknown',
      artist: t.artist_name || t.track_artist_name || '',
      album: t.album_title || '',
      duration: parseInt(t.track_duration || t.duration || 0, 10),
      thumbnail: t.track_image_file || t.album_image || null,
      streamUrl: t.track_file || t.track_listen_url || null,
      downloadUrl: t.track_file || null,
      format: 'mp3', // FMA free tier is MP3; premium would be FLAC
      bitrate: 128,
    };
  }

  /**
   * Demo tracks returned when the live API is unavailable.
   * Uses actual CC-licensed audio files from the Internet Archive
   * that are publicly accessible.
   */
  _getDemoTracks(query) {
    const demos = [
      {
        id: 'demo-ia-1',
        title: 'Kevin MacLeod - Cipher',
        artist: 'Kevin MacLeod',
        album: 'Royalty Free',
        duration: 204,
        thumbnail: null,
        streamUrl: 'https://archive.org/download/kevin-macleod-cipher/cipher.mp3',
        downloadUrl: 'https://archive.org/download/kevin-macleod-cipher/cipher.mp3',
        format: 'mp3',
        bitrate: 128,
      },
      {
        id: 'demo-ia-2',
        title: 'Gymnopedie No 1',
        artist: 'Erik Satie',
        album: 'Classical Piano',
        duration: 192,
        thumbnail: null,
        streamUrl: 'https://ia800201.us.archive.org/1/items/piano_solo/gymnopedie1.mp3',
        downloadUrl: 'https://ia800201.us.archive.org/1/items/piano_solo/gymnopedie1.mp3',
        format: 'mp3',
        bitrate: 128,
      },
      {
        id: 'demo-ia-3',
        title: 'Für Elise',
        artist: 'Ludwig van Beethoven',
        album: 'Classical Piano',
        duration: 210,
        thumbnail: null,
        streamUrl: 'https://ia800201.us.archive.org/1/items/piano_solo/fur_elise.mp3',
        downloadUrl: 'https://ia800201.us.archive.org/1/items/piano_solo/fur_elise.mp3',
        format: 'mp3',
        bitrate: 128,
      },
    ];

    const q = query.toLowerCase();
    const filtered = demos.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
    );

    // Return all demos if nothing matches the query
    return filtered.length ? filtered : demos.map(d => ({ ...d, title: `${d.title} (search: ${query})` }));
  }
}

module.exports = FreeHDMusicExtension;
module.exports.default = FreeHDMusicExtension;
