import {
  buildRenderedTileUrl,
  loadMapManifest,
  toLeafletBounds,
  toLeafletLatLng,
} from "./map-tiles.js";

const WORLD_MAP_TAB_ID = "world-map";
const SURFACE_MAP_ID = -1;
const LEGACY_SURFACE_MAP_ID = 0;
const DEFAULT_PLANE = 0;
const MIN_ZOOM = -1;
const MAX_ZOOM = 8;
const MAX_NATIVE_ZOOM = 3;
const DEFAULT_SURFACE_CENTER = [3222, 3218];
const DEFAULT_OVERVIEW_ZOOM = 2;
const DEFAULT_FOCUS_ZOOM = 2;
const EMPTY_TILE_DATA_URI = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#050607"/></svg>')}`;
const fallbackMapPinUrl = new URL("../../assets/icons/map-pin-precise.svg", import.meta.url).href;

const SHOP_TYPE_ICON_IDS = new Map([
  ["Amulet shops", 1455],
  ["Archery shops", 1465],
  ["Axe shops", 1451],
  ["Bars, pubs, and inns", 1479],
  ["Candle shops", 1472],
  ["Chainbody shops", 1493],
  ["Clothes shops", 1475],
  ["Cooking shops", 1485],
  ["Crafting shops", 1471],
  ["Crossbow shops", 1465],
  ["Dye shops", 1471],
  ["Farming shops", 1506],
  ["Fishing shops", 1473],
  ["Food shops", 1484],
  ["Fur traders", 1495],
  ["Gem shops", 1470],
  ["General store", 1448],
  ["Helmet shops", 1452],
  ["Herblore shops", 1468],
  ["Hunter shops", 1513],
  ["Jewellery shops", 1469],
  ["Kebab seller", 1478],
  ["Mace shops", 1480],
  ["Magic shops", 1450],
  ["Mining shops", 1492],
  ["Platebody shops", 1462],
  ["Platelegs shops", 1463],
  ["Plateskirt shops", 1489],
  ["Scimitar shops", 1464],
  ["Shield shops", 1466],
  ["Silk shops", 1477],
  ["Silver shops", 1494],
  ["Spice shops", 1496],
  ["Staff shops", 1461],
  ["Sword shops", 1449],
  ["Vegetable shops", 1484],
  ["Wine traders", 1479],
  ["Multicannon parts shop", 1448],
  ["Slayer equipment shop", 1499],
  ["Reward shop", 1448],
  ["Yak produce shop", 1484],
  ["Other", 1448],
  ["Makeover/clothes shop", 1475],
  ["Drinks shop", 1479],
  ["Not a valid shop", 1448],
]);

let sharedMapSessionPromise = null;
let worldMapTabActivator = null;
let activeWorldMapApi = null;
let pendingWorldMapNavigation = null;
let didRegisterPagehideCleanup = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeCoords(coords) {
  if (coords && typeof coords === "object" && !Array.isArray(coords)) {
    const { x, y, mapId = SURFACE_MAP_ID, plane = DEFAULT_PLANE } = coords;
    if (![x, y, mapId, plane].every(Number.isFinite)) {
      return null;
    }

    return {
      x,
      y,
      mapId,
      plane,
      tuple: [x, y],
    };
  }

  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const [x, y, mapId = SURFACE_MAP_ID, plane = DEFAULT_PLANE] = coords;
  if (![x, y, mapId, plane].every(Number.isFinite)) {
    return null;
  }

  return {
    x,
    y,
    mapId,
    plane,
    tuple: [x, y],
  };
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  if (typeof point.id !== "string" || point.id.trim() === "") {
    return null;
  }

  const coords = normalizeCoords(point.coords);
  if (!coords) {
    return null;
  }

  return {
    id: point.id,
    title: typeof point.title === "string" ? point.title : "Unknown point",
    subtitle: typeof point.subtitle === "string" ? point.subtitle : "",
    label: typeof point.label === "string" && point.label.trim() !== "" ? point.label : (typeof point.title === "string" ? point.title : "Unknown point"),
    groupId: typeof point.groupId === "string" && point.groupId.trim() !== "" ? point.groupId : "unknown",
    groupLabel: typeof point.groupLabel === "string" && point.groupLabel.trim() !== "" ? point.groupLabel : "Unknown",
    iconId: Number.isFinite(point.iconId) ? point.iconId : null,
    coords,
  };
}

function getLeafletGlobal() {
  const leaflet = globalThis.L;
  if (!leaflet) {
    throw new Error("Leaflet failed to load.");
  }

  return leaflet;
}

