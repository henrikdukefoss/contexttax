# Testing rules

- Run the narrowest test that covers your change first, then the full suite.
- A bug fix comes with a test that fails before the fix.
- Do not mock the database in integration tests.
