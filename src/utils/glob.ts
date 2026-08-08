/*---------------------------------------------------------------------------------------------
 *  Glob matching ported from vscode-json-languageservice (MIT).
 *  The language server matches schema fileMatch patterns with the same
 *  semantics, so the candidate list must agree with it.
 *--------------------------------------------------------------------------------------------*/

export interface GlobOptions {
  extended?: boolean
  globstar?: boolean
  flags?: string
}

export function createRegex(glob: string, opts?: GlobOptions): RegExp {
  const str = String(glob)
  const extended = opts ? !!opts.extended : false
  const globstar = opts ? !!opts.globstar : false
  const flags = opts && typeof opts.flags === 'string' ? opts.flags : ''
  let reStr = ''
  let inGroup = false
  for (let i = 0, len = str.length; i < len; i++) {
    const c = str[i]
    switch (c) {
      case '/':
      case '$':
      case '^':
      case '+':
      case '.':
      case '(':
      case ')':
      case '=':
      case '!':
      case '|':
        reStr += '\\' + c
        break
      case '?':
        if (extended) {
          reStr += '.'
          break
        }
        reStr += '\\?'
        break
      case '[':
      case ']':
        if (extended) {
          reStr += c
          break
        }
        reStr += '\\' + c
        break
      case '{':
        if (extended) {
          inGroup = true
          reStr += '('
          break
        }
        reStr += '\\{'
        break
      case '}':
        if (extended) {
          inGroup = false
          reStr += ')'
          break
        }
        reStr += '\\}'
        break
      case ',':
        if (inGroup) {
          reStr += '|'
          break
        }
        reStr += '\\,'
        break
      case '*': {
        const prevChar = str[i - 1]
        let starCount = 1
        while (str[i + 1] === '*') {
          starCount++
          i++
        }
        const nextChar = str[i + 1]
        if (!globstar) {
          reStr += '.*'
        } else {
          const isGlobstar = starCount > 1
            && (prevChar === '/' || prevChar === undefined || prevChar === '{' || prevChar === ',')
            && (nextChar === '/' || nextChar === undefined || nextChar === ',' || nextChar === '}')
          if (isGlobstar) {
            if (nextChar === '/') {
              i++
            } else if (prevChar === '/' && reStr.endsWith('\\/')) {
              reStr = reStr.substr(0, reStr.length - 2)
            }
            reStr += '((?:[^/]*(?:\\/|$))*)'
          } else {
            reStr += '([^/]*)'
          }
        }
        break
      }
      default:
        reStr += c
    }
  }
  if (!flags || !~flags.indexOf('g')) {
    reStr = '^' + reStr + '$'
  }
  return new RegExp(reStr, flags)
}
