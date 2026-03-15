
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import dotenv from "dotenv";
import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import "isomorphic-fetch";
import pdf from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const server = new Server(
  {
    name: "sharepoint-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Graph Client
let graphClient: Client | null = null;
const TENANT_ID = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET;
const SITE_ID = process.env.SHAREPOINT_SITE_ID; // Optional: If specific site is targeted
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID; // Optional: If specific drive is targeted

if (TENANT_ID && CLIENT_ID && CLIENT_SECRET) {
  const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
  graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken("https://graph.microsoft.com/.default");
        return token.token;
      },
    },
  });
}

// Data Handling Helpers
async function extractTextFromFile(content: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  if (fileName.toLowerCase().endsWith(".pdf")) {
    const data = await pdf(Buffer.from(content));
    return data.text;
  } else if (fileName.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(content) });
    return result.value;
  } else {
    // Text-based fallback
    return Buffer.from(content).toString("utf-8");
  }
}

async function getDriveId(): Promise<string> {
  if (DRIVE_ID) return DRIVE_ID;
  if (!graphClient) throw new Error("Graph Client not initialized");
  
  // Default to the first drive of the specific site or the root site
  const requestPath = SITE_ID ? `/sites/${SITE_ID}/drive` : "/sites/root/drive";
  const drive = await graphClient.api(requestPath).get();
  return drive.id;
}

// Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_stock_documents",
        description: "List all documents available for a specific stock symbol folder in SharePoint.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "The stock symbol (folder name) to look for.",
            },
          },
          required: ["symbol"],
        },
      },
      {
        name: "read_sharepoint_file",
        description: "Read the text content of a file from SharePoint given its file ID or name and path.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: {
              type: "string",
              description: "The ID of the file to read (preferred).",
            },
            fileName: {
              type: "string",
              description: "The name of the file if ID is unknown (requires path context).",
            },
             symbol: {
              type: "string",
              description: "The stock symbol (folder name) context if searching by name.",
            },
          },
        },
      },
      {
        name: "search_sharepoint",
        description: "Search for files within the SharePoint drive matching a query string.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query (e.g., 'financial statement').",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!graphClient) {
    throw new Error("SharePoint configuration missing. Please check credentials.");
  }

  const { name, arguments: args } = request.params;

  try {
    const driveId = await getDriveId();

    if (name === "list_stock_documents") {
      const { symbol } = z.object({ symbol: z.string() }).parse(args);
      
      // Find the folder with the stock symbol name
      // Search specifically for folders in the root or known path
      // This uses a search query to find the folder first
      const searchUrl = `/drives/${driveId}/root/search(q='${symbol}')`;
      const searchResults = await graphClient.api(searchUrl).get();
      
      // Filter for folder specifically
      const folder = searchResults.value.find((item: any) => 
        item.folder && item.name.toLowerCase() === symbol.toLowerCase()
      );

      if (!folder) {
        return { content: [{ type: "text", text: `No folder found for symbol: ${symbol}` }] };
      }

      // List children of the folder
      const children = await graphClient.api(`/drives/${driveId}/items/${folder.id}/children`).get();
      
      const files = children.value.map((f: any) => `[${f.name}] (ID: ${f.id}) - Type: ${f.folder ? 'Folder' : 'File'}`).join("\n");
      
      return {
        content: [{ type: "text", text: `Documents for ${symbol} (Folder ID: ${folder.id}):\n${files}` }],
      };

    } else if (name === "read_sharepoint_file") {
      const schema = z.object({
        fileId: z.string().optional(),
        fileName: z.string().optional(),
        symbol: z.string().optional()
      });
      const { fileId, fileName, symbol } = schema.parse(args);

      let targetId = fileId; 
      let targetName = fileName || "unknown";

      if (!targetId && fileName && symbol) {
         // Try to resolve ID from name + symbol context
         const searchUrl = `/drives/${driveId}/root/search(q='${symbol}')`;
         const searchResults = await graphClient.api(searchUrl).get();
         const folder = searchResults.value.find((item: any) => 
            item.folder && item.name.toLowerCase() === symbol.toLowerCase()
         );
         
         if (folder) {
             const children = await graphClient.api(`/drives/${driveId}/items/${folder.id}/children`).get();
             const file = children.value.find((f: any) => f.name.toLowerCase().includes(fileName.toLowerCase()));
             if (file) {
                 targetId = file.id;
                 targetName = file.name;
             }
         }
      }

      if (!targetId) {
        return { content: [{ type: "text", text: `Could not resolve file. Please provide a valid fileId or exact fileName and symbol.` }] };
      }

      // Get file metadata for name/mime
      const fileMeta = await graphClient.api(`/drives/${driveId}/items/${targetId}`).get();
      targetName = fileMeta.name;

      // Download content
      // For large files, this might buffer in memory. 
      // Graph API returns a redirect to a download URL usually, or the stream.
      // @microsoft/microsoft-graph-client responseType stream is needed.
      const response = await graphClient.api(`/drives/${driveId}/items/${targetId}/content`).responseType('arraybuffer' as any).get();
      
      // Parse content
      const text = await extractTextFromFile(response, "", targetName);

      // Truncate if too long? For now return full text, let LLM handle context limit.
      return {
        content: [{ type: "text", text: `Content of ${targetName}:\n\n${text}` }],
      };

    } else if (name === "search_sharepoint") {
      const { query } = z.object({ query: z.string() }).parse(args);
      
      const searchUrl = `/drives/${driveId}/root/search(q='${query}')`;
      const searchResults = await graphClient.api(searchUrl).get();
      
      const results = searchResults.value.map((item: any) => {
          return `- ${item.name} (${item.folder ? 'Folder' : 'File'}) [ID: ${item.id}] (Parent: ${item.parentReference?.name || 'root'})`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `Search results for '${query}':\n${results}` }],
      };
    }

    throw new Error(`Tool ${name} not found`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
