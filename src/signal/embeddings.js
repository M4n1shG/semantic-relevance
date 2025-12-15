/**
 * Embedding Service using @xenova/transformers
 * Runs locally - no API costs, semantic understanding
 *
 * Uses request-scoped EmbeddingContext to prevent cross-request
 * contamination in serverless environments.
 */

import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowLocalModels = false;

// Detect environment
const isBrowser = typeof window !== 'undefined';

// Simple hash function for cache keys (works in both Node.js and browser)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// Model - all-MiniLM-L6-v2 is small (~23MB) and fast
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Shared pipeline (safe to share across requests - stateless)
let sharedPipeline = null;

// Chunking parameters for long text
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 200;
const CHUNK_WEIGHT_DECAY = 0.8; // Earlier chunks get more weight

// Embedding cache defaults
const DEFAULT_CACHE_SIZE = 1000;

// Context point extraction limits
const MIN_BULLET_LENGTH = 10;
const MAX_BULLET_LENGTH = 200;
const MIN_QUESTION_LENGTH = 15;
const MAX_CONTEXT_POINTS = 30;

// Similarity thresholds
const MIN_POINT_MATCH_SCORE = 0.35;

/**
 * Simple LRU cache implementation for embedding caching
 */
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/**
 * Request-scoped embedding context
 * Create one per request to avoid cross-request contamination
 */
export class EmbeddingContext {
  constructor(options = {}) {
    this.contextEmbedding = null;
    this.contextPoints = null;
    this.cache = new LRUCache(options.cacheSize || DEFAULT_CACHE_SIZE);
    this.modelName = options.modelName || MODEL_NAME;
  }

  /**
   * Initialize the shared embedding pipeline
   * @param {Object} options - Init options
   * @param {Function} options.onProgress - Progress callback for model download
   */
  async init(options = {}) {
    if (sharedPipeline) return sharedPipeline;

    const { onProgress } = options;

    if (!isBrowser) {
      console.log('Loading embedding model...');
    }
    const startTime = Date.now();

    sharedPipeline = await pipeline('feature-extraction', this.modelName, {
      quantized: true,
      progress_callback: onProgress
    });

    if (!isBrowser) {
      console.log(`Model loaded in ${Date.now() - startTime}ms`);
    }
    return sharedPipeline;
  }

  /**
   * Generate embedding for text with caching
   */
  async embed(text) {
    if (!sharedPipeline) {
      await this.init();
    }

    const hash = hashString(text);
    const cached = this.cache.get(hash);
    if (cached) {
      return cached;
    }

    const embedding = await this._computeEmbedding(text);
    this.cache.set(hash, embedding);
    return embedding;
  }

  /**
   * Internal: compute embedding for text (handles chunking)
   */
  async _computeEmbedding(text) {
    if (text.length <= CHUNK_SIZE) {
      const output = await sharedPipeline(text, {
        pooling: 'mean',
        normalize: true
      });
      return output.data;
    }

    // Split into overlapping chunks for long text
    const chunks = [];
    for (let i = 0; i < text.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    const embeddings = [];
    for (const chunk of chunks) {
      const output = await sharedPipeline(chunk, {
        pooling: 'mean',
        normalize: true
      });
      embeddings.push(output.data);
    }

    // Weighted averaging: Earlier chunks get higher weight
    const weights = embeddings.map((_, idx) => Math.pow(CHUNK_WEIGHT_DECAY, idx));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const avgEmbedding = new Float32Array(embeddings[0].length);
    for (let i = 0; i < embeddings.length; i++) {
      const weight = weights[i] / totalWeight;
      const emb = embeddings[i];
      for (let j = 0; j < emb.length; j++) {
        avgEmbedding[j] += emb[j] * weight;
      }
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < avgEmbedding.length; i++) {
      norm += avgEmbedding[i] * avgEmbedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < avgEmbedding.length; i++) {
      avgEmbedding[i] /= norm;
    }

    return avgEmbedding;
  }

  /**
   * Set the context embedding from user's context document
   */
  async setContext(contextText) {
    this.contextEmbedding = await this.embed(contextText);
    return this.contextEmbedding;
  }

  /**
   * Get the context embedding
   */
  getContextEmbedding() {
    return this.contextEmbedding;
  }

  /**
   * Get relevance score for an item against the context
   * @returns {number} Relevance score (0-1)
   */
  async getRelevanceScore(item) {
    if (!this.contextEmbedding) {
      throw new Error('Context embedding not set. Call setContext first.');
    }

    const text = `${item.title || ''} ${item.description || ''}`.trim();
    if (!text) return 0;

    const itemEmbedding = await this.embed(text);
    return cosineSimilarity(this.contextEmbedding, itemEmbedding);
  }

  /**
   * Batch compute relevance scores with concurrency control
   */
  async batchRelevanceScores(items, options = {}) {
    const { concurrency = 10, onProgress = null } = options;
    const scores = new Map();

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const promises = batch.map(item =>
        this.getRelevanceScore(item).then(score => ({ id: item.id, score }))
      );

      const results = await Promise.all(promises);
      results.forEach(({ id, score }) => scores.set(id, score));

      if (onProgress) {
        onProgress(Math.min(i + concurrency, items.length), items.length);
      }
    }

    return scores;
  }

