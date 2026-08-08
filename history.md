# Change log

## 1.9.4

- Add `json.validate.comments`, `json.validate.trailingCommas`, `json.validate.schemaValidation` and `json.validate.schemaRequest` configuration options to customize the severity of JSON validation diagnostics.
- Fix language model cache evicting at capacity instead of overflow (upstream #309176).
- Remove unnecessary `cancelled` log on request cancellation (upstream #307443).
- Refresh the bundled SchemaStore catalog and add a scheduled workflow that keeps it updated automatically.
