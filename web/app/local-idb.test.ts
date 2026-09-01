import { afterEach, describe, expect, it } from "vitest";
import {
  isIndexedDbAvailable,
  openLocalIdb,
  openLocalIdbOrNull,
  requestResult,
  transactionResult,
  type LocalIdbConfig,
} from "./local-idb";

const config: LocalIdbConfig = {
  databaseName: "test-db",
  databaseVersion: 1,
  storeName: "items",
  keyPath: "id",
};

// 各测试按需构造只走单一结局的桩，覆盖调用方测试碰不到的错误分支。
function successRequest<T>(result: T) {
  const value = {
    result,
    error: null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  queueMicrotask(() => value.onsuccess?.());
  return value as unknown as IDBRequest<T>;
}

function failingRequest(error: DOMException | null) {
  const value = {
    result: undefined,
    error,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  queueMicrotask(() => value.onerror?.());
  return value as unknown as IDBRequest<unknown>;
}

type TransactionOutcome = "complete" | "error" | "abort";

function transactionStub(outcome: TransactionOutcome, error: DOMException | null) {
  const value = {
    error,
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
  };
  queueMicrotask(() => {
    if (outcome === "complete") value.oncomplete?.();
    else if (outcome === "error") value.onerror?.();
    else value.onabort?.();
  });
  return value as unknown as IDBTransaction;
}

type OpenOutcome = "success" | "error" | "blocked";

class StubFactory {
  upgradeCalls = 0;
  readonly createdStores: string[] = [];

  constructor(
    private readonly outcome: OpenOutcome,
    private readonly error: DOMException | null = null,
    private readonly existingStores: readonly string[] = [],
  ) {}

  open() {
    const stores = new Set(this.existingStores);
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => {
        stores.add(name);
        this.createdStores.push(name);
        return {};
      },
      close: () => {},
    };
    const value = {
      result: database,
      error: this.error,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
    queueMicrotask(() => {
      if (this.outcome === "success") {
        this.upgradeCalls += 1;
        value.onupgradeneeded?.();
        queueMicrotask(() => value.onsuccess?.());
      } else if (this.outcome === "error") {
        value.onerror?.();
      } else {
        value.onblocked?.();
      }
    });
    return value as unknown as IDBOpenDBRequest;
  }
}

function useFactory(factory: StubFactory | undefined) {
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: factory,
  });
}

describe("local-idb", () => {
  const originalIndexedDb = window.indexedDB;

  afterEach(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: originalIndexedDb,
    });
  });

  describe("isIndexedDbAvailable", () => {
    it("在 indexedDB 存在且可开库时判定为可用", () => {
      useFactory(new StubFactory("success"));
      expect(isIndexedDbAvailable()).toBe(true);
    });

    it("在 indexedDB 缺失时判定为不可用", () => {
      useFactory(undefined);
      expect(isIndexedDbAvailable()).toBe(false);
    });

    it("在 indexedDB 存在但没有 open 方法时判定为不可用", () => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: {},
      });
      expect(isIndexedDbAvailable()).toBe(false);
    });
  });

  describe("requestResult", () => {
    it("成功时解析为请求结果", async () => {
      await expect(requestResult(successRequest("值"))).resolves.toBe("值");
    });

    it("失败时以请求自带错误拒绝", async () => {
      const error = new DOMException("配额不足", "QuotaExceededError");
      await expect(requestResult(failingRequest(error))).rejects.toBe(error);
    });

    it("失败且无错误对象时回退为通用错误", async () => {
      await expect(requestResult(failingRequest(null))).rejects.toThrow(
        "IndexedDB request failed",
      );
    });
  });

  describe("transactionResult", () => {
    it("完成时解析", async () => {
      await expect(
        transactionResult(transactionStub("complete", null)),
      ).resolves.toBeUndefined();
    });

    it("出错时以事务自带错误拒绝", async () => {
      const error = new DOMException("写入失败", "UnknownError");
      await expect(
        transactionResult(transactionStub("error", error)),
      ).rejects.toBe(error);
    });

    it("中止时以中止语义拒绝", async () => {
      await expect(
        transactionResult(transactionStub("abort", null)),
      ).rejects.toThrow("IndexedDB transaction aborted");
    });

    it("出错且无错误对象时回退为通用错误", async () => {
      await expect(
        transactionResult(transactionStub("error", null)),
      ).rejects.toThrow("IndexedDB transaction failed");
    });
  });

  describe("openLocalIdb", () => {
    it("升级时按配置建仓", async () => {
      const factory = new StubFactory("success");
      useFactory(factory);

      await expect(openLocalIdb(config)).resolves.toBeTruthy();
      expect(factory.createdStores).toEqual(["items"]);
    });

    it("仓库已存在时不重复建仓", async () => {
      const factory = new StubFactory("success", null, ["items"]);
      useFactory(factory);

      await expect(openLocalIdb(config)).resolves.toBeTruthy();
      expect(factory.createdStores).toEqual([]);
    });

    it("环境不支持时解析为 null 而非抛错", async () => {
      useFactory(undefined);
      await expect(openLocalIdb(config)).resolves.toBeNull();
    });

    it("开库出错时以请求自带错误拒绝", async () => {
      const error = new DOMException("版本冲突", "VersionError");
      useFactory(new StubFactory("error", error));

      await expect(openLocalIdb(config)).rejects.toBe(error);
    });

    it("开库出错且无错误对象时回退为通用错误", async () => {
      useFactory(new StubFactory("error", null));
      await expect(openLocalIdb(config)).rejects.toThrow("IndexedDB open failed");
    });

    it("开库被阻塞时拒绝", async () => {
      useFactory(new StubFactory("blocked"));
      await expect(openLocalIdb(config)).rejects.toThrow("IndexedDB open blocked");
    });
  });

  describe("openLocalIdbOrNull", () => {
    it("成功时与 openLocalIdb 一致返回数据库", async () => {
      useFactory(new StubFactory("success"));
      await expect(openLocalIdbOrNull(config)).resolves.toBeTruthy();
    });

    // 这两条锁住重构时的关键取舍：抛错版与吞错版必须在"开库失败"上表现不同，
    // 否则素材侧无法区分 failed 与 unsupported。
    it("开库失败时返回 null 而非抛错", async () => {
      useFactory(new StubFactory("error", new DOMException("失败", "UnknownError")));
      await expect(openLocalIdbOrNull(config)).resolves.toBeNull();
    });

    it("开库被阻塞时同样返回 null", async () => {
      useFactory(new StubFactory("blocked"));
      await expect(openLocalIdbOrNull(config)).resolves.toBeNull();
    });
  });
});