function createSharedTileLayerClass(L) {
  if (L.TileLayer.OsrsSkillSelector) {
    return L.TileLayer.OsrsSkillSelector;
  }

  L.TileLayer.OsrsSkillSelector = L.TileLayer.extend({
    getTileUrl(coords) {
      const flippedY = -(1 + coords.y);
      return buildRenderedTileUrl({
        mapId: this.options.mapId,
        zoom: coords.z,
        plane: this.options.plane,
        x: coords.x,
        y: flippedY,
        version: this.options.cacheVersion,
      });
    },
  });

  return L.TileLayer.OsrsSkillSelector;
}

function createMarkerIcon(L, point, iconUrl, showLabel) {
  const labelHtml = showLabel
    ? `<span class="shared-world-map__marker-label">${escapeHtml(point.label)}</span>`
    : "";

  return L.divIcon({
    className: "shared-world-map__marker",
    html: `
      <div class="shared-world-map__marker-shell${showLabel ? " has-label" : ""}">
        <img class="shared-world-map__marker-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">
        ${labelHtml}
      </div>
    `,
    iconSize: [18, 24],
    iconAnchor: [9, 24],
  });
}

function clampPlane(value) {
  return Math.min(3, Math.max(0, Number.isFinite(value) ? value : DEFAULT_PLANE));
}

function clampZoom(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_OVERVIEW_ZOOM;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function buildScenePointGroups(points) {
  const groups = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    if (!point?.coords) {
      continue;
    }

    const key = `${point.coords.mapId}:${point.coords.plane}`;
    const group = groups.get(key) ?? {
      key,
      mapId: point.coords.mapId,
      plane: point.coords.plane,
      points: [],
    };
    group.points.push(point);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function choosePrimaryPointGroup(groups, currentMapId, currentPlane) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }

  const preferred = groups.find((group) => group.mapId === currentMapId && group.plane === currentPlane);
  if (preferred) {
    return preferred;
  }

  return [...groups].sort((left, right) => {
    if (left.points.length !== right.points.length) {
      return right.points.length - left.points.length;
    }

    if (left.mapId !== right.mapId) {
      if (left.mapId === SURFACE_MAP_ID) {
        return -1;
      }

      if (right.mapId === SURFACE_MAP_ID) {
        return 1;
      }

      return left.mapId - right.mapId;
    }

    return left.plane - right.plane;
  })[0];
}

function containsCoords(bounds, coords) {
  if (!Array.isArray(bounds) || bounds.length < 2 || !coords) {
    return false;
  }

  const [[minX, minY], [maxX, maxY]] = bounds;
  return coords.x >= minX && coords.x <= maxX && coords.y >= minY && coords.y <= maxY;
}

function getBasemapArea(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const [[minX, minY], [maxX, maxY]] = bounds;
  return Math.abs(maxX - minX) * Math.abs(maxY - minY);
}

function resolvePointBasemapId(point, manifest) {
  if (!point?.coords || !manifest?.basemaps) {
    return point?.coords?.mapId ?? SURFACE_MAP_ID;
  }

  const candidates = manifest.basemaps.filter((basemap) => containsCoords(basemap.bounds, point.coords));
  if (candidates.length === 0) {
    return point.coords.mapId;
  }

  const exactCandidate = candidates.find((candidate) => candidate.mapId === point.coords.mapId && candidate.mapId !== LEGACY_SURFACE_MAP_ID);
  if (exactCandidate) {
    return exactCandidate.mapId;
  }

  const specificCandidates = candidates.filter((candidate) => candidate.mapId > 0);
  if (specificCandidates.length > 0) {
    return [...specificCandidates].sort((left, right) => getBasemapArea(left.bounds) - getBasemapArea(right.bounds))[0].mapId;
  }

  const preferredSurface = candidates.find((candidate) => candidate.mapId === SURFACE_MAP_ID);
  if (preferredSurface) {
    return preferredSurface.mapId;
  }

  return candidates.find((candidate) => candidate.mapId === LEGACY_SURFACE_MAP_ID)?.mapId ?? candidates[0].mapId;
}

export function resolveWorldMapPoints(points, manifest) {
  return (Array.isArray(points) ? points : []).map((point) => {
    if (!point?.coords) {
      return point;
    }

    const resolvedMapId = resolvePointBasemapId(point, manifest);
    return {
      ...point,
      coords: {
        ...point.coords,
        mapId: resolvedMapId,
      },
    };
  });
}

