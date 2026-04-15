const shopCatalogPromiseCache = new Map();

const WIKI_BASE_URL = "https://oldschool.runescape.wiki";
const OSRS_MAP_BASE_URL = "https://maps.runescape.wiki/osrs/";

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeQuery(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function decodeTuple(columns, tuple) {
  return Object.fromEntries(columns.map((column, index) => [column, tuple[index] ?? null]));
}

function normalizeUrl(suffix, baseUrl = WIKI_BASE_URL) {
  if (typeof suffix !== "string" || suffix.trim() === "") {
    return null;
  }

  try {
    return {
      suffix,
      href: new URL(suffix, baseUrl).href,
    };
  } catch {
    return {
      suffix,
      href: null,
    };
  }
}

function buildMapHref(coords, fallbackHref = null) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return fallbackHref;
  }

  const [x, y, mapId = 0] = coords;
  if (![x, y, mapId].every(Number.isFinite)) {
    return fallbackHref;
  }

  return `${OSRS_MAP_BASE_URL}#m=${mapId},x=${x},y=${y},z=2`;
}

export function isStockedQuantity(quantity) {
  return Number.isFinite(quantity) && quantity !== 0;
}

export function countStockedItems(stock) {
  return (Array.isArray(stock) ? stock : []).filter((entry) => isStockedQuantity(entry?.quantity)).length;
}

function createShopSignature(shop) {
  return JSON.stringify([
    shop.name,
    shop.pageUrl?.suffix ?? null,
    shop.region.id,
    shop.areaName,
    shop.locationName,
    shop.variantLabel,
    shop.stock.map((entry) => [entry.item?.name ?? null, entry.quantity]),
  ]);
}

function normalizeShopCatalog(raw, leagueConfig) {
  const itemColumns = raw?.meta?.columns?.items ?? ["name", "urlSuffix"];
  const shopColumns = raw?.meta?.columns?.shops ?? ["name", "pageSuffix", "typeIndex", "regionIndex", "areaName", "locationName", "coords", "variantLabel", "stock"];
  const regions = (Array.isArray(raw?.regions) ? raw.regions : []).map(([id, label], index) => ({
    id,
    label,
    index,
  }));
  const shopTypes = (Array.isArray(raw?.shopTypes) ? raw.shopTypes : []).map(([title, urlSuffix], index) => ({
    title,
    url: normalizeUrl(urlSuffix),
    index,
  }));
  const items = (Array.isArray(raw?.items) ? raw.items : []).map((tuple, index) => {
    const decoded = decodeTuple(itemColumns, tuple);
    return {
      index,
      name: decoded.name,
      url: normalizeUrl(decoded.urlSuffix),
    };
  });

  const shops = (Array.isArray(raw?.shops) ? raw.shops : []).map((tuple, index) => {
    const decoded = decodeTuple(shopColumns, tuple);
    const region = regions[decoded.regionIndex] ?? regions[0] ?? { id: "unknown", label: "Unknown" };
    const type = shopTypes[decoded.typeIndex] ?? { title: "Other", url: null };
    const pageUrl = normalizeUrl(decoded.pageSuffix);
    const stock = (Array.isArray(decoded.stock) ? decoded.stock : []).map(([itemIndex, quantity]) => ({
      item: items[itemIndex] ?? { name: "Unknown item", url: null },
      quantity: Number.isFinite(quantity) ? quantity : 0,
    }));

    return {
      id: `${decoded.pageSuffix ?? decoded.name ?? "shop"}:${index}`,
      name: decoded.name,
      pageUrl,
      type,
      region,
      areaName: decoded.areaName,
      locationName: decoded.locationName,
      coords: Array.isArray(decoded.coords) ? decoded.coords : null,
      mapHref: buildMapHref(decoded.coords, pageUrl?.href ?? null),
      variantLabel: decoded.variantLabel,
      stock,
      stockedItemCount: countStockedItems(stock),
      searchableText: normalizeQuery([
        decoded.name,
        decoded.variantLabel,
        decoded.areaName,
        decoded.locationName,
        region.label,
        type.title,
        ...stock.map((entry) => entry.item?.name),
      ].join(" ")),
    };
  }).filter((shop, index, allShops) => {
    const signature = createShopSignature(shop);
    return allShops.findIndex((candidate) => createShopSignature(candidate) === signature) === index;
  });

  return {
    leagueId: leagueConfig.id,
    meta: raw?.meta ?? {},
    regions,
    regionsById: new Map(regions.map((region) => [region.id, region])),
    shopTypes,
    shops,
  };
}

async function fetchShopCatalog(leagueConfig) {
  const response = await fetch(leagueConfig.data.shopCatalogJsonSrc);
  if (!response.ok) {
    throw new Error(`Unable to load shop catalog (${response.status}).`);
  }

  const raw = await response.json();
  return normalizeShopCatalog(raw, leagueConfig);
}

export async function loadShopCatalog(leagueConfig) {
  const cacheKey = `${leagueConfig.id}:${leagueConfig.data.shopCatalogJsonSrc}`;
  if (shopCatalogPromiseCache.has(cacheKey)) {
    return shopCatalogPromiseCache.get(cacheKey);
  }

  const promise = fetchShopCatalog(leagueConfig).catch((error) => {
    shopCatalogPromiseCache.delete(cacheKey);
    throw error;
  });

  shopCatalogPromiseCache.set(cacheKey, promise);
  return promise;
}