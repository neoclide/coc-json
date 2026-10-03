import { URI } from 'vscode-uri'

/** Use the same URL parser for policy decisions and HTTP dispatch. */
export function getSchemaRequestUrl(uri: URI): URL {
  return new URL(uri.toString(true))
}

function asMatchableUri(url: URI | URL): URI {
  if (!(url instanceof URL)) {
    if (url.scheme !== 'http' && url.scheme !== 'https') return url
    url = getSchemaRequestUrl(url)
  }
  return URI.parse(url.href).with({ authority: url.host, path: url.pathname })
}

/**
 * Check whether a URL matches the trusted domains or URIs, ported from the
 * upstream json-language-features client.
 *
 * trustedDomains is an object where keys are full domains
 * (https://www.example.com), full URIs or wildcard patterns
 * (https://*.example.com, *), and values indicate trusted (true) or blocked
 * (false).
 */
export function matchesUrlPattern(url: URI | URL, trustedDomains: Record<string, boolean>): boolean {
  try {
    url = asMatchableUri(url)
  } catch {
    return false
  }
  if (isLocalhostAuthority(url.authority)) {
    return true
  }
  for (const [pattern, isTrusted] of Object.entries(trustedDomains)) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      continue
    }
    if (pattern === '*') {
      return isTrusted
    }
    try {
      const patternUri = asMatchableUri(URI.parse(pattern))
      if (url.scheme !== patternUri.scheme) {
        continue
      }
      if (!matchesAuthority(url.authority, patternUri.authority)) {
        continue
      }
      if (!matchesPath(url.path, patternUri.path)) {
        continue
      }
      return isTrusted
    } catch {
      continue
    }
  }
  return false
}

/**
 * Whether a schema url is explicitly blocked. Domains are trusted by default:
 * only a matching pattern with value `false` (or `*: false`) blocks a download,
 * localhost is always allowed.
 */
export function isSchemaUrlBlocked(url: URI | URL, trustedDomains: Record<string, boolean>): boolean {
  try {
    url = asMatchableUri(url)
  } catch {
    return true
  }
  if (isLocalhostAuthority(url.authority)) {
    return false
  }
  for (const [pattern, isTrusted] of Object.entries(trustedDomains)) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      continue
    }
    if (pattern === '*') {
      return !isTrusted
    }
    try {
      const patternUri = asMatchableUri(URI.parse(pattern))
      if (url.scheme !== patternUri.scheme) {
        continue
      }
      if (!matchesAuthority(url.authority, patternUri.authority)) {
        continue
      }
      if (!matchesPath(url.path, patternUri.path)) {
        continue
      }
      return !isTrusted
    } catch {
      continue
    }
  }
  return false
}

function matchesAuthority(urlAuthority: string, patternAuthority: string): boolean {
  urlAuthority = urlAuthority.toLowerCase()
  patternAuthority = patternAuthority.toLowerCase()
  if (patternAuthority === urlAuthority) {
    return true
  }
  if (patternAuthority.startsWith('*.')) {
    const patternDomain = patternAuthority.substring(2)
    return urlAuthority === patternDomain || urlAuthority.endsWith('.' + patternDomain)
  }
  return false
}

function matchesPath(urlPath: string, patternPath: string): boolean {
  if (!patternPath || patternPath === '/') {
    return true
  }
  if (urlPath === patternPath) {
    return true
  }
  if (patternPath.endsWith('/')) {
    return urlPath.startsWith(patternPath)
  }
  return urlPath.startsWith(patternPath + '/') || urlPath === patternPath
}

const rLocalhost = /^(.+\.)?localhost(:\d+)?$/i
const r127 = /^127\.0\.0\.1(:\d+)?$/
const rIPv6Localhost = /^\[::1\](:\d+)?$/

function isLocalhostAuthority(authority: string): boolean {
  return rLocalhost.test(authority) || r127.test(authority) || rIPv6Localhost.test(authority)
}
