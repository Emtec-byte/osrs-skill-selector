import { createSkillMarkerFeature } from "../features/skill-marker.js";
import { createNotesFeature } from "../features/notes.js";

function createLazyMapPlannerFeature({ activeLeague, layoutEnv }) {
  let loadedFeaturePromise = null;

  return {
    id: "map-planner",
    label: activeLeague.shortLabel || "Map",

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

export function createFeatures({ activeLeague, layoutEnv }) {
  const features = [
    createSkillMarkerFeature({ layoutEnv }),
    createNotesFeature({ layoutEnv }),
  ];

  if (activeLeague?.capabilities?.mapPlanner) {
    features.push(createLazyMapPlannerFeature({ activeLeague, layoutEnv }));
  }

  return features;
}