import registryJson from './config/seasons.json' with { type: 'json' };

const clone = value => structuredClone(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(`赛季配置无效：${message}`); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = value => Number.isInteger(value) && value > 0;
const configPath = /^config\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const assetPath = /^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:webp|png|jpe?g|svg)$/i;

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validateSeason(season, registryId) {
  requireValue(season && typeof season === 'object' && !Array.isArray(season), `${registryId} 不是对象`);
  requireValue(season.schemaVersion === 1 && season.id === registryId, `${registryId} 的 schemaVersion 或 id 不匹配`);
  requireValue(nonempty(season.name) && nonempty(season.modeName) && /^S\d+$/.test(season.season) && positiveInteger(season.stage), `${registryId} 的名称或阶段无效`);
  requireValue(positiveInteger(season.towerId) && positiveInteger(season.maxRound), `${registryId} 的关卡或轮次无效`);
  requireValue(nonempty(season.source) && season.source.startsWith('https://'), `${registryId} 缺少 HTTPS 来源`);
  requireValue(Array.isArray(season.bosses) && season.bosses.length > 0, `${registryId} 缺少 Boss`);
  const bossIds = new Set();
  season.bosses.forEach((boss, index) => {
    requireValue(boss.order === index + 1 && nonempty(boss.id) && !bossIds.has(boss.id), `${registryId} 的 Boss 顺序或 id 无效`);
    requireValue(nonempty(boss.name) && nonempty(boss.alias) && assetPath.test(boss.icon_file), `${registryId} 的 Boss 名称或头像路径无效`);
    if (boss.specialProperties !== undefined) {
      requireValue(Array.isArray(boss.specialProperties) && boss.specialProperties.every(nonempty), `${registryId} 的 Boss 特殊性质必须是非空说明文字的数组`);
    }
    if (boss.resistances !== undefined) {
      const resistance = boss.resistances;
      requireValue(resistance && ['confirmed', 'unconfirmed'].includes(resistance.status) && resistance.values && typeof resistance.values === 'object', `${registryId} 的抗性配置无效`);
      for (let id = 1; id <= 6; id++) {
        const value = resistance.values[id];
        requireValue(Number.isFinite(value) || (resistance.status === 'unconfirmed' && value === null), `${registryId} 的属性 ${id} 抗性必须填写百分比或待确认的 null`);
      }
      requireValue(resistance.highElement === null || (Number.isInteger(resistance.highElement) && resistance.highElement >= 1 && resistance.highElement <= 6), `${registryId} 的高抗属性无效`);
      requireValue(nonempty(resistance.source) && resistance.source.startsWith('https://') && typeof resistance.note === 'string', `${registryId} 的抗性来源或说明无效`);
    }
    bossIds.add(boss.id);
  });
  const stamina = season.stamina;
  requireValue(stamina && positiveInteger(stamina.defaultStamina), `${registryId} 的默认体力无效`);
  requireValue(stamina.baseStamina && typeof stamina.baseStamina === 'object' && !Array.isArray(stamina.baseStamina), `${registryId} 缺少基础体力表`);
  for (const [id, amount] of Object.entries(stamina.baseStamina)) requireValue(nonempty(id) && positiveInteger(amount), `${registryId} 的基础体力值无效`);
  requireValue(Array.isArray(stamina.bonusCharacterIds) && stamina.bonusCharacterIds.every(nonempty) && new Set(stamina.bonusCharacterIds).size === stamina.bonusCharacterIds.length, `${registryId} 的额外体力角色无效`);
  requireValue(Number.isInteger(stamina.extraStamina) && stamina.extraStamina >= 0, `${registryId} 的额外体力无效`);
  requireValue(Array.isArray(season.circuits) && Array.isArray(season.characters), `${registryId} 缺少回路或角色强化`);
  for (const circuit of season.circuits) requireValue(nonempty(circuit.id) && nonempty(circuit.name) && nonempty(circuit.description) && assetPath.test(circuit.icon_file), `${registryId} 的回路数据或图标路径无效`);
  for (const character of season.characters) {
    requireValue(nonempty(character.id) && nonempty(character.name) && assetPath.test(character.icon_file) && Array.isArray(character.enhancements), `${registryId} 的角色强化无效`);
    for (const enhancement of character.enhancements) requireValue(nonempty(enhancement.description), `${registryId} 的角色强化说明为空`);
  }
  const scoring = season.scoring;
  requireValue(scoring && ['source-and-inferred', 'provisional'].includes(scoring.status) && nonempty(scoring.basis) && nonempty(scoring.basedOnSeason), `${registryId} 的计分来源无效`);
  if (scoring.rounding !== undefined) requireValue(scoring.rounding === 'floor-per-boss', `${registryId} 的计分取整规则无效`);
  requireValue(Array.isArray(scoring.waves) && scoring.waves.length === season.maxRound * season.bosses.length, `${registryId} 的波次数与轮次不一致`);
  scoring.waves.forEach((wave, index) => {
    const round = Math.floor(index / season.bosses.length) + 1;
    const position = index % season.bosses.length + 1;
    requireValue(wave.round === round && wave.position === position, `${registryId} 的波次必须按轮次及位次连续排列`);
    requireValue(Number.isFinite(wave.fullPoints) && Number.isFinite(wave.killBonus) && wave.killBonus >= 0 && wave.fullPoints > wave.killBonus, `${registryId} 的积分必须大于击杀奖励`);
    requireValue(typeof wave.inferred === 'boolean', `${registryId} 的推算标记无效`);
    requireValue(wave.sourceCell === null || nonempty(wave.sourceCell), `${registryId} 的原表单元格无效`);
    requireValue(wave.formula === null || nonempty(wave.formula), `${registryId} 的公式无效`);
    if (wave.pointsPerDamage !== undefined) requireValue(Number.isFinite(wave.pointsPerDamage) && wave.pointsPerDamage > 0, `${registryId} 的伤害计分系数必须为正数`);
    if (wave.maxHp !== undefined || wave.hpStatus !== undefined) {
      requireValue(['source', 'inferred', 'provisional', 'unconfirmed'].includes(wave.hpStatus), `${registryId} 的总血量状态无效`);
      requireValue(wave.hpStatus === 'unconfirmed' ? wave.maxHp === null : Number.isFinite(wave.maxHp) && wave.maxHp > 0, `${registryId} 的总血量必须为正数，待确认时填 null`);
    }
  });
  return season;
}

