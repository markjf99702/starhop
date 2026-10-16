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
const fontsLoaded = page => page.evaluate(async () => { await document.fonts.ready; return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))].sort(); });
const FONTS = ['Atkinson Hyperlegible', 'DM Mono', 'IM Fell English'];
// Waits until an element's text matches, since the map redraws on the next frame.
const until = (page, sel, re) => page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s).innerText.replace(/\s+/g, ' ').trim()), [sel, re.source], { timeout: 15000 }).catch(() => {});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('opens on tonight, lists targets, opens a card, fits a phone and works offline', async () => {
  const { ctx, page, problems, outside } = await open({ time: '2026-10-13T21:00:00-05:00', sw: true });
  try {
    assert.match(await text(page, '#nightTitle'), /^Tonight · Tue, Oct 13$/);
    assert.deepEqual(await fontsLoaded(page), FONTS, 'its own fonts load');
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
    assert.deepEqual(outside, [], 'nothing loads from another site');

    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    assert.match(await text(page, '#keys'), /Sunset/, 'it works offline once it has loaded');
    assert.deepEqual(await fontsLoaded(page), FONTS, 'with its fonts');
    await ctx.setOffline(false);
    assert.deepEqual(problems, [], 'no errors offline');
  } finally { await ctx.close(); }
});

check('the offline copy lists files that exist, fonts included', async () => {
  const list = [...(await readFile(join(root, 'sw.js'), 'utf8')).match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
  for (const f of list) await readFile(join(root, f)).catch(() => assert.fail(`sw.js keeps ${f}, which doesn't exist`));
  const fonts = (await readFile(join(root, 'index.html'), 'utf8')).match(/fonts\/[\w-]+\.woff2/g) || [];
  assert.ok(fonts.length, 'the page uses fonts from fonts/');
  for (const f of fonts) assert.ok(list.includes(f), `sw.js doesn't keep ${f} for offline use`);
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

// At Tromsø the Sun doesn't set from late May to late July, and doesn't rise from late November to mid January.
check('under the midnight sun the banner and the verdict say the Sun doesn’t set', async () => {
  let { ctx, page, problems } = await open({ loc: TROMSO, time: '2026-06-21T23:30:00+02:00' });
  try {
    await until(page, '#banner', /Sun/);
    assert.equal(await page.$eval('#banner', b => b.hidden), false);
    assert.equal(await text(page, '#banner'), 'The Sun doesn’t set tonight', 'no hint to drag along a night that isn’t there');
    assert.match(await text(page, '#tonightSec .lede'), /^The Sun doesn’t set tonight/);
    assert.equal(await text(page, '#tonightSec .fact.wide em'), 'The Sun doesn’t set tonight');
    assert.doesNotMatch(await text(page, '#tonightSec'), /18°/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ loc: TROMSO, time: '2026-12-15T21:00:00+01:00' }));
  try {
    assert.doesNotMatch(await text(page, '#tonightSec'), /doesn’t set/, 'polar night has no sunset either');
    assert.equal(await page.$eval('#banner', b => b.hidden), true);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026: the Sun sets at 7:01 pm and is 6° down by 7:28.
check('stars come out steadily through dusk', async () => {
  const dusk = Date.parse('2026-10-13T19:00:00-05:00');
  const { ctx, page } = await open({ time: dusk });
  try {
    const counts = [];
    for (let m = 5; m <= 40; m += 5) {
      await page.clock.pauseAt(new Date(dusk + m * 60e3));
      await page.click('#nowBtn');
      await page.clock.runFor(100); // the map redraws on the next frame
      counts.push(await page.evaluate(() => document.getElementById('sky').__hits().filter(h => h.obj.k === 'star').length));
    }
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], 'stars drawn every 5 minutes from 7:05 pm: ' + counts.join(', '));
  } finally { await ctx.close(); }
});

const DOB8 = { name: '8″ Dobsonian', ap: 203, fl: 1200, eps: [{ f: 25, a: 52 }, { f: 6, a: 52 }], set: true };
const openCard = async (page, id) => {
  if (!await page.$(`#targetSec .row[data-id="${id}"]`) && await page.$('#moreT')) await page.click('#moreT');
  await page.click(`#targetSec .row[data-id="${id}"]`);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};

// At 6 am on Oct 14 2026 PyEphem, with its own moon theory, puts Io 0.70′ east of Jupiter and Europa 0.50′.
check("Jupiter's moons are drawn where they're seen, allowing for light time", async () => {
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-10-14T06:00:00-05:00' });
  try {
    await openCard(page, 'Jupiter');
    await page.waitForFunction(() => document.getElementById('eyepiece').__moons, null, { timeout: 10000 });
    const m = await page.$eval('#eyepiece', c => c.__moons), ref = { io: 0.70, europa: 0.50, ganymede: -2.11, callisto: 0.79 };
    for (const k in ref) assert.ok(Math.abs(m[k].east - ref[k]) < 0.05, `${k} is drawn ${m[k].east.toFixed(2)}′ east of Jupiter; it's ${ref[k]}′`);
  } finally { await ctx.close(); }
});

check('on a desktop an open card covers only the side panel', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page));
    const box = await page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return { s: [s.left, s.top, s.width], p: [p.left, p.top, p.width] }; });
    assert.deepEqual(box.s, box.p, 'the card sits exactly over the panel');
    for (const id of ['zIn', 'nextN', 'layBtn', 'nowBtn', 'redBtn', 'scopeBtn', 'locBtn']) {
      const onTop = await page.$eval('#' + id, el => { const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el.contains(hit); });
      assert.ok(onTop, `#${id} is under the card`);
    }
    await page.click('#scopeBtn');
    assert.match(await text(page, '#sheet .hd h2'), /^Your telescope/, 'the Telescope button still works with a card open');
  } finally { await ctx.close(); }
});

