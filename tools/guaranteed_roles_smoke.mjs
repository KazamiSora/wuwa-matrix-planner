import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const library = () => page.evaluate(() => JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1')));
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('guaranteed-roles-fixture')) {
      localStorage.setItem('wuwa-matrix-disabled-characters-v1', JSON.stringify(['1309','1310','1406','1408','1501','1502','1604','1605','1103','1202','1402','1610']));
      localStorage.setItem('guaranteed-roles-fixture', '1');
    }
  });
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('.team-card').first().waitFor();
  const before = await library();
  assert.equal(await page.locator('#target-score').getAttribute('placeholder'), null);
  assert.equal(await page.locator('#target-score').getAttribute('title'), '支持1k/1w/1.1m等缩写，以及科学计数法1e2');
  await page.locator('#manage-disabled-characters').click();
  for (const name of ['漂泊者·导电','漂泊者·气动','漂泊者·衍射','漂泊者·湮灭','炽霞','秧秧','白芷']) {
    assert.equal(await page.getByRole('button', { name: `禁用${name}`, exact: true }).count(), 0, name);
  }
  const xuanling = page.getByRole('button', { name: '禁用秧秧·玄翎', exact: true });
  assert.equal(await xuanling.getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#disabled-character-count').innerText(), /已禁用 1 \/ 54/);
  assert.equal(await page.locator('#disabled-removal-preview').innerText(), '');
  await page.locator('#save-disabled-characters').click();
  assert.deepEqual(await library(), before, 'protected legacy preferences must not delete teams');
  assert.deepEqual((await library()).plans.find(plan=>plan.id===(before.activePlanId)).config.disabledCharacterIds, ['1610']);
  await page.reload(); await page.locator('#quick-team').click();
  for (const [query, expected] of [['pbz',4],['chixia',1],['yangyang',1],['baizhi',1],['yyxl',0]]) {
    await page.locator('#character-search').fill(query);
    assert.equal(await page.locator('.character-choice').count(), expected, query);
  }
  await page.keyboard.press('Escape');
  await page.locator('#manage-disabled-characters').click(); await xuanling.click(); await page.locator('#save-disabled-characters').click();
  await page.locator('#quick-team').click(); await page.locator('#character-search').fill('yangyang');
  assert.equal(await page.locator('.character-choice').count(), 2);
  assert.deepEqual(errors, []);
  console.log('PASS: guaranteed roles excluded, legacy disabled IDs ignored without team loss, Xuanling still configurable, and exact hover hint without placeholder.');
} finally { await browser.close(); }
