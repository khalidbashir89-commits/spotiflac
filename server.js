'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { URL } = require('url');
const os = require('os');
const fs = require('fs');
const { ZipArchive } = require('archiver');
const {
  loadExtensions, searchAll, resolveTrack, getExtensionMeta,
  setExtensionEnabled, installExtension, uninstallExtension,
  getExtensionInstance,
} = require('./server/extensionManager');
const { getRegistry, fetchAndCache } = require('./server/registry');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Paths ──────────────────────────────────────────────────────

const SPOTIFLAC_DIR = path.join(os.homedir(), '.spotiflac');
const FFMPEG = (() => {
  const local = path.join(SPOTIFLAC_DIR, 'ffmpeg.exe');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
})();
const YTDLP = (() => {
  const candidates = ['yt-dlp', 'yt-dlp.exe'];
  for (const c of candidates) {
    try { require('child_process').execSync(`${c} --version`, { timeout: 3000 }); return c; } catch {}
  }
  return 'yt-dlp';
})();

const APPLE_COOKIES_PATH = path.join(SPOTIFLAC_DIR, 'apple-music-cookies.txt');
const APPLE_DOWNLOAD_TEMP = path.join(os.tmpdir(), 'spotiflac_apple');

function appleHasCookies() {
  return fs.existsSync(APPLE_COOKIES_PATH) && fs.statSync(APPLE_COOKIES_PATH).size > 100;
}

// ── Middleware ─────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Boot ───────────────────────────────────────────────────────

async function boot() {
  await loadExtensions();
  console.log('[Server] Extensions initialized');
  getRegistry().catch(err => console.warn('[Server] Registry fetch failed:', err.message));
}

// ── Extension API ──────────────────────────────────────────────

app.get('/api/extensions', (req, res) => {
  res.json({ extensions: getExtensionMeta() });
});