// On Android the installed app has only Back to close a card, and Back used to leave Starhop instead.
check('Back closes an open card or sheet, and closing one another way leaves no extra step behind', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForFunction(() => document.getElementById('sheet').hidden, null, { timeout: 5000 }).catch(() => {}); };
  const settled = () => page.waitForFunction(() => !history.state, null, { timeout: 5000 }).catch(() => {});
  try {
    const start = page.url(), steps = await page.evaluate(() => history.length);
    await page.click('#targetSec .row');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the card');
    assert.equal(page.url(), start, 'and stays in Starhop');
    assert.match(await text(page, '#keys'), /Sunset/);
    for (const how of ['Done', 'the backdrop', 'Escape', 'Back']) {
      await page.click('#targetSec .row');
      if (how === 'Done') await page.click('#sheet [data-close]');
      else if (how === 'the backdrop') await page.mouse.click(195, 20); // above the card
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else await back();
      await settled();
      assert.equal(await sheetOpen(page), false, how + ' closes the card');
      assert.equal(await page.evaluate(() => history.length), steps + 1, 'closing with ' + how + ' takes the card’s step off again');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false }));
  try {
    const steps = await page.evaluate(() => history.length);
    await openCard(page, 'M13');
    await page.click('#scopeBtn');
    await page.click('#sheet .hd [data-close]'); // the telescope sheet took the card's place, on the same step
    await settled();
    assert.equal(await sheetOpen(page), false);
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'one step for the card and the sheet that replaced it');
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the sheet that replaced a card');
    await page.click('#scopeBtn');
    await page.click('#scSave');
    await settled();
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'Save takes the step off too');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// On a desktop a click beside the sheet doesn't close it, so it needs a way out that doesn't save.
check('the telescope sheet closes with Cancel, which drops the changes', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#scopeBtn');
    await page.fill('#scAp', '254');
    await page.click('#nightTitle');
    assert.ok(await sheetOpen(page), 'a click beside the sheet leaves it open');
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await sheetOpen(page), false, 'Cancel closes the sheet');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).scope), undefined, 'nothing is saved');
    assert.match(await text(page, '#targetSec .note'), /^Ratings assume an example 130 mm reflector/, 'the example telescope is still the one rated for');
    assert.equal(await text(page, '#scopeName'), 'Telescope');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('an open card follows the time shown, and other sheets stay as they are', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const cardAt = () => page.$eval('#sheet .card h3', h => h.textContent);
  const riseSet = () => page.$eval('#sheet .card p:not(.big)', p => p.textContent);
  try {
    const tl = await page.locator('#tlc').boundingBox(), at = f => page.mouse.click(tl.x + tl.width * f, tl.y + tl.height / 2);
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await at(0.3);
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Where you observe', 'a click on the timeline leaves the location sheet open');
    assert.equal(await page.inputValue('#lq'), 'Tucs');
    await page.keyboard.press('Escape');

    await openCard(page, 'M13');
    await at(0.55);
    assert.notEqual(await cardAt(page), 'At 9:00 pm');
    await page.click('#nowBtn');
    assert.equal(await cardAt(page), 'At 9:00 pm', 'the card follows Now');
    await page.focus('#tlc');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 10:00 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await cardAt(page), 'At 10:00 pm', 'the card follows the timeline keys');
    const before = await riseSet();
    await page.click('#prevN');
    assert.notEqual(await riseSet(), before, 'the card follows the night shown');
  } finally { await ctx.close(); }
});

