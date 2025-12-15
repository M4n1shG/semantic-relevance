/**
 * semantic-relevance
 * Semantic signal detection for content feeds
 *
 * Filter high-volume feeds to surface what matters based on your context.
 * Uses local embeddings for semantic matching, decay-based novelty tracking,
 * and explainable signal classification.
 */

// Signal processing (core filtering, embeddings, scoring)
export {
  filterItems,
  FilterContext,
  EmbeddingContext,
  cosineSimilarity,
  isInitialized,
  NoveltyTracker,
  MemoryStorageAdapter,
  FileStorageAdapter,
  LocalStorageAdapter,
  calculateSignalScore,
  scoreAndSortSignals,
  calculateRecencyScore,
  calculateEngagementScore,
  getRecencyLabel,
  filterByTimeRange
} from './signal/index.js';

// Source adapters (fetch from real feeds)
export {
  fetchGitHub,
  fetchHackerNews,
  fetchReddit,
  fetchRSS,
  fetchLobsters,
  fetchAllSources
} from './sources/index.js';
