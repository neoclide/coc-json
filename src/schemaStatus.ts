import { Extension, extensions, LanguageClient, QuickPickItem, window, workspace } from 'coc.nvim'
import * as path from 'path'
import { URI } from 'vscode-uri'
import catalog from './catalog.json'
import { RequestService } from './requests'

const CATALOG_BY_URL = new Map<string, { name?: string }>()
for (const entry of catalog.schemas) {
  CATALOG_BY_URL.set(entry.url, entry)
}

export interface SchemaListItem {
  label: string
  description?: string
  uri: string
}

interface SchemaQuickPickItem extends QuickPickItem {
  uri: string
}

/**
 * Collect the schema urls contributed by extension jsonValidation sections.
 */
export function getExtensionSchemaUrls(): Map<string, string> {
  const urls = new Map<string, string>()
  for (const extension of extensions.all) {
    const jsonValidations = extension.packageJSON?.contributes?.jsonValidation
    if (!Array.isArray(jsonValidations)) {
      continue
    }
    for (const jsonValidation of jsonValidations) {
      const url = jsonValidation?.url
      if (typeof url !== 'string') {
        continue
      }
      const fullUrl = url.startsWith('./')
        ? URI.file(path.join(extension.extensionPath, url)).toString()
        : url
      urls.set(fullUrl, extension.id)
    }
  }
  return urls
}

/**
 * Build display items for the schemas associated with a document, marking the
 * source of each association (user settings, extension contribution, catalog).
 */
export function buildSchemaItems(
  schemas: string[],
  userSchemaUrls: Set<string> = getConfiguredSchemaUrls(),
  extensionSchemaUrls: Map<string, string> = getExtensionSchemaUrls()
): SchemaListItem[] {
  return schemas
    .filter(uri => !uri.startsWith('vscode://'))
    .map(uri => {
    const catalogEntry = CATALOG_BY_URL.get(uri)
    let label = uri
    if (catalogEntry?.name) {
      label = catalogEntry.name
    } else {
      const short = uri.split('/').pop()
      if (short) {
        label = short
      }
    }
    let description: string | undefined
    if (userSchemaUrls.has(uri)) {
      description = 'Configured in json.schemas'
    } else if (extensionSchemaUrls.has(uri)) {
      description = `Configured by extension: ${extensionSchemaUrls.get(uri)}`
    } else if (catalogEntry) {
      description = 'Catalog schema'
    }
    return { label, description, uri }
  })
}

/**
 * Show the schemas associated with the current document and open the chosen
 * one. Exposes the upstream `_json.showAssociatedSchemaList` behavior as a
 * user-invokable command.
 */
export async function showSchemaList(client: LanguageClient, requestService: RequestService): Promise<void> {
  const doc = await workspace.document
  if (!doc || !doc.attached || (doc.languageId !== 'json' && doc.languageId !== 'jsonc')) {
    return
  }
  const status = (await client.sendRequest('json/languageStatus', doc.uri)) as { schemas: string[] }
  const items = buildSchemaItems(status.schemas)
  if (items.length === 0) {
    void window.showInformationMessage('No schema configured for this file')
    return
  }
  const quickItems: SchemaQuickPickItem[] = items.map(item => ({
    label: item.label,
    description: item.description,
    uri: item.uri
  }))
  const picked = await window.showQuickPick(quickItems, {
    placeholder: `Select the schema to open for ${doc.uri}`
  })
  if (!picked) {
    return
  }
  await openSchema(picked.uri, requestService)
}

async function openSchema(uri: string, requestService: RequestService): Promise<void> {
  const parsed = URI.parse(uri)
  if (parsed.scheme === 'file') {
    await workspace.openResource(uri)
    return
  }
  await previewSchemaContent(uri, requestService)
}

/**
 * Load a remote schema through the cache-aware request service, format it and
 * show it in a temporary unnamed buffer.
 */
export async function previewSchemaContent(uri: string, requestService: RequestService): Promise<void> {
  let content: string
  try {
    const parsed = URI.parse(uri)
    if (parsed.scheme === 'http' || parsed.scheme === 'https') {
      content = await window.withProgress({ title: `Loading schema ${uri}` }, () => requestService.getContent(uri))
    } else {
      content = await requestService.getContent(uri)
    }
  } catch (error: unknown) {
    const message = String(error)
    void window.showErrorMessage(`Unable to load schema ${uri}: ${message}`)
    return
  }
  // Open the scratch buffer only after the content is available.
  await showScratchBuffer(formatSchemaContent(content))
}

export function formatSchemaContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

async function showScratchBuffer(content: string): Promise<void> {
  const buffer = await workspace.nvim.createNewBuffer(true, true)
  await buffer.setLines(content.split('\n'), { start: 0, end: -1, strictIndexing: false })
  await workspace.nvim.call('setbufvar', [buffer.id, '&filetype', 'json'])
  await workspace.nvim.command(`buffer ${buffer.id}`)
}

function getConfiguredSchemaUrls(): Set<string> {
  const settings = workspace.getConfiguration('json').get('schemas', []) as { url?: string }[]
  return new Set(settings.map(s => s.url).filter((url): url is string => typeof url === 'string'))
}
