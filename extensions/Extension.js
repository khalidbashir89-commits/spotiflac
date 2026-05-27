/**
 * SpotiFLAC Extension Base Class
 *
 * All SpotiFLAC extensions must extend this class and implement at minimum:
 *   - search(query)  → returns an array of Track objects
 *
 * Optionally implement:
 *   - resolve(trackId) → returns { streamUrl, downloadUrl } for a given track ID
 *
 * Track object shape:
 * {
 *   id:          string   — unique identifier (within this extension)
 *   title:       string   — track name
 *   artist:      string   — artist name
 *   album:       string   — album name (optional)
 *   duration:    number   — length in seconds (optional)
 *   thumbnail:   string   — artwork URL (optional)
 *   streamUrl:   string   — direct playable URL (optional, provide if known)
 *   downloadUrl: string   — direct download URL (optional, defaults to streamUrl)
 *   format:      string   — audio format, e.g. 'flac', 'mp3' (default: 'flac')
 *   bitrate:     number   — in kbps (optional)
 * }
 */
class Extension {
  constructor() {
    this.name = 'BaseExtension';
    this.version = '1.0.0';
    this.author = 'Unknown';
    this.description = 'Base extension class — do not use directly.';
    this.capabilities = ['search'];
  }

  /**
   * Search for tracks matching the query.
   * @param {string} query
   * @returns {Promise<Track[]>}
   */
  async search(query) {
    throw new Error(`Extension '${this.name}' must implement search()`);
  }

  /**
   * Resolve the stream/download URL for a track by ID.
   * Implement this if URLs are not available at search time.
   * @param {string} trackId
   * @returns {Promise<{ streamUrl?: string, downloadUrl?: string }>}
   */
  async resolve(trackId) {
    throw new Error(`Extension '${this.name}' does not support URL resolution`);
  }
}

module.exports = Extension;
module.exports.default = Extension;
