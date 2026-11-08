import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const errors = []; page.on('pageerror', error => errors.push(error.message));
const characters = new Map(JSON.parse(await readFile('data/characters.json', 'utf8')).entries.map(character => [character.id, character]));
const draftNames = ['忌炎', '鉴心', '莫特斐'];
const config = () => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1'));
  return library.plans.find(plan => plan.id === library.activePlanId).config;
});
const close = async id => { await page.keyboard.press('Escape'); assert.equal(await page.locator(id).isVisible(), false); };
const draftRoster = () => page.locator('#quick-team-preview .quick-preview-member img').evaluateAll(images => images.map(image => image.alt));

async function checkOverview(container, teams) {
  const cards = page.locator(`${container} .team-overview-card`);
  assert.equal(await cards.count(), teams.length);
  for (let index = 0; index < teams.length; index++) {
    const team = teams[index], card = cards.nth(index);
    assert.ok((await card.innerText()).includes(team.name));
    assert.deepEqual(await card.locator('img').evaluateAll(images => images.map(image => image.alt)), team.characterIds.map(id => characters.get(id).name));
    for (const id of team.characterIds) assert.ok((await card.innerText()).includes(characters.get(id).name));
    if (team.needsScore) assert.match(await card.innerText(), /待填/);
    else assert.ok((await card.innerText()).replaceAll(',', '').includes(String(team.score)));
  }
}

async function checkConfirmationWithinViewport() {
  const button = await page.locator('#confirm-characters').boundingBox();
  const modal = await page.locator('#character-dialog').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(button.x >= modal.x && button.y >= modal.y);
  assert.ok(button.x + button.width <= modal.x + modal.width + 1);
  assert.ok(button.y + button.height <= modal.y + modal.height + 1);
  assert.ok(button.x >= 0 && button.y >= 0 && button.x + button.width <= viewport.width + 1 && button.y + button.height <= viewport.height + 1);
}

async function visibleCharacterCount() {
  return page.locator('#character-grid').evaluate(grid => {
    const bounds = grid.getBoundingClientRect();
    return [...grid.querySelectorAll('.character-choice')].filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    }).length;
  });
}

async function checkAvatarStaminaPlacement() {
  const choice = page.locator('.character-choice:not([disabled])').first();
  const avatar = await choice.locator('.character-avatar').boundingBox();
  const badge = await choice.locator('.availability').boundingBox();
  const name = await choice.locator(':scope > span').first().boundingBox();
  assert.ok(badge.x >= avatar.x && badge.x - avatar.x <= 12, 'remaining-stamina badge should sit at the image left edge');
  assert.ok(badge.y >= avatar.y && badge.y - avatar.y <= 12, 'remaining-stamina badge should sit at the image top edge');
  assert.ok(badge.y + badge.height <= avatar.y + avatar.height);
  assert.ok(name.y >= avatar.y + avatar.height - 1, 'character name should stay below the avatar');
}

async function checkSidebarSectionsDoNotOverlap() {
  const saved = await page.locator('#quick-team-overview-list').boundingBox();
  const lastCard = await page.locator('#quick-team-overview-list .team-overview-card').last().boundingBox();
  const draftHeading = await page.locator('.quick-draft-heading').boundingBox();
  assert.ok(lastCard.y + lastCard.height <= saved.y + saved.height + 1, 'saved-team list must retain enough height for its cards');
  assert.ok(draftHeading.y >= saved.y + saved.height - 1, 'draft heading must sit below saved teams instead of overlapping them');
}

