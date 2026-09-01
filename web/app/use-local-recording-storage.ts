import {
  isIndexedDbAvailable,
  openLocalIdbOrNull,
  requestResult,
  transactionResult,
} from "./local-idb";

const recordingStoreName = "recordings";
const maxRecordingRoomIdLength = 18;
const recordingIdbConfig = {
  databaseName: "learning-meeting-recordings",
  databaseVersion: 1,
  storeName: recordingStoreName,
  keyPath: "roomId",
} as const;

type StoredRecording = {
  roomId: string;
  blob: Blob;
  type: string;
  savedAt: number;
};

function isValidRoomId(roomId: string) {
  return /^\d{6,18}$/.test(roomId) && roomId.length <= maxRecordingRoomIdLength;
}

function getDatabase() {
  return openLocalIdbOrNull(recordingIdbConfig);
}

export async function readLocalRecording(roomId: string) {
  if (!isIndexedDbAvailable() || !isValidRoomId(roomId)) return null;
  const database = await getDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(recordingStoreName, "readonly");
    const completed = transactionResult(transaction);
    const value = await requestResult<StoredRecording | undefined>(
      transaction.objectStore(recordingStoreName).get(roomId),
    );
    await completed;
    return value?.blob instanceof Blob ? value.blob : null;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function saveLocalRecording(roomId: string, blob: Blob) {
  if (!isIndexedDbAvailable() || !isValidRoomId(roomId)) return false;
  const database = await getDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(recordingStoreName, "readwrite");
    transaction.objectStore(recordingStoreName).put({
      roomId,
      blob,
      type: blob.type,
      savedAt: Date.now(),
    } satisfies StoredRecording);
    await transactionResult(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function removeLocalRecording(roomId: string) {
  if (!isIndexedDbAvailable() || !isValidRoomId(roomId)) return false;
  const database = await getDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(recordingStoreName, "readwrite");
    transaction.objectStore(recordingStoreName).delete(roomId);
    await transactionResult(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function pruneLocalRecordings(activeRoomIds: readonly string[]) {
  if (!isIndexedDbAvailable()) return false;
  const database = await getDatabase();
  if (!database) return false;
  try {
    const active = new Set(activeRoomIds.filter(isValidRoomId));
    const transaction = database.transaction(recordingStoreName, "readwrite");
    const store = transaction.objectStore(recordingStoreName);
    const keys = await requestResult<IDBValidKey[]>(store.getAllKeys());
    keys.forEach((key) => {
      if (typeof key === "string" && !active.has(key)) store.delete(key);
    });
    await transactionResult(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}
