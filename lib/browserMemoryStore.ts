type CavBrowserStore = {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createCavBrowserStore(): CavBrowserStore {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      if (!Number.isFinite(index) || index < 0) return null;
      const keys = Array.from(map.keys());
      return keys[Math.trunc(index)] ?? null;
    },
    getItem(key: string) {
      const normalized = String(key || "");
      if (!normalized) return null;
      return map.has(normalized) ? String(map.get(normalized) || "") : null;
    },
    setItem(key: string, value: string) {
      const normalized = String(key || "");
      if (!normalized) return;
      map.set(normalized, String(value ?? ""));
    },
    removeItem(key: string) {
      const normalized = String(key || "");
      if (!normalized) return;
      map.delete(normalized);
    },
    clear() {
      map.clear();
    },
  };
}

function createStorageBackedStore(resolveStorage: () => Storage | null | undefined): CavBrowserStore {
  const fallback = createCavBrowserStore();

  function storage() {
    try {
      return resolveStorage() ?? null;
    } catch {
      return null;
    }
  }

  return {
    get length() {
      const target = storage();
      if (!target) return fallback.length;
      try {
        return target.length;
      } catch {
        return fallback.length;
      }
    },
    key(index: number) {
      const target = storage();
      if (!target) return fallback.key(index);
      try {
        return target.key(index);
      } catch {
        return fallback.key(index);
      }
    },
    getItem(key: string) {
      const normalized = String(key || "");
      if (!normalized) return null;
      const target = storage();
      if (!target) return fallback.getItem(normalized);
      try {
        return target.getItem(normalized);
      } catch {
        return fallback.getItem(normalized);
      }
    },
    setItem(key: string, value: string) {
      const normalized = String(key || "");
      if (!normalized) return;
      const target = storage();
      if (!target) {
        fallback.setItem(normalized, value);
        return;
      }
      try {
        target.setItem(normalized, String(value ?? ""));
      } catch {
        fallback.setItem(normalized, value);
      }
    },
    removeItem(key: string) {
      const normalized = String(key || "");
      if (!normalized) return;
      const target = storage();
      if (!target) {
        fallback.removeItem(normalized);
        return;
      }
      try {
        target.removeItem(normalized);
      } catch {
        fallback.removeItem(normalized);
      }
    },
    clear() {
      const target = storage();
      if (!target) {
        fallback.clear();
        return;
      }
      try {
        target.clear();
      } catch {
        fallback.clear();
      }
    },
  };
}

function ensureGlobalBrowserStores() {
  const g = globalThis as typeof globalThis & {
    __cbLocalStore?: CavBrowserStore;
    __cbSessionStore?: CavBrowserStore;
  };
  if (!g.__cbLocalStore) {
    g.__cbLocalStore = createStorageBackedStore(() =>
      typeof window !== "undefined" ? window.localStorage : null,
    );
  }
  if (!g.__cbSessionStore) {
    g.__cbSessionStore = createStorageBackedStore(() =>
      typeof window !== "undefined" ? window.sessionStorage : null,
    );
  }
}

ensureGlobalBrowserStores();

export {};
