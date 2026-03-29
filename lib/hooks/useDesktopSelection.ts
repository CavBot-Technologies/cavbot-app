type DesktopSelectionMap<T> = Record<string, T>;

type DesktopSelectionTargetOptions = {
  itemSelector?: string;
  preserveSelectors?: readonly string[];
};

const DEFAULT_ITEM_SELECTOR = '[data-desktop-select-item="true"]';
const DEFAULT_PRESERVE_SELECTORS = ['[data-desktop-select-preserve="true"]', '[role="menu"]', '[role="dialog"]'];

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isElement(target: unknown): target is Element {
  return typeof Element !== "undefined" && target instanceof Element;
}

export function selectDesktopItemMap<T>(
  prev: DesktopSelectionMap<T>,
  key: string,
  item: T,
  additive = false,
): DesktopSelectionMap<T> {
  const itemKey = String(key || "").trim();
  if (!itemKey) return prev;
  if (hasOwn(prev, itemKey)) return prev;
  if (additive) return { ...prev, [itemKey]: item };
  return { [itemKey]: item };
}

export function selectDesktopItemArray(prev: readonly string[], id: string, additive = false): string[] {
  const nextId = String(id || "").trim();
  if (!nextId) return prev as string[];
  if (prev.includes(nextId)) return prev as string[];
  if (additive) return [...prev, nextId];
  return [nextId];
}

export function toggleDesktopItemArray(prev: readonly string[], id: string, additive = false): string[] {
  const nextId = String(id || "").trim();
  if (!nextId) return prev as string[];
  if (additive) {
    if (prev.includes(nextId)) return prev.filter((value) => value !== nextId);
    return [...prev, nextId];
  }
  if (prev.length === 1 && prev[0] === nextId) return [];
  return [nextId];
}

export function shouldClearDesktopSelectionFromTarget(
  target: EventTarget | null,
  options?: DesktopSelectionTargetOptions,
): boolean {
  if (!isElement(target)) return true;
  const itemSelector = options?.itemSelector || DEFAULT_ITEM_SELECTOR;
  if (itemSelector && target.closest(itemSelector)) return false;
  const preserveSelectors = options?.preserveSelectors || DEFAULT_PRESERVE_SELECTORS;
  for (const selector of preserveSelectors) {
    if (selector && target.closest(selector)) return false;
  }
  return true;
}
