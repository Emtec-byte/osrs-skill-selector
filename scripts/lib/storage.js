function cloneValue(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const LOCAL_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
export const LOCAL_STORAGE_HEADROOM_BYTES = 500 * 1024;
export const LOCAL_STORAGE_WARNING_BYTES = LOCAL_STORAGE_LIMIT_BYTES - LOCAL_STORAGE_HEADROOM_BYTES;
export const LOCAL_STORAGE_STATUS_EVENT = "osrs-skill-selector:storage-status";

function estimateStoredStringBytes(value) {
  if (typeof value !== "string") {
    return 0;
  }

  // Use UTF-16 code unit size as a conservative estimate for localStorage usage.
  return value.length * 2;
}

function emitStorageStatus(detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_STATUS_EVENT, {
    detail: {
      ...getLocalStorageUsageSummary(),
      ...detail,
    },
  }));
}

export function getLocalStorageUsageSummary() {
  const storage = getStorage();
  if (!storage) {
    return {
      supported: false,
      usedBytes: 0,
      warningBytes: LOCAL_STORAGE_WARNING_BYTES,
      limitBytes: LOCAL_STORAGE_LIMIT_BYTES,
      remainingBytes: LOCAL_STORAGE_LIMIT_BYTES,
      isNearLimit: false,
      isOverLimit: false,
    };
  }

  let usedBytes = 0;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== "string") {
      continue;
    }

    usedBytes += estimateStoredStringBytes(key);
    usedBytes += estimateStoredStringBytes(storage.getItem(key) ?? "");
  }

  return {
    supported: true,
    usedBytes,
    warningBytes: LOCAL_STORAGE_WARNING_BYTES,
    limitBytes: LOCAL_STORAGE_LIMIT_BYTES,
    remainingBytes: Math.max(LOCAL_STORAGE_LIMIT_BYTES - usedBytes, 0),
    isNearLimit: usedBytes >= LOCAL_STORAGE_WARNING_BYTES,
    isOverLimit: usedBytes >= LOCAL_STORAGE_LIMIT_BYTES,
  };
}

export function readJson(key, fallback) {
  const storage = getStorage();
  if (!storage) {
    return cloneValue(fallback);
  }

  const raw = storage.getItem(key);
  if (raw === null) {
    return cloneValue(fallback);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return cloneValue(fallback);
  }
}

export function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) {
    emitStorageStatus({ operation: "write", key, didSucceed: false, reason: "storage-unavailable" });
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
    emitStorageStatus({ operation: "write", key, didSucceed: true });
    return true;
  } catch (error) {
    emitStorageStatus({
      operation: "write",
      key,
      didSucceed: false,
      reason: error?.name ?? "write-failed",
    });
    return false;
  }
}

export function removeKey(key) {
  const storage = getStorage();
  if (!storage) {
    emitStorageStatus({ operation: "remove", key, didSucceed: false, reason: "storage-unavailable" });
    return false;
  }

  try {
    storage.removeItem(key);
    emitStorageStatus({ operation: "remove", key, didSucceed: true });
    return true;
  } catch (error) {
    emitStorageStatus({
      operation: "remove",
      key,
      didSucceed: false,
      reason: error?.name ?? "remove-failed",
    });
    return false;
  }
}

export function createDebouncedWriter(callback, delayMs = 200) {
  let timerId = null;
  let pendingArgs = null;

  function run(args) {
    if (!args) {
      return;
    }

    callback(...args);
  }

  return {
    schedule(...args) {
      pendingArgs = args;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }

      timerId = window.setTimeout(() => {
        timerId = null;
        const argsToRun = pendingArgs;
        pendingArgs = null;
        run(argsToRun);
      }, delayMs);
    },

    flush(...args) {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      const argsToRun = args.length > 0 ? args : pendingArgs;
      pendingArgs = null;
      run(argsToRun);
    },

    cancel() {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      pendingArgs = null;
    },
  };
}