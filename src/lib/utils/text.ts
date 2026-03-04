import type { JSONContent } from '@tiptap/core';

export function extractPlainText(tiptapJson: JSONContent | null | undefined): string {
  if (!tiptapJson || !tiptapJson.content) return '';

  function walk(node: JSONContent): string {
    if (node.type === 'text') return node.text || '';
    if (!node.content) return '';
    const nodeType = node.type ?? '';

    const texts = node.content.map(walk);
    const joined = texts.join('');

    if (
      ['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem'].includes(
        nodeType
      )
    ) {
      return joined + '\n';
    }
    if (['bulletList', 'orderedList', 'taskList'].includes(nodeType)) {
      return joined + '\n';
    }
    if (nodeType === 'horizontalRule') return '\n---\n';

    return joined;
  }

  return walk(tiptapJson).replace(/\n{3,}/g, '\n\n').trim();
}

export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
