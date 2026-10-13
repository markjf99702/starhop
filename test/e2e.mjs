// Uses Starhop in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Add a word to run only the checks whose names contain it:  node test/e2e.mjs offline
// The sky depends on the place and the date, so the checks pin both: a saved location and Playwright's clock.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
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

const AUSTIN = { name: 'Austin, TX', lat: 30.27, lon: -97.74, tz: 'America/Chicago' };
const browser = await pw.chromium.launch();

// Opens Starhop at phone size (or desktop) with a saved location, or a raw save, and the clock set to `time`.
// Anything the page asks of another site is refused and listed in `outside`.
async function open({ loc = AUSTIN, save, time, tz, phone = true, sw = false, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: 'en-US',
    timezoneId: tz || (loc && loc.tz) || 'America/Chicago', serviceWorkers: sw ? 'allow' : 'block', reducedMotion,
  });
  const problems = [], outside = [];
  await ctx.route(url => !url.href.startsWith(base), route => { outside.push(route.request().url()); route.abort(); });
  const value = save !== undefined ? save : loc ? JSON.stringify({ loc }) : null;
  if (value !== null) {
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, ['starhop.v1', value]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  // A refused request to another site shows up as a console error too; `outside` already has those.
  page.on('console', m => { if (m.type() === 'error' && (m.location().url || base).startsWith(base)) problems.push(m.text()); });
  if (time) await page.clock.install({ time: new Date(time) });
  await page.goto(base);
  await ready(page);
  return { ctx, page, problems, outside };
}
const ready = page => page.waitForFunction(() => document.querySelector('#keys').children.length > 0 || /couldn|wrong/.test(document.querySelector('#tonightSec').textContent), null, { timeout: 90000 });
const text = (page, sel) => page.$eval(sel, el => el.innerText.replace(/\s+/g, ' ').trim());
const sheetOpen = page => page.$eval('#sheet', el => !el.hidden);
// Waits until an element's text matches, since the map redraws on the next frame.
const until = (page, sel, re) => page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s).innerText.replace(/\s+/g, ' ').trim()), [sel, re.source], { timeout: 15000 }).catch(() => {});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('opens on tonight, lists targets, opens a card, fits a phone and works offline', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', sw: true });
  try {
    assert.match(await text(page, '#nightTitle'), /^Tonight · Tue, Oct 13$/);
    assert.match(await text(page, '#keys'), /Sunset \d+:\d\d pm/);
    assert.equal(await page.$eval('#tonightSec h2', h => h.textContent), 'Tonight Austin, TX');
    assert.ok(await page.$$eval('#targetSec .row', r => r.length) >= 10, 'the target list fills in');
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page), 'a tap on a target opens its card');
    assert.ok((await text(page, '#sheet .hd h2')).length > 2, 'the card has a name');
    assert.match(await text(page, '#sheet'), /In your telescope/i);
    await page.click('#sheet [data-close]');
    assert.equal(await sheetOpen(page), false, 'Done closes the card');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');
    assert.deepEqual(problems, [], 'no errors');

    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    assert.match(await text(page, '#keys'), /Sunset/, 'it works offline once it has loaded');
    await ctx.setOffline(false);
    assert.deepEqual(problems, [], 'no errors offline');
  } finally { await ctx.close(); }
});

// Austin, Wednesday Oct 14 2026: sunrise is 7:32 am, so the night that is ending runs until 8:22 am.
check('a morning moves on to the coming night, and stays on it past noon', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-14T08:15:00-05:00' });
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Tue, Oct 13', 'the night is still going on at 8:15');
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), true);
    await page.clock.fastForward('10:00'); // the 30-second clock passes 8:22
    await until(page, '#when', /pm Wed, Oct 14$/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/, 'the map moves to tonight once it is dark');
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T08:30:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'Tonight');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/);
    await page.click('#nowBtn');
    await until(page, '#when', /Now/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'Now keeps tonight');
    assert.equal(await text(page, '#when'), '8:30 am Now · Wed, Oct 14');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T11:59:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    await page.clock.fastForward('02:30');
    await page.waitForTimeout(300);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'still tonight after noon');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The times under the timeline, by name: { Sunset: '7:01 pm', Dark: '8:21 pm', ... }
const keys = page => page.$$eval('#keys span', s => Object.fromEntries(s.map(x => [x.firstChild.textContent.trim(), x.querySelector('b').textContent])));
const TROMSO = { name: 'Tromsø, NO', lat: 69.65, lon: 18.96, tz: 'Europe/Oslo' };

check('fully dark and the verdict use the same twilight and moonset times as the keys', async () => {
  for (const [loc, time] of [[AUSTIN, '2026-10-13T21:00:00-05:00'], [TROMSO, '2026-10-13T21:00:00+02:00'], [TROMSO, '2026-12-15T21:00:00+01:00']]) {
    const { ctx, page } = await open({ loc, time });
    try {
      const k = await keys(page), where = loc.name + ' ' + time;
      assert.equal(await text(page, '#tonightSec .fact.wide b'), k.Dark + ' – ' + k.Dawn, 'fully dark, ' + where);
      const lede = await text(page, '#tonightSec .lede');
      if (k.Moonset && /Moon down/.test(lede)) assert.match(lede, new RegExp('from ' + k.Moonset + ' to ' + k.Dawn), 'moonless hours, ' + where);
    } finally { await ctx.close(); }
  }
});

const only = process.argv[2];
let failed = 0, ran = 0;
for (const [name, fn] of checks) {
  if (only && !name.includes(only)) continue;
  ran++;
  try { await fn(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').join('\n      ')); }
}
await browser.close();
server.close();
if (!ran) { console.log('no check matches ' + JSON.stringify(only)); process.exit(1); }
if (failed) { console.log(`${failed} of ${ran} failed`); process.exit(1); }
console.log(`all good (${ran} check${ran === 1 ? "" : "s"})`);
