/**
 * Signal Strength Scoring Algorithm
 *
 * Calculates a composite score (0-100) for each signal based on:
 * - Context Relevance (45%): How relevant to user's context
 * - Recency (35%): How recent the activity is
 * - Engagement (20%): Stars, points, upvotes normalized
 */

// Confidence to numeric score mapping
const CONFIDENCE_SCORES = {
  high: 100,
  medium: 70,
  low: 40
};

// Engagement baselines by source (median values for normalization)
const DEFAULT_ENGAGEMENT_BASELINES = {
  github: { stars: 1000, forks: 100 },
  hackernews: { points: 100, comments: 50 },
  reddit: { score: 100, comments: 50 },
  arxiv: { citations: 10 },
  lobsters: { score: 20, comments: 10 },
  devto: { reactions: 50, comments: 20 },
  huggingface: { likes: 100, downloads: 1000 },
  producthunt: { votes: 200, comments: 50 }
};

// Safe default baseline
const DEFAULT_BASELINE = {
  stars: 1, forks: 1, points: 1, comments: 1,
  score: 1, reactions: 1, likes: 1, downloads: 1,
  votes: 1, citations: 1
};

/**
 * Calculate recency score using exponential decay
 * @param {Date|string} timestamp - The timestamp to evaluate
 * @param {number} halfLifeDays - Days until score halves (default: 7)
 * @returns {number} Score 0-100
 */
export function calculateRecencyScore(timestamp, halfLifeDays = 7) {
  if (!timestamp) return 50;

  const now = new Date();
  const itemDate = new Date(timestamp);
  const ageMs = now - itemDate;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  const decayRate = Math.log(2) / halfLifeDays;
  const score = 100 * Math.exp(-decayRate * ageDays);

  return Math.max(0, Math.min(100, score));
}

/**
 * Get the most relevant timestamp for an item
 * @param {Object} item - The signal item
 * @param {Object} timestampFields - Custom timestamp field mappings per source
 * @returns {string|null} The timestamp to use
 */
export function getRelevantTimestamp(item, timestampFields = {}) {
  const source = item.source;
  const meta = item.metadata || {};

  // Allow custom timestamp field mappings
  if (timestampFields[source]) {
    const fields = timestampFields[source];
    for (const field of fields) {
      if (meta[field]) return meta[field];
    }
  }

  // Default mappings
  switch (source) {
    case 'github':
      return meta.pushed_at || meta.updated_at || item.fetched_at;
    case 'hackernews':
      return meta.created_at || item.fetched_at;
    case 'reddit':
      return meta.created_utc
        ? new Date(meta.created_utc * 1000).toISOString()
        : item.fetched_at;
    case 'arxiv':
      return meta.published || item.fetched_at;
    default:
      return item.fetched_at || item.timestamp || item.date;
  }
}

/**
 * Get baseline with safe defaults
 */
function getBaseline(source, customBaselines = {}) {
  const baseline = customBaselines[source] || DEFAULT_ENGAGEMENT_BASELINES[source] || {};
  return { ...DEFAULT_BASELINE, ...baseline };
}

/**
 * Calculate engagement score normalized against baseline
 * @param {Object} item - The signal item
 * @param {Object} customBaselines - Custom engagement baselines
 * @returns {number} Score 0-100
 */
