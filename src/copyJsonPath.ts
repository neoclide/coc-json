import { commands, ExtensionContext, window, workspace } from 'coc.nvim'
import { formatJsonPath, getJsonPath } from './jsonPath'

export function registerCopyPath(context: ExtensionContext): void {
  const copy = async (): Promise<void> => {
    const doc = await workspace.document
    if (!doc || !doc.attached || (doc.languageId !== 'json' && doc.languageId !== 'jsonc')) {
      void window.showErrorMessage('current buffer is not a json document')
      return
    }
    const position = await window.getCursorPosition()
    const offset = doc.textDocument.offsetAt(position)
    const segments = getJsonPath(doc.getDocumentContent(), offset)
    if (!segments) {
      void window.showErrorMessage('Unable to resolve json path at cursor')
      return
    }
    const text = formatJsonPath(segments)
    try {
      await workspace.nvim.call('setreg', ['+', text])
    } catch {
      // clipboard register may be unavailable, fall back to the unnamed register
    }
    await workspace.nvim.call('setreg', ['"', text])
    void window.showInformationMessage(`Copied json path: ${text}`)
  }

  context.subscriptions.push(commands.registerCommand('json.copy', copy))
  // Users can map it, e.g. `nmap jc <Plug>(coc-json-copy)`.
  context.subscriptions.push(workspace.registerKeymap(['n'], 'json-copy', copy, { silent: true, sync: true }))
}
