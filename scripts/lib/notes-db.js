import {
  NOTES_STORE_NAME,
  isAppDbSupported,
  openAppDb,
  requestToPromise,
  transactionToPromise,
} from "./app-db.js";

const MAX_HISTORY_ENTRIES = 20;

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

function isNonEmptySkillId(skillId) {
  return typeof skillId === "string" && skillId.trim() !== "";
}

function createEmptyNoteRecord(skillId = "") {
  return {
    skillId,
    text: "",
    updatedAt: null,
    history: [],
  };
}

function sanitizeHistoryEntry(entry) {
  return {
    text: typeof entry?.text === "string" ? entry.text : "",
    updatedAt: Number.isFinite(entry?.updatedAt) ? entry.updatedAt : null,
  };
}

function sanitizeHistoryEntries(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map(sanitizeHistoryEntry)
    .filter((entry) => entry.text !== "" || Number.isFinite(entry.updatedAt))
    .slice(0, MAX_HISTORY_ENTRIES);
}

function sanitizeNoteRecord(skillId, value) {
  const normalizedSkillId = isNonEmptySkillId(skillId)
    ? skillId
    : (isNonEmptySkillId(value?.skillId) ? value.skillId : "");

  return {
    skillId: normalizedSkillId,
    text: typeof value?.text === "string" ? value.text : "",
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
    history: sanitizeHistoryEntries(value?.history),
  };
}

function createHistorySnapshot(record) {
  return {
    text: record.text,
    updatedAt: record.updatedAt,
  };
}

export function isNotesDbSupported() {
  return isAppDbSupported();
}

export async function readNoteRecord(skillId) {
  try {
    if (!isNonEmptySkillId(skillId)) {
      return createSuccessResult({ note: createEmptyNoteRecord("") });
    }

    const db = await openAppDb();
    const transaction = db.transaction(NOTES_STORE_NAME, "readonly");
    const transactionDone = transactionToPromise(transaction);
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const record = await requestToPromise(store.get(skillId));
    await transactionDone;

    return createSuccessResult({
      note: record ? sanitizeNoteRecord(skillId, record) : createEmptyNoteRecord(skillId),
    });
  } catch (error) {
    return createFailureResult(normalizeError(error, "note-read-failed"), {
      note: createEmptyNoteRecord(skillId),
    });
  }
}

export async function writeNoteRecord(skillId, value) {
  try {
    if (!isNonEmptySkillId(skillId)) {
      return createFailureResult("invalid-skill-id", {
        note: createEmptyNoteRecord(""),
      });
    }

    const nextRecord = sanitizeNoteRecord(skillId, value);
    const existingResult = await readNoteRecord(skillId);
    if (!existingResult.ok) {
      return createFailureResult(existingResult.error, {
        note: nextRecord,
      });
    }

    const existingRecord = existingResult.note;
    const shouldAddHistory = existingRecord.text.trim() !== "" && existingRecord.text !== nextRecord.text;
    const recordToStore = {
      ...nextRecord,
      history: shouldAddHistory
        ? [createHistorySnapshot(existingRecord), ...existingRecord.history].slice(0, MAX_HISTORY_ENTRIES)
        : existingRecord.history,
    };

    const db = await openAppDb();
    const transaction = db.transaction(NOTES_STORE_NAME, "readwrite");
    const transactionDone = transactionToPromise(transaction);
    transaction.objectStore(NOTES_STORE_NAME).put(recordToStore);
    await transactionDone;

    return createSuccessResult({ note: recordToStore });
  } catch (error) {
    return createFailureResult(normalizeError(error, "note-write-failed"), {
      note: sanitizeNoteRecord(skillId, value),
    });
  }
}

export async function deleteNoteRecord(skillId) {
  try {
    if (!isNonEmptySkillId(skillId)) {
      return createFailureResult("invalid-skill-id");
    }

    const db = await openAppDb();
    const transaction = db.transaction(NOTES_STORE_NAME, "readwrite");
    const transactionDone = transactionToPromise(transaction);
    transaction.objectStore(NOTES_STORE_NAME).delete(skillId);
    await transactionDone;

    return createSuccessResult();
  } catch (error) {
    return createFailureResult(normalizeError(error, "note-delete-failed"));
  }
}

export async function exportNoteRecords() {
  try {
    const db = await openAppDb();
    const transaction = db.transaction(NOTES_STORE_NAME, "readonly");
    const transactionDone = transactionToPromise(transaction);
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const records = await requestToPromise(store.getAll());
    await transactionDone;

    return createSuccessResult({
      records: Array.isArray(records)
        ? records
          .map((record) => sanitizeNoteRecord(record?.skillId, record))
          .filter((record) => isNonEmptySkillId(record.skillId))
        : [],
    });
  } catch (error) {
    return createFailureResult(normalizeError(error, "notes-export-failed"), {
      records: [],
    });
  }
}

export async function loadNotedSkillIds() {
  try {
    const exportResult = await exportNoteRecords();
    if (!exportResult.ok) {
      return createFailureResult(exportResult.error, {
        skillIds: new Set(),
      });
    }

    return createSuccessResult({
      skillIds: new Set(
        exportResult.records
          .filter((record) => record.text.trim() !== "")
          .map((record) => record.skillId),
      ),
    });
  } catch (error) {
    return createFailureResult(normalizeError(error, "notes-skill-id-load-failed"), {
      skillIds: new Set(),
    });
  }
}

export async function importNoteRecords(records) {
  try {
    const sanitizedRecords = Array.isArray(records)
      ? records
        .map((record) => sanitizeNoteRecord(record?.skillId, record))
        .filter((record) => isNonEmptySkillId(record.skillId))
      : [];

    if (sanitizedRecords.length === 0) {
      return createSuccessResult({ importedCount: 0 });
    }

    const db = await openAppDb();
    const transaction = db.transaction(NOTES_STORE_NAME, "readwrite");
    const transactionDone = transactionToPromise(transaction);
    const store = transaction.objectStore(NOTES_STORE_NAME);

    sanitizedRecords.forEach((record) => {
      store.put(record);
    });

    await transactionDone;

    return createSuccessResult({ importedCount: sanitizedRecords.length });
  } catch (error) {
    return createFailureResult(normalizeError(error, "notes-import-failed"), {
      importedCount: 0,
    });
  }
}