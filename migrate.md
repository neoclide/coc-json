# Upstream sync log

## Sync 2026-08-09

Ported from `microsoft/vscode` `extensions/json-language-features`, upstream `main` at `d43a612ad8`:

- `055de422e4` Add configurable severity levels for JSON validation (#297911) — ported (server settings + validation severity).
- `b230b603ce` json: fix language model cache evicting at capacity instead of overflow (#309176) — ported.
- `449cb2b19b` [json] Unnecessary log when request canceled (#307443) — ported.

Not ported:
- `91b02efb23` ESM conversion of the language servers — VS Code build infrastructure; coc-json keeps CommonJS bundling.
- Browser build support (`esbuild.browser.mts`, `server/src/browser`) — no coc.nvim equivalent.
- Electron/client workbench changes (e.g. `8748be1f1a`, language status, trusted domains UI) — VS Code host-only.
- Service dependency bumps — handled via coc-json's own `vscode-json-languageservice` dependency.
