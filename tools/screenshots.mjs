// Renders the README screenshots (docs/phone-*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The sky depends on the place and the time, so both are pinned, with a saved location and Playwright's clock, and
// every run shows the same sky. Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
// Saved with a 256-colour palette, which keeps a starry picture a fraction of the size.
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}

// A Friday night in October from Chicago: a crescent Moon setting in the southwest, Saturn in the southeast.
const PLACE = { name: 'Chicago, IL', lat: 41.85, lon: -87.65, tz: 'America/Chicago' };
const TIME = '2026-10-16T21:15:00-05:00';
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, phone) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: 'en-US', timezoneId: PLACE.tz, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route(url => !url.href.startsWith(base), route => route.abort());
  await ctx.addInitScript(save => localStorage.setItem('starhop.v1', save), JSON.stringify({ loc: PLACE }));
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(TIME) });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#keys').children.length > 0, null, { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  // Stop the clock at one moment, so every run draws the sky as it is then, and show that moment.
  await page.clock.pauseAt(new Date(Date.parse(TIME) + 30e3));
  await page.click('#nowBtn');
  await frames(page);
  return page;
}
const frames = page => page.clock.runFor(500); // with the clock stopped, the map and charts draw only as it steps on

try {
  // Phone screenshots for the README: the sky tonight, what to look at, and a card with its star-hop.
  {
    const page = await open({ width: 390, height: 844 }, true);
    await save(await page.screenshot(), 'docs/phone-sky.png');
    await page.evaluate(() => scrollTo(0, document.getElementById('tonightSec').offsetTop - 64));
    await frames(page);
    await save(await page.screenshot(), 'docs/phone-tonight.png');
    await page.evaluate(() => scrollTo(0, 0));
    if (!await page.$('#targetSec .row[data-id="M13"]')) await page.click('#moreT');
    await page.click('#targetSec .row[data-id="M13"]');
    await frames(page);
    await save(await page.screenshot(), 'docs/phone-card.png');
    await page.context().close();
  }
  // Link preview, 1200 x 630: the app itself, map and panel side by side.
  {
    const page = await open({ width: 1200, height: 630 }, false);
    await save(await page.screenshot(), 'og.png');
    await page.context().close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('screenshots written');
