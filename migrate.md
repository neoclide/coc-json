# Upstream sync log

## Sync 2026-10-03

Reviewed `microsoft/vscode` `extensions/json-language-features` from
`d43a612ad8121ff1f7fe19a5ee13e237c3c5463c` to
`67cb2a17e24d903be7d50486a70d9bd835e95ad6`.

- `fb20064c0f4`: canonicalize the effective schema URL before policy checks,
  download and cache lookup; invalidate original schema IDs when clearing the
  canonical cache key. Preserve aliases refreshed during asynchronous clearing.
  Keep Coc's explicit block-list/default-trust policy and localhost behavior.
- `d4b0f3a68eb`: expand leading `${workspaceFolder}/` in schema file matches,
  including exclusions, Windows drive normalization and literal glob characters.
  Keep Coc's existing per-folder configuration collection and catalog priority.
- `0a4fc0adc2c`: already covered by the bundled catalog's OpenAPI, Arazzo and
  Overlay entries; do not duplicate them or change default trust settings.
- `f3fa55c39d3`, `041d1b6643a`: defer ESM/LSP 3.18 language-service migration;
  retain the compatible 5.7.2 service and LSP 3.17 host boundary. No dependency
  parity claim is made.
- `3879d0e80fa`: omit behavior-neutral lint changes.
- `018b839d1b1`, `623a81d3445`, `d04893d5077`: omit VS Code test/build and
  unrelated upstream lockfile changes.

Added URL-policy, cache-alias/concurrency, workspace variable, exclusion and
literal-glob regression coverage. Existing schema preview tests also exposed a
Vim void-return incompatibility: use the buffer option API instead of reading
the return value of `setbufvar`.

Validation: baseline build/typecheck and Neovim 51/51 passed. Final build and
typecheck passed, Neovim 57/57 and Vim 57/57 passed, contract risk count was zero,
and `git diff --check` passed. Tests used the existing local coc.nvim checkout;
HTTP fixtures and Vim sockets needed execution outside the filesystem sandbox.

PR review follow-up: canonicalize HTTP(S) URLs at the shared request-service
entry point, so schema previews and validation use the same cache key. Leave
other URI schemes unchanged. A real HTTP/ETag regression downloads once,
closes the server, and previews the original alias from cache. Build/typecheck,
Neovim 58/58 and Vim 58/58 passed after this correction.

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
