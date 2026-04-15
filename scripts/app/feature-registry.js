import { createSkillMarkerFeature } from "../features/skill-marker.js";
import { createNotesFeature } from "../features/notes.js";

function createLazyMapPlannerFeature({ activeLeague, layoutEnv }) {
  let loadedFeaturePromise = null;

  return {
    id: "map-planner",
    label: activeLeague.shortLabel || "Areas",

    async mount(context) {
      if (!loadedFeaturePromise) {
        loadedFeaturePromise = import("../features/map-planner.js")
          .then(({ createMapPlannerFeature }) => createMapPlannerFeature({ activeLeague, layoutEnv }));
      }

      const feature = await loadedFeaturePromise;
      return feature.mount(context);
    },
  };
}

function createLazyShopsFeature({ activeLeague, layoutEnv }) {
  let loadedFeaturePromise = null;

  return {
    id: "shops",
    label: "Shops",

    async mount(context) {
      if (!loadedFeaturePromise) {
        loadedFeaturePromise = import("../features/shops.js")
          .then(({ createShopsFeature }) => createShopsFeature({ activeLeague, layoutEnv }));
      }

      const feature = await loadedFeaturePromise;
      return feature.mount(context);
    },
  };
}

function createLazyWorldMapFeature({ activeLeague, layoutEnv }) {
  let loadedFeaturePromise = null;

  return {
    id: "world-map",
    label: "World Map",

    async mount(context) {
      if (!loadedFeaturePromise) {
        loadedFeaturePromise = import("../features/world-map.js")
          .then(({ createWorldMapFeature }) => createWorldMapFeature({ activeLeague, layoutEnv }));
      }

      const feature = await loadedFeaturePromise;
      return feature.mount(context);
    },
  };
}

export function createFeatures({ activeLeague, layoutEnv }) {
  const features = [
    createSkillMarkerFeature({ layoutEnv }),
    createNotesFeature({ layoutEnv }),
  ];

  if (activeLeague?.capabilities?.mapPlanner) {
    features.push(createLazyMapPlannerFeature({ activeLeague, layoutEnv }));
  }

  if (activeLeague?.capabilities?.worldMap && activeLeague?.data?.shopCatalogJsonSrc) {
    features.push(createLazyWorldMapFeature({ activeLeague, layoutEnv }));
  }

  if (activeLeague?.capabilities?.shopsBrowser && activeLeague?.data?.shopCatalogJsonSrc) {
    features.push(createLazyShopsFeature({ activeLeague, layoutEnv }));
  }

  return features;
}