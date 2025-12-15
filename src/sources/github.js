/**
 * GitHub Source Adapter
 *
 * Fetches trending/relevant repositories from GitHub's search API.
 */

const GITHUB_API = 'https://api.github.com/search/repositories';

/**
 * Fetch repositories from GitHub
 *
 * @param {Object} options - Fetch options
 * @param {string[]} options.topics - Topics to search for
 * @param {string[]} options.keywords - Keywords to search for
 * @param {number} options.minStars - Minimum star count (default: 10)
 * @param {number} options.daysBack - How many days back to search (default: 7)
 * @param {number} options.maxItems - Maximum items to return (default: 50)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} Array of normalized items
 */
export async function fetchGitHub(options = {}) {
  const {
    topics = [],
    keywords = [],
    minStars = 10,
    daysBack = 7,
    maxItems = 50,
    onProgress = null
  } = options;

  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceDate = since.toISOString().split('T')[0];

  const items = [];
  const seen = new Set();
  const searchTerms = [...topics.map(t => `topic:${t}`), ...keywords];

  for (let i = 0; i < searchTerms.length; i++) {
    const term = searchTerms[i];

    if (onProgress) {
      onProgress({ current: i + 1, total: searchTerms.length, term });
    }

    try {
      const query = term.startsWith('topic:')
        ? `${term} created:>${sinceDate} stars:>=${minStars}`
        : `${term} pushed:>${sinceDate} stars:>=${minStars}`;

      const url = `${GITHUB_API}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=15`;

      const response = await fetchWithTimeout(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'semantic-relevance/1.0'
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          // Rate limited - wait and continue
          await sleep(5000);
          continue;
        }
        continue;
      }

      const data = await response.json();

      for (const repo of data.items || []) {
        if (seen.has(repo.full_name)) continue;
        seen.add(repo.full_name);

        items.push(normalizeGitHubRepo(repo));
      }

      // Be polite to GitHub API
      await sleep(800);
    } catch (error) {
      console.error(`GitHub fetch error for "${term}":`, error.message);
    }
  }

  // Sort by stars and limit
  return items
    .sort((a, b) => (b.metadata.stars || 0) - (a.metadata.stars || 0))
    .slice(0, maxItems);
}

/**
 * Normalize a GitHub repository to standard item format
 */
function normalizeGitHubRepo(repo) {
  return {
    id: `github:${repo.full_name}`,
    source: 'github',
    title: repo.full_name,
    description: [
      repo.description || '',
      repo.language ? `Language: ${repo.language}` : '',
      repo.topics?.length ? `Topics: ${repo.topics.join(', ')}` : ''
    ].filter(Boolean).join('. '),
    url: repo.html_url,
    metadata: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      topics: repo.topics || [],
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      open_issues: repo.open_issues_count,
      owner: repo.owner?.login,
      avatar: repo.owner?.avatar_url
    }
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export default { fetchGitHub };
