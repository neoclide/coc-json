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

## Sync 2026-08-09 (second)

Ported from the same upstream, still at `d43a612ad8`:

- `96ef7a5a0a` support for jsonValidationCatalogs (#327104) — adapted: extension `jsonValidationRegistry` files are read and watched, association refresh is debounced (500ms).
- `067cb03d18`/`c173f3e216`/`43755b4762` trustedDomains settings (#287639, #296928, #298423) — adapted: `json.schemaDownload.trustedDomains` + prompt on untrusted schema download; the untrusted-workspace part is omitted (coc.nvim has no workspace trust model).
- `c64fbf3ddb` add a `json.validate` command (#244784) — ported (`json/validateContent` request + client command); `json/validateAll` also added.
- `2d0ca04011` support `CodeActionContext.only` (#247402) — ported (`codeActionProvider.codeActionKinds`).
- `eae2f57127` avoid encoding reserved chars in JSON schema URL (#240654) — ported (`uri.toString(true)`).
- `5ca0ea581f` use markdownDescription for a few more settings — ported.
- `49715cfcdb`/service updates — adopted as `vscode-json-languageservice` 5.7.2.

Not ported:
- `json.colorDecorators.enable` and color decorator limits — VS Code editor rendering; coc.nvim has no equivalent UI.
- Language status item UI (`client/src/languageStatus.ts`) — VS Code host; coc equivalent is the `json.showSchemaList` command.
- ESM/browser/Electron/build infrastructure commits — VS Code build system.
- `@vscode/l10n` localization — coc extensions do not use it.
