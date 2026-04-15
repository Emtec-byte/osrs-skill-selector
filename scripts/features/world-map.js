import { createEmptyLeagueRegionPlan, readLeagueRegionPlan } from "../lib/planner-db.js";
import { getAccessibleRegionIds, getPlannedRouteIds } from "../lib/map-planner-selectors.js";
import { isStockedQuantity, loadShopCatalog } from "../lib/shop-catalog.js";
import {
  buildWorldMapPoints,
  getSharedWorldMapSession,
  getShopTypeIconId,
  groupWorldMapPoints,
  registerWorldMapFeatureApi,
  resolveWorldMapPoints,
} from "../lib/world-map-shared.js";
import { WORLD_MAP_BROWSER_STATE_KEY, WORLD_MAP_VIEW_STATE_KEY } from "../config/storage-keys.js";
import { readJson, writeJson } from "../lib/storage.js";

const MAX_QUERY_LENGTH = 120;
const SEARCH_RESULT_LIMIT = 12;
const DEFAULT_MAP_ID = -1;
const DEFAULT_PLANE = 0;
const DEFAULT_SURFACE_CENTER = [3222, 3218];
const DEFAULT_OVERVIEW_ZOOM = 2;
const DEFAULT_FOCUS_ZOOM = 2;
const caretIconUrl = new URL("../../assets/icons/caret.svg", import.meta.url).href;
const SEARCH_TYPE_PRIORITY = {
  item: 0,
  type: 1,
  place: 2,
  area: 3,
  npc: 4,
};
const SEARCH_TYPE_LABEL = {
  item: "Item",
  type: "Shop type",
  npc: "NPC",
  place: "Place",
  area: "Area",
};

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeLiveQueryValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .slice(0, MAX_QUERY_LENGTH);
}

function normalizeQuery(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim() !== ""))];
}

function sanitizeStoredQuery(value) {
  return normalizeWhitespace(sanitizeLiveQueryValue(value));
}

function clampPlane(value) {
  return Math.min(3, Math.max(0, Number.isFinite(value) ? value : DEFAULT_PLANE));
}

function clampZoom(value) {
  return Number.isFinite(value) ? Math.min(8, Math.max(-3, value)) : DEFAULT_OVERVIEW_ZOOM;
}

function isUnavailableRegion(activeLeague, regionId) {
  return activeLeague.rules.unavailableRegionIds.includes(regionId);
}

function isSearchableRegionId(regionId, accessibleRegionIds) {
  return regionId === "global" || accessibleRegionIds.has(regionId);
}

function getDisplayRegionIds(activeLeague) {
  return uniqueStrings([
    ...activeLeague.rules.startingRegionIds,
    ...activeLeague.rules.forcedRegionIds,
    ...activeLeague.rules.selectableRegionIds,
    ...activeLeague.rules.unavailableRegionIds,
  ]);
}

function sanitizeNullableId(value, validIds) {
  return typeof value === "string" && validIds.has(value) ? value : null;
}

function sanitizeCenter(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const [x, y] = value;
  if (![x, y].every(Number.isFinite)) {
    return null;
  }

  return [x, y];
}

function sanitizeWorldMapBrowserState(rawState, { validRegionIds, validSearchEntryIds }) {
  return {
    query: sanitizeStoredQuery(rawState?.query),
    searchUnlockedOnly: Boolean(rawState?.searchUnlockedOnly),
    selectedRegionId: sanitizeNullableId(rawState?.selectedRegionId, validRegionIds),
    selectedSearchEntryId: sanitizeNullableId(rawState?.selectedSearchEntryId, validSearchEntryIds),
  };
}

function buildWorldMapBrowserState({ query, searchUnlockedOnly, selectedRegionId, selectedSearchEntryId }, { validRegionIds, validSearchEntryIds }) {
  return {
    query: sanitizeStoredQuery(query),
    searchUnlockedOnly: Boolean(searchUnlockedOnly),
    selectedRegionId: sanitizeNullableId(selectedRegionId, validRegionIds),
    selectedSearchEntryId: sanitizeNullableId(selectedSearchEntryId, validSearchEntryIds),
  };
}

