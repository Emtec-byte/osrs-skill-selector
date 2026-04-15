import { createEmptyLeagueRegionPlan, isPlannerDbSupported, readLeagueRegionPlan } from "../lib/planner-db.js";
import { getAccessibleRegionIds, getPlannedRouteIds } from "../lib/map-planner-selectors.js";
import { isStockedQuantity, loadShopCatalog } from "../lib/shop-catalog.js";
import {
  buildWorldMapPoints,
  getSharedWorldMapSession,
  getShopTypeIconId,
  resolveWorldMapPoints,
} from "../lib/world-map-shared.js";
import { SHOPS_BROWSER_STATE_KEY } from "../config/storage-keys.js";
import { readJson, writeJson } from "../lib/storage.js";

const mapPinIconUrl = new URL("../../assets/icons/map-pin.svg", import.meta.url).href;
const caretIconUrl = new URL("../../assets/icons/caret.svg", import.meta.url).href;
const MAX_STORED_QUERY_LENGTH = 120;

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeQuery(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function sanitizeLiveQueryValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .slice(0, MAX_STORED_QUERY_LENGTH);
}

function sanitizeStoredQuery(value) {
  return normalizeWhitespace(sanitizeLiveQueryValue(value));
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

function sanitizeNullableId(value, validIds) {
  return typeof value === "string" && validIds.has(value) ? value : null;
}

function sanitizeStringSelections(values, validValues) {
  if (!Array.isArray(values)) {
    return [];
  }

  return uniqueStrings(values).filter((value) => validValues.has(value));
}

function sanitizeShopsBrowserState(rawState, { validRegionIds, validTypeLabels, validShopIds }) {
  const query = sanitizeStoredQuery(rawState?.query);
  const searchAllRegions = Boolean(rawState?.searchAllRegions);
  const selectedRegionId = sanitizeNullableId(rawState?.selectedRegionId, validRegionIds);
  const selectedTypeLabels = new Set(sanitizeStringSelections(rawState?.selectedTypeLabels, validTypeLabels));
  const selectedShopId = sanitizeNullableId(rawState?.selectedShopId, validShopIds);

  return {
    query,
    searchAllRegions,
    selectedRegionId,
    selectedTypeLabels,
    selectedShopId,
  };
}

function buildShopsBrowserState({ query, searchAllRegions, selectedRegionId, selectedTypeLabels, selectedShopId }, { validRegionIds, validTypeLabels, validShopIds }) {
  return {
    query: sanitizeStoredQuery(query),
    searchAllRegions: Boolean(searchAllRegions),
    selectedRegionId: sanitizeNullableId(selectedRegionId, validRegionIds),
    selectedTypeLabels: sanitizeStringSelections([...selectedTypeLabels], validTypeLabels),
    selectedShopId: sanitizeNullableId(selectedShopId, validShopIds),
  };
}

function formatQuantity(quantity) {
  if (quantity < 0) {
    return "∞";
  }

  return Number(quantity).toLocaleString();
}

function formatStockedItemsLabel(count) {
  return `${count.toLocaleString()} stocked item${count === 1 ? "" : "s"}`;
}

function linkHtml(label, href, className = "") {
  if (!href) {
    return escapeHtml(label);
  }

  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
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

function buildTypeOptions(catalog, accessibleRegionIds) {
  return [...new Set(
    catalog.shops
      .filter((shop) => shop.stockedItemCount > 0)
      .filter((shop) => isSearchableRegionId(shop.region.id, accessibleRegionIds))
      .map((shop) => shop.type.title),
  )].sort((left, right) => left.localeCompare(right));
}

function scoreShop(shop, query) {
  if (!query) {
    return {
      score: 1,
      matchedItems: [],
      primaryMatchLabel: null,
      additionalMatchCount: 0,
    };
  }

  let score = 0;
  const matchedItems = [];
  const matchedFieldLabels = [];

  const applyWeight = (value, weight, label) => {
    if (normalizeQuery(value).includes(query)) {
      score += weight;
      matchedFieldLabels.push(label);
    }
  };

  applyWeight(shop.name, 180, shop.name);
  applyWeight(shop.variantLabel, 60, shop.variantLabel);
  applyWeight(shop.locationName, 90, shop.locationName);
  applyWeight(shop.areaName, 65, shop.areaName);
  applyWeight(shop.region.label, 45, shop.region.label);
  applyWeight(shop.type.title, 40, shop.type.title);

  for (const stockEntry of shop.stock) {
    if (normalizeQuery(stockEntry.item?.name).includes(query)) {
      score += 26;
      matchedItems.push(stockEntry);
    }
  }

  const matchLabels = matchedItems.length > 0
    ? matchedItems.map((entry) => entry.item.name)
    : matchedFieldLabels.filter(Boolean);

  return {
    score,
    matchedItems,
    primaryMatchLabel: matchLabels[0] ?? null,
    additionalMatchCount: Math.max(0, matchLabels.length - 1),
  };
}

function sortResults(left, right) {
  if (left.match.score !== right.match.score) {
    return right.match.score - left.match.score;
  }

  if (left.shop.region.label !== right.shop.region.label) {
    return left.shop.region.label.localeCompare(right.shop.region.label);
  }

  if (left.shop.locationName !== right.shop.locationName) {
    return left.shop.locationName.localeCompare(right.shop.locationName);
  }

  return left.shop.name.localeCompare(right.shop.name);
}

function createEmptyStateHtml(title, message) {
  return `
    <div class="shops-feature__section-head">
      <p class="shops-feature__eyebrow">${escapeHtml(title)}</p>
    </div>
    <p class="shops-feature__empty">${escapeHtml(message)}</p>
  `;
}

function createMatchedBubbleHtml(match) {
  if (!match?.primaryMatchLabel) {
    return "";
  }

  return `
    <span class="shops-feature__match-pill">Matched: ${escapeHtml(match.primaryMatchLabel)}</span>
    ${match.additionalMatchCount > 0 ? `<span class="shops-feature__match-more">+${escapeHtml(match.additionalMatchCount)}</span>` : ""}
  `;
}

function buildStockRowDescriptors(stockEntries, query) {
  const normalizedQuery = normalizeQuery(query);
  const sortedEntries = [...stockEntries].sort((left, right) => {
    const leftMatch = normalizedQuery && normalizeQuery(left.item.name).includes(normalizedQuery) ? 1 : 0;
    const rightMatch = normalizedQuery && normalizeQuery(right.item.name).includes(normalizedQuery) ? 1 : 0;
    if (leftMatch !== rightMatch) {
      return rightMatch - leftMatch;
    }

    const leftStocked = isStockedQuantity(left.quantity) ? 1 : 0;
    const rightStocked = isStockedQuantity(right.quantity) ? 1 : 0;
    if (leftStocked !== rightStocked) {
      return rightStocked - leftStocked;
    }

    return left.item.name.localeCompare(right.item.name);
  }).map((entry) => ({
    entry,
    isMatch: normalizedQuery !== "" && normalizeQuery(entry.item.name).includes(normalizedQuery),
  }));

  return sortedEntries.map((descriptor, index, allDescriptors) => {
    const previousDescriptor = allDescriptors[index - 1] ?? null;
    const nextDescriptor = allDescriptors[index + 1] ?? null;
    const classNames = [];

    if (descriptor.isMatch) {
      classNames.push("is-match");
      if (!previousDescriptor?.isMatch) {
        classNames.push("is-match-start");
      }
      if (!nextDescriptor?.isMatch) {
        classNames.push("is-match-end");
      }
    }

    if (!isStockedQuantity(descriptor.entry.quantity)) {
      classNames.push("is-zero");
    }

    return {
      entry: descriptor.entry,
      className: classNames.join(" "),
    };
  });
}

export function createShopsFeature({ activeLeague, layoutEnv }) {
  return {
    id: "shops",
    label: "Shops",

    async mount({ panelEl, toolbarEl }) {
      let isDisposed = false;
      let layoutMode = layoutEnv.getMode();
      let query = "";
      let searchAllRegions = false;
      let selectedRegionId = null;
      let selectedShopId = null;
      let selectedTypeLabels = new Set();
      let isTypeFilterOpen = false;
      let isMobileDetailCollapsed = false;
      let mapPreviewShopId = null;
      let mapPreviewSession = null;
      let resultsScrollTop = 0;
      let renderFrameId = null;
      let pendingResetResultsScroll = false;

      const toolbarSummary = document.createElement("p");
      toolbarSummary.className = "toolbar-summary shops-feature__toolbar-summary";
      const toolbarGroup = document.createElement("div");
      toolbarGroup.className = "toolbar-group toolbar-group--end shops-feature__toolbar";
      toolbarGroup.append(toolbarSummary);
      toolbarEl.replaceChildren(toolbarGroup);

      const [catalog, storedPlanResult] = await Promise.all([
        loadShopCatalog(activeLeague),
        readLeagueRegionPlan(activeLeague.id),
      ]);

      if (isDisposed) {
        return null;
      }

      const storedPlan = storedPlanResult.ok
        ? storedPlanResult.plan
        : createEmptyLeagueRegionPlan(activeLeague.id);
      const routeIds = getPlannedRouteIds(activeLeague, storedPlan.optionalRegionIds);
      const routeRegions = routeIds.map((regionId) => catalog.regionsById.get(regionId)).filter(Boolean);
      const displayRegions = getDisplayRegionIds(activeLeague).map((regionId) => catalog.regionsById.get(regionId)).filter(Boolean);
      const allAreaRegions = displayRegions.filter((region) => !routeIds.includes(region.id));
      const accessibleRegionIds = getAccessibleRegionIds(activeLeague);
      const typeOptions = buildTypeOptions(catalog, accessibleRegionIds);
      const validRegionIds = new Set(displayRegions.map((region) => region.id).filter((regionId) => accessibleRegionIds.has(regionId)));
      const validTypeLabels = new Set(typeOptions);
      const validShopIds = new Set(catalog.shops.map((shop) => shop.id));
      const restoredState = sanitizeShopsBrowserState(readJson(SHOPS_BROWSER_STATE_KEY, null), {
        validRegionIds,
        validTypeLabels,
        validShopIds,
      });

      query = restoredState.query;
      searchAllRegions = restoredState.searchAllRegions;
      selectedRegionId = restoredState.selectedRegionId;
      selectedTypeLabels = restoredState.selectedTypeLabels;
      selectedShopId = restoredState.selectedShopId;

      const mapPreviewShops = catalog.shops
        .filter((shop) => shop.stockedItemCount > 0)
        .filter((shop) => isSearchableRegionId(shop.region.id, accessibleRegionIds));
      const sharedSession = await getSharedWorldMapSession();
      const mapPoints = resolveWorldMapPoints(buildWorldMapPoints(mapPreviewShops, {
        getId: (shop) => shop.id,
        getTitle: (shop) => shop.name,
        getSubtitle: (shop) => `${shop.region.label} · ${shop.locationName || shop.areaName || "Unknown location"}`,
        getGroupId: (shop) => shop.region.id,
        getGroupLabel: (shop) => shop.region.label,
        getLabel: (shop) => shop.name || shop.locationName || shop.areaName || "Unknown location",
        getCoords: (shop) => shop.coords,
        getIconId: (shop) => getShopTypeIconId(shop.type.title),
      }), sharedSession.manifest);
      const mapPointsById = new Map(mapPoints.map((point) => [point.id, point]));

      const featureView = document.createElement("section");
      featureView.className = "feature-view shops-feature";
      featureView.dataset.layoutMode = layoutMode;
      featureView.innerHTML = `
        <article class="shops-feature__panel shops-feature__panel--controls">
          <div class="shops-feature__panel-header">
            <div class="shops-feature__panel-copy">
              <p class="shops-feature__eyebrow">Shops</p>
              <h2 class="shops-feature__title">Search stocked shops</h2>
              <p class="shops-feature__description">Search your current route by default, pick a single region to inspect, or widen out to every league-valid area.</p>
            </div>
          </div>
          <div class="shops-feature__search-block">
            <p class="shops-feature__label">Search</p>
            <div class="shops-feature__search-row">
              <input class="shops-feature__search-input" type="search" placeholder="Search items, shops, or places" aria-label="Search shops">
              <div class="shops-feature__selected-region-slot"></div>
              <label class="shops-feature__toggle">
                <input class="shops-feature__toggle-input" type="checkbox">
                <span>Search all regions</span>
              </label>
            </div>
          </div>
          <details class="shops-feature__type-filter">
            <summary class="shops-feature__type-filter-summary">
              <span class="shops-feature__type-filter-tab">Shop types</span>
              <span class="shops-feature__type-filter-count"></span>
            </summary>
            <div class="shops-feature__type-filter-body"></div>
          </details>
          <div class="shops-feature__route-block">
            <p class="shops-feature__label">Current route</p>
            <div class="shops-feature__route-chips"></div>
          </div>
          <div class="shops-feature__regions-block">
            <p class="shops-feature__label">All areas</p>
            <div class="shops-feature__all-region-chips"></div>
          </div>
        </article>
        <div class="shops-feature__content">
          <article class="shops-feature__panel shops-feature__panel--detail"></article>
          <article class="shops-feature__panel shops-feature__panel--results"></article>
        </div>
        <div class="shops-feature__map-modal-host"></div>
      `;

      const searchInputEl = featureView.querySelector(".shops-feature__search-input");
      const searchAllToggleEl = featureView.querySelector(".shops-feature__toggle-input");
      const selectedRegionSlotEl = featureView.querySelector(".shops-feature__selected-region-slot");
      const typeFilterEl = featureView.querySelector(".shops-feature__type-filter");
      const typeFilterCountEl = featureView.querySelector(".shops-feature__type-filter-count");
      const typeFilterBodyEl = featureView.querySelector(".shops-feature__type-filter-body");
      const routeChipsEl = featureView.querySelector(".shops-feature__route-chips");
      const allRegionChipsEl = featureView.querySelector(".shops-feature__all-region-chips");
      const detailPanelEl = featureView.querySelector(".shops-feature__panel--detail");
      const resultsPanelEl = featureView.querySelector(".shops-feature__panel--results");
      const mapModalHostEl = featureView.querySelector(".shops-feature__map-modal-host");

      searchInputEl.value = query;
      searchAllToggleEl.checked = searchAllRegions;

      function persistState() {
        writeJson(SHOPS_BROWSER_STATE_KEY, buildShopsBrowserState({
          query,
          searchAllRegions,
          selectedRegionId,
          selectedTypeLabels,
          selectedShopId,
        }, {
          validRegionIds,
          validTypeLabels,
          validShopIds,
        }));
      }

      const state = {
        activeLeague,
        catalog,
        routeRegions,
        routeRegionIds: new Set(routeIds),
        accessibleRegionIds,
        get filteredResults() {
          const normalizedQuery = normalizeQuery(query);
          return catalog.shops
            .filter((shop) => shop.stockedItemCount > 0)
            .filter((shop) => isSearchableRegionId(shop.region.id, accessibleRegionIds))
            .filter((shop) => {
              if (searchAllRegions) {
                return isSearchableRegionId(shop.region.id, accessibleRegionIds);
              }

              if (selectedRegionId) {
                return shop.region.id === selectedRegionId;
              }

              return shop.region.id === "global" || state.routeRegionIds.has(shop.region.id);
            })
            .filter((shop) => selectedTypeLabels.size === 0 || selectedTypeLabels.has(shop.type.title))
            .map((shop) => ({
              shop,
              match: scoreShop(shop, normalizedQuery),
            }))
            .filter((result) => !normalizedQuery || result.match.score > 0)
            .sort(normalizedQuery ? sortResults : (left, right) => {
              if (left.shop.region.label !== right.shop.region.label) {
                return left.shop.region.label.localeCompare(right.shop.region.label);
              }
              if (left.shop.locationName !== right.shop.locationName) {
                return left.shop.locationName.localeCompare(right.shop.locationName);
              }
              return left.shop.name.localeCompare(right.shop.name);
            });
        },
      };

      function getVisibleTypeOptions() {
        const normalizedQuery = normalizeQuery(query);
        return typeOptions.filter((typeLabel) => (
          normalizedQuery === ""
          || normalizeQuery(typeLabel).includes(normalizedQuery)
          || selectedTypeLabels.has(typeLabel)
        ));
      }

      function renderSelectedRegionBubble() {
        if (!selectedRegionId) {
          selectedRegionSlotEl.replaceChildren();
          return;
        }

        const region = catalog.regionsById.get(selectedRegionId);
        if (!region) {
          selectedRegionSlotEl.replaceChildren();
          return;
        }

        selectedRegionSlotEl.innerHTML = `
          <button type="button" class="shops-feature__selected-region-chip${searchAllRegions ? " is-disabled" : ""}" data-clear-selected-region ${searchAllRegions ? "disabled" : ""}>
            <span>${escapeHtml(region.label)}</span>
          </button>
        `;
      }

      function renderTypeFilters() {
        const visibleTypeOptions = getVisibleTypeOptions();
        typeFilterEl.open = isTypeFilterOpen;
        typeFilterCountEl.textContent = selectedTypeLabels.size === 0 ? "All types" : `${selectedTypeLabels.size} selected`;
        typeFilterBodyEl.innerHTML = visibleTypeOptions.length > 0
          ? visibleTypeOptions.map((typeLabel) => `
              <label class="shops-feature__type-option">
                <input type="checkbox" value="${escapeHtml(typeLabel)}" ${selectedTypeLabels.has(typeLabel) ? "checked" : ""}>
                <span>${escapeHtml(typeLabel)}</span>
              </label>
            `).join("")
          : '<p class="shops-feature__type-empty">No shop types match the current search.</p>';
      }

      function renderRouteChips() {
        routeChipsEl.innerHTML = routeRegions.map((region) => `
          <button type="button" class="selection-chip is-green shops-feature__route-chip${selectedRegionId === region.id ? " is-focused shops-feature__route-chip--selected" : ""}" data-region-id="${escapeHtml(region.id)}">
            ${escapeHtml(region.label)}
          </button>
        `).join("");
      }

      function renderAllAreaChips() {
        allRegionChipsEl.innerHTML = allAreaRegions.map((region) => {
          const unavailable = isUnavailableRegion(activeLeague, region.id);
          return `
            <button
              type="button"
              class="shops-feature__region-chip${selectedRegionId === region.id ? " is-selected" : ""}${unavailable ? " is-unavailable" : ""}"
              data-region-id="${escapeHtml(region.id)}"
              ${unavailable ? "disabled" : ""}
            >
              ${escapeHtml(region.label)}
            </button>
          `;
        }).join("");
      }

      function renderResults({ resetScroll = false } = {}) {
        const previousScroller = resultsPanelEl.querySelector(".shops-feature__results-scroller");
        const nextScrollTop = resetScroll ? 0 : (previousScroller?.scrollTop ?? resultsScrollTop);
        const results = state.filteredResults;

        if (!results.some((result) => result.shop.id === selectedShopId)) {
          selectedShopId = results[0]?.shop.id ?? null;
        }

        if (results.length === 0) {
          resultsPanelEl.innerHTML = createEmptyStateHtml("Results", "No shops match the current search and filter combination.");
          persistState();
          return;
        }

        const cardsHtml = results.map((result) => `
          <article class="shops-feature__result-card${selectedShopId === result.shop.id ? " is-selected" : ""}" data-shop-id="${escapeHtml(result.shop.id)}" tabindex="0" role="button">
            <div class="shops-feature__result-head">
              <div class="shops-feature__panel-copy">
                <p class="shops-feature__result-title">${escapeHtml(result.shop.name)}</p>
                ${result.shop.variantLabel ? `<p class="shops-feature__result-variant">${escapeHtml(result.shop.variantLabel)}</p>` : ""}
              </div>
            </div>
            <div class="shops-feature__result-secondary">
              <p class="shops-feature__result-location">${escapeHtml(result.shop.locationName || result.shop.areaName || "Unknown location")}</p>
              <div class="shops-feature__result-badges">
                <span class="shops-feature__stock-count">${escapeHtml(formatStockedItemsLabel(result.shop.stockedItemCount))}</span>
                ${createMatchedBubbleHtml(result.match)}
              </div>
            </div>
            <div class="shops-feature__result-meta">
              <span class="shops-feature__meta-pill shops-feature__meta-pill--region">${escapeHtml(result.shop.region.label)}</span>
              <span class="shops-feature__meta-pill shops-feature__meta-pill--type">${escapeHtml(result.shop.type.title)}</span>
              <button type="button" class="shops-feature__meta-pill shops-feature__meta-pill--button" data-map-preview-shop-id="${escapeHtml(result.shop.id)}">
                <span>Map preview</span>
                <img class="svg-icon shops-feature__meta-icon" src="${escapeHtml(mapPinIconUrl)}" alt="" aria-hidden="true">
              </button>
            </div>
          </article>
        `).join("");

        resultsPanelEl.innerHTML = `
          <div class="shops-feature__panel-header shops-feature__panel-header--between">
            <div class="shops-feature__panel-copy">
              <p class="shops-feature__eyebrow">Results</p>
              <h2 class="shops-feature__title">Matching shops</h2>
            </div>
            <span class="shops-feature__meta-pill">${escapeHtml(results.length.toLocaleString())} shops</span>
          </div>
          <div class="shops-feature__results-scroller">
            <div class="shops-feature__results-list">${cardsHtml}</div>
          </div>
        `;

        const nextScroller = resultsPanelEl.querySelector(".shops-feature__results-scroller");
        if (nextScroller) {
          nextScroller.scrollTop = nextScrollTop;
          resultsScrollTop = nextScroller.scrollTop;
          nextScroller.addEventListener("scroll", () => {
            resultsScrollTop = nextScroller.scrollTop;
          }, { passive: true });
        }

        persistState();
      }

      function renderDetail() {
        const selectedShop = state.filteredResults.find((result) => result.shop.id === selectedShopId)?.shop ?? null;
        if (!selectedShop) {
          detailPanelEl.innerHTML = createEmptyStateHtml("Selected shop", "Select a shop to inspect its stock list.");
          return;
        }

        const showDetailBody = layoutMode !== "mobile" || !isMobileDetailCollapsed;
        const stockRows = buildStockRowDescriptors(selectedShop.stock, query).map(({ entry, className }) => {
          return `
            <tr class="${className}">
              <td>${linkHtml(entry.item.name, entry.item.url?.href ?? null, "shops-feature__stock-link")}</td>
              <td class="shops-feature__qty">${escapeHtml(formatQuantity(entry.quantity))}</td>
            </tr>
          `;
        }).join("");

        detailPanelEl.innerHTML = `
          <div class="shops-feature__detail-shell${isMobileDetailCollapsed ? " is-collapsed" : ""}">
            <div class="shops-feature__detail-header-row">
              <div class="shops-feature__section-head">
                <p class="shops-feature__eyebrow">Selected shop</p>
                <h2 class="shops-feature__detail-title">${linkHtml(selectedShop.name, selectedShop.pageUrl?.href ?? null, "shops-feature__detail-link")}</h2>
                ${selectedShop.variantLabel ? `<p class="shops-feature__detail-copy">${escapeHtml(selectedShop.variantLabel)}</p>` : ""}
                <p class="shops-feature__detail-location">${escapeHtml(selectedShop.locationName || selectedShop.areaName || "Unknown location")}</p>
              </div>
              <button type="button" class="shops-feature__detail-toggle${isMobileDetailCollapsed ? " is-collapsed" : ""}" data-toggle-detail-collapse aria-label="${isMobileDetailCollapsed ? "Expand selected shop" : "Collapse selected shop"}">
                <img class="svg-icon shops-feature__detail-toggle-icon" src="${escapeHtml(caretIconUrl)}" alt="" aria-hidden="true">
              </button>
            </div>
            ${showDetailBody ? `
              <div class="shops-feature__detail-body">
                <div class="shops-feature__detail-meta">
                  <span class="shops-feature__meta-pill shops-feature__meta-pill--region">${escapeHtml(selectedShop.region.label)}</span>
                  <span class="shops-feature__meta-pill shops-feature__meta-pill--type">${escapeHtml(selectedShop.type.title)}</span>
                  <span class="shops-feature__meta-pill">${escapeHtml(formatStockedItemsLabel(selectedShop.stockedItemCount))}</span>
                  <button type="button" class="shops-feature__meta-pill shops-feature__meta-pill--button" data-map-preview-shop-id="${escapeHtml(selectedShop.id)}">
                    <span>Map preview</span>
                    <img class="svg-icon shops-feature__meta-icon" src="${escapeHtml(mapPinIconUrl)}" alt="" aria-hidden="true">
                  </button>
                </div>
                <div class="shops-feature__stock-wrap">
                  <table class="shops-feature__stock-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                      </tr>
                    </thead>
                    <tbody>${stockRows}</tbody>
                  </table>
                </div>
              </div>
            ` : ""}
          </div>
        `;
      }

      function closeMapPreview() {
        if (mapPreviewSession) {
          mapPreviewSession.detach();
          mapPreviewSession = null;
        }

        mapModalHostEl.replaceChildren();
      }

      async function renderMapPreview() {
        if (!mapPreviewShopId) {
          closeMapPreview();
          return;
        }

        const existingPreview = mapModalHostEl.querySelector("[data-map-preview-id]");
        if (existingPreview?.dataset.mapPreviewId === mapPreviewShopId) {
          return;
        }

        const previewShop = catalog.shops.find((shop) => shop.id === mapPreviewShopId) ?? null;
        const previewPoint = mapPointsById.get(mapPreviewShopId) ?? null;
        if (!previewShop || !previewPoint) {
          mapPreviewShopId = null;
          closeMapPreview();
          return;
        }

        mapModalHostEl.innerHTML = `
          <div class="shops-feature__map-preview" role="dialog" aria-modal="true" aria-label="Map preview" data-map-preview-id="${escapeHtml(mapPreviewShopId)}">
            <button type="button" class="shops-feature__map-preview-backdrop" data-world-map-close aria-label="Close map preview"></button>
            <div class="shops-feature__map-preview-dialog">
              <div class="shops-feature__map-preview-header">
                <div class="shops-feature__section-head">
                  <p class="shops-feature__eyebrow">Map preview</p>
                  <h2 class="shops-feature__detail-title">${linkHtml(previewShop.name, previewShop.pageUrl?.href ?? null, "shops-feature__detail-link")}</h2>
                  <p class="shops-feature__detail-location">${escapeHtml(previewShop.region.label)} · ${escapeHtml(previewShop.locationName || previewShop.areaName || "Unknown location")}</p>
                </div>
                <button type="button" class="utility-button shops-feature__map-preview-close" data-world-map-close>Close</button>
              </div>
              <div class="shops-feature__map-preview-map"></div>
            </div>
          </div>
        `;

        const previewMapEl = mapModalHostEl.querySelector(".shops-feature__map-preview-map");
        const requestedShopId = mapPreviewShopId;
        if (isDisposed || mapPreviewShopId !== requestedShopId || !mapModalHostEl.contains(previewMapEl)) {
          return;
        }

        mapPreviewSession = sharedSession;
        sharedSession.attach(previewMapEl);
        sharedSession.setView({
          mapId: previewPoint.coords.mapId,
          plane: previewPoint.coords.plane,
          points: [previewPoint],
          fitPoints: true,
          singlePointZoom: 2,
          clearPoints: true,
        });
      }

      function renderChrome() {
        renderSelectedRegionBubble();
        renderTypeFilters();
        renderRouteChips();
        renderAllAreaChips();

        const routeLabel = routeRegions.map((region) => region.label).join(", ");
        const storageLabel = isPlannerDbSupported() ? "Saved route" : "Default route";
        const regionLabel = selectedRegionId && !searchAllRegions
          ? ` Region filter: ${catalog.regionsById.get(selectedRegionId)?.label ?? "Unknown"}.`
          : "";
        const searchScopeLabel = searchAllRegions ? " Searching all regions." : regionLabel;
        const typeLabel = selectedTypeLabels.size > 0 ? ` ${selectedTypeLabels.size} type filter${selectedTypeLabels.size === 1 ? "" : "s"} active.` : "";
        toolbarSummary.textContent = `${storageLabel}: ${routeLabel}.${searchScopeLabel}${typeLabel}`;
      }

      function renderAll({ resetResultsScroll = false } = {}) {
        renderChrome();
        renderResults({ resetScroll: resetResultsScroll });
        renderDetail();
        renderMapPreview();
      }

      function queueRender({ resetResultsScroll = false } = {}) {
        pendingResetResultsScroll = pendingResetResultsScroll || resetResultsScroll;

        if (renderFrameId !== null) {
          return;
        }

        renderFrameId = window.requestAnimationFrame(() => {
          renderFrameId = null;
          const nextResetResultsScroll = pendingResetResultsScroll;
          pendingResetResultsScroll = false;
          renderAll({ resetResultsScroll: nextResetResultsScroll });
        });
      }

      searchInputEl.addEventListener("input", () => {
        const nextQuery = sanitizeLiveQueryValue(searchInputEl.value);
        if (nextQuery !== searchInputEl.value) {
          searchInputEl.value = nextQuery;
        }

        query = nextQuery;
        queueRender({ resetResultsScroll: true });
      });

      searchAllToggleEl.addEventListener("change", () => {
        searchAllRegions = searchAllToggleEl.checked;
        queueRender();
      });

      typeFilterEl.addEventListener("toggle", () => {
        isTypeFilterOpen = typeFilterEl.open;
      });

      typeFilterBodyEl.addEventListener("change", (event) => {
        const input = event.target.closest("input[type='checkbox']");
        if (!input) {
          return;
        }

        if (input.checked) {
          selectedTypeLabels.add(input.value);
        } else {
          selectedTypeLabels.delete(input.value);
        }

        queueRender();
      });

      selectedRegionSlotEl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-clear-selected-region]");
        if (!button || searchAllRegions) {
          return;
        }

        selectedRegionId = null;
        queueRender();
      });

      featureView.addEventListener("click", (event) => {
        const mapButton = event.target.closest("[data-map-preview-shop-id]");
        if (mapButton) {
          mapPreviewShopId = mapButton.dataset.mapPreviewShopId;
          renderMapPreview();
          return;
        }

        const closeMapButton = event.target.closest("[data-world-map-close]");
        if (closeMapButton) {
          mapPreviewShopId = null;
          renderMapPreview();
          return;
        }

        const regionButton = event.target.closest("[data-region-id]");
        if (regionButton) {
          const { regionId } = regionButton.dataset;
          selectedRegionId = selectedRegionId === regionId ? null : regionId;
          queueRender();
          return;
        }

        const toggleDetailButton = event.target.closest("[data-toggle-detail-collapse]");
        if (toggleDetailButton) {
          isMobileDetailCollapsed = !isMobileDetailCollapsed;
          renderDetail();
          return;
        }

        const card = event.target.closest("[data-shop-id]");
        if (!card) {
          return;
        }

        selectedShopId = card.dataset.shopId;
        if (layoutMode === "mobile") {
          isMobileDetailCollapsed = false;
        }
        renderResults();
        renderDetail();
      });

      resultsPanelEl.addEventListener("keydown", (event) => {
        const card = event.target.closest("[data-shop-id]");
        if (!card || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }

        event.preventDefault();
        selectedShopId = card.dataset.shopId;
        if (layoutMode === "mobile") {
          isMobileDetailCollapsed = false;
        }
        renderResults();
        renderDetail();
      });

      const unsubscribeLayout = layoutEnv.subscribe((mode) => {
        layoutMode = mode;
        featureView.dataset.layoutMode = layoutMode;
        if (layoutMode !== "mobile") {
          isMobileDetailCollapsed = false;
        }
        renderDetail();
      });

      panelEl.replaceChildren(featureView);
      renderAll({ resetResultsScroll: true });

      return () => {
        isDisposed = true;
        if (renderFrameId !== null) {
          window.cancelAnimationFrame(renderFrameId);
        }
        closeMapPreview();
        unsubscribeLayout();
      };
    },
  };
}
