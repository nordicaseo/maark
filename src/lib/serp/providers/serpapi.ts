export interface SerpApiCompetitor {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet?: string;
}

export interface SerpApiResult {
  provider: 'serpapi';
  competitors: SerpApiCompetitor[];
  raw?: unknown;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export async function fetchSerpApiOrganic(args: {
  keyword: string;
  location?: string;
  hl?: string;
}): Promise<SerpApiResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error('SERPAPI_KEY is not configured');
  }

  const params = new URLSearchParams({
    engine: 'google',
    q: args.keyword,
    api_key: apiKey,
    location: args.location || 'United States',
    hl: args.hl || 'en',
    num: '10',
  });

  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`SerpAPI request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    error?: string;
    organic_results?: Array<{
      position?: number;
      link?: string;
      title?: string;
      snippet?: string;
    }>;
  };

  if (json.error) {
    throw new Error(`SerpAPI error: ${json.error}`);
  }

  const competitors = (json.organic_results || [])
    .filter((item) => typeof item.link === 'string')
    .map((item) => {
      const url = String(item.link || '').trim();
      return {
        rank: Number(item.position || 0),
        url,
        domain: getDomain(url),
        title: String(item.title || '').trim() || url,
        ...(item.snippet ? { snippet: String(item.snippet).trim() } : {}),
      };
    })
    .filter((item) => item.url && item.domain)
    .slice(0, 10);

  if (competitors.length === 0) {
    throw new Error('SerpAPI returned no organic competitors');
  }

  return {
    provider: 'serpapi',
    competitors,
    raw: json,
  };
}

