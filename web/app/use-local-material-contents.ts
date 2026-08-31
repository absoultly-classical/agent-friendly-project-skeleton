const materialContentDatabaseName = "learning-meeting-material-content";
const materialContentStoreName = "files";
const materialContentDatabaseVersion = 1;

type StoredMaterialContent = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

export type MaterialContentPersistenceResult =
  | "saved"
  | "unsupported"
  | "failed";

function isIndexedDbAvailable() {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    typeof window.indexedDB.open === "function"
  );
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionResult(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase() {
  if (!isIndexedDbAvailable()) return Promise.resolve<IDBDatabase | null>(null);
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = window.indexedDB.open(
      materialContentDatabaseName,
      materialContentDatabaseVersion,
    );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(materialContentStoreName)) {
        request.result.createObjectStore(materialContentStoreName, {
          keyPath: "id",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function fileFromStoredContent(content: StoredMaterialContent) {
  if (!(content.blob instanceof Blob)) return null;
  try {
    return new File([content.blob], content.name, {
      type: content.type || content.blob.type,
      lastModified: content.lastModified,
    });
  } catch {
    return null;
  }
}

export async function readLocalMaterialContents(ids: readonly string[]) {
  const result: Record<string, File> = {};
  if (!isIndexedDbAvailable() || ids.length === 0) return result;
  let database: IDBDatabase | null;
  try {
    database = await openDatabase();
  } catch {
    return result;
  }
  if (!database) return result;
  try {
    const transaction = database.transaction(materialContentStoreName, "readonly");
    const store = transaction.objectStore(materialContentStoreName);
    const completed = transactionResult(transaction);
    const values = await Promise.all(
      [...new Set(ids)].map((id) => requestResult<StoredMaterialContent | undefined>(store.get(id))),
    );
    await completed;
    values.forEach((value) => {
      if (!value || typeof value.id !== "string") return;
      const file = fileFromStoredContent(value);
      if (file) result[value.id] = file;
    });
    return result;
  } catch {
    return {};
  } finally {
    database.close();
  }
}

export async function saveLocalMaterialContent(
  id: string,
  file: File,
): Promise<MaterialContentPersistenceResult> {
  if (!isIndexedDbAvailable()) return "unsupported";
  let database: IDBDatabase | null;
  try {
    database = await openDatabase();
  } catch {
    return "failed";
  }
  if (!database) return "unsupported";
  try {
    const transaction = database.transaction(materialContentStoreName, "readwrite");
    transaction.objectStore(materialContentStoreName).put({
      id,
      blob: file,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    } satisfies StoredMaterialContent);
    await transactionResult(transaction);
    return "saved";
  } catch {
    return "failed";
  } finally {
    database.close();
  }
}

export async function removeLocalMaterialContent(id: string) {
  if (!isIndexedDbAvailable()) return "unsupported" as const;
  let database: IDBDatabase | null;
  try {
    database = await openDatabase();
  } catch {
    return "failed" as const;
  }
  if (!database) return "unsupported" as const;
  try {
    const transaction = database.transaction(materialContentStoreName, "readwrite");
    transaction.objectStore(materialContentStoreName).delete(id);
    await transactionResult(transaction);
    return "removed" as const;
  } catch {
    return "failed" as const;
  } finally {
    database.close();
  }
}

export async function pruneLocalMaterialContents(activeIds: readonly string[]) {
  if (!isIndexedDbAvailable()) return "unsupported" as const;
  let database: IDBDatabase | null;
  try {
    database = await openDatabase();
  } catch {
    return "failed" as const;
  }
  if (!database) return "unsupported" as const;
  try {
    const active = new Set(activeIds);
    const transaction = database.transaction(materialContentStoreName, "readwrite");
    const store = transaction.objectStore(materialContentStoreName);
    const keys = await requestResult<IDBValidKey[]>(store.getAllKeys());
    keys.forEach((key) => {
      if (typeof key === "string" && !active.has(key)) store.delete(key);
    });
    await transactionResult(transaction);
    return "pruned" as const;
  } catch {
    return "failed" as const;
  } finally {
    database.close();
  }
}
