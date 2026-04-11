const leagueDataPromiseCache = new Map();

const ALLOWED_LOWERCASE_WIKI_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "ii",
  "iii",
  "in",
  "iv",
  "of",
  "on",
  "or",
  "the",
  "to",
  "v",
  "vi",
  "with",
]);

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function hasUsableHref(url) {
  return typeof url?.href === "string" && url.href.trim() !== "";
}

function buildWikiArticleSuffix(name) {
  const normalizedName = sanitizeString(name).trim().replace(/\s+/g, "_");
  if (normalizedName === "") {
    return null;
  }

  return `/w/${encodeURIComponent(normalizedName)
    .replace(/%2F/g, "/")
    .replace(/%3A/gi, ":")}`;
}

function buildWikiSearchSuffix(name) {
  const normalizedName = sanitizeString(name).trim();
  if (normalizedName === "") {
    return null;
  }

  return `/w/Special:Search?search=${encodeURIComponent(normalizedName)}`;
}

function hasUnexpectedLowercaseWikiWord(name) {
  return sanitizeString(name)
    .split(/[\s/_()\-]+/)
    .filter(Boolean)
    .some((token) => /^[a-z]/.test(token) && !ALLOWED_LOWERCASE_WIKI_WORDS.has(token.toLowerCase()));
}

function inferActivityWikiFallbackMode(name) {
  const normalizedName = sanitizeString(name).trim();
  if (normalizedName === "") {
    return "article";
  }

  if (normalizedName.length > 64) {
    return "search";
  }

  if (normalizedName.includes(",") || normalizedName.includes("/")) {
    return "search";
  }

  if (/\sand\s/i.test(normalizedName) && normalizedName.length > 32) {
    return "search";
  }

  if (hasUnexpectedLowercaseWikiWord(normalizedName)) {
    return "search";
  }

  return "article";
}

function shouldSkipDropNameInference(name) {
  return /\b(?:all|assorted|various)\b/i.test(sanitizeString(name))
    && /\b(?:unique|reward|rewards|drops?)\b/i.test(sanitizeString(name));
}

function getSpecialInferredSuffix(name) {
  const normalizedName = sanitizeString(name).trim().toLowerCase();
  if (normalizedName.endsWith("house portal")) {
    return "/w/Portal_(Player-owned_house)";
  }

  return null;
}

function createInferredUrl(name, prefix, fallbackMode = "article") {
  const specialSuffix = getSpecialInferredSuffix(name);
  if (specialSuffix) {
    return normalizeUrl({ suffix: specialSuffix }, prefix);
  }

  const suffix = fallbackMode === "search"
    ? buildWikiSearchSuffix(name)
    : buildWikiArticleSuffix(name);

  return suffix ? normalizeUrl({ suffix }, prefix) : null;
}

