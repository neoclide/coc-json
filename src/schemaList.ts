import { CancellationToken, IList, ListAction, ListContext, ListItem, Memento, workspace } from 'coc.nvim'
import catalog from './catalog.json'
import { associateSchemaWithFile, JSONSchemaSetting, patternMatches, removeSchemaForFile } from './schemaAssociations'

export const SELECTION_KEY = 'json-schema-selections'

function yellow(text: string): string {
  return `\u001b[33m${text}\u001b[0m`
}

function gray(text: string): string {
  return `\u001b[90m${text}\u001b[0m`
}

interface Candidate {
  label: string
  description?: string
  url: string
}

export default class JsonSchemaList implements IList {
  public readonly description = 'Select json schema for current file'
  public readonly name = 'jsonschemas'
  public readonly defaultAction = 'choose'
  public actions: ListAction[] = []

  constructor(private globalState: Memento) {
    this.actions.push({
      name: 'choose',
      execute: item => {
        const data = (Array.isArray(item) ? item[0] : item).data
        const { schemaUri, uri } = data
        if (schemaUri) {
          void this.update(uri, schemaUri)
        } else {
          void this.clear(uri)
        }
      },
      multiple: false
    })
  }

  private async update(fileUri: string, schemaUri: string): Promise<void> {
    const settings = workspace.getConfiguration('json').get<JSONSchemaSetting[]>('schemas') ?? []
    await workspace.getConfiguration('json').update('schemas', associateSchemaWithFile(settings, schemaUri, fileUri), true)
    const selections = this.globalState.get<{ [uri: string]: string }>(SELECTION_KEY, {}) ?? {}
    selections[fileUri] = schemaUri
    await this.globalState.update(SELECTION_KEY, selections)
  }

  private async clear(fileUri: string): Promise<void> {
    const settings = workspace.getConfiguration('json').get<JSONSchemaSetting[]>('schemas') ?? []
    await workspace.getConfiguration('json').update('schemas', removeSchemaForFile(settings, fileUri), true)
    const selections = this.globalState.get<{ [uri: string]: string }>(SELECTION_KEY, {}) ?? {}
    delete selections[fileUri]
    await this.globalState.update(SELECTION_KEY, selections)
  }

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    const doc = workspace.getDocument(context.buffer.id)
    if (!doc || !doc.attached) {
      throw new Error('current buffer not attached')
    }
    if (doc.languageId !== 'json' && doc.languageId !== 'jsonc') {
      throw new Error('current buffer is not a json document')
    }
    const uri = doc.uri
    const matches = (pattern: string): boolean => patternMatches(pattern, uri)
    const candidates: Candidate[] = []
    const seen = new Set<string>()
    for (const entry of catalog.schemas) {
      const fileMatch = entry.fileMatch ?? []
      if (fileMatch.some(matches)) {
        candidates.push({ label: entry.name, description: entry.description, url: entry.url })
        seen.add(entry.url)
      }
    }
    const userSettings = workspace.getConfiguration('json').get<JSONSchemaSetting[]>('schemas') ?? []
    for (const setting of userSettings) {
      if (setting.url && !seen.has(setting.url) && (setting.fileMatch ?? []).some(matches)) {
        candidates.push({ label: setting.url, description: 'Configured in json.schemas', url: setting.url })
        seen.add(setting.url)
      }
    }
    if (token.isCancellationRequested) {
      return []
    }

    const selections = this.globalState.get<{ [uri: string]: string }>(SELECTION_KEY, {}) ?? {}
    const selectedUrl = selections[uri]
    const items: ListItem[] = candidates.map(candidate => {
      const label = candidate.url === selectedUrl ? yellow(candidate.label) : candidate.label
      const description = candidate.description ? ` ${gray(candidate.description)}` : ''
      return {
        label: label + description,
        data: { schemaUri: candidate.url, uri }
      }
    })
    items.sort((a, b) => {
      const aSelected = a.data.schemaUri === selectedUrl ? 0 : 1
      const bSelected = b.data.schemaUri === selectedUrl ? 0 : 1
      if (aSelected !== bSelected) {
        return aSelected - bSelected
      }
      return a.label.localeCompare(b.label)
    })
    items.push({
      label: gray('No schema (disable for current file)'),
      data: { schemaUri: null, uri }
    })
    return items
  }
}
