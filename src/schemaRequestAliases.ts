/** Keep server schema IDs associated with their canonical HTTP cache keys. */
export class SchemaRequestAliases {
  private aliases = new Map<string, { requestUrl: string }>()

  record(schemaId: string, requestUrl: string): void {
    if (schemaId !== requestUrl) this.aliases.set(schemaId, { requestUrl })
  }

  async clear(clearCache: () => Promise<string[]>): Promise<string[]> {
    const before = new Map(this.aliases)
    const schemaIds = new Set(await clearCache())
    for (const [schemaId, alias] of this.aliases) {
      if (schemaIds.has(alias.requestUrl)) schemaIds.add(schemaId)
      // Retain requests that completed while the cache was being cleared.
      if (before.get(schemaId) === alias) this.aliases.delete(schemaId)
    }
    return [...schemaIds]
  }
}
