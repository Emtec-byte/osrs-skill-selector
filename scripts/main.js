import { createAppShell } from "./app/shell.js";
import { createFeatures } from "./app/feature-registry.js";
import { UI_ACTIVE_TAB_KEY } from "./config/storage-keys.js";
import { bootstrapNotesStorage } from "./features/notes.js";
import { bootstrapSkillMarkerStorage } from "./features/skill-marker.js";
import { createHelpMenu } from "./lib/help-menu.js";
import { createStorageAlert } from "./lib/storage-alert.js";
import { readJson } from "./lib/storage.js";
import { createTabController } from "./lib/tabs.js";

bootstrapSkillMarkerStorage();
bootstrapNotesStorage();

const shell = createAppShell(document);
createHelpMenu({ mountEl: shell.headerActionsEl });
createStorageAlert();
const features = createFeatures();
const lastTabState = readJson(UI_ACTIVE_TAB_KEY, { activeTab: features[0]?.id ?? null });

const controller = createTabController({
  ...shell,
  features,
  initialTabId: lastTabState.activeTab,
  storageKey: UI_ACTIVE_TAB_KEY,
});

controller.init();