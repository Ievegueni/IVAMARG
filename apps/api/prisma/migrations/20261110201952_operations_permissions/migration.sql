-- Dados: módulo "operations" nos perfis default existentes.
UPDATE "Role" SET "permissions" = array_cat("permissions", ARRAY['operations.view','operations.viewAll','operations.create','operations.edit','operations.delete','operations.approve','operations.export']) WHERE "name" = 'Gestor';
UPDATE "Role" SET "permissions" = array_cat("permissions", ARRAY['operations.view','operations.viewAll']) WHERE "name" IN ('Comercial', 'Financeiro');
UPDATE "Role" SET "permissions" = array_cat("permissions", ARRAY['operations.view','operations.viewAll','operations.create','operations.edit']) WHERE "name" = 'Produção/Stock';
