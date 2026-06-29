#!/usr/bin/env node
// Capture Jira Dashboard screenshots (desktop + mobile, light + dark).
//
// Usage:
//   1. Make sure the dashboard is running locally on http://localhost:3006
//   2. node docs/screenshots/capture.js
//   3. PNGs land in docs/screenshots/
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

const BASE = process.env.BASE_URL || 'http://localhost:3006';
const OUT  = path.join(__dirname);
const DESKTOP = { width: 1440, height: 900 };
const MOBILE  = { width: 390, height: 844 };

const shot = async (page, name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${name}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // Desktop
  console.log('▶ Desktop');
  let ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  let page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1', { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot(page, 'desktop-board-light.png');

  // Toggle to dark via the theme cycle button (Moon/Sun/Monitor in header)
  await page.locator('[aria-label^="Theme:"]').click();
  await page.waitForTimeout(300);
  await shot(page, 'desktop-board-dark.png');

  // Open a "done" ticket — it has the richest popup view (plan + tests + activity)
  const ticketId = await page.evaluate(async () => {
    const r = await fetch('/api/tickets');
    const d = await r.json();
    return d.tickets.find(t => t.stage === 'done')?.id || d.tickets[0]?.id;
  });
  if (!ticketId) throw new Error('No tickets found — create some first.');

  // Back to light for the ticket (consistent with most readers' defaults)
  await page.locator('[aria-label^="Theme:"]').click();
  await page.waitForTimeout(200);

  await page.goto(`${BASE}/#ticket/${ticketId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h2', { timeout: 10000 });
  await page.waitForTimeout(1500); // let SSE populate
  await shot(page, 'desktop-ticket-done.png');

  await page.locator('[aria-label^="Theme:"]').click();
  await page.waitForTimeout(500);
  await shot(page, 'desktop-ticket-done-dark.png');

  await ctx.close();

  // Mobile
  console.log('▶ Mobile');
  ctx = await browser.newContext({
    viewport: MOBILE, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1', { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot(page, 'mobile-board-light.png');

  await page.locator('[aria-label^="Theme:"]').click();
  await page.waitForTimeout(300);
  await shot(page, 'mobile-board-dark.png');

  await page.goto(`${BASE}/#ticket/${ticketId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h2', { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'mobile-ticket.png');

  await ctx.close();
  await browser.close();
  console.log('\nDone. Images in docs/screenshots/');
})().catch(e => { console.error(e); process.exit(1); });