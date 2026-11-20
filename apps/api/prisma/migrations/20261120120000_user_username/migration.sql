-- Login passa a ser feito pelo nome de utilizador (o email fica para recuperação de password e notificações).
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Utilizadores existentes: parte do email antes do @; em caso de repetição junta um sufixo numérico.
WITH base AS (
  SELECT id, lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) AS b,
         row_number() OVER (PARTITION BY lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) ORDER BY "createdAt") AS n
  FROM "User"
)
UPDATE "User" u SET "username" = CASE WHEN base.n = 1 THEN base.b ELSE base.b || base.n END
FROM base WHERE base.id = u.id;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
