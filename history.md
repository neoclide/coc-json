# Change log

## 1.9.4

- Add `json.validate.comments`, `json.validate.trailingCommas`, `json.validate.schemaValidation` and `json.validate.schemaRequest` configuration options to customize the severity of JSON validation diagnostics.
- Fix language model cache evicting at capacity instead of overflow (upstream #309176).
- Remove unnecessary `cancelled` log on request cancellation (upstream #307443).
- Refresh the bundled SchemaStore catalog and add a scheduled workflow that keeps it updated automatically.
- A user `json.schemas` `fileMatch` pattern now takes precedence over catalog schemas that match the same file name.
- Add `json.selectSchema` command to pick a schema for the current file interactively (#64); the selection is persisted in extension globalState.
- Add `json.showSchemaList` command to list and open the schemas associated with the current file.
- Add `json.copy` command to copy the JSON path at the cursor (#85), with a `workspace.registerKeymap` keymap `<Plug>(coc-json-copy)`.
