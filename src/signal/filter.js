/**
 * Semantic Relevance - Main filtering module
 * Uses local embeddings for semantic similarity
 */

import { scoreAndSortSignals, getRecencyLabel, getRelevantTimestamp } from './scoring.js';
import { EmbeddingContext } from './embeddings.js';

// Default filter thresholds
const DEFAULT_RELEVANCE_THRESHOLD = 0.30;
const DEFAULT_NOVELTY_THRESHOLD = 0.5;

// Signal types
const SIGNAL_TYPES = [
  'competitive',
  'thesis-challenging',
  'opportunity',
  'technical',
  'trend'
];

// Stop words set (module-level constant for performance)
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'been',
  'will', 'what', 'when', 'where', 'which', 'about', 'into', 'more',
  'some', 'could', 'would', 'should', 'being', 'through', 'also',
  'just', 'like', 'make', 'made', 'using', 'used', 'want', 'need'
]);

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Default signal keywords
const DEFAULT_SIGNAL_KEYWORDS = {
  competitive: {
    exact: [],
    generic: ['competitor', 'alternative', 'similar to', 'competes with']
  },
  'thesis-challenging': {
    exact: [],
    generic: ['contradicts', 'challenges', 'disproves', 'questions']
  },
  opportunity: {
    exact: [],
    generic: ['pain point', 'frustration', 'problem', 'gap', 'need', 'challenge', 'struggle']
  },
  technical: {
    exact: [],
    generic: ['architecture', 'pattern', 'approach', 'implementation', 'method', 'framework']
  },
  trend: {
    exact: [],
    generic: ['adoption', 'growth', 'rising', 'popular', 'trending', 'enterprise']
  }
};

/**
 * Parse user's context document to extract signal keywords
 */
