-- CreateTable
CREATE TABLE "Dish" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "baseName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shopifyIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dishId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Dose_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "supplierId" TEXT,
    "unit" TEXT NOT NULL,
    CONSTRAINT "Ingredient_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "doseId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyPerMeal" REAL NOT NULL,
    CONSTRAINT "RecipeLine_doseId_fkey" FOREIGN KEY ("doseId") REFERENCES "Dose" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "orderDay" TEXT
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchText" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "confDay" TEXT NOT NULL,
    "courierId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Zone_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT,
    "ordering" TEXT NOT NULL DEFAULT 'manual'
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "orderWindowFrom" TEXT NOT NULL DEFAULT 'SAT_00:00',
    "orderWindowTo" TEXT NOT NULL DEFAULT 'FRI_23:59',
    "ignoreAfterClose" BOOLEAN NOT NULL DEFAULT true,
    "purchaseMargin" REAL NOT NULL DEFAULT 0.08,
    "dpdAccount" TEXT
);

-- CreateTable
CREATE TABLE "WeekRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekLabel" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordersJson" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Dish_baseName_key" ON "Dish"("baseName");

-- CreateIndex
CREATE UNIQUE INDEX "Dose_dishId_label_key" ON "Dose"("dishId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_doseId_ingredientId_key" ON "RecipeLine"("doseId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_matchText_key" ON "Zone"("matchText");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_name_key" ON "Courier"("name");