check("typed coordinates take a decimal comma and a real minus sign, and refuse what they can't read", async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const use = async (lat, lon) => { if (!await sheetOpen(page)) await page.click('#locBtn'); await page.fill('#lLat', lat); await page.fill('#lLon', lon); await page.click('#lUse'); };
    const saved = async () => { const l = await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).loc); return [l.lat, l.lon]; };
    await use('45,76', '4,84');
    assert.deepEqual(await saved(), [45.76, 4.84], 'decimal commas');
    await use('30.27', '−97.74');
    assert.deepEqual(await saved(), [30.27, -97.74], 'a real minus sign');
    await use('30.27', '97.74 W');
    assert.ok(await sheetOpen(page), '"97.74 W" is refused, not read as 97.74° east');
    assert.deepEqual(await saved(), [30.27, -97.74]);
  } finally { await ctx.close(); }
});

check('the location sheet can close before its list of places arrives', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    let release; const held = new Promise(r => { release = r; });
    await page.route('**/data/cities.json', async route => { await held; await route.continue(); });
    await page.click('#locBtn');
    await page.keyboard.press('Escape');
    const arrived = page.waitForResponse(r => r.url().endsWith('data/cities.json'));
    release();
    await arrived;
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), false);
    assert.deepEqual(problems, [], 'no errors once the places arrive');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Chromium reports some zones by older names (Asia/Calcutta, America/Indianapolis, Europe/Kiev).
