export const DB_NAME = "osrs-skill-selector";
export const DB_VERSION = 2;
export const NOTES_STORE_NAME = "notes";
export const LEAGUE_REGION_PLANS_STORE_NAME = "league-region-plans";

let openDbPromise = null;

function ensureNotesStore(db) {
  if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
    db.createObjectStore(NOTES_STORE_NAME, { keyPath: "skillId" });
  }
}

function ensureLeagueRegionPlansStore(db, transaction) {
  let store = null;

  if (!db.objectStoreNames.contains(LEAGUE_REGION_PLANS_STORE_NAME)) {
    store = db.createObjectStore(LEAGUE_REGION_PLANS_STORE_NAME, { keyPath: "id" });
  } else if (transaction) {
    store = transaction.objectStore(LEAGUE_REGION_PLANS_STORE_NAME);
  }

  if (!store) {
    return;
  }

  if (!store.indexNames.contains("leagueId")) {
    store.createIndex("leagueId", "leagueId", { unique: false });
  }

  if (!store.indexNames.contains("updatedAt")) {
    store.createIndex("updatedAt", "updatedAt", { unique: false });
  }
}

export function isAppDbSupported() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("request-failed"));
    };
  });
}

export function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("transaction-failed"));
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error("transaction-aborted"));
    };
  });
}

export function openAppDb() {
  if (!isAppDbSupported()) {
    return Promise.reject(new Error("indexeddb-unavailable"));
  }

  if (openDbPromise) {
    return openDbPromise;
  }

  openDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;

      ensureNotesStore(db);
      ensureLeagueRegionPlansStore(db, transaction);

      if ((event.oldVersion ?? 0) < 1) {
        ensureNotesStore(db);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("database-open-failed"));
    };

    request.onblocked = () => {
      reject(new Error("database-open-blocked"));
    };
  }).catch((error) => {
    openDbPromise = null;
    throw error;
  });

  return openDbPromise;
}