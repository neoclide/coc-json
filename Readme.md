# coc-json

Json language server extension for [coc.nvim](https://github.com/neoclide/coc.nvim).

The server code is extracted from VSCode, which uses
[vscode-json-languageservice](https://www.npmjs.com/package/vscode-json-languageservice)

## Install

In your vim/neovim, run the following command:

```
:CocInstall coc-json
```

## Features

Same as VSCode.

All features of [vscode-json-languageservice](https://www.npmjs.com/package/vscode-json-languageservice) are supported.

* `doCompletion` for JSON properties and values based on the document's JSON schema.
* `doHover`  for values based on descriptions in the document's JSON schema.<Paste>
* Document Symbols for quick navigation to properties in the document.
* Document Colors for showing color decorators on values representing colors.
* Code Formatting supporting ranges and formatting the whole document.
* Diagnostics (Validation) are pushed for all open documents
    * syntax errors
    * structural validation based on the document's JSON schema.

## Configuration options

* `json.enable` set to `false` to disable json language server.
* `json.trace.server` trace LSP traffic in output channel.
* `json.execArgv` add `execArgv` to `child_process.spawn`
* `json.format.enable` set to `false` to disable format.
* `json.schemas` schema associations for json files.

## FAQ

### How to suppress error `[json 521] [e] Comments are not permitted in JSON`?

You can configure your vim to make that file with jsonc filetype to allow comment.

### How to add custom schema definitions/properties?

You have two choices:

* use `$schema` in your json.
* create json schema file and then configure `json.schemes` in your `coc-settings.json`, check out https://github.com/neoclide/coc-json/blob/master/package.json#L55

### Quotes are hidden?

This is not caused by coc-json, you may checkout the `conceallevel` option.

## License

MIT
