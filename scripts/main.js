import { createAppShell } from "./app/shell.js";
import { createFeatures } from "./app/feature-registry.js";
import { DEFAULT_LEAGUE_ID, getLeagueConfig } from "./config/leagues/index.js";
import { UI_ACTIVE_LEAGUE_KEY, UI_ACTIVE_TAB_KEY } from "./config/storage-keys.js";
import { bootstrapNotesStorage } from "./features/notes.js";
import { bootstrapSkillMarkerStorage } from "./features/skill-marker.js";
import { createHelpMenu } from "./lib/help-menu.js";
import { createLeagueHeaderMeta } from "./lib/league-header.js";
import { createLayoutEnvironment } from "./lib/layout-env.js";
import { createStorageAlert } from "./lib/storage-alert.js";
import { readJson, writeJson } from "./lib/storage.js";
import { createTabController } from "./lib/tabs.js";
import { registerWorldMapTabActivator } from "./lib/world-map-shared.js";

function sanitizeActiveLeagueId(value) {
  return getLeagueConfig(value?.leagueId).id;
}

async function init() {
  bootstrapSkillMarkerStorage();
  await bootstrapNotesStorage();

  const shell = createAppShell(document);
  const layoutEnv = createLayoutEnvironment();
  const activeLeagueId = sanitizeActiveLeagueId(readJson(UI_ACTIVE_LEAGUE_KEY, { leagueId: DEFAULT_LEAGUE_ID }));
  const activeLeague = getLeagueConfig(activeLeagueId);

  shell.appShellEl.dataset.layoutMode = layoutEnv.getMode();
  layoutEnv.subscribe((mode) => {
    shell.appShellEl.dataset.layoutMode = mode;
  });

  writeJson(UI_ACTIVE_LEAGUE_KEY, { leagueId: activeLeague.id });

  createLeagueHeaderMeta({
    mountEl: shell.headerMetaEl,
    leagueConfig: activeLeague,
  });
  createHelpMenu({ mountEl: shell.headerActionsEl });
  createStorageAlert();
  const features = createFeatures({ activeLeague, layoutEnv });
  const lastTabState = readJson(UI_ACTIVE_TAB_KEY, { activeTab: features[0]?.id ?? null });

  const controller = createTabController({
    ...shell,
    features,
    initialTabId: lastTabState.activeTab,
    storageKey: UI_ACTIVE_TAB_KEY,
  });

  registerWorldMapTabActivator((tabId) => controller.activateTab(tabId));

  await controller.init();
}

void init();