try {
  await mkdir('outputs', { recursive: true });
  await page.goto(baseUrl); await page.locator('.team-bar').first().waitFor();
  const originalPlan = await page.locator('#plan-select').inputValue();
  const initial = await config();
  assert.equal(initial.teams.length, 3);
  await page.locator('#team-overview').click();
  assert.equal(await page.locator('#team-overview-dialog').isVisible(), true);
  await checkOverview('#team-overview-list', initial.teams);
  assert.match(await page.locator('#team-overview-summary').innerText(), /3/);
  await page.locator('#team-overview-dialog').screenshot({ path: 'outputs/team-overview.png' });
  await close('#team-overview-dialog');

  await page.locator('#quick-team').click();
  const dialog = await page.locator('#character-dialog').boundingBox();
  assert.ok(dialog.width >= 1250, `desktop quick picker is still narrow: ${dialog.width}`);
  assert.doesNotMatch(await page.locator('#character-dialog').innerText(), /TEAM SETUP/);
  assert.doesNotMatch(await page.locator('.sidebar').innerText(), /TEAM SETUP/);
  assert.equal(await page.locator('#quick-team-overview').isVisible(), true);
  await checkOverview('#quick-team-overview-list', initial.teams);
  const aside = await page.locator('#quick-team-overview').boundingBox();
  const grid = await page.locator('#character-grid').boundingBox();
  assert.ok(aside.x + aside.width <= grid.x + 1, 'saved teams should sit to the left of the character grid');
  const desktopVisible = await visibleCharacterCount();
  assert.ok(desktopVisible >= 32, `too few full avatars visible in enlarged picker: ${desktopVisible}`);
  const columns = await page.locator('#character-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length);
  assert.ok(columns >= 10, `desktop grid only has ${columns} columns`);
  await checkAvatarStaminaPlacement(); await checkConfirmationWithinViewport();
  await checkSidebarSectionsDoNotOverlap();
  for (const name of draftNames) await page.getByRole('button', { name, exact: true }).click();
  assert.deepEqual(await draftRoster(), draftNames);
  assert.equal(await page.locator('#quick-team-preview .quick-preview-team').count(), 1);
  assert.ok(await page.locator('#quick-team-overview').evaluate(node => node.contains(document.querySelector('#quick-team-preview'))));
  await page.locator('#character-dialog').screenshot({ path: 'outputs/quick-picker-wide.png' });
  await page.locator('#quick-undo').click(); assert.deepEqual(await draftRoster(), draftNames.slice(0, 2));
  await page.locator('#quick-redo').click(); assert.deepEqual(await draftRoster(), draftNames);
  await page.locator('#quick-reset').click(); assert.deepEqual(await draftRoster(), []);
  await page.locator('#quick-undo').click(); assert.deepEqual(await draftRoster(), draftNames);
  await page.locator('#quick-redo').click(); assert.deepEqual(await draftRoster(), []);
  assert.deepEqual((await config()).teams, initial.teams);
  await close('#character-dialog'); assert.deepEqual((await config()).teams, initial.teams);

  // Normal team creation still permits leaving the real score blank.
  await page.locator('#add-team').click();
  assert.equal(await page.locator('#quick-team-overview').isVisible(), false);
  const normalWidth = (await page.locator('#character-dialog').boundingBox()).width;
  assert.ok(normalWidth >= 650 && normalWidth < 1000, `normal editor should remain compact: ${normalWidth}`);
  for (const name of draftNames) await page.getByRole('button', { name, exact: true }).click();
  assert.equal(await page.locator('#dialog-team-score').inputValue(), '');
  await page.locator('#confirm-characters').click();
  const withPending = await config();
  assert.equal(withPending.teams.length, 4); assert.equal(withPending.teams.at(-1).score, 0); assert.equal(withPending.teams.at(-1).needsScore, true);
  assert.equal(await page.locator('.pending-score-bar').count(), 1);
  await page.locator('#team-overview').click();
  await checkOverview('#team-overview-list', withPending.teams); await close('#team-overview-dialog');
  await page.locator('.pending-score-bar').dblclick();
  assert.equal(await page.locator('#quick-team-overview').isVisible(), false);
  await page.getByRole('button', { name: '热熔', exact: true }).click();
  assert.ok(await page.locator('.character-choice').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.dataset.element === '2')));
  await close('#character-dialog'); assert.deepEqual((await config()).teams, withPending.teams);

  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill('队伍一览空方案'); await page.locator('#confirm-plan').click();
  await page.locator('#team-overview').click();
  assert.equal(await page.locator('#team-overview-list .team-overview-card').count(), 0);
  assert.match(await page.locator('#team-overview-summary').innerText(), /0/);
  await close('#team-overview-dialog');
  await page.locator('#plan-select').selectOption(originalPlan);
  await page.locator('#team-overview').click(); await checkOverview('#team-overview-list', withPending.teams); await close('#team-overview-dialog');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#quick-team').click();
  await checkOverview('#quick-team-overview-list', withPending.teams);
  assert.equal(await page.locator('#quick-team-overview').isVisible(), true);
  await checkSidebarSectionsDoNotOverlap();
  await checkConfirmationWithinViewport();
  const mobileColumns = await page.locator('#character-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length);
  assert.ok(mobileColumns >= 4, `mobile grid only has ${mobileColumns} columns`);
  assert.ok(await visibleCharacterCount() >= 4);
  await checkAvatarStaminaPlacement();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('#character-dialog').screenshot({ path: 'outputs/quick-picker-mobile.png' });
  await close('#character-dialog');
  await page.locator('#team-overview').click(); await checkOverview('#team-overview-list', withPending.teams);
  const overviewMobile = await page.locator('#team-overview-dialog').boundingBox();
  assert.ok(overviewMobile.x >= 0 && overviewMobile.x + overviewMobile.width <= 391);
  assert.ok(overviewMobile.y >= 0 && overviewMobile.y + overviewMobile.height <= 845);
  await page.locator('#team-overview-dialog').screenshot({ path: 'outputs/team-overview-mobile.png' });
  await close('#team-overview-dialog');
  assert.deepEqual(errors, []);
  console.log(`PASS: wide picker ${desktopVisible} full avatars/${columns} columns; top-left stamina; saved/draft team overview; undo/redo/reset; blank-score creation; filters; plan isolation; desktop/mobile layout.`);
} finally { await browser.close(); }