async function createSharedMapSession() {
  const L = getLeafletGlobal();
  const manifest = await loadMapManifest();
  const basemapById = manifest.basemapsById;
  const defaultBasemap = basemapById.get(SURFACE_MAP_ID) ?? manifest.basemaps[0];
  if (!defaultBasemap) {
    throw new Error("No basemaps were available.");
  }

  const SharedTileLayer = createSharedTileLayerClass(L);
  const rootEl = document.createElement("div");
  rootEl.className = "shared-world-map";
  rootEl.innerHTML = `
    <div class="shared-world-map__canvas"></div>
    <div class="shared-world-map__zoom-meta" aria-live="polite"></div>
  `;

  const canvasEl = rootEl.querySelector(".shared-world-map__canvas");
  const zoomMetaEl = rootEl.querySelector(".shared-world-map__zoom-meta");
  const map = L.map(canvasEl, {
    crs: L.CRS.Simple,
    center: toLeafletLatLng(DEFAULT_SURFACE_CENTER, false),
    zoom: DEFAULT_OVERVIEW_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomSnap: 1,
    zoomDelta: 1,
    attributionControl: false,
    zoomControl: false,
    doubleClickZoom: false,
    maxBoundsViscosity: 0.5,
  });

  L.control.zoom({ position: "topright" }).addTo(map);

  const tileLayer = new SharedTileLayer("", {
    mapId: defaultBasemap.mapId,
    plane: DEFAULT_PLANE,
    cacheVersion: manifest.version,
    minNativeZoom: MIN_ZOOM,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    tileSize: 256,
    noWrap: true,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1,
    crossOrigin: true,
    errorTileUrl: EMPTY_TILE_DATA_URI,
  }).addTo(map);

  tileLayer.on("tileerror", (event) => {
    event.tile.src = EMPTY_TILE_DATA_URI;
  });

  const markerLayer = L.layerGroup().addTo(map);

  const state = {
    attachedHost: null,
    currentMapId: defaultBasemap.mapId,
    currentPlane: DEFAULT_PLANE,
    currentPointIds: "",
    viewChangeListener: null,
  };
  zoomMetaEl.textContent = `Layer ${state.currentPlane} | Zoom ${map.getZoom()}`;

  function getBasemap(mapId) {
    return basemapById.get(mapId) ?? defaultBasemap;
  }

  function notifyViewChange() {
    zoomMetaEl.textContent = `Layer ${state.currentPlane} | Zoom ${map.getZoom()}`;

    if (typeof state.viewChangeListener !== "function") {
      return;
    }

    const center = map.getCenter();
    state.viewChangeListener({
      mapId: state.currentMapId,
      plane: state.currentPlane,
      center: [Number(center.lng.toFixed(2)), Number(center.lat.toFixed(2))],
      zoom: map.getZoom(),
    });
  }

  function setBasemap(mapId, plane = state.currentPlane) {
    const basemap = getBasemap(mapId);
    const nextPlane = clampPlane(plane);
    const nextBounds = toLeafletBounds(basemap.bounds);

    state.currentMapId = basemap.mapId;
    state.currentPlane = nextPlane;
    tileLayer.options.mapId = basemap.mapId;
    tileLayer.options.plane = nextPlane;
    tileLayer.redraw();

    if (nextBounds) {
      map.setMaxBounds(nextBounds);
    }

    return basemap;
  }

  function clearMarkers() {
    markerLayer.clearLayers();
    state.currentPointIds = "";
  }

  function setMarkers(points) {
    clearMarkers();
    const normalizedPoints = (Array.isArray(points) ? points : []).map((point) => normalizePoint(point)).filter(Boolean);
    const showLabel = normalizedPoints.length > 0 && normalizedPoints.length <= 3;

    for (const point of normalizedPoints) {
      const latLng = toLeafletLatLng([point.coords.x, point.coords.y], true);
      L.marker(latLng, {
        icon: createMarkerIcon(L, point, fallbackMapPinUrl, showLabel),
        keyboard: false,
        interactive: false,
      }).addTo(markerLayer);
    }

    state.currentPointIds = normalizedPoints.map((point) => point.id).join("|");
    return normalizedPoints;
  }

  function fitToPoints(points, { singlePointZoom = DEFAULT_FOCUS_ZOOM, padding = [24, 24] } = {}) {
    const normalizedPoints = setMarkers(points);
    if (normalizedPoints.length === 0) {
      return;
    }

    if (normalizedPoints.length === 1) {
      map.setView(toLeafletLatLng([normalizedPoints[0].coords.x, normalizedPoints[0].coords.y], true), clampZoom(singlePointZoom), {
        animate: false,
      });
      return;
    }

    const latLngs = normalizedPoints.map((point) => toLeafletLatLng([point.coords.x, point.coords.y], true));
    map.fitBounds(latLngs, {
      animate: false,
      padding,
      maxZoom: clampZoom(singlePointZoom),
    });
  }

  function setView({ mapId = state.currentMapId, plane = state.currentPlane, center = null, zoom = null, points = null, fitPoints = false, singlePointZoom = DEFAULT_FOCUS_ZOOM, clearPoints: shouldClearPoints = true, centerOnTile = false } = {}) {
    const basemap = setBasemap(mapId, plane);

    if (Array.isArray(points)) {
      if (fitPoints) {
        fitToPoints(points, { singlePointZoom });
      } else {
        setMarkers(points);
      }
    } else if (shouldClearPoints) {
      clearMarkers();
    }

    if (fitPoints && Array.isArray(points) && points.length > 0) {
      notifyViewChange();
      return basemap;
    }

    if (center == null && zoom == null) {
      if (basemap.mapId === SURFACE_MAP_ID) {
        map.setView(toLeafletLatLng(DEFAULT_SURFACE_CENTER, false), DEFAULT_OVERVIEW_ZOOM, { animate: false });
        notifyViewChange();
        return basemap;
      }

      const nextBounds = toLeafletBounds(basemap.bounds);
      if (nextBounds) {
        map.fitBounds(nextBounds, {
          animate: false,
          padding: [24, 24],
          maxZoom: 0,
        });
        notifyViewChange();
        return basemap;
      }
    }

    const nextCenter = Array.isArray(center) && center.length >= 2 ? toLeafletLatLng(center, centerOnTile) : toLeafletLatLng(basemap.center, false);
    const nextZoom = zoom == null ? map.getZoom() : clampZoom(zoom);
    map.setView(nextCenter, nextZoom, { animate: false });
    notifyViewChange();
    return basemap;
  }

  map.on("moveend zoomend", notifyViewChange);

  if (!didRegisterPagehideCleanup) {
    didRegisterPagehideCleanup = true;
    window.addEventListener("pagehide", () => {
      if (!sharedMapSessionPromise) {
        return;
      }

      sharedMapSessionPromise.then((session) => session.destroy()).catch(() => {});
      sharedMapSessionPromise = null;
    });
  }

  return {
    manifest,
    map,
    attach(hostEl) {
      if (state.attachedHost === hostEl) {
        window.requestAnimationFrame(() => map.invalidateSize(false));
        return;
      }

      hostEl.replaceChildren(rootEl);
      state.attachedHost = hostEl;
      window.requestAnimationFrame(() => map.invalidateSize(false));
    },
    detach() {
      if (rootEl.parentNode) {
        rootEl.parentNode.removeChild(rootEl);
      }
      state.attachedHost = null;
      state.viewChangeListener = null;
    },
    setView,
    clearMarkers,
    setViewChangeListener(listener) {
      state.viewChangeListener = typeof listener === "function" ? listener : null;
    },
    getViewState() {
      const center = map.getCenter();
      return {
        mapId: state.currentMapId,
        plane: state.currentPlane,
        center: [Number(center.lng.toFixed(2)), Number(center.lat.toFixed(2))],
        zoom: map.getZoom(),
      };
    },
    destroy() {
      clearMarkers();
      map.off("moveend zoomend", notifyViewChange);
      map.remove();
      if (rootEl.parentNode) {
        rootEl.parentNode.removeChild(rootEl);
      }
    },
  };
}

