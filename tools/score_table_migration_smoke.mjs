import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const example = JSON.parse(await readFile('config/demo.json', 'utf8'));
const phase4 = JSON.parse(await readFile('config/seasons/s2-4.json', 'utf8'));
const storageKey = 'wuwa-matrix-plan-library-v1';
const clone = value => structuredClone(value);
function nextSeason() {
  return { ...clone(example), matrixSeason: phase4.id, matrixVersion: phase4.name, towerId: phase4.towerId, staminaSeason: phase4.id, maxRound: 15, scoreMarker: null };
}
function libraryWith(config) {
  return { version: 1, activePlanId: 'migration-next', plans: [
    { id: 'migration-next', name: '下期旧排布', config: clone(config) },
    { id: 'migration-current', name: '本期保留', config: clone(example) },
  ] };
}
async function openFixture(library, mirror) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const rawLibrary = JSON.stringify(library);
  await page.addInitScript(({ key, rawLibrary, mirror }) => {
    localStorage.setItem(key, rawLibrary);
    localStorage.setItem('wuwa-matrix-demo-v1', JSON.stringify(mirror));
  }, { key: storageKey, rawLibrary, mirror });
  await page.goto(baseUrl); await page.locator('.team-bar').first().waitFor();
  return { context, page, errors, rawLibrary };
}
const storedLibrary = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
// Old plans gain an empty per-plan disable list; their existing fields stay intact.
const withDisabledDefaults = plan => ({ ...clone(plan), config: { ...clone(plan.config), disabledCharacterIds: [] } });
try {
  const oldMarker = nextSeason(); oldMarker.scoreMarker = 3319871.4097265;
  const markerLibrary = libraryWith(oldMarker);
  {
    const { context, page, errors, rawLibrary } = await openFixture(markerLibrary, oldMarker);
    try {
      const saved = await storedLibrary(page);
      assert.equal(saved.plans.length, 2);
      assert.equal(saved.activePlanId, markerLibrary.activePlanId);
      assert.equal(saved.plans[0].config.scoreMarker, null);
      assert.deepEqual(saved.plans[0].config.teams, oldMarker.teams);
      assert.deepEqual(saved.plans[1], withDisabledDefaults(markerLibrary.plans[1]));
      assert.equal(await page.evaluate(key => localStorage.getItem(`${key}-restore-backup`), storageKey), rawLibrary);
      assert.equal(await page.locator('#restore-warning').isVisible(), false);
      assert.match(await page.locator('#toast').textContent(), /已移除.*旧目标标记/);
      assert.equal(await page.locator('#plan-select option').count(), 2);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  const oldRoundOne = nextSeason(); oldRoundOne.maxRound = 1;
  oldRoundOne.teams[2].score = 7890;
  {
    const library = libraryWith(oldRoundOne);
    const { context, page, errors, rawLibrary } = await openFixture(library, oldRoundOne);
    try {
      const saved = await storedLibrary(page);
      assert.equal(saved.plans.length, 2);
      assert.equal(saved.plans[0].config.maxRound, 2);
      assert.deepEqual(saved.plans[0].config.teams, oldRoundOne.teams);
      assert.deepEqual(saved.plans[1], withDisabledDefaults(library.plans[1]));
      assert.equal(await page.locator('#max-round').inputValue(), '2');
      assert.equal(await page.evaluate(key => localStorage.getItem(`${key}-restore-backup`), storageKey), rawLibrary);
      assert.equal(await page.locator('#restore-warning').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  const outOfRange = nextSeason();
  outOfRange.teams = [{ ...outOfRange.teams[0], score: 3319840, startScore: 0 }];
  {
    const { context, page, errors, rawLibrary } = await openFixture(libraryWith(outOfRange), example);
    try {
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), rawLibrary);
      assert.equal(await page.evaluate(key => localStorage.getItem(`${key}-failed-restore-backup`), storageKey), rawLibrary);
      assert.equal(await page.locator('#restore-warning').isVisible(), true);
      assert.match(await page.locator('#restore-warning').textContent(), /原始数据已保留/);
      assert.equal(await page.locator('#download-restore-backup').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log('PASS: score-table migration preserves both plans, clears only obsolete markers with exact raw backup, expands round coverage without score edits, and preserves over-limit original data for recovery.');
} finally { await browser.close(); }
