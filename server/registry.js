'use strict';

/**
 * Extension Registry — scrapes GitHub once on first start and caches results.
 *
 * Search strategy (in order):
 *  1. GitHub topic search: topic:spotiflac-extension
 *  2. GitHub code search: spotiflac extension in:file filename:*.js
 *  3. Merge with a built-in curated list (always shown, marked as curated)
 *
 * Results cached to extensions/_registry_cache.json.
 * Cache is considered fresh for CACHE_TTL_MS (6 hours by default).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');
const CACHE_FILE = path.join(EXTENSIONS_DIR, '_registry_cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const GITHUB_API = 'https://api.github.com';
const GH_HEADERS = {
  'User-Agent': 'SpotiFLAC/1.0',
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

// ── Curated built-in list ──────────────────────────────────────
// Shown even when GitHub is unreachable. Mark curated: true.
const CURATED_EXTENSIONS = [
  {
    id: 'curated-jiosaavn',
    name: 'JioSaavn',
    description: 'JioSaavn 320kbps music provider — ideal for Indian, Bollywood, Tamil, Telugu music. Delivers FLAC-quality downloads.',
    author: 'SpotiFLAC',
    version: '2.0.0',
    stars: null,
    rawUrl: null,
    repoUrl: null,
    topics: ['spotiflac-extension', 'jiosaavn', 'indian-music'],
    capabilities: ['search', 'stream', 'download'],
    curated: true,
    bundled: true,
    format: 'flac',
  },
  {
    id: 'curated-ytmusic',
    name: 'YouTube Music',
    description: 'YouTube Music via InnerTube API — worldwide catalog, 160kbps opus audio with FLAC conversion.',
    author: 'SpotiFLAC',
    version: '2.0.0',
    stars: null,
    rawUrl: null,
    repoUrl: null,
    topics: ['spotiflac-extension', 'youtube-music'],
    capabilities: ['search', 'stream'],
    curated: true,
    bundled: true,
    format: 'flac',
  },
  {
    id: 'curated-demo',
    name: 'Free HD Music (Demo)',
    description: 'Searches Free Music Archive and Internet Archive for legally free, high-quality tracks. Bundled with SpotiFLAC — always available.',
    author: 'SpotiFLAC',
    version: '1.2.0',
    stars: null,
    rawUrl: null,
    repoUrl: null,
    topics: ['spotiflac-extension', 'fma', 'free-music'],
    capabilities: ['search', 'download'],
    curated: true,
    bundled: true,
    format: 'mp3/flac',
  },
  {
    id: 'curated-jiosaavn',
    name: 'JioSaavn',
    description: 'Search and stream high-quality audio from JioSaavn\'s public API. Supports 320kbps MP3 and some FLAC tracks.',
    author: 'community',
    version: '1.0.0',
    stars: null,
    rawUrl: 'https://raw.githubusercontent.com/spotiflac-extensions/jiosaavn/main/index.js',
    repoUrl: 'https://github.com/spotiflac-extensions/jiosaavn',
    topics: ['spotiflac-extension', 'jiosaavn'],
    capabilities: ['search', 'stream', 'download'],
    curated: true,
    bundled: false,
    format: 'mp3/flac',
  },
  {
    id: 'curated-soundcloud',
    name: 'SoundCloud',
    description: 'Search SoundCloud\'s public catalog. Downloads available for tracks with open download permissions.',
    author: 'community',
    version: '1.1.0',
    stars: null,
    rawUrl: 'https://raw.githubusercontent.com/spotiflac-extensions/soundcloud/main/index.js',
    repoUrl: 'https://github.com/spotiflac-extensions/soundcloud',
    topics: ['spotiflac-extension', 'soundcloud'],
    capabilities: ['search', 'stream'],
    curated: true,
    bundled: false,
    format: 'mp3',
  },
  {
    id: 'curated-bandcamp',
    name: 'Bandcamp',
    description: 'Search and download FLAC/MP3 from Bandcamp artists who offer free downloads. Respects artist download permissions.',
    author: 'community',
    version: '1.0.2',
    stars: null,
    rawUrl: 'https://raw.githubusercontent.com/spotiflac-extensions/bandcamp/main/index.js',
    repoUrl: 'https://github.com/spotiflac-extensions/bandcamp',
    topics: ['spotiflac-extension', 'bandcamp', 'flac'],
    capabilities: ['search', 'download'],
    curated: true,
    bundled: false,
    format: 'flac/mp3/wav',
  },
  {
    id: 'curated-archive-org',
    name: 'Internet Archive',
    description: 'Access millions of freely available audio recordings on archive.org — concerts, live bootlegs, historical recordings, and lossless FLAC.',
    author: 'community',
    version: '2.0.0',
    stars: null,
    rawUrl: 'https://raw.githubusercontent.com/spotiflac-extensions/internet-archive/main/index.js',
    repoUrl: 'https://github.com/spotiflac-extensions/internet-archive',
    topics: ['spotiflac-extension', 'archive-org', 'flac'],
    capabilities: ['search', 'download', 'stream'],
    curated: true,
    bundled: false,
    format: 'flac/mp3/ogg',
  },
];

// ── Public API ─────────────────────────────────────────────────

let registryCache = null;

async function getRegistry({ forceRefresh = false } = {}) {
  if (!forceRefresh && registryCache && isCacheFresh()) {
    return registryCache;
  }

  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (raw.fetchedAt && Date.now() - raw.fetchedAt < CACHE_TTL_MS) {
        registryCache = raw;
        console.log('[Registry] Loaded from disk cache');
        return registryCache;
      }
    } catch { /* stale or corrupt, re-fetch */ }
  }

  return fetchAndCache();
}

