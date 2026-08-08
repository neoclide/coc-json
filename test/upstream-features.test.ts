import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { commands, services, Uri, workspace, type Document } from 'coc.nvim'
import { URI } from 'vscode-uri'
import { parseSchemaRegistry } from '../src/schemaAssociations'
import { matchesUrlPattern } from '../src/trustedDomains'

describe('trusted schema domains', () => {
  it('matches full domains and uris', () => {
    const url = URI.parse('https://www.example.com/schemas/x.json')
    assert.equal(matchesUrlPattern(url, { 'https://www.example.com': true }), true)
    assert.equal(matchesUrlPattern(url, { 'https://www.example.com/schemas/x.json': true }), true)
    assert.equal(matchesUrlPattern(url, { 'https://www.example.com': false }), false)
    assert.equal(matchesUrlPattern(url, { 'http://www.example.com': true }), false)
  })

  it('supports wildcard subdomains and path prefixes', () => {
    assert.equal(matchesUrlPattern(URI.parse('https://sub.example.com/a.json'), { 'https://*.example.com': true }), true)
    assert.equal(matchesUrlPattern(URI.parse('https://other.com/a.json'), { 'https://*.example.com': true }), false)
    assert.equal(matchesUrlPattern(URI.parse('https://example.com/schemas/a.json'), { 'https://example.com/schemas/': true }), true)
    assert.equal(matchesUrlPattern(URI.parse('https://example.com/other/a.json'), { 'https://example.com/schemas/': true }), false)
  })

  it('supports the wildcard pattern and treats localhost as trusted', () => {
    assert.equal(matchesUrlPattern(URI.parse('https://example.com/a.json'), { '*': false }), false)
    assert.equal(matchesUrlPattern(URI.parse('http://localhost:3000/a.json'), {}), true)
    assert.equal(matchesUrlPattern(URI.parse('http://127.0.0.1/a.json'), {}), true)
  })
})

describe('jsonValidationRegistry', () => {
  it('parses registry files and skips invalid entries', () => {
    const associations = parseSchemaRegistry(JSON.stringify({
      schemas: [
        { url: 'https://www.schemastore.org/webextension.json', fileMatch: ['manifest.json'] },
        { url: 'https://example.com/no-match.json' },
        { url: 42, fileMatch: ['x.json'] },
        { url: 'https://example.com/bad-match.json', fileMatch: [1] }
      ]
    }))
    assert.deepEqual(associations, [
      { uri: 'https://www.schemastore.org/webextension.json', fileMatch: ['manifest.json'] }
    ])
  })
})

describe('json.validate and json/validateAll', () => {
  it('registers the json.validate command', () => {
    assert.equal(commands.has('json.validate'), true)
  })

  it('validates content against a schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-validate-'))
    const schemaFile = path.join(dir, 'schema.json')
    const scratchFile = path.join(dir, 'scratch.json')
    const schemaUri = Uri.file(schemaFile).toString()
    fs.writeFileSync(schemaFile, '{"type":"object","properties":{"a":{"type":"string"}}}\n')
    fs.writeFileSync(scratchFile, '{}\n')
    const client = services.getService('json').client
    assert.ok(client)
    try {
      await openJsonFile(scratchFile)
      await waitForClientStarted(client)
      const diagnostics = (await commands.executeCommand('json.validate', schemaUri, '{"a": 1}')) as { message: string }[]
      assert.ok(diagnostics.some(d => d.message.includes('Incorrect type')))
      const valid = (await commands.executeCommand('json.validate', schemaUri, '{"a": "x"}')) as { message: string }[]
      assert.equal(valid.some(d => d.message.includes('Incorrect type')), false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes json/validateAll', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-validateall-'))
    const scratchFile = path.join(dir, 'scratch.json')
    fs.writeFileSync(scratchFile, '{}\n')
    const client = services.getService('json').client
    assert.ok(client)
    try {
      await openJsonFile(scratchFile)
      await waitForClientStarted(client)
      await client.sendRequest('json/validateAll', null)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

async function openJsonFile(file: string): Promise<Document> {
  await workspace.nvim.command(`edit ${file}`)
  const doc = await waitForCurrentDocument()
  await workspace.nvim.command('setf json')
  await waitForDocumentLanguageId(doc, 'json')
  return doc
}

function waitForCurrentDocument(timeoutMs = 15000): Promise<Document> {
  const current = workspace.getDocument(workspace.bufnr)
  if (current) return Promise.resolve(current)
  return new Promise<Document>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('current document did not open in time')), timeoutMs)
    const disposable = workspace.onDidOpenTextDocument(() => {
      const doc = workspace.getDocument(workspace.bufnr)
      if (!doc || doc.bufnr !== workspace.bufnr) return
      clearTimeout(timer)
      disposable.dispose()
      resolve(doc)
    })
  })
}

function waitForDocumentLanguageId(doc: Document, expected: string, timeoutMs = 15000): Promise<void> {
  if (doc.languageId === expected) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`document languageId did not become ${expected}`)), timeoutMs)
    const disposable = workspace.onDidOpenTextDocument(() => {
      if (doc.languageId !== expected) return
      clearTimeout(timer)
      disposable.dispose()
      resolve()
    })
  })
}

function waitForClientStarted(client: { started: boolean; onReady(): Promise<void> }, timeoutMs = 30000): Promise<void> {
  if (client.started) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('json language client did not start in time')), timeoutMs)
    client.onReady().then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
