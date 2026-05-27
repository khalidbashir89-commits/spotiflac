'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const http = require('http');

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');
const CONFIG_FILE = path.join(EXTENSIONS_DIR, '_config.json');
const SKIP_FILES = new Set(['Extension.js', '_EXTENSION_GUIDE.md']);

let loadedExtensions = [];

// ── Config (enable/disable state) ─────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { disabled: [] };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function isDisabled(filename) {
  const cfg = readConfig();
  return (cfg.disabled || []).includes(filename);
}

// ── Load Extensions ────────────────────────────────────────────

async function loadExtensions() {
  loadedExtensions = [];

  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(EXTENSIONS_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('_') && !SKIP_FILES.has(f));

  for (const file of files) {
    const filePath = path.join(EXTENSIONS_DIR, file);
    const disabled = isDisabled(file);

    if (disabled) {
      loadedExtensions.push({
        name: file.replace('.js', ''),
        file,
        version: '?',
        author: '?',
        description: 'Disabled',
        capabilities: [],
        enabled: false,
        error: null,
        _instance: null,
      });
      console.log(`[ExtManager] Skipped (disabled): ${file}`);
      continue;
    }

    try {
      const ext = await loadExtensionFile(filePath, file);
      loadedExtensions.push(ext);
      console.log(`[ExtManager] Loaded: ${ext.name} (${file})`);
    } catch (err) {
      console.error(`[ExtManager] Failed to load ${file}:`, err.message);
      loadedExtensions.push({
        name: file.replace('.js', ''),
        file,
        version: '?',
        author: '?',
        description: 'Failed to load',
        capabilities: [],
        enabled: false,
        error: err.message,
        _instance: null,
      });
    }
  }

  return loadedExtensions;
}

async function loadExtensionFile(filePath, filename) {
  // Slot where registerExtension() / module.exports stores the class
  let _registeredClass = null;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Buffer,
    URL,
    fetch: require('node-fetch'),
    module: { exports: {} },
    exports: {},
    require: (mod) => {
      const allowed = ['axios', 'node-fetch', 'url', 'querystring', 'crypto'];
      if (allowed.includes(mod)) return require(mod);
      throw new Error(`Extension cannot require '${mod}'`);
    },
    // Pattern 1: registerExtension(MyClass)
    registerExtension: (cls) => { _registeredClass = cls; },
    // Pattern 2: extension.register(MyClass)  / extension.define(MyClass)
    extension: {
      register: (cls) => { _registeredClass = cls; },
      define:   (cls) => { _registeredClass = cls; },
    },
    // Pattern 3: global class declaration support
    global: {},
  };

  const src = fs.readFileSync(filePath, 'utf8');

  // Strip any import/export ES-module syntax that can't run in vm (best-effort)
  const normalised = src
    .replace(/^\s*export\s+default\s+/m, 'module.exports = ')
    .replace(/^\s*export\s+\{([^}]+)\}/gm, (_, names) => {
      const first = names.split(',')[0].trim().split(/\s+as\s+/)[0].trim();
      return `module.exports = ${first};`;
    });

  // Run without an IIFE so top-level `var` declarations land on the sandbox
  // (readable after execution as sandbox.EXT_ID, sandbox.NAME, etc.).
  // All needed globals are already properties of the sandbox context.
  const script = new vm.Script(normalised, { filename: filePath });

  const context = vm.createContext(sandbox);
  script.runInContext(context);

  // ── Resolve the registered extension ────────────────────────
  //
  // Supported patterns:
  //   A) registerExtension(MyClass)          — class, new-able
  //   B) registerExtension({ searchTracks }) — plain object (native SpotiFLAC API)
  //   C) module.exports = MyClass            — CommonJS class export
  //   D) export default MyClass              — ESM (normalised to C above)

  let instance;

  if (_registeredClass !== null) {
    if (typeof _registeredClass === 'function') {
      // Pattern A — class
      instance = new _registeredClass();
    } else if (typeof _registeredClass === 'object' && _registeredClass !== null) {
      // Pattern B — native SpotiFLAC object API; wrap into our interface
      instance = adaptNativeExtension(_registeredClass, sandbox);
    } else {
      throw new Error('registerExtension() received an unexpected value');
    }
  } else {
    // Patterns C/D
    const ExtClass =
      sandbox.module.exports.default ||
      (typeof sandbox.module.exports === 'function' ? sandbox.module.exports : null) ||
      Object.values(sandbox.module.exports || {}).find(v => typeof v === 'function') ||
      null;

    if (typeof ExtClass !== 'function') {
      throw new Error(
        'Extension must export a class via: module.exports = MyClass, ' +
        'registerExtension(MyClass), or registerExtension({ searchTracks, ... })'
      );
    }
    instance = new ExtClass();
  }

  if (typeof instance.search !== 'function') {
    throw new Error('Extension must implement search(query) — or searchTracks(query) for native SpotiFLAC format');
  }

  const displayName = instance.name && instance.name !== 'Unknown Extension'
    ? instance.name
    : filename.replace('.js', '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return {
    name: displayName,
    file: filename,
    version: instance.version || '1.0.0',
    author: instance.author || 'Unknown',
    description: instance.description || '',
    capabilities: instance.capabilities || ['search'],
    enabled: true,
    error: null,
    _instance: instance,
  };
}

