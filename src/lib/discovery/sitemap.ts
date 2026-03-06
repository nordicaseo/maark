const LOC_REGEX = /<loc>([\s\S]*?)<\/loc>/gim;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractLocEntries(xml: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = LOC_REGEX.exec(xml)) !== null) {
    const raw = decodeXmlEntities(String(match[1] || '').trim());
    if (!raw) continue;
    out.push(raw);
  }
  return out;
}

export async function fetchSitemapUrls(args: {
  sitemapUrl: string;
  maxUrls?: number;
  maxSitemaps?: number;
}): Promise<{ urls: string[]; visitedSitemaps: string[] }> {
  const maxUrls = Math.max(100, Math.min(args.maxUrls ?? 20000, 100000));
  const maxSitemaps = Math.max(1, Math.min(args.maxSitemaps ?? 60, 200));

  const visited = new Set<string>();
  const discovered = new Set<string>();
  const queue: string[] = [args.sitemapUrl];

  while (queue.length > 0 && visited.size < maxSitemaps && discovered.size < maxUrls) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let xml = '';
    try {
      const res = await fetch(current, {
        headers: {
          'User-Agent': 'MaarkDiscovery/1.0 (+https://maark.ai)',
          Accept: 'application/xml,text/xml,text/plain,*/*',
        },
      });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }

    const locs = extractLocEntries(xml);
    const isIndex = /<sitemapindex/i.test(xml);
    if (isIndex) {
      for (const loc of locs) {
        if (!visited.has(loc) && queue.length < maxSitemaps * 2) {
          queue.push(loc);
        }
      }
      continue;
    }

    for (const loc of locs) {
      if (discovered.size >= maxUrls) break;
      discovered.add(loc);
    }
  }

  return {
    urls: Array.from(discovered),
    visitedSitemaps: Array.from(visited),
  };
}
