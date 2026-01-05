/*
  Warnings:

  - The primary key for the `Project` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `key` on the `Project` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `Project` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - You are about to alter the column `projectId` on the `Site` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - Added the required column `keyHash` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `keyLast4` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_keyHash_key" ON "Project"("keyHash");
CREATE TABLE "new_Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Site_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Site" ("createdAt", "id", "isActive", "label", "origin", "projectId", "slug", "updatedAt") SELECT "createdAt", "id", "isActive", "label", "origin", "projectId", "slug", "updatedAt" FROM "Site";
DROP TABLE "Site";
ALTER TABLE "new_Site" RENAME TO "Site";
CREATE UNIQUE INDEX "Site_projectId_slug_key" ON "Site"("projectId", "slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
