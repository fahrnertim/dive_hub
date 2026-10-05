-- Custom migration (ADR 0008, 0025), reviewed. A Dive's water type is its site's now: 0011 dropped the Dive's
-- column, and here its Overrides go. Old Revisions keep mentioning the water type and stay readable in the
-- history. Only touches rows that still list it, so running it again changes nothing.
UPDATE "dive" SET "overrides" = array_remove("overrides", 'waterType') WHERE 'waterType' = ANY("overrides");
