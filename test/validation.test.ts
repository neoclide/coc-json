import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { diagnosticManager, DiagnosticSeverity, Uri, workspace, type Diagnostic, type Document } from 'coc.nvim'

interface DiagnosticTracker {
  get(): Diagnostic[]
  dispose(): void
}

describe('json validation severity', () => {
  it('reports comments and trailing commas in json by default', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-default-'))
    const file = path.join(dir, 'bad.json')
    const uri = Uri.file(file).toString()
    fs.writeFileSync(file, '{\n  // comment\n  "a": 1,\n}\n')
    const tracker = trackDiagnostics(uri)
    try {
      await resetSeveritySettings()
      await openJsonFile(file, 'json')
      const diagnostics = await waitForDiagnostics(tracker, diags => diags.length > 0)
      assert.ok(diagnostics.some(d => d.message.includes('Comments are not permitted')))
      assert.ok(diagnostics.some(d => d.message.includes('Trailing comma')))
      assert.equal(diagnostics.every(d => d.severity === DiagnosticSeverity.Error), true)
    } finally {
      tracker.dispose()
      await workspace.getConfiguration('json.validate').update('comments', undefined, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores comments when json.validate.comments is set to ignore', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-comments-'))
    const file = path.join(dir, 'bad.json')
    const uri = Uri.file(file).toString()
    fs.writeFileSync(file, '{\n  // comment\n  "a": 1,\n}\n')
    const tracker = trackDiagnostics(uri)
    try {
      await openJsonFile(file, 'json')
      await waitForDiagnostics(tracker, diags => diags.some(d => d.message.includes('Comments are not permitted')))
      await workspace.getConfiguration('json.validate').update('comments', 'ignore', true)
      const diagnostics = await waitForDiagnostics(tracker, diags => diags.length > 0 && !diags.some(d => d.message.includes('Comments are not permitted')))
      assert.equal(diagnostics.some(d => d.message.includes('Comments are not permitted')), false)
      // The trailing comma diagnostic is still reported.
      assert.ok(diagnostics.some(d => d.message.includes('Trailing comma')))
    } finally {
      tracker.dispose()
      await workspace.getConfiguration('json.validate').update('comments', undefined, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports trailing commas as warnings when json.validate.trailingCommas is set to warning', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-trailing-'))
    const file = path.join(dir, 'bad.json')
    const uri = Uri.file(file).toString()
    fs.writeFileSync(file, '{\n  "a": 1,\n}\n')
    const tracker = trackDiagnostics(uri)
    try {
      await openJsonFile(file, 'json')
      await waitForDiagnostics(tracker, diags => diags.some(d => d.message.includes('Trailing comma')))
      await workspace.getConfiguration('json.validate').update('trailingCommas', 'warning', true)
      const diagnostics = await waitForDiagnostics(tracker, diags => diags.some(d => d.message.includes('Trailing comma') && d.severity === DiagnosticSeverity.Warning))
      assert.equal(diagnostics.find(d => d.message.includes('Trailing comma'))?.severity, DiagnosticSeverity.Warning)
    } finally {
      tracker.dispose()
      await workspace.getConfiguration('json.validate').update('trailingCommas', undefined, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports schema validation errors when json.validate.schemaValidation is set to error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-schema-'))
    const schemaFile = path.join(dir, 'schema.json')
    const dataFile = path.join(dir, 'severity-check.json')
    const schemaUri = Uri.file(schemaFile).toString()
    const dataUri = Uri.file(dataFile).toString()
    fs.writeFileSync(schemaFile, '{"type":"object","properties":{"a":{"type":"string"}}}\n')
    fs.writeFileSync(dataFile, '{"a": 1}\n')
    const tracker = trackDiagnostics(dataUri)
    try {
      await openJsonFile(dataFile, 'json')
      // Update the schema association after the document is open: opening a
      // document can reload the workspace folder configuration from disk and
      // discard earlier in-memory configuration changes.
      await workspace.getConfiguration('json').update('schemas', [
        { fileMatch: ['severity-check.json'], url: schemaUri }
      ], true)
      await workspace.getConfiguration('json.validate').update('schemaValidation', 'error', true)
      const diagnostics = await waitForDiagnostics(tracker, diags => diags.some(d => d.message.includes('Incorrect type') && d.severity === DiagnosticSeverity.Error))
      assert.ok(diagnostics.some(d => d.message.includes('Incorrect type') && d.severity === DiagnosticSeverity.Error))

      await workspace.getConfiguration('json.validate').update('schemaValidation', 'ignore', true)
      const afterIgnore = await waitForDiagnostics(tracker, diags => diags.length === 0 || !diags.some(d => d.message.includes('Incorrect type')))
      assert.equal(afterIgnore.some(d => d.message.includes('Incorrect type')), false)
    } finally {
      tracker.dispose()
      await workspace.getConfiguration('json').update('schemas', [], true)
      await workspace.getConfiguration('json.validate').update('schemaValidation', undefined, true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

async function resetSeveritySettings(): Promise<void> {
  const config = workspace.getConfiguration('json.validate')
  await config.update('comments', undefined, true)
  await config.update('trailingCommas', undefined, true)
  await config.update('schemaValidation', undefined, true)
  await config.update('schemaRequest', undefined, true)
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

function trackDiagnostics(uri: string): DiagnosticTracker {
  let current: Diagnostic[] = []
  const disposable = diagnosticManager.onDidRefresh(params => {
    if (params.uri === uri) {
      current = params.diagnostics.slice()
    }
  })
  return {
    get: () => current.slice(),
    dispose: () => disposable.dispose()
  }
}

function waitForDiagnostics(tracker: DiagnosticTracker, predicate: (diagnostics: Diagnostic[]) => boolean, timeoutMs = 20000): Promise<Diagnostic[]> {
  const current = tracker.get()
  if (predicate(current)) return Promise.resolve(current)
  return new Promise<Diagnostic[]>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, diagnostics?: Diagnostic[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      if (error) {
        reject(error)
      } else {
        resolve(diagnostics!)
      }
    }
    const timer = setTimeout(() => {
      finish(new Error(`diagnostics did not match in time: ${JSON.stringify(tracker.get().map(d => ({ message: d.message, severity: d.severity })))}`))
    }, timeoutMs)
    const poll = setInterval(() => {
      const diagnostics = tracker.get()
      if (predicate(diagnostics)) {
        finish(undefined, diagnostics)
      }
    }, 100)
  })
}
