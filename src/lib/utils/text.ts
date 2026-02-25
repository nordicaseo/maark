export function extractPlainText(tiptapJson: any): string {
  if (!tiptapJson || !tiptapJson.content) return '';

  function walk(node: any): string {
    if (node.type === 'text') return node.text || '';
    if (!node.content) return '';

    const texts = node.content.map(walk);
    const joined = texts.join('');

    if (
      ['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem'].includes(
        node.type
      )
    ) {
      return joined + '\n';
    }
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type)) {
      return joined + '\n';
    }
    if (node.type === 'horizontalRule') return '\n---\n';

    return joined;
  }

  return walk(tiptapJson).replace(/\n{3,}/g, '\n\n').trim();
}

export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
