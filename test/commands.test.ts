import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { commands, services, Uri, workspace, type Diagnostic, type Document } from 'coc.nvim'

describe('json commands', () => {
  it('sorts the current json document with json.sort', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-sort-'))
    const file = path.join(dir, 'unsorted.json')
    const uri = Uri.file(file).toString()
    // The trailing comma makes the first validation pull non-empty, which
    // proves the document is open on the server before the sort request.
    fs.writeFileSync(file, '{\n  "z": 1,\n  "a": 2,\n}')
    try {
      await openJsonFile(file, 'json')
      await waitForClientStarted()
      await waitForServerDocument(uri)
      await commands.executeCommand('json.sort')
      const content = await waitForDocumentContent(uri, text => text === '{\n  "a": 2,\n  "z": 1\n}')
      assert.equal(content, '{\n  "a": 2,\n  "z": 1\n}')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('json.sort does not change non-json buffers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-sort-guard-'))
    const file = path.join(dir, 'plain.txt')
    const uri = Uri.file(file).toString()
    const content = 'z = 1\na = 2\n'
    fs.writeFileSync(file, content)
    try {
      await openJsonFile(file, 'text')
      await commands.executeCommand('json.sort')
      const doc = workspace.getDocument(uri)
      assert.ok(doc)
      assert.equal(doc.getDocumentContent(), content)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('json.clearCache clears cached schema files', async () => {
    const cacheDir = path.join(process.env.COC_DATA_HOME!, 'extensions', 'coc-json-data', 'json-schema-cache')
    assert.equal(fs.existsSync(cacheDir), true)
    const seedFile = path.join(cacheDir, 'c0ffee.schema.json')
    fs.writeFileSync(seedFile, '{"type":"object"}')
    try {
      await commands.executeCommand('json.clearCache')
      assert.equal(fs.existsSync(seedFile), false)
    } finally {
      if (fs.existsSync(seedFile)) {
        fs.rmSync(seedFile, { force: true })
      }
    }
  })

  it('json.retryResolveSchema executes on a json buffer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-retry-'))
    const file = path.join(dir, 'retry.json')
    const uri = Uri.file(file).toString()
    fs.writeFileSync(file, '{"a": 1,}\n')
    try {
      await openJsonFile(file, 'json')
      await waitForClientStarted()
      await waitForServerDocument(uri)
      await commands.executeCommand('json.retryResolveSchema')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

function waitForClientStarted(timeoutMs = 30000): Promise<void> {
  const service = services.getService('json')
  assert.ok(service)
  const client = service.client
  assert.ok(client)
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

function waitForDocumentContent(uri: string, predicate: (content: string) => boolean, timeoutMs = 15000): Promise<string> {
  const read = (): string | undefined => {
    const doc = workspace.getDocument(uri)
    return doc ? doc.getDocumentContent() : undefined
  }
  const current = read()
  if (current !== undefined && predicate(current)) return Promise.resolve(current)
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, content?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      if (error) {
        reject(error)
      } else {
        resolve(content!)
      }
    }
    const timer = setTimeout(() => {
      finish(new Error(`document content did not match in time: ${JSON.stringify(read())}`))
    }, timeoutMs)
    const poll = setInterval(() => {
      const content = read()
      if (content !== undefined && predicate(content)) {
        finish(undefined, content)
      }
    }, 100)
  })
}

async function waitForServerDocument(uri: string, timeoutMs = 20000): Promise<void> {
  const service = services.getService('json')
  assert.ok(service)
  const client = service.client
  assert.ok(client)
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const diagnostics = (await client.sendRequest('json/validate', uri)) as Diagnostic[]
    if (diagnostics.length > 0) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`server did not open the document in time: ${uri}`)
}
