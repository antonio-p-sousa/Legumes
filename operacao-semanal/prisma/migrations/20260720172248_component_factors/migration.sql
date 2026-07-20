-- CreateTable
CREATE TABLE "ComponentFactor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dose" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "kgPerMeal" REAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentFactor_dose_component_key" ON "ComponentFactor"("dose", "component");