const registry = clone(registryJson);
requireValue(registry.version === 1 && Array.isArray(registry.seasons) && registry.seasons.length > 0, '赛季目录无效');
const ids = new Set();
for (const entry of registry.seasons) {
  requireValue(nonempty(entry.id) && !ids.has(entry.id) && configPath.test(entry.file), '赛季目录 id 或配置路径无效');
  ids.add(entry.id);
}
requireValue(ids.has(registry.defaultSeason), '默认赛季不在目录中');
const loaded = await Promise.all(registry.seasons.map(async entry => {
  const result = await import(new URL(entry.file, import.meta.url).href, { with: { type: 'json' } });
  return validateSeason(clone(result.default), entry.id);
}));
const towerIds = new Set();
for (const season of loaded) {
  requireValue(!towerIds.has(season.towerId), '不同赛季不能复用关卡 id');
  towerIds.add(season.towerId);
  requireValue(ids.has(season.scoring.basedOnSeason), `${season.id} 的参考赛季不存在`);
}

export const seasonDefinitions = freeze(loaded);
const byId = new Map(seasonDefinitions.map(season => [season.id, season]));
const byTower = new Map(seasonDefinitions.map(season => [season.towerId, season]));

export function getSeason(configOrId = registry.defaultSeason) {
  if (typeof configOrId === 'string') {
    const season = byId.get(configOrId);
    if (!season) throw new Error('找不到指定矩阵期数');
    return season;
  }
  if (!configOrId || typeof configOrId !== 'object') throw new Error('矩阵期数配置无效');
  const season = configOrId.matrixSeason ? byId.get(configOrId.matrixSeason) : byTower.get(configOrId.towerId);
  if (!season || (configOrId.towerId !== undefined && season.towerId !== configOrId.towerId)) throw new Error('矩阵期数与关卡不匹配');
  return season;
}

export function seasonStaminaRules() {
  const standard = getSeason(registry.defaultSeason);
  return {
    version: 1,
    defaultSeason: registry.defaultSeason,
    defaultStamina: standard.stamina.defaultStamina,
    baseStamina: clone(standard.stamina.baseStamina),
    seasons: seasonDefinitions.map(season => ({
      id: season.id, name: season.name, towerId: season.towerId,
      defaultStamina: season.stamina.defaultStamina,
      baseStamina: clone(season.stamina.baseStamina),
      bonusCharacterIds: [...season.stamina.bonusCharacterIds],
      extraStamina: season.stamina.extraStamina,
    })),
  };
}

export function buildSeasonScores(seasonOrId = registry.defaultSeason) {
  const season = getSeason(typeof seasonOrId === 'object' && seasonOrId?.id ? seasonOrId.id : seasonOrId);
  let cumulative = 0;
  const records = season.scoring.waves.map((wave, index) => {
    const boss = season.bosses[wave.position - 1];
    const before = cumulative;
    cumulative += wave.fullPoints;
    return {
      wave_index: index + 1, round: wave.round, boss_position: wave.position,
      name: boss.name, alias: boss.alias, icon_file: boss.icon_file,
      damage_points_at_full_hp: wave.fullPoints - wave.killBonus,
      full_kill_points: wave.fullPoints, kill_bonus: wave.killBonus,
      max_hp: wave.maxHp ?? null, hp_status: wave.hpStatus ?? 'unconfirmed',
      ...(wave.pointsPerDamage !== undefined ? { points_per_damage: wave.pointsPerDamage } : {}),
      source_label: season.scoring.sourceLabel || '原表',
      ...(season.scoring.rounding ? { score_rounding: season.scoring.rounding } : {}),
      cumulative_points_before: before, cumulative_points_after: cumulative,
      estimated: wave.inferred,
      provisional: season.scoring.status === 'provisional',
      source_cell: wave.sourceCell,
      source_formula: wave.sourceCell ? wave.formula : null,
      projection_formula: wave.inferred ? wave.formula : null,
      score_reference_season: season.scoring.basedOnSeason,
      basis: season.scoring.basis,
    };
  });
  return {
    records, record_count: records.length, max_round: season.maxRound,
    matrixSeason: season.id, matrixVersion: season.name,
    scoring_status: season.scoring.status, basis: season.scoring.basis,
  };
}
