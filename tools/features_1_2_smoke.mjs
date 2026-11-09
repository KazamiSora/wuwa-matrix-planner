import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const errors = [];
const pages = [];
async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message)); pages.push(page);
  await page.goto(baseUrl); await page.locator('.team-bar').first().waitFor(); return page;
}
const state = page => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1'));
  return library.plans.find(plan => plan.id === library.activePlanId).config;
});
async function gap(page, status, amount) {
  const output = page.locator('#target-score-gap');
  assert.equal(await output.isVisible(), true);
  assert.equal(await output.getAttribute('data-status'), status);
  const text = await output.innerText();
  if (status === 'reached') assert.match(text, /已达到目标分数/);
  else {
    assert.match(text, status === 'shortfall' ? /还差/ : /超出/);
    assert.ok(text.replaceAll(',', '').includes(String(amount)), `${text} does not contain ${amount}`);
  }
}
async function sameRowThree(page, selector) {
  const cards = page.locator(selector); assert.ok(await cards.count() >= 3);
  const boxes = await Promise.all([0, 1, 2].map(index => cards.nth(index).boundingBox()));
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2 && Math.abs(boxes[1].y - boxes[2].y) < 2, `${selector} is not a three-column row`);
  assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x + 1 && boxes[1].x + boxes[1].width <= boxes[2].x + 1);
}
async function visibleInside(page, selector) {
  const box = await page.locator(selector).boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} is outside the viewport`);
}
try {
  await mkdir('outputs', { recursive: true });
  const page = await freshPage();
  const originalPlan = await page.locator('#plan-select').inputValue();
  assert.equal(await page.locator('#target-score-gap').isVisible(), false);
  await page.locator('#target-score').fill('50000'); await gap(page, 'shortfall', 26000);
  await page.locator('#target-score').fill('24000'); await gap(page, 'reached');
  await page.locator('#target-score').fill('23000'); await gap(page, 'exceeded', 1000);
  await page.locator('#target-score').fill(''); assert.equal(await page.locator('#target-score-gap').isVisible(), false);
  await page.locator('#target-score').fill('50000'); await page.locator('#locate-score').click();
  assert.equal((await state(page)).scoreMarker, 50000); await gap(page, 'shortfall', 26000);
  const location = await page.locator('#target-score-location').boundingBox(), difference = await page.locator('#target-score-gap').boundingBox();
  assert.ok(difference.x >= location.x, 'target gap belongs on the right side of the target row');
  await page.locator('#add-team').click();
  for (const name of ['忌炎', '鉴心', '莫特斐']) await page.getByRole('button', { name, exact: true }).click();
  await page.locator('#confirm-characters').click();
  const pending = (await state(page)).teams.at(-1);
  assert.equal(pending.score, 0); assert.equal(pending.needsScore, true);
  assert.equal(await page.locator(`.team-bar[data-id="${pending.id}"]`).getAttribute('data-axis-score'), '5000');
  await gap(page, 'shortfall', 26000);
  await page.locator(`.team-bar[data-id="${pending.id}"]`).dblclick();
  await page.locator('#dialog-team-score').fill('4000'); await page.locator('#confirm-characters').click();
  await gap(page, 'shortfall', 22000);
  await page.locator('#delete-team').click(); await gap(page, 'shortfall', 26000);
  await page.locator('#undo-team-delete').click(); await gap(page, 'shortfall', 22000);
  await page.locator('#redo-team-delete').click(); await gap(page, 'shortfall', 26000);
  await page.locator('.team-card[data-id="team-1"]').click();
  await page.locator('#team-score').fill('9000'); await page.locator('#apply-team').click();
  await gap(page, 'shortfall', 25000);
  await page.locator('#undo-team-delete').click(); await gap(page, 'shortfall', 21000);
  assert.equal((await state(page)).teams.reduce((sum, team) => sum + team.score, 0), 29000);
  await page.reload(); await page.locator('.team-bar').first().waitFor(); await gap(page, 'shortfall', 21000);
  await page.locator('#score-locator').screenshot({ path: 'outputs/features-target-gap.png' });
  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill('Feature差额空方案'); await page.locator('#confirm-plan').click();
  assert.equal(await page.locator('#target-score-gap').isVisible(), false);
  await page.locator('#plan-select').selectOption(originalPlan); await gap(page, 'shortfall', 21000);
  await page.locator('#clear-score-marker').click(); assert.equal(await page.locator('#target-score-gap').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#target-score').fill('50000'); await page.locator('#locate-score').click();
  await gap(page, 'shortfall', 21000);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  const picker = await freshPage(), original = await state(picker);
  await picker.locator('#quick-team').click();
  assert.equal(await picker.locator('#quick-team-hint').count(), 0);
  assert.doesNotMatch(await picker.locator('#character-dialog').innerText(), /已有\s*3\s*队，从第/);
  assert.equal(await picker.locator('.picker-meta-row > #picker-stamina-note').count(), 1);
  assert.equal(await picker.locator('.picker-meta-row > #character-search').count(), 1);
  assert.equal(await picker.locator('.picker-meta-row > #quick-team-panel').count(), 1);
  const note = await picker.locator('#picker-stamina-note').boundingBox();
  const search = await picker.locator('#character-search').boundingBox();
  const actions = await picker.locator('#quick-team-panel').boundingBox();
  const filters = await picker.locator('.element-filter-row').boundingBox();
  assert.ok(note.x + note.width <= search.x + 1 && search.x + search.width <= actions.x + 1);
  assert.ok(Math.max(note.y, search.y, actions.y) < Math.min(note.y + note.height, search.y + search.height, actions.y + actions.height), 'metadata/search/actions should share a row');
  assert.ok(actions.y + actions.height <= filters.y + 2, 'actions should be above attribute filters');
  await sameRowThree(picker, '#quick-team-overview-list .team-overview-card');
  assert.ok(await picker.locator('#quick-team-overview .team-overview-member > span:not(.quick-empty-slot)').evaluateAll(nodes => nodes.length >= 9 && nodes.every(node => getComputedStyle(node).display === 'none')));
  await picker.locator('#character-search').fill('散华'); assert.equal(await picker.locator('.character-choice').count(), 1);
  await picker.locator('#character-search').fill('');
  const draftNames = ['忌炎', '鉴心', '莫特斐', '安可', '散华', '炽霞', '凌阳', '秧秧', '灯灯'];
  for (const name of draftNames) await picker.getByRole('button', { name, exact: true }).click();
  assert.equal(await picker.locator('.quick-preview-team').count(), 3);
  await sameRowThree(picker, '#quick-team-preview .quick-preview-team');
  assert.ok(await picker.locator('.quick-preview-character-name').evaluateAll(nodes => nodes.length === 9 && nodes.every(node => getComputedStyle(node).display === 'none')));
  await picker.locator('#quick-undo').click(); assert.match(await picker.locator('#picked-count').innerText(), /8 人/);
  await picker.locator('#quick-redo').click(); assert.match(await picker.locator('#picked-count').innerText(), /9 人/);
  await picker.locator('#quick-reset').click(); assert.equal(await picker.locator('.quick-preview-team').count(), 0);
  await picker.locator('#quick-undo').click(); assert.equal(await picker.locator('.quick-preview-team').count(), 3);
  await visibleInside(picker, '#confirm-characters');
  await picker.locator('#character-dialog').screenshot({ path: 'outputs/features-quick-picker.png' });
  assert.deepEqual((await state(picker)).teams, original.teams);
  await picker.keyboard.press('Escape'); assert.deepEqual((await state(picker)).teams, original.teams);
  await picker.locator('#team-overview').click();
  assert.ok(await picker.locator('#team-overview-list .team-overview-member > span').evaluateAll(nodes => nodes.length === 9 && nodes.every(node => getComputedStyle(node).display !== 'none')));
  await picker.keyboard.press('Escape');
  await picker.locator('.character-slot').first().click();
  assert.equal(await picker.locator('#quick-team-panel').isVisible(), false);
  assert.equal(await picker.locator('#quick-team-overview').isVisible(), false);
  await picker.locator('#character-search').fill('散华'); assert.equal(await picker.locator('.character-choice').count(), 1);
  await picker.keyboard.press('Escape');
  await picker.setViewportSize({ width: 390, height: 844 }); await picker.locator('#quick-team').click();
  await sameRowThree(picker, '#quick-team-overview-list .team-overview-card');
  await visibleInside(picker, '#character-search'); await visibleInside(picker, '#quick-reset'); await visibleInside(picker, '#confirm-characters');
  assert.ok(await picker.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(await picker.locator('#character-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length >= 4));
  await picker.locator('#character-dialog').screenshot({ path: 'outputs/features-quick-picker-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: live actual-score target gap, pending exclusion, editing/deletion/reload/plan switching; inline picker controls, three-column saved/draft teams, hidden avatar names, normal overview/editor retained, desktop/mobile.');
} finally { await browser.close(); }
