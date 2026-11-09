import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const choose = name => page.getByRole('button', { name, exact: true }).click();
async function finishFlights() {
  await page.waitForFunction(() => document.querySelectorAll('.picker-flying-portrait').length === 0);
}
async function checkFlight(target) {
  const info = await page.evaluate(selector => {
    const image = document.querySelector('.picker-flying-portrait');
    const animation = image?.getAnimations()[0];
    const to = document.querySelector(selector)?.getBoundingClientRect();
    if (!animation || !to) return null;
    const keyframes = animation.effect.getKeyframes();
    const matrix = new DOMMatrix(keyframes.at(-1).transform);
    return { inDialog: image.parentElement.id === 'character-dialog', pointer: getComputedStyle(image).pointerEvents,
      x: parseFloat(image.style.left) + matrix.e, y: parseFloat(image.style.top) + matrix.f,
      width: parseFloat(image.style.width) * matrix.a, to: { x: to.x, y: to.y, width: to.width } };
  }, target);
  assert.ok(info?.inDialog, 'the animation must be in the dialog top layer');
  assert.equal(info.pointer, 'none');
  assert.equal(await page.locator(target).first().evaluate(node => getComputedStyle(node).opacity), '0', 'destination must stay empty until arrival');
  for (const key of ['x', 'y', 'width']) assert.ok(Math.abs(info[key] - info.to[key]) < 1, `flight ${key} misses destination`);
}
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('#quick-team').click();
  assert.ok((await page.locator('#character-dialog').boundingBox()).width >= 1410);
  assert.ok((await page.locator('.character-avatar').first().boundingBox()).width < 80);
  await choose('忌炎');
  await checkFlight('#quick-team-preview .quick-preview-member img');
  await page.evaluate(() => { const a = document.querySelector('.picker-flying-portrait').getAnimations()[0]; a.pause(); a.currentTime = 210; });
  await page.locator('#character-dialog').screenshot({ path: 'outputs/picker-flight-preview.png' });
  await choose('鉴心');
  assert.equal(await page.locator('#quick-team-preview .portrait').first().evaluate(node => getComputedStyle(node).opacity), '0', 'rerendering during another pick must not reveal an in-flight avatar');
  await page.evaluate(() => document.querySelector('.picker-flying-portrait').getAnimations()[0].play());
  await choose('莫特斐');
  assert.match(await page.locator('#picked-count').innerText(), /3 人/);
  await finishFlights();
  assert.ok(await page.locator('#quick-team-preview .portrait').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '1')));
  assert.equal(await page.locator('.picker-awaiting-arrival').count(), 0);
  await page.locator('#quick-undo').click();
  assert.match(await page.locator('#picked-count').innerText(), /2 人/);
  await choose('莫特斐'); await page.locator('#quick-reset').click();
  assert.equal(await page.locator('.picker-flying-portrait').count(), 0);
  assert.match(await page.locator('#picked-count').innerText(), /0 人/);
  await choose('忌炎'); await page.keyboard.press('Escape');
  await finishFlights();
  await page.locator('#add-team').click();
  await choose('忌炎');
  await checkFlight('#picker-selected-roster img');
  assert.equal(await page.locator('#picker-selected-roster img').count(), 1);
  await choose('忌炎');
  assert.equal(await page.locator('#picker-selected-roster img').count(), 0);
  await page.keyboard.press('Escape'); await finishFlights();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#quick-team').click(); await choose('忌炎');
  assert.equal(await page.locator('.picker-flying-portrait').count(), 0);
  assert.match(await page.locator('#picked-count').innerText(), /1 人/);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#quick-team').click(); await choose('忌炎'); await finishFlights();
  const confirm = await page.locator('#confirm-characters').boundingBox();
  assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 845);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('#character-dialog').screenshot({ path: 'outputs/picker-flight-mobile.png' });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: smaller avatars/larger window, flight destination in quick/normal picker, rapid selection, undo/reset/close cleanup, reduced motion and mobile.');
} finally { await browser.close(); }