check('a first visit guesses the place from the time zone, older zone names too', async () => {
  for (const [zone, place] of [['Asia/Kolkata', 'Mumbai, IN'], ['America/Indiana/Indianapolis', 'Indianapolis, IN'], ['Europe/Kyiv', 'Kyiv, UA'], ['America/Phoenix', 'Phoenix, AZ']]) {
    const { ctx, page, problems } = await open({ loc: null, tz: zone, time: '2026-10-13T12:00:00Z' });
    try {
      assert.equal(await text(page, '#locName'), place, zone);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('a damaged or partial save still opens, keeps what makes sense, and is left as it was', async () => {
  const saves = [
    '{"loc":{"name":"Home"}}', '{"loc":{"name":"Home","lat":30.27,"lon":-97.74,"tz":"Mars/Olympus"}}',
    '{"loc":{"name":"Home","lat":"30.27","lon":"-97.74","tz":"America/Chicago"}}',
    '{"scope":null}', '{"seen":null}', '{"layers":"all"}', '{"sky":"moon"}', '{"ptOff":"x"}', '[1,2]', 'not json',
  ];
  for (const save of saves) {
    const { ctx, page, problems } = await open({ save, time: '2026-10-13T21:00:00-05:00' });
    try {
      assert.match(await text(page, '#keys'), /Sunset/, 'opens with ' + save);
      if (save.includes('"30.27"')) assert.equal(await text(page, '#locName'), 'Home', 'numbers written as text still count');
      await page.click('#targetSec .row');
      assert.ok(await sheetOpen(page), 'a card opens with ' + save);
      await page.click('#sheet [data-close]');
      await page.click('#scopeBtn');
      assert.ok(await sheetOpen(page), 'the telescope sheet opens with ' + save);
      assert.deepEqual(problems, [], save);
      assert.equal(await page.evaluate(() => localStorage.getItem('starhop.v1')), save, 'the save is left as it was');
    } finally { await ctx.close(); }
  }
  const noEyepieces = JSON.stringify({ loc: AUSTIN, scope: { name: 'Old', ap: 130, fl: 650, set: true } });
  const { ctx, page, problems } = await open({ save: noEyepieces, time: '2026-10-13T21:00:00-05:00' });
  try {
    await page.click('#targetSec .row');
    assert.match(await text(page, '#sheet'), /Add your eyepieces/, 'a telescope saved without eyepieces asks for them');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Where the lit pixels sit around the middle of the eyepiece view: mean offset in CSS pixels, + is west (right).
const litSide = page => page.$eval('#eyepiece', c => {
  const g = c.getContext('2d'), k = c.width / c.getBoundingClientRect().width, R = Math.round(14 * k), d = g.getImageData(c.width / 2 - R, c.height / 2 - R, 2 * R, 2 * R).data;
  let sx = 0, n = 0;
  for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) { const i = (y * 2 * R + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { sx += x - R; n++; } }
  return n ? sx / n / k : 0;
});

// Oct 1 2026, 7:20 pm: Venus is a 14% crescent in the evening sky, so its lit side faces the Sun in the west.
check('Venus in the eyepiece is lit on the side facing the Sun', async () => {
  const scope = { name: '130 mm reflector', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }, { f: 4, a: 52 }], set: true };
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope }), time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    await page.waitForFunction(() => /163×/.test(document.getElementById('epCap').textContent));
    assert.ok(await litSide(page) > 1, 'the crescent is lit on its west side, toward the Sun');
  } finally { await ctx.close(); }
});

// Oct 1 2026 in Austin, by PyEphem: the Sun sets at 7:16 pm with Venus 10.4° up; by the end of civil twilight at
// 7:40 Venus is down to 5.9°, and it sets at 8:13.
check('an evening planet that only sinks is highest at sunset, not at the end of twilight', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    assert.match(await text(page, '#sheet .card .big'), /^10° up in the southwest/);
    assert.match(await page.$eval('#sheet .card p:not(.big)', p => p.textContent), /^Up at dusk · Sets 8:1\d pm · Highest at sunset \(10°\)$/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const advice = page => page.$$eval('#sheet .card', cs => cs.find(c => c.querySelector('h3').textContent === 'In your telescope').querySelector('p').textContent);

check('a card says an object is wider than the field only when it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const say = async id => { await openCard(page, id); const a = await advice(page); await page.click('#sheet [data-close]'); return a; };
    assert.equal(await say('M45'), 'At 1.8° across, it fills most of your lowest-power field (2.0°). Use the 25 mm, or try binoculars.');
    assert.match(await say('M31'), /^At 3\.2° across, it’s wider than your lowest-power field \(2\.0°\)\./);
    assert.match(await say('M57'), /^It spans 1′\. Find it with the 25 mm \(2\.0° field\), then try the 10 mm \(65×\) for a closer look\.$/);
  } finally { await ctx.close(); }
});

// Izar's stars are 3″ apart, which takes 80×. The example telescope's eyepieces reach 65×; the 8″ Dobsonian's reach 200×.
check('a double star is rated, advised and sketched by the same power, the one your eyepieces reach', async () => {
  for (const [save, label] of [[{ loc: AUSTIN }, 'Needs 80×'], [{ loc: AUSTIN, scope: DOB8 }, 'Easy split']]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify(save), time: '2026-06-15T22:00:00-05:00' });
    try {
      const split = label === 'Easy split', who = save.scope ? 'the 8″ Dobsonian' : 'the example telescope';
      await page.click('#targetSec .filters [data-f="double"]');
      assert.equal(await page.$eval('#targetSec .row[data-id="izar"] .rate', el => el.textContent), label, 'the list, ' + who);
      await openCard(page, 'izar');
      assert.match(await advice(page), split ? /about 80× splits them, so start with the 6 mm \(200×\)\.$/ : /takes about 80×; your highest power is 65×\./, 'the card, ' + who);
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      (split ? assert.doesNotMatch : assert.match)(await text(page, '#epCap'), /not split at this power/, 'the eyepiece sketch, ' + who);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Taps an object on the sky map: a planet by name, or a star by its index in data/stars.json.
const tapMap = async (page, k, id) => {
  const hit = await page.evaluate(([k, id]) => document.getElementById('sky').__hits().find(h => h.obj.k === k && (h.obj.id === id || h.obj.i === id)), [k, id]);
  assert.ok(hit, `${k} ${id} is on the map`);
  const box = await page.locator('#sky').boundingBox();
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};
const starIndex = async name => { const n = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).n; return +Object.keys(n).find(i => n[i][0] === name); };

check('a star card says a star stays a point, not how wide it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await tapMap(page, 'star', await starIndex('Vega'));
    assert.match(await text(page, '#sheet .hd h2'), /^Vega/);
    assert.equal(await advice(page), 'A star stays a point at any power. The 25 mm (2.0° field) shows it with the stars around it.');
  } finally { await ctx.close(); }
});

check('the Moon card says the whole Moon fits only when it does', async () => {
  const c11 = { name: 'C11', ap: 280, fl: 2800, eps: [{ f: 25, a: 52 }, { f: 12, a: 52 }], set: true };
  let { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: c11 }), time: '2026-10-18T20:00:00-05:00' });
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The Moon \(30\.0′ across\) is wider than your lowest-power field \(28′\), so even the 25 mm shows part of it at a time\. At 233× with the 12 mm,/);
  } finally { await ctx.close(); }
  ({ ctx, page } = await open({ time: '2026-10-18T20:00:00-05:00' }));
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The whole Moon fits in the 25 mm eyepiece \(2\.0° field\)\./);
  } finally { await ctx.close(); }
});

