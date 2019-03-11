import path from 'path'
import fs from 'fs'
import { DidChangeConfigurationNotification, TextDocument, Position, CompletionContext, CancellationToken, CompletionItem, CompletionList, CompletionItemKind } from 'vscode-languageserver-protocol'
import catalog from './catalog.json'
import Uri from 'vscode-uri'
import findUp from 'find-up'
import { hash } from './utils/hash'
import { ExtensionContext, extensions, LanguageClient, ServerOptions, workspace, services, TransportKind, LanguageClientOptions, ServiceStat, ProvideCompletionItemsSignature, ResolveCompletionItemSignature } from 'coc.nvim'

type ProviderResult<T> =
  | T
  | undefined
  | null
  | Thenable<T | undefined | null>

interface ISchemaAssociations {
  [pattern: string]: string[]
}

interface Settings {
  json?: {
    schemas?: JSONSchemaSettings[]
    format?: { enable: boolean; }
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

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions, logger } = context
  const config = workspace.getConfiguration().get<any>('json', {}) as any
  if (!config.enable) return
  const file = context.asAbsolutePath('lib/server/jsonServerMain.js')
  const selector = ['json', 'jsonc']
  let schemaContent = await readFile(path.join(workspace.pluginRoot, 'data/schema.json'), 'utf8')
  let settingsSchema = JSON.parse(schemaContent)

  let serverOptions: ServerOptions = {
    module: file,
    args: ['--node-ipc'],
    transport: TransportKind.ipc,
    options: {
      cwd: workspace.root,
      execArgv: config.execArgv
    }
  }

