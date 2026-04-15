const MAP_TILES_CDN_BASE_URL = "https://emtec-byte.github.io/osrs-map-tiles";
const CACHE_VERSION_URL = `${MAP_TILES_CDN_BASE_URL}/cache-version.json`;
const BASEMAPS_URL = `${MAP_TILES_CDN_BASE_URL}/basemaps.json`;
const TILE_ROOT_URL = `${MAP_TILES_CDN_BASE_URL}/tiles/rendered`;
const ICON_ROOT_URL = `${MAP_TILES_CDN_BASE_URL}/icons`;

let cacheVersionPromise = null;
let basemapsPromise = null;

function resetPromiseOnFailure(promiseRefName, error) {
  if (promiseRefName === "cacheVersionPromise") {
    cacheVersionPromise = null;
  }

  if (promiseRefName === "basemapsPromise") {
    basemapsPromise = null;
  }

  throw error;
}

function encodeVersion(version) {
  return encodeURIComponent(String(version ?? ""));
}

export async function loadMapCacheVersion() {
  if (!cacheVersionPromise) {
    cacheVersionPromise = fetch(CACHE_VERSION_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load map cache version (${response.status}).`);
        }

        return response.json();
      })
      .then((payload) => String(payload?.version ?? "").trim())
      .then((version) => {
        if (!version) {
          throw new Error("Map cache version was empty.");
        }

        return version;
      })
      .catch((error) => resetPromiseOnFailure("cacheVersionPromise", error));
  }

  return cacheVersionPromise;
}

export async function loadBasemaps() {
  if (!basemapsPromise) {
    basemapsPromise = loadMapCacheVersion()
      .then((version) => fetch(`${BASEMAPS_URL}?v=${encodeVersion(version)}`))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load basemaps (${response.status}).`);
        }

        return response.json();
      })
      .then((basemaps) => {
        if (!Array.isArray(basemaps) || basemaps.length === 0) {
          throw new Error("Basemaps payload was empty.");
        }

        return basemaps;
      })
      .catch((error) => resetPromiseOnFailure("basemapsPromise", error));
  }

  return basemapsPromise;
}

export async function loadMapManifest() {
  const [version, basemaps] = await Promise.all([
    loadMapCacheVersion(),
    loadBasemaps(),
  ]);

  const basemapsById = new Map(basemaps.map((basemap) => [basemap.mapId, basemap]));

  return {
    version,
    basemaps,
    basemapsById,
  };
}

export function buildRenderedTileUrl({ mapId, zoom, plane, x, y, version }) {
  return `${TILE_ROOT_URL}/${mapId}/${zoom}/${plane}_${x}_${y}.png?v=${encodeVersion(version)}`;
}

export function buildMapIconUrl(iconId, version) {
  return `${ICON_ROOT_URL}/${iconId}.png?v=${encodeVersion(version)}`;
}

export function toLeafletBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2) {
    return null;
  }

  const [[minX, minY], [maxX, maxY]] = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }

  return [[minY, minX], [maxY, maxX]];
}

export function toLeafletLatLng(coords, centerOnTile = false) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const [x, y] = coords;
  if (![x, y].every(Number.isFinite)) {
    return null;
  }

  const offset = centerOnTile ? 0.5 : 0;
  return [y + offset, x + offset];
}
