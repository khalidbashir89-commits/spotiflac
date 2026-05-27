# SpotiFLAC Extension Guide

Drop any `.js` file here that exports a class with the following interface:

```js
class MyExtension {
  constructor() {
    this.name = 'My Source';       // Display name
    this.version = '1.0.0';
    this.author = 'You';
    this.description = '...';
    this.capabilities = ['search', 'download'];
  }

  // Required: search for tracks
  async search(query) {
    // return array of Track objects (see below)
  }

  // Optional: resolve URLs for a track by ID
  async resolve(trackId) {
    return { streamUrl: '...', downloadUrl: '...' };
  }
}

module.exports = MyExtension;
```

## Track Object Shape

```js
{
  id:          'unique-string',
  title:       'Track Name',
  artist:      'Artist Name',
  album:       'Album Name',      // optional
  duration:    240,               // seconds, optional
  thumbnail:   'https://...',     // artwork URL, optional
  streamUrl:   'https://...',     // playable URL
  downloadUrl: 'https://...',     // download URL (defaults to streamUrl)
  format:      'flac',            // 'flac', 'mp3', 'wav', etc.
  bitrate:     1411,              // kbps, optional
}
```

## Notes
- The server sandbox allows `fetch`, `console`, `setTimeout`, `Promise`.
- You can `require('axios')` or `require('node-fetch')` inside an extension.
- No filesystem or child_process access is permitted.
- Reload extensions at runtime via the Extension Manager in the UI.
