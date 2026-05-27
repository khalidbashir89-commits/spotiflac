'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');

const BASE = 'http://localhost:3000';
const OUT  = path.join(__dirname, '..', 'docs', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), type: 'png' });
  console.log(`  ✓ ${name}`);
}

const MOCK_TRACKS = [
  { id:'apm:1601234001', title:'Kesariya',              artist:'Arijit Singh', album:'Brahmastra', duration:290, trackNumber:1, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234002', title:'Dance Ka Bhoot',        artist:'Arijit Singh', album:'Brahmastra', duration:178, trackNumber:2, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234003', title:'Deva Deva',             artist:'Arijit Singh', album:'Brahmastra', duration:267, trackNumber:3, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234004', title:'Rasiya',                artist:'Arijit Singh', album:'Brahmastra', duration:241, trackNumber:4, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234005', title:'Brahmāstra Title Track',artist:'Pritam',       album:'Brahmastra', duration:189, trackNumber:5, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:555432',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234006', title:'Shiva Theme',           artist:'Pritam',       album:'Brahmastra', duration:203, trackNumber:6, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:555432',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234007', title:'Jhoome Jo Pathaan — Remix', artist:'Arijit Singh', album:'Brahmastra', duration:218, trackNumber:7, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754', albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234008', title:'Ve Haanja',             artist:'Arijit Singh', album:'Brahmastra', duration:255, trackNumber:8, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:395754',  albumId:'apm-album-in:1601234000' },
  { id:'apm:1601234009', title:'Brahmāstra End Credits', artist:'Pritam',      album:'Brahmastra', duration:312, trackNumber:9, thumbnail:'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg', format:'flac', quality:'Lossless ALAC', source:'Apple Music', artistId:'apm-artist-in:555432',  albumId:'apm-album-in:1601234000' },
];

const MOCK_ALBUM = {
  type: 'album',
  id: 'apm-album-in:1601234000',
  title: 'Brahmastra (Original Motion Picture Soundtrack)',
  artist: 'Pritam',
  artistId: 'apm-artist-in:555432',
  artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/500x500bb.jpg',
  artworkHero: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/3a/b9/38/3ab93863-68ce-2b55-4dd7-77fb28c97c7c/cover.jpg/800x800bb.jpg',
  releaseDate: '2022',
  trackCount: 9,
  source: 'Apple Music',
  tracks: MOCK_TRACKS,
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 780 },
  });
  const page = await browser.newPage();

  // ── 1. Home screen ──────────────────────────────────────────
  console.log('Taking home screenshot...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await wait(800);
  await shot(page, 'screenshot-home.png');

  // ── 2. Search with injected mock results ───────────────────
  console.log('Taking search screenshot...');
  await page.goto(BASE, { waitUntil: 'networkidle2' });

  // Enable interception before triggering search
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('/api/search')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: MOCK_TRACKS, extensions: ['Apple Music'] }),
      });
    } else {
      req.continue();
    }
  });

  const input = await page.$('#search-input, input[placeholder*="Search"]');
  if (input) {
    await input.click({ clickCount: 3 });
    await input.type('Kesariya Arijit Singh', { delay: 30 });
    await page.keyboard.press('Enter');
    try {
      await page.waitForSelector('.track-row', { timeout: 5000 });
      await wait(400);
    } catch {
      await wait(2000);
    }
  }
  await shot(page, 'screenshot-search.png');

  // ── 3. Collection view with injected mock album data ────────
  console.log('Taking collection screenshot...');

  // Use a fresh page to avoid interception state issues
  const page3 = await browser.newPage();
  await page3.goto(BASE, { waitUntil: 'networkidle2' });

  await page3.setRequestInterception(true);
  page3.on('request', req => {
    if (req.url().includes('/api/collection')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ALBUM),
      });
    } else {
      req.continue();
    }
  });

  await page3.evaluate(() => {
    if (window.__openCollection) {
      window.__openCollection('album', 'apm-album-in:1601234000', 'Apple Music', false);
    }
  });

  try {
    await page3.waitForSelector('.collection-track-row, .ctrack-row, #collection-track-list .track-row', { timeout: 6000 });
    await wait(600);
  } catch {
    await wait(3000);
  }
  await page3.screenshot({ path: path.join(OUT, 'screenshot-collection.png'), type: 'png' });
  console.log('  ✓ screenshot-collection.png');

  await browser.close();
  console.log('\nAll screenshots saved.');
})();
