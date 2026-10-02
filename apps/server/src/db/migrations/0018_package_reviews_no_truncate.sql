-- Trilha de auditoria somente-inserção (PACKAGE_SPEC.md 17, item 8): o gatilho da 0016 é por linha (UPDATE/DELETE) e não cobre
-- TRUNCATE, que apagaria a tabela inteira sem disparar nada. Gatilho de comando (FOR EACH STATEMENT) fecha a brecha. Aditiva:
-- a versão anterior do servidor nunca faz TRUNCATE nesta tabela.
CREATE TRIGGER "package_reviews_no_truncate" BEFORE TRUNCATE ON "package_reviews"
FOR EACH STATEMENT EXECUTE FUNCTION "package_reviews_append_only"();
