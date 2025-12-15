/**
 * Novelty Tracker
 * Tracks seen items to detect what's actually NEW vs repeated appearances
 *
 * Problem: Popular items appear daily because they're always trending, but that's not "news"
 * Solution: Track when we first saw each item, decay novelty score over time
 *
 * Storage: Pluggable via StorageAdapter interface (in-memory, file, database, etc.)
 */

// Default decay settings
const DEFAULT_HALF_LIFE_DAYS = 1;
const MIN_NOVELTY_SCORE = 0.1;

/**
 * Storage adapter interface for novelty data persistence
 * Implement this interface to use custom storage backends
 *
 * @typedef {Object} StorageAdapter
 * @property {function(string[]): Promise<Map<string, Object>>} load - Load novelty data for item IDs
 * @property {function(Object[]): Promise<void>} save - Save novelty records
 * @property {function(): Promise<void>} [clear] - Optional: Clear all data
 */

/**
 * In-memory storage adapter (default, non-persistent)
 */
export class MemoryStorageAdapter {
  constructor() {
    this.data = new Map();
  }

  async load(itemIds) {
    const result = new Map();
    for (const id of itemIds) {
      if (this.data.has(id)) {
        result.set(id, this.data.get(id));
      }
    }
    return result;
  }

  async save(records) {
    for (const record of records) {
      this.data.set(record.itemId, record);
    }
  }

  async clear() {
    this.data.clear();
  }

  get size() {
    return this.data.size;
  }
}

/**
 * LocalStorage adapter for browser persistence
 *
 * Stores novelty data in the browser's localStorage, enabling persistence
 * across page reloads and browser sessions. Automatically prunes old entries
 * when the maximum is exceeded.
 *
 * @example
 * const storage = new LocalStorageAdapter('my-app-novelty', { maxEntries: 3000 });
 * const tracker = new NoveltyTracker({ storage, halfLifeDays: 1 });
 *
 * @implements {StorageAdapter}
 */
export class LocalStorageAdapter {
  /**
   * Create a new LocalStorageAdapter
   *
   * @param {string} key - LocalStorage key to use for storing data (default: 'novelty-tracker')
   * @param {Object} options - Configuration options
   * @param {number} options.maxEntries - Maximum entries to keep before pruning (default: 5000)
   */
  constructor(key = 'novelty-tracker', options = {}) {
    this.key = key;
    this.maxEntries = options.maxEntries || 5000;
    this.data = null;
  }

  _ensureLoaded() {
    if (this.data !== null) return;

    try {
      const stored = localStorage.getItem(this.key);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.data = new Map(Object.entries(parsed));
      } else {
        this.data = new Map();
      }
    } catch (error) {
      console.warn('LocalStorageAdapter: Failed to load data', error);
      this.data = new Map();
    }
  }

  async load(itemIds) {
    this._ensureLoaded();
    const result = new Map();
    for (const id of itemIds) {
      if (this.data.has(id)) {
        result.set(id, this.data.get(id));
      }
    }
    return result;
  }

  async save(records) {
    this._ensureLoaded();
    for (const record of records) {
      this.data.set(record.itemId, record);
    }

    // Prune old entries if over limit
    if (this.data.size > this.maxEntries) {
      const entries = Array.from(this.data.entries());
      entries.sort((a, b) => {
        const aTime = new Date(a[1].lastSeen || a[1].firstSeen).getTime();
        const bTime = new Date(b[1].lastSeen || b[1].firstSeen).getTime();
        return aTime - bTime;
      });
      const toRemove = entries.slice(0, entries.length - this.maxEntries);
      for (const [key] of toRemove) {
        this.data.delete(key);
      }
    }

    // Persist to localStorage
    try {
      const obj = Object.fromEntries(this.data);
      localStorage.setItem(this.key, JSON.stringify(obj));
    } catch (error) {
      console.warn('LocalStorageAdapter: Failed to save data', error);
    }
  }

  async clear() {
    this.data = new Map();
    localStorage.removeItem(this.key);
  }

  get size() {
    this._ensureLoaded();
    return this.data.size;
  }
}

// Default max entries for file storage (prevents unbounded growth)
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * File-based storage adapter for local persistence
 */
