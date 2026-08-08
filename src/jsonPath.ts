/**
 * Resolve the JSON path of the offset in a json/jsonc document, e.g.
 * ["glossary", "GlossDiv", "GlossList", "GlossEntry", "GlossTerm"].
 * Array indices are returned as "[0]"-style segments.
 *
 * Self-contained scanner so the module can be bundled by both esbuild and the
 * coc-test runner without pulling in jsonc-parser.
 */
export function getJsonPath(content: string, offset: number): string[] | undefined {
  const n = content.length
  if (offset < 0 || offset >= n) {
    return undefined
  }
  const path: string[] = []
  const frames: Array<{ kind: 'object' } | { kind: 'array'; index: number }> = []
  let nextKey: string | undefined
  let i = 0

  const isWhitespace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r'
  const skipWhitespace = (p: number): number => {
    while (p < n && isWhitespace(content[p])) {
      p++
    }
    return p
  }
  const readString = (p: number): { value: string; end: number } => {
    let j = p + 1
    let value = ''
    while (j < n) {
      const ch = content[j]
      if (ch === '\\') {
        if (j + 1 < n) {
          value += content[j + 1]
        }
        j += 2
        continue
      }
      if (ch === '"') {
        break
      }
      value += ch
      j++
    }
    return { value, end: Math.min(j + 1, n) }
  }
  const skipScalar = (p: number): number => {
    let j = p
    while (j < n && !isWhitespace(content[j]) && !',}]'.includes(content[j])) {
      j++
    }
    return j
  }
  const pushValue = (): void => {
    const top = frames[frames.length - 1]
    if (top && top.kind === 'object' && nextKey !== undefined) {
      path.push(nextKey)
      nextKey = undefined
    } else if (top && top.kind === 'array') {
      path.push(`[${top.index}]`)
      top.index++
    }
  }
  const popSegment = (): void => {
    // Every open frame except the root container contributed one segment.
    if (path.length > 0 && path.length > frames.length - 1) {
      path.pop()
    }
  }
  const result = (extraKey?: string): string[] | undefined => {
    const segments = extraKey !== undefined ? [...path, extraKey] : path
    return segments.length > 0 ? segments : undefined
  }

  while (i < n) {
    if (i > offset) {
      return result(nextKey)
    }
    const c = content[i]
    if (c === '"') {
      const { value, end } = readString(i)
      const top = frames[frames.length - 1]
      const after = skipWhitespace(end)
      if (top && top.kind === 'object' && content[after] === ':') {
        // property key
        nextKey = value
        if (i <= offset && offset < end) {
          return result(value)
        }
      } else {
        // string value
        pushValue()
        if (i <= offset && offset < end) {
          return result()
        }
        popSegment()
      }
      i = end
      continue
    }
    if (c === '{') {
      pushValue()
      frames.push({ kind: 'object' })
      i++
      continue
    }
    if (c === '[') {
      pushValue()
      frames.push({ kind: 'array', index: 0 })
      i++
      continue
    }
    if (c === '}' || c === ']') {
      frames.pop()
      popSegment()
      nextKey = undefined
      i++
      continue
    }
    if (c === ',') {
      popSegment()
      nextKey = undefined
      i++
      continue
    }
    if (c === ':') {
      if (i === offset && nextKey !== undefined) {
        return result(nextKey)
      }
      i++
      continue
    }
    if (c === '/') {
      if (content[i + 1] === '/') {
        while (i < n && content[i] !== '\n') {
          i++
        }
      } else if (content[i + 1] === '*') {
        const end = content.indexOf('*/', i + 2)
        i = end === -1 ? n : end + 2
      } else {
        i++
      }
      continue
    }
    if (c === '-' || (c >= '0' && c <= '9') || c === 't' || c === 'f' || c === 'n') {
      pushValue()
      const end = skipScalar(i)
      if (i <= offset && offset < end) {
        return result()
      }
      popSegment()
      i = end
      continue
    }
    i++
  }
  return result(nextKey)
}

/**
 * Join path segments into "glossary.GlossDiv.GlossList[0].GlossTerm" form.
 */
export function formatJsonPath(segments: string[]): string {
  let result = ''
  for (const segment of segments) {
    if (segment.startsWith('[')) {
      result += segment
    } else {
      result = result.length === 0 ? segment : `${result}.${segment}`
    }
  }
  return result
}
