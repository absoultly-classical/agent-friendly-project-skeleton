const recordingDatabaseName = "learning-meeting-recordings";
const recordingStoreName = "recordings";
const recordingDatabaseVersion = 1;
const maxRecordingRoomIdLength = 18;

type StoredRecording = {
  roomId: string;
  blob: Blob;
  type: string;
  savedAt: number;
};

function canUseIndexedDb() {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    typeof window.indexedDB.open === "function"
  );
}

function isValidRoomId(roomId: string) {
  return /^\d{6,18}$/.test(roomId) && roomId.length <= maxRecordingRoomIdLength;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionResult(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase() {
  if (!canUseIndexedDb()) return Promise.resolve<IDBDatabase | null>(null);
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = window.indexedDB.open(
      recordingDatabaseName,
      recordingDatabaseVersion,
    );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(recordingStoreName)) {
        request.result.createObjectStore(recordingStoreName, {
          keyPath: "roomId",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function getDatabase() {
  try {
    return await openDatabase();
  } catch {
    return null;
  }
}

export async function readLocalRecording(roomId: string) {
  if (!canUseIndexedDb() || !isValidRoomId(roomId)) return null;
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
  if (!canUseIndexedDb() || !isValidRoomId(roomId)) return false;
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
  if (!canUseIndexedDb() || !isValidRoomId(roomId)) return false;
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
  if (!canUseIndexedDb()) return false;
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
