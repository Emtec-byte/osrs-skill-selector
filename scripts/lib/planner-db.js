import {
  LEAGUE_REGION_PLANS_STORE_NAME,
  isAppDbSupported,
  openAppDb,
  requestToPromise,
  transactionToPromise,
} from "./app-db.js";

const DEFAULT_PLAN_ID = "default";
const PLAN_RECORD_VERSION = 1;

function createSuccessResult(payload = {}) {
  return {
    ok: true,
    error: null,
    ...payload,
  };
}

function createFailureResult(error, payload = {}) {
  return {
    ok: false,
    error,
    ...payload,
  };
}

function normalizeError(error, fallback = "unknown-error") {
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  if (typeof error?.name === "string" && error.name.trim() !== "") {
    return error.name;
  }

  if (typeof error?.message === "string" && error.message.trim() !== "") {
    return error.message;
  }

  return fallback;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sanitizeCollapsedSections(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => isNonEmptyString(key))
      .map(([key, isCollapsed]) => [key, Boolean(isCollapsed)]),
  );
}

export function createLeagueRegionPlanId(leagueId, planId = DEFAULT_PLAN_ID) {
  const safeLeagueId = isNonEmptyString(leagueId) ? leagueId.trim() : "unknown";
  const safePlanId = isNonEmptyString(planId) ? planId.trim() : DEFAULT_PLAN_ID;
  return `${safeLeagueId}:${safePlanId}`;
}

export function createEmptyLeagueRegionPlan(leagueId, planId = DEFAULT_PLAN_ID) {
  const nextLeagueId = isNonEmptyString(leagueId) ? leagueId.trim() : "";
  const nextPlanId = isNonEmptyString(planId) ? planId.trim() : DEFAULT_PLAN_ID;

  return {
    id: createLeagueRegionPlanId(nextLeagueId, nextPlanId),
    leagueId: nextLeagueId,
    planId: nextPlanId,
    focusedRegionId: null,
    optionalRegionIds: [],
    collapsedSections: {},
    updatedAt: null,
    version: PLAN_RECORD_VERSION,
  };
}

function sanitizeLeagueRegionPlan(leagueId, value, planId = DEFAULT_PLAN_ID) {
  const basePlan = createEmptyLeagueRegionPlan(leagueId, planId);

  return {
    ...basePlan,
    focusedRegionId: isNonEmptyString(value?.focusedRegionId) ? value.focusedRegionId : null,
    optionalRegionIds: Array.isArray(value?.optionalRegionIds)
      ? [...new Set(value.optionalRegionIds.filter(isNonEmptyString))]
      : [],
    collapsedSections: sanitizeCollapsedSections(value?.collapsedSections),
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
    version: Number.isFinite(value?.version) ? value.version : PLAN_RECORD_VERSION,
  };
}

export function isPlannerDbSupported() {
  return isAppDbSupported();
}

export async function readLeagueRegionPlan(leagueId, planId = DEFAULT_PLAN_ID) {
  try {
    if (!isNonEmptyString(leagueId)) {
      return createFailureResult("invalid-league-id", {
        plan: createEmptyLeagueRegionPlan("", planId),
      });
    }

    const db = await openAppDb();
    const transaction = db.transaction(LEAGUE_REGION_PLANS_STORE_NAME, "readonly");
    const transactionDone = transactionToPromise(transaction);
    const store = transaction.objectStore(LEAGUE_REGION_PLANS_STORE_NAME);
    const record = await requestToPromise(store.get(createLeagueRegionPlanId(leagueId, planId)));
    await transactionDone;

    return createSuccessResult({
      plan: record
        ? sanitizeLeagueRegionPlan(leagueId, record, planId)
        : createEmptyLeagueRegionPlan(leagueId, planId),
    });
  } catch (error) {
    return createFailureResult(normalizeError(error, "league-region-plan-read-failed"), {
      plan: createEmptyLeagueRegionPlan(leagueId, planId),
    });
  }
}

export async function writeLeagueRegionPlan(leagueId, value, planId = DEFAULT_PLAN_ID) {
  try {
    if (!isNonEmptyString(leagueId)) {
      return createFailureResult("invalid-league-id", {
        plan: createEmptyLeagueRegionPlan("", planId),
      });
    }

    const nextPlan = sanitizeLeagueRegionPlan(leagueId, {
      ...value,
      updatedAt: Date.now(),
      version: PLAN_RECORD_VERSION,
    }, planId);

    const db = await openAppDb();
    const transaction = db.transaction(LEAGUE_REGION_PLANS_STORE_NAME, "readwrite");
    const transactionDone = transactionToPromise(transaction);
    transaction.objectStore(LEAGUE_REGION_PLANS_STORE_NAME).put(nextPlan);
    await transactionDone;

    return createSuccessResult({
      plan: nextPlan,
    });
  } catch (error) {
    return createFailureResult(normalizeError(error, "league-region-plan-write-failed"), {
      plan: sanitizeLeagueRegionPlan(leagueId, value, planId),
    });
  }
}