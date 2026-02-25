export function tokenizeWords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z]+'?[a-z]*/g);
  return matches ?? [];
}

export function tokenizeSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function getParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}