// ── Native SpotiFLAC Extension Adapter ────────────────────────
//
// Real SpotiFLAC extensions call:
//   registerExtension({ initialize, searchTracks, getDownloadUrl, cleanup, ... })
//
// This adapter wraps that object into our internal interface:
//   instance.search(query)   → calls obj.searchTracks(query)
//   instance.resolve(id)     → calls obj.getDownloadUrl(id) or obj.getTrackUrl(id)
//
function adaptNativeExtension(obj, globals = {}) {
  // Call initialize() with an empty config so the extension can set itself up.
  // Many extensions only need this to reset state; errors are non-fatal.
  if (typeof obj.initialize === 'function') {
    try { obj.initialize({}); } catch (_) {}
  }

  // Derive display metadata — check the registered object first, then
  // top-level script globals (EXT_ID, NAME, VERSION, AUTHOR …).
  const g = globals;
  const meta = {
    name:         obj.name        || g.EXT_ID      || g.NAME        || g.EXTENSION_NAME || 'Unknown Extension',
    version:      obj.version     || g.VERSION     || g.EXT_VERSION || '1.0.0',
    author:       obj.author      || g.AUTHOR      || g.EXT_AUTHOR  || 'Unknown',
    description:  obj.description || g.DESCRIPTION || g.EXT_DESC    || '',
    capabilities: obj.capabilities || ['search'],
  };

  return {
    ...meta,

    // Map searchTracks / customSearch → search
    async search(query) {
      const fn = obj.searchTracks || obj.customSearch || obj.search;
      if (typeof fn !== 'function') return [];
      const raw = await fn.call(obj, query);
      // Native results may be an array or { tracks: [...] }
      const tracks = Array.isArray(raw) ? raw
        : (raw && Array.isArray(raw.tracks)) ? raw.tracks
        : (raw && Array.isArray(raw.results)) ? raw.results
        : [];
      return tracks.map(t => normalizeNativeTrack(t));
    },

    // Map getDownloadUrl / getTrackUrl → resolve
    async resolve(trackId) {
      const fn = obj.getDownloadUrl || obj.getTrackUrl || obj.resolveTrack;
      if (typeof fn !== 'function') return { streamUrl: null, downloadUrl: null };
      const result = await fn.call(obj, trackId);
      if (!result) return { streamUrl: null, downloadUrl: null };
      if (typeof result === 'string') return { streamUrl: result, downloadUrl: result };
      return {
        streamUrl:   result.streamUrl   || result.stream_url  || result.url || null,
        downloadUrl: result.downloadUrl || result.download_url || result.url || null,
        format:      result.format      || 'flac',
      };
    },
  };
}

// Normalize a track from a native extension into our internal shape.
function normalizeNativeTrack(t) {
  return {
    id:          t.id          || t.track_id  || String(Math.random()).slice(2),
    title:       t.title       || t.name      || t.track_title || 'Unknown',
    artist:      t.artist      || t.artistName || t.artist_name || '',
    album:       t.album       || t.albumName  || t.album_title || '',
    duration:    Number(t.duration || t.length || 0),
    thumbnail:   t.thumbnail   || t.cover     || t.artwork || t.image || null,
    streamUrl:   t.streamUrl   || t.stream_url || t.url  || null,
    downloadUrl: t.downloadUrl || t.download_url        || null,
    format:      t.format      || 'flac',
    bitrate:     t.bitrate     || null,
  };
}

// ── Enable / Disable ───────────────────────────────────────────

async function setExtensionEnabled(filename, enabled) {
  const cfg = readConfig();
  const disabled = new Set(cfg.disabled || []);

  if (enabled) {
    disabled.delete(filename);
  } else {
    disabled.add(filename);
  }

  cfg.disabled = [...disabled];
  writeConfig(cfg);

  // Hot-reload just this extension
  const idx = loadedExtensions.findIndex(e => e.file === filename);
  if (enabled) {
    const filePath = path.join(EXTENSIONS_DIR, filename);
    if (fs.existsSync(filePath)) {
      try {
        const ext = await loadExtensionFile(filePath, filename);
        if (idx !== -1) loadedExtensions[idx] = ext;
        else loadedExtensions.push(ext);
        console.log(`[ExtManager] Enabled: ${ext.name}`);
      } catch (err) {
        if (idx !== -1) {
          loadedExtensions[idx].enabled = false;
          loadedExtensions[idx].error = err.message;
        }
        throw err;
      }
    }
  } else {
    if (idx !== -1) {
      loadedExtensions[idx].enabled = false;
      loadedExtensions[idx]._instance = null;
    }
    console.log(`[ExtManager] Disabled: ${filename}`);
  }

  return getExtensionMeta();
}

// ── Install from URL ───────────────────────────────────────────

