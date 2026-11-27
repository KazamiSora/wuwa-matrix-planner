import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwright = process.env.MATRIX_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwright));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const url = new URL('/replay.html', process.env.MATRIX_URL || 'http://127.0.0.1:4173').href;
const key = 'afyg-project-library-v1';
const sample = JSON.parse(await readFile(new URL('../afyg-replay/site/sample.json', import.meta.url)));
const old = structuredClone(sample);
(old.project ?? old).id = '03e22bfc-fb56-4088-b1f3-f01691c01ccb';
const mine = { id: 'my-project', raw: sample };
const saved = JSON.stringify({ activeId: mine.id, items: [{ id: 'sample', raw: old }, mine] });

try {
  const page = await browser.newPage();
  await page.addInitScript(({ key, saved }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, saved);
  }, { key, saved });
  // The migration request fails once. A later request for the default sample would succeed.
  await page.route('**/sample.json', route => route.fulfill({ status: 503 }), { times: 1 });
  await page.goto(url);
  await page.waitForFunction(key => document.querySelector('#library-status').textContent ||
    JSON.parse(localStorage.getItem(key)).items.length !== 2, key);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items.length, key), 2,
    'migration failure discarded the saved project');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), saved);
  assert.ok(await page.locator('#sample').isDisabled());
  assert.ok(await page.locator('#file').isDisabled());

  await page.getByRole('button', { name: '重新读取工程库' }).click();
  await page.locator('.team-entry[aria-pressed="true"]').waitFor();
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(restored.activeId, mine.id);
  assert.deepEqual(restored.items.find(item => item.id === mine.id).raw, mine.raw);
  assert.deepEqual(restored.items.find(item => item.id === 'sample').raw, sample);

  for (const invalid of ['{', '', JSON.stringify({ items: [mine, {}] })]) {
    await page.evaluate(({ key, invalid }) => localStorage.setItem(key, invalid), { key, invalid });
    await page.reload();
    await page.getByRole('button', { name: '重新读取工程库' }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), invalid);
  }
  const fresh = await browser.newPage();
  await fresh.goto(url);
  await fresh.locator('.team-entry[aria-pressed="true"]').waitFor();
  assert.deepEqual(await fresh.evaluate(key => JSON.parse(localStorage.getItem(key)).items.map(item => item.id), key), ['sample']);
  const empty = JSON.stringify({items: [], activeId: null, lastDeletion: {item: mine, index: 0}});
  await fresh.evaluate(({key, empty}) => localStorage.setItem(key, empty), {key, empty});
  await fresh.reload();
  await fresh.locator('#undo-project:enabled').waitFor();
  assert.equal(await fresh.locator('.team-entry').count(), 0);
  assert.equal(await fresh.evaluate(key => localStorage.getItem(key), key), empty);
  console.log('PASS failed migration, retry, unreadable libraries, first launch and intentionally empty libraries');
} finally {
  await browser.close();
}
