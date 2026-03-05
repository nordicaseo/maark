export interface DataForSeoCompetitor {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet?: string;
}

export interface DataForSeoResult {
  provider: 'dataforseo';
  competitors: DataForSeoCompetitor[];
  raw?: unknown;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export async function fetchDataForSeoOrganic(args: {
  keyword: string;
  locationName?: string;
  languageName?: string;
  depth?: number;
}): Promise<DataForSeoResult> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('DATAFORSEO credentials are not configured');
  }

  const payload = [
    {
      keyword: args.keyword,
      location_name: args.locationName || 'United States',
      language_name: args.languageName || 'English',
      depth: Math.max(5, Math.min(args.depth ?? 10, 20)),
      calculate_rectangles: false,
    },
  ];

  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const response = await fetch(
    'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error(`DataForSEO request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<{
        items?: Array<{
          type?: string;
          rank_group?: number;
          url?: string;
          title?: string;
          description?: string;
        }>;
      }>;
    }>;
  };

  const task = json.tasks?.[0];
  if (!task) {
    throw new Error('DataForSEO returned no tasks');
  }
  if ((task.status_code ?? 0) >= 30000) {
    throw new Error(
      `DataForSEO status ${task.status_code}: ${task.status_message || 'unknown error'}`
    );
  }

  const items = task.result?.[0]?.items || [];
  const competitors = items
    .filter((item) => item.type === 'organic' && typeof item.url === 'string')
    .map((item) => {
      const url = String(item.url || '').trim();
      return {
        rank: Number(item.rank_group || 0),
        url,
        domain: getDomain(url),
        title: String(item.title || '').trim() || url,
        ...(item.description ? { snippet: String(item.description).trim() } : {}),
      };
    })
    .filter((item) => item.url && item.domain)
    .slice(0, 10);

  if (competitors.length === 0) {
    throw new Error('DataForSEO returned no organic competitors');
  }

  return {
    provider: 'dataforseo',
    competitors,
    raw: json,
  };
}

