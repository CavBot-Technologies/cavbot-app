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

function ensureGlobalBrowserStores() {
  const g = globalThis as typeof globalThis & {
    __cbLocalStore?: CavBrowserStore;
    __cbSessionStore?: CavBrowserStore;
  };
  if (!g.__cbLocalStore) g.__cbLocalStore = createCavBrowserStore();
  if (!g.__cbSessionStore) g.__cbSessionStore = createCavBrowserStore();
}

ensureGlobalBrowserStores();

export {};
