-- A Connection from before ADR 0027 (0013 dropped its token and password) gets credentials it can sign in with
-- again: its account label as login, no access, no password. Plain JSON, not sealed: SQL can't reach the key, and
-- SecretBox.open hands back a value that isn't sealed; it holds nothing secret. Every Connection SSI had then signs in
-- with a password. 0045 makes the column NOT NULL.
UPDATE "connection"
SET "credentials" = json_build_object('kind', 'password', 'login', "account_label", 'access', null, 'password', null)::text
WHERE "credentials" IS NULL;
