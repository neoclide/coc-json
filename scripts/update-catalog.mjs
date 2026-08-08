import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Same source referenced by the "json.enableDefaultSchemas" configuration
// description in package.json.
const CATALOG_URL = 'https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/api/json/catalog.json'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'src', 'catalog.json')

const response = await fetch(CATALOG_URL)
if (!response.ok) {
  throw new Error(`Failed to download schema catalog: HTTP ${response.status}`)
}
const content = await response.text()

let parsed
try {
  parsed = JSON.parse(content)
} catch (error) {
  throw new Error(`Downloaded schema catalog is not valid JSON: ${error.message}`)
}
if (!Array.isArray(parsed?.schemas)) {
  throw new Error('Downloaded schema catalog has no "schemas" array')
}

await writeFile(target, content)
console.log(`Updated ${path.relative(root, target)} with ${parsed.schemas.length} schemas`)
