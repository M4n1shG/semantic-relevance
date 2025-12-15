/**
 * RSS Source Adapter
 *
 * Fetches and parses RSS/Atom feeds.
 */

/**
 * Fetch items from RSS feeds
 *
 * @param {Object} options - Fetch options
 * @param {Array<{url: string, name: string, source: string}>} options.feeds - Feed configs
 * @param {number} options.maxItemsPerFeed - Max items per feed (default: 20)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} Array of normalized items
 */
export async function fetchRSS(options = {}) {
  const {
    feeds = [],
    maxItemsPerFeed = 20,
    onProgress = null
  } = options;

  const allItems = [];

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];

    if (onProgress) {
      onProgress({ current: i + 1, total: feeds.length, term: feed.name || feed.url });
    }

    try {
      const response = await fetchWithTimeout(feed.url, {
        headers: {
          'User-Agent': 'semantic-relevance/1.0',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
        }
      });

      if (!response.ok) {
        console.error(`RSS fetch error for ${feed.name}: HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const items = parseRSSFeed(xml, feed.source || feed.name || 'rss');

      allItems.push(...items.slice(0, maxItemsPerFeed));

      await sleep(300);
    } catch (error) {
      console.error(`RSS fetch error for ${feed.name}:`, error.message);
    }
  }

  return allItems;
}

/**
 * Parse RSS/Atom XML into items
 */
function parseRSSFeed(xml, source) {
  const items = [];

  // Try RSS <item> format
  const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = rssItemRegex.exec(xml)) !== null) {
    const item = parseItemXml(match[1], source);
    if (item) items.push(item);
  }

  // Try Atom <entry> format if no RSS items found
  if (items.length === 0) {
    const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const item = parseItemXml(match[1], source);
      if (item) items.push(item);
    }
  }

  return items;
}

/**
 * Parse individual item/entry XML
 */
function parseItemXml(xml, source) {
  const title = extractTag(xml, 'title');
  const link = extractLink(xml);
  const description = extractTag(xml, 'description') ||
                      extractTag(xml, 'summary') ||
                      extractTag(xml, 'content');
  const pubDate = extractTag(xml, 'pubDate') ||
                  extractTag(xml, 'published') ||
                  extractTag(xml, 'updated');
  const author = extractTag(xml, 'author') ||
                 extractTag(xml, 'dc:creator');

  if (!title || !link) return null;

  // Create a stable ID from the link
  const id = `${source}:${hashString(link)}`;

  return {
    id,
    source,
    title: cleanText(title).slice(0, 300),
    description: cleanText(description).slice(0, 500),
    url: link,
    metadata: {
      published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      author: cleanText(author),
      fetched_at: new Date().toISOString()
    }
  };
}

/**
 * Extract tag content (handles CDATA)
 */
function extractTag(xml, tag) {
  const regex = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );
  const match = xml.match(regex);
  return match ? (match[1] || match[2] || '').trim() : null;
}

/**
 * Extract link (handles both RSS and Atom formats)
 */
function extractLink(xml) {
  // RSS format: <link>url</link>
  let match = xml.match(/<link>([^<]+)<\/link>/i);
  if (match) return match[1].trim();

  // Atom format: <link href="url" />
  match = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (match) return match[1].trim();

  // guid as fallback
  match = xml.match(/<guid[^>]*>([^<]+)<\/guid>/i);
  if (match && match[1].startsWith('http')) return match[1].trim();

  return null;
}

/**
 * Clean text by removing HTML tags and extra whitespace
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple string hash for creating IDs
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default { fetchRSS };
