import { URI } from 'vscode-uri'
import { createRegex } from './utils/glob'

export interface JSONSchemaSetting {
  fileMatch?: string[]
  url?: string
  schema?: any
}

export interface SchemaAssociation {
  fileMatch: string[]
  uri: string
}

/**
 * Parse a jsonValidationRegistry file: { schemas: [{ url, fileMatch }] }.
 */
export function parseSchemaRegistry(content: string): SchemaAssociation[] {
  const result: SchemaAssociation[] = []
  const data = JSON.parse(content) as { schemas?: { url?: string; fileMatch?: string[] }[] }
  if (Array.isArray(data.schemas)) {
    for (const schema of data.schemas) {
      if (typeof schema?.url === 'string' && Array.isArray(schema.fileMatch) && schema.fileMatch.every(fm => typeof fm === 'string')) {
        result.push({ fileMatch: schema.fileMatch, uri: schema.url })
      }
    }
  }
  return result
}

/**
 * Whether a schema fileMatch pattern can match the given resource, using the
 * same semantics as the language server's FilePatternAssociation.
 */
export function patternMatches(pattern: string, resource: string): boolean {
  if (!pattern || pattern[0] === '!') {
    return false
  }
  let normalized = pattern
  if (normalized[0] === '/') {
    normalized = normalized.substring(1)
  }
  let resourceUri: string
  try {
    resourceUri = URI.parse(resource).with({ fragment: null, query: null }).toString(true)
  } catch {
    resourceUri = resource
  }
  return createRegex('**/' + normalized, { extended: true, globstar: true }).test(resourceUri)
}

/**
 * Associate a schema with the given file by merging it into json.schemas.
 */
export function associateSchemaWithFile(settings: JSONSchemaSetting[], schemaUri: string, file: string): JSONSchemaSetting[] {
  const next = settings.map(s => ({ ...s, fileMatch: s.fileMatch ? s.fileMatch.slice() : [] }))
  const existing = next.find(s => s.url === schemaUri)
  if (existing) {
    if (!existing.fileMatch!.includes(file)) {
      existing.fileMatch!.push(file)
    }
  } else {
    next.push({ url: schemaUri, fileMatch: [file] })
  }
  return next
}

/**
 * Remove the association of the given file from json.schemas. Entries that
 * become empty (and carry no inline schema) are dropped.
 */
export function removeSchemaForFile(settings: JSONSchemaSetting[], file: string): JSONSchemaSetting[] {
  const next: JSONSchemaSetting[] = []
  for (const setting of settings) {
    const fileMatch = (setting.fileMatch ?? []).filter(p => p !== file)
    if (fileMatch.length === 0 && !setting.schema) {
      continue
    }
    const entry: JSONSchemaSetting = { ...setting }
    if (fileMatch.length > 0) {
      entry.fileMatch = fileMatch
    } else {
      delete entry.fileMatch
    }
    next.push(entry)
  }
  return next
}
