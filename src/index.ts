import path from 'path'
import os from 'os'
import fs from 'fs'
import { ExtensionContext, LanguageClient, ServerOptions, workspace, services, TransportKind, LanguageClientOptions, ServiceStat, ProvideCompletionItemsSignature } from 'coc.nvim'
import { TextDocument, Position, CompletionContext, CancellationToken, CompletionItem, CompletionList, CompletionItemKind } from 'vscode-languageserver-protocol'
import catalog from './catalog.json'
import Uri from 'vscode-uri'

type ProviderResult<T> =
  | T
  | undefined
  | null
  | Thenable<T | undefined | null>

interface ISchemaAssociations {
  [pattern: string]: string[]
}

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions } = context
  const config = workspace.getConfiguration().get('json', {}) as any
  if (!config.enable) return
  const file = context.asAbsolutePath('lib/server/jsonServerMain.js')
  const selector = config.filetypes || ['json', 'jsonc']

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
      configurationSection: ['json', 'http']
    },
    outputChannelName: 'json',
    middleware: {
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
            let { textEdit, insertText, label } = item // tslint:disable-line
            item.insertText = null // tslint:disable-line
            if (textEdit && textEdit.newText) {
              let newText = insertText || textEdit.newText
              textEdit.newText = newText.replace(/(\n|\t)/g, '')
              let { start, end } = textEdit.range
              if (line[start.character] && line[end.character - 1] && /^".*"$/.test(label)) {
                item.label = item.label.slice(1, -1)
              }
            }
          }
          let result: any = {
            isIncomplete: false,
            items
          }
          if (items.length && items[0].kind == CompletionItemKind.Property) {
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
        return JSON.stringify((workspace as any).settingsScheme)
      }
      workspace.showMessage(`Unsupported json uri ${uri}`, 'error')
      return ''
    })
  }, _e => {
    // noop
  })

  const miniProgrameRoot = resolveRoot(workspace.root, ['project.config.json'])

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

export function resolveRoot(cwd: string, subs: string[], home?: string): string | null {
  home = home || os.homedir()
  let { root } = path.parse(cwd)
  let paths = getParentDirs(cwd)
  paths.unshift(cwd)
  for (let p of paths) {
    if (p == home || p == root) return null
    for (let sub of subs) {
      let d = path.join(p, sub)
      if (fs.existsSync(d)) return path.dirname(d)
    }
  }
  return root
}

export function getParentDirs(fullpath: string): string[] {
  let obj = path.parse(fullpath)
  if (!obj || !obj.root) return []
  let res = []
  let p = path.dirname(fullpath)
  while (p && p !== obj.root) {
    res.push(p)
    p = path.dirname(p)
  }
  return res
}
