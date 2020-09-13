import { URI } from 'vscode-uri'

export interface RequestService {
  getContent(uri: string, encoding?: string): Thenable<string>
}

export function getScheme(uri: string): string {
  return uri.substr(0, uri.indexOf(':'))
}

export function dirname(uri: string): string {
  const lastIndexOfSlash = uri.lastIndexOf('/')
  return lastIndexOfSlash !== -1 ? uri.substr(0, lastIndexOfSlash) : ''
}

export function basename(uri: string): string {
  const lastIndexOfSlash = uri.lastIndexOf('/')
  return uri.substr(lastIndexOfSlash + 1)
}

const Slash = '/'.charCodeAt(0)
const Dot = '.'.charCodeAt(0)

export function isAbsolutePath(path: string): boolean {
  return path.charCodeAt(0) === Slash
}

export function resolvePath(uri: URI, path: string): URI {
  if (isAbsolutePath(path)) {
    return uri.with({ path: normalizePath(path.split('/')) })
  }
  return joinPath(uri, path)
}

export function normalizePath(parts: string[]): string {
  const newParts: string[] = []
  for (const part of parts) {
    if (part.length === 0 || part.length === 1 && part.charCodeAt(0) === Dot) {
      // ignore
    } else if (part.length === 2 && part.charCodeAt(0) === Dot && part.charCodeAt(1) === Dot) {
      newParts.pop()
    } else {
      newParts.push(part)
    }
  }
  if (parts.length > 1 && parts[parts.length - 1].length === 0) {
    newParts.push('')
  }
  let res = newParts.join('/')
  if (parts[0].length === 0) {
    res = '/' + res
  }
  return res
}

export function joinPath(uri: URI, ...paths: string[]): URI {
  const parts = uri.path.split('/')
  for (let path of paths) {
    parts.push(...path.split('/'))
  }
  return uri.with({ path: normalizePath(parts) })
}
