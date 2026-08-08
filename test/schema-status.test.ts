import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commands } from 'coc.nvim'
import { buildSchemaItems, getExtensionSchemaUrls } from '../src/schemaStatus'

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
})
