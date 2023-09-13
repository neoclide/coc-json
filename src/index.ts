import { CancellationToken, commands, CompletionContext, CompletionItem, CompletionItemKind, CompletionList, events, ExtensionContext, extensions, HandleDiagnosticsSignature, LanguageClient, LanguageClientOptions, languages, NotificationType, OutputChannel, Position, ProvideCompletionItemsSignature, RequestType, ResolveCompletionItemSignature, ServerOptions, services, TextEdit, TransportKind, window, workspace } from 'coc.nvim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { configure, getErrorStatusDescription, Headers, xhr, XHRResponse } from 'request-light'
import { promisify } from 'util'
import { SortOptions } from 'vscode-json-languageservice'
import { Diagnostic, DidChangeConfigurationNotification, ResponseError } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import catalog from './catalog.json'
import { joinPath, RequestService } from './requests'
import { JSONSchemaCache } from './schemaCache'
import extensionPkg from './schemas/extension-package.schema.json'
import { hash } from './utils/hash'

const resolveJson = typeof workspace.resolveJSONSchema === 'function'
const networkSchemes = ['http', 'https']
const retryTimeoutInHours = 2 * 24 // 2 days

namespace ForceValidateRequest {
  export const type: RequestType<string, Diagnostic[], any> = new RequestType('json/validate')
}

namespace VSCodeContentRequest {
  export const type: RequestType<string, string, any> = new RequestType('vscode/content')
}

namespace SchemaContentChangeNotification {
  export const type: NotificationType<string[] | string> = new NotificationType('json/schemaContent')
}

namespace SchemaAssociationNotification {
  export const type: NotificationType<ISchemaAssociations | ISchemaAssociation[]> = new NotificationType('json/schemaAssociations')
}

interface DocumentSortingParams {
  /**
   * The uri of the document to sort.
   */
  uri: string
  /**
  * The format options
  */
  options: SortOptions
}

namespace DocumentSortingRequest {
  export const type: RequestType<DocumentSortingParams, TextEdit[], any> = new RequestType('json/sort')
}

type ProviderResult<T> =
  | T
  | undefined
  | null
  | Thenable<T | undefined | null>

interface ISchemaAssociations {
  [pattern: string]: string[]
}

export interface ISchemaAssociation {
  fileMatch: string[]
  uri: string
}

namespace SettingIds {
  export const enableFormatter = 'json.format.enable'
  export const enableKeepLines = 'json.format.keepLines'
  export const enableValidation = 'json.validate.enable'
  export const enableSchemaDownload = 'json.schemaDownload.enable'
  export const maxItemsComputed = 'json.maxItemsComputed'
}

interface Settings {
  json?: {
    schemas?: JSONSchemaSettings[]
    format?: { enable?: boolean }
    keepLines?: { enable?: boolean }
    validate?: { enable?: boolean }
    resultLimit?: number
  }
  http?: {
    proxy?: string
    proxyStrictSSL?: boolean
  }
}

interface JSONSchemaSettings {
  fileMatch?: string[]
  url?: string
  schema?: any
}

