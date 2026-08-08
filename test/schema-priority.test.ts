import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { services, Uri, workspace, type Document } from 'coc.nvim'

describe('json schema association priority', () => {
  it('a user manifest.json schema overrides catalog schemas that match manifest.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-priority-'))
    const schemaFile = path.join(dir, 'user-schema.json')
    const dataFile = path.join(dir, 'manifest.json')
    const schemaUri = Uri.file(schemaFile).toString()
    const dataUri = Uri.file(dataFile).toString()
    fs.writeFileSync(schemaFile, '{"type":"object","required":["manifest_version"]}\n')
    fs.writeFileSync(dataFile, '{"name": "demo"}\n')
    try {
      await workspace.getConfiguration('json').update('enableDefaultSchemas', true, true)
      await workspace.getConfiguration('json').update('schemas', [
        { fileMatch: ['manifest.json'], url: schemaUri }
      ], true)
      await openJsonFile(dataFile, 'json')
      const client = services.getService('json').client
      assert.ok(client)
      const schemas = await waitForSchemaStatus(client, dataUri, list => list.length === 1 && list[0] === schemaUri)
      assert.deepEqual(schemas, [schemaUri])
    } finally {
      await workspace.getConfiguration('json').update('schemas', [], true)
      await workspace.getConfiguration('json').update('enableDefaultSchemas', false, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a path-scoped user manifest.json pattern also overrides catalog schemas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-priority-'))
    const srcDir = path.join(dir, 'browser-extension', 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const schemaFile = path.join(dir, 'user-schema.json')
    const dataFile = path.join(srcDir, 'manifest.json')
    const schemaUri = Uri.file(schemaFile).toString()
    const dataUri = Uri.file(dataFile).toString()
    fs.writeFileSync(schemaFile, '{"type":"object","required":["manifest_version"]}\n')
    fs.writeFileSync(dataFile, '{"name": "demo"}\n')
    try {
      await workspace.getConfiguration('json').update('enableDefaultSchemas', true, true)
      await workspace.getConfiguration('json').update('schemas', [
        { fileMatch: ['browser-extension/src/manifest.json'], url: schemaUri }
      ], true)
      await openJsonFile(dataFile, 'json')
      const client = services.getService('json').client
      assert.ok(client)
      const schemas = await waitForSchemaStatus(client, dataUri, list => list.length === 1 && list[0] === schemaUri)
      assert.deepEqual(schemas, [schemaUri])
    } finally {
      await workspace.getConfiguration('json').update('schemas', [], true)
      await workspace.getConfiguration('json').update('enableDefaultSchemas', false, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