  let clientOptions: LanguageClientOptions = {
    documentSelector: selector,
    synchronize: {
      configurationSection: ['json', 'http'],
      fileEvents: workspace.createFileSystemWatcher('**/*.json')
    },
    outputChannelName: 'json',
    middleware: {
      workspace: {
        didChangeConfiguration: () => client.sendNotification(DidChangeConfigurationNotification.type, { settings: getSettings() })
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
        document: TextDocument,
        position: Position,
        context: CompletionContext,
        token: CancellationToken,
        next: ProvideCompletionItemsSignature
      ): ProviderResult<CompletionItem[] | CompletionList> => {
        return Promise.resolve(next(document, position, context, token)).then((res: CompletionItem[] | CompletionList) => {
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
            if (item.documentation) {
              item.data = item.data || {}
              item.data.detail = typeof item.documentation == 'string' ? item.documentation : item.documentation.value
              item.documentation = null
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

  subscriptions.push(
    services.registLanguageClient(client)
  )

  client.onReady().then(() => {
    for (let doc of workspace.documents) {
      onDocumentCreate(doc.textDocument)
    }
    let associations: ISchemaAssociations = {}
    for (let item of catalog.schemas) {
      let { fileMatch, url } = item
      if (Array.isArray(fileMatch)) {
        for (let key of fileMatch) {
          associations[key] = [url]
        }
      } else if (typeof fileMatch === 'string') {
        associations[fileMatch] = [url]
      }
    }

    associations['coc-settings.json'] = ['vscode://settings']
    associations['app.json'] = [Uri.file(context.asAbsolutePath('data/app.json')).toString()]
    client.sendNotification('json/schemaAssociations', associations)

    client.onRequest('vscode/content', async uri => {
      if (uri == 'vscode://settings') {
        let schema: any = Object.assign({}, settingsSchema)
        schema.properties = schema.properties || {}
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
      logger.error(`Unknown schema for ${uri}`)
      return '{}'
    })
  }, _e => {
    // noop
  })

  const projectFile = await findUp('project.config.json', { cwd: workspace.root })
  const miniProgrameRoot = projectFile ? path.dirname(projectFile) : null

  function onDocumentCreate(document: TextDocument): void {
    if (!workspace.match(selector, document)) return
    if (client.serviceState !== ServiceStat.Running) return
    let file = Uri.parse(document.uri).fsPath
    let associations: ISchemaAssociations = {}
    let content = document.getText()
    if (content.indexOf('"$schema"') !== -1) return
    if (miniProgrameRoot) {
      if (path.dirname(file) == miniProgrameRoot) {
        return
      }
      let arr = ['page', 'component'].map(str => {
        return Uri.file(context.asAbsolutePath(`data/${str}.json`)).toString()
      })
      associations[file] = arr
    }
    if (Object.keys(associations).length > 0) {
      client.sendNotification('json/schemaAssociations', associations)
    }

  }
  workspace.onDidOpenTextDocument(onDocumentCreate, null, subscriptions)
}

function getSettings(): Settings {
  let httpSettings = workspace.getConfiguration('http')
  let schemas: JSONSchemaSettings[] = []
  extensions.all.forEach(extension => {
    let { packageJSON } = extension
    let { contributes } = packageJSON
    if (!contributes) return
    let { jsonValidation } = contributes
    if (jsonValidation && jsonValidation.length) {
      for (let item of jsonValidation) {
        let { url } = item
        let file = path.join(extension.extensionPath, url)
        if (fs.existsSync(file)) item.url = Uri.file(file).toString()
        schemas.push(item)
      }
    }
  })

  let settings: Settings = {
    http: {
      proxy: httpSettings.get('proxy'),
      proxyStrictSSL: httpSettings.get('proxyStrictSSL')
    },
    json: {
      format: workspace.getConfiguration('json').get('format'),
      schemas
    }
  }
  let schemaSettingsById: { [schemaId: string]: JSONSchemaSettings } = Object.create(null)
  let collectSchemaSettings = (schemaSettings: JSONSchemaSettings[], rootPath?: string, fileMatchPrefix?: string) => {
    for (let setting of schemaSettings) {
      let url = getSchemaId(setting, rootPath)
      if (!url) {
        continue
      }
      let schemaSetting = schemaSettingsById[url]
      if (!schemaSetting) {
        schemaSetting = schemaSettingsById[url] = { url, fileMatch: [] }
        settings.json!.schemas!.push(schemaSetting)
      }
      let fileMatches = setting.fileMatch
      let resultingFileMatches = schemaSetting.fileMatch!
      if (Array.isArray(fileMatches)) {
        if (fileMatchPrefix) {
          for (let fileMatch of fileMatches) {
            if (fileMatch[0] === '/') {
              resultingFileMatches.push(fileMatchPrefix + fileMatch)
              resultingFileMatches.push(fileMatchPrefix + '/*' + fileMatch)
            } else {
              resultingFileMatches.push(fileMatchPrefix + '/' + fileMatch)
              resultingFileMatches.push(fileMatchPrefix + '/*/' + fileMatch)
            }
          }
        } else {
          resultingFileMatches.push(...fileMatches)
        }

      }
      if (setting.schema) {
        schemaSetting.schema = setting.schema
      }
    }
  }

  // merge global and folder settings. Qualify all file matches with the folder path.
  let globalSettings = workspace.getConfiguration('json', null).get<JSONSchemaSettings[]>('schemas')
  if (Array.isArray(globalSettings)) {
    collectSchemaSettings(globalSettings, workspace.root)
  }
  return settings
}

function getSchemaId(schema: JSONSchemaSettings, rootPath?: string): string {
  let url = schema.url
  if (!url) {
    if (schema.schema) {
      url = schema.schema.id || `vscode://schemas/custom/${encodeURIComponent(hash(schema.schema).toString(16))}`
    }
  } else if (rootPath && (url[0] === '.' || url[0] === '/')) {
    url = Uri.file(path.normalize(path.join(rootPath, url))).toString()
  }
  return url
}

function readFile(fullpath: string, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(fullpath, encoding, (err, content) => {
      if (err) reject(err)
      resolve(content)
    })
  })
}
