const leagueDataPromiseCache = new Map();

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeUrl(urlObject, prefix) {
  const suffix = typeof urlObject?.suffix === "string" && urlObject.suffix.trim() !== ""
    ? urlObject.suffix.trim()
    : null;

  if (!suffix) {
    return null;
  }

  try {
    return {
      suffix,
      href: new URL(suffix, prefix).href,
    };
  } catch {
    return {
      suffix,
      href: null,
    };
  }
}

function normalizeNamedEntry(entry, prefix) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const diary = sanitizeString(entry.diary).trim();
  const name = sanitizeString(entry.name, diary).trim();
  if (name === "") {
    return null;
  }

  return {
    name,
    url: normalizeUrl(entry.url, prefix),
    note: typeof entry.note === "string" ? entry.note : null,
    diary: diary || null,
    includesPrerequisites: Boolean(entry.includesPrerequisites),
    tasks: sanitizeStringArray(entry.tasks),
    regionRequirements: sanitizeStringArray(entry.regionRequirements),
  };
}

function normalizeNamedEntryArray(entries, prefix) {
  return Array.isArray(entries)
    ? entries.map((entry) => normalizeNamedEntry(entry, prefix)).filter(Boolean)
    : [];
}

function normalizeDrop(entry, prefix) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const itemNames = sanitizeStringArray(entry.itemNames);
  const sourceNames = sanitizeStringArray(entry.sourceNames);
  if (itemNames.length === 0 && sourceNames.length === 0) {
    return null;
  }

  const itemUrlSuffixes = Array.isArray(entry.itemUrlSuffixes) ? entry.itemUrlSuffixes : [];
  const sourceUrlSuffixes = Array.isArray(entry.sourceUrlSuffixes) ? entry.sourceUrlSuffixes : [];

  return {
    itemNames,
    itemUrls: itemUrlSuffixes.map((suffix) => normalizeUrl({ suffix }, prefix)),
    sourceNames,
    sourceUrls: sourceUrlSuffixes.map((suffix) => normalizeUrl({ suffix }, prefix)),
    note: typeof entry.note === "string" ? entry.note : null,
    regionRequirements: sanitizeStringArray(entry.regionRequirements),
  };
}

function normalizeDropArray(entries, prefix) {
  return Array.isArray(entries)
    ? entries.map((entry) => normalizeDrop(entry, prefix)).filter(Boolean)
    : [];
}

function normalizeEchoBoss(echoBoss, prefix) {
  if (!echoBoss || typeof echoBoss !== "object") {
    return null;
  }

  const name = sanitizeString(echoBoss.name).trim();
  if (name === "") {
    return null;
  }

  return {
    name,
    url: normalizeUrl(echoBoss.url, prefix),
    baseBoss: echoBoss.baseBoss
      ? {
        name: sanitizeString(echoBoss.baseBoss.name),
        url: normalizeUrl(echoBoss.baseBoss.url, prefix),
      }
      : null,
    regionRequirement: typeof echoBoss.regionRequirement === "string" ? echoBoss.regionRequirement : null,
    additionalRequirement: typeof echoBoss.additionalRequirement === "string"
      ? echoBoss.additionalRequirement
      : (typeof echoBoss.accessRule === "string" ? echoBoss.accessRule : null),
    echoEquipmentSummary: sanitizeStringArray(echoBoss.echoEquipmentSummary),
    regionRequirements: sanitizeStringArray(echoBoss.regionRequirements),
  };
}

function normalizeAutoUnlocks(autoUnlocks, prefix) {
  if (!autoUnlocks || typeof autoUnlocks !== "object") {
    return {
      quests: [],
      achievementDiaryTasks: [],
      combatAchievements: [],
      slayerContent: [],
      items: [],
      mechanics: [],
    };
  }

  return {
    quests: normalizeNamedEntryArray(autoUnlocks.quests, prefix),
    achievementDiaryTasks: normalizeNamedEntryArray(autoUnlocks.achievementDiaryTasks, prefix),
    combatAchievements: normalizeNamedEntryArray(autoUnlocks.combatAchievements, prefix),
    slayerContent: sanitizeStringArray(autoUnlocks.slayerContent),
    items: normalizeNamedEntryArray(autoUnlocks.items, prefix),
    mechanics: sanitizeStringArray(autoUnlocks.mechanics),
  };
}

