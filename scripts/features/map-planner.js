import { createDebouncedWriter } from "../lib/storage.js";
import { loadLeagueData, mergeLeagueMapRegions } from "../lib/league-data.js";
import {
  collectRegionPlanSummary,
  getPlannedRouteIds,
  getRegionStatusLabel,
  sortRegionsForQuickFocus,
  toggleOptionalRegionId,
} from "../lib/map-planner-selectors.js";
import {
  createEmptyLeagueRegionPlan,
  isPlannerDbSupported,
  readLeagueRegionPlan,
  writeLeagueRegionPlan,
} from "../lib/planner-db.js";
import { createSvgRegionMap } from "../lib/svg-region-map.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLinkedName(name, url) {
  const href = typeof url?.href === "string" && url.href.trim() !== "" ? url.href : null;
  if (!href) {
    return escapeHtml(name);
  }

  return `<a class="map-planner__link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`;
}

function renderEmptyState(message) {
  return `<p class="map-planner__empty">${escapeHtml(message)}</p>`;
}

function renderStringList(items, emptyText) {
  if (!items || items.length === 0) {
    return renderEmptyState(emptyText);
  }

  return `<ul class="map-planner__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderNamedEntry(entry) {
  const parts = [];

  if (entry.note) {
    parts.push(escapeHtml(entry.note));
  }

  if (entry.includesPrerequisites) {
    parts.push("Includes prerequisites");
  }

  if (entry.tasks?.length) {
    parts.push(`${entry.tasks.length} tasks`);
  }

  return `<li>${renderLinkedName(entry.name, entry.url)}${parts.length ? ` <span class="map-planner__entry-meta">${parts.join(" · ")}</span>` : ""}</li>`;
}

function renderNamedList(items, emptyText) {
  if (!items || items.length === 0) {
    return renderEmptyState(emptyText);
  }

  return `<ul class="map-planner__list">${items.map((item) => renderNamedEntry(item)).join("")}</ul>`;
}

function renderDropList(items, emptyText) {
  if (!items || items.length === 0) {
    return renderEmptyState(emptyText);
  }

  return `
    <ul class="map-planner__list">
      ${items.map((entry) => {
        const itemLabel = entry.itemNames.join(", ");
        const sourceLabel = entry.sourceNames.join(", ");
        const meta = entry.note ? ` <span class="map-planner__entry-meta">${escapeHtml(entry.note)}</span>` : "";
        return `<li><strong>${escapeHtml(itemLabel)}</strong> <span class="map-planner__entry-meta">from ${escapeHtml(sourceLabel)}</span>${meta}</li>`;
      }).join("")}
    </ul>
  `;
}

function renderCountPill(value, label) {
  return `<span class="map-planner__count-pill">${escapeHtml(value)} ${escapeHtml(label)}</span>`;
}

function renderDetailBlock({ sectionKey, title, summary, bodyHtml, collapsedSections, defaultOpen = false }) {
  const isOpen = collapsedSections[sectionKey] === undefined ? defaultOpen : !collapsedSections[sectionKey];
  return `
    <details class="map-planner__details" data-section-key="${escapeHtml(sectionKey)}" ${isOpen ? "open" : ""}>
      <summary>
        <span>${escapeHtml(title)}</span>
        <span class="map-planner__details-summary">${escapeHtml(summary)}</span>
      </summary>
      <div class="map-planner__details-body">${bodyHtml}</div>
    </details>
  `;
}

function getPlanStatusLabel(isAvailable) {
  return isAvailable ? "Saved locally in this browser." : "Planner storage unavailable in this browser.";
}

function getRegionStateClassNames(region, focusedRegionId, optionalRegionIds) {
  const classes = [];
  if (region.regionId === focusedRegionId) {
    classes.push("is-focused");
  }
  if (region.status === "starting" || region.status === "forced") {
    classes.push("is-fixed");
  } else if (optionalRegionIds.includes(region.regionId)) {
    classes.push("is-selected");
  } else if (region.status === "unavailable") {
    classes.push("is-unavailable");
  }
  return classes;
}

function createRegionButtonClass(region, focusedRegionId, optionalRegionIds) {
  const classes = ["map-planner__chip", ...getRegionStateClassNames(region, focusedRegionId, optionalRegionIds)];
  return classes.join(" ");
}

function createRegionLegendClass(region, focusedRegionId, optionalRegionIds) {
  return ["map-planner__legend-chip", "map-planner__legend-chip--route", ...getRegionStateClassNames(region, focusedRegionId, optionalRegionIds)].join(" ");
}

export function createMapPlannerFeature({ activeLeague, layoutEnv }) {
  return {
    id: "map-planner",
    label: activeLeague.shortLabel || "Map",

    async mount({ panelEl, toolbarEl }) {
      let isDisposed = false;
      let layoutMode = layoutEnv.getMode();
      let optionalRegionIds = [];
      let focusedRegionId = null;
      let collapsedSections = {};
      let persistenceState = isPlannerDbSupported() ? "saved" : "unavailable";
      let mergedRegions = [];
      let mergedRegionsById = new Map();
      let leagueData = null;
      let pendingPersistPromise = null;

      const toolbarActions = document.createElement("div");
      toolbarActions.className = "toolbar-group toolbar-group--end map-planner__toolbar";

      const toolbarSummary = document.createElement("p");
      toolbarSummary.className = "toolbar-summary map-planner__toolbar-summary";

      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "utility-button";
      clearButton.textContent = "Clear optional picks";

      toolbarActions.append(toolbarSummary, clearButton);
      toolbarEl.replaceChildren(toolbarActions);

      const surface = createSvgRegionMap({
        svgSrc: activeLeague.map.svgSrc,
        regionIdMap: activeLeague.map.regionIdMap,
      });

      const svgRegionsPromise = surface.load();
      const leagueDataPromise = loadLeagueData(activeLeague);
      const regionPlanPromise = readLeagueRegionPlan(activeLeague.id);
      const [svgRegions, loadedLeagueData, storedRegionPlanResult] = await Promise.all([
        svgRegionsPromise,
        leagueDataPromise,
        regionPlanPromise,
      ]);

      if (isDisposed) {
        surface.destroy();
        return null;
      }

      leagueData = loadedLeagueData;

      const mergeResult = mergeLeagueMapRegions({
        svgRegions,
        leagueData,
        leagueConfig: activeLeague,
      });

      mergedRegions = mergeResult.mergedMapRegions;
      mergedRegionsById = new Map(mergedRegions.map((region) => [region.regionId, region]));

      if (mergeResult.mapOnlyIds.length > 0) {
        console.warn("Map regions without relationship entries:", mergeResult.mapOnlyIds);
      }

      if (mergeResult.dataOnlyIds.length > 0) {
        console.warn("Relationship entries without map regions:", mergeResult.dataOnlyIds);
      }

      const storedRegionPlan = storedRegionPlanResult.ok
        ? storedRegionPlanResult.plan
        : createEmptyLeagueRegionPlan(activeLeague.id);

      optionalRegionIds = storedRegionPlan.optionalRegionIds
        .filter((regionId) => activeLeague.rules.selectableRegionIds.includes(regionId));
      collapsedSections = { ...storedRegionPlan.collapsedSections };

      const defaultFocusedRegionId = getPlannedRouteIds(activeLeague, optionalRegionIds)[0]
        ?? mergedRegions[0]?.regionId
        ?? null;

      focusedRegionId = mergedRegionsById.has(storedRegionPlan.focusedRegionId)
        ? storedRegionPlan.focusedRegionId
        : defaultFocusedRegionId;

      const featureView = document.createElement("section");
      featureView.className = "feature-view map-planner";
      featureView.dataset.layoutMode = layoutMode;
      featureView.innerHTML = `
        <section class="map-planner__routebar"></section>
        <div class="map-planner__content">
          <section class="map-planner__map-column">
            <article class="map-planner__panel map-planner__panel--map"></article>
            <article class="map-planner__panel map-planner__panel--summary"></article>
          </section>
          <section class="map-planner__side-column">
            <article class="map-planner__panel map-planner__panel--region"></article>
          </section>
        </div>
      `;

      const routeBarEl = featureView.querySelector(".map-planner__routebar");
      const mapCard = featureView.querySelector(".map-planner__panel--map");
      const regionPanelEl = featureView.querySelector(".map-planner__panel--region");
      const summaryPanelEl = featureView.querySelector(".map-planner__panel--summary");

      mapCard.innerHTML = `
        <div class="map-planner__panel-header map-planner__panel-header--map">
          <div class="map-planner__panel-copy">
            <p class="map-planner__eyebrow">Region Planner</p>
            <h2 class="map-planner__title">Interactive unlock map</h2>
            <p class="map-planner__description">Click regions to inspect them. Use Unlock below to add a selectable region to the route.</p>
          </div>
          <div class="map-planner__map-header-meta">
            <div class="map-planner__map-route-meta"></div>
          </div>
        </div>
      `;
      mapCard.appendChild(surface.element);
      const mapRouteMetaEl = mapCard.querySelector(".map-planner__map-route-meta");
      const mapFrameEl = surface.element.querySelector(".svg-region-map__frame");

      if (mapFrameEl) {
        const canvasLegendEl = document.createElement("div");
        canvasLegendEl.className = "map-planner__canvas-legend";
        canvasLegendEl.innerHTML = `
          <span class="map-planner__legend-chip map-planner__legend-chip--overlay"><span class="map-planner__legend-dot is-fixed"></span>Fixed</span>
          <span class="map-planner__legend-chip map-planner__legend-chip--overlay"><span class="map-planner__legend-dot is-selected"></span>Planned</span>
          <span class="map-planner__legend-chip map-planner__legend-chip--overlay"><span class="map-planner__legend-dot is-unavailable"></span>Unavailable</span>
        `;
        mapFrameEl.appendChild(canvasLegendEl);
      }

      function createPersistSnapshot() {
        return {
          focusedRegionId,
          optionalRegionIds,
          collapsedSections,
        };
      }

      function updateToolbar() {
        const maxSelectable = activeLeague.rules.maxSelectableAdditionalRegions;
        const persistenceLabel = persistenceState === "error"
          ? "Local save failed."
          : getPlanStatusLabel(isPlannerDbSupported());

        toolbarSummary.textContent = `Optional picks ${optionalRegionIds.length}/${maxSelectable}. ${persistenceLabel}`;
        clearButton.disabled = optionalRegionIds.length === 0;
      }

      function schedulePersist() {
        if (!isPlannerDbSupported()) {
          persistenceState = "unavailable";
          updateToolbar();
          return;
        }

        persistWriter.schedule(createPersistSnapshot());
      }

      function flushPersist() {
        if (!isPlannerDbSupported()) {
          return;
        }

        persistWriter.flush(createPersistSnapshot());
      }

      function renderRouteBar() {
        const routeIds = getPlannedRouteIds(activeLeague, optionalRegionIds);
        const slotsLeft = activeLeague.rules.maxSelectableAdditionalRegions - optionalRegionIds.length;
        const compactRouteButtons = routeIds.map((regionId, index) => {
          const region = mergedRegionsById.get(regionId);
          const prefix = index === 0 ? "Start" : (index === 1 ? "Forced" : `Pick ${index - 1}`);
          return `
            <button type="button" class="${createRegionLegendClass(region, focusedRegionId, optionalRegionIds)}" data-map-route-focus="${escapeHtml(regionId)}">
              <span class="map-planner__legend-prefix">${escapeHtml(prefix)}</span>
              <span>${escapeHtml(region.name)}</span>
            </button>
          `;
        }).join("");

        if (layoutMode === "desktop") {
          routeBarEl.hidden = true;
          routeBarEl.replaceChildren();
          mapRouteMetaEl.innerHTML = `
            <div class="map-planner__map-info-row">
              <span class="map-planner__legend-chip map-planner__legend-chip--info">${escapeHtml(routeIds.length)} Regions</span>
              <span class="map-planner__legend-chip map-planner__legend-chip--info">${escapeHtml(slotsLeft)} Slots left</span>
            </div>
            <div class="map-planner__map-route-row">${compactRouteButtons}</div>
          `;

          mapRouteMetaEl.querySelectorAll("[data-map-route-focus]").forEach((button) => {
            button.addEventListener("click", () => {
              focusRegion(button.dataset.mapRouteFocus);
            });
          });
          return;
        }

        routeBarEl.hidden = false;
        mapRouteMetaEl.replaceChildren();
        const routeButtons = routeIds.map((regionId, index) => {
          const region = mergedRegionsById.get(regionId);
          const prefix = index === 0 ? "Start" : (index === 1 ? "Forced" : `Pick ${index - 1}`);
          return `
            <button type="button" class="${createRegionButtonClass(region, focusedRegionId, optionalRegionIds)}" data-focus-region="${escapeHtml(regionId)}">
              <span class="map-planner__chip-prefix">${escapeHtml(prefix)}</span>
              <span>${escapeHtml(region.name)}</span>
            </button>
          `;
        }).join("");

        const quickFocusButtons = sortRegionsForQuickFocus(mergedRegions).map((region) => `
          <button type="button" class="${createRegionButtonClass(region, focusedRegionId, optionalRegionIds)}" data-quick-focus="${escapeHtml(region.regionId)}">
            ${escapeHtml(region.name)}
          </button>
        `).join("");

        routeBarEl.innerHTML = `
          <article class="map-planner__panel map-planner__panel--route">
            <div class="map-planner__panel-header map-planner__panel-header--compact">
              <div>
                <p class="map-planner__eyebrow">Current Route</p>
                <h2 class="map-planner__title">Unlock path</h2>
              </div>
            </div>
            <div class="map-planner__chip-row">${routeButtons}</div>
            <div class="map-planner__quick-focus">
              <p class="map-planner__section-label">Quick focus</p>
              <div class="map-planner__chip-row map-planner__chip-row--dense">${quickFocusButtons}</div>
            </div>
          </article>
        `;

        routeBarEl.querySelectorAll("[data-focus-region]").forEach((button) => {
          button.addEventListener("click", () => {
            focusRegion(button.dataset.focusRegion);
          });
        });

        routeBarEl.querySelectorAll("[data-quick-focus]").forEach((button) => {
          button.addEventListener("click", () => {
            focusRegion(button.dataset.quickFocus);
          });
        });
      }

      function bindDetailsState(container) {
        container.querySelectorAll("[data-section-key]").forEach((detailsEl) => {
          detailsEl.addEventListener("toggle", () => {
            collapsedSections = {
              ...collapsedSections,
              [detailsEl.dataset.sectionKey]: !detailsEl.open,
            };
            schedulePersist();
          });
        });
      }

      function renderRegionPanel() {
        const region = mergedRegionsById.get(focusedRegionId) ?? null;

        if (!region) {
          regionPanelEl.innerHTML = `
            <div class="map-planner__panel-header map-planner__panel-header--compact">
              <div>
                <p class="map-planner__eyebrow">Region</p>
                <h2 class="map-planner__title">Focus a region</h2>
              </div>
            </div>
            ${renderEmptyState("Select a region from the map or quick focus row to inspect it.")}
          `;
          return;
        }

        const isSelectable = region.status === "selectable";
        const isSelected = optionalRegionIds.includes(region.regionId);
        const actionLabel = isSelectable
          ? (isSelected ? "Remove" : "Unlock")
          : getRegionStatusLabel(region.status);

        if (!region.relationship) {
          regionPanelEl.innerHTML = `
            <div class="map-planner__panel-header map-planner__panel-header--compact">
              <div>
                <p class="map-planner__eyebrow">Focused Region</p>
                <h2 class="map-planner__title">${escapeHtml(region.name)}</h2>
                <p class="map-planner__description">${escapeHtml(region.section || "Map-only region")}</p>
              </div>
              <button type="button" class="utility-button" disabled>${escapeHtml(actionLabel)}</button>
            </div>
            <div class="map-planner__status-row">
              <span class="map-planner__status-pill">${escapeHtml(getRegionStatusLabel(region.status))}</span>
            </div>
            ${renderEmptyState(region.status === "unavailable"
              ? "This region exists on the map but is intentionally unavailable in the current league rules."
              : "This region has no relationship data in the current planner file.")}
          `;
          return;
        }

        const relationship = region.relationship;
        const autoUnlocks = relationship.autoUnlocks;
        const relatedGlobalRules = leagueData.globalRules.filter((rule) => rule.relatedRegionIds.includes(region.regionId));

        regionPanelEl.innerHTML = `
          <div class="map-planner__panel-header map-planner__panel-header--compact">
            <div>
              <p class="map-planner__eyebrow">Focused Region</p>
              <h2 class="map-planner__title">${escapeHtml(region.name)}</h2>
              <p class="map-planner__description">${escapeHtml(region.section || "Region overview")}</p>
            </div>
            <button type="button" class="utility-button" data-toggle-region ${isSelectable ? "" : "disabled"}>${escapeHtml(actionLabel)}</button>
          </div>
          <div class="map-planner__status-row">
            <span class="map-planner__status-pill">${escapeHtml(getRegionStatusLabel(region.status))}</span>
            ${isSelected ? `<span class="map-planner__status-pill">Included in route</span>` : ""}
          </div>
          <div class="map-planner__count-row">
            ${renderCountPill(relationship.notableCombatActivities.length, "Combat")}
            ${renderCountPill(relationship.notableNonCombatActivities.length, "Non-combat")}
            ${renderCountPill(relationship.notableShopsServices.length, "Services")}
            ${renderCountPill(relationship.notableDrops.length, "Drops")}
          </div>
          ${renderDetailBlock({
            sectionKey: "region-combat",
            title: "Combat activities",
            summary: `${relationship.notableCombatActivities.length} entries`,
            bodyHtml: renderStringList(relationship.notableCombatActivities, "No combat activities captured for this region yet."),
            collapsedSections,
            defaultOpen: true,
          })}
          ${renderDetailBlock({
            sectionKey: "region-non-combat",
            title: "Non-combat activities",
            summary: `${relationship.notableNonCombatActivities.length} entries`,
            bodyHtml: renderStringList(relationship.notableNonCombatActivities, "No non-combat activities captured for this region yet."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-services",
            title: "Shops and services",
            summary: `${relationship.notableShopsServices.length} entries`,
            bodyHtml: renderStringList(relationship.notableShopsServices, "No notable services captured for this region yet."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-auto-unlocks",
            title: "Auto unlocks",
            summary: `${autoUnlocks.quests.length + autoUnlocks.combatAchievements.length + autoUnlocks.achievementDiaryTasks.length} key entries`,
            bodyHtml: `
              <div class="map-planner__subsection">
                <h3>Quests</h3>
                ${renderNamedList(autoUnlocks.quests, "No quest auto unlocks captured for this region.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Achievement diary tasks</h3>
                ${renderNamedList(autoUnlocks.achievementDiaryTasks, "No achievement diary task unlocks captured for this region.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Combat achievements</h3>
                ${renderNamedList(autoUnlocks.combatAchievements, "No combat achievement unlocks captured for this region.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Items</h3>
                ${renderNamedList(autoUnlocks.items, "No auto-unlocked items captured for this region.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Slayer content</h3>
                ${renderStringList(autoUnlocks.slayerContent, "No slayer content notes captured for this region.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Mechanics</h3>
                ${renderStringList(autoUnlocks.mechanics, "No extra mechanics captured for this region.")}
              </div>
            `,
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-echo-boss",
            title: "Echo boss",
            summary: relationship.echoBoss ? relationship.echoBoss.name : "None",
            bodyHtml: relationship.echoBoss
              ? `
                  <ul class="map-planner__list">
                    <li>${renderLinkedName(relationship.echoBoss.name, relationship.echoBoss.url)}</li>
                    ${relationship.echoBoss.baseBoss ? `<li>Base boss: ${renderLinkedName(relationship.echoBoss.baseBoss.name, relationship.echoBoss.baseBoss.url)}</li>` : ""}
                    ${relationship.echoBoss.additionalRequirement ? `<li>${escapeHtml(relationship.echoBoss.additionalRequirement)}</li>` : ""}
                    ${relationship.echoBoss.echoEquipmentSummary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                  </ul>
                `
              : renderEmptyState("This region does not have an echo boss entry in the current relationship data."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-global-rules",
            title: "Related global rules",
            summary: `${relatedGlobalRules.length} rules`,
            bodyHtml: renderStringList(relatedGlobalRules.map((rule) => rule.description), "No global rules are scoped to this region."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-drops",
            title: "Notable drops",
            summary: `${relationship.notableDrops.length} entries`,
            bodyHtml: renderDropList(relationship.notableDrops, "No notable drop entries are captured for this region yet."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "region-data-gaps",
            title: "Data gap notes",
            summary: `${relationship.dataGaps.length} notes`,
            bodyHtml: renderStringList(relationship.dataGaps, "No data-gap notes were recorded for this region."),
            collapsedSections,
          })}
        `;

        const toggleRegionButton = regionPanelEl.querySelector("[data-toggle-region]");
        if (toggleRegionButton && isSelectable) {
          toggleRegionButton.addEventListener("click", () => {
            optionalRegionIds = toggleOptionalRegionId(optionalRegionIds, region.regionId, activeLeague);
            schedulePersist();
            renderAll();
          });
        }

        bindDetailsState(regionPanelEl);
      }

      function renderSummaryPanel() {
        const summary = collectRegionPlanSummary({
          leagueConfig: activeLeague,
          mergedRegionsById,
          globalRules: leagueData.globalRules,
          globalAutoUnlocks: leagueData.globalAutoUnlocks,
          optionalRegionIds,
        });

        summaryPanelEl.innerHTML = `
          <div class="map-planner__panel-header map-planner__panel-header--compact">
            <div>
              <p class="map-planner__eyebrow">Combined Plan</p>
              <h2 class="map-planner__title">What this route unlocks</h2>
              <p class="map-planner__description">Union of the current starting, forced, and optional region choices.</p>
            </div>
          </div>
          <div class="map-planner__chip-row map-planner__chip-row--dense">
            ${summary.selectedRegions.map((region) => `<span class="${createRegionButtonClass(region, focusedRegionId, optionalRegionIds)}" role="presentation">${escapeHtml(region.name)}</span>`).join("")}
          </div>
          <div class="map-planner__count-row">
            ${renderCountPill(summary.totalRegions, "Regions")}
            ${renderCountPill(summary.echoBosses.length, "Echo bosses")}
            ${renderCountPill(summary.drops.length, "Drop groups")}
          </div>
          ${renderDetailBlock({
            sectionKey: "summary-echo-bosses",
            title: "Combined echo bosses",
            summary: `${summary.echoBosses.length} entries`,
            bodyHtml: summary.echoBosses.length > 0
              ? `<ul class="map-planner__list">${summary.echoBosses.map((entry) => `<li>${escapeHtml(entry.regionName)}: ${renderLinkedName(entry.echoBoss.name, entry.echoBoss.url)}</li>`).join("")}</ul>`
              : renderEmptyState("No echo boss entries are available in the current route."),
            collapsedSections,
            defaultOpen: true,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-combat",
            title: "Combined combat activities",
            summary: `${summary.combatActivities.length} entries`,
            bodyHtml: renderStringList(summary.combatActivities, "No combined combat activities were found for this route."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-non-combat",
            title: "Combined non-combat activities",
            summary: `${summary.nonCombatActivities.length} entries`,
            bodyHtml: renderStringList(summary.nonCombatActivities, "No combined non-combat activities were found for this route."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-services",
            title: "Combined services",
            summary: `${summary.services.length} entries`,
            bodyHtml: renderStringList(summary.services, "No combined services were found for this route."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-auto-unlocks",
            title: "Combined auto unlocks",
            summary: `${summary.autoUnlocks.quests.length + summary.autoUnlocks.combatAchievements.length + summary.autoUnlocks.achievementDiaryTasks.length} key entries`,
            bodyHtml: `
              <div class="map-planner__subsection">
                <h3>Quests</h3>
                ${renderNamedList(summary.autoUnlocks.quests, "No route-wide quest auto unlocks are available.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Achievement diary tasks</h3>
                ${renderNamedList(summary.autoUnlocks.achievementDiaryTasks, "No route-wide diary task unlocks are available.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Combat achievements</h3>
                ${renderNamedList(summary.autoUnlocks.combatAchievements, "No route-wide combat achievement unlocks are available.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Items</h3>
                ${renderNamedList(summary.autoUnlocks.items, "No route-wide auto-unlocked items are available.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Slayer content</h3>
                ${renderStringList(summary.autoUnlocks.slayerContent, "No route-wide slayer content notes are available.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Mechanics</h3>
                ${renderStringList(summary.autoUnlocks.mechanics, "No route-wide mechanics notes are available.")}
              </div>
            `,
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-drops",
            title: "Combined notable drops",
            summary: `${summary.drops.length} entries`,
            bodyHtml: renderDropList(summary.drops, "No combined notable drops were found for this route."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-global-rules",
            title: "Applicable global rules",
            summary: `${summary.globalRules.length} rules`,
            bodyHtml: renderStringList(summary.globalRules.map((rule) => rule.description), "No additional global rules are scoped to the current route."),
            collapsedSections,
          })}
          ${renderDetailBlock({
            sectionKey: "summary-global-baseline",
            title: "Global league baseline",
            summary: `${summary.globalAutoUnlocks.quests.length} quests`,
            bodyHtml: `
              <div class="map-planner__subsection">
                <h3>Auto-unlocked quests</h3>
                ${renderNamedList(summary.globalAutoUnlocks.quests, "No global auto-unlocked quests were captured.")}
              </div>
              <div class="map-planner__subsection">
                <h3>Starter items</h3>
                ${renderNamedList(summary.globalAutoUnlocks.starterItems, "No starter items were captured.")}
              </div>
            `,
            collapsedSections,
          })}
        `;

        bindDetailsState(summaryPanelEl);
      }

      function renderAll() {
        updateToolbar();
        renderRouteBar();
        renderRegionPanel();
        renderSummaryPanel();
        surface.setFocusedRegion(focusedRegionId);
        surface.render();
      }

      function focusRegion(regionId) {
        if (!mergedRegionsById.has(regionId)) {
          return;
        }

        focusedRegionId = regionId;
        schedulePersist();
        renderAll();
      }

      function handleRegionFocus({ region }) {
        if (!region || focusedRegionId === region.regionId) {
          return;
        }

        focusedRegionId = region.regionId;
        schedulePersist();
        renderAll();
      }

      function handleRegionActivate({ region }) {
        if (!region) {
          return;
        }

        focusedRegionId = region.regionId;

        schedulePersist();
        renderAll();
      }

      surface.update({
        getRegionProps(region) {
          return {
            className: [
              `is-${region.status}`,
              optionalRegionIds.includes(region.regionId) ? "is-selected" : "",
            ].filter(Boolean).join(" "),
            pressed: region.regionId === focusedRegionId,
            ariaLabel: `${region.name}. ${getRegionStatusLabel(region.status)}${optionalRegionIds.includes(region.regionId) ? ". Included in route." : ""}`,
          };
        },
        onRegionActivate: handleRegionActivate,
        onRegionFocus: handleRegionFocus,
      });
      surface.setRegions(mergedRegions);

      const persistWriter = createDebouncedWriter((nextPlan) => {
        const writePromise = writeLeagueRegionPlan(activeLeague.id, nextPlan);
        pendingPersistPromise = writePromise;

        void writePromise
          .then((result) => {
            if (isDisposed || pendingPersistPromise !== writePromise) {
              return;
            }

            persistenceState = result.ok ? "saved" : "error";
            updateToolbar();
          })
          .finally(() => {
            if (pendingPersistPromise === writePromise) {
              pendingPersistPromise = null;
            }
          });
      }, 180);

      const unsubscribeLayout = layoutEnv.subscribe((mode) => {
        layoutMode = mode;
        featureView.dataset.layoutMode = layoutMode;
        renderAll();
      });

      function handlePageHide() {
        flushPersist();
      }

      function handleVisibilityChange() {
        if (document.visibilityState === "hidden") {
          flushPersist();
        }
      }

      clearButton.addEventListener("click", () => {
        if (optionalRegionIds.length === 0) {
          return;
        }

        optionalRegionIds = [];
        schedulePersist();
        renderAll();
      });

      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      panelEl.replaceChildren(featureView);
      renderAll();

      return () => {
        isDisposed = true;
        flushPersist();
        unsubscribeLayout();
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        surface.destroy();
      };
    },
  };
}