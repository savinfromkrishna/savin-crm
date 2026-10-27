-- A group can run every member on one model instead of each bot's own. Null
-- provider and id leave each bot on its own model.
ALTER TABLE "chat_groups" ADD COLUMN "modelProvider" TEXT;
ALTER TABLE "chat_groups" ADD COLUMN "modelId" TEXT;
ALTER TABLE "chat_groups" ADD COLUMN "thinkingLevel" TEXT;
