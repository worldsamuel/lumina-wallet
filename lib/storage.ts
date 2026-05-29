const canUseStorage = () => typeof window !== "undefined" && Boolean(window.localStorage);

/**
 * Browser storage helpers for prototype-backed preferences and content.
 */
export const storage = {
  get(key: string, fallback = "") {
    // TODO 第 3 步改为后端 API
    if (!canUseStorage()) return fallback;
    return window.localStorage.getItem(key) ?? fallback;
  },
  set(key: string, value: string) {
    // TODO 第 3 步改为后端 API
    if (!canUseStorage()) return;
    window.localStorage.setItem(key, value);
  },
  getJson<T>(key: string, fallback: T): T {
    // TODO 第 3 步改为后端 API
    if (!canUseStorage()) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setJson<T>(key: string, value: T) {
    // TODO 第 3 步改为后端 API
    if (!canUseStorage()) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  },
};