function sanitizeWorldMapViewState(rawState, { validMapIds }) {
  const mapId = typeof rawState?.mapId === "number" && validMapIds.has(rawState.mapId) ? rawState.mapId : DEFAULT_MAP_ID;
  const center = sanitizeCenter(rawState?.center);

  return {
    mapId,
    plane: clampPlane(rawState?.plane),
    center: center ?? (mapId === DEFAULT_MAP_ID ? DEFAULT_SURFACE_CENTER : null),
    zoom: clampZoom(rawState?.zoom),
  };
}

function buildWorldMapViewState({ mapId, plane, center, zoom }) {
  return {
    mapId,
    plane,
    center: sanitizeCenter(center),
    zoom: clampZoom(zoom),
  };
}

function createSearchAccumulatorEntry(type, label) {
  const normalizedLabel = normalizeWhitespace(label);
  if (normalizedLabel === "") {
    return null;
  }

  return {
    id: `${type}:${normalizeQuery(normalizedLabel)}`,
    type,
    label: normalizedLabel,
    normalizedLabel: normalizeQuery(normalizedLabel),
    shopIds: new Set(),
  };
}

function addSearchEntry(searchMap, type, label, shopId) {
  const seedEntry = createSearchAccumulatorEntry(type, label);
  if (!seedEntry) {
    return;
  }

  const entry = searchMap.get(seedEntry.id) ?? seedEntry;
  entry.shopIds.add(shopId);
  searchMap.set(seedEntry.id, entry);
}

function buildWorldMapSearchEntries(shops) {
  const searchMap = new Map();

  for (const shop of Array.isArray(shops) ? shops : []) {
    addSearchEntry(searchMap, "npc", shop.name, shop.id);
    addSearchEntry(searchMap, "type", shop.type?.title, shop.id);
    addSearchEntry(searchMap, "place", shop.locationName, shop.id);
    addSearchEntry(searchMap, "area", shop.areaName, shop.id);

    for (const stockEntry of Array.isArray(shop.stock) ? shop.stock : []) {
      if (!isStockedQuantity(stockEntry?.quantity)) {
        continue;
      }

      addSearchEntry(searchMap, "item", stockEntry.item?.name, shop.id);
    }
  }

  return [...searchMap.values()].map((entry) => ({
    ...entry,
    shopIds: [...entry.shopIds],
    locationCount: entry.shopIds.size,
  }));
}

function getSearchEntryRank(entry, query) {
  if (!query) {
    return 0;
  }

  if (entry.normalizedLabel === query) {
    return 3;
  }

  if (entry.normalizedLabel.startsWith(query)) {
    return 2;
  }

  if (entry.normalizedLabel.includes(query)) {
    return 1;
  }

  return 0;
}

function compareSearchEntries(left, right) {
  if (SEARCH_TYPE_PRIORITY[left.entry.type] !== SEARCH_TYPE_PRIORITY[right.entry.type]) {
    return SEARCH_TYPE_PRIORITY[left.entry.type] - SEARCH_TYPE_PRIORITY[right.entry.type];
  }

  if (left.rank !== right.rank) {
    return right.rank - left.rank;
  }

  if (left.entry.locationCount !== right.entry.locationCount) {
    return right.entry.locationCount - left.entry.locationCount;
  }

  return left.entry.label.localeCompare(right.entry.label);
}

function getFilteredSearchEntries(entries, query) {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery === "") {
    return [];
  }

  return entries
    .map((entry) => ({
      entry,
      rank: getSearchEntryRank(entry, normalizedQuery),
    }))
    .filter((entry) => entry.rank > 0)
    .sort(compareSearchEntries)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) => entry.entry);
}

function createSearchResultHtml(entry) {
  return `
    <button type="button" class="world-map-feature__search-result" data-search-entry-id="${escapeHtml(entry.id)}">
      <span class="world-map-feature__search-result-type">${escapeHtml(SEARCH_TYPE_LABEL[entry.type] ?? entry.type)}</span>
      <span class="world-map-feature__search-result-copy">
        <span class="world-map-feature__search-result-label">${escapeHtml(entry.label)}</span>
        <span class="world-map-feature__search-result-meta">${escapeHtml(entry.locationCount.toLocaleString())} location${entry.locationCount === 1 ? "" : "s"}</span>
      </span>
    </button>
  `;
}

