ALTER TABLE "TaskProgress"
  ADD COLUMN IF NOT EXISTS "MachineryUsage" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "TaskProgress"."MachineryUsage" IS
  'Predefined machinery used for this daily progress entry: [{machineryId, machineryName, quantityUsed}]';
