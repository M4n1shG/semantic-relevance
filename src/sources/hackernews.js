/**
 * Hacker News Source Adapter
 *
 * Fetches stories from Hacker News using the Algolia API.
 * No authentication required.
 */

const HN_SEARCH_API = 'https://hn.algolia.com/api/v1';
const HN_ITEM_URL = 'https://news.ycombinator.com/item?id=';

/**
 * Fetch stories from Hacker News
 *
 * @param {Object} options - Fetch options
 * @param {string[]} options.keywords - Keywords to search for
 * @param {number} options.minPoints - Minimum points (default: 10)
 * @param {number} options.daysBack - How many days back (default: 3)
 * @param {number} options.maxItems - Maximum items to return (default: 50)
 * @param {boolean} options.includeFrontPage - Include front page stories (default: true)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} Array of normalized items
 */
export async function fetchHackerNews(options = {}) {
  const {
    keywords = [],
    minPoints = 10,
    daysBack = 3,
    maxItems = 50,
    includeFrontPage = true,
    onProgress = null
  } = options;

  const items = [];
  const seen = new Set();
  const since = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);

  let step = 0;
  const totalSteps = (includeFrontPage ? 1 : 0) + keywords.length;

  // Fetch front page
  if (includeFrontPage) {
    step++;
    if (onProgress) onProgress({ current: step, total: totalSteps, term: 'front page' });

    try {
      const url = `${HN_SEARCH_API}/search?tags=front_page&hitsPerPage=30`;
      const response = await fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json();
        for (const hit of data.hits || []) {
          if (seen.has(hit.objectID)) continue;
          seen.add(hit.objectID);
          items.push(normalizeHNHit(hit));
        }
      }
    } catch (error) {
      console.error('HN front page fetch error:', error.message);
    }
  }

  // Search by keywords
  for (const keyword of keywords) {
    step++;
    if (onProgress) onProgress({ current: step, total: totalSteps, term: keyword });

    try {
      const url = `${HN_SEARCH_API}/search?query=${encodeURIComponent(keyword)}&tags=story&numericFilters=points>=${minPoints},created_at_i>=${since}&hitsPerPage=20`;

      const response = await fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json();
        for (const hit of data.hits || []) {
          if (seen.has(hit.objectID)) continue;
          seen.add(hit.objectID);
          items.push(normalizeHNHit(hit));
        }
      }

      await sleep(200);
    } catch (error) {
      console.error(`HN search error for "${keyword}":`, error.message);
    }
  }

  // Sort by points and limit
  return items
    .sort((a, b) => (b.metadata.points || 0) - (a.metadata.points || 0))
    .slice(0, maxItems);
}

/**
 * Normalize an HN hit to standard item format
 */
function normalizeHNHit(hit) {
  return {
    id: `hn:${hit.objectID}`,
    source: 'hackernews',
    title: hit.title || 'Untitled',
    description: hit.story_text || hit.title || '',
    url: hit.url || `${HN_ITEM_URL}${hit.objectID}`,
    metadata: {
      points: hit.points || 0,
      comments: hit.num_comments || 0,
      author: hit.author,
      created_at: new Date(hit.created_at_i * 1000).toISOString(),
      hn_url: `${HN_ITEM_URL}${hit.objectID}`
    }
  };
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

export default { fetchHackerNews };