let resultLimit = 5000

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions, logger } = context
  const config = workspace.getConfiguration().get<any>('json', {}) as any
  if (!config.enable) return
  let httpConfig = workspace.getConfiguration().get<any>('http', {}) as any
  configure(httpConfig.proxy, !!httpConfig.proxyStrictSSL)
  const outputChannel = window.createOutputChannel('json')
  subscriptions.push(outputChannel)
  const log = getLog(outputChannel)
  subscriptions.push(log)
  const httpService = getHTTPRequestService(context, log)

  const file = context.asAbsolutePath('./lib/server.js')
  const selector = ['json', 'jsonc']
  let fileSchemaErrors = new Map<string, string>()

  events.on('BufEnter', bufnr => {
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let msg = fileSchemaErrors.get(doc.uri)
    if (msg) client.outputChannel.appendLine(`Schema error: ${msg}`)
  }, null, subscriptions)

  subscriptions.push(commands.registerCommand('json.clearCache', async () => {
    if (httpService.clearCache) {
      const cachedSchemas = await httpService.clearCache()
      await client.sendNotification<string[] | string>(SchemaContentChangeNotification.type, cachedSchemas)
    }
    void window.showInformationMessage('JSON schema cache cleared.')
  }))

  subscriptions.push(commands.registerCommand('json.sort', async () => {
    const doc = await workspace.document
    if (!doc || ['json', 'jsonc'].indexOf(doc.filetype) == -1) return

    const formatOptions = await workspace.getFormatOptions(doc.uri)
    const options: SortOptions = {
      tabSize: formatOptions.tabSize,
      insertSpaces: formatOptions.insertSpaces,
      trimTrailingWhitespace: formatOptions.trimTrailingWhitespace,
      trimFinalNewlines: formatOptions.trimFinalNewlines,
      insertFinalNewline: formatOptions.insertFinalNewline,
    }
    const params: DocumentSortingParams = {
      uri: doc.uri,
      options
    }
    const textEdits = await client.sendRequest(DocumentSortingRequest.type, params)
    if (!textEdits.length) return

    await doc.applyEdits(textEdits)
  }))

  // The debug options for the server
  const debugOptions = { execArgv: ['--nolazy', '--inspect=' + (6000 + Math.round(Math.random() * 999))] }

  let serverOptions: ServerOptions = {
    run: {
      module: file,
      transport: TransportKind.ipc,
      options: {
        cwd: workspace.root,
        execArgv: config.execArgv
      }
    },
    debug: { module: file, transport: TransportKind.ipc, options: debugOptions }
  }

  let clientOptions: LanguageClientOptions = {
    outputChannel,
    documentSelector: selector,
    synchronize: {
      configurationSection: ['json', 'http'],
      fileEvents: workspace.createFileSystemWatcher('**/*.json')
    },
    initializationOptions: {
      handledSchemaProtocols: ['file'], // language server only loads file-URI. Fetching schemas with other protocols ('http'...) are made on the client.
      customCapabilities: { rangeFormatting: { editLimit: 1000 } }
    },
    outputChannelName: 'json',
    diagnosticCollectionName: 'json',
    middleware: {
      workspace: {
        didChangeConfiguration: () => client.sendNotification(DidChangeConfigurationNotification.type as any, { settings: getSettings() })
      },
      didOpen: async (textDocument, next) => {
        if (path.basename(textDocument.uri) === 'coc-settings.json') {
          Object.assign(textDocument, { languageId: 'jsonc' })
        }
        return next(textDocument)
      },
      handleDiagnostics: (uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => {
        const schemaErrorIndex = diagnostics.findIndex(candidate => candidate.code === /* SchemaResolveError */ 0x300)
        if (uri.endsWith('coc-settings.json')) {
          diagnostics = diagnostics.filter(o => o.code != 521)
        }
        if (schemaErrorIndex === -1) {
          fileSchemaErrors.delete(uri.toString())
          return next(uri, diagnostics)
        }
        const schemaResolveDiagnostic = diagnostics[schemaErrorIndex]
        fileSchemaErrors.set(uri.toString(), schemaResolveDiagnostic.message)
        let doc = workspace.getDocument(uri)
        if (doc && doc.uri == uri) {
          client.outputChannel.appendLine(`Schema error: ${schemaResolveDiagnostic.message}`)
        }
        next(uri, diagnostics)
      },
      resolveCompletionItem: (
        item: CompletionItem,
        token: CancellationToken,
        next: ResolveCompletionItemSignature): ProviderResult<CompletionItem> => {
        return Promise.resolve(next(item, token)).then((item: CompletionItem) => {
          if (item.data.detail) {
            item.detail = item.data.detail
          }
          return item
        })
      },
      // fix completeItem
      provideCompletionItem: (
        document,
        position: Position,
        context: CompletionContext,
        token: CancellationToken,
        next: ProvideCompletionItemsSignature
      ): ProviderResult<CompletionItem[] | CompletionList> => {
        return Promise.resolve(next(document, position, context, token)).then((res: CompletionItem[] | CompletionList = []) => {
          let doc = workspace.getDocument(document.uri)
          if (!doc) return []
          let items: CompletionItem[] = res.hasOwnProperty('isIncomplete') ? (res as CompletionList).items : res as CompletionItem[]
          let line = doc.getline(position.line)
          for (let item of items) {
            let { textEdit, insertText, label, filterText } = item // tslint:disable-line
            item.insertText = null // tslint:disable-line
            if (textEdit && textEdit.newText) {
              let newText = insertText || textEdit.newText
              textEdit.newText = newText
              let { start, end } = textEdit.range
              if (line[start.character] && line[end.character - 1] && /^".*"$/.test(label)) {
                item.label = item.label.slice(1, -1)
              }
            }
            if (filterText && /^".*"$/.test(filterText)) {
              item.filterText = filterText.slice(1, -1)
            }
          }
          let result: any = {
            isIncomplete: false,
            items
          }
          if (items.length && items.every(o => o.kind == CompletionItemKind.Property)) {
            result.startcol = doc.fixStartcol(position, ['.'])
          }
          return result
        })
      }
    }
  }

  let client = new LanguageClient('json', 'Json language server', serverOptions, clientOptions)

  subscriptions.push(services.registLanguageClient(client))

  client.onReady().then(() => {
    // associations
    client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations())
    extensions.onDidUnloadExtension(() => {
      client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations())
    }, null, subscriptions)
    extensions.onDidLoadExtension(() => {
      client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations())
    }, null, subscriptions)

    let schemaDownloadEnabled = true
    function updateSchemaDownloadSetting(): void {
      schemaDownloadEnabled = workspace.getConfiguration().get(SettingIds.enableSchemaDownload) !== false
    }
    updateSchemaDownloadSetting()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(SettingIds.enableSchemaDownload)) {
        updateSchemaDownloadSetting()
      }
    }, null, subscriptions)

    const schemaDocuments: { [uri: string]: boolean } = {}
    client.onRequest(VSCodeContentRequest.type, async uriPath => {
      const uri = URI.parse(uriPath)
      if (uri.scheme === 'untitled') {
        return Promise.reject(new ResponseError(3, `Unable to load ${uri.scheme}`))
      }
      if (uriPath === 'vscode://schemas/vscode-data-schema') {
        let obj = {
          type: 'object',
          properties: {
            properties: extensionPkg.definitions.configurationEntry.properties.properties
          }
        }
        return JSON.stringify(obj)
      }
      if (uriPath === 'vscode://schemas/vscode-extensions') {
        return JSON.stringify(extensionPkg)
      }
      if (resolveJson && uri.scheme === 'vscode') {
        let schema = workspace.resolveJSONSchema(uriPath)
        if (!schema) void window.showErrorMessage(`Failed to resolve schema for ${uriPath}`)
        return Promise.resolve(JSON.stringify(schema ?? {}))
      }
      if (uriPath == 'vscode://settings') {
        let schemaContent = await promisify(fs.readFile)(path.join(workspace.pluginRoot, 'data/schema.json'), 'utf8')
        let schema: any = JSON.parse(schemaContent)
        schema.properties = schema.properties || {}
        let schemes = extensions['schemes']
        if (schemes) Object.assign(schema.properties, schemes)
        extensions.all.forEach(extension => {
          let { packageJSON } = extension
          let { contributes } = packageJSON
          if (!contributes) return
          let { configuration } = contributes
          if (configuration) {
            let { properties, definitions } = configuration
            if (properties) Object.assign(schema.properties, properties)
            if (definitions) Object.assign(schema.definitions, definitions)
          }
        })
        return JSON.stringify(schema)
      }
      if (uriPath.startsWith('vscode://')) {
        return {}
      }
      if (!networkSchemes.includes(uri.scheme)) {
        let doc = await workspace.loadFile(uriPath)
        if (doc) {
          schemaDocuments[uri.toString()] = true
          return doc.getDocumentContent()
        } else {
          logger.error(`Unable to load schema of ${uri}`)
          return '{}'
        }
      }
      if (schemaDownloadEnabled) {
        return await Promise.resolve(httpService.getContent(uriPath))
      } else {
        logger.warn(`Schema download disabled!`)
      }
      return '{}'
    })
    const handleContentChange = (uriString: string) => {
      if (schemaDocuments[uriString]) {
        client.sendNotification(SchemaContentChangeNotification.type, uriString)
        return true
      }
      return false
    }
    workspace.onDidChangeTextDocument(e => handleContentChange(e.textDocument.uri))
    workspace.onDidCloseTextDocument(doc => {
      const uriString = doc.uri
      if (handleContentChange(uriString)) {
        delete schemaDocuments[uriString]
      }
      fileSchemaErrors.delete(doc.uri)
    }, null, subscriptions)
  }, _e => {
    // noop
  })

  let statusItem = window.createStatusBarItem(0, { progress: true })
  subscriptions.push(statusItem)
  subscriptions.push(commands.registerCommand('json.retryResolveSchema', async () => {
    let doc = await workspace.document
    if (!doc || ['json', 'jsonc'].indexOf(doc.filetype) == -1) return
    statusItem.isProgress = true
    statusItem.text = 'loading schema'
    statusItem.show()
    client.sendRequest(ForceValidateRequest.type, doc.uri).then((diagnostics: Diagnostic[]) => {
      statusItem.text = '⚠️'
      statusItem.isProgress = false
      const schemaErrorIndex = diagnostics.findIndex(candidate => candidate.code === /* SchemaResolveError */ 0x300)
      if (schemaErrorIndex !== -1) {
        // Show schema resolution errors in status bar only; ref: #51032
        const schemaResolveDiagnostic = diagnostics[schemaErrorIndex]
        fileSchemaErrors.set(doc.uri, schemaResolveDiagnostic.message)
        statusItem.show()
      } else {
        statusItem.hide()
      }
    }, () => {
      statusItem.show()
      statusItem.isProgress = false
      statusItem.text = '⚠️'
    })
  }))
}

