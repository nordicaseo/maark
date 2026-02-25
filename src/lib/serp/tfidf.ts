const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'that', 'this', 'it', 'its', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'about', 'these', 'those', 'also',
  'like', 'get', 'make', 'one', 'two', 'new', 'use', 'way', 'many',
  'much', 'any', 'first', 'last', 'well', 'even', 'back', 'see', 'know',
  'take', 'come', 'good', 'time', 'need', 'want', 'look', 'think',
  'people', 'work', 'day', 'part', 'thing', 'right', 'going', 'still',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export class TfIdf {
  private documents: string[][] = [];
  private df = new Map<string, number>();

  addDocument(text: string) {
    const tokens = tokenize(text);
    this.documents.push(tokens);
    const unique = new Set(tokens);
    for (const term of unique) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
  }

  getCorpusTopTerms(limit = 50): { term: string; score: number; docFrequency: number }[] {
    const N = this.documents.length;
    if (N === 0) return [];

    const aggregated = new Map<string, { totalScore: number; count: number }>();

    for (let i = 0; i < N; i++) {
      const doc = this.documents[i];
      const tf = new Map<string, number>();
      for (const term of doc) {
        tf.set(term, (tf.get(term) || 0) + 1);
      }

      for (const [term, count] of tf) {
        const idf = Math.log(1 + N / (1 + (this.df.get(term) || 0)));
        const tfidf = (count / doc.length) * idf;
        const existing = aggregated.get(term) || { totalScore: 0, count: 0 };
        existing.totalScore += tfidf;
        existing.count += 1;
        aggregated.set(term, existing);
      }
    }

    return Array.from(aggregated.entries())
      .map(([term, { totalScore, count }]) => ({
        term,
        score: totalScore / count,
        docFrequency: this.df.get(term) || 0,
      }))
      .filter((t) => t.term.length > 2)
      .filter((t) => t.docFrequency >= Math.max(2, Math.floor(N * 0.3)))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export function extractEntities(texts: string[]): { term: string; frequency: number; sources: number }[] {
  const entityCounts = new Map<string, { freq: number; docs: Set<number> }>();

  texts.forEach((text, docIdx) => {
    // Find capitalized words not at sentence start
    const sentences = text.split(/[.!?]+/);
    for (const sent of sentences) {
      const words = sent.trim().split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        const word = words[i].replace(/[^a-zA-Z'-]/g, '');
        if (
          word.length > 2 &&
          word[0] === word[0].toUpperCase() &&
          word[0] !== word[0].toLowerCase() &&
          !STOP_WORDS.has(word.toLowerCase())
        ) {
          const key = word;
          const existing = entityCounts.get(key) || { freq: 0, docs: new Set() };
          existing.freq++;
          existing.docs.add(docIdx);
          entityCounts.set(key, existing);
        }
      }

      // Also extract multi-word entities (2-3 consecutive capitalized words)
      for (let i = 1; i < words.length - 1; i++) {
        const w1 = words[i].replace(/[^a-zA-Z'-]/g, '');
        const w2 = words[i + 1]?.replace(/[^a-zA-Z'-]/g, '');
        if (
          w1.length > 1 &&
          w2?.length > 1 &&
          w1[0] === w1[0].toUpperCase() &&
          w2[0] === w2[0].toUpperCase() &&
          w1[0] !== w1[0].toLowerCase() &&
          w2[0] !== w2[0].toLowerCase()
        ) {
          const key = `${w1} ${w2}`;
          const existing = entityCounts.get(key) || { freq: 0, docs: new Set() };
          existing.freq++;
          existing.docs.add(docIdx);
          entityCounts.set(key, existing);
        }
      }
    }
  });

  return Array.from(entityCounts.entries())
    .filter(([, v]) => v.docs.size >= 2)
    .map(([term, v]) => ({
      term,
      frequency: v.freq,
      sources: v.docs.size,
    }))
    .sort((a, b) => b.sources - a.sources || b.frequency - a.frequency)
    .slice(0, 30);
}
