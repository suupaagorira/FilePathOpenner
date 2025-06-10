# Repository Guidelines

This repository is an Electron application written in JavaScript (ES modules). To maintain consistency please follow the rules below when making changes.

## Coding style

- Use **ES module** syntax (`import`/`export`) for all JS files.
- Indent with **4 spaces** and terminate statements with semicolons.
- Keep line length under **120 characters**.
- Document exported functions with **JSDoc** style comments in English.
- Keep UI text in `index.html` and other front‑end files in Japanese unless otherwise instructed.
- Functions should remain focused and preferably under **60 lines**.

## Development workflow

1. Install dependencies if not already present:

   ```bash
   npm install
   ```

2. Run the unit tests before committing:

   ```bash
   npm test
   ```

   All tests must pass.

3. Use short, imperative commit messages in English (e.g., `Add startup option`).

