import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pruneLocalMaterialContents,
  readLocalMaterialContents,
  removeLocalMaterialContent,
  saveLocalMaterialContent,
} from "./use-local-material-contents";

type FakeRequest<T> = {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

function request<T>(result: T) {
  const value: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value as unknown as IDBRequest<T>;
}

class FakeObjectStore {
  constructor(private readonly values: Map<string, unknown>, private readonly transaction: FakeTransaction) {}

  get(key: string) {
    this.transaction.touch();
    return request(this.values.get(key));
  }

  put(value: { id: string }) {
    this.transaction.touch();
    this.values.set(value.id, value);
    return request(undefined);
  }

  delete(key: string) {
    this.transaction.touch();
    this.values.delete(key);
    return request(undefined);
  }

  getAllKeys() {
    this.transaction.touch();
    return request([...this.values.keys()]);
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private completionScheduled = false;

  constructor(private readonly values: Map<string, unknown>) {}

  objectStore() {
    return new FakeObjectStore(this.values, this);
  }

  touch() {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => this.oncomplete?.(), 0);
  }
}

class FakeObjectStoreNames {
  constructor(private readonly names: Set<string>) {}

  contains(name: string) {
    return this.names.has(name);
  }
}

class FakeDatabase {
  private readonly names = new Set<string>();
  private readonly values = new Map<string, unknown>();
  readonly objectStoreNames = new FakeObjectStoreNames(this.names);

  createObjectStore(name: string) {
    this.names.add(name);
    return new FakeObjectStore(this.values, new FakeTransaction(this.values));
  }

  transaction() {
    return new FakeTransaction(this.values);
  }

  close() {}
}

class FakeIndexedDbFactory {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string) {
    const database = this.databases.get(name) ?? new FakeDatabase();
    const isNew = !this.databases.has(name);
    this.databases.set(name, database);
    const value = {
      result: database,
      error: null,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
    queueMicrotask(() => {
      if (isNew) value.onupgradeneeded?.();
      queueMicrotask(() => value.onsuccess?.());
    });
    return value as unknown as IDBOpenDBRequest;
  }
}

describe("use-local-material-contents", () => {
  const originalIndexedDb = window.indexedDB;

  beforeEach(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: new FakeIndexedDbFactory(),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: originalIndexedDb,
    });
  });

  it("会在 IndexedDB 中保存并恢复文件内容", async () => {
    const file = new File(["持久化内容"], "离线资料.txt", {
      type: "text/plain",
      lastModified: 123,
    });

    await expect(saveLocalMaterialContent("material-1", file)).resolves.toBe("saved");
    const restored = await readLocalMaterialContents(["material-1"]);

    expect(restored["material-1"]?.name).toBe("离线资料.txt");
    expect(restored["material-1"]?.type).toBe("text/plain");
    expect(restored["material-1"]?.lastModified).toBe(123);
    await expect(restored["material-1"]?.text()).resolves.toBe("持久化内容");
  });

  it("移除资料内容并清理不再存在于元数据中的孤儿记录", async () => {
    const file = new File(["内容"], "资料.txt", { type: "text/plain" });
    await saveLocalMaterialContent("keep", file);
    await saveLocalMaterialContent("remove", file);

    await expect(removeLocalMaterialContent("remove")).resolves.toBe("removed");
    await pruneLocalMaterialContents(["keep"]);

    expect(Object.keys(await readLocalMaterialContents(["keep", "remove"]))).toEqual([
      "keep",
    ]);
  });

  it("数据库打开失败时会安全降级而不抛出未处理异常", async () => {
    const failingIndexedDb = {
      open() {
        const value = {
          result: null,
          error: new DOMException("blocked", "UnknownError"),
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null as (() => void) | null,
          onblocked: null,
        };
        queueMicrotask(() => value.onerror?.());
        return value;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: failingIndexedDb,
    });

    await expect(readLocalMaterialContents(["material-1"])).resolves.toEqual({});
    await expect(
      saveLocalMaterialContent(
        "material-1",
        new File(["内容"], "资料.txt", { type: "text/plain" }),
      ),
    ).resolves.toBe("failed");
  });
});
