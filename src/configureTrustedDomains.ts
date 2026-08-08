import { commands, ExtensionContext, extensions, QuickPickItem, window, workspace } from 'coc.nvim'
import { URI } from 'vscode-uri'
import catalog from './catalog.json'
import { patternMatches } from './schemaAssociations'

const TRUSTED_DOMAINS_KEY = 'json.schemaDownload.trustedDomains'
let trustNoticeShown = false

/**
 * Merge a domain or uri pattern into json.schemaDownload.trustedDomains.
 */
export async function updateTrustedDomains(pattern: string): Promise<void> {
  const config = workspace.getConfiguration('json.schemaDownload')
  const current = config.get('trustedDomains', {}) as Record<string, boolean>
  if (current[pattern] === true) {
    return
  }
  const next = { ...current, [pattern]: true }
  await config.update('trustedDomains', next, true)
}

/**
 * Collect the domains of schemas that can be associated with the given file
 * (catalog + json.schemas entries whose fileMatch matches the document).
 */
export function getCandidateDomains(uri: string): string[] {
  const domains = new Set<string>()
  const collect = (url: string, fileMatch: string[]): void => {
    if (!fileMatch.some(pattern => patternMatches(pattern, uri))) {
      return
    }
    try {
      const parsed = URI.parse(url)
      if (parsed.scheme === 'http' || parsed.scheme === 'https') {
        domains.add(`${parsed.scheme}://${parsed.authority}`)
      }
    } catch {
      // ignore invalid urls
    }
  }
  for (const entry of catalog.schemas) {
    collect(entry.url, entry.fileMatch ?? [])
  }
  const userSchemas = workspace.getConfiguration('json').get('schemas', []) as { url?: string; fileMatch?: string[] }[]
  for (const schema of userSchemas) {
    if (typeof schema.url === 'string') {
      collect(schema.url, schema.fileMatch ?? [])
    }
  }
  // Extension jsonValidation contributions are associated with the document on
  // the server, so their http(s) domains belong in the trust candidates too.
  for (const extension of extensions.all) {
    const jsonValidations = extension.packageJSON?.contributes?.jsonValidation
    if (!Array.isArray(jsonValidations)) {
      continue
    }
    for (const jsonValidation of jsonValidations) {
      if (typeof jsonValidation?.url !== 'string') {
        continue
      }
      const fileMatch = typeof jsonValidation.fileMatch === 'string'
        ? [jsonValidation.fileMatch]
        : Array.isArray(jsonValidation.fileMatch)
          ? jsonValidation.fileMatch
          : []
      collect(jsonValidation.url, fileMatch)
    }
  }
  return [...domains].sort()
}

/**
 * Compute the next trustedDomains value after the user checked/unchecked
 * candidate domains. Entries outside the candidate list are preserved.
 */
export function applyDomainSelection(current: Record<string, boolean>, domains: string[], selected: string[]): Record<string, boolean> {
  const checked = new Set(selected)
  const next = { ...current }
  for (const domain of domains) {
    if (checked.has(domain)) {
      next[domain] = true
    } else {
      delete next[domain]
    }
  }
  return next
}

/**
 * The scheme://authority of an http(s) url, e.g. https://www.example.com.
 */
export function getDomain(uri: string): string | undefined {
  try {
    const parsed = URI.parse(uri)
    if (parsed.scheme === 'http' || parsed.scheme === 'https') {
      return `${parsed.scheme}://${parsed.authority}`
    }
  } catch {
    // ignore invalid urls
  }
  return undefined
}

/**
 * Record a schema download domain in json.schemaDownload.trustedDomains.
 * Domains are trusted by default, so this only remembers that the domain was
 * seen; the user can block or unblock it later via :CocConfig.
 */
export async function recordTrustedDomain(schemaUri: string): Promise<void> {
  const domain = getDomain(schemaUri)
  if (!domain) {
    return
  }
  const config = workspace.getConfiguration('json.schemaDownload')
  const current = config.get('trustedDomains', {}) as Record<string, boolean>
  if (domain in current) {
    return
  }
  const next = { ...current, [domain]: true }
  await config.update('trustedDomains', next, true)
  if (!trustNoticeShown && process.env.COC_TESTER !== '1') {
    trustNoticeShown = true
    void window.showInformationMessage('Schema domains are trusted by default. Use :CocConfig to configure json.schemaDownload.trustedDomains.')
  }
}

/**
 * Expose the upstream `_json.configureTrustedDomains` command to users.
 */
export function registerConfigureTrustedDomains(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand('json.configureTrustedDomains', async () => {
    const doc = await workspace.document
    if (!doc || !doc.attached || (doc.languageId !== 'json' && doc.languageId !== 'jsonc')) {
      void window.showErrorMessage('current buffer is not a json document')
      return
    }
    const config = workspace.getConfiguration('json.schemaDownload')
    const current = config.get('trustedDomains', {}) as Record<string, boolean>
    const domains = getCandidateDomains(doc.uri)
    if (domains.length === 0) {
      void window.showInformationMessage('No schemas associated with the current file')
      return
    }
    const items: QuickPickItem[] = domains.map(domain => ({
      label: domain,
      description: current[domain] === true ? 'Trusted' : 'Allow all schemas from this domain',
      picked: current[domain] === true
    }))
    const selected = await window.showQuickPick(items, {
      placeholder: 'Select domains to trust for schema downloads (toggle with <C-space>)',
      canPickMany: true
    })
    if (!selected) {
      return
    }
    const next = applyDomainSelection(current, domains, selected.map(item => item.label))
    await config.update('trustedDomains', next, true)
  }))
}
