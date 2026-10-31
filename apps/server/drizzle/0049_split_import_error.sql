-- An Import's `error` held either a code or an exception's text; the view guessed which. A code moves to error_code,
-- anything else becomes processing_failed with the text in error_detail. 0050 drops `error`.
UPDATE "import" SET
  "error_code" = CASE WHEN "error" IN ('unsupported_file', 'processing_failed', 'choice_expired') THEN "error" ELSE 'processing_failed' END::"import_error_code",
  "error_detail" = CASE WHEN "error" IN ('unsupported_file', 'processing_failed', 'choice_expired') THEN NULL ELSE "error" END
WHERE "error" IS NOT NULL;
