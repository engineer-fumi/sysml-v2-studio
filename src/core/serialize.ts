import { SysMLElement } from "./ast";

/**
 * AST transfer between the extension host and the diagram webview.
 * `parent` pointers make the tree circular, so they are stripped for
 * JSON serialization and restored on the receiving side.
 */

export interface SerializedModelFile {
  /** uri of the source document (used to jump back to the editor) */
  uri: string;
  /** display name (workspace-relative path) */
  name: string;
  /** parse tree with parent pointers stripped */
  ast: SysMLElement;
}

export function stripParents(el: SysMLElement): SysMLElement {
  const { parent: _parent, ...rest } = el;
  return { ...rest, children: el.children.map(stripParents) };
}

export function restoreParents(el: SysMLElement): SysMLElement {
  for (const c of el.children) {
    c.parent = el;
    restoreParents(c);
  }
  return el;
}
