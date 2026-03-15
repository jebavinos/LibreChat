// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
  console.error('Error: GOOGLE_API_KEY and GOOGLE_CSE_ID environment variables are required.');
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

    const url = 'https://www.googleapis.com/customsearch/v1';
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
    return `Error performing search: ${error.message}`;
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
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