function parseContextForSignalKeywords(context) {
  if (!context) return DEFAULT_SIGNAL_KEYWORDS;

  const keywords = {
    competitive: { exact: [], generic: [] },
    'thesis-challenging': { exact: [], generic: [] },
    opportunity: { exact: [], generic: [] },
    technical: { exact: [], generic: [] },
    trend: { exact: [], generic: [] }
  };

  const sectionMappings = [
    { pattern: /##\s*(?:competitors?|watching|alternatives?|competition)\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi, type: 'competitive' },
    { pattern: /##\s*(?:questions?|assumptions?|thesis|hypothes[ie]s|validat(?:e|ing))\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi, type: 'thesis-challenging' },
    { pattern: /##\s*(?:pain\s*points?|problems?|opportunities?|gaps?|needs?)\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi, type: 'opportunity' },
    { pattern: /##\s*(?:technolog(?:y|ies)|stack|tools?|frameworks?|libraries?)\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi, type: 'technical' },
    { pattern: /##\s*(?:trends?|market|industry|growth)\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi, type: 'trend' }
  ];

  for (const { pattern, type } of sectionMappings) {
    let match;
    while ((match = pattern.exec(context)) !== null) {
      const sectionContent = match[1];
      const extracted = extractTermsFromSection(sectionContent);
      keywords[type].exact.push(...extracted.exact);
      keywords[type].generic.push(...extracted.generic);
    }
  }

  const buildingPattern = /##\s*(?:what\s*i'?m?\s*building|product|project|building)\s*\n([\s\S]*?)(?=\n##|\n$|$)/gi;
  let buildingMatch;
  while ((buildingMatch = buildingPattern.exec(context)) !== null) {
    const domainTerms = extractTermsFromSection(buildingMatch[1]);
    keywords.technical.generic.push(...domainTerms.generic);
  }

  const merged = {};
  for (const type of SIGNAL_TYPES) {
    merged[type] = {
      exact: [...new Set(keywords[type].exact)],
      generic: [...new Set([...keywords[type].generic, ...(DEFAULT_SIGNAL_KEYWORDS[type]?.generic || [])])]
    };
  }

  return merged;
}

function extractTermsFromSection(sectionContent) {
  const exact = [];
  const generic = [];

  const bulletRegex = /^[-*]\s+\*?\*?([^*\n]+)\*?\*?/gm;
  let match;
  while ((match = bulletRegex.exec(sectionContent)) !== null) {
    const item = match[1].trim();
    if (/^[A-Z][a-zA-Z0-9.-]*(?:\s+[A-Z][a-zA-Z0-9.-]*)?$/.test(item) && item.length < 30) {
      exact.push(item.toLowerCase());
    } else {
      const words = item.match(/\b[A-Za-z][a-z]{3,}\b/g) || [];
      words.forEach(w => {
        if (!isStopWord(w)) {
          generic.push(w.toLowerCase());
        }
      });
    }
  }

  const boldRegex = /\*\*([^*]+)\*\*/g;
  while ((match = boldRegex.exec(sectionContent)) !== null) {
    const term = match[1].trim();
    if (term.length > 2 && term.length < 50) {
      exact.push(term.toLowerCase());
    }
  }

  return { exact, generic };
}

function isStopWord(word) {
  return STOP_WORDS.has(word.toLowerCase());
}

/**
 * Request-scoped filter context
 */
export class FilterContext {
  constructor(options = {}) {
    this.seenIds = new Set(options.existingIds || []);
    this.contextKeywords = [];
    this.signalKeywords = DEFAULT_SIGNAL_KEYWORDS;
    this.userGlobalKeywords = [];
  }

  markSeen(itemId) {
    this.seenIds.add(itemId);
  }

  getNoveltyScore(itemId) {
    return this.seenIds.has(itemId) ? 0 : 1.0;
  }

  setSignalKeywords(context, userKeywords = {}) {
    const parsedKeywords = parseContextForSignalKeywords(context);
    this.userGlobalKeywords = (userKeywords.global || []).map(k => k.toLowerCase());

    this.signalKeywords = {};
    for (const type of SIGNAL_TYPES) {
      const userExact = (userKeywords[type] || []).map(k => k.toLowerCase());
      this.signalKeywords[type] = {
        exact: [...new Set([...userExact, ...(parsedKeywords[type]?.exact || [])])],
        generic: parsedKeywords[type]?.generic || []
      };
    }
  }

  setContextKeywords(context) {
    this.contextKeywords = extractContextKeywords(context);
  }

  classifySignalType(item) {
    const text = `${item.title || ''} ${item.description || ''}`;
    const textLower = text.toLowerCase();

    const hasKeyword = (keyword) => {
      const keywordLower = keyword.toLowerCase();
      const isAlphanumericOnly = /^[a-z0-9]+$/i.test(keyword);

      if (isAlphanumericOnly) {
        // Escape regex special characters for safety
        const escaped = escapeRegExp(keywordLower);
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        return regex.test(text);
      }

      const idx = textLower.indexOf(keywordLower);
      if (idx === -1) return false;

      const beforeOk = idx === 0 || !/[a-z0-9]/i.test(text[idx - 1]);
      const afterIdx = idx + keyword.length;
      const afterOk = afterIdx >= text.length || !/[a-z0-9]/i.test(text[afterIdx]);

      return beforeOk && afterOk;
    };

    let matchedGlobalKeyword = null;
    for (const keyword of this.userGlobalKeywords) {
      if (hasKeyword(keyword)) {
        matchedGlobalKeyword = keyword;
        break;
      }
    }

    for (const [signalType, keywords] of Object.entries(this.signalKeywords)) {
      if (keywords.exact && keywords.exact.length > 0) {
        for (const keyword of keywords.exact) {
          if (hasKeyword(keyword)) {
            return {
              type: signalType,
              keywordConfidence: 'high',
              matchedKeyword: keyword,
              isWatched: matchedGlobalKeyword !== null
            };
          }
        }
      }
    }

    for (const [signalType, keywords] of Object.entries(this.signalKeywords)) {
      if (keywords.generic && keywords.generic.length > 0) {
        for (const keyword of keywords.generic) {
          if (hasKeyword(keyword)) {
            return {
              type: signalType,
              keywordConfidence: matchedGlobalKeyword ? 'high' : 'medium',
              matchedKeyword: matchedGlobalKeyword || keyword,
              isWatched: matchedGlobalKeyword !== null
            };
          }
        }
      }
    }

    if (matchedGlobalKeyword) {
      return {
        type: 'technical',
        keywordConfidence: 'high',
        matchedKeyword: matchedGlobalKeyword,
        isWatched: true
      };
    }

    return { type: 'technical', keywordConfidence: 'low', matchedKeyword: null, isWatched: false };
  }

  extractTopic(item) {
    const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();

    for (const keyword of this.userGlobalKeywords) {
      if (text.includes(keyword)) {
        return keyword;
      }
    }

    for (const keyword of this.contextKeywords) {
      if (text.includes(keyword)) {
        return keyword;
      }
    }

    const titleWords = (item.title || '').match(/\b[A-Za-z][a-z]{3,}\b/g) || [];
    if (titleWords.length > 0) {
      return titleWords[0].toLowerCase();
    }

    return 'your interests';
  }
}

function getConfidence(relevance) {
  if (relevance >= 0.6) return 'high';
  if (relevance >= 0.45) return 'medium';
  return 'low';
}

function extractContextKeywords(context) {
  if (!context) return [];

  const keywords = new Set();

  const bulletRegex = /^[-*]\s+(.+)$/gm;
  let match;
  while ((match = bulletRegex.exec(context)) !== null) {
    const words = match[1].match(/\b[A-Za-z][a-z]{3,}\b/g) || [];
    words.forEach(w => keywords.add(w.toLowerCase()));
  }

  const properNouns = context.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  properNouns.forEach(term => keywords.add(term.toLowerCase()));

  return Array.from(keywords).filter(k => !STOP_WORDS.has(k) && k.length > 3);
}

function generateReason(signalType, item, filterCtx) {
  const topic = filterCtx.extractTopic(item);

  const templates = {
    competitive: [`Potential competitor or adjacent tool in the ${topic} space`],
    'thesis-challenging': [`May challenge assumptions about ${topic}`],
    opportunity: [`Potential opportunity in ${topic}`],
    technical: [`Technical approach relevant to ${topic}`],
    trend: [`Emerging trend in ${topic}`]
  };

  const options = templates[signalType] || templates.technical;
  return options[0];
}

/**
 * Filter items using embeddings
 *
 * @param {Array} items - Items to filter (must have id, title, description)
 * @param {string} context - User context document (markdown)
 * @param {Object} options - Filtering options
 * @param {number} options.relevanceThreshold - Min relevance score (0-1, default: 0.30)
 * @param {number} options.noveltyThreshold - Min novelty score (0-1, default: 0.5)
 * @param {number} options.concurrency - Parallel batch size (default: 10)
 * @param {Object} options.userKeywords - User-provided keywords for classification
 * @param {Object} options.noveltyTracker - Optional NoveltyTracker instance
 * @param {Object} options.embeddingContext - Optional pre-initialized EmbeddingContext (for browser progress)
 * @param {boolean} options.verbose - Log detailed progress (default: false)
 * @returns {Array} Filtered and scored signals
 */
export async function filterItems(items, context, options = {}) {
  const startTime = Date.now();

  const {
    relevanceThreshold = DEFAULT_RELEVANCE_THRESHOLD,
    noveltyThreshold = DEFAULT_NOVELTY_THRESHOLD,
    concurrency = 10,
    userKeywords = {},
    noveltyTracker = null,
    embeddingContext = null,
    existingIds = [],
    verbose = false
  } = options;

  // Input validation
  if (!items || items.length === 0) {
    return [];
  }

  if (!context || typeof context !== 'string') {
    throw new Error('Context must be a non-empty string');
  }

  // Validate items have required fields
  const validItems = items.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (!item.id) {
      if (verbose) console.warn('Skipping item without id:', item.title?.slice(0, 50));
      return false;
    }
    return true;
  });

  if (validItems.length === 0) {
    return [];
  }

  if (verbose && validItems.length < items.length) {
    console.log(`Filtered out ${items.length - validItems.length} invalid items`);
  }

  // Create request-scoped contexts
  const embeddingCtx = embeddingContext || new EmbeddingContext({ cacheSize: 1000 });
  const filterCtx = new FilterContext({ existingIds });

  // Initialize (skip if pre-initialized context was provided)
  if (!embeddingContext) {
    await embeddingCtx.init();
  }
  await embeddingCtx.setContext(context);
  filterCtx.setSignalKeywords(context, userKeywords);
  filterCtx.setContextKeywords(context);

  // Determine novelty strategy
  const useDecayNovelty = noveltyTracker !== null;
  if (useDecayNovelty) {
    const itemIds = validItems.map(i => i.id);
    await noveltyTracker.loadBatch(itemIds);
  }

  // Track stats per source
  const sourceStats = {};

  // Pre-compute relevance scores
  const relevanceScores = await embeddingCtx.batchRelevanceScores(validItems, {
    concurrency,
    onProgress: verbose ? (current, total) => {
      if (current % 50 === 0 || current === total) {
        console.log(`  Relevance scoring: ${current}/${total}`);
      }
    } : null
  });

  // Filter
  const filteredItems = [];

  for (const item of validItems) {
    const source = item.source || 'unknown';

    if (!sourceStats[source]) {
      sourceStats[source] = { total: 0, passed: 0, avgRelevance: 0, relevanceSum: 0 };
    }
    sourceStats[source].total++;

    const relevance = relevanceScores.get(item.id) || 0;
    sourceStats[source].relevanceSum += relevance;
    sourceStats[source].avgRelevance = sourceStats[source].relevanceSum / sourceStats[source].total;

    const novelty = useDecayNovelty
      ? noveltyTracker.getNoveltyScore(item.id)
      : filterCtx.getNoveltyScore(item.id);

    if (useDecayNovelty) {
      noveltyTracker.markSeen(item.id, { title: item.title, source: item.source });
    }
    filterCtx.markSeen(item.id);

    const passesRelevance = relevance >= relevanceThreshold;
    const passesNovelty = useDecayNovelty
      ? novelty >= noveltyThreshold
      : novelty > 0;

    if (passesRelevance && passesNovelty) {
      sourceStats[source].passed++;

      const classification = filterCtx.classifySignalType(item);
      const relevanceConfidence = getConfidence(relevance);
      const reason = generateReason(classification.type, item, filterCtx);

      filteredItems.push({
        ...item,
        filter_result: {
          signal_type: classification.type,
          confidence: relevanceConfidence,
          keyword_confidence: classification.keywordConfidence,
          matched_keyword: classification.matchedKeyword,
          is_watched: classification.isWatched,
          reason,
          relevance_score: Math.round(relevance * 100),
          novelty_score: Math.round(novelty * 100)
        },
        filtered_at: new Date().toISOString()
      });
    }
  }

  // Flush novelty updates
  if (useDecayNovelty) {
    await noveltyTracker.flush();
  }

  // Score and sort
  const scoredItems = scoreAndSortSignals(filteredItems, { sortBy: 'score' });

  // Add recency labels
  const itemsWithLabels = scoredItems.map(item => ({
    ...item,
    score: item.signalScore,
    recencyLabel: getRecencyLabel(getRelevantTimestamp(item))
  }));

  if (verbose) {
    console.log(`\nFiltered ${validItems.length} -> ${itemsWithLabels.length} signals in ${Date.now() - startTime}ms`);
    for (const [source, stats] of Object.entries(sourceStats)) {
      const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
      console.log(`  ${source}: ${stats.passed}/${stats.total} (${passRate}%)`);
    }
  }

  return itemsWithLabels;
}

export default {
  FilterContext,
  filterItems
};
