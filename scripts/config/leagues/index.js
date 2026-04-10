import { DEMONIC_PACTS_LEAGUE } from "./demonic-pacts.js";

export const LEAGUE_CONFIGS = [DEMONIC_PACTS_LEAGUE];
export const DEFAULT_LEAGUE_ID = DEMONIC_PACTS_LEAGUE.id;

const LEAGUE_CONFIGS_BY_ID = new Map(LEAGUE_CONFIGS.map((league) => [league.id, league]));

export function getLeagueConfig(leagueId) {
  return LEAGUE_CONFIGS_BY_ID.get(leagueId) ?? DEMONIC_PACTS_LEAGUE;
}

export function getAllLeagueConfigs() {
  return LEAGUE_CONFIGS.slice();
}