function getSettings(): Settings {
  const configuration = workspace.getConfiguration()
  resultLimit = Math.trunc(Math.max(0, Number(workspace.getConfiguration().get(SettingIds.maxItemsComputed)))) || 5000

  let httpSettings = workspace.getConfiguration('http')
  let enableDefaultSchemas = configuration.get('json.enableDefaultSchemas')
  let settings: Settings = {
    http: {
      proxy: httpSettings.get('proxy'),
      proxyStrictSSL: httpSettings.get('proxyStrictSSL')
    },
    json: {
      validate: { enable: configuration.get(SettingIds.enableValidation) },
      format: { enable: configuration.get(SettingIds.enableFormatter) },
      keepLines: { enable: configuration.get(SettingIds.enableKeepLines) },
      schemas: [],
      resultLimit: resultLimit + 1 // ask for one more so we can detect if the limit has been exceeded
    }
  }
  let schemaSettingsById: { [schemaId: string]: JSONSchemaSettings } = Object.create(null)
  let allFileMatches: string[] = []
  let collectSchemaSettings = (schemaSettings: JSONSchemaSettings[], folderUri?: URI, isMultiRoot?: boolean) => {
    let fileMatchPrefix = undefined
    if (folderUri && isMultiRoot) {
      fileMatchPrefix = folderUri.toString()
      if (fileMatchPrefix[fileMatchPrefix.length - 1] === '/') {
        fileMatchPrefix = fileMatchPrefix.substr(0, fileMatchPrefix.length - 1)
      }
    }
    for (const setting of schemaSettings) {
      const url = getSchemaId(setting, folderUri)
      if (!url) continue

      let schemaSetting = schemaSettingsById[url]
      if (!schemaSetting) {
        schemaSetting = schemaSettingsById[url] = { url, fileMatch: [] }
        settings.json!.schemas!.push(schemaSetting)
      }
      const fileMatches = setting.fileMatch
      if (Array.isArray(fileMatches)) {
        const resultingFileMatches = schemaSetting.fileMatch || []
        schemaSetting.fileMatch = resultingFileMatches
        const addMatch = (pattern: string) => { //  filter duplicates
          if (!resultingFileMatches.includes(pattern)) {
            resultingFileMatches.push(pattern)
            allFileMatches.push(pattern)
          }
        }
        for (const fileMatch of fileMatches) {
          if (fileMatchPrefix) {
            if (fileMatch[0] === '/') {
              addMatch(fileMatchPrefix + fileMatch)
              addMatch(fileMatchPrefix + '/*' + fileMatch)
            } else {
              addMatch(fileMatchPrefix + '/' + fileMatch)
              addMatch(fileMatchPrefix + '/*/' + fileMatch)
            }
          } else {
            addMatch(fileMatch)
          }
        }
      }
      if (setting.schema && !schemaSetting.schema) {
        schemaSetting.schema = setting.schema
      }
    }
  }

  const folders = workspace.workspaceFolders
  // merge global and folder settings. Qualify all file matches with the folder path.
  let globalSettings = workspace.getConfiguration('json', null).get<JSONSchemaSettings[]>('schemas')
  if (Array.isArray(globalSettings)) {
    if (!folders || folders.length == 0) collectSchemaSettings(globalSettings)
  }

  if (folders) {
    const isMultiRoot = folders.length > 1
    for (const folder of folders) {
      const folderUri = folder.uri
      const schemaConfigInfo = workspace.getConfiguration('json', folderUri).inspect<JSONSchemaSettings[]>('schemas')
      const folderSchemas = schemaConfigInfo!.workspaceValue
      if (Array.isArray(folderSchemas)) {
        collectSchemaSettings(folderSchemas, URI.parse(folderUri), isMultiRoot)
      }
      if (Array.isArray(globalSettings)) {
        collectSchemaSettings(globalSettings, URI.parse(folderUri), isMultiRoot)
      }

    }
  }

  if (enableDefaultSchemas) {
    for (let item of catalog.schemas) {
      let { fileMatch, url } = item
      if (Array.isArray(fileMatch)) {
        if (!allFileMatches.some(s => fileMatch.includes(s))) {
          settings.json!.schemas!.push({ fileMatch, url })
        }
      } else if (typeof fileMatch === 'string') {
        if (!allFileMatches.includes(fileMatch)) {
          settings.json!.schemas!.push({ fileMatch: [fileMatch], url })
        }
      }
    }
  }
  return settings
}

