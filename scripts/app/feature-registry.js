import { createSkillMarkerFeature } from "../features/skill-marker.js";
import { createNotesFeature } from "../features/notes.js";

export function createFeatures() {
  return [
    createSkillMarkerFeature(),
    createNotesFeature(),
  ];
}