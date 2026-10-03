import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, it } from 'node:test'
import { URI } from 'vscode-uri'
import { SchemaRequestAliases } from '../src/schemaRequestAliases'
import { getSchemaRequestUrl, isSchemaUrlBlocked, matchesUrlPattern } from '../src/trustedDomains'
import { expandWorkspaceFolder } from '../src/utils/schemaFileMatch'

// Load the installed service natively: this coc-test version cannot bundle UMD dependencies.
const { getLanguageService, TextDocument } = createRequire(path.join(process.cwd(), 'package.json'))('vscode-json-languageservice')

describe('upstream schema URL normalization', () => {
  it('checks the effective host, default port and normalized path', () => {
    const disguised = URI.parse('https://blocked.example%5Cfake.trusted.example/schema.json')
    assert.equal(isSchemaUrlBlocked(disguised, { 'https://blocked.example': false }), true)
    assert.equal(isSchemaUrlBlocked(URI.parse('https://blocked.example:443/a/../schema.json'), {
      'https://blocked.example/schema.json': false
    }), true)
    assert.equal(matchesUrlPattern(URI.parse('https://EXAMPLE.com:443/a/../schema.json'), {
      'https://example.com/schema.json': true
    }), true)
    assert.equal(getSchemaRequestUrl(URI.parse('https://example.com:443/a/../schema.json')).href,
      'https://example.com/schema.json')
  })

  it('keeps default trust and localhost behavior while rejecting invalid network URLs', () => {
    assert.equal(isSchemaUrlBlocked(URI.parse('https://unknown.example/a.json'), {}), false)
    assert.equal(isSchemaUrlBlocked(URI.parse('http://127.0.0.1/a.json'), { '*': false }), false)
    assert.equal(isSchemaUrlBlocked(URI.parse('https://example.com:invalid/a.json'), { '*': true }), true)
  })

  it('invalidates all original schema IDs sharing a canonical cache key', async () => {
    const aliases = new SchemaRequestAliases()
    const canonical = 'https://example.com/schema.json'
    aliases.record('https://example.com:443/schema.json', canonical)
    aliases.record('https://example.com/a/../schema.json', canonical)
    assert.deepEqual(await aliases.clear(async () => [canonical]), [canonical,
      'https://example.com:443/schema.json', 'https://example.com/a/../schema.json'])
    assert.deepEqual(await aliases.clear(async () => [canonical]), [canonical])
  })

  it('drops uncached aliases but retains requests completed during clearing', async () => {
    const aliases = new SchemaRequestAliases()
    aliases.record('old', 'canonical')
    await aliases.clear(async () => [])
    assert.deepEqual(await aliases.clear(async () => ['canonical']), ['canonical'])
    aliases.record('fresh', 'canonical')
    await aliases.clear(async () => {
      aliases.record('fresh', 'canonical')
      return []
    })
    assert.deepEqual(await aliases.clear(async () => ['canonical']), ['canonical', 'fresh'])
  })
})

describe('workspaceFolder schema file matches', () => {
  it('expands anchored and excluded patterns without changing ordinary matches', () => {
    const folder = URI.file('/work/project')
    assert.deepEqual([
      expandWorkspaceFolder('${workspaceFolder}/data/*.json', folder),
      expandWorkspaceFolder('!${workspaceFolder}/data/skip.json', folder),
      expandWorkspaceFolder('*.json', folder),
      expandWorkspaceFolder('${workspaceFolder}/data.json', undefined),
      expandWorkspaceFolder('${workspaceFolder}/data.json', URI.parse('file:///C:/project'))
    ], ['/work/project/data/*.json', '!/work/project/data/skip.json', '*.json',
      '${workspaceFolder}/data.json', '/c:/project/data.json'])
  })

  it('matches literal glob characters in folder names using the installed schema service', async () => {
    const folder = URI.file('/work/project[1]')
    const service = getLanguageService({})
    service.configure({ schemas: [{
      uri: 'test://schema',
      fileMatch: [expandWorkspaceFolder('${workspaceFolder}/*.json', folder),
        expandWorkspaceFolder('!${workspaceFolder}/skip.json', folder)],
      schema: { type: 'object', required: ['name'] }
    }] })
    const messages: number[] = []
    for (const file of ['/work/project[1]/data.json', '/work/project1/data.json', '/work/project[1]/skip.json']) {
      const document = TextDocument.create(URI.file(file).toString(), 'json', 1, '{}')
      messages.push((await service.doValidation(document, service.parseJSONDocument(document))).length)
    }
    assert.deepEqual(messages, [1, 0, 0])
  })
})