app.post('/api/extensions/reload', async (req, res) => {
  try {
    await loadExtensions();
    res.json({ ok: true, extensions: getExtensionMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extensions/toggle', async (req, res) => {
  const { filename, enabled } = req.body;
  if (!filename || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Missing filename or enabled' });
  }
  try {
    const extensions = await setExtensionEnabled(filename, enabled);
    res.json({ ok: true, extensions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extensions/install', async (req, res) => {
  const { rawUrl, filename } = req.body;
  if (!rawUrl) return res.status(400).json({ error: 'Missing rawUrl' });
  try {
    const result = await installExtension(rawUrl, filename);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/extensions/uninstall', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'Missing filename' });
  try {
    uninstallExtension(filename);
    res.json({ ok: true, extensions: getExtensionMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Registry ───────────────────────────────────────────────────

app.get('/api/registry', async (req, res) => {
  try {
    const data = await getRegistry();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/registry/refresh', async (req, res) => {
  try {
    const data = await fetchAndCache();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Search ─────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    res.json(await searchAll(q));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resolve', async (req, res) => {
  const { trackId, source } = req.query;
  if (!trackId || !source) return res.status(400).json({ error: 'Missing trackId or source' });
  try {
    const result = await resolveTrack(trackId, source);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Collection (Album/Artist/Playlist) ────────────────────────

// GET /api/collection?type=album|artist|playlist&id=X&source=Apple+Music
app.get('/api/collection', async (req, res) => {
  const { type, id, source } = req.query;
  if (!type || !id) return res.status(400).json({ error: 'Missing type or id' });

  try {
    const srcName = source || 'Apple Music';
    const ext = getExtensionInstance(srcName);
    if (!ext) return res.status(404).json({ error: `Extension '${srcName}' not found or disabled` });

    let data;
    if (type === 'album') {
      if (typeof ext.getAlbum !== 'function') return res.status(501).json({ error: 'Extension does not support getAlbum' });
      data = await ext.getAlbum(id);
    } else if (type === 'artist') {
      if (typeof ext.getArtist !== 'function') return res.status(501).json({ error: 'Extension does not support getArtist' });
      data = await ext.getArtist(id);
    } else if (type === 'playlist') {
      if (typeof ext.getPlaylist !== 'function') return res.status(501).json({ error: 'Extension does not support getPlaylist' });
      data = await ext.getPlaylist(id);
    } else {
      return res.status(400).json({ error: `Unknown collection type: ${type}` });
    }

    res.json(data);
  } catch (err) {
    console.error('[Collection] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apple-url  { url: 'https://music.apple.com/...' }
app.post('/api/apple-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const ext = getExtensionInstance('Apple Music');
    if (!ext) return res.status(404).json({ error: 'Apple Music extension not found or disabled' });
    if (typeof ext.resolveUrl !== 'function') return res.status(501).json({ error: 'Extension does not support resolveUrl' });

    const result = await ext.resolveUrl(url);
    res.json(result);
  } catch (err) {
    console.error('[AppleURL] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FLAC Download ──────────────────────────────────────────────

// GET /api/download-flac?trackId=X&source=Y&title=T&artist=A
app.get('/api/download-flac', async (req, res) => {
  const { trackId, source } = req.query;
  const title = (req.query.title || 'Track').replace(/[<>:"/\\|?*]/g, '_');
  const artist = (req.query.artist || 'Unknown').replace(/[<>:"/\\|?*]/g, '_');
  const filename = `${artist} - ${title}.flac`;

  if (!trackId || !source) return res.status(400).json({ error: 'Missing trackId or source' });

  try {
    const resolved = await resolveTrack(trackId, source);
    const url = resolved.downloadUrl || resolved.streamUrl;
    if (!url) return res.status(404).json({ error: 'No download URL available' });

    res.setHeader('Content-Type', 'audio/flac');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (url.startsWith('apm://')) {
      // Apple Music via gamdl → true lossless ALAC → FLAC
      const songId = url.replace('apm://', '');
      if (!appleHasCookies()) {
        return res.status(403).json({
          error: 'Apple Music cookies not configured',
          setup: 'Visit /apple-setup for instructions',
        });
      }
      await downloadAppleFlac(songId, res, title, artist);
    } else if (url.startsWith('ytm://')) {
      // YouTube Music via yt-dlp
      const videoId = url.replace('ytm://', '');
      await downloadYtFlac(videoId, res, resolved);
    } else {
      // Direct URL (JioSaavn CDN, etc.) → pipe through ffmpeg
      await downloadUrlFlac(url, res, resolved);
    }
  } catch (err) {
    console.error('[Download] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Apple Music: gamdl → ALAC M4A → FLAC (true lossless)
function downloadAppleFlac(songId, res, title, artist) {
  return new Promise((resolve_p, reject) => {
    const appleUrl = `https://music.apple.com/us/song/${songId}`;
    const tmpDir = path.join(APPLE_DOWNLOAD_TEMP, `job_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log('[Apple] Downloading song', songId, 'via gamdl...');

    const gamdl = spawn('python', [
      '-m', 'gamdl',
      '--cookies-path', APPLE_COOKIES_PATH,
      '--output-path', tmpDir,
      '--temp-path', tmpDir,
      '--song-codec-priority', 'aac-web,aac-he-web,aac',
      '--no-synced-lyrics',
      '--overwrite',
      '--log-level', 'WARNING',
      appleUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let gamdlOut = '', gamdlErr = '';
    gamdl.stdout.on('data', d => { gamdlOut += d; });
    gamdl.stderr.on('data', d => { gamdlErr += d; });

    gamdl.on('error', e => { fs.rmSync(tmpDir, { recursive: true, force: true }); reject(e); });
    gamdl.on('close', code => {
      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const msg = (gamdlErr + gamdlOut).slice(-500);
        if (msg.includes('cookies') || msg.includes('auth') || msg.includes('subscription')) {
          return reject(new Error('Apple Music cookies invalid or expired. Visit /apple-setup to reconfigure.'));
        }
        return reject(new Error(`gamdl exit ${code}: ${msg.slice(-200)}`));
      }

      // Find the downloaded M4A file
      function findM4A(dir) {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (fs.statSync(full).isDirectory()) { const r = findM4A(full); if (r) return r; }
          else if (f.endsWith('.m4a') || f.endsWith('.alac') || f.endsWith('.flac')) return full;
        }
        return null;
      }
      const m4aPath = findM4A(tmpDir);
      if (!m4aPath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return reject(new Error('gamdl succeeded but no audio file found'));
      }

      const flacPath = m4aPath.replace(/\.(m4a|alac)$/, '.flac');
      console.log('[Apple] Converting', path.basename(m4aPath), '→ FLAC...');

      const ff = spawn(FFMPEG, ['-y', '-i', m4aPath, '-c:a', 'flac', '-compression_level', '5', flacPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let ffErr = '';
      ff.stderr.on('data', d => { ffErr += d; });
      ff.on('error', e => { fs.rmSync(tmpDir, { recursive: true, force: true }); reject(e); });
      ff.on('close', ffCode => {
        fs.unlink(m4aPath, () => {});
        if (ffCode !== 0) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return reject(new Error('ffmpeg ALAC→FLAC failed: ' + ffErr.slice(-200)));
        }

        const flacSize = fs.statSync(flacPath).size;
        if (flacSize > 0) res.setHeader('Content-Length', flacSize);

        const stream = fs.createReadStream(flacPath);
        stream.pipe(res, { end: false });
        stream.on('end', () => { res.end(); fs.rmSync(tmpDir, { recursive: true, force: true }); resolve_p(); });
        stream.on('error', e => { fs.rmSync(tmpDir, { recursive: true, force: true }); reject(e); });
        res.on('close', () => { stream.destroy(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
      });
    });
  });
}

function downloadYtFlac(videoId, res, resolved) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://music.youtube.com/watch?v=${videoId}`;
    const ytUA = resolved.iosUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

    // Try direct URL first if available
    if (resolved.streamUrl && !resolved.streamUrl.startsWith('ytm://')) {
      return downloadUrlFlac(resolved.streamUrl, res, { iosUserAgent: ytUA }).then(resolve).catch(() => {
        // Fall back to yt-dlp
        ytdlpFlac(ytUrl, res).then(resolve).catch(reject);
      });
    }
    ytdlpFlac(ytUrl, res).then(resolve).catch(reject);
  });
}

function ytdlpFlac(ytUrl, res) {
  return new Promise((resolve, reject) => {
    console.log('[yt-dlp] Downloading:', ytUrl);
    const ytdlp = spawn(YTDLP, [
      '--format', 'bestaudio',
      '--no-playlist',
      '-o', '-',
      ytUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ff = spawn(FFMPEG, [
      '-y', '-i', 'pipe:0',
      '-c:a', 'flac',
      '-compression_level', '5',
      '-f', 'flac',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let ytErr = '', ffErr = '';
    ytdlp.stderr.on('data', d => { ytErr += d; });
    ff.stderr.on('data', d => { ffErr += d; });

    ytdlp.stdout.pipe(ff.stdin);
    ytdlp.on('error', reject);
    ytdlp.on('close', code => {
      if (code !== 0 && code !== null) {
        console.error('[yt-dlp] exited', code, ytErr.slice(-300));
        ff.stdin.destroy();
      }
    });

    ff.stdout.pipe(res, { end: false });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code === 0) { res.end(); resolve(); }
      else { console.error('[ffmpeg] exited', code, ffErr.slice(-300)); reject(new Error('ffmpeg exit ' + code)); }
    });

    res.on('close', () => { ytdlp.kill(); ff.kill(); });
  });
}

function downloadUrlFlac(url, res, resolved) {
  return new Promise((resolve_p, reject) => {
    const headers = buildDownloadHeaders(url, resolved);
    console.log('[Download] URL:', url.substring(0, 80) + '...');

    // Download to a temp file first so ffmpeg can write correct FLAC duration metadata
    const tmpPath = path.join(os.tmpdir(), `spotiflac_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);

    const flacPath = tmpPath + '.flac';

    fetchStream(url, headers, (err, stream) => {
      if (err) return reject(err);

      const tmpFile = fs.createWriteStream(tmpPath);
      stream.pipe(tmpFile);
      stream.on('error', e => { tmpFile.destroy(); cleanup(); reject(e); });

      function cleanup() { [tmpPath, flacPath].forEach(p => fs.unlink(p, () => {})); }

      tmpFile.on('finish', () => {
        // Convert to a real FLAC file so STREAMINFO has correct duration
        const ff = spawn(FFMPEG, [
          '-y', '-i', tmpPath,
          '-c:a', 'flac',
          '-compression_level', '5',
          flacPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let ffErr = '';
        ff.stderr.on('data', d => { ffErr += d; });
        ff.on('error', e => { cleanup(); reject(e); });
        ff.on('close', code => {
          fs.unlink(tmpPath, () => {});
          if (code !== 0) { cleanup(); return reject(new Error('ffmpeg exit ' + code + '\n' + ffErr.slice(-200))); }

          // Stream the FLAC file
          const flacSize = fs.existsSync(flacPath) ? fs.statSync(flacPath).size : 0;
          if (flacSize > 0) res.setHeader('Content-Length', flacSize);

          const readStream = fs.createReadStream(flacPath);
          readStream.pipe(res, { end: false });
          readStream.on('end', () => { res.end(); cleanup(); resolve_p(); });
          readStream.on('error', e => { cleanup(); reject(e); });
          res.on('close', () => { readStream.destroy(); cleanup(); });
        });
      });

      tmpFile.on('error', e => { cleanup(); reject(e); });
    });
  });
}

function buildDownloadHeaders(url, resolved) {
  const headers = {};
  // JioSaavn CDN requires Chrome UA + Referer
  if (url.includes('saavncdn.com') || url.includes('jiosaavn.com')) {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    headers['Referer'] = 'https://www.jiosaavn.com/';
  } else if (resolved && resolved.iosUserAgent) {
    headers['User-Agent'] = resolved.iosUserAgent;
  } else {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }
  return headers;
}

// ── Proxy ──────────────────────────────────────────────────────

const PRIVATE_ADDR = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i;

function validateProxyUrl(rawUrl, res) {
  let u;
  try { u = new URL(rawUrl); } catch { res.status(400).json({ error: 'Invalid URL' }); return null; }
  if (PRIVATE_ADDR.test(u.hostname)) { res.status(403).json({ error: 'Blocked: local address' }); return null; }
  if (!['http:', 'https:'].includes(u.protocol)) { res.status(403).json({ error: 'Only http/https allowed' }); return null; }
  return u;
}

function getProxyHeaders(url) {
  const h = { 'User-Agent': 'Mozilla/5.0 (compatible; SpotiFLAC/1.0)', 'Accept': '*/*' };
  if (url.includes('saavncdn.com') || url.includes('jiosaavn.com')) {
    h['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    h['Referer'] = 'https://www.jiosaavn.com/';
  }
  return h;
}

app.get('/api/proxy-download', async (req, res) => {
  const u = validateProxyUrl(req.query.url, res);
  if (!u) return;
  try { await proxyRequest(u.href, req, res, false); }
  catch (err) { if (!res.headersSent) res.status(502).json({ error: err.message }); }
});

app.get('/api/proxy-stream', async (req, res) => {
  const u = validateProxyUrl(req.query.url, res);
  if (!u) return;
  // Handle ytm:// scheme — use yt-dlp
  if (req.query.url.startsWith('ytm://')) {
    const videoId = req.query.url.replace('ytm://', '');
    res.setHeader('Content-Type', 'audio/flac');
    return ytdlpFlac(`https://music.youtube.com/watch?v=${videoId}`, res);
  }
  try { await proxyRequest(u.href, req, res, true); }
  catch (err) { if (!res.headersSent) res.status(502).json({ error: err.message }); }
});

function fetchStream(url, headers, callback) {
  const proto = url.startsWith('https') ? https : http;
  const req = proto.get(url, { headers }, res => {
    if ([301, 302, 307, 308].includes(res.statusCode)) {
      res.resume();
      const loc = res.headers.location;
      if (!loc) return callback(new Error('Redirect with no Location'));
      return fetchStream(loc, headers, callback);
    }
    callback(null, res);
  });
  req.on('error', callback);
  req.setTimeout(30000, () => { req.destroy(); callback(new Error('Timeout')); });
}

function proxyRequest(url, clientReq, clientRes, forwardRange) {
  return new Promise((resolve, reject) => {
    const headers = getProxyHeaders(url);
    if (forwardRange && clientReq.headers.range) headers['Range'] = clientReq.headers.range;

    fetchStream(url, headers, (err, upRes) => {
      if (err) return reject(err);
      ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']
        .forEach(h => upRes.headers[h] && clientRes.setHeader(h, upRes.headers[h]));
      clientRes.setHeader('Access-Control-Allow-Origin', '*');
      clientRes.setHeader('Cache-Control', 'no-store');
      clientRes.status(upRes.statusCode);
      upRes.pipe(clientRes);
      upRes.on('end', resolve);
      upRes.on('error', reject);
    });
  });
}

// ── Batch ZIP Download ─────────────────────────────────────────
// POST /api/download-zip  { tracks: [{ id, source, title, artist }] }
// Packages all tracks as individual FLAC files inside one ZIP.

app.post('/api/download-zip', async (req, res) => {
  const { tracks } = req.body;
  if (!tracks || !tracks.length) return res.status(400).json({ error: 'No tracks provided' });

  const zipName = `SpotiFLAC-${tracks.length}-tracks-${Date.now()}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = new ZipArchive({ zlib: { level: 0 } }); // level 0 = store only (FLAC is already compressed)
  archive.pipe(res);

  const tmpFiles = [];

  try {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t.id || !t.source) continue;

      try {
        const resolved = await resolveTrack(t.id, t.source);
        const url = resolved.downloadUrl || resolved.streamUrl;
        if (!url) { console.warn(`[ZIP] No URL for "${t.title}"`); continue; }

        const safeName = sanitizeZipName(`${t.artist || 'Unknown'} - ${t.title || 'Track'}.flac`);
        console.log(`[ZIP] ${i + 1}/${tracks.length}: ${safeName}`);

        let flacBuffer;

        if (url.startsWith('apm://')) {
          const songId = url.replace('apm://', '');
          flacBuffer = await appleToFlacBuffer(songId, resolved);
        } else {
          flacBuffer = await urlToFlacBuffer(url, resolved);
        }

        if (flacBuffer && flacBuffer.length > 0) {
          archive.append(flacBuffer, { name: safeName });
        }
      } catch (err) {
        console.error(`[ZIP] Failed "${t.title}":`, err.message);
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('[ZIP] Fatal error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else archive.abort();
  } finally {
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }

  archive.on('error', err => {
    console.error('[ZIP] Archive error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// Download a URL to a FLAC Buffer (in-memory)
function urlToFlacBuffer(url, resolved) {
  return new Promise((resolve, reject) => {
    const headers = buildDownloadHeaders(url, resolved);
    fetchStream(url, headers, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      const tmpIn = path.join(os.tmpdir(), `spf_zip_in_${Date.now()}.tmp`);
      const tmpOut = path.join(os.tmpdir(), `spf_zip_out_${Date.now()}.flac`);

      const file = fs.createWriteStream(tmpIn);
      stream.pipe(file);
      stream.on('error', reject);
      file.on('finish', () => {
        const ff = spawn(FFMPEG, ['-y', '-i', tmpIn, '-c:a', 'flac', '-compression_level', '5', tmpOut], { stdio: ['ignore', 'ignore', 'pipe'] });
        ff.on('close', code => {
          try { fs.unlinkSync(tmpIn); } catch {}
          if (code !== 0) { try { fs.unlinkSync(tmpOut); } catch {} return reject(new Error('ffmpeg exit ' + code)); }
          const buf = fs.readFileSync(tmpOut);
          try { fs.unlinkSync(tmpOut); } catch {}
          resolve(buf);
        });
        ff.on('error', e => { try { fs.unlinkSync(tmpIn); } catch {} reject(e); });
      });
      file.on('error', reject);
    });
  });
}

// Apple Music song → FLAC Buffer (in-memory)
function appleToFlacBuffer(songId, resolved) {
  return new Promise((resolve, reject) => {
    const appleUrl = `https://music.apple.com/us/song/${songId}`;
    const tmpDir = path.join(APPLE_DOWNLOAD_TEMP, `zip_${songId}_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    function cleanup() { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }

    const gamdl = spawn('python', [
      '-m', 'gamdl',
      '--cookies-path', APPLE_COOKIES_PATH,
      '--output-path', tmpDir,
      '--temp-path', tmpDir,
      '--song-codec-priority', 'aac-web,aac-he-web,aac',
      '--no-synced-lyrics',
      '--overwrite',
      '--log-level', 'WARNING',
      appleUrl,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    gamdl.on('close', code => {
      if (code !== 0) { cleanup(); return reject(new Error('gamdl exit ' + code)); }

      function findM4A(dir) {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, f.name);
          if (f.isDirectory()) { const r = findM4A(full); if (r) return r; }
          else if (f.name.endsWith('.m4a') || f.name.endsWith('.alac')) return full;
        }
        return null;
      }
      const m4a = findM4A(tmpDir);
      if (!m4a) { cleanup(); return reject(new Error('No audio file from gamdl')); }

      const flacPath = m4a + '.flac';
      const ff = spawn(FFMPEG, ['-y', '-i', m4a, '-c:a', 'flac', '-compression_level', '5', flacPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      ff.on('close', ffCode => {
        if (ffCode !== 0) { cleanup(); return reject(new Error('ffmpeg exit ' + ffCode)); }
        const buf = fs.readFileSync(flacPath);
        cleanup();
        resolve(buf);
      });
      ff.on('error', e => { cleanup(); reject(e); });
    });
    gamdl.on('error', e => { cleanup(); reject(e); });
  });
}

function sanitizeZipName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.{2,}/g, '.').trim();
}

// ── Save to Disk ───────────────────────────────────────────────
const MUSIC_DIR = path.join(os.homedir(), 'Downloads', 'FLAC Music');

// POST /api/save-flac
// Body: { trackId, source, title, artist, album, trackNumber, collectionName }
app.post('/api/save-flac', async (req, res) => {
  const { trackId, source, title, artist, album, trackNumber, collectionName } = req.body;
  if (!trackId || !source) return res.status(400).json({ error: 'Missing trackId or source' });

  const folder = (sanitizeZipName(collectionName || album || 'Singles') || 'Singles').slice(0, 100);
  const saveDir = path.join(MUSIC_DIR, folder);
  fs.mkdirSync(saveDir, { recursive: true });

  const numPrefix = trackNumber ? String(trackNumber).padStart(2, '0') + ' - ' : '';
  const filename = `${numPrefix}${sanitizeZipName(`${artist || 'Unknown'} - ${title || 'Track'}`)}.flac`;
  const savePath = path.join(saveDir, filename);

  if (fs.existsSync(savePath)) {
    return res.json({ ok: true, path: savePath, filename, folder, skipped: true });
  }

  try {
    const resolved = await resolveTrack(trackId, source);
    const url = resolved.downloadUrl || resolved.streamUrl;
    if (!url) return res.status(404).json({ error: 'No download URL' });

    let buf;
    if (url.startsWith('apm://')) {
      if (!appleHasCookies()) return res.status(403).json({ error: 'Apple Music cookies not configured. Visit /apple-setup.' });
      buf = await appleToFlacBuffer(url.replace('apm://', ''), resolved);
    } else if (url.startsWith('ytm://')) {
      buf = await ytdlpToFlacBuffer(url.replace('ytm://', ''));
    } else {
      buf = await urlToFlacBuffer(url, resolved);
    }

    fs.writeFileSync(savePath, buf);
    console.log(`[Save] ${folder}/${filename}`);
    res.json({ ok: true, path: savePath, filename, folder });
  } catch (err) {
    console.error('[Save] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function ytdlpToFlacBuffer(videoId) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://music.youtube.com/watch?v=${videoId}`;
    const tmpBase = path.join(os.tmpdir(), `spf_yt_${Date.now()}`);
    const tmpOut = tmpBase + '.flac';

    const ytdlp = spawn(YTDLP, [
      '--format', 'bestaudio', '--no-playlist',
      '-o', tmpBase + '.%(ext)s',
      ytUrl,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let ytErr = '';
    ytdlp.stderr.on('data', d => { ytErr += d; });
    ytdlp.on('error', reject);
    ytdlp.on('close', code => {
      if (code !== 0) return reject(new Error('yt-dlp exit ' + code + ': ' + ytErr.slice(-200)));

      // Find whatever file yt-dlp created
      const dir = path.dirname(tmpBase);
      const base = path.basename(tmpBase);
      const actualIn = fs.readdirSync(dir).map(f => path.join(dir, f)).find(f => path.basename(f).startsWith(base) && !f.endsWith('.flac'));
      if (!actualIn) return reject(new Error('yt-dlp output file not found'));

      const ff = spawn(FFMPEG, ['-y', '-i', actualIn, '-c:a', 'flac', '-compression_level', '5', tmpOut],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      ff.on('error', e => { try { fs.unlinkSync(actualIn); } catch {} reject(e); });
      ff.on('close', ffCode => {
        try { fs.unlinkSync(actualIn); } catch {}
        if (ffCode !== 0) { try { fs.unlinkSync(tmpOut); } catch {} return reject(new Error('ffmpeg exit ' + ffCode)); }
        const buf = fs.readFileSync(tmpOut);
        try { fs.unlinkSync(tmpOut); } catch {}
        resolve(buf);
      });
    });
  });
}

// ── Apple Music Stream (for in-browser playback) ──────────────
// Streams M4A directly — no FLAC conversion, so playback starts faster.

const _appleStreamCache = new Map(); // songId → flacPath

app.get('/api/apple-stream', async (req, res) => {
  const { songId } = req.query;
  if (!songId) return res.status(400).json({ error: 'Missing songId' });

  if (!appleHasCookies()) {
    return res.status(403).json({ error: 'Apple Music cookies not configured. Visit /apple-setup.' });
  }

  // Check in-memory cache
  const cached = _appleStreamCache.get(songId);
  if (cached && fs.existsSync(cached)) {
    const sz = fs.statSync(cached).size;
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Length', sz);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return fs.createReadStream(cached).pipe(res);
  }

  try {
    const appleUrl = `https://music.apple.com/us/song/${songId}`;
    const tmpDir = path.join(APPLE_DOWNLOAD_TEMP, `stream_${songId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log('[Apple Stream] Downloading', songId, '...');

    await new Promise((resolve, reject) => {
      const gamdl = spawn('python', [
        '-m', 'gamdl',
        '--cookies-path', APPLE_COOKIES_PATH,
        '--output-path', tmpDir,
        '--temp-path', tmpDir,
        '--song-codec-priority', 'aac-web,aac-he-web,aac',
        '--no-synced-lyrics',
        '--overwrite',
        '--log-level', 'WARNING',
        appleUrl,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      gamdl.stderr.on('data', d => { stderr += d; });
      gamdl.stdout.on('data', () => {});
      gamdl.on('error', reject);
      gamdl.on('close', code => {
        if (code !== 0) {
          const msg = stderr.slice(-300);
          return reject(new Error(`gamdl failed (exit ${code}): ${msg}`));
        }
        resolve();
      });
    });

    // Find the downloaded M4A
    function findM4A(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) { const r = findM4A(full); if (r) return r; }
        else if (f.name.endsWith('.m4a') || f.name.endsWith('.alac')) return full;
      }
      return null;
    }

    const m4aPath = findM4A(tmpDir);
    if (!m4aPath) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'gamdl succeeded but no audio file found' });
    }

    // Cache and stream
    _appleStreamCache.set(songId, m4aPath);
    // Evict cache after 1 hour
    setTimeout(() => {
      _appleStreamCache.delete(songId);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }, 3600000);

    const sz = fs.statSync(m4aPath).size;
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Length', sz);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    console.log('[Apple Stream] Serving', path.basename(m4aPath), (sz / 1024 / 1024).toFixed(1) + 'MB');
    fs.createReadStream(m4aPath).pipe(res);

  } catch (err) {
    console.error('[Apple Stream] Error:', err.message);
    if (!res.headersSent) {
      if (err.message.includes('cookies') || err.message.includes('auth')) {
        res.status(403).json({ error: 'Apple Music cookies expired. Visit /apple-setup to refresh.' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  }
});

// ── Apple Music Setup ──────────────────────────────────────────

app.get('/api/apple-status', (req, res) => {
  const ok = appleHasCookies();
  res.json({
    configured: ok,
    cookiesPath: APPLE_COOKIES_PATH,
    message: ok ? 'Apple Music cookies found — lossless downloads enabled.' : 'Cookies not configured. See /apple-setup.',
  });
});

// Upload cookies.txt for Apple Music
app.post('/api/apple-cookies', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  try {
    const content = req.body.toString('utf8');
    if (!content.includes('.music.apple.com') && !content.includes('apple.com')) {
      return res.status(400).json({ error: 'File does not appear to be Apple Music cookies. Make sure you export from music.apple.com.' });
    }
    fs.mkdirSync(SPOTIFLAC_DIR, { recursive: true });
    fs.writeFileSync(APPLE_COOKIES_PATH, content, 'utf8');
    res.json({ ok: true, message: 'Apple Music cookies saved. Lossless downloads are now enabled!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/apple-setup', (req, res) => {
  const configured = appleHasCookies();
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Apple Music Setup — SpotiFLAC</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#121212;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#1a1a1a;border-radius:16px;padding:40px;max-width:620px;width:100%;border:1px solid #333}
    h1{font-size:24px;margin-bottom:8px;display:flex;align-items:center;gap:12px}
    .apple-icon{color:#fc3c44;font-size:28px}
    .status{padding:12px 16px;border-radius:8px;margin:16px 0;font-size:14px}
    .status.ok{background:#1e3a2e;border:1px solid #1DB954;color:#1DB954}
    .status.err{background:#3a1e1e;border:1px solid #e91429;color:#e91429}
    h2{font-size:16px;margin:24px 0 8px;color:#b3b3b3;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
    ol{padding-left:20px;line-height:2}
    li{margin-bottom:4px;color:#ccc}
    code{background:#333;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px;color:#1DB954}
    .drop-zone{border:2px dashed #444;border-radius:12px;padding:40px;text-align:center;margin:20px 0;cursor:pointer;transition:border-color .2s}
    .drop-zone:hover,.drop-zone.drag-over{border-color:#1DB954}
    .drop-zone p{color:#888;margin-bottom:8px}
    .btn{background:#1DB954;color:#000;border:none;padding:12px 24px;border-radius:24px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;width:100%}
    .btn:hover{background:#1ed760}
    .btn-sec{background:transparent;color:#ccc;border:1px solid #444;padding:10px 20px;border-radius:24px;font-size:13px;cursor:pointer;margin-top:8px;width:100%}
    a{color:#1DB954;text-decoration:none}
    .note{font-size:12px;color:#666;margin-top:16px;line-height:1.6}
    #msg{margin-top:12px;padding:10px 14px;border-radius:8px;display:none;font-size:14px}
    #msg.ok{background:#1e3a2e;color:#1DB954;display:block}
    #msg.err{background:#3a1e1e;color:#e91429;display:block}
  </style>
</head>
<body>
<div class="card">
  <h1><span class="apple-icon">♪</span> Apple Music Lossless Setup</h1>
  <p style="color:#888;font-size:14px;margin-top:4px">One-time setup to enable true lossless ALAC downloads</p>

  <div class="status ${configured ? 'ok' : 'err'}">
    ${configured ? '✓ Apple Music cookies configured — lossless downloads active' : '✗ Cookies not found — complete setup below'}
  </div>

  <h2>Step 1: Install Browser Extension</h2>
  <ol>
    <li>Install <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank">"Get cookies.txt LOCALLY"</a> in Chrome/Edge</li>
    <li>Or install <a href="https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/" target="_blank">"cookies.txt"</a> in Firefox</li>
  </ol>

  <h2>Step 2: Export Apple Music Cookies</h2>
  <ol>
    <li>Go to <a href="https://music.apple.com" target="_blank">music.apple.com</a> and <strong>log in</strong> with your Apple Music account</li>
    <li>Click the extension icon and export cookies for <code>music.apple.com</code></li>
    <li>This saves a file called <code>cookies.txt</code></li>
  </ol>

  <h2>Step 3: Upload Cookies File</h2>
  <div class="drop-zone" id="dropZone">
    <p>Drag &amp; drop your <code>cookies.txt</code> here</p>
    <p style="font-size:12px;color:#666">or click to browse</p>
    <input type="file" id="fileInput" accept=".txt" style="display:none"/>
  </div>
  <button class="btn" onclick="document.getElementById('fileInput').click()">Choose cookies.txt file</button>
  <div id="msg"></div>

  <p class="note">
    Your cookies are stored locally at <code>${APPLE_COOKIES_PATH.replace(/\\/g, '\\\\')}</code> and never leave your machine.<br>
    They expire when you log out of Apple Music. Re-export if downloads stop working.<br>
    After setup, search any song in SpotiFLAC and click <strong>Download FLAC</strong> for true lossless quality.
  </p>

  <button class="btn-sec" onclick="window.location='/'">← Back to SpotiFLAC</button>
</div>

<script>
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const msg = document.getElementById('msg');

function showMsg(text, type) {
  msg.textContent = text; msg.className = type;
}

async function uploadFile(file) {
  showMsg('Uploading...', '');
  try {
    const r = await fetch('/api/apple-cookies', { method:'POST', body: file });
    const d = await r.json();
    if (d.ok) showMsg('✓ ' + d.message, 'ok');
    else showMsg('✗ ' + (d.error||'Upload failed'), 'err');
  } catch(e) { showMsg('✗ ' + e.message, 'err'); }
}

fileInput.addEventListener('change', e => { if(e.target.files[0]) uploadFile(e.target.files[0]); });
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if(e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
</script>
</body>
</html>`);
});

// ── Static files ───────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────

function startServer(port) {
  return new Promise((resolve, reject) => {
    boot().then(() => {
      const p = port || PORT;
      app.listen(p, () => {
        console.log(`\n  SpotiFLAC running at http://localhost:${p}\n`);
        resolve(p);
      });
    }).catch(reject);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Boot failed:', err);
    process.exit(1);
  });
} else {
  module.exports = { app, startServer };
}
