import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const phase3 = JSON.parse(await readFile('config/seasons/s2-3.json', 'utf8'));
const phase4 = JSON.parse(await readFile('config/seasons/s2-4.json', 'utf8'));
const errors = []; page.on('pageerror', error => errors.push(error.message));
const cardNames = () => page.locator('#boss-properties-list h4').allTextContents();
const numeric = async id => Number((await page.locator(`#${id}`).innerText()).replace(/[^\d.-]/g, ''));

async function inspectBoss(season, index) {
  const boss = season.bosses[index];
  const wave = season.scoring.waves[index];
  await page.locator('.boss-segment').nth(index).click();
  assert.equal(await page.locator('#boss-dialog-title').innerText(), `R1 ${boss.name}`);
  assert.deepEqual(await page.locator('#boss-special-properties-copy p').allTextContents(), boss.specialProperties);
  assert.deepEqual(await page.locator('#boss-resistances strong').allTextContents(), Array.from({ length: 6 }, (_, i) => `${boss.resistances.values[i + 1]}%`));
  assert.ok(Math.abs(await numeric('boss-total-hp') - wave.maxHp) < .051);
  assert.ok(Math.abs(await numeric('boss-total-points') - wave.fullPoints) < .051);
  await page.locator('#boss-hp-percent').fill('50');
  assert.ok(Math.abs(await numeric('boss-earned-points') - (wave.fullPoints - wave.killBonus) / 2) < .051);
  assert.ok(Math.abs(await numeric('boss-remaining-points') - ((wave.fullPoints - wave.killBonus) / 2 + wave.killBonus)) < .051);
}

try {
  await mkdir('outputs', { recursive: true });
  await page.goto(baseUrl);
  await page.locator('.boss-property-card').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#boss-properties-details').evaluate(node => node.open), false);
  assert.equal(await page.locator('#boss-properties-details + h3').innerText(), '角色强化');
  assert.equal(await page.locator('#boss-properties-list').isVisible(), false);
  await page.locator('#boss-properties-details > summary').click();
  assert.deepEqual(await cardNames(), ['封庭械囿', '无冠者', '天傀劫煞', '飞廉之猩', '达妮娅', '辛吉勒姆']);
  assert.equal(await page.locator('#boss-properties-list .boss-properties-copy p').filter({ hasText: /^暂无特殊性质说明。$/ }).count(), 0);
  assert.equal((await cardNames()).filter(name => name === '无冠者').length, 1);
  await page.locator('#boss-properties-search').fill('盾山');
  assert.deepEqual(await cardNames(), ['封庭械囿']);
  await page.locator('#boss-properties-search').fill('迷航');
  assert.deepEqual(await cardNames(), ['辛吉勒姆']);
  assert.equal(await page.locator('#boss-properties-results').innerText(), '1 / 6 只 Boss');
  await page.locator('#boss-properties-search').fill('不存在的Boss');
  assert.equal(await page.locator('.boss-property-card').count(), 0);
  assert.match(await page.locator('.boss-property-empty').innerText(), /没有找到匹配/);
  await page.locator('#boss-properties-search').fill('S2-4');
  assert.deepEqual(await cardNames(), ['无冠者', '飞廉之猩', '达妮娅', '辛吉勒姆']);
  await page.locator('#boss-properties-search').fill('');
  assert.equal(await page.locator('.boss-property-card').count(), 6);
  await page.locator('#boss-properties-details').screenshot({ path: 'outputs/boss-properties-list.png' });

  for (const index of [1, 2, 3]) {
    await inspectBoss(phase3, index);
    await page.keyboard.press('Escape');
  }
  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill('特殊性质S2-4');
  await page.locator('#plan-season').selectOption('s2-phase4'); await page.locator('#confirm-plan').click();
  for (const index of [0, 1, 3]) {
    await inspectBoss(phase4, index);
    if (index === 3) await page.locator('#boss-dialog').screenshot({ path: 'outputs/boss-properties-modal.png' });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (!await page.locator('#boss-properties-details').evaluate(node => node.open)) await page.locator('#boss-properties-details > summary').click();
  await page.locator('#boss-properties-search').fill('迷航');
  await page.locator('#boss-properties-details').screenshot({ path: 'outputs/boss-properties-list-mobile.png' });
  await inspectBoss(phase4, 3);
  assert.ok(await page.locator('#boss-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  assert.ok(await page.locator('#boss-dialog').evaluate(node => node.scrollHeight > node.clientHeight));
  await page.locator('#boss-hp-percent').fill('0');
  assert.equal(await numeric('boss-remaining-points'), 0);
  const input = await page.locator('#boss-hp-percent').boundingBox();
  assert.ok(input.y >= 0 && input.y + input.height <= 844);
  await page.locator('#boss-dialog').evaluate(node => { node.scrollTop = 0; });
  await page.locator('#boss-dialog').screenshot({ path: 'outputs/boss-properties-modal-mobile.png' });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#boss-dialog').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: six Bosses with special properties; collapsed placement; name/alias/effect/season search; empty and reset; exact corresponding modal text; HP/resistance/score unchanged; mobile list and scrollable long modal.');
} finally { await browser.close(); }
