# semantic-relevance

Semantic signal detection for content feeds. Filter high-volume feeds to surface what matters based on your personal context.

## The Problem

You subscribe to tech feeds (GitHub Trending, Hacker News, Reddit, Lobsters, etc.) but 95% is noise. Popular doesn't mean relevant to *you*. And the same items appear repeatedly because they're "always trending."

## The Solution

semantic-relevance treats "signal" as the intersection of three things:

1. **Relevance** — Does this match your context? (semantic similarity using local embeddings)
2. **Novelty** — Is this actually new to you? (decay-based tracking, not just "seen before")
3. **Classification** — Why is this a signal? (competitive, opportunity, technical, trend, thesis-challenging)

Anything that fails relevance or novelty is noise, even if it's popular globally.

## Features

- **Local embeddings** — No API costs. Uses `@xenova/transformers` (all-MiniLM-L6-v2, ~23MB)
- **Semantic matching** — Catches related content without exact keyword matches
- **Decay-based novelty** — Items lose novelty over time (configurable half-life)
- **Signal classification** — Explainable labels with matched keywords
- **Composite scoring** — Relevance (45%) + Recency (35%) + Engagement (20%)
- **Pluggable storage** — In-memory, file-based, localStorage, or bring your own adapter
- **Browser & Node.js** — Works in both environments

## Installation

```bash
npm install semantic-relevance
```

## Quick Start

```javascript
import { filterItems } from 'semantic-relevance';

// Your personal context (markdown format works best)
const context = `
## What I'm Building
**AI-powered code review tool** — Automated PR reviews using LLMs

## Technologies
- TypeScript, React, Node.js
- OpenAI API, Claude API
- GitHub Actions

## Competitors
- CodeRabbit
- Codium
- Sourcery

## I'm Watching
- LLM cost optimization
- Code understanding models
- Developer tooling trends
`;

// Items from your feeds (must have id, title, description)
const items = [
  {
    id: 'gh-123',
    source: 'github',
    title: 'CodeReview-AI: Automated PR reviews',
    description: 'An open-source tool for AI-powered code review',
    url: 'https://github.com/example/codereview-ai',
    metadata: { stars: 1500, forks: 200 }
  },
  {
    id: 'hn-456',
    source: 'hackernews',
    title: 'Show HN: I built a better grep',
    description: 'A faster grep implementation in Rust',
    url: 'https://news.ycombinator.com/item?id=456',
    metadata: { points: 150, comments: 45 }
  }
  // ... more items
];

// Filter to signals
const signals = await filterItems(items, context, {
  relevanceThreshold: 0.30,  // Min semantic similarity (0-1)
  verbose: true
});

console.log(`Found ${signals.length} signals`);
signals.forEach(signal => {
  console.log(`[${signal.filter_result.signal_type}] ${signal.title}`);
  console.log(`  Reason: ${signal.filter_result.reason}`);
  console.log(`  Score: ${signal.score}/100`);
});
```

## With Novelty Tracking

Track what you've seen before to suppress repeat appearances:

```javascript
import { filterItems, NoveltyTracker, FileStorageAdapter } from 'semantic-relevance';

// Use file-based storage for persistence (Node.js)
const noveltyTracker = new NoveltyTracker({
  storage: new FileStorageAdapter('./novelty-data.json'),
  halfLifeDays: 1  // Items lose half their novelty in 1 day
});

const signals = await filterItems(items, context, {
  relevanceThreshold: 0.30,
  noveltyThreshold: 0.5,  // Only show items with >50% novelty
  noveltyTracker
});

// Items you've seen before will have lower novelty scores
// Truly new items will have novelty = 1.0
```

## Browser Usage

For browser applications, use `LocalStorageAdapter` for persistence:

```javascript
import {
  filterItems,
  NoveltyTracker,
  LocalStorageAdapter,
  EmbeddingContext
} from 'semantic-relevance';

// Use localStorage for browser persistence
const noveltyTracker = new NoveltyTracker({
  storage: new LocalStorageAdapter('my-app-novelty'),
  halfLifeDays: 1
});

// Pre-initialize embeddings with progress callback (for loading UI)
const embeddingCtx = new EmbeddingContext();
await embeddingCtx.init({
  onProgress: (progress) => {
    if (progress.status === 'downloading') {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      console.log(`Downloading model: ${pct}%`);
    }
  }
});

const signals = await filterItems(items, context, {
  relevanceThreshold: 0.30,
  noveltyTracker,
  embeddingContext: embeddingCtx  // Use pre-initialized context
});
```

## Fetching from Sources

Built-in adapters for popular feeds:

```javascript
import {
  fetchGitHub,
  fetchHackerNews,
  fetchReddit,
  fetchLobsters,
  fetchRSS
} from 'semantic-relevance';

// Fetch from multiple sources
const githubItems = await fetchGitHub({
  keywords: ['llm', 'ai'],
  minStars: 100,
  maxItems: 20
});

const hnItems = await fetchHackerNews({
  keywords: ['ai', 'coding'],
  maxItems: 30
});

const redditItems = await fetchReddit({
  subreddits: ['programming', 'MachineLearning'],
  maxItems: 20
});

const lobstersItems = await fetchLobsters({
  feed: 'hottest',  // 'hottest', 'newest', or 'active'
  maxItems: 25
});

// Combine and filter
const allItems = [...githubItems, ...hnItems, ...redditItems, ...lobstersItems];
const signals = await filterItems(allItems, context);
```

