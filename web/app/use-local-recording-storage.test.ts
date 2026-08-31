import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pruneLocalRecordings,
  readLocalRecording,
  removeLocalRecording,
  saveLocalRecording,
} from "./use-local-recording-storage";

type FakeRequest<T> = {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
};

function request<T>(result: T) {
  const value: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
  };
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value as unknown as IDBRequest<T>;
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
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

class FakeObjectStore {
  constructor(
    private readonly values: Map<string, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: string) {
    this.transaction.touch();
    return request(this.values.get(key));
  }

  put(value: { roomId: string }) {
    this.transaction.touch();
    this.values.set(value.roomId, value);
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
      onerror: null,
      onblocked: null,
    };
    queueMicrotask(() => {
      if (isNew) value.onupgradeneeded?.();
      queueMicrotask(() => value.onsuccess?.());
    });
    return value as unknown as IDBOpenDBRequest;
  }
}

describe("use-local-recording-storage", () => {
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

  it("会按会议号隔离并恢复本地录制 Blob", async () => {
    const first = new Blob(["第一场录制"], { type: "video/webm" });
    const second = new Blob(["第二场录制"], { type: "video/webm" });

    await expect(saveLocalRecording("123456", first)).resolves.toBe(true);
    await expect(saveLocalRecording("654321", second)).resolves.toBe(true);

    await expect((await readLocalRecording("123456"))?.text()).resolves.toBe(
      "第一场录制",
    );
    await expect((await readLocalRecording("654321"))?.text()).resolves.toBe(
      "第二场录制",
    );
  });

  it("会删除指定录制并清理历史中不存在的录制", async () => {
    const recording = new Blob(["录制"], { type: "video/webm" });
    await saveLocalRecording("123456", recording);
    await saveLocalRecording("654321", recording);

    await expect(removeLocalRecording("654321")).resolves.toBe(true);
    await expect(pruneLocalRecordings(["123456"])).resolves.toBe(true);

    await expect(readLocalRecording("654321")).resolves.toBeNull();
    await expect(readLocalRecording("123456")).resolves.toBeTruthy();
  });

  it("会拒绝不符合会议号边界的录制键", async () => {
    const recording = new Blob(["录制"], { type: "video/webm" });

    await expect(saveLocalRecording("not-a-room", recording)).resolves.toBe(false);
    await expect(readLocalRecording("123")).resolves.toBeNull();
    await expect(removeLocalRecording("123")).resolves.toBe(false);
  });
});