function normalizeRegion(region, prefix) {
  if (!region || typeof region !== "object") {
    return null;
  }

  const id = sanitizeString(region.id).trim();
  if (id === "") {
    return null;
  }

  return {
    id,
    name: sanitizeString(region.name, id),
    url: normalizeUrl(region.url, prefix),
    unlockMode: sanitizeString(region.unlockMode),
    regionRequirements: sanitizeStringArray(region.regionRequirements),
    notableSettlements: sanitizeStringArray(region.notableSettlements),
    notableCombatActivities: sanitizeStringArray(region.notableCombatActivities),
    notableNonCombatActivities: sanitizeStringArray(region.notableNonCombatActivities),
    notableShopsServices: sanitizeStringArray(region.notableShopsServices),
    autoUnlocks: normalizeAutoUnlocks(region.autoUnlocks, prefix),
    echoBoss: normalizeEchoBoss(region.echoBoss, prefix),
    notableDrops: normalizeDropArray(region.notableDrops, prefix),
    dataGaps: sanitizeStringArray(region.dataGaps),
    sourcePages: normalizeNamedEntryArray(region.sourcePages, prefix),
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const id = sanitizeString(rule.id).trim();
  const description = sanitizeString(rule.description).trim();
  if (id === "" || description === "") {
    return null;
  }

  return {
    id,
    description,
    relatedRegionIds: sanitizeStringArray(rule.relatedRegionIds),
  };
}

function normalizeRegionModel(rawRegionModel) {
  const model = rawRegionModel && typeof rawRegionModel === "object" ? rawRegionModel : {};

  return {
    startingRegions: normalizeNamedEntryArray(model.startingRegions),
    forcedFirstUnlock: normalizeNamedEntryArray(model.forcedFirstUnlock),
    selectableAdditionalRegions: normalizeNamedEntryArray(model.selectableAdditionalRegions),
    maxSelectableAdditionalRegions: Number.isFinite(model.maxSelectableAdditionalRegions)
      ? model.maxSelectableAdditionalRegions
      : 0,
    misthalinAccessible: Boolean(model.misthalinAccessible),
  };
}

function normalizeGlobalAutoUnlocks(globalAutoUnlocks, prefix) {
  const value = globalAutoUnlocks && typeof globalAutoUnlocks === "object" ? globalAutoUnlocks : {};

  return {
    quests: normalizeNamedEntryArray(value.quests, prefix),
    starterItems: normalizeNamedEntryArray(value.starterItems, prefix),
  };
}

function normalizeMeta(meta, prefix) {
  const value = meta && typeof meta === "object" ? meta : {};

  return {
    league: sanitizeString(value.league),
    leagueId: sanitizeString(value.leagueId),
    purpose: sanitizeString(value.purpose),
    leagueUrl: normalizeUrl(value.leagueUrl, prefix),
    notes: sanitizeStringArray(value.notes),
    sourcePages: Array.isArray(value.sourcePages)
      ? value.sourcePages.map((entry) => normalizeUrl(entry, prefix)).filter(Boolean)
      : [],
  };
}

function normalizeLeagueData(raw, leagueConfig) {
  const urlPrefix = sanitizeString(raw?.URL?.prefix, "https://oldschool.runescape.wiki");
  const regions = Array.isArray(raw?.regions)
    ? raw.regions.map((region) => normalizeRegion(region, urlPrefix)).filter(Boolean)
    : [];

  return {
    leagueId: leagueConfig.id,
    meta: normalizeMeta(raw?.meta, urlPrefix),
    globalRules: Array.isArray(raw?.globalAvailabilityRules)
      ? raw.globalAvailabilityRules.map((rule) => normalizeRule(rule)).filter(Boolean)
      : [],
    globalAutoUnlocks: normalizeGlobalAutoUnlocks(raw?.globalAutoUnlocks, urlPrefix),
    regionModel: normalizeRegionModel(raw?.regionUnlockModel),
    regionsById: new Map(regions.map((region) => [region.id, region])),
  };
}

async function fetchLeagueData(leagueConfig) {
  const response = await fetch(leagueConfig.data.relationshipJsonSrc);
  if (!response.ok) {
    throw new Error(`Unable to load league data (${response.status}).`);
  }

  const raw = await response.json();
  return normalizeLeagueData(raw, leagueConfig);
}

function getRegionStatus(regionId, leagueConfig) {
  if (leagueConfig.rules.startingRegionIds.includes(regionId)) {
    return "starting";
  }

  if (leagueConfig.rules.forcedRegionIds.includes(regionId)) {
    return "forced";
  }

  if (leagueConfig.rules.selectableRegionIds.includes(regionId)) {
    return "selectable";
  }

  if (leagueConfig.rules.unavailableRegionIds.includes(regionId)) {
    return "unavailable";
  }

  return "reference";
}

export async function loadLeagueData(leagueConfig) {
  const cacheKey = leagueConfig.id;
  if (leagueDataPromiseCache.has(cacheKey)) {
    return leagueDataPromiseCache.get(cacheKey);
  }

  const promise = fetchLeagueData(leagueConfig).catch((error) => {
    leagueDataPromiseCache.delete(cacheKey);
    throw error;
  });

  leagueDataPromiseCache.set(cacheKey, promise);
  return promise;
}

export function mergeLeagueMapRegions({ svgRegions, leagueData, leagueConfig }) {
  const relationshipIds = new Set(leagueData.regionsById.keys());
  const mergedMapRegions = (Array.isArray(svgRegions) ? svgRegions : []).map((svgRegion) => {
    const relationship = leagueData.regionsById.get(svgRegion.regionId) ?? null;
    relationshipIds.delete(svgRegion.regionId);

    return {
      ...svgRegion,
      name: relationship?.name || svgRegion.svgName || svgRegion.regionId,
      relationship,
      status: getRegionStatus(svgRegion.regionId, leagueConfig),
    };
  });

  return {
    mergedMapRegions,
    mapOnlyIds: mergedMapRegions.filter((region) => !region.relationship).map((region) => region.regionId),
    dataOnlyIds: [...relationshipIds],
  };
}