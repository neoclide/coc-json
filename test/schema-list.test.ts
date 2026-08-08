import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { commands, services, Uri, workspace, type CancellationToken, type Document, type ListContext, type ListItem, type Memento } from 'coc.nvim'
import JsonSchemaList, { SELECTION_KEY } from '../src/schemaList'
import { associateSchemaWithFile, patternMatches, removeSchemaForFile } from '../src/schemaAssociations'

describe('schema association helpers', () => {
  it('matches fileMatch patterns against document uris', () => {
    const uri = 'file:///home/user/project/src/manifest.json'
    assert.equal(patternMatches('manifest.json', uri), true)
    assert.equal(patternMatches('**/webapp/manifest.json', uri), false)
    assert.equal(patternMatches('**/src/manifest.json', uri), true)
    assert.equal(patternMatches('**/project/*/manifest.json', uri), true)
    assert.equal(patternMatches('aspire-manifest.json', uri), false)
    assert.equal(patternMatches('/home/user/project/src/manifest.json', uri), true)
    assert.equal(patternMatches('file:///home/user/project/src/manifest.json', uri), true)
    assert.equal(patternMatches('*.schema.json', 'file:///a/b/foo.schema.json'), true)
    assert.equal(patternMatches('*.schema.json', 'file:///a/b/schema.json'), false)
  })

  it('merges a schema association and removes it again', () => {
    const schemaUri = 'https://www.schemastore.org/webextension.json'
    const file = '/home/user/project/src/manifest.json'
    const next = associateSchemaWithFile([], schemaUri, file)
    assert.deepEqual(next, [{ url: schemaUri, fileMatch: [file] }])
    const merged = associateSchemaWithFile(next, schemaUri, file)
    assert.equal(merged.length, 1)
    assert.deepEqual(merged[0].fileMatch, [file])
    const withOther = associateSchemaWithFile(merged, 'https://www.schemastore.org/foxx-manifest.json', '/other/manifest.json')
    assert.equal(withOther.length, 2)
    const cleared = removeSchemaForFile(withOther, file)
    assert.equal(cleared.length, 1)
    assert.equal(cleared[0].url, 'https://www.schemastore.org/foxx-manifest.json')
  })
})

describe('json.selectSchema', () => {
  it('registers the selectSchema command', () => {
    assert.equal(commands.has('json.selectSchema'), true)
  })

  it('lists catalog schemas that match the current file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-list-'))
    const file = path.join(dir, 'manifest.json')
    fs.writeFileSync(file, '{"name": "demo"}\n')
    const mock = createMockMemento()
    const list = new JsonSchemaList(mock.memento)
    try {
      await openJsonFile(file, 'json')
      const items = await list.loadItems(createListContext(), createToken())
      const labels = items.map(item => item.label)
      assert.ok(labels.some(label => label.includes('Foxx Manifest')))
      assert.ok(labels.some(label => label.includes('WebExtensions')))
      assert.ok(labels.some(label => label.includes('Web App Manifest')))
      assert.ok(labels.some(label => label.includes('No schema')))
      assert.equal(labels.some(label => label.includes('aspire-manifest')), false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists the chosen schema in globalState and binds the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-select-'))
    const file = path.join(dir, 'manifest.json')
    const schemaFile = path.join(dir, 'user-schema.json')
    const schemaUri = Uri.file(schemaFile).toString()
    const uri = Uri.file(file).toString()
    fs.writeFileSync(file, '{"name": "demo"}\n')
    fs.writeFileSync(schemaFile, '{"type":"object","required":["manifest_version"]}\n')
    const mock = createMockMemento()
    const list = new JsonSchemaList(mock.memento)
    const client = services.getService('json').client
    assert.ok(client)
    try {
      await openJsonFile(file, 'json')
      await waitForClientStarted(client)
      list.actions[0].execute({ data: { schemaUri, uri } } as unknown as ListItem, createListContext())
      await waitFor(() => (mock.data[SELECTION_KEY] as Record<string, string> | undefined)?.[uri] === schemaUri)
      await waitForSchemaStatus(client, uri, schemas => schemas.includes(schemaUri))

      list.actions[0].execute({ data: { schemaUri: null, uri } } as unknown as ListItem, createListContext())
      await waitFor(() => (mock.data[SELECTION_KEY] as Record<string, string> | undefined)?.[uri] === undefined)
      await waitForSchemaStatus(client, uri, schemas => !schemas.includes(schemaUri))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

function createMockMemento(): { memento: Memento; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  const memento = {
    get: <T>(key: string, defaultValue?: T): T => (key in data ? (data[key] as T) : (defaultValue as T)),
    update: async (key: string, value: unknown): Promise<void> => {
      data[key] = value
    }
  } as unknown as Memento
  return { memento, data }
}

function createListContext(): ListContext {
  return {
    input: '',
    cwd: process.cwd(),
    options: {},
    args: [],
    buffer: { id: workspace.bufnr }
  } as unknown as ListContext
}

function createToken(): CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as unknown as CancellationToken
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

async function waitForSchemaStatus(
  client: { sendRequest(method: string, params: unknown): Promise<unknown> },
  uri: string,
  predicate: (schemas: string[]) => boolean,
  timeoutMs = 20000
): Promise<string[]> {
  const started = Date.now()
  let last: string[] = []
  while (Date.now() - started < timeoutMs) {
    const status = (await client.sendRequest('json/languageStatus', uri)) as { schemas: string[] }
    last = status.schemas
    if (predicate(last)) {
      return last
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`schema status did not match in time: ${JSON.stringify(last)}`)
}

async function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('condition did not become true in time')
}

async function openJsonFile(file: string, filetype: string): Promise<Document> {
  await workspace.nvim.command(`edit ${file}`)
  const doc = await waitForCurrentDocument()
  await workspace.nvim.command(`setf ${filetype}`)
  await waitForDocumentLanguageId(doc, filetype)
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
