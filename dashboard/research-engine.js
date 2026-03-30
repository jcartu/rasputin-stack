// ALFIE Nexus — Wide Research Engine v4.0
// Multi-source: Perplexity Sonar (primary) → Wikipedia/HN/arXiv (fallback) → content extraction → streaming AI synthesis
// Better than Manus: parallel multi-API search, Perplexity-powered, real-time progress, 5-min timeout

const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

// Load API keys from .env
let PERPLEXITY_API_KEY = null;
let BRAVE_API_KEY = null;
let ANTHROPIC_API_KEY = null;
try {
  const fs = require('fs');
  const envPath = require('path').join(
    process.env.HOME || '/root',
    '.openclaw',
    'workspace',
    '.env'
  );
  const envFile = fs.readFileSync(envPath, 'utf8');
  let m = envFile.match(/PERPLEXITY_API_KEY=(.+)/);
  if (m) PERPLEXITY_API_KEY = m[1].trim();
  m = envFile.match(/BRAVE_(?:SEARCH_)?API_KEY=(.+)/);
  if (m) BRAVE_API_KEY = m[1].trim();
  m = envFile.match(/ANTHROPIC_API_KEY=(.+)/);
  if (m) ANTHROPIC_API_KEY = m[1].trim();
} catch (_) {}

// ─── HTTP fetch utility ──────────────────────────────────────────────────────
function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeout = opts.timeout ?? 15000;
    const maxRedirects = opts.maxRedirects ?? 3;
    function go(u, left) {
      const proto = u.startsWith('https') ? https : http;
      const req = proto.get(
        u,
        {
          timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
            ...(opts.headers || {}),
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
            res.resume();
            return go(new URL(res.headers.location, u).toString(), left - 1);
          }
          const chunks = [];
          let sz = 0;
          const max = opts.maxSize ?? 3e6;
          res.on('data', (c) => {
            sz += c.length;
            if (sz <= max) chunks.push(c);
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
          );
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    }
    go(url, maxRedirects);
  });
}

// ─── Anthropic API call via operator-proxy (non-streaming) ──────────────────────
function anthropicRequest(model, messages, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? 180000;
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.3,
      stream: false,
    });
    const req = http.request(
      {
        hostname: 'localhost',
        port 8080,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error)
              return reject(new Error(json.error.message || JSON.stringify(json.error)));
            const text = (json.content || [])
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('');
            resolve(text);
          } catch (e) {
            reject(new Error('Proxy parse error: ' + data.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Proxy timeout (' + timeout / 1000 + 's)'));
    });
    req.write(body);
    req.end();
  });
}

// ─── Anthropic API streaming call via operator-proxy ────────────────────────────
function anthropicRequestStream(model, messages, onChunk, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? 180000;
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.3,
      stream: true,
    });
    const req = http.request(
      {
        hostname: 'localhost',
        port 8080,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        timeout,
      },
      (res) => {
        let buffer = '';
        let fullText = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              try {
                const json = JSON.parse(data);
                if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                  const content = json.delta.text || '';
                  if (content) {
                    fullText += content;
                    onChunk(content, fullText);
                  }
                }
              } catch (_) {}
            }
          }
        });
        res.on('end', () => resolve(fullText));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Anthropic timeout (' + timeout / 1000 + 's)'));
    });
    req.write(body);
    req.end();
  });
}

// ─── Perplexity Sonar Search ─────────────────────────────────────────────────
function perplexitySearch(query) {
  return new Promise((resolve, reject) => {
    if (!PERPLEXITY_API_KEY) return reject(new Error('No Perplexity key'));
    const body = JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content:
            'Provide a thorough, detailed research answer with specific facts, data, and analysis. Cite sources.',
        },
        { role: 'user', content: query },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });
    const req = https.request(
      'https://api.perplexity.ai/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error)
              return reject(new Error(json.error.message || JSON.stringify(json.error)));
            resolve({
              content: json.choices?.[0]?.message?.content || '',
              citations: json.citations || [],
            });
          } catch (e) {
            reject(new Error('Perplexity parse: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Perplexity timeout'));
    });
    req.write(body);
    req.end();
  });
}