export function getShopTypeIconId(typeTitle) {
  return SHOP_TYPE_ICON_IDS.get(typeTitle) ?? null;
}

export function buildWorldMapPoints(entries, {
  getId,
  getTitle,
  getSubtitle,
  getGroupId,
  getGroupLabel,
  getLabel,
  getCoords,
  getIconId,
} = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizePoint({
      id: getId(entry),
      title: getTitle(entry),
      subtitle: getSubtitle(entry),
      groupId: getGroupId(entry),
      groupLabel: getGroupLabel(entry),
      label: getLabel(entry),
      coords: getCoords(entry),
      iconId: getIconId ? getIconId(entry) : null,
    }))
    .filter(Boolean);
}

export function groupWorldMapPoints(points, currentMapId, currentPlane) {
  return choosePrimaryPointGroup(buildScenePointGroups(points), currentMapId, currentPlane);
}

export async function getSharedWorldMapSession() {
  if (!sharedMapSessionPromise) {
    sharedMapSessionPromise = createSharedMapSession().catch((error) => {
      sharedMapSessionPromise = null;
      throw error;
    });
  }

  return sharedMapSessionPromise;
}

export function registerWorldMapTabActivator(activateTab) {
  worldMapTabActivator = typeof activateTab === "function" ? activateTab : null;
}

export function registerWorldMapFeatureApi(api) {
  activeWorldMapApi = api ?? null;
  if (pendingWorldMapNavigation && activeWorldMapApi?.focusLocation) {
    const pendingLocation = pendingWorldMapNavigation;
    pendingWorldMapNavigation = null;
    void activeWorldMapApi.focusLocation(pendingLocation);
  }

  return () => {
    if (activeWorldMapApi === api) {
      activeWorldMapApi = null;
    }
  };
}

export async function navigateToMapLocation(location) {
  if (activeWorldMapApi?.focusLocation) {
    await activeWorldMapApi.focusLocation(location);
    return;
  }

  pendingWorldMapNavigation = location;
  if (worldMapTabActivator) {
    await worldMapTabActivator(WORLD_MAP_TAB_ID);
  }
}