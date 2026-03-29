-- Persist CavPad sync toggles so API writes can be hard-enforced server-side.

ALTER TABLE "CavPadSettings"
  ADD COLUMN "syncToCavcloud" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CavPadSettings"
  ADD COLUMN "syncToCavsafe" BOOLEAN NOT NULL DEFAULT false;
