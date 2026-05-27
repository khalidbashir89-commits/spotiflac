'use strict';

/**
 * YouTube Music Extension for SpotiFLAC
 * Searches via InnerTube (WEB_REMIX), resolves via iOS client.
 * Track IDs are prefixed: ytm:VIDEO_ID
 */

const fetch = require('node-fetch');

const INNERTUBE_KEY = 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc';
const IOS_UA = 'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';

async function innertubePost(host, path, clientBody, clientHeaders, apiKey) {
  const url = `https://${host}${path}?key=${apiKey}&prettyPrint=false`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...clientHeaders },
    body: JSON.stringify(clientBody),
  });
  if (!res.ok) throw new Error(`InnerTube ${res.status}`);
  return res.json();
}

// WEB_REMIX search on music.youtube.com — returns song results
async function ytMusicSearch(query) {
  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250120.00.00',
        hl: 'en',
        gl: 'US',
        timeZone: 'UTC',
        utcOffsetMinutes: 0,
      },
    },
    query,
    params: 'EgWKAQIIAWoKEAMQBBAKEAUQCQ%3D%3D', // songs filter
  };
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': '1.20250120.00.00',
    'Origin': 'https://music.youtube.com',
    'Referer': 'https://music.youtube.com/',
  };
  return innertubePost('music.youtube.com', '/youtubei/v1/search', body, headers, 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8');
}

// iOS player to get direct audio URL
async function iOSPlayer(videoId) {
  const body = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '21.02.3',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        hl: 'en',
        gl: 'US',
        timeZone: 'UTC',
        utcOffsetMinutes: 0,
        osName: 'iOS',
        osVersion: '18.3.2',
        platform: 'MOBILE',
      },
    },
  };
  const headers = {
    'User-Agent': IOS_UA,
    'X-YouTube-Client-Name': '5',
    'X-YouTube-Client-Version': '21.02.3',
  };
  return innertubePost('www.youtube.com', '/youtubei/v1/player', body, headers, INNERTUBE_KEY);
}

function getText(runs) {
  if (!runs) return '';
  if (Array.isArray(runs)) return runs.map(r => r.text || '').join('');
  return runs.simpleText || '';
}

function getThumb(thumbnailObj) {
  try {
    const arr = thumbnailObj && thumbnailObj.thumbnails;
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[arr.length - 1].url || null;
  } catch { return null; }
}

function parseVideoId(ep) {
  if (!ep) return null;
  if (ep.watchEndpoint && ep.watchEndpoint.videoId) return ep.watchEndpoint.videoId;
  if (ep.playlistPanelVideoRenderer && ep.playlistPanelVideoRenderer.videoId) return ep.playlistPanelVideoRenderer.videoId;
  return null;
}

