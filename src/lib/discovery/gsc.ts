interface GscRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface GscResponse {
  rows?: GscRow[];
}

function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function fetchGscTopPages(args: {
  property: string;
  accessToken: string;
  maxPages?: number;
  daysBack?: number;
}): Promise<Array<{ url: string; clicks: number; impressions: number }>> {
  const maxPages = Math.max(100, Math.min(args.maxPages ?? 2000, 5000));
  const daysBack = Math.max(30, Math.min(args.daysBack ?? 90, 180));
  const endDate = new Date();
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const rows: Array<{ url: string; clicks: number; impressions: number }> = [];
  const rowLimit = 250;
  let startRow = 0;

  while (rows.length < maxPages) {
    const body = {
      startDate: formatDateUTC(startDate),
      endDate: formatDateUTC(endDate),
      dimensions: ['page'],
      rowLimit,
      startRow,
      dataState: 'all',
    };

    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      throw new Error(`GSC search analytics request failed: ${res.status}`);
    }

    const json = (await res.json()) as GscResponse;
    const chunk = (json.rows || [])
      .map((row) => {
        const url = String(row.keys?.[0] || '').trim();
        if (!url) return null;
        return {
          url,
          clicks: Number(row.clicks || 0),
          impressions: Number(row.impressions || 0),
        };
      })
      .filter((item): item is { url: string; clicks: number; impressions: number } => Boolean(item));

    if (chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < rowLimit) break;
    startRow += rowLimit;
  }

  return rows
    .sort((a, b) => {
      const scoreA = a.clicks * 10 + a.impressions;
      const scoreB = b.clicks * 10 + b.impressions;
      return scoreB - scoreA;
    })
    .slice(0, maxPages);
}