export function calculateEngagementScore(item, customBaselines = {}) {
  const source = item.source;
  const meta = item.metadata || {};
  const baseline = getBaseline(source, customBaselines);

  let score = 50;

  switch (source) {
    case 'github': {
      const stars = meta.stars || 0;
      const forks = meta.forks || 0;
      const starScore = Math.min(100, (stars / baseline.stars) * 50);
      const forkScore = Math.min(100, (forks / baseline.forks) * 50);
      score = (starScore * 0.7) + (forkScore * 0.3);
      break;
    }
    case 'hackernews': {
      const points = meta.points || 0;
      const comments = meta.comments || 0;
      const pointScore = Math.min(100, (points / baseline.points) * 50);
      const commentScore = Math.min(100, (comments / baseline.comments) * 50);
      score = (pointScore * 0.6) + (commentScore * 0.4);
      break;
    }
    case 'reddit': {
      const upvotes = meta.score || 0;
      const comments = meta.comments || 0;
      const upvoteScore = Math.min(100, (upvotes / baseline.score) * 50);
      const commentScore = Math.min(100, (comments / baseline.comments) * 50);
      score = (upvoteScore * 0.6) + (commentScore * 0.4);
      break;
    }
    case 'lobsters': {
      const points = meta.score || 0;
      const comments = meta.comments || 0;
      const pointScore = Math.min(100, (points / baseline.score) * 50);
      const commentScore = Math.min(100, (comments / baseline.comments) * 50);
      score = (pointScore * 0.6) + (commentScore * 0.4);
      break;
    }
    case 'devto': {
      const reactions = meta.reactions || 0;
      const comments = meta.comments || 0;
      const reactionScore = Math.min(100, (reactions / baseline.reactions) * 50);
      const commentScore = Math.min(100, (comments / baseline.comments) * 50);
      score = (reactionScore * 0.6) + (commentScore * 0.4);
      break;
    }
    case 'huggingface': {
      const likes = meta.likes || 0;
      const downloads = meta.downloads || 0;
      const likeScore = Math.min(100, (likes / baseline.likes) * 50);
      const downloadScore = Math.min(100, (downloads / baseline.downloads) * 50);
      score = (likeScore * 0.5) + (downloadScore * 0.5);
      break;
    }
    case 'producthunt': {
      const votes = meta.votes || 0;
      const comments = meta.comments || 0;
      const voteScore = Math.min(100, (votes / baseline.votes) * 50);
      const commentScore = Math.min(100, (comments / baseline.comments) * 50);
      score = (voteScore * 0.7) + (commentScore * 0.3);
      break;
    }
    default: {
      // Try generic engagement fields
      if (meta.likes || meta.reactions || meta.upvotes) {
        const engagement = meta.likes || meta.reactions || meta.upvotes || 0;
        score = Math.min(100, engagement / 10);
      }
      break;
    }
  }

  if (isNaN(score)) {
    score = 50;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate the composite signal strength score
 * @param {Object} item - The filtered signal item
 * @param {Object} options - Scoring options
 * @returns {Object} Item with added signalScore and scoreBreakdown
 */
export function calculateSignalScore(item, options = {}) {
  const {
    relevanceWeight = 0.45,
    recencyWeight = 0.35,
    engagementWeight = 0.20,
    engagementBaselines = {}
  } = options;

  // Context relevance
  let relevanceScore;
  if (item.filter_result?.relevance_score !== undefined) {
    relevanceScore = item.filter_result.relevance_score;
  } else {
    const confidence = item.filter_result?.confidence || 'medium';
    relevanceScore = CONFIDENCE_SCORES[confidence] || 70;
  }

  // Recency score
  const timestamp = getRelevantTimestamp(item);
  const recencyScore = calculateRecencyScore(timestamp);

  // Engagement score
  const engagementScore = calculateEngagementScore(item, engagementBaselines);

  // Composite score
  const signalScore = Math.round(
    (relevanceScore * relevanceWeight) +
    (recencyScore * recencyWeight) +
    (engagementScore * engagementWeight)
  );

  return {
    ...item,
    signalScore,
    scoreBreakdown: {
      relevance: Math.round(relevanceScore),
      recency: Math.round(recencyScore),
      engagement: Math.round(engagementScore)
    }
  };
}

/**
 * Score and sort an array of filtered signals
 * @param {Array} signals - Array of filtered signal items
 * @param {Object} options - Scoring and sorting options
 * @returns {Array} Scored and sorted signals
 */
export function scoreAndSortSignals(signals, options = {}) {
  const { sortBy = 'score' } = options;

  const scoredSignals = signals.map(signal =>
    calculateSignalScore(signal, options)
  );

  switch (sortBy) {
    case 'recency':
      return scoredSignals.sort((a, b) =>
        b.scoreBreakdown.recency - a.scoreBreakdown.recency
      );
    case 'engagement':
      return scoredSignals.sort((a, b) =>
        b.scoreBreakdown.engagement - a.scoreBreakdown.engagement
      );
    case 'relevance':
      return scoredSignals.sort((a, b) =>
        b.scoreBreakdown.relevance - a.scoreBreakdown.relevance
      );
    case 'score':
    default:
      return scoredSignals.sort((a, b) => b.signalScore - a.signalScore);
  }
}

/**
 * Get human-readable recency label
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Human readable label
 */
export function getRecencyLabel(timestamp) {
  if (!timestamp) return 'Unknown';

  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
  if (diffDays < 14) return 'Last week';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 60) return 'Last month';
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Filter signals by time range
 * @param {Array} signals - Array of signals
 * @param {string} since - Time range: '24h', '7d', '30d', 'all'
 * @returns {Array} Filtered signals
 */
export function filterByTimeRange(signals, since = 'all') {
  if (since === 'all') return signals;

  const now = new Date();
  let cutoff;

  switch (since) {
    case '24h':
      cutoff = new Date(now - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      return signals;
  }

  return signals.filter(signal => {
    const timestamp = getRelevantTimestamp(signal);
    return new Date(timestamp) >= cutoff;
  });
}

export default {
  calculateRecencyScore,
  calculateEngagementScore,
  calculateSignalScore,
  scoreAndSortSignals,
  getRecencyLabel,
  getRelevantTimestamp,
  filterByTimeRange
};
