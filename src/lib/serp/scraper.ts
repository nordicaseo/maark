import * as cheerio from 'cheerio';

interface SerpUrl {
  url: string;
  title: string;
}

export async function fetchSerpUrls(keyword: string): Promise<SerpUrl[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    // Fallback: return empty - user needs to configure API keys
    console.warn('Google CSE API key or ID not configured');
    return [];
  }

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(keyword)}&num=10`;

  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) {
    console.error('Google CSE error:', res.status);
    return [];
  }

  const data = await res.json();
  return (data.items || []).map((item: any) => ({
    url: item.link,
    title: item.title,
  }));
}

export async function scrapePageContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ContentWriter/1.0; +https://example.com)',
      },
    });

    if (!res.ok) return '';

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, nav, footer, header, aside, iframe, noscript, .ad, .ads, .sidebar, .menu, .nav, .footer, .header, .comment, .comments').remove();

    // Try article content first, then main, then body
    let content = $('article').text();
    if (!content || content.length < 200) {
      content = $('main').text();
    }
    if (!content || content.length < 200) {
      content = $('body').text();
    }

    // Clean up whitespace
    return content
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000); // Cap at 10k chars per page
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeSerpContent(keyword: string): Promise<{
  urls: string[];
  texts: string[];
}> {
  const serpUrls = await fetchSerpUrls(keyword);
  if (serpUrls.length === 0) {
    return { urls: [], texts: [] };
  }

  const results = await Promise.allSettled(
    serpUrls.map((item) => scrapePageContent(item.url))
  );

  const urls: string[] = [];
  const texts: string[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.length > 100) {
      urls.push(serpUrls[i].url);
      texts.push(result.value);
    }
  });

  return { urls, texts };
}