## Custom Storage Adapter

Implement the `StorageAdapter` interface for databases, Redis, etc:

```javascript
class RedisStorageAdapter {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async load(itemIds) {
    const result = new Map();
    for (const id of itemIds) {
      const data = await this.redis.get(`novelty:${id}`);
      if (data) {
        result.set(id, JSON.parse(data));
      }
    }
    return result;
  }

  async save(records) {
    for (const record of records) {
      await this.redis.set(
        `novelty:${record.itemId}`,
        JSON.stringify(record),
        'EX', 86400 * 30  // 30 day TTL
      );
    }
  }
}
```

## User Keywords

Provide explicit keywords that always matter:

```javascript
const signals = await filterItems(items, context, {
  userKeywords: {
    global: ['gpt-4', 'claude', 'llama'],  // Always watch these
    competitive: ['coderabbit', 'codium'],  // Competitor names
    technical: ['rag', 'fine-tuning']       // Technical topics
  }
});
```

## Signal Types

Each signal is classified into one of these types:

| Type | Description |
|------|-------------|
| `competitive` | Direct/adjacent to what you're building |
| `thesis-challenging` | Contradicts your assumptions |
| `opportunity` | Gap or need you could address |
| `technical` | Approach or pattern worth knowing |
| `trend` | Multiple signals pointing the same direction |

## Scoring

Signals are scored 0-100 based on:

- **Relevance (45%)** — Embedding similarity to your context
- **Recency (35%)** — Exponential decay based on timestamp
- **Engagement (20%)** — Normalized stars/points/upvotes per source

```javascript
signal.score           // 0-100 composite score
signal.scoreBreakdown  // { relevance: 75, recency: 90, engagement: 45 }
```

## API Reference

### filterItems(items, context, options)

Main filtering function.

**Parameters:**
- `items` — Array of items (must have `id`, `title`, `description`)
- `context` — User context string (markdown recommended)
- `options`:
  - `relevanceThreshold` — Min similarity score (default: 0.30)
  - `noveltyThreshold` — Min novelty score (default: 0.5)
  - `concurrency` — Parallel embedding batch size (default: 10)
  - `userKeywords` — Explicit keyword mappings
  - `noveltyTracker` — NoveltyTracker instance for decay tracking
  - `embeddingContext` — Pre-initialized EmbeddingContext (for browser progress)
  - `verbose` — Log progress (default: false)

**Returns:** Array of filtered, scored signals

### NoveltyTracker

Tracks seen items with decay-based novelty scores.

```javascript
const tracker = new NoveltyTracker({
  storage: new MemoryStorageAdapter(),  // or FileStorageAdapter, LocalStorageAdapter
  halfLifeDays: 1,   // Decay half-life
  minScore: 0.1      // Floor for old items
});

await tracker.loadBatch(['id1', 'id2']);  // Pre-load from storage
tracker.getNoveltyScore('id1');            // 0.1 - 1.0
tracker.markSeen('id1', { title: '...' }); // Record appearance
await tracker.flush();                     // Save to storage
```

### Storage Adapters

- `MemoryStorageAdapter` — In-memory, non-persistent (default)
- `FileStorageAdapter` — JSON file persistence (Node.js)
- `LocalStorageAdapter` — Browser localStorage persistence

### EmbeddingContext

Direct access to embedding operations.

```javascript
const ctx = new EmbeddingContext({ cacheSize: 1000 });
await ctx.init({ onProgress });            // Load model with optional progress
await ctx.setContext('Your context...');   // Set comparison baseline
const score = await ctx.getRelevanceScore(item);  // 0-1 similarity
```

## Project Structure

```
semantic-relevance/
├── src/                    # Library source code
│   ├── index.js            # Main exports
│   ├── signal/             # Core signal processing
│   │   ├── embeddings.js   # Semantic embeddings (browser + Node.js)
│   │   ├── filter.js       # Main filtering logic
│   │   ├── novelty.js      # Novelty tracking with adapters
│   │   └── scoring.js      # Signal scoring utilities
│   └── sources/            # Feed source adapters
│       ├── github.js       # GitHub trending/search
│       ├── hackernews.js   # Hacker News
│       ├── reddit.js       # Reddit
│       ├── lobsters.js     # Lobsters
│       └── rss.js          # Generic RSS feeds
├── demo-src/               # Browser demo source
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── docs/                   # Built demo (GitHub Pages)
└── package.json
```

## Performance

- Model load: ~2-5 seconds (first request)
- Embedding: ~50-100ms per item (batched)
- 100 items: ~3-5 seconds total
- Caching: LRU cache prevents re-embedding identical text

## Demo

Try the live demo at [m-verse.com/playground/semantic-relevance](https://m-verse.com/playground/semantic-relevance) or run locally:

```bash
npm run dev      # Start development server
npm run build    # Build to docs/ for GitHub Pages
npm run preview  # Preview built version
```

## License

MIT
