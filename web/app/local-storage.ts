// localStorage 访问的共享外壳。各调用方的领域校验差异很大，但外壳一致：
// 读 = SSR 守卫 → getItem → 长度上限 → JSON.parse → 领域解析；
// 写 = SSR 守卫 → stringify → 长度上限 → setItem → 回读比对。
// 回读比对是刻意保留的：Safari 隐私模式下 setItem 可能静默失败而不抛错。

export function readStoredText(key: string, maxLength?: number): string | null {
  if (typeof window === "undefined") return null;
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (stored === null) return null;
  if (maxLength !== undefined && stored.length > maxLength) return null;
  return stored;
}

/**
 * 读并解析 JSON。任一环节失败都返回 `null`，由调用方决定回退值——
 * 有的调用方回退到空数组，有的回退到默认对象，共享层不代为决定。
 */
export function readStoredJson(key: string, maxLength?: number): unknown {
  const stored = readStoredText(key, maxLength);
  if (stored === null || stored.length === 0) return null;
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return null;
  }
}

/**
 * 写入并回读确认。`maxLength` 省略时不做长度检查——现有调用方中有几处
 * 本就没有上限，加上会改变行为。
 */
export function writeStoredText(
  key: string,
  value: string,
  maxLength?: number,
): boolean {
  if (typeof window === "undefined") return false;
  if (maxLength !== undefined && value.length > maxLength) return false;
  try {
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

export function writeStoredJson(
  key: string,
  value: unknown,
  maxLength?: number,
): boolean {
  if (typeof window === "undefined") return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  return writeStoredText(key, serialized, maxLength);
}

export function removeStoredValue(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}
