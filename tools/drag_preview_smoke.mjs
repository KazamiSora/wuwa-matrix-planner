import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const config = () => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1'));
  return library.plans.find(plan => plan.id === library.activePlanId).config;
});
async function startMove(id, dx) {
  const node = page.locator(`.team-bar[data-id="${id}"]`);
  await node.scrollIntoViewIfNeeded();
  const bounds = await node.boundingBox();
  const x = bounds.x + Math.min(bounds.width / 2, 80), y = bounds.y + 24;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 5 });
  await page.waitForTimeout(220);
}
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('.team-bar').first().waitFor();
  const original = await config();
  await startMove(original.teams[0].id, 400);
  assert.deepEqual((await config()).teams, original.teams, 'preview must not save a new order');
  assert.equal(await page.locator('.is-reordering').count(), 1);
  const visual = await page.locator('.team-bar').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.id, left: parseFloat(node.style.left), width: parseFloat(node.style.width) })).sort((a, b) => a.left - b.left));
  assert.deepEqual(visual.map(row => row.id), [original.teams[1].id, original.teams[0].id, original.teams[2].id]);
  assert.equal(await page.locator('.axis-guide.start').evaluate(node => parseFloat(node.style.left)), visual[1].left);
  assert.equal(await page.locator('.axis-guide.end').evaluate(node => parseFloat(node.style.left)), visual[1].left + visual[1].width);
  for (let i = 1; i < visual.length; i++) assert.ok(Math.abs(visual[i].left - visual[i - 1].left - visual[i - 1].width) < .1);
  await page.locator('.timeline-card').screenshot({ path: 'outputs/drag-order-preview.png' });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual((await config()).teams, original.teams);
  assert.equal(await page.locator('.drag-preview-active').count(), 0);
  await startMove(original.teams[0].id, 400); await page.mouse.up();
  assert.deepEqual((await config()).teams.map(team => team.id), visual.map(row => row.id));
  assert.equal(await page.locator('.is-reordering').count(), 0);
  // A canceled gesture also works for an unscored 5000-point preview.
  const pending = JSON.parse(await readFile('config/demo.json', 'utf8'));
  pending.teams[0].score = 0; pending.teams[0].needsScore = true;
  let cursor = 0; for (const team of pending.teams) { team.startScore = cursor; cursor += team.score; }
  await page.locator('#import-file').setInputFiles({ name: 'pending-drag.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pending)) });
  await page.locator('.pending-score-bar').waitFor();
  const saved = await config();
  await startMove(saved.teams[0].id, 400);
  assert.deepEqual((await config()).teams, saved.teams);
  await page.locator('.is-reordering').dispatchEvent('pointercancel'); await page.mouse.up();
  assert.deepEqual((await config()).teams, saved.teams);
  assert.equal(await page.locator('.team-drop-marker').isVisible(), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startMove(saved.teams[0].id, 400);
  assert.equal(await page.locator('.is-reordering').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await page.mouse.up();
  const updated = await config();
  assert.equal(updated.teams.find(team => team.id === saved.teams[0].id).score, 0);
  assert.ok(updated.teams.every(team => !('axisScore' in team) && !('dragPreviewIndex' in team)));
  assert.deepEqual(errors, []);
  console.log('PASS: live contiguous reorder preview, no premature save, release commit, Escape/pointer cancellation, pending-score preservation and reduced motion.');
} finally { await browser.close(); }
