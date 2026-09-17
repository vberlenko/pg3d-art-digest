// HTML -> PNG with headless Chromium (Playwright). 2x scale so text stays crisp in Slack previews.
import { chromium } from 'playwright';

export async function renderPng(html, outPath, { width = 820 } = {}) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath, fullPage: true, type: 'png' });
  } finally {
    await browser.close();
  }
}
