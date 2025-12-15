/**
 * Signal processing module
 *
 * Exports all signal-related functionality:
 * - filterItems: Main filtering function
 * - EmbeddingContext: Semantic embedding handling
 * - NoveltyTracker: Decay-based novelty tracking
 * - Scoring utilities
 */

export { filterItems, FilterContext } from './filter.js';
export { EmbeddingContext, cosineSimilarity, isInitialized } from './embeddings.js';
export { NoveltyTracker, MemoryStorageAdapter, FileStorageAdapter, LocalStorageAdapter } from './novelty.js';
export {
  calculateSignalScore,
  scoreAndSortSignals,
  calculateRecencyScore,
  calculateEngagementScore,
  getRecencyLabel,
  filterByTimeRange
} from './scoring.js';
