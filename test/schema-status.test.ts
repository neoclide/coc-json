import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { commands, workspace } from 'coc.nvim'
import { buildSchemaItems, formatSchemaContent, getExtensionSchemaUrls, previewSchemaContent } from '../src/schemaStatus'

describe('json.showSchemaList', () => {
  it('registers the showSchemaList command', () => {
    assert.equal(commands.has('json.showSchemaList'), true)
  })

  it('labels catalog schemas and marks their source', () => {
    const uri = 'https://www.schemastore.org/webextension.json'
    const items = buildSchemaItems([uri], new Set(), new Map())
    assert.equal(items.length, 1)
    assert.equal(items[0].label, 'WebExtensions')
    assert.equal(items[0].description, 'Catalog schema')
  })

  it('marks schemas configured in json.schemas', () => {
    const uri = 'https://www.schemastore.org/webextension.json'
    const items = buildSchemaItems([uri], new Set([uri]), new Map())
    assert.equal(items[0].description, 'Configured in json.schemas')
  })

  it('collects schema urls contributed by extensions', () => {
    const urls = getExtensionSchemaUrls()
    assert.equal(urls.get('http://json-schema.org/draft-07/schema#'), 'coc-json')
  })

  it('falls back to the url for unknown schemas', () => {
    const uri = 'https://example.com/custom-schema.json'
    const items = buildSchemaItems([uri], new Set(), new Map())
    assert.equal(items[0].label, 'custom-schema.json')
    assert.equal(items[0].description, undefined)
  })

  it('formats json content and keeps invalid content as-is', () => {
    assert.equal(formatSchemaContent('{"a":1}'), '{\n  "a": 1\n}')
    assert.equal(formatSchemaContent('not json'), 'not json')
  })

  it('previews a remote schema in a scratch buffer', async () => {
    const schema = '{"type":"object","properties":{"a":{"type":"string"}}}'
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(schema)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address() as AddressInfo
    try {
      await previewSchemaContent(`http://127.0.0.1:${address.port}/schema.json`)
      const expected = JSON.stringify(JSON.parse(schema), null, 2)
      let lines: unknown[] = []
      const started = Date.now()
      while (lines.join('\n') !== expected && Date.now() - started < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100))
        lines = (await workspace.nvim.call('getline', [1, '$'])) as unknown[]
      }
      assert.equal(lines.join('\n'), expected)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
