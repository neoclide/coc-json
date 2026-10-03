import { URI } from 'vscode-uri'

/** Expand only an anchored workspace variable, preserving exclusion patterns. */
export function expandWorkspaceFolder(fileMatch: string, folder: URI | undefined): string {
  if (!folder || typeof fileMatch !== 'string') return fileMatch
  const exclusion = fileMatch.startsWith('!') ? '!' : ''
  const pattern = fileMatch.substring(exclusion.length)
  const prefix = '${workspaceFolder}/'
  if (!pattern.startsWith(prefix)) return fileMatch
  const folderPath = folder.path
    .replace(/^\/[A-Z]:/, s => s.toLowerCase())
    .replace(/[#?]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\/$/, '')
    .replace(/[*?{}[\],\\]/g, c => `\\x${c.charCodeAt(0).toString(16)}`)
  return exclusion + folderPath + '/' + pattern.substring(prefix.length)
}
