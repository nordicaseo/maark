function stripCodeFences(input: string): string {
  const fenced = input.trim().match(/^```(?:html|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return input;
}

export function isLikelyHtml(input: string): boolean {
  return /<\s*(p|h1|h2|h3|h4|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img|a|div|span)\b/i.test(
    input
  );
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .split(/\n{2,}/)
    .map((chunk) => `<p>${chunk.replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

export function normalizeGeneratedHtml(input: string): string {
  const withoutFences = stripCodeFences(input);
  let html = withoutFences
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br /><br />')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!isLikelyHtml(html)) {
    html = textToHtml(html);
  }

  return html;
}
