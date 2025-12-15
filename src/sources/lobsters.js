/**
 * Lobsters Source Adapter
 *
 * Fetches stories from Lobsters (lobste.rs), a computing-focused
 * link aggregation site similar to Hacker News.
 */

const LOBSTERS_API = 'https://lobste.rs';

/**
 * Fetch stories from Lobsters
 *
 * @param {Object} options - Fetch options
 * @param {string} options.feed - Feed type: 'hottest', 'newest', 'active' (default: 'hottest')
 * @param {number} options.maxItems - Maximum items to return (default: 25)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} Array of normalized items
 */
export async function fetchLobsters(options = {}) {
  const {
    feed = 'hottest',
    maxItems = 25,
    onProgress = null
  } = options;

  const items = [];

  try {
    if (onProgress) {
      onProgress({ status: 'fetching', feed });
    }

    const url = `${LOBSTERS_API}/${feed}.json`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'semantic-relevance/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Lobsters API error: ${response.status}`);
    }

    const data = await response.json();

    for (const story of data.slice(0, maxItems)) {
      items.push(normalizeLobstersStory(story));
    }

    if (onProgress) {
      onProgress({ status: 'done', count: items.length });
    }
  } catch (error) {
    console.error('Lobsters fetch error:', error.message);
    if (onProgress) {
      onProgress({ status: 'error', error: error.message });
    }
  }

  return items;
}

/**
 * Normalize a Lobsters story to standard item format
 */
function normalizeLobstersStory(story) {
  return {
    id: `lobsters:${story.short_id}`,
    source: 'lobsters',
    title: story.title,
    description: story.description || story.title,
    url: story.url || story.comments_url,
    metadata: {
      score: story.score,
      comments: story.comment_count,
      tags: story.tags || [],
      submitter: story.submitter_user,
      created_at: story.created_at,
      comments_url: story.comments_url
    }
  };
}

/**
 * Fetch with timeout support
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default { fetchLobsters };