function resolveFallbackMode(name, fallbackMode) {
  return typeof fallbackMode === "function" ? fallbackMode(name) : fallbackMode;
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

function normalizeLinkableStringArray(entries, prefix, fallbackMode = "article") {
  return Array.isArray(entries)
    ? entries.map((entry) => {
      const name = typeof entry === "string"
        ? entry
        : sanitizeString(entry?.name).trim();

      if (typeof name !== "string" || name.trim() === "") {
        return null;
      }

      const explicitUrl = normalizeUrl(typeof entry === "string" ? null : entry?.url, prefix);
      return {
        name,
        url: hasUsableHref(explicitUrl)
          ? explicitUrl
          : createInferredUrl(name, prefix, resolveFallbackMode(name, fallbackMode)),
        note: typeof entry === "object" && typeof entry?.note === "string" ? entry.note : null,
      };
    }).filter(Boolean)
    : [];
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
    url: hasUsableHref(normalizeUrl(entry.url, prefix))
      ? normalizeUrl(entry.url, prefix)
      : createInferredUrl(name, prefix),
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

function normalizeLookupKey(value) {
  const normalized = sanitizeString(value).trim();
  return normalized === ""
    ? null
    : normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeLinkEntry(entry, prefix) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = sanitizeString(entry.name).trim();
  if (name === "") {
    return null;
  }

  return {
    name,
    url: hasUsableHref(normalizeUrl(entry.url, prefix))
      ? normalizeUrl(entry.url, prefix)
      : createInferredUrl(name, prefix),
  };
}

function normalizeServiceCategoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const serviceSection = sanitizeString(entry.serviceSection, entry.sectionKey).trim();
  const serviceSectionLabel = sanitizeString(entry.serviceSectionLabel, entry.sectionLabel).trim();
  const serviceSkillType = sanitizeString(entry.serviceSkillType, entry.skillTypeKey).trim();
  const serviceSkillTypeLabel = sanitizeString(entry.serviceSkillTypeLabel, entry.skillTypeLabel).trim();
  const serviceCategory = sanitizeString(entry.serviceCategory, entry.categoryKey).trim();
  const serviceCategoryLabel = sanitizeString(entry.serviceCategoryLabel, entry.categoryLabel).trim();

  if (serviceSection === "" && serviceCategory === "" && serviceCategoryLabel === "") {
    return null;
  }

  return {
    serviceSection: serviceSection || null,
    serviceSectionLabel: serviceSectionLabel || null,
    serviceSkillType: serviceSkillType || null,
    serviceSkillTypeLabel: serviceSkillTypeLabel || null,
    serviceCategory: serviceCategory || null,
    serviceCategoryLabel: serviceCategoryLabel || null,
  };
}

function normalizeServiceMap(map) {
  if (!map || typeof map !== "object") {
    return null;
  }

  const x = Number.isFinite(map.x) ? map.x : Number.parseInt(map.x, 10);
  const y = Number.isFinite(map.y) ? map.y : Number.parseInt(map.y, 10);
  const mapId = Number.isFinite(map.mapId) ? map.mapId : Number.parseInt(map.mapId, 10);
  const plane = Number.isFinite(map.plane) ? map.plane : Number.parseInt(map.plane, 10);

  if (![x, y, mapId, plane].every(Number.isFinite)) {
    return null;
  }

  return { x, y, mapId, plane };
}

function normalizeServiceEntry(entry, prefix) {
  if (typeof entry === "string") {
    const name = sanitizeString(entry).trim();
    if (name === "") {
      return null;
    }

    return {
      name,
      url: createInferredUrl(name, prefix),
      serviceType: null,
      serviceTypeKey: null,
      serviceSection: null,
      serviceSectionLabel: null,
      serviceSkillType: null,
      serviceSkillTypeLabel: null,
      serviceCategory: null,
      serviceCategoryLabel: null,
      serviceAdditionalCategories: [],
      needsManualReview: false,
      reviewReason: null,
      pageKind: null,
      owner: null,
      linkedShop: null,
      canonicalService: null,
      location: null,
      map: null,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = sanitizeString(entry.name).trim();
  if (name === "") {
    return null;
  }

  return {
    name,
    url: hasUsableHref(normalizeUrl(entry.url, prefix))
      ? normalizeUrl(entry.url, prefix)
      : createInferredUrl(name, prefix),
    serviceType: sanitizeString(entry.serviceType).trim() || null,
    serviceTypeKey: sanitizeString(entry.serviceTypeKey).trim() || normalizeLookupKey(entry.serviceType),
    serviceSection: sanitizeString(entry.serviceSection).trim() || null,
    serviceSectionLabel: sanitizeString(entry.serviceSectionLabel).trim() || null,
    serviceSkillType: sanitizeString(entry.serviceSkillType).trim() || null,
    serviceSkillTypeLabel: sanitizeString(entry.serviceSkillTypeLabel).trim() || null,
    serviceCategory: sanitizeString(entry.serviceCategory).trim() || null,
    serviceCategoryLabel: sanitizeString(entry.serviceCategoryLabel).trim() || null,
    serviceAdditionalCategories: Array.isArray(entry.serviceAdditionalCategories)
      ? entry.serviceAdditionalCategories.map((category) => normalizeServiceCategoryEntry(category)).filter(Boolean)
      : [],
    needsManualReview: Boolean(entry.needsManualReview),
    reviewReason: sanitizeString(entry.reviewReason).trim() || null,
    pageKind: sanitizeString(entry.pageKind).trim() || null,
    owner: normalizeLinkEntry(entry.owner, prefix),
    linkedShop: normalizeLinkEntry(entry.linkedShop, prefix),
    canonicalService: normalizeLinkEntry(entry.canonicalService, prefix),
    location: sanitizeString(entry.location).trim() || null,
    map: normalizeServiceMap(entry.map),
  };
}

function normalizeServiceEntryArray(entries, prefix) {
  return Array.isArray(entries)
    ? entries.map((entry) => normalizeServiceEntry(entry, prefix)).filter(Boolean)
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
    itemUrls: itemNames.map((name, index) => {
      const explicitUrl = normalizeUrl({ suffix: itemUrlSuffixes[index] }, prefix);
      if (hasUsableHref(explicitUrl)) {
        return explicitUrl;
      }

      return shouldSkipDropNameInference(name) ? null : createInferredUrl(name, prefix);
    }),
    sourceNames,
    sourceUrls: sourceNames.map((name, index) => {
      const explicitUrl = normalizeUrl({ suffix: sourceUrlSuffixes[index] }, prefix);
      return hasUsableHref(explicitUrl) ? explicitUrl : createInferredUrl(name, prefix);
    }),
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
    url: hasUsableHref(normalizeUrl(echoBoss.url, prefix))
      ? normalizeUrl(echoBoss.url, prefix)
      : createInferredUrl(name, prefix),
    baseBoss: echoBoss.baseBoss
      ? {
        name: sanitizeString(echoBoss.baseBoss.name),
        url: hasUsableHref(normalizeUrl(echoBoss.baseBoss.url, prefix))
          ? normalizeUrl(echoBoss.baseBoss.url, prefix)
          : createInferredUrl(echoBoss.baseBoss.name, prefix),
      }
      : null,
    regionRequirement: typeof echoBoss.regionRequirement === "string" ? echoBoss.regionRequirement : null,
    additionalRequirement: typeof echoBoss.additionalRequirement === "string"
      ? echoBoss.additionalRequirement
      : (typeof echoBoss.accessRule === "string" ? echoBoss.accessRule : null),
    echoEquipment: normalizeNamedEntryArray(echoBoss.echoEquipment, prefix),
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
    slayerContent: normalizeLinkableStringArray(autoUnlocks.slayerContent, prefix, inferActivityWikiFallbackMode),
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
    url: hasUsableHref(normalizeUrl(region.url, prefix))
      ? normalizeUrl(region.url, prefix)
      : createInferredUrl(region.name, prefix),
    unlockMode: sanitizeString(region.unlockMode),
    regionRequirements: sanitizeStringArray(region.regionRequirements),
    notableSettlements: sanitizeStringArray(region.notableSettlements),
    notableCombatActivities: normalizeLinkableStringArray(region.notableCombatActivities, prefix, inferActivityWikiFallbackMode),
    notableNonCombatActivities: normalizeLinkableStringArray(region.notableNonCombatActivities, prefix, inferActivityWikiFallbackMode),
    notableShopsServices: normalizeServiceEntryArray(region.notableShopsServices, prefix),
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