check('a sheet takes the keyboard focus, has a name, and gives the focus back', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const focusIn = sel => page.evaluate(s => document.querySelector(s).contains(document.activeElement), sel);
  try {
    const row = page.locator('#targetSec .row').first(), id = await row.getAttribute('data-id');
    await row.focus();
    await page.keyboard.press('Enter');
    assert.ok(await sheetOpen(page));
    assert.ok(await focusIn('#sheet'), 'the focus moves into the card');
    const title = await page.$eval('#sheet .hd h2', h => h.firstChild.textContent);
    assert.equal(await page.getByRole('dialog', { name: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).count(), 1, 'the card is named by its title');
    await page.keyboard.press('Tab');
    assert.ok(await focusIn('#sheet'), 'Tab stays in the card');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id, 'closing gives the focus back to the row');
    assert.equal(await page.getByRole('button', { name: 'Location: Austin, TX' }).count(), 1, 'the location button is named with the place it shows');
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026, by the USNO convention (PyEphem): Saturn rises 6:37 pm and sets 6:48 am, Jupiter rises 2:58 am, Mars 1:58 am.
check('planet rise and set times match the standard ones', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    const times = async id => { await openCard(page, id); const t = await page.$eval('#sheet .card p:not(.big)', p => p.textContent); await page.keyboard.press('Escape'); return t; };
    assert.match(await times('Saturn'), /Rises 6:37 pm · Sets 6:48 am/);
    assert.match(await times('Jupiter'), /Rises 2:58 am/);
    assert.match(await times('Mars'), /Rises 1:58 am/);
  } finally { await ctx.close(); }
});

check('M40 and M73, which have no size, get no made-up size or cluster sketch', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    for (const id of ['M40', 'M73']) {
      await openCard(page, id);
      const size = await page.$$eval('#sheet .kv div', ds => ds.find(d => d.querySelector('span').textContent === 'Size').querySelector('b').textContent);
      assert.equal(size, '—', id + ' size');
      assert.equal(await advice(page), 'Find it with the 25 mm (2.0° field), then try the 10 mm (65×) for a closer look.', id + ' advice');
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      assert.doesNotMatch(await text(page, '#epCap'), /sketch/, id + ' has no cluster sketch');
      await page.keyboard.press('Escape');
    }
  } finally { await ctx.close(); }
});

check('star labels in the data are all real designations', async () => {
  const n = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).n;
  assert.deepEqual(Object.entries(n).filter(([, v]) => v.some(x => /undefined/.test(x))), [], 'labels with "undefined" in them');
});

check('Show in the sky view jumps straight up when motion is reduced', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', reducedMotion: 'reduce' });
  try {
    await page.click('#moreT');
    await page.locator('#targetSec .row').last().click();
    assert.ok(await page.evaluate(() => scrollY) > 1000, 'the card was opened from far down the list');
    await page.click('#ctr');
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => scrollY), 0, 'no animated scroll');
  } finally { await ctx.close(); }
});

// The muted labels (--ink3) are 10.5 to 12 px, so they need 4.5:1 on every surface they sit on.
check('small muted labels have 4.5:1 contrast on the page and its panels', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement), lum = name => {
        const h = css.getPropertyValue(name).trim().slice(1), c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      return Object.fromEntries(['--bg', '--panel', '--panel2', '--raise'].map(b => [b, +((lum('--ink3') + 0.05) / (lum(b) + 0.05)).toFixed(2)]));
    });
    for (const b in ratios) assert.ok(ratios[b] >= 4.5, `--ink3 on ${b} is ${ratios[b]}:1`);
  } finally { await ctx.close(); }
});

check('without JavaScript it says what it needs, and GitHub Pages serves it as it is', async () => {
  await readFile(join(root, '.nojekyll')).catch(() => assert.fail('.nojekyll is missing'));
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    const note = page.locator('noscript p'); // Playwright's text search skips <noscript>, so look at it directly
    assert.ok(await note.isVisible(), 'the no-JavaScript note shows');
    assert.equal(await note.textContent(), 'Starhop needs JavaScript to draw the sky.');
  } finally { await ctx.close(); }
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
