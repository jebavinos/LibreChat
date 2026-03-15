
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import puppeteerCore from 'puppeteer-core';
import fs from 'fs';
import TurndownService from 'turndown';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const server = new Server(
  {
    name: "web-scraper-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

// Clean up script/style tags
turndownService.remove(['script', 'style', 'noscript', 'iframe']);

async function scrapeUrl(url: string, selector?: string): Promise<string> {
  let browser: any = null;
  try {
    // Prefer full 'puppeteer' (bundles Chromium) if installed. Otherwise fall back to puppeteer-core
    // with an explicitly provided executable path.
  const getLauncher = async (): Promise<any> => {
      // args common to launches
      const commonArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

      // Try to require full puppeteer synchronously so TypeScript won't force module resolution at compile-time
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const full: any = require('puppeteer');
        if (full) {
          const puppeteerLib: any = full && (full.default || full);
          return { puppeteerLib, launchOptions: { headless: true, args: commonArgs } };
        }
      } catch (err) {
        // Full puppeteer not available, fall back to puppeteer-core
        const puppeteerLib: any = puppeteerCore;

        // Candidate executable paths to check
        const candidates = [
          process.env.BROWSER_PATH,
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/snap/bin/chromium-browser'
        ].filter(Boolean) as string[];

        let found: string | null = null;
        for (const c of candidates) {
          try {
            if (c && fs.existsSync(c)) { found = c; break; }
          } catch (e) {}
        }

        // As a last resort, try `which` on common names
        if (!found) {
          try {
            const which = await import('child_process');
            const bin = which.execSync('which chromium-browser || which chromium || which google-chrome || which google-chrome-stable').toString().split('\n')[0].trim();
            if (bin) found = bin;
          } catch (e) {}
        }

        if (!found) {
          throw new Error('No Chromium/Chrome executable found. Install Chromium or set BROWSER_PATH environment variable to the browser binary. Alternatively, install the full "puppeteer" package so a bundled Chromium is available.');
        }

        return { puppeteerLib, launchOptions: { executablePath: found, headless: true, args: commonArgs } };
      }
  };
  const { puppeteerLib, launchOptions } = await getLauncher();
    browser = await puppeteerLib.launch(launchOptions as any);

    const page = await browser.newPage();
    
    // Set user agent to prevent blocking
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (selector) {
        try {
            await page.waitForSelector(selector, { timeout: 5000 });
        } catch (e) {
            console.error(`Selector ${selector} not found within timeout`);
        }
    }

    let content = await page.content();
    
    if (selector) {
        const element = await page.$(selector);
    if (element) {
      content = await page.evaluate((el: any) => el.innerHTML, element as any);
    }
    }
    
    const markdown = turndownService.turndown(content);
    return markdown;

  } catch (error: any) {
    console.error(`Scraping error for ${url}:`, error);
    return `Error scraping ${url}: ${error.message}`;
  } finally {
    if (browser) {
        await browser.close();
    }
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "scrape_url",
        description: "Scrape a webpage and convert its content to Markdown. Useful for reading documentation, articles, or extracting data from websites.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL of the webpage to scrape",
            },
            selector: {
                type: "string",
                description: "Optional: CSS selector to scrape specific content (e.g. 'article', '#main-content'). If omitted, scrapes the whole page.",
            }
          },
          required: ["url"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "scrape_url") {
    const args = request.params.arguments as { url: string; selector?: string };
    
    if (!args.url) {
        throw new Error("URL is required");
    }

    const result = await scrapeUrl(args.url, args.selector);

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  }

  throw new Error(`Tool ${request.params.name} not found`);
});

const transport = new StdioServerTransport();
console.error("Web Scraper MCP Server running on stdio");
await server.connect(transport);
