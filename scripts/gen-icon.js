'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });

  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'logo.svg'), 'utf8');
  const fitted = svg.replace(
    /width=["']\d+["'] height=["']\d+["']/,
    'width="256" height="256"'
  );
  const html = `<!DOCTYPE html>
<html><head><style>*{margin:0;padding:0}body{background:#000;overflow:hidden}</style></head>
<body>${fitted}</body></html>`;

  await page.setContent(html, { waitUntil: 'networkidle2' });
  await page.screenshot({ path: path.join(__dirname, '..', 'public', 'icon.png'), type: 'png' });
  console.log('icon.png generated at public/icon.png');
  await browser.close();
})();