function getSchemaId(schema: JSONSchemaSettings, folderUri?: URI): string | undefined {
  let url = schema.url
  if (!url) {
    if (schema.schema) {
      url = schema.schema.id || `vscode://schemas/custom/${encodeURIComponent(hash(schema.schema).toString(16))}`
    }
  } else if (folderUri && (url[0] === '.' || url[0] === '/')) {
    url = URI.file(path.posix.join(folderUri.fsPath, url)).toString()
  }
  return url
}

function getHTTPRequestService(context: ExtensionContext, log: Log): RequestService {
  let cache: JSONSchemaCache | undefined = undefined
  const storagePath = context.storagePath

  let clearCache: (() => Promise<string[]>) | undefined
  if (typeof storagePath === 'string') {
    const schemaCacheLocation = path.join(storagePath, 'json-schema-cache')
    fs.mkdirSync(schemaCacheLocation, { recursive: true })

    const schemaCache = new JSONSchemaCache(schemaCacheLocation, context.globalState)
    log.trace(`[json schema cache] initial state: ${JSON.stringify(schemaCache.getCacheInfo(), null, ' ')}`)
    cache = schemaCache
    clearCache = async () => {
      const cachedSchemas = await schemaCache.clearCache()
      log.trace(`[json schema cache] cache cleared. Previously cached schemas: ${cachedSchemas.join(', ')}`)
      return cachedSchemas
    }
  }
  const isXHRResponse = (error: any): error is XHRResponse => typeof error?.status === 'number'
  const request = async (uri: string, etag?: string): Promise<string> => {
    const headers: Headers = { 'Accept-Encoding': 'gzip, deflate' }
    if (etag) {
      headers['If-None-Match'] = etag
    }
    try {
      log.trace(`[json schema cache] Requesting schema ${uri} etag ${etag}...`)

      const response = await xhr({ url: uri, followRedirects: 5, headers })
      if (cache) {
        const etag = response.headers['etag']
        if (typeof etag === 'string') {
          log.trace(`[json schema cache] Storing schema ${uri} etag ${etag} in cache`)
          await cache.putSchema(uri, etag, response.responseText)
        } else {
          log.trace(`[json schema cache] Response: schema ${uri} no etag`)
        }
      }
      return response.responseText
    } catch (error: unknown) {
      if (isXHRResponse(error)) {
        if (error.status === 304 && etag && cache) {

          log.trace(`[json schema cache] Response: schema ${uri} unchanged etag ${etag}`)

          const content = await cache.getSchema(uri, etag, true)
          if (content) {
            log.trace(`[json schema cache] Get schema ${uri} etag ${etag} from cache`)
            return content
          }
          return request(uri)
        }

        let status = getErrorStatusDescription(error.status)
        if (status && error.responseText) {
          status = `${status}\n${error.responseText.substring(0, 200)}`
        }
        if (!status) {
          status = error.toString()
        }
        log.trace(`[json schema cache] Respond schema ${uri} error ${status}`)

        throw status
      }
      throw error
    }
  }


  return {
    getContent: async (uri: string) => {
      if (cache && /^https?:\/\/json\.schemastore\.org\//.test(uri)) {
        const content = await cache.getSchemaIfUpdatedSince(uri, retryTimeoutInHours)
        if (content) {
          if (log.isTrace()) {
            log.trace(`[json schema cache] Schema ${uri} from cache without request (last accessed ${cache.getLastUpdatedInHours(uri)} hours ago)`)
          }

          return content
        }
      }
      return request(uri, cache?.getETag(uri))
    },
    clearCache
  }
}