function parseMusicItem(renderer) {
  if (!renderer) return null;
  const cols = renderer.flexColumns || [];
  const title = cols[0] && getText(
    cols[0].musicResponsiveListItemFlexColumnRenderer &&
    cols[0].musicResponsiveListItemFlexColumnRenderer.text &&
    cols[0].musicResponsiveListItemFlexColumnRenderer.text.runs
  );
  if (!title) return null;

  // VideoId from playlistItemData or overlay
  let videoId = renderer.playlistItemData && renderer.playlistItemData.videoId;
  if (!videoId && renderer.navigationEndpoint) videoId = parseVideoId(renderer.navigationEndpoint);
  if (!videoId && renderer.overlay && renderer.overlay.musicItemThumbnailOverlayRenderer) {
    const overlay = renderer.overlay.musicItemThumbnailOverlayRenderer;
    if (overlay.content && overlay.content.musicPlayButtonRenderer && overlay.content.musicPlayButtonRenderer.playNavigationEndpoint) {
      videoId = parseVideoId(overlay.content.musicPlayButtonRenderer.playNavigationEndpoint);
    }
  }
  if (!videoId) return null;

  // Artist from second flexColumn
  let artist = '';
  if (cols[1]) {
    const runs = cols[1].musicResponsiveListItemFlexColumnRenderer &&
      cols[1].musicResponsiveListItemFlexColumnRenderer.text &&
      cols[1].musicResponsiveListItemFlexColumnRenderer.text.runs || [];
    artist = runs
      .filter(r => r.text && r.navigationEndpoint && r.navigationEndpoint.browseEndpoint)
      .map(r => r.text)
      .join(', ');
    if (!artist) {
      artist = runs
        .filter(r => r.text && !['•',' • ',','].includes(r.text.trim()) && !/^\d{4}$/.test(r.text.trim()) && !/^\d{1,2}:\d{2}/.test(r.text.trim()))
        .map(r => r.text.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(', ');
    }
  }

  // Duration from fixed columns
  let duration = 0;
  const fixed = renderer.fixedColumns || [];
  for (const fc of fixed) {
    const fcr = fc.musicResponsiveListItemFixedColumnRenderer;
    if (fcr && fcr.text) {
      const t = getText(fcr.text.runs || [{ text: fcr.text.simpleText || '' }]);
      const m = t.match(/(\d{1,2}):(\d{2})/);
      if (m) { duration = parseInt(m[1], 10) * 60 + parseInt(m[2], 10); break; }
    }
  }

  // Thumbnail
  const thumbObj = renderer.thumbnail && renderer.thumbnail.musicThumbnailRenderer && renderer.thumbnail.musicThumbnailRenderer.thumbnail;
  const thumb = getThumb(thumbObj);

  return {
    id: `ytm:${videoId}`,
    title,
    artist,
    album: '',
    duration,
    thumbnail: thumb ? `https://lh3.googleusercontent.com/${thumb.split('lh3.googleusercontent.com/')[1] || ''}` : thumb,
    format: 'webm',
    bitrate: 160,
  };
}

function* walkForItems(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 25) return;
  if (obj.musicResponsiveListItemRenderer) {
    yield obj.musicResponsiveListItemRenderer;
    return;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object') yield* walkForItems(v, depth + 1);
  }
}

class YouTubeMusicExtension {
  constructor() {
    this.name = 'YouTube Music';
    this.version = '2.0.0';
    this.author = 'SpotiFLAC';
    this.description = 'YouTube Music search and streaming — 160kbps opus audio';
    this.capabilities = ['search', 'stream'];
  }

  async search(query) {
    try {
      const data = await ytMusicSearch(query);
      const items = [...walkForItems(data, 0)];
      const tracks = [];
      const seen = new Set();
      for (const item of items) {
        const t = parseMusicItem(item);
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          tracks.push(t);
          if (tracks.length >= 15) break;
        }
      }
      return tracks;
    } catch (err) {
      console.error('[YouTubeMusic] search error:', err.message);
      return [];
    }
  }

  async resolve(trackId) {
    try {
      const videoId = trackId.replace(/^ytm:/, '');
      if (!videoId || videoId.length < 6) throw new Error('Invalid video ID');

      // Try iOS client first (gives direct URLs)
      const data = await iOSPlayer(videoId);
      if (data.playabilityStatus && data.playabilityStatus.status === 'OK' && data.streamingData) {
        const fmts = (data.streamingData.adaptiveFormats || [])
          .filter(f => f.mimeType && f.mimeType.includes('audio') && f.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const best = fmts[0];
        if (best) {
          const ext = best.mimeType.includes('webm') ? 'webm' : 'm4a';
          return {
            streamUrl: best.url,
            downloadUrl: best.url,
            format: ext,
            bitrate: Math.round((best.bitrate || 0) / 1000),
            ytVideoId: videoId,
            iosUserAgent: IOS_UA,
          };
        }
      }

      // Fallback: return ytm:// scheme so server can use yt-dlp
      return {
        streamUrl: `ytm://${videoId}`,
        downloadUrl: `ytm://${videoId}`,
        format: 'webm',
        ytVideoId: videoId,
      };
    } catch (err) {
      console.error('[YouTubeMusic] resolve error:', err.message);
      const videoId = trackId.replace(/^ytm:/, '');
      return { streamUrl: `ytm://${videoId}`, downloadUrl: `ytm://${videoId}`, ytVideoId: videoId };
    }
  }
}

module.exports = YouTubeMusicExtension;
