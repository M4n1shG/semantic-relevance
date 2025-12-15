/**
 * Reddit Source Adapter
 *
 * Fetches posts from Reddit using the public JSON API.
 * No authentication required for basic usage.
 */

const REDDIT_API = 'https://www.reddit.com';

/**
 * Fetch posts from Reddit
 *
 * @param {Object} options - Fetch options
 * @param {string[]} options.subreddits - Subreddits to fetch from
 * @param {string[]} options.keywords - Keywords to search for
 * @param {number} options.minScore - Minimum score (default: 10)
 * @param {number} options.maxItems - Maximum items per subreddit (default: 25)
 * @param {string} options.sort - Sort order: 'hot', 'new', 'top' (default: 'hot')
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} Array of normalized items
 */
export async function fetchReddit(options = {}) {
  const {
    subreddits = [],
    keywords = [],
    minScore = 10,
    maxItems = 25,
    sort = 'hot',
    onProgress = null
  } = options;

  const items = [];
  const seen = new Set();

  const totalSteps = subreddits.length + (keywords.length > 0 ? 1 : 0);
  let step = 0;

  // Fetch from each subreddit
  for (const subreddit of subreddits) {
    step++;
    if (onProgress) onProgress({ current: step, total: totalSteps, term: `r/${subreddit}` });

    try {
      const url = `${REDDIT_API}/r/${subreddit}/${sort}.json?limit=30`;

      const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'semantic-relevance/1.0' }
      });

      if (!response.ok) continue;

      const data = await response.json();

      for (const post of data.data?.children || []) {
        const p = post.data;
        if (p.score < minScore) continue;
        if (seen.has(p.id)) continue;
        seen.add(p.id);

        items.push(normalizeRedditPost(p));
      }

      await sleep(500);
    } catch (error) {
      console.error(`Reddit fetch error for r/${subreddit}:`, error.message);
    }
  }

  // Search by keywords if provided
  if (keywords.length > 0) {
    step++;
    if (onProgress) onProgress({ current: step, total: totalSteps, term: 'keyword search' });

    for (const keyword of keywords.slice(0, 5)) {
      try {
        const url = `${REDDIT_API}/search.json?q=${encodeURIComponent(keyword)}&sort=relevance&limit=20`;

        const response = await fetchWithTimeout(url, {
          headers: { 'User-Agent': 'semantic-relevance/1.0' }
        });

        if (!response.ok) continue;

        const data = await response.json();

        for (const post of data.data?.children || []) {
          const p = post.data;
          if (p.score < minScore) continue;
          if (seen.has(p.id)) continue;
          seen.add(p.id);

          items.push(normalizeRedditPost(p));
        }

        await sleep(500);
      } catch (error) {
        console.error(`Reddit search error for "${keyword}":`, error.message);
      }
    }
  }

  // Sort by score and limit
  return items
    .sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0))
    .slice(0, maxItems);
}

/**
 * Normalize a Reddit post to standard item format
 */
function normalizeRedditPost(post) {
  return {
    id: `reddit:${post.id}`,
    source: 'reddit',
    title: post.title,
    description: post.selftext?.slice(0, 500) || post.title,
    url: post.url?.startsWith('/') ? `https://reddit.com${post.url}` : (post.url || `https://reddit.com${post.permalink}`),
    metadata: {
      score: post.score,
      upvotes: post.ups,
      comments: post.num_comments,
      subreddit: post.subreddit,
      author: post.author,
      created_at: new Date(post.created_utc * 1000).toISOString(),
      created_utc: post.created_utc,
      reddit_url: `https://reddit.com${post.permalink}`,
      is_self: post.is_self,
      thumbnail: post.thumbnail
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

export default { fetchReddit };