export class FileStorageAdapter {
  /**
   * @param {string} filePath - Path to the JSON storage file
   * @param {Object} options - Configuration options
   * @param {number} options.maxEntries - Maximum entries to keep (default: 10000)
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.data = null;
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
  }

  async _ensureLoaded() {
    if (this.data !== null) return;

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content);
      this.data = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.data = new Map();
      } else {
        throw error;
      }
    }
  }

  async load(itemIds) {
    await this._ensureLoaded();
    const result = new Map();
    for (const id of itemIds) {
      if (this.data.has(id)) {
        result.set(id, this.data.get(id));
      }
    }
    return result;
  }

  async save(records) {
    await this._ensureLoaded();
    for (const record of records) {
      this.data.set(record.itemId, record);
    }

    // Prune old entries if over limit (keep most recently seen)
    if (this.data.size > this.maxEntries) {
      const entries = Array.from(this.data.entries());
      // Sort by lastSeen (oldest first) and remove oldest
      entries.sort((a, b) => {
        const aTime = new Date(a[1].lastSeen || a[1].firstSeen).getTime();
        const bTime = new Date(b[1].lastSeen || b[1].firstSeen).getTime();
        return aTime - bTime;
      });
      const toRemove = entries.slice(0, entries.length - this.maxEntries);
      for (const [key] of toRemove) {
        this.data.delete(key);
      }
    }

    // Persist to file
    const fs = await import('fs/promises');
    const obj = Object.fromEntries(this.data);
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2));
  }

  async clear() {
    this.data = new Map();
    const fs = await import('fs/promises');
    await fs.writeFile(this.filePath, '{}');
  }
}

/**
 * Novelty tracker with pluggable storage
 * Tracks when items were first/last seen and calculates decay-based novelty
 */
export class NoveltyTracker {
  /**
   * Create a new NoveltyTracker
   * @param {Object} options - Configuration options
   * @param {StorageAdapter} options.storage - Storage adapter for persistence
   * @param {number} options.halfLifeDays - Half-life for novelty decay (default: 1)
   * @param {number} options.minScore - Minimum novelty score floor (default: 0.1)
   */
  constructor(options = {}) {
    this.storage = options.storage || new MemoryStorageAdapter();
    this.halfLifeDays = options.halfLifeDays || DEFAULT_HALF_LIFE_DAYS;
    this.minScore = options.minScore || MIN_NOVELTY_SCORE;
    this.cache = new Map();
    this.pendingUpdates = new Map();
  }

  /**
   * Load novelty data for a batch of items
   * @param {Array<string>} itemIds - Array of item IDs to load
   */
  async loadBatch(itemIds) {
    if (!itemIds.length) return;

    const noveltyData = await this.storage.load(itemIds);
    noveltyData.forEach((data, id) => {
      this.cache.set(id, data);
    });
  }

  /**
   * Calculate novelty score for an item
   * - New items: 1.0
   * - Items decay based on when we first saw them
   * - Floor at minScore
   *
   * @param {string} itemId - Unique item ID
   * @returns {number} Novelty score (minScore to 1.0)
   */
  getNoveltyScore(itemId) {
    const data = this.cache.get(itemId);

    if (!data || !data.firstSeen) {
      return 1.0;
    }

    const firstSeen = new Date(data.firstSeen);
    const now = new Date();
    const daysSinceFirstSeen = (now - firstSeen) / (1000 * 60 * 60 * 24);

    const decayRate = Math.log(2) / this.halfLifeDays;
    const novelty = Math.exp(-decayRate * daysSinceFirstSeen);

    return Math.max(this.minScore, novelty);
  }

  /**
   * Check if an item has been seen before
   * @param {string} itemId - Unique item ID
   * @returns {boolean}
   */
  hasSeen(itemId) {
    return this.cache.has(itemId);
  }

  /**
   * Record that an item has been seen
   * @param {string} itemId - Unique item ID
   * @param {Object} metadata - Optional metadata to store
   */
  markSeen(itemId, metadata = {}) {
    const now = new Date().toISOString();
    const existing = this.cache.get(itemId);

    if (existing) {
      const updated = {
        ...existing,
        lastSeen: now,
        seenCount: (existing.seenCount || 1) + 1
      };
      this.cache.set(itemId, updated);
      this.pendingUpdates.set(itemId, updated);
    } else {
      const newRecord = {
        itemId,
        firstSeen: now,
        lastSeen: now,
        seenCount: 1,
        ...metadata
      };
      this.cache.set(itemId, newRecord);
      this.pendingUpdates.set(itemId, newRecord);
    }
  }

  /**
   * Batch process items - get novelty scores and mark all as seen
   * @param {Array} items - Array of items with id field
   * @returns {Map} Map of item.id -> novelty score
   */
  processItems(items) {
    const scores = new Map();

    for (const item of items) {
      const novelty = this.getNoveltyScore(item.id);
      scores.set(item.id, novelty);
      this.markSeen(item.id, {
        title: item.title,
        source: item.source
      });
    }

    return scores;
  }

  /**
   * Flush pending updates to storage
   */
  async flush() {
    if (this.pendingUpdates.size === 0) return;

    const records = Array.from(this.pendingUpdates.values());
    await this.storage.save(records);
    this.pendingUpdates.clear();
  }

  /**
   * Get statistics about cached items
   */
  getStats() {
    let todayCount = 0;
    let weekCount = 0;
    const totalCount = this.cache.size;

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    for (const [, data] of this.cache) {
      const firstSeen = new Date(data.firstSeen);
      if (firstSeen > oneDayAgo) todayCount++;
      if (firstSeen > oneWeekAgo) weekCount++;
    }

    return {
      total: totalCount,
      newToday: todayCount,
      newThisWeek: weekCount,
      pendingUpdates: this.pendingUpdates.size
    };
  }
}

export default {
  NoveltyTracker,
  MemoryStorageAdapter,
  LocalStorageAdapter,
  FileStorageAdapter
};
