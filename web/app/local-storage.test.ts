import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredJson,
  readStoredText,
  removeStoredValue,
  writeStoredJson,
  writeStoredText,
} from "./local-storage";

const key = "local-storage-test-key";

/** 让某个 Storage 方法抛错，模拟配额超限或隐私模式拒绝。 */
function throwOn(method: "getItem" | "setItem" | "removeItem") {
  vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("local-storage 读取", () => {
  it("会读回已写入的文本，键缺失时返回 null", () => {
    window.localStorage.setItem(key, "本机内容");
    expect(readStoredText(key)).toBe("本机内容");
    expect(readStoredText("never-written")).toBeNull();
  });

  it("会在超过长度上限时返回 null，恰好等于上限时仍返回", () => {
    window.localStorage.setItem(key, "abcde");
    expect(readStoredText(key, 4)).toBeNull();
    expect(readStoredText(key, 5)).toBe("abcde");
  });

  it("getItem 抛错时返回 null 而不是向上抛", () => {
    throwOn("getItem");
    expect(readStoredText(key)).toBeNull();
    expect(readStoredJson(key)).toBeNull();
  });

  it("会解析 JSON，内容非法或为空串时返回 null", () => {
    window.localStorage.setItem(key, '{"a":1}');
    expect(readStoredJson(key)).toEqual({ a: 1 });
    window.localStorage.setItem(key, "{not json");
    expect(readStoredJson(key)).toBeNull();
    window.localStorage.setItem(key, "");
    expect(readStoredJson(key)).toBeNull();
  });

  it("空串在 readStoredText 会原样返回，留给调用方判空", () => {
    window.localStorage.setItem(key, "");
    expect(readStoredText(key)).toBe("");
  });

  it("会把 JSON 的 null 与读取失败一样返回 null，由调用方自行回退", () => {
    window.localStorage.setItem(key, "null");
    expect(readStoredJson(key)).toBeNull();
  });
});

describe("local-storage 写入", () => {
  it("写入成功返回 true 并可读回", () => {
    expect(writeStoredText(key, "内容")).toBe(true);
    expect(window.localStorage.getItem(key)).toBe("内容");
  });

  it("超过长度上限时直接返回 false 且不落盘", () => {
    expect(writeStoredText(key, "abcde", 4)).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(writeStoredText(key, "abcde", 5)).toBe(true);
  });

  it("setItem 抛错时返回 false", () => {
    throwOn("setItem");
    expect(writeStoredText(key, "内容")).toBe(false);
    expect(writeStoredJson(key, { a: 1 })).toBe(false);
  });

  it("setItem 静默失败（回读不一致）时返回 false", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(writeStoredText(key, "内容")).toBe(false);
  });

  it("会序列化 JSON 并沿用长度上限", () => {
    expect(writeStoredJson(key, { a: 1 })).toBe(true);
    expect(window.localStorage.getItem(key)).toBe('{"a":1}');
    expect(writeStoredJson(key, { a: 1 }, 3)).toBe(false);
  });

  it("循环引用无法序列化时返回 false 而不是抛错", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(writeStoredJson(key, cyclic)).toBe(false);
  });
});

describe("local-storage 删除", () => {
  it("删除成功返回 true，删除不存在的键也返回 true", () => {
    window.localStorage.setItem(key, "内容");
    expect(removeStoredValue(key)).toBe(true);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(removeStoredValue("never-written")).toBe(true);
  });

  it("removeItem 抛错时返回 false", () => {
    throwOn("removeItem");
    expect(removeStoredValue(key)).toBe(false);
  });

  it("removeItem 静默失败（键仍在）时返回 false", () => {
    window.localStorage.setItem(key, "内容");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    expect(removeStoredValue(key)).toBe(false);
  });
});

describe("local-storage 服务端渲染", () => {
  it("没有 window 时读返回 null、写与删返回 false", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(readStoredText(key)).toBeNull();
      expect(readStoredJson(key)).toBeNull();
      expect(writeStoredText(key, "内容")).toBe(false);
      expect(writeStoredJson(key, { a: 1 })).toBe(false);
      expect(removeStoredValue(key)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