  /**
   * Extract and embed specific points from context for detailed matching
   */
  async embedContextPoints(contextText) {
    const points = [];

    const bulletRegex = /^[-*]\s+(.+)$/gm;
    let match;
    while ((match = bulletRegex.exec(contextText)) !== null) {
      const point = match[1].trim();
      if (point.length > MIN_BULLET_LENGTH && point.length < MAX_BULLET_LENGTH) {
        points.push({ text: point, type: 'bullet' });
      }
    }

    const questionRegex = /^[-*]?\s*(.+\?)$/gm;
    while ((match = questionRegex.exec(contextText)) !== null) {
      const question = match[1].trim();
      if (question.length > MIN_QUESTION_LENGTH && !points.some(p => p.text === question)) {
        points.push({ text: question, type: 'question' });
      }
    }

    const buildingMatch = contextText.match(/\*\*([^*]+)\*\*\s*[—–-]\s*([^.\n]+)/);
    if (buildingMatch) {
      points.push({
        text: `${buildingMatch[1]}: ${buildingMatch[2]}`,
        type: 'building'
      });
    }

    this.contextPoints = [];
    for (const point of points.slice(0, MAX_CONTEXT_POINTS)) {
      const embedding = await this.embed(point.text);
      this.contextPoints.push({ ...point, embedding });
    }

    return this.contextPoints;
  }

  /**
   * Find best matching context point for an item
   */
  async findBestMatchingPoint(item) {
    if (!this.contextPoints || this.contextPoints.length === 0) {
      return null;
    }

    const text = `${item.title || ''} ${item.description || ''}`.trim();
    if (!text) return null;

    const itemEmbedding = await this.embed(text);

    let bestMatch = null;
    let bestScore = 0;

    for (const point of this.contextPoints) {
      const score = cosineSimilarity(itemEmbedding, point.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = point;
      }
    }

    if (bestScore < MIN_POINT_MATCH_SCORE) return null;

    if (bestMatch.type === 'question') {
      return `May help answer: "${bestMatch.text}"`;
    } else if (bestMatch.type === 'building') {
      return `Relevant to ${bestMatch.text}`;
    } else {
      return `Matches your interest: "${bestMatch.text}"`;
    }
  }
}

/**
 * Compute cosine similarity between two embeddings
 * @param {Float32Array} a - First embedding
 * @param {Float32Array} b - Second embedding
 * @returns {number} Similarity score (-1 to 1, typically 0 to 1)
 */
export function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return Math.max(-1, Math.min(1, dotProduct / magnitude));
}

/**
 * Check if embeddings are initialized
 */
export function isInitialized() {
  return sharedPipeline !== null;
}

export default {
  EmbeddingContext,
  cosineSimilarity,
  isInitialized
};