function getSchemaAssociations(): ISchemaAssociation[] {
  const associations: ISchemaAssociation[] = []
  if (resolveJson) {
    let home = path.normalize(process.env.COC_VIMCONFIG) ?? path.join(os.homedir(), '.vim')
    let userConfigFile = URI.file(path.join(home, 'coc-settings.json')).fsPath
    associations.push({ fileMatch: [userConfigFile], uri: 'vscode://schemas/settings/user' })
    associations.push({ fileMatch: ['coc-settings.json', `!${userConfigFile}`], uri: 'vscode://schemas/settings/folder' })
  } else {
    associations.push({ fileMatch: ['coc-settings.json'], uri: 'vscode://settings' })
  }
  let fsPath = path.join(workspace.pluginRoot, 'data/schema.json')
  if (fs.existsSync(fsPath)) {
    fsPath = URI.file(fsPath).fsPath
    associations.push({ fileMatch: [fsPath], uri: 'http://json-schema.org/draft-07/schema#' })
    associations.push({ fileMatch: [fsPath], uri: 'vscode://schemas/vscode-data-schema' })
  }
  associations.push({ fileMatch: ['package.json'], uri: 'vscode://schemas/vscode-extensions' })
  extensions.all.forEach(extension => {
    const packageJSON = extension.packageJSON
    if (packageJSON && packageJSON.contributes && packageJSON.contributes.jsonValidation) {
      const jsonValidation = packageJSON.contributes.jsonValidation
      if (Array.isArray(jsonValidation)) {
        jsonValidation.forEach(jv => {
          let { fileMatch, url } = jv
          if (typeof fileMatch === 'string') {
            fileMatch = [fileMatch]
          }
          if (Array.isArray(fileMatch) && typeof url === 'string') {
            let uri: string = url
            if (uri[0] === '.' && uri[1] === '/') {
              uri = joinPath(URI.file(extension.extensionPath), uri).toString()
            }
            fileMatch = fileMatch.map(fm => {
              if (fm[0] === '%') {
                fm = fm.replace(/%APP_SETTINGS_HOME%/, '/User')
                fm = fm.replace(/%MACHINE_SETTINGS_HOME%/, '/Machine')
                fm = fm.replace(/%APP_WORKSPACES_HOME%/, '/Workspaces')
              } else if (!fm.match(/^(\w+:\/\/|\/|!)/)) {
                fm = '/' + fm
              }
              return fm
            })
            associations.push({ fileMatch, uri })
          }
        })
      }
    }
  })
  if (typeof languages['registerDocumentSemanticTokensProvider'] === 'undefined') {
    // coc.nvim before 316 PR merged, to make the server receive single params
    return [associations] as any
  }
  return associations
}

interface Log {
  trace(message: string): void
  isTrace(): boolean
  dispose(): void
}

const traceSetting = 'json.trace.server'
function getLog(outputChannel: OutputChannel): Log {
  let trace = workspace.getConfiguration().get(traceSetting) === 'verbose'
  const configListener = workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(traceSetting)) {
      trace = workspace.getConfiguration().get(traceSetting) === 'verbose'
    }
  })
  return {
    trace(message: string) {
      if (trace) {
        outputChannel.appendLine(message)
      }
    },
    isTrace() {
      return trace
    },
    dispose: () => configListener.dispose()
  }
}
