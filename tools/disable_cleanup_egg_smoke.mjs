import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const library = () => page.evaluate(() => JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1')));
const egg = '这个目标分数你确定？哪怕开隧者进矩阵都拿不到！';
try {
  await mkdir('outputs', { recursive: true }); await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('.team-bar').first().waitFor();
  await page.locator('#target-score').fill('3w'); await page.locator('#locate-score').click();
  const before = await library();
  await page.locator('#target-score').fill('1e10'); assert.notEqual(await page.locator('#target-score-gap').getAttribute('data-status'), 'easter-egg');
  await page.locator('#target-score').fill('10000000001'); assert.equal(await page.locator('#target-score-gap').innerText(), egg);
  assert.equal(await page.locator('#target-score-gap').evaluate(node => getComputedStyle(node).color), 'rgb(255, 121, 121)');
  await page.locator('#locate-score').click(); assert.deepEqual(await library(), before);
  await page.locator('#score-locator').screenshot({ path: 'outputs/target-score-easter-egg.png' });
  await page.locator('#team-score').fill('1e11'); await page.locator('#apply-team').click(); assert.deepEqual(await library(), before);
  await page.locator('.character-slot').first().click(); await page.locator('#dialog-team-score').fill('1e11'); await page.locator('#confirm-characters').click();
  assert.equal(await page.locator('#character-dialog').isVisible(), true); assert.deepEqual(await library(), before); await page.keyboard.press('Escape');
  await page.locator('#target-score').fill('3w'); assert.equal(await page.locator('#target-score-gap').getAttribute('data-status'), 'shortfall');
  await page.locator('#target-score').fill(''); assert.equal(await page.locator('#target-score-gap').isVisible(), false);
  await page.locator('#manage-disabled-characters').click(); await page.getByRole('button', { name: '禁用今汐', exact: true }).click();
  assert.match(await page.locator('#disabled-removal-preview').innerText(), /当前方案中的 1 支队伍/);
  await page.keyboard.press('Escape'); assert.deepEqual(await library(), before);
  await page.locator('#manage-disabled-characters').click(); await page.getByRole('button', { name: '禁用今汐', exact: true }).click();
  // Failing the final preference write must roll back both saved plan representations.
  await page.evaluate(() => { window.storageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if(key==='wuwa-matrix-demo-v1') throw new Error('test write failure'); return window.storageSet.call(this,key,value); }; });
  await page.locator('#save-disabled-characters').click(); assert.deepEqual(await library(), before);
  assert.equal(await page.locator('#disabled-characters-dialog').isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem=window.storageSet; });
  await page.locator('#save-disabled-characters').click();
  const after = await library();
  assert.equal(after.plans.length, before.plans.length);
  for (const plan of after.plans) {
    const old = before.plans.find(item => item.id===plan.id);
    const expected = plan.id === before.activePlanId ? old.config.teams.filter(team=>!team.characterIds.includes('1304')) : old.config.teams;
    assert.deepEqual(plan.config.teams.map(team=>team.id),expected.map(team=>team.id));
    let cursor=0;
    for (let i=0;i<expected.length;i++) { assert.deepEqual(plan.config.teams[i],{...expected[i],startScore:cursor}); cursor+=expected[i].score; }
  }
  assert.match(await page.locator('#disabled-removal-notice').innerText(), /删除 1 支/);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1-before-character-disable'))), before);
  await page.reload(); await page.locator('.team-card').first().waitFor(); assert.deepEqual(await library(), after);
  await page.locator('#manage-disabled-characters').click(); await page.locator('#enable-all-characters').click(); await page.locator('#save-disabled-characters').click();
  assert.deepEqual((await library()).plans.map(plan=>plan.config.teams), after.plans.map(plan=>plan.config.teams), 'enabling roles must not resurrect deleted teams');
  await page.setViewportSize({width:390,height:844}); await page.locator('#target-score').fill('1.1e10');
  assert.equal(await page.locator('#target-score-gap').innerText(),egg);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  console.log('PASS: strict 10-billion live Easter egg without submit changes; current-plan deletion, cancel/rollback safety, backup, persistence, survivor scores and mobile.');
} finally { await browser.close(); }
