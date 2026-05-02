// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || '6275c717b18c24205';

if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
  console.error('Error: GOOGLE_API_KEY and GOOGLE_CSE_ID environment variables are required.');
}

if (!GOOGLE_CSE_ID) {
  console.error('Error: GOOGLE_CSE_ID environment variables are required.');
}

const server = new Server(
  {
    name: 'web-search-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

async function performGoogleSearch(query: string, num: number = 5, sites: string[] = []): Promise<string> {
  try {
    let finalQuery = query;
    if (sites && sites.length > 0) {
      const siteQuery = sites.map((site) => `site:${site}`).join(' OR ');
      finalQuery = `${query} (${siteQuery})`;
    }

    const url = 'https://customsearch.googleapis.com/customsearch/v1';
    const params = {
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CSE_ID,
      q: finalQuery,
      num: num,
    };

    const response = await axios.get(url, { params });
    const items = response.data.items || [];

    if (items.length === 0) {
      return 'No results found.';
    }

    const results = items.map((item: any) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
    }));

    return JSON.stringify(results, null, 2);
  } catch (error: any) {
    if (error.response && error.response.status === 429) {
      return await performDuckDuckGoFallback(query);
    }
    return `Error performing search: ${error.message}`;
  }
}

  async function performDuckDuckGoFallback(query: string): Promise<string> {
    try {
      const financialSites = "finance OR bloomberg OR reuters OR cnbc OR wsj OR investing OR moneycontrol OR screener OR economictimes";
      const searchQuery = `${query} ${financialSites}`;
      const response = await axios.get('https://www.bing.com/search', {
        params: { q: searchQuery },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:114.0) Gecko/20100101 Firefox/114.0',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      const $ = cheerio.load(response.data);
      const results: SearchResult[] = [];
      $('.b_algo').each((i, elem) => {
        const titleElem = $(elem).find('h2 a');
        const snippetElem = $(elem).find('.b_caption p, .b_algoSlug, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4');
        const link = titleElem.attr('href');
        const title = titleElem.text().trim();
        const snippet = snippetElem.text().trim();

        if (title && link) {
          results.push({ title, link, snippet });
        }
      });
      if (results.length === 0) {
        return 'No results found (Fallback Bing). Search queries might be too specific or blocked.';
      }
      return JSON.stringify(results.slice(0, 5), null, 2);
    } catch (fallbackError: any) {
       return `Error performing search (Fallback Bing): ${fallbackError.message}`;
    }
  }server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'google_search',
        description: 'Perform a Google search to find information on the web.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to perform.',
            },
            num: {
              type: 'number',
              description: 'Number of results to return (default: 5).',
              default: 5,
            },
            sites: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Limit search results to these specific domains. e.g. ["techcrunch.com", "bloomberg.com"]',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'google_search') {
    const args = request.params.arguments as { query: string; num?: number; sites?: string[] };
    const query = args.query;
    const num = args.num ?? 5;
    const sites = args.sites ?? [];

    const result = await performGoogleSearch(query, num, sites);

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }

  throw new Error(`Tool ${request.params.name} not found`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
