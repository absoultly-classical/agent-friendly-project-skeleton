// IndexedDB 下层封装：把 Promise 化与开库逻辑集中一处，供各本地存储模块复用。
// 调用方只声明库名、版本与对象仓库，不再各自重复 request/transaction 的事件桥接。

export type LocalIdbConfig = {
  databaseName: string;
  databaseVersion: number;
  storeName: string;
  keyPath: string;
};

export function isIndexedDbAvailable() {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    typeof window.indexedDB.open === "function"
  );
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function transactionResult(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openLocalIdb(config: LocalIdbConfig) {
  if (!isIndexedDbAvailable()) return Promise.resolve<IDBDatabase | null>(null);
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = window.indexedDB.open(
      config.databaseName,
      config.databaseVersion,
    );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(config.storeName)) {
        request.result.createObjectStore(config.storeName, {
          keyPath: config.keyPath,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

// 开库失败与不支持在调用方语义不同（"failed" vs "unsupported"），
// 因此这里区分返回 null（不支持）与抛错（失败），由调用方决定映射。
export async function openLocalIdbOrNull(config: LocalIdbConfig) {
  try {
    return await openLocalIdb(config);
  } catch {
    return null;
  }
}