async function fetchAndCache() {
  console.log('[Registry] Fetching extension list from GitHub...');
  let githubResults = [];

  try {
    githubResults = await searchGitHub();
    console.log(`[Registry] GitHub returned ${githubResults.length} extension(s)`);
  } catch (err) {
    console.warn('[Registry] GitHub fetch failed:', err.message);
  }

  const merged = mergeResults(githubResults, CURATED_EXTENSIONS);

  registryCache = {
    fetchedAt: Date.now(),
    extensions: merged,
    githubCount: githubResults.length,
    curatedCount: CURATED_EXTENSIONS.length,
  };

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(registryCache, null, 2));
    console.log('[Registry] Cache written to disk');
  } catch (err) {
    console.warn('[Registry] Could not write cache:', err.message);
  }

  return registryCache;
}

function isCacheFresh() {
  return registryCache && (Date.now() - registryCache.fetchedAt) < CACHE_TTL_MS;
}

// ── GitHub Search ──────────────────────────────────────────────

async function searchGitHub() {
  const results = [];
  const seen = new Set();

  // Strategy 1: topic search
  try {
    const topicData = await ghGet(`${GITHUB_API}/search/repositories?q=topic:spotiflac-extension&per_page=30&sort=stars`);
    for (const repo of (topicData.items || [])) {
      if (!seen.has(repo.full_name)) {
        seen.add(repo.full_name);
        results.push(await repoToExtension(repo));
      }
    }
  } catch (err) {
    console.warn('[Registry] Topic search failed:', err.message);
  }

  // Strategy 2: code search as fallback
  if (results.length === 0) {
    try {
      const codeData = await ghGet(`${GITHUB_API}/search/repositories?q=spotiflac+extension+in:description,topics&per_page=20&sort=stars`);
      for (const repo of (codeData.items || [])) {
        if (!seen.has(repo.full_name)) {
          seen.add(repo.full_name);
          results.push(await repoToExtension(repo));
        }
      }
    } catch (err) {
      console.warn('[Registry] Code search failed:', err.message);
    }
  }

  return results;
}

async function repoToExtension(repo) {
  // Attempt to read package metadata from the repo's main JS file
  let rawUrl = null;
  let capabilities = ['search'];
  let format = 'flac';
  let version = '1.0.0';

  const candidateFiles = ['index.js', 'extension.js', `${repo.name}.js`];
  for (const file of candidateFiles) {
    const url = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch || 'main'}/${file}`;
    try {
      const head = await ghHead(url);
      if (head) { rawUrl = url; break; }
    } catch { /* try next */ }
  }

  // Try to parse version/capabilities from package.json
  try {
    const pkgUrl = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch || 'main'}/package.json`;
    const pkg = await ghGet(pkgUrl);
    if (pkg.version) version = pkg.version;
    if (pkg.spotiflac?.capabilities) capabilities = pkg.spotiflac.capabilities;
    if (pkg.spotiflac?.format) format = pkg.spotiflac.format;
  } catch { /* no package.json */ }

  return {
    id: `gh-${repo.id}`,
    name: repo.name.replace(/-extension$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: repo.description || 'No description',
    author: repo.owner?.login || 'unknown',
    version,
    stars: repo.stargazers_count,
    rawUrl,
    repoUrl: repo.html_url,
    topics: repo.topics || [],
    capabilities,
    curated: false,
    bundled: false,
    format,
    updatedAt: repo.updated_at,
  };
}

function mergeResults(github, curated) {
  const out = [...curated];
  const curatedNames = new Set(curated.map(e => e.name.toLowerCase()));

  for (const g of github) {
    if (!curatedNames.has(g.name.toLowerCase())) {
      out.push(g);
    }
  }

  return out;
}

// ── HTTP Helpers ───────────────────────────────────────────────

function ghGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: GH_HEADERS }, (res) => {
      if (res.statusCode === 403) {
        reject(new Error('GitHub rate limit hit'));
        res.resume();
        return;
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON from GitHub')); }
      });
    }).on('error', reject).setTimeout(10000, function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function ghHead(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', headers: GH_HEADERS }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { getRegistry, fetchAndCache };
