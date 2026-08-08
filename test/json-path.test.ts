import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { commands, Uri, workspace, type Document } from 'coc.nvim'
import { formatJsonPath, getJsonPath } from '../src/jsonPath'

const GLOSSARY = '{\n  "glossary": {\n    "GlossDiv": {\n      "GlossList": {\n        "GlossEntry": { "GlossTerm": "SGML" }\n      }\n    }\n  }\n}\n'

function offsetOf(lineIndex: number, columnIndex: number): number {
  const lines = GLOSSARY.split('\n')
  let offset = 0
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i].length + 1
  }
  return offset + columnIndex
}

describe('json path helpers', () => {
  it('resolves the path of a nested property', () => {
    const line = GLOSSARY.split('\n').findIndex(l => l.includes('GlossTerm'))
    const column = GLOSSARY.split('\n')[line].indexOf('GlossTerm') + 5
    const segments = getJsonPath(GLOSSARY, offsetOf(line, column))
    assert.deepEqual(segments, ['glossary', 'GlossDiv', 'GlossList', 'GlossEntry', 'GlossTerm'])
    assert.equal(formatJsonPath(segments!), 'glossary.GlossDiv.GlossList.GlossEntry.GlossTerm')
  })

  it('includes array indices', () => {
    const text = '{\n  "list": [\n    { "name": "a" },\n    { "name": "b" }\n  ]\n}\n'
    const offset = text.indexOf('"name": "b"') + 9
    const segments = getJsonPath(text, offset)
    assert.deepEqual(segments, ['list', '[1]', 'name'])
    assert.equal(formatJsonPath(segments!), 'list[1].name')
  })

  it('returns undefined for an empty path', () => {
    assert.equal(getJsonPath('{ "a": 1 }', 0), undefined)
  })

  it('handles jsonc comments and trailing commas', () => {
    const text = '{\n  // comment\n  "a": 1,\n  "b": {\n    "c": true,\n  },\n}\n'
    const offset = text.indexOf('"c"') + 6
    assert.deepEqual(getJsonPath(text, offset), ['b', 'c'])
  })

  it('resolves the path when the cursor is on a property key', () => {
    const text = '{\n  "name": "demo"\n}\n'
    const offset = text.indexOf('"name"') + 2
    assert.deepEqual(getJsonPath(text, offset), ['name'])
  })

  it('resolves the path inside an array of objects', () => {
    const text = '{\n  "items": [\n    { "id": 1 },\n    { "id": 2 }\n  ]\n}\n'
    const offset = text.indexOf('"id": 2') + 5
    assert.deepEqual(getJsonPath(text, offset), ['items', '[1]', 'id'])
  })
})

describe('json.copy', () => {
  it('registers the command and keymap', async () => {
    assert.equal(commands.has('json.copy'), true)
    const mapping = (await workspace.nvim.call('maparg', ['<Plug>(coc-json-copy)', 'n'])) as string
    assert.ok(mapping && mapping.length > 0)
  })

  it('copies the json path at the cursor', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-json-copy-'))
    const file = path.join(dir, 'glossary.json')
    fs.writeFileSync(file, GLOSSARY)
    try {
      await openJsonFile(file, 'json')
      const line = GLOSSARY.split('\n').findIndex(l => l.includes('GlossTerm')) + 1
      const column = GLOSSARY.split('\n')[line - 1].indexOf('GlossTerm') + 6
      await workspace.nvim.command(`call cursor(${line}, ${column})`)
      await commands.executeCommand('json.copy')
      const register = (await workspace.nvim.call('getreg', ['"'])) as string
      assert.equal(register, 'glossary.GlossDiv.GlossList.GlossEntry.GlossTerm')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
