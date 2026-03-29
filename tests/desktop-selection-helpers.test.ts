import assert from "node:assert/strict";
import test from "node:test";
import {
  selectDesktopItemArray,
  selectDesktopItemMap,
  shouldClearDesktopSelectionFromTarget,
  toggleDesktopItemArray,
} from "@/lib/hooks/useDesktopSelection";

test("selectDesktopItemMap keeps selected item stable and moves selection to a new item", () => {
  const a = { id: "a", kind: "file" as const };
  const b = { id: "b", kind: "file" as const };

  const first = selectDesktopItemMap({}, "file:a", a, false);
  assert.deepEqual(first, { "file:a": a });

  const same = selectDesktopItemMap(first, "file:a", a, false);
  assert.equal(same, first, "second click on the selected item must be a no-op");

  const moved = selectDesktopItemMap(first, "file:b", b, false);
  assert.deepEqual(moved, { "file:b": b }, "clicking a different item must move selection");
});

test("selectDesktopItemMap supports additive multi-select without deselecting existing items", () => {
  const a = { id: "a", kind: "file" as const };
  const b = { id: "b", kind: "file" as const };

  const first = selectDesktopItemMap({}, "file:a", a, true);
  const second = selectDesktopItemMap(first, "file:b", b, true);
  assert.deepEqual(second, { "file:a": a, "file:b": b });

  const same = selectDesktopItemMap(second, "file:b", b, true);
  assert.equal(same, second, "clicking an already-selected additive item must be a no-op");
});

test("selectDesktopItemArray keeps same-item click stable and moves on different click", () => {
  const first = selectDesktopItemArray([], "note_a");
  assert.deepEqual(first, ["note_a"]);

  const same = selectDesktopItemArray(first, "note_a");
  assert.equal(same, first, "second click on selected item must not churn selection state");

  const moved = selectDesktopItemArray(first, "note_b");
  assert.deepEqual(moved, ["note_b"]);
});

test("toggleDesktopItemArray clears a selected single item and supports multi-add/remove", () => {
  const first = toggleDesktopItemArray([], "note_a");
  assert.deepEqual(first, ["note_a"]);

  const cleared = toggleDesktopItemArray(first, "note_a");
  assert.deepEqual(cleared, []);

  const multi = toggleDesktopItemArray(toggleDesktopItemArray([], "note_a", true), "note_b", true);
  assert.deepEqual(multi, ["note_a", "note_b"]);

  const removed = toggleDesktopItemArray(multi, "note_a", true);
  assert.deepEqual(removed, ["note_b"]);
});

test("shouldClearDesktopSelectionFromTarget respects item and preserve selectors", () => {
  const originalElement = (globalThis as { Element?: unknown }).Element;

  class FakeElement {
    private readonly selectors: Set<string>;

    constructor(...selectors: string[]) {
      this.selectors = new Set(selectors);
    }

    closest(selector: string): FakeElement | null {
      return this.selectors.has(selector) ? this : null;
    }
  }

  try {
    (globalThis as { Element?: unknown }).Element = FakeElement as unknown as typeof Element;

    const itemTarget = new FakeElement('[data-desktop-select-item="true"]');
    assert.equal(
      shouldClearDesktopSelectionFromTarget(itemTarget as unknown as EventTarget),
      false,
      "item clicks must not clear selection",
    );

    const menuTarget = new FakeElement(".cavcloud-trashMenuWrap");
    assert.equal(
      shouldClearDesktopSelectionFromTarget(menuTarget as unknown as EventTarget, {
        preserveSelectors: [".cavcloud-trashMenuWrap"],
      }),
      false,
      "menu clicks must preserve selection",
    );

    const backgroundTarget = new FakeElement(".cb-random-background");
    assert.equal(
      shouldClearDesktopSelectionFromTarget(backgroundTarget as unknown as EventTarget, {
        preserveSelectors: [".cavcloud-trashMenuWrap"],
      }),
      true,
      "background clicks must clear selection",
    );
  } finally {
    (globalThis as { Element?: unknown }).Element = originalElement;
  }
});
