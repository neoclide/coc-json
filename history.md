# Change log

## 1.9.6

- `json.showSchemaList` no longer lists internal `vscode://` schemas.
- Remote schemas opened from `json.showSchemaList` load through the schema cache: fresh cached schemas are served without a request and the rest are revalidated with etags (304 -> cached content). Cache-first now applies to all http(s) schema downloads.

## 1.9.4

- Add `json.validate.comments`, `json.validate.trailingCommas`, `json.validate.schemaValidation` and `json.validate.schemaRequest` configuration options to customize the severity of JSON validation diagnostics.
- Fix language model cache evicting at capacity instead of overflow (upstream #309176).
- Remove unnecessary `cancelled` log on request cancellation (upstream #307443).
- Refresh the bundled SchemaStore catalog and add a scheduled workflow that keeps it updated automatically.
- A user `json.schemas` `fileMatch` pattern now takes precedence over catalog schemas that match the same file name.
- Add `json.selectSchema` command to pick a schema for the current file interactively (#64); the selection is persisted in extension globalState.
- Add `json.showSchemaList` command to list the schemas associated with the current file; local schemas open in the editor and remote schemas are fetched, formatted and shown in a temporary unnamed buffer.
- Add `json.copy` command to copy the JSON path at the cursor (#85), with a `workspace.registerKeymap` keymap `<Plug>(coc-json-copy)`.
- Add `json.schemaDownload.trustedDomains`: schema download domains are trusted by default and recorded automatically; use `:CocConfig` to block or unblock them (upstream #287639).
- Add `json.configureTrustedDomains` command and a one-time domain trust prompt for schemas associated with the current file.
- Add `json.validate` command backed by the `json/validateContent` request, and the `json/validateAll` request (upstream #244784).
- Support extension-contributed `jsonValidationRegistry` schema registries with debounced refresh (upstream #327104).
- Adopt `CodeActionContext.only`/`codeActionKinds` (upstream #247402), avoid percent-encoding reserved chars in schema URLs (upstream #240654), and upgrade to `vscode-json-languageservice` 5.7.2.
