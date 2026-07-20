-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Courier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT,
    "ccEmails" TEXT NOT NULL DEFAULT '[]',
    "ordering" TEXT NOT NULL DEFAULT 'manual'
);
INSERT INTO "new_Courier" ("email", "id", "name", "ordering", "type") SELECT "email", "id", "name", "ordering", "type" FROM "Courier";
DROP TABLE "Courier";
ALTER TABLE "new_Courier" RENAME TO "Courier";
CREATE UNIQUE INDEX "Courier_name_key" ON "Courier"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
