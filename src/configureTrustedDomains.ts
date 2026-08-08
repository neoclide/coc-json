import { commands, ExtensionContext, QuickPickItem, window, workspace } from 'coc.nvim'
import { URI } from 'vscode-uri'

const TRUSTED_DOMAINS_KEY = 'json.schemaDownload.trustedDomains'

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

interface TrustItem extends QuickPickItem {
  kind: 'domain' | 'uri' | 'settings'
}

/**
 * Ask the user how to trust an untrusted schema location. Returns whether the
 * domain or uri was added to the trusted domains.
 */
export async function promptConfigureTrustedDomains(schemaUri: string): Promise<boolean> {
  const uri = URI.parse(schemaUri)
  const domain = `${uri.scheme}://${uri.authority}`
  const items: TrustItem[] = [
    { label: `Trust Domain: ${domain}`, description: 'Allow all schemas from this domain', kind: 'domain' },
    { label: `Trust URI: ${schemaUri}`, description: 'Allow only this specific schema', kind: 'uri' },
    { label: 'Open coc-settings.json', description: 'Configure json.schemaDownload.trustedDomains', kind: 'settings' }
  ]
  const picked = await window.showQuickPick(items, {
    placeholder: 'Select how to configure trusted schema domains'
  })
  if (!picked) {
    return false
  }
  if (picked.kind === 'domain') {
    await updateTrustedDomains(domain)
  } else if (picked.kind === 'uri') {
    await updateTrustedDomains(schemaUri)
  } else {
    void window.openLocalConfig()
  }
  return picked.kind === 'domain' || picked.kind === 'uri'
}

/**
 * Expose the upstream `_json.configureTrustedDomains` command to users.
 */
export function registerConfigureTrustedDomains(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand('json.configureTrustedDomains', async (schemaUri?: string) => {
    let input = schemaUri
    if (typeof input !== 'string' || input.length === 0) {
      input = await window.requestInput('Schema URL to trust')
    }
    if (!input || input.length === 0) {
      return
    }
    await promptConfigureTrustedDomains(input)
  }))
}