function createRegionChipHtml(region, routeRegionIds, selectedRegionId, activeLeague) {
  const isUnlocked = routeRegionIds.has(region.id);
  const unavailable = isUnavailableRegion(activeLeague, region.id);
  return `
    <button
      type="button"
      class="world-map-feature__region-chip${selectedRegionId === region.id ? " is-selected" : ""}${isUnlocked ? " is-unlocked" : ""}${unavailable ? " is-unavailable" : ""}"
      data-region-id="${escapeHtml(region.id)}"
      ${unavailable ? "disabled" : ""}
    >
      ${escapeHtml(region.label)}
    </button>
  `;
}

function createSelectionPillHtml(label, pinCount) {
  return `
    <span class="world-map-feature__selection-pill">${escapeHtml(label)}</span>
    <span class="world-map-feature__selection-pill">${escapeHtml(pinCount.toLocaleString())} pin${pinCount === 1 ? "" : "s"}</span>
  `;
}

export function createWorldMapFeature({ activeLeague, layoutEnv }) {
  return {
    id: "world-map",
    label: "World Map",

    async mount({ panelEl, toolbarEl }) {
      let isDisposed = false;
      let layoutMode = layoutEnv.getMode();
      let query = "";
      let searchUnlockedOnly = false;
      let selectedRegionId = null;
      let selectedSearchEntryId = null;
      let activeSearchPointIndex = 0;
      let currentMapId = DEFAULT_MAP_ID;
      let currentPlane = DEFAULT_PLANE;
      let currentCenter = null;
      let currentZoom = DEFAULT_OVERVIEW_ZOOM;
      let isSearchMenuOpen = false;
      let isHelpOpen = false;
      let renderFrameId = null;
      let pendingRenderOptions = {
        updateMap: false,
        fitMap: false,
        forceBaseView: false,
      };
      let externalFocusPoints = [];
      let externalFocusLabel = "";

      const [catalog, storedPlanResult, sharedSession] = await Promise.all([
        loadShopCatalog(activeLeague),
        readLeagueRegionPlan(activeLeague.id),
        getSharedWorldMapSession(),
      ]);

      if (isDisposed) {
        return null;
      }

      const storedPlan = storedPlanResult.ok
        ? storedPlanResult.plan
        : createEmptyLeagueRegionPlan(activeLeague.id);
      const routeIds = getPlannedRouteIds(activeLeague, storedPlan.optionalRegionIds);
      const routeRegionIds = new Set(routeIds);
      const accessibleRegionIds = getAccessibleRegionIds(activeLeague);
      const displayRegions = getDisplayRegionIds(activeLeague)
        .map((regionId) => catalog.regionsById.get(regionId))
        .filter(Boolean);
      const mappedShops = catalog.shops
        .filter((shop) => shop.stockedItemCount > 0)
        .filter((shop) => Array.isArray(shop.coords) && shop.coords.length >= 2)
        .filter((shop) => isSearchableRegionId(shop.region.id, accessibleRegionIds));
      const mapPoints = resolveWorldMapPoints(buildWorldMapPoints(mappedShops, {
        getId: (shop) => shop.id,
        getTitle: (shop) => shop.name,
        getSubtitle: (shop) => `${shop.region.label} · ${shop.locationName || shop.areaName || "Unknown location"}`,
        getGroupId: (shop) => shop.region.id,
        getGroupLabel: (shop) => shop.region.label,
        getLabel: (shop) => shop.name || shop.locationName || shop.areaName || "Unknown location",
        getCoords: (shop) => shop.coords,
        getIconId: (shop) => getShopTypeIconId(shop.type.title),
      }), sharedSession.manifest);
      const pointsById = new Map(mapPoints.map((point) => [point.id, point]));
      const baseSearchEntries = buildWorldMapSearchEntries(mappedShops);
      const validRegionIds = new Set(displayRegions.map((region) => region.id).filter((regionId) => accessibleRegionIds.has(regionId)));
      const validSearchEntryIds = new Set(baseSearchEntries.map((entry) => entry.id));
      const selectableBasemaps = [...sharedSession.manifest.basemaps]
        .filter((basemap) => basemap.mapId !== 0)
        .sort((left, right) => {
          if (left.mapId === -1) {
            return -1;
          }

          if (right.mapId === -1) {
            return 1;
          }

          return left.name.localeCompare(right.name);
        });
      const validMapIds = new Set(selectableBasemaps.map((basemap) => basemap.mapId));
      const restoredBrowserState = sanitizeWorldMapBrowserState(readJson(WORLD_MAP_BROWSER_STATE_KEY, null), {
        validRegionIds,
        validSearchEntryIds,
      });
      const restoredViewState = sanitizeWorldMapViewState(readJson(WORLD_MAP_VIEW_STATE_KEY, null), {
        validMapIds,
      });

      query = restoredBrowserState.query;
      searchUnlockedOnly = restoredBrowserState.searchUnlockedOnly;
      selectedRegionId = restoredBrowserState.selectedRegionId;
      selectedSearchEntryId = restoredBrowserState.selectedSearchEntryId;
      currentMapId = restoredViewState.mapId;
      currentPlane = restoredViewState.plane;
      currentCenter = restoredViewState.center;
      currentZoom = restoredViewState.zoom;

      const featureView = document.createElement("section");
      featureView.className = "feature-view world-map-feature";
      featureView.dataset.layoutMode = layoutMode;
      featureView.innerHTML = `
        <article class="world-map-feature__panel world-map-feature__panel--stage">
          <div class="world-map-feature__control-strip"></div>
          <div class="world-map-feature__search-shell">
            <div class="world-map-feature__search-row">
              <input class="world-map-feature__search-input" type="search" placeholder="Search item, shop type, place, or NPC" aria-label="Search map locations">
              <button type="button" class="utility-button world-map-feature__search-step" data-world-map-search-prev aria-label="Previous search location" disabled>
                <img class="svg-icon world-map-feature__search-step-icon world-map-feature__search-step-icon--left" src="${escapeHtml(caretIconUrl)}" alt="" aria-hidden="true">
              </button>
              <button type="button" class="utility-button world-map-feature__search-step" data-world-map-search-next aria-label="Next search location" disabled>
                <img class="svg-icon world-map-feature__search-step-icon world-map-feature__search-step-icon--right" src="${escapeHtml(caretIconUrl)}" alt="" aria-hidden="true">
              </button>
              <button type="button" class="utility-button world-map-feature__search-reset" data-world-map-search-reset>Reset</button>
              <label class="world-map-feature__search-toggle">
                <input class="world-map-feature__search-toggle-input" type="checkbox">
                <span>Unlocked only</span>
              </label>
            </div>
            <div class="world-map-feature__search-results" hidden></div>
          </div>
          <div class="world-map-feature__map-host"></div>
        </article>
      `;

      const toolbarGroup = document.createElement("div");
      toolbarGroup.className = "toolbar-group toolbar-group--end world-map-toolbar";
      toolbarGroup.innerHTML = `
        <div class="world-map-toolbar__map-picker">
          <select class="world-map-toolbar__map-select" aria-label="Select world map layer"></select>
        </div>
        <div class="world-map-toolbar__planes" aria-label="Select plane"></div>
        <button type="button" class="utility-button world-map-toolbar__reset-button" data-world-map-reset>Reset</button>
      `;
      toolbarEl.replaceChildren(toolbarGroup);

      const controlStripEl = featureView.querySelector(".world-map-feature__control-strip");
      const searchInputEl = featureView.querySelector(".world-map-feature__search-input");
      const searchResultsEl = featureView.querySelector(".world-map-feature__search-results");
      const mapHostEl = featureView.querySelector(".world-map-feature__map-host");
      const mapSelectEl = toolbarGroup.querySelector(".world-map-toolbar__map-select");
      const planeButtonsEl = toolbarGroup.querySelector(".world-map-toolbar__planes");
      const searchPrevButtonEl = featureView.querySelector("[data-world-map-search-prev]");
      const searchNextButtonEl = featureView.querySelector("[data-world-map-search-next]");
      const searchResetButtonEl = featureView.querySelector("[data-world-map-search-reset]");
      const mapResetButtonEl = toolbarGroup.querySelector("[data-world-map-reset]");
      const searchUnlockedToggleEl = featureView.querySelector(".world-map-feature__search-toggle-input");

      mapSelectEl.innerHTML = selectableBasemaps.map((basemap) => `
        <option value="${escapeHtml(basemap.mapId)}">${escapeHtml(basemap.mapId === -1 ? "Gielinor Surface" : basemap.name)}</option>
      `).join("");
      planeButtonsEl.innerHTML = [0, 1, 2, 3].map((plane) => `
        <button type="button" class="world-map-toolbar__plane-button" data-plane="${plane}" aria-pressed="false">${plane}</button>
      `).join("");

      panelEl.replaceChildren(featureView);
      sharedSession.attach(mapHostEl);
      searchInputEl.value = query;
      searchUnlockedToggleEl.checked = searchUnlockedOnly;

      function persistBrowserState() {
        writeJson(WORLD_MAP_BROWSER_STATE_KEY, buildWorldMapBrowserState({
          query,
          searchUnlockedOnly,
          selectedRegionId,
          selectedSearchEntryId,
        }, {
          validRegionIds,
          validSearchEntryIds,
        }));
      }

      function persistViewState() {
        writeJson(WORLD_MAP_VIEW_STATE_KEY, buildWorldMapViewState({
          mapId: currentMapId,
          plane: currentPlane,
          center: currentCenter,
          zoom: currentZoom,
        }));
      }

      function clearExternalFocus() {
        externalFocusPoints = [];
        externalFocusLabel = "";
      }

      function clearSearchState() {
        clearExternalFocus();
        query = "";
        selectedSearchEntryId = null;
        activeSearchPointIndex = 0;
        searchInputEl.value = "";
        isSearchMenuOpen = false;
      }

      function getScopedShops() {
        if (selectedRegionId) {
          return mappedShops.filter((shop) => shop.region.id === selectedRegionId);
        }

        if (searchUnlockedOnly) {
          return mappedShops.filter((shop) => shop.region.id === "global" || routeRegionIds.has(shop.region.id));
        }

        return mappedShops;
      }

      function getViewState() {
        const scopedShops = getScopedShops();
        const scopedSearchEntries = buildWorldMapSearchEntries(scopedShops);
        const scopedSearchEntriesById = new Map(scopedSearchEntries.map((entry) => [entry.id, entry]));
        const activeSearchEntry = scopedSearchEntriesById.get(selectedSearchEntryId) ?? null;
        const selectedPoints = activeSearchEntry
          ? activeSearchEntry.shopIds.map((shopId) => pointsById.get(shopId)).filter(Boolean)
          : [];
        const resolvedSearchPointIndex = selectedPoints.length > 0
          ? Math.min(activeSearchPointIndex, selectedPoints.length - 1)
          : 0;
        const activeFocusPoint = externalFocusPoints[0] ?? selectedPoints[resolvedSearchPointIndex] ?? null;
        const focusMapId = activeFocusPoint?.coords?.mapId ?? currentMapId;
        const focusPlane = activeFocusPoint?.coords?.plane ?? currentPlane;
        const activePointGroup = externalFocusPoints.length > 0
          ? groupWorldMapPoints(externalFocusPoints, currentMapId, currentPlane)
          : groupWorldMapPoints(selectedPoints, focusMapId, focusPlane);

        return {
          scopedSearchEntries,
          scopedSearchEntriesById,
          activeSearchEntry,
          selectedPoints,
          resolvedSearchPointIndex,
          activeFocusPoint,
          activePointGroup,
          searchSuggestions: getFilteredSearchEntries(scopedSearchEntries, query),
        };
      }

      function renderToolbarControls() {
        mapSelectEl.value = String(currentMapId);
        planeButtonsEl.querySelectorAll("[data-plane]").forEach((button) => {
          const isActive = Number(button.dataset.plane) === currentPlane;
          button.classList.toggle("is-active", isActive);
          button.setAttribute("aria-pressed", String(isActive));
        });
      }

      function renderControlStrip(viewState) {
        const regionButtonsHtml = displayRegions
          .map((region) => createRegionChipHtml(region, routeRegionIds, selectedRegionId, activeLeague))
          .join("");
        const helpButtonHtml = `
          <div class="world-map-feature__help-menu help-menu${isHelpOpen ? " is-open" : ""}">
            <button
              type="button"
              class="world-map-feature__help-button utility-button${isHelpOpen ? " is-active" : ""}"
              data-world-map-help-toggle
              aria-expanded="${isHelpOpen}"
              aria-haspopup="dialog"
            >?</button>
            <div class="menu-panel help-panel world-map-feature__help-panel" role="dialog" aria-label="World map help">
              <p class="help-panel__text world-map-feature__help-copy">Search matches items, shop types, places, NPCs, and areas. Use the area chips above to search a specific region, enable Unlocked only to restrict results to your saved route from Areas, and use the arrow buttons to cycle multi-location results.</p>
            </div>
          </div>
        `;
        const selectionPillsHtml = viewState.activeSearchEntry && viewState.activePointGroup
          ? createSelectionPillHtml(`${SEARCH_TYPE_LABEL[viewState.activeSearchEntry.type] ?? viewState.activeSearchEntry.type}: ${viewState.activeSearchEntry.label}`, viewState.activePointGroup.points.length)
          : (externalFocusLabel && viewState.activePointGroup
            ? createSelectionPillHtml(externalFocusLabel, viewState.activePointGroup.points.length)
            : "");
        controlStripEl.innerHTML = `${regionButtonsHtml}${helpButtonHtml}${selectionPillsHtml}`;
      }

      function renderSearchNavigation(viewState) {
        const canCycle = Boolean(viewState.activeSearchEntry) && viewState.selectedPoints.length > 1;
        searchPrevButtonEl.disabled = !canCycle;
        searchNextButtonEl.disabled = !canCycle;
        searchPrevButtonEl.setAttribute("aria-disabled", String(!canCycle));
        searchNextButtonEl.setAttribute("aria-disabled", String(!canCycle));
      }

      function renderSearchResults(viewState) {
        const shouldShowMenu = isSearchMenuOpen && normalizeQuery(query) !== "";
        searchResultsEl.hidden = !shouldShowMenu;
        if (!shouldShowMenu) {
          searchResultsEl.replaceChildren();
          return;
        }

        if (viewState.searchSuggestions.length === 0) {
          searchResultsEl.innerHTML = '<p class="world-map-feature__search-empty">No matching map entries.</p>';
          return;
        }

        searchResultsEl.innerHTML = viewState.searchSuggestions.map(createSearchResultHtml).join("");
      }

      function renderMap(viewState, { fitMap = false, forceBaseView = false } = {}) {
        if (viewState.activePointGroup) {
          currentMapId = viewState.activePointGroup.mapId;
          currentPlane = viewState.activePointGroup.plane;
          renderToolbarControls();

          if (fitMap && viewState.activeFocusPoint?.coords) {
            sharedSession.setView({
              mapId: currentMapId,
              plane: currentPlane,
              center: [viewState.activeFocusPoint.coords.x, viewState.activeFocusPoint.coords.y],
              centerOnTile: true,
              zoom: DEFAULT_FOCUS_ZOOM,
              points: viewState.activePointGroup.points,
              fitPoints: false,
              clearPoints: true,
            });
            return;
          }

          sharedSession.setView({
            mapId: currentMapId,
            plane: currentPlane,
            points: viewState.activePointGroup.points,
            fitPoints: fitMap,
            singlePointZoom: DEFAULT_FOCUS_ZOOM,
            clearPoints: true,
          });
          return;
        }

        renderToolbarControls();
        sharedSession.setView({
          mapId: currentMapId,
          plane: currentPlane,
          center: forceBaseView ? currentCenter : null,
          zoom: forceBaseView ? currentZoom : null,
          clearPoints: true,
        });
      }

      function renderAll({ updateMap = false, fitMap = false, forceBaseView = false } = {}) {
        let viewState = getViewState();
        if (selectedSearchEntryId && !viewState.activeSearchEntry) {
          selectedSearchEntryId = null;
          activeSearchPointIndex = 0;
          viewState = getViewState();
        }

        renderToolbarControls();
        renderControlStrip(viewState);
        renderSearchNavigation(viewState);
        renderSearchResults(viewState);
        if (updateMap) {
          renderMap(viewState, { fitMap, forceBaseView });
        }
        persistBrowserState();
      }

      function queueRender({ updateMap = false, fitMap = false, forceBaseView = false } = {}) {
        pendingRenderOptions.updateMap = pendingRenderOptions.updateMap || updateMap;
        pendingRenderOptions.fitMap = pendingRenderOptions.fitMap || fitMap;
        pendingRenderOptions.forceBaseView = pendingRenderOptions.forceBaseView || forceBaseView;

        if (renderFrameId !== null) {
          return;
        }

        renderFrameId = window.requestAnimationFrame(() => {
          renderFrameId = null;
          const nextOptions = pendingRenderOptions;
          pendingRenderOptions = {
            updateMap: false,
            fitMap: false,
            forceBaseView: false,
          };
          renderAll(nextOptions);
        });
      }

      function selectSearchEntry(entryId) {
        const entry = getViewState().scopedSearchEntriesById.get(entryId) ?? null;
        if (!entry) {
          return;
        }

        clearExternalFocus();
        selectedSearchEntryId = entry.id;
        activeSearchPointIndex = 0;
        query = entry.label;
        searchInputEl.value = query;
        isSearchMenuOpen = false;
        queueRender({ updateMap: true, fitMap: true });
      }

      sharedSession.setViewChangeListener((viewState) => {
        currentMapId = viewState.mapId;
        currentPlane = viewState.plane;
        currentCenter = viewState.center;
        currentZoom = viewState.zoom;
        persistViewState();
      });

      const unregisterFeatureApi = registerWorldMapFeatureApi({
        async focusLocation(location) {
          const points = buildWorldMapPoints([{
            id: `external:${location.mapId ?? DEFAULT_MAP_ID}:${location.plane ?? DEFAULT_PLANE}:${location.x}:${location.y}`,
            title: location.title ?? location.label ?? "Focused location",
            subtitle: location.subtitle ?? "",
            groupId: "external",
            groupLabel: "External",
            label: location.label ?? location.title ?? "Focused location",
            coords: [location.x, location.y, location.mapId ?? DEFAULT_MAP_ID, location.plane ?? DEFAULT_PLANE],
            iconId: Number.isFinite(location.iconId) ? location.iconId : null,
          }], {
            getId: (entry) => entry.id,
            getTitle: (entry) => entry.title,
            getSubtitle: (entry) => entry.subtitle,
            getGroupId: (entry) => entry.groupId,
            getGroupLabel: (entry) => entry.groupLabel,
            getLabel: (entry) => entry.label,
            getCoords: (entry) => entry.coords,
            getIconId: (entry) => entry.iconId,
          });

          clearExternalFocus();
          externalFocusPoints = points;
          externalFocusLabel = location.label ?? location.title ?? "Focused location";
          selectedSearchEntryId = null;
          activeSearchPointIndex = 0;
          selectedRegionId = null;
          query = "";
          searchInputEl.value = "";
          currentMapId = location.mapId ?? DEFAULT_MAP_ID;
          currentPlane = clampPlane(location.plane);
          isSearchMenuOpen = false;
          queueRender({ updateMap: true, fitMap: true });
        },
      });

      searchInputEl.addEventListener("input", () => {
        const nextQuery = sanitizeLiveQueryValue(searchInputEl.value);
        if (nextQuery !== searchInputEl.value) {
          searchInputEl.value = nextQuery;
        }

        const hadFocusedPoints = selectedSearchEntryId !== null || externalFocusPoints.length > 0;
        query = nextQuery;
        clearExternalFocus();
        isSearchMenuOpen = normalizeQuery(query) !== "";

        const currentViewState = getViewState();
        const activeEntry = currentViewState.scopedSearchEntriesById.get(selectedSearchEntryId) ?? null;
        if (!activeEntry || normalizeQuery(activeEntry.label) !== normalizeQuery(query)) {
          selectedSearchEntryId = null;
          activeSearchPointIndex = 0;
        }

        const shouldResetMap = hadFocusedPoints && selectedSearchEntryId === null;
        queueRender({ updateMap: shouldResetMap, forceBaseView: shouldResetMap });
      });

      searchInputEl.addEventListener("focus", () => {
        if (normalizeQuery(query) === "") {
          return;
        }

        isSearchMenuOpen = true;
        queueRender();
      });

      searchInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          isSearchMenuOpen = false;
          queueRender();
          return;
        }

        if (event.key !== "Enter") {
          return;
        }

        const firstSuggestion = getViewState().searchSuggestions[0] ?? null;
        if (!firstSuggestion) {
          return;
        }

        event.preventDefault();
        selectSearchEntry(firstSuggestion.id);
      });

      mapSelectEl.addEventListener("change", () => {
        currentMapId = Number(mapSelectEl.value);
        currentCenter = null;
        currentZoom = null;
        clearExternalFocus();
        selectedSearchEntryId = null;
        activeSearchPointIndex = 0;
        query = "";
        searchInputEl.value = "";
        isSearchMenuOpen = false;
        queueRender({ updateMap: true, forceBaseView: true });
      });

      searchUnlockedToggleEl.addEventListener("change", () => {
        searchUnlockedOnly = searchUnlockedToggleEl.checked;
        clearExternalFocus();
        selectedSearchEntryId = null;
        activeSearchPointIndex = 0;
        queueRender({ updateMap: true, forceBaseView: true });
      });

      planeButtonsEl.addEventListener("click", (event) => {
        const planeButton = event.target.closest("[data-plane]");
        if (!planeButton) {
          return;
        }

        currentPlane = Number(planeButton.dataset.plane);
        clearExternalFocus();
        selectedSearchEntryId = null;
        activeSearchPointIndex = 0;
        query = "";
        searchInputEl.value = "";
        isSearchMenuOpen = false;
        queueRender({ updateMap: true, forceBaseView: true });
      });

      function cycleSearchResult(direction) {
        const viewState = getViewState();
        const pointCount = viewState.selectedPoints.length;
        if (!viewState.activeSearchEntry || pointCount < 2) {
          return;
        }

        activeSearchPointIndex = (viewState.resolvedSearchPointIndex + direction + pointCount) % pointCount;
        queueRender({ updateMap: true, fitMap: true });
      }

      searchPrevButtonEl.addEventListener("click", () => {
        cycleSearchResult(-1);
      });

      searchNextButtonEl.addEventListener("click", () => {
        cycleSearchResult(1);
      });

      searchResetButtonEl.addEventListener("click", () => {
        clearSearchState();
        currentMapId = DEFAULT_MAP_ID;
        currentPlane = DEFAULT_PLANE;
        currentCenter = null;
        currentZoom = null;
        queueRender({ updateMap: true, forceBaseView: true });
      });

      mapResetButtonEl.addEventListener("click", () => {
        clearExternalFocus();
        selectedSearchEntryId = null;
        activeSearchPointIndex = 0;
        currentMapId = DEFAULT_MAP_ID;
        currentPlane = DEFAULT_PLANE;
        currentCenter = null;
        currentZoom = null;
        isSearchMenuOpen = normalizeQuery(query) !== "";
        queueRender({ updateMap: true, forceBaseView: true });
      });

      featureView.addEventListener("click", (event) => {
        const regionButton = event.target.closest("[data-region-id]");
        if (regionButton) {
          const { regionId } = regionButton.dataset;
          clearExternalFocus();
          selectedRegionId = selectedRegionId === regionId ? null : regionId;

          const nextViewState = getViewState();
          const didKeepSelection = Boolean(selectedSearchEntryId) && nextViewState.scopedSearchEntriesById.has(selectedSearchEntryId);
          if (!didKeepSelection) {
            selectedSearchEntryId = null;
            activeSearchPointIndex = 0;
          }

          queueRender({ updateMap: true, fitMap: didKeepSelection, forceBaseView: !didKeepSelection });
          return;
        }

        const searchEntryButton = event.target.closest("[data-search-entry-id]");
        if (searchEntryButton) {
          selectSearchEntry(searchEntryButton.dataset.searchEntryId);
          return;
        }

        const helpButton = event.target.closest("[data-world-map-help-toggle]");
        if (helpButton) {
          isHelpOpen = !isHelpOpen;
          queueRender();
          return;
        }

        let shouldRenderChrome = false;
        if (!event.target.closest(".world-map-feature__help-menu") && isHelpOpen) {
          isHelpOpen = false;
          shouldRenderChrome = true;
        }

        if (!event.target.closest(".world-map-feature__search-shell")) {
          isSearchMenuOpen = false;
          shouldRenderChrome = true;
        }

        if (shouldRenderChrome) {
          queueRender();
        }
      });

      const unsubscribeLayout = layoutEnv.subscribe((mode) => {
        layoutMode = mode;
        featureView.dataset.layoutMode = layoutMode;
      });

      renderAll({
        updateMap: true,
        fitMap: Boolean(selectedSearchEntryId),
        forceBaseView: true,
      });

      return () => {
        isDisposed = true;
        if (renderFrameId !== null) {
          window.cancelAnimationFrame(renderFrameId);
        }
        sharedSession.setViewChangeListener(null);
        sharedSession.detach();
        unregisterFeatureApi();
        unsubscribeLayout();
      };
    },
  };
}