// ─── SearXNG Search (local meta-search aggregator) ───────────────────────────
function searxngSearch(query, count = 8) {
  const url = `http://localhost:8888/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  return httpFetch(url, { timeout: 15000 })
    .then((r) => {
      const d = JSON.parse(r.body.toString());
      return (d.results || [])
        .slice(0, count)
        .map((x) => ({
          title: x.title || '',
          url: x.url || '',
          description: (x.content || '').slice(0, 250),
          source: `searxng`,
          engine: x.engine || 'unknown',
        }))
        .filter((x) => x.url.startsWith('http'));
    })
    .catch(() => []);
}

// ─── Fallback Search Providers (when Perplexity unavailable) ─────────────────

function wikiSearch(query, count = 3) {
  return httpFetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${count}`,
    { timeout: 10000 }
  )
    .then((r) => {
      const d = JSON.parse(r.body.toString());
      return (d.query?.search || []).map((x) => ({
        title: x.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`,
        description: (x.snippet || '').replace(/<[^>]*>/g, ''),
        source: 'wikipedia',
      }));
    })
    .catch(() => []);
}

function hnSearch(query, count = 3) {
  return httpFetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${count}`,
    { timeout: 10000 }
  )
    .then((r) => {
      const d = JSON.parse(r.body.toString());
      return (d.hits || [])
        .map((h) => ({
          title: h.title || '',
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          description: '',
          source: 'hackernews',
        }))
        .filter((x) => x.url.startsWith('http'));
    })
    .catch(() => []);
}

function arxivSearch(query, count = 3) {
  return httpFetch(
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}&sortBy=relevance`,
    { timeout: 12000 }
  )
    .then((r) => {
      const xml = r.body.toString();
      const results = [];
      const re = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      while ((m = re.exec(xml)) && results.length < count) {
        const e = m[1];
        const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim();
        const l = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim();
        const s = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]
          ?.replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300);
        if (t && l) results.push({ title: t, url: l, description: s || '', source: 'arxiv' });
      }
      return results;
    })
    .catch(() => []);
}

function redditSearch(query, count = 3) {
  return httpFetch(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=${count}&type=link`,
    { timeout: 10000 }
  )
    .then((r) => {
      const d = JSON.parse(r.body.toString());
      return (d.data?.children || [])
        .map((c) => c.data)
        .filter((x) => x.url)
        .map((x) => ({
          title: x.title || '',
          url: x.url.startsWith('/') ? `https://www.reddit.com${x.url}` : x.url,
          description: (x.selftext || '').slice(0, 200),
          source: 'reddit',
        }))
        .slice(0, count);
    })
    .catch(() => []);
}

// ─── Content extraction (for fallback URLs) ──────────────────────────────────
function extractContent(url) {
  return httpFetch(url, { timeout: 20000, maxSize: 3e6 })
    .then((r) => {
      if (r.status !== 200) return { url, text: '', error: `HTTP ${r.status}` };
      const { JSDOM } = require('jsdom');
      const { Readability } = require('@mozilla/readability');
      const dom = new JSDOM(r.body.toString('utf8'), { url });
      const article = new Readability(dom.window.document).parse();
      const text = (article?.textContent || dom.window.document.body?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);
      return { url, title: article?.title || '', text, length: text.length };
    })
    .catch((e) => ({ url, text: '', error: e.message }));
}

// ─── Research Job ────────────────────────────────────────────────────────────
class ResearchJob extends EventEmitter {
  constructor(question) {
    super();
    this.id = `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.question = question;
    this.status = 'pending';
    this.progress = { step: 0, totalSteps: 5, stepName: 'initializing', details: '' };
    this.queries = [];
    this.sources = [];
    this.perplexityContent = [];
    this.synthesis = '';
    this.keyFindings = [];
    this.error = null;
    this.startedAt = Date.now();
    this.completedAt = null;
    this._aborted = false;
    this._searchMode = 'searxng'; // Use local SearXNG for faster, cleaner results

    // 5 minute hard timeout
    this._timer = setTimeout(
      () => {
        if (this.status === 'running') {
          this.status = 'error';
          this.error = 'Research timed out after 5 minutes';
          this.completedAt = Date.now();
          this.updateProgress(this.progress.step, 'error', this.error);
          this.emit('error', { message: this.error });
          this._aborted = true;
        }
      },
      5 * 60 * 1000
    );
  }

  updateProgress(step, stepName, details = '') {
    this.progress = { step, totalSteps: 5, stepName, details };
    this.emit('progress', { ...this.progress });
  }

  async run() {
    this.status = 'running';
    try {
      // ── Step 1: Generate search queries ──────────────────────────────────
      this.updateProgress(1, 'generating_queries', 'AI is generating 5 targeted search queries...');
      const queryPrompt = `Generate exactly 5 diverse search queries for thorough research on this topic. Cover: definition, technical details, recent developments, expert analysis, practical implications.

Return ONLY a JSON array of 5 strings.

Question: "${this.question}"`;

      let queryResp;
      try {
        queryResp = await anthropicRequest(
          'claude-sonnet-4-5',
          [{ role: 'user', content: queryPrompt }],
          {
            maxTokens: 600,
            temperature: 0.7,
            timeout: 30000,
          }
        );
      } catch (_) {}

      if (queryResp) {
        try {
          const m = queryResp.match(/\[[\s\S]*?\]/);
          this.queries = m ? JSON.parse(m[0]) : [];
        } catch (_) {
          this.queries = [];
        }
      }
      // Ensure 5 queries
      const fallbacks = [
        this.question,
        `${this.question} overview`,
        `${this.question} latest 2025 2026`,
        `${this.question} comparison analysis`,
        `${this.question} expert opinion`,
      ];
      while (this.queries.length < 5) this.queries.push(fallbacks[this.queries.length]);
      this.queries = this.queries.slice(0, 5);
      this.emit('queries', this.queries);
      if (this._aborted) return;

      // ── Step 2: Search ───────────────────────────────────────────────────
      if (this._searchMode === 'searxng') {
        await this._searxngSearch();
      } else if (this._searchMode === 'perplexity') {
        await this._perplexitySearch();
      } else {
        await this._fallbackSearch();
      }
      if (this._aborted) return;

      // ── Step 4: AI Synthesis ─────────────────────────────────────────────
      const contentForSynthesis = this._buildSynthesisContent();
      const contentLen = contentForSynthesis.length;
      const srcCount = this.sources.filter((s) => s.status === 'done').length;
      this.updateProgress(
        4,
        'synthesizing',
        `AI is synthesizing ${srcCount} sources (${(contentLen / 1000).toFixed(0)}KB)...`
      );

      const synthesisPrompt = `You are a world-class research analyst producing a comprehensive report.

## Research Question
${this.question}

## Search Queries
${this.queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

## Research Data (${srcCount} sources)
${contentForSynthesis.slice(0, 40000)}

## Report Structure
Write a thorough report with these sections:
1. **Executive Summary** — 2-3 paragraph overview
2. **Background & Context** — foundational knowledge
3. **Detailed Analysis** — organized by themes, cite sources by URL
4. **Key Developments & Trends** — what's new
5. **Different Perspectives** — consensus vs disagreement
6. **Gaps & Limitations** — what we don't know
7. **Conclusions & Recommendations** — actionable takeaways

Use markdown (## headers, **bold**, bullet points). Cite sources with URLs.

End with key findings JSON:
\`\`\`json
{"keyFindings": ["finding 1", "finding 2", ...]}
\`\`\``;

      this.synthesis = await anthropicRequestStream(
        'claude-sonnet-4-5',
        [{ role: 'user', content: synthesisPrompt }],
        (chunk, fullText) => {
          this.emit('synthesis_chunk', { chunk, fullText });
        },
        { maxTokens: 8000, temperature: 0.2, timeout: 240000 }
      );

      // Extract key findings
      try {
        const kf = this.synthesis.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (kf) {
          this.keyFindings = JSON.parse(kf[1]).keyFindings || [];
          this.synthesis = this.synthesis.replace(/```json\s*\{[\s\S]*?\}\s*```/, '').trim();
        }
      } catch (_) {}

      // ── Step 5: Complete ──────────────────────────────────────────────────
      this.updateProgress(
        5,
        'complete',
        `Done! ${srcCount} sources, ${this.keyFindings.length} key findings.`
      );
      this.status = 'complete';
      this.completedAt = Date.now();
      clearTimeout(this._timer);
      this.emit('complete', this.toJSON());
    } catch (error) {
      this.status = 'error';
      this.error = error.message;
      this.completedAt = Date.now();
      clearTimeout(this._timer);
      this.updateProgress(this.progress.step, 'error', error.message);
      this.emit('error', { message: error.message });
    }
  }

  // Perplexity-powered search: fast, high quality, returns citations
  async _perplexitySearch() {
    this.updateProgress(
      2,
      'searching',
      'Querying Perplexity Sonar across 5 queries in parallel...'
    );

    const results = await Promise.allSettled(this.queries.map((q) => perplexitySearch(q)));
    const seenUrls = new Set();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        this.perplexityContent.push({
          query: this.queries[i],
          content: r.value.content,
          citations: r.value.citations,
        });
        for (const c of r.value.citations || []) {
          if (!seenUrls.has(c)) {
            seenUrls.add(c);
            this.sources.push({
              url: c,
              title: c,
              description: '',
              query: this.queries[i],
              status: 'done',
              source: 'perplexity',
              textLength: 0,
            });
          }
        }
      }
    }

    this.emit(
      'sources',
      this.sources.map((s) => ({ url: s.url, title: s.title, status: s.status, source: s.source }))
    );

    const ok = this.perplexityContent.length;
    this.updateProgress(
      3,
      'fetching',
      `Perplexity returned ${ok}/5 results with ${seenUrls.size} citations`
    );
    // Mark step 3 done (no separate fetch needed with Perplexity)
    for (let i = 0; i < this.sources.length; i++) {
      this.emit('source_update', { index: i, url: this.sources[i].url, status: 'done', length: 0 });
    }
  }

  // SearXNG search: local meta-search with extraction
  async _searxngSearch() {
    this.updateProgress(2, 'searching', 'Searching via local SearXNG (5 queries)...');

    const allResults = await Promise.allSettled(this.queries.map((q) => searxngSearch(q, 8)));
    const seenUrls = new Set();

    for (let i = 0; i < allResults.length; i++) {
      if (allResults[i].status === 'fulfilled') {
        for (const item of allResults[i].value) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            this.sources.push({
              ...item,
              query: this.queries[i],
              status: 'pending',
              text: '',
              textLength: 0,
            });
          }
        }
      }
    }

    this.emit(
      'sources',
      this.sources.map((s) => ({ url: s.url, title: s.title, status: s.status, source: s.source }))
    );
    this.updateProgress(3, 'fetching', `Extracting content from ${this.sources.length} sources...`);
    if (this._aborted) return;

    // Extract content in batches of 5
    for (let i = 0; i < this.sources.length; i += 5) {
      if (this._aborted) return;
      const batch = this.sources.slice(i, i + 5);
      await Promise.allSettled(
        batch.map(async (src, bi) => {
          const idx = i + bi;
          src.status = 'fetching';
          this.emit('source_update', { index: idx, url: src.url, status: 'fetching' });
          const r = await extractContent(src.url);
          src.status = r.error ? 'error' : r.text.length > 50 ? 'done' : 'empty';
          src.text = r.text;
          src.extractedTitle = r.title;
          src.textLength = r.text?.length || 0;
          src.error = r.error;
          this.emit('source_update', {
            index: idx,
            url: src.url,
            status: src.status,
            length: src.textLength,
          });
        })
      );
      this.updateProgress(
        3,
        'fetching',
        `Extracted ${Math.min(i + 5, this.sources.length)}/${this.sources.length} sources...`
      );
    }
  }

  // Fallback: multi-API search + content extraction
  async _fallbackSearch() {
    this.updateProgress(2, 'searching', 'Searching Wikipedia, HN, arXiv, Reddit (5 queries)...');

    const allResults = await Promise.allSettled(
      this.queries.map(async (q) => {
        const [wiki, hn, arxiv, reddit] = await Promise.allSettled([
          wikiSearch(q, 3),
          hnSearch(q, 3),
          arxivSearch(q, 2),
          redditSearch(q, 2),
        ]);
        return [wiki, hn, arxiv, reddit].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      })
    );

    const seenUrls = new Set();
    for (let i = 0; i < allResults.length; i++) {
      if (allResults[i].status === 'fulfilled') {
        for (const item of allResults[i].value) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            this.sources.push({
              ...item,
              query: this.queries[i],
              status: 'pending',
              text: '',
              textLength: 0,
            });
          }
        }
      }
    }

    this.emit(
      'sources',
      this.sources.map((s) => ({ url: s.url, title: s.title, status: s.status, source: s.source }))
    );
    this.updateProgress(3, 'fetching', `Extracting content from ${this.sources.length} sources...`);
    if (this._aborted) return;

    // Extract content in batches of 5
    for (let i = 0; i < this.sources.length; i += 5) {
      if (this._aborted) return;
      const batch = this.sources.slice(i, i + 5);
      await Promise.allSettled(
        batch.map(async (src, bi) => {
          const idx = i + bi;
          src.status = 'fetching';
          this.emit('source_update', { index: idx, url: src.url, status: 'fetching' });
          const r = await extractContent(src.url);
          src.status = r.error ? 'error' : r.text.length > 50 ? 'done' : 'empty';
          src.text = r.text;
          src.extractedTitle = r.title;
          src.textLength = r.text?.length || 0;
          src.error = r.error;
          this.emit('source_update', {
            index: idx,
            url: src.url,
            status: src.status,
            length: src.textLength,
          });
        })
      );
      this.updateProgress(
        3,
        'fetching',
        `Extracted ${Math.min(i + 5, this.sources.length)}/${this.sources.length} sources...`
      );
    }
  }

  _buildSynthesisContent() {
    if (this.perplexityContent.length > 0) {
      // Perplexity mode: use pre-synthesized content
      return this.perplexityContent
        .map(
          (r) =>
            `### Query: ${r.query}\n**Citations:** ${r.citations.join(', ') || 'none'}\n\n${r.content}`
        )
        .join('\n\n' + '─'.repeat(40) + '\n\n');
    }
    // Fallback mode: use extracted content
    const good = this.sources.filter((s) => s.text && s.text.length > 50);
    if (good.length > 0) {
      return good
        .map(
          (s) =>
            `### Source: ${s.extractedTitle || s.title}\n**URL:** ${s.url}\n**Provider:** ${s.source}\n\n${s.text}`
        )
        .join('\n\n' + '─'.repeat(40) + '\n\n');
    }
    // Last resort
    return `[No content available. Synthesize from your knowledge about: ${this.question}]`;
  }

  toJSON() {
    return {
      id: this.id,
      question: this.question,
      status: this.status,
      progress: this.progress,
      queries: this.queries,
      searchMode: this._searchMode,
      sources: this.sources.map((s) => ({
        url: s.url,
        title: s.title || s.extractedTitle,
        description: s.description,
        query: s.query,
        status: s.status,
        textLength: s.textLength || 0,
        error: s.error,
        source: s.source,
      })),
      synthesis: this.synthesis,
      keyFindings: this.keyFindings,
      error: this.error,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.completedAt ? this.completedAt - this.startedAt : Date.now() - this.startedAt,
    };
  }
}

module.exports = { ResearchJob };
