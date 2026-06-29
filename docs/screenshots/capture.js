#!/usr/bin/env node
// Capture Jira Dashboard screenshots.
//
// Usage:
//   1. Make sure the dashboard is running locally (default port 3006)
//   2. node docs/screenshots/capture.js            (uses http://localhost:3006)
//   2. BASE_URL=http://host:port node capture.js  (override for remote)
//   3. PNGs land in docs/screenshots/
//
// What this captures (all light mode):
//   Desktop
//     desktop-home.png             — board + suggestions (0.5s wait so suggestions paint)
//     desktop-clarification.png    — ticket in Clarification stage
//     desktop-implementation.png   — ticket in Implementation stage
//     desktop-review.png           — ticket in Review stage
//     desktop-done.png             — ticket in Done stage
//   Mobile
//     mobile-home.png              — board, no extra wait
//     mobile-ticket.png            — Done-stage ticket detail
//
// Requires Playwright + chromium. On a fresh box:
//   npm install --no-save playwright
//   npx playwright install chromium
//   # On Debian/Ubuntu you may also need:
//   apt install libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
//               libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
//               libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf-8'));
const BASE = process.env.BASE_URL || `http://localhost:${cfg.port || 3006}`;
const OUT  = path.join(__dirname);
const DESKTOP = { width: 1440, height: 900 };
const MOBILE  = { width: 390, height: 844 };

const shot = async (page, name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${name}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
};

// Pick a real ticket id in a given stage from the live API.
// Falls back to "any ticket" if the stage is empty.
async function pickTicket(page, stage) {
  return page.evaluate(async (stage) => {
    const r = await fetch('/api/tickets');
    const d = await r.json();
    const found = d.tickets.find(t => t.stage === stage) || d.tickets[0];
    return found?.id || null;
  }, stage);
}

// Open a ticket by hash and wait for its popup to render + SSE to populate.
async function openTicket(page, base, id) {
  await page.goto(`${base}/#ticket/${id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h2', { timeout: 10000 });
  await page.waitForTimeout(1200); // SSE / activity / plan hydration
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- DESKTOP ----
  console.log('▶ Desktop');
  let ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  let page = await ctx.newPage();

  // 1. Home — 0.5s extra so the suggestions list finishes its first paint.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1', { timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, 'desktop-home.png');

  // 2–5. One ticket per stage.
  for (const stage of ['clarification', 'implementation', 'review', 'done']) {
    const id = await pickTicket(page, stage);
    if (!id) { console.warn(`  ! no ticket for ${stage}, skipping`); continue; }
    console.log(`  · ${stage}: ${id.slice(0, 28)}...`);
    await openTicket(page, BASE, id);
    await shot(page, `desktop-${stage}.png`);
  }

  await ctx.close();

  // ---- MOBILE (iPhone 13) ----
  console.log('▶ Mobile');
  ctx = await browser.newContext({
    viewport: MOBILE, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  page = await ctx.newPage();

  // 6. Home — no extra wait.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1', { timeout: 10000 });
  await shot(page, 'mobile-home.png');

  // 7. Ticket detail (Done stage — richest view: plan, tests, activity).
  const doneId = await pickTicket(page, 'done');
  console.log(`  · ticket: ${doneId?.slice(0, 28)}...`);
  await openTicket(page, BASE, doneId);
  await shot(page, 'mobile-ticket.png');

  await ctx.close();
  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e); process.exit(1); });