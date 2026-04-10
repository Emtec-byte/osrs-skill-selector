const svgMarkupPromiseCache = new Map();

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseBounds(bounds) {
  if (typeof bounds !== "string" || bounds.trim() === "") {
    return null;
  }

  const parts = bounds.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    minX: parts[0],
    minY: parts[1],
    maxX: parts[2],
    maxY: parts[3],
    area: Math.max(1, (parts[2] - parts[0]) * (parts[3] - parts[1])),
  };
}

function parseCentroid(centroid) {
  if (typeof centroid !== "string" || centroid.trim() === "") {
    return null;
  }

  const parts = centroid.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    x: parts[0],
    y: parts[1],
  };
}

async function loadSvgMarkup(svgSrc) {
  if (svgMarkupPromiseCache.has(svgSrc)) {
    return svgMarkupPromiseCache.get(svgSrc);
  }

  const promise = fetch(svgSrc)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load map asset (${response.status}).`);
      }

      return response.text();
    })
    .catch((error) => {
      svgMarkupPromiseCache.delete(svgSrc);
      throw error;
    });

  svgMarkupPromiseCache.set(svgSrc, promise);
  return promise;
}

function cloneSvgElement(markup) {
  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(markup, "image/svg+xml");
  const svgRoot = parsedDocument.documentElement;

  if (!svgRoot || svgRoot.nodeName.toLowerCase() !== "svg") {
    throw new Error("Map asset did not contain a valid SVG root.");
  }

  [...svgRoot.children].forEach((child) => {
    const tagName = child.tagName?.toLowerCase();
    if (tagName === "title" || tagName === "desc") {
      child.remove();
    }
  });

  svgRoot.removeAttribute("aria-labelledby");
  svgRoot.setAttribute("aria-label", "Interactive region map");

  return document.importNode(svgRoot, true);
}

export function createSvgRegionMap({
  svgSrc,
  regionIdMap = {},
  getRegionProps = () => ({}),
  onRegionActivate = () => {},
  onRegionFocus = () => {},
}) {
  const state = {
    svgRoot: null,
    regions: [],
    regionById: new Map(),
    groupById: new Map(),
    focusedRegionId: null,
    getRegionProps,
    onRegionActivate,
    onRegionFocus,
  };

  const element = document.createElement("section");
  element.className = "svg-region-map";
  element.innerHTML = `
    <div class="svg-region-map__frame">
      <div class="svg-region-map__host"></div>
    </div>
  `;

  const hostEl = element.querySelector(".svg-region-map__host");

  function getResolvedRegionId(group) {
    const svgSlug = group.id.replace(/^region-/, "");
    return regionIdMap[svgSlug] || svgSlug;
  }

  function discoverRegions() {
    state.groupById.clear();

    const groups = [...state.svgRoot.querySelectorAll("#regions > .region")];
    const regions = groups.map((group) => {
      const regionId = getResolvedRegionId(group);
      const record = {
        svgId: group.id,
        regionId,
        svgSlug: group.id.replace(/^region-/, ""),
        svgName: sanitizeString(group.dataset.regionName, regionId),
        bounds: parseBounds(group.dataset.bounds),
        centroid: parseCentroid(group.dataset.centroid),
        topImage: sanitizeString(group.dataset.topImage, null),
        section: sanitizeString(group.dataset.section, ""),
        opaquePixels: Number(group.dataset.opaquePixels || 0),
        hitPath: group.querySelector(".region-hit-area"),
      };

      group.dataset.appRegionId = regionId;
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", record.svgName);
      state.groupById.set(regionId, group);
      return record;
    });

    state.regions = regions;
    state.regionById = new Map(regions.map((region) => [region.regionId, region]));
  }

  function applyRegionProps(region) {
    const group = state.groupById.get(region.regionId);
    if (!group) {
      return;
    }

    const regionProps = state.getRegionProps(region) ?? {};
    const classNames = ["region"];
    if (regionProps.className) {
      classNames.push(...String(regionProps.className).split(/\s+/).filter(Boolean));
    }

    group.className.baseVal = classNames.join(" ");
    group.dataset.active = String(region.regionId === state.focusedRegionId);
    group.setAttribute("aria-label", regionProps.ariaLabel || region.name || region.svgName);
    group.setAttribute("aria-pressed", String(Boolean(regionProps.pressed)));
  }

  function render() {
    state.regions.forEach((region) => {
      applyRegionProps(region);
    });
  }

  function emitFocus(region, event) {
    state.focusedRegionId = region.regionId;
    state.onRegionFocus?.({ region, event });
    render();
  }

  function resolveRegionAtPoint(clientX, clientY) {
    if (!state.svgRoot) {
      return null;
    }

    const svgPoint = state.svgRoot.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;

    const inverseMatrix = state.svgRoot.getScreenCTM()?.inverse();
    if (!inverseMatrix) {
      return null;
    }

    const point = svgPoint.matrixTransform(inverseMatrix);
    const candidates = [];

    state.regions.forEach((region) => {
      if (!region.hitPath || typeof region.hitPath.isPointInFill !== "function") {
        return;
      }

      if (!region.hitPath.isPointInFill(point)) {
        return;
      }

      const centroid = region.centroid || point;
      const dx = centroid.x - point.x;
      const dy = centroid.y - point.y;

      candidates.push({
        region,
        score: [
          region.opaquePixels || Number.MAX_SAFE_INTEGER,
          region.bounds?.area || Number.MAX_SAFE_INTEGER,
          Math.sqrt((dx * dx) + (dy * dy)),
        ],
      });
    });

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        const difference = left.score[index] - right.score[index];
        if (difference !== 0) {
          return difference;
        }
      }

      return 0;
    });

    return candidates[0].region;
  }

  function handleSvgClick(event) {
    const region = resolveRegionAtPoint(event.clientX, event.clientY);
    if (!region) {
      return;
    }

    emitFocus(region, event);
    state.onRegionActivate?.({ region, event });
  }

  function handleRegionKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const regionId = event.currentTarget.dataset.appRegionId;
    const region = state.regionById.get(regionId);
    if (!region) {
      return;
    }

    event.preventDefault();
    emitFocus(region, event);
    state.onRegionActivate?.({ region, event });
  }

  function handleRegionFocus(event) {
    const regionId = event.currentTarget.dataset.appRegionId;
    const region = state.regionById.get(regionId);
    if (!region) {
      return;
    }

    emitFocus(region, event);
  }

  async function load() {
    const markup = await loadSvgMarkup(svgSrc);
    const svgRoot = cloneSvgElement(markup);

    if (state.svgRoot) {
      state.svgRoot.removeEventListener("click", handleSvgClick);
    }

    hostEl.replaceChildren(svgRoot);
    state.svgRoot = svgRoot;
    state.svgRoot.addEventListener("click", handleSvgClick);

    discoverRegions();
    state.groupById.forEach((group) => {
      group.addEventListener("keydown", handleRegionKeyDown);
      group.addEventListener("focus", handleRegionFocus);
    });
    render();

    return state.regions.slice();
  }

  return {
    element,
    async load() {
      return load();
    },
    getRegions() {
      return state.regions.slice();
    },
    setRegions(regions) {
      state.regions = Array.isArray(regions) ? regions.slice() : [];
      state.regionById = new Map(state.regions.map((region) => [region.regionId, region]));
      render();
    },
    setFocusedRegion(regionId) {
      state.focusedRegionId = regionId;
      render();
    },
    update({ getRegionProps: nextGetRegionProps, onRegionActivate: nextOnRegionActivate, onRegionFocus: nextOnRegionFocus } = {}) {
      if (typeof nextGetRegionProps === "function") {
        state.getRegionProps = nextGetRegionProps;
      }

      if (typeof nextOnRegionActivate === "function") {
        state.onRegionActivate = nextOnRegionActivate;
      }

      if (typeof nextOnRegionFocus === "function") {
        state.onRegionFocus = nextOnRegionFocus;
      }

      render();
    },
    render,
    destroy() {
      if (state.svgRoot) {
        state.svgRoot.removeEventListener("click", handleSvgClick);
      }

      state.groupById.forEach((group) => {
        group.removeEventListener("keydown", handleRegionKeyDown);
        group.removeEventListener("focus", handleRegionFocus);
      });

      state.groupById.clear();
      state.regionById.clear();
      hostEl.replaceChildren();
    },
  };
}