async function installExtension(rawUrl, suggestedFilename) {
  // Security: only allow GitHub raw URLs
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  const allowed = ['raw.githubusercontent.com', 'gist.githubusercontent.com'];
  if (!allowed.includes(parsedUrl.hostname)) {
    throw new Error(`Installation only allowed from: ${allowed.join(', ')}`);
  }

  const filename = sanitizeFilename(suggestedFilename || path.basename(parsedUrl.pathname));
  if (!filename.endsWith('.js')) throw new Error('Extension file must be a .js file');

  const destPath = path.join(EXTENSIONS_DIR, filename);

  const src = await downloadText(rawUrl);

  // Basic sanity check — must contain a class
  if (!src.includes('search') || src.length < 50) {
    throw new Error('Downloaded file does not look like a valid extension');
  }

  fs.writeFileSync(destPath, src, 'utf8');
  console.log(`[ExtManager] Installed: ${filename}`);

  // Load it immediately
  const ext = await loadExtensionFile(destPath, filename);
  const existing = loadedExtensions.findIndex(e => e.file === filename);
  if (existing !== -1) loadedExtensions[existing] = ext;
  else loadedExtensions.push(ext);

  // Remove from disabled if it was there
  const cfg = readConfig();
  cfg.disabled = (cfg.disabled || []).filter(f => f !== filename);
  writeConfig(cfg);

  return { filename, meta: ext };
}

// ── Uninstall ──────────────────────────────────────────────────

function uninstallExtension(filename) {
  const safeName = path.basename(filename);
  if (SKIP_FILES.has(safeName) || safeName.startsWith('_')) {
    throw new Error('Cannot uninstall built-in files');
  }

  const filePath = path.join(EXTENSIONS_DIR, safeName);
  if (!fs.existsSync(filePath)) throw new Error('Extension file not found');

  fs.unlinkSync(filePath);

  // Remove from memory and config
  const idx = loadedExtensions.findIndex(e => e.file === safeName);
  if (idx !== -1) loadedExtensions.splice(idx, 1);

  const cfg = readConfig();
  cfg.disabled = (cfg.disabled || []).filter(f => f !== safeName);
  writeConfig(cfg);

  console.log(`[ExtManager] Uninstalled: ${safeName}`);
}

// ── Search ─────────────────────────────────────────────────────

async function searchAll(query) {
  const active = loadedExtensions.filter(e => e.enabled && !e.error && e._instance);

  if (active.length === 0) {
    return { results: [], extensions: getExtensionMeta(), error: 'No active extensions' };
  }

  const searches = active.map(async (ext) => {
    try {
      const raw = await Promise.race([
        ext._instance.search(query),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 15000)),
      ]);
      return (raw || []).map(t => normalizeTrack(t, ext.name));
    } catch (err) {
      console.error(`[ExtManager] ${ext.name} search error:`, err.message);
      return [];
    }
  });

  const settled = await Promise.allSettled(searches);
  const results = settled.flatMap(p => p.status === 'fulfilled' ? p.value : []);

  return { results, extensions: getExtensionMeta(), query };
}

async function resolveTrack(trackId, sourceName) {
  const ext = loadedExtensions.find(e => e.name === sourceName && e.enabled);
  if (!ext?._instance) throw new Error(`Extension '${sourceName}' not found or disabled`);
  if (typeof ext._instance.resolve !== 'function') throw new Error(`Extension '${sourceName}' has no resolve()`);

  return Promise.race([
    ext._instance.resolve(trackId),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Resolve timeout')), 20000)),
  ]);
}

// ── Utilities ──────────────────────────────────────────────────

function normalizeTrack(track, source) {
  const normalized = {
    id: track.id || `${source}-${Math.random().toString(36).slice(2)}`,
    title: track.title || 'Unknown',
    artist: track.artist || '',
    album: track.album || '',
    duration: track.duration || 0,
    thumbnail: track.thumbnail || track.artwork || track.cover || null,
    streamUrl: track.streamUrl || track.stream_url || null,
    downloadUrl: track.downloadUrl || track.download_url || null,
    format: track.format || 'flac',
    bitrate: track.bitrate || null,
    source,
  };
  // Pass through relationship IDs for navigation
  if (track.artistId) normalized.artistId = track.artistId;
  if (track.albumId) normalized.albumId = track.albumId;
  if (track.trackNumber) normalized.trackNumber = track.trackNumber;
  return normalized;
}

function getExtensionMeta() {
  return loadedExtensions.map(e => ({
    name: e.name,
    file: e.file,
    version: e.version,
    author: e.author,
    description: e.description,
    capabilities: e.capabilities,
    enabled: e.enabled,
    error: e.error,
  }));
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'SpotiFLAC/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    }).on('error', reject).setTimeout(15000, function() { this.destroy(); reject(new Error('Download timeout')); });
  });
}

function getExtensionInstance(name) {
  const ext = loadedExtensions.find(e => e.name === name && e.enabled && !e.error);
  return ext ? ext._instance : null;
}

module.exports = {
  loadExtensions,
  searchAll,
  resolveTrack,
  getExtensionMeta,
  setExtensionEnabled,
  installExtension,
  uninstallExtension,
  getExtensionInstance,
};
