/**
 * Source adapters module
 *
 * Exports all source fetching functionality.
 */

export { fetchGitHub } from './github.js';
export { fetchHackerNews } from './hackernews.js';
export { fetchReddit } from './reddit.js';
export { fetchRSS } from './rss.js';
export { fetchLobsters } from './lobsters.js';

/**
 * Fetch from all sources
 *
 * @param {Object} config - Source configuration
 * @param {Object} config.github - GitHub options
 * @param {Object} config.hackernews - HN options
 * @param {Object} config.reddit - Reddit options
 * @param {Object} config.rss - RSS options
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Combined items from all sources
 */
export async function fetchAllSources(config = {}, onProgress = null) {
  const results = {
    github: [],
    hackernews: [],
    reddit: [],
    rss: [],
    lobsters: []
  };

  const sources = [];

  if (config.github?.enabled !== false && (config.github?.topics?.length || config.github?.keywords?.length)) {
    sources.push({
      name: 'github',
      fetch: async () => {
        const { fetchGitHub } = await import('./github.js');
        return fetchGitHub(config.github);
      }
    });
  }

  if (config.hackernews?.enabled !== false) {
    sources.push({
      name: 'hackernews',
      fetch: async () => {
        const { fetchHackerNews } = await import('./hackernews.js');
        return fetchHackerNews(config.hackernews);
      }
    });
  }

  if (config.reddit?.enabled !== false && config.reddit?.subreddits?.length) {
    sources.push({
      name: 'reddit',
      fetch: async () => {
        const { fetchReddit } = await import('./reddit.js');
        return fetchReddit(config.reddit);
      }
    });
  }

  if (config.rss?.enabled !== false && config.rss?.feeds?.length) {
    sources.push({
      name: 'rss',
      fetch: async () => {
        const { fetchRSS } = await import('./rss.js');
        return fetchRSS(config.rss);
      }
    });
  }

  if (config.lobsters?.enabled !== false) {
    sources.push({
      name: 'lobsters',
      fetch: async () => {
        const { fetchLobsters } = await import('./lobsters.js');
        return fetchLobsters(config.lobsters);
      }
    });
  }

  // Fetch all sources in parallel
  const fetchPromises = sources.map(async (source, index) => {
    if (onProgress) {
      onProgress({ source: source.name, status: 'fetching', current: index + 1, total: sources.length });
    }

    try {
      const items = await source.fetch();
      results[source.name] = items;

      if (onProgress) {
        onProgress({ source: source.name, status: 'done', count: items.length });
      }
    } catch (error) {
      console.error(`Error fetching ${source.name}:`, error.message);
      if (onProgress) {
        onProgress({ source: source.name, status: 'error', error: error.message });
      }
    }
  });

  await Promise.all(fetchPromises);

  // Combine all results
  return [
    ...results.github,
    ...results.hackernews,
    ...results.reddit,
    ...results.rss,
    ...results.lobsters
  ];
}
