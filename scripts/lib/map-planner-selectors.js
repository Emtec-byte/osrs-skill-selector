const REGION_STATUS_LABELS = {
  starting: "Starting Region",
  forced: "Forced Unlock",
  selectable: "Selectable Region",
  unavailable: "Unavailable",
  reference: "Reference Region",
};

const QUICK_FOCUS_STATUS_ORDER = {
  starting: 0,
  forced: 1,
  selectable: 2,
  unavailable: 3,
  reference: 4,
};

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim() !== ""))];
}

function uniqueBy(items, getKey) {
  const seen = new Set();

  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getRegionStatusLabel(status) {
  return REGION_STATUS_LABELS[status] ?? REGION_STATUS_LABELS.reference;
}

export function getFixedRouteIds(leagueConfig) {
  return [
    ...leagueConfig.rules.startingRegionIds,
    ...leagueConfig.rules.forcedRegionIds,
  ];
}

export function getPlannedRouteIds(leagueConfig, optionalRegionIds = []) {
  return uniqueStrings([
    ...getFixedRouteIds(leagueConfig),
    ...uniqueStrings(optionalRegionIds),
  ]);
}

export function toggleOptionalRegionId(optionalRegionIds, regionId, leagueConfig) {
  const currentIds = uniqueStrings(optionalRegionIds);
  if (!leagueConfig.rules.selectableRegionIds.includes(regionId)) {
    return currentIds;
  }

  const existingIndex = currentIds.indexOf(regionId);
  if (existingIndex >= 0) {
    const nextIds = currentIds.slice();
    nextIds.splice(existingIndex, 1);
    return nextIds;
  }

  const nextIds = currentIds.slice();
  if (nextIds.length >= leagueConfig.rules.maxSelectableAdditionalRegions) {
    nextIds.shift();
  }

  nextIds.push(regionId);
  return nextIds;
}

export function sortRegionsForQuickFocus(regions) {
  return [...(Array.isArray(regions) ? regions : [])].sort((left, right) => {
    const leftStatusOrder = QUICK_FOCUS_STATUS_ORDER[left.status] ?? 99;
    const rightStatusOrder = QUICK_FOCUS_STATUS_ORDER[right.status] ?? 99;

    if (leftStatusOrder !== rightStatusOrder) {
      return leftStatusOrder - rightStatusOrder;
    }

    return left.name.localeCompare(right.name);
  });
}

function collectNamedEntries(regions, key) {
  return uniqueBy(
    regions.flatMap((region) => region.autoUnlocks?.[key] ?? []),
    (entry) => entry.name,
  );
}

function collectStringEntries(regions, key) {
  return uniqueStrings(regions.flatMap((region) => region.autoUnlocks?.[key] ?? []));
}

function collectDrops(regions) {
  return uniqueBy(
    regions.flatMap((region) => region.notableDrops ?? []),
    (entry) => `${entry.itemNames.join("|")}:${entry.sourceNames.join("|")}:${entry.note ?? ""}`,
  );
}

export function collectRegionPlanSummary({ leagueConfig, mergedRegionsById, globalRules, globalAutoUnlocks, optionalRegionIds }) {
  const routeIds = getPlannedRouteIds(leagueConfig, optionalRegionIds);
  const selectedRegions = routeIds
    .map((regionId) => mergedRegionsById.get(regionId))
    .filter(Boolean);
  const relationshipRegions = selectedRegions
    .map((region) => region.relationship)
    .filter(Boolean);

  return {
    routeIds,
    selectedRegions,
    totalRegions: selectedRegions.length,
    combatActivities: uniqueStrings(relationshipRegions.flatMap((region) => region.notableCombatActivities ?? [])),
    nonCombatActivities: uniqueStrings(relationshipRegions.flatMap((region) => region.notableNonCombatActivities ?? [])),
    settlements: uniqueStrings(relationshipRegions.flatMap((region) => region.notableSettlements ?? [])),
    services: uniqueStrings(relationshipRegions.flatMap((region) => region.notableShopsServices ?? [])),
    echoBosses: relationshipRegions
      .filter((region) => region.echoBoss)
      .map((region) => ({
        regionId: region.id,
        regionName: region.name,
        echoBoss: region.echoBoss,
      })),
    autoUnlocks: {
      quests: collectNamedEntries(relationshipRegions, "quests"),
      achievementDiaryTasks: collectNamedEntries(relationshipRegions, "achievementDiaryTasks"),
      combatAchievements: collectNamedEntries(relationshipRegions, "combatAchievements"),
      slayerContent: collectStringEntries(relationshipRegions, "slayerContent"),
      items: collectNamedEntries(relationshipRegions, "items"),
      mechanics: collectStringEntries(relationshipRegions, "mechanics"),
    },
    drops: collectDrops(relationshipRegions),
    globalRules: (Array.isArray(globalRules) ? globalRules : []).filter((rule) =>
      rule.relatedRegionIds.some((regionId) => routeIds.includes(regionId))),
    globalAutoUnlocks: globalAutoUnlocks ?? { quests: [], starterItems: [] },
  };
}