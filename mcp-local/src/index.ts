// @ts-nocheck
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import { KiteConnect } from "kiteconnect";
import { spawn } from "child_process";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';
import dotenv from "dotenv";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

// Postgres Pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// Database Initialization
async function initDb() {
  const client = await pool.connect();
  try {
    // Live Ticks Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS live_ticks (
        id SERIAL PRIMARY KEY,
        instrument_token INTEGER,
        exchange_timestamp TIMESTAMP WITH TIME ZONE,
        last_price NUMERIC,
        oi NUMERIC,
        volume NUMERIC,
        raw JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.error('[LiveData] Database table live_ticks ensured.');

    // Instruments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS instruments (
        instrument_token INTEGER PRIMARY KEY,
        exchange_token INTEGER,
        tradingsymbol TEXT,
        name TEXT,
        last_price NUMERIC,
        expiry DATE,
        strike NUMERIC,
        tick_size NUMERIC,
        lot_size INTEGER,
        instrument_type TEXT,
        segment TEXT,
        exchange TEXT
      );
    `);
    console.error('[LiveData] Database table instruments ensured.');

    // Check count and maybe populate?
    const res = await client.query('SELECT COUNT(*) as count FROM instruments');
    if (parseInt(res.rows[0].count) === 0) {
        console.error('[LiveData] Instruments table empty. Triggering initial sync...');
        await syncInstruments(client);
    }

  } catch (err) {
    console.error('[LiveData] Failed to init DB table', err);
  } finally {
    client.release();
  }
}

async function syncInstruments(clientParam = null) {
    const client = clientParam || await pool.connect();
    let releaseClient = !clientParam;

    try {
        const apiKey = process.env.KITE_API_KEY || process.env.ZERODHA_API_KEY;
        const accessTokenPath = process.env.ACCESS_TOKEN_FILE || path.resolve(__dirname, "../kite_access_token.txt");
        
        if (!fs.existsSync(accessTokenPath)) {
             console.error(`[LiveData] Cannot sync instruments: Access token file not found at ${accessTokenPath}`);
             return;
        }

        const accessToken = fs.readFileSync(accessTokenPath, 'utf8').trim();
        const kite = new KiteConnect({ api_key: apiKey });
        kite.setAccessToken(accessToken);

        console.error('[LiveData] Fetching instruments from Kite...');
        const instruments = await kite.getInstruments();
        console.error(`[LiveData] Fetched ${instruments.length} instruments.`);

        // Clear existing data before sync
        await client.query('TRUNCATE TABLE instruments');

        // Batch insert
        // Use pg-copy-streams or just normal batched insert if list is small enough?
        // 90k instruments is large for simple insert. 
        // Let's use simple batching.

        // Helper to sanitize numeric inputs that might be empty strings
        const safeFloat = (v: any) => {
            if (v === "" || v === null || v === undefined) return null;
            const n = parseFloat(v);
            return isNaN(n) ? null : n;
        };
        const safeInt = (v: any) => {
            if (v === "" || v === null || v === undefined) return null;
            const n = parseInt(v, 10);
            return isNaN(n) ? null : n;
        };

        const batchSize = 1000;
        for (let i = 0; i < instruments.length; i += batchSize) {
            const batch = instruments.slice(i, i + batchSize);
            const values = [];
            const placeholders = [];
            let paramOffset = 0;
            
            batch.forEach((ins) => {
                const instrument_token = safeInt(ins.instrument_token);
                if (instrument_token === null) return; // Skip invalid tokens which violate PK

                values.push(
                    instrument_token, 
                    ins.exchange_token, 
                    ins.tradingsymbol, 
                    ins.name, 
                    safeFloat(ins.last_price), 
                    ins.expiry ? new Date(ins.expiry) : null, 
                    safeFloat(ins.strike), 
                    safeFloat(ins.tick_size), 
                    safeInt(ins.lot_size), 
                    ins.instrument_type, 
                    ins.segment, 
                    ins.exchange
                );

                const p = [];
                for(let k=1; k<=12; k++) p.push(`$${paramOffset + k}`);
                placeholders.push(`(${p.join(',')})`);
                paramOffset += 12;
            });

            if (values.length === 0) continue;

            const query = `
                INSERT INTO instruments (instrument_token, exchange_token, tradingsymbol, name, last_price, expiry, strike, tick_size, lot_size, instrument_type, segment, exchange)
                VALUES ${placeholders.join(',')}
                ON CONFLICT (instrument_token) DO UPDATE SET 
                  last_price = EXCLUDED.last_price,
                  tradingsymbol = EXCLUDED.tradingsymbol,
                  name = EXCLUDED.name;
            `;
            
            await client.query(query, values);
            if (i % 10000 === 0) console.error(`[LiveData] Synced ${i} instruments...`);
        }
        console.error('[LiveData] Instruments sync complete.');

    } catch (err) {
        console.error('[LiveData] Error syncing instruments:', err);
    } finally {
        if (releaseClient) client.release();
    }
}

// MCP Server Setup
const server = new Server(
  {
    name: "postgres-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper Functions
async function refreshAuthToken(verbose = false) {
    const scriptPath = path.resolve(__dirname, "refresh_token.py");
    if (verbose) console.error(`[LiveDataAuth] Starting token refresh via ${scriptPath}...`);

    return new Promise((resolve) => {
        const proc = spawn("python3", [scriptPath], {
            env: process.env,
            cwd: path.dirname(scriptPath)
        });

        let output = "";
        let errorOutput = "";
        proc.stdout.on("data", (data) => { output += data.toString(); });
        proc.stderr.on("data", (data) => { errorOutput += data.toString(); });
        proc.on("close", (code) => {
            if (code === 0) {
                 if (verbose) console.error(`[LiveDataAuth] Token refreshed successfully.`);
                 resolve({ success: true, output });
            } else {
                 if (verbose) console.error(`[LiveDataAuth] Token refresh failed (code ${code}). Error: ${errorOutput}`);
                 resolve({ success: false, output, error: errorOutput });
            }
        });
    });
}

function startTokenMaintenance() {
    const INTERVAL = 30 * 60 * 1000;
    console.error("[LiveDataAuth] Starting periodic token maintenance (every 30m)...");
    
    refreshAuthToken(true).catch(err => console.error("[LiveDataAuth] Initial refresh error:", err));

    setInterval(async () => {
        try {
            console.error("[LiveDataAuth] Interval reached. Refreshing token...");
            await refreshAuthToken(true);
        } catch (err) {
            console.error("[LiveDataAuth] Background refresh error:", err);
        }
    }, INTERVAL);
}

async function startLiveTicker(duration = 0) {
  // Use compiled JS if available, fallback to TS via tsx if not
  let tickerScriptPath = path.resolve(__dirname, "live-data-ticker.js");
  let execCmd = "node";
  let execArgs = [tickerScriptPath];

  if (!fs.existsSync(tickerScriptPath)) {
      tickerScriptPath = path.resolve(__dirname, "live-data-ticker.ts");
      const tsxPath = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
      execArgs = [tsxPath, tickerScriptPath];
  }
  
  // Ensure logs directory exists
  const logDir = path.resolve(__dirname, "../logs");
  if (!fs.existsSync(logDir)) {
      try {
          fs.mkdirSync(logDir, { recursive: true });
      } catch (err) {
          console.error(`Failed to create log directory: ${err}`);
      }
  }

  const logFile = path.resolve(logDir, "live_ticker.log");
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // get initial size for reading diff later
  let initialSize = 0;
  try {
      const stats = fs.statSync(logFile);
      initialSize = stats.size;
  } catch (e) {}
  
  const childEnv = { ...process.env, DEBUG: "true" };
  
  const child = spawn(execCmd, execArgs, {
    cwd: path.dirname(tickerScriptPath),
    stdio: [ 'ignore', out, err ], 
    detached: true,
    env: childEnv
  });
  
  child.unref();

  if (duration > 0) {
      await new Promise(resolve => setTimeout(resolve, duration * 1000));
      
      try {
          const stream = fs.createReadStream(logFile, { start: initialSize, encoding: 'utf8' });
          let output = '';
          for await (const chunk of stream) {
              output += chunk;
          }
          return {
              content: [{ type: "text", text: `Started Live Data Ticker (PID: ${child.pid}).\nLogs captured over ${duration}s:\n${output}` }],
          };
      } catch (e) {
          return {
              content: [{ type: "text", text: `Started Live Data Ticker (PID: ${child.pid}).\nCould not read logs: ${e.message}` }],
          };
      }
  }

  return {
    content: [{ type: "text", text: `Started Live Data Ticker (PID: ${child.pid}) in background. Logs are being written to ${logFile}` }],
  };
}


// --- Request Handlers ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description: "Run a read-only SQL query on the PostgreSQL database",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", description: "The SQL query to execute" }
          },
          required: ["sql"]
        }
      },
      {
        name: "list_tables",
        description: "List all tables in the database",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "summarize_database",
        description: "Get schema information for the entire database or a specific table",
        inputSchema: {
          type: "object",
          properties: {
             table_name: { type: "string", description: "Optional: The name of the specific table to summarize" }
          }
        }
      },
      {
        name: "summarise_database",
        description: "Alias for summarize_database",
        inputSchema: {
          type: "object",
          properties: {
             table_name: { type: "string", description: "Optional: The name of the specific table to summarize" }
          }
        }
      },
      {
        name: "save_query_to_csv",
        description: "Run a read-only SQL query on the PostgreSQL database and save the result to a CSV file",
        inputSchema: {
          type: "object",
          properties: {
             sql: { type: "string", description: "The SQL query to execute" },
             file_path: { type: "string", description: "Optional: The absolute path or filename to save the CSV file. Defaults to a timestamped file in /app/data." }
          },
          required: ["sql"]
        }
      },
      {
        name: "start_live_ticker",
        description: "Start the Live Data Ticker background process. Optionally read the logs for a few seconds to verify output.",
        inputSchema: {
          type: "object",
          properties: {
             duration: { type: "number", description: "Duration in seconds to wait and capture logs. Default 0 (background only)." }
          }
        }
      },
      {
        name: "refresh_live_token",
        description: "Manually trigger a Live Data token refresh and refresh instruments list",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "sync_instruments",
        description: "Force sync of instruments table from Kite API",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_historical_data",
        description: "Get historical data from Kite Connect API. Saves the result to a CSV file in /app/data and returns the file path and metadata.",
        inputSchema: {
          type: "object",
          properties: {
             instrument_token: { type: "string", description: "Instrument token to filter by (optional if trading_symbol provided)" },
             trading_symbol: { type: "string", description: "Trading symbol (e.g., 'TCS.NS', 'INFY') to look up instrument token for." },
             exchange: { type: "string", description: "Exchange to filter by (e.g., NSE, BSE, NFO, BFO, MCX, CDS, GLOBAL)." },
             start_date: { type: "string", description: "Start date (ISO format or yyyy-mm-dd HH:MM:SS)" },
             end_date: { type: "string", description: "End date (ISO format or yyyy-mm-dd HH:MM:SS)" },
             interval: { type: "string", description: "Candle interval (minute, day, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute). Default: day" }
          },
          required: ["start_date", "end_date"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ---------------- QUERY ----------------
    if (name === "query") {
      const { sql } = args;
      const normalizedSql = sql.trim().toLowerCase();
      if (!normalizedSql.startsWith("select") && !normalizedSql.startsWith("with")) {
          return {
              content: [{ type: "text", text: "Only SELECT or WITH queries are allowed for safety." }],
              isError: true,
          };
      }
      const client = await pool.connect();
      try {
          const result = await client.query(sql);
          return {
              content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
          };
      } catch (err) {
          return {
              content: [{ type: "text", text: `Error executing query: ${err.message}` }],
              isError: true,
          };
      } finally {
          client.release();
      }
    }

    // ---------------- LIST TABLES ----------------
    if (name === "list_tables") {
      const client = await pool.connect();
      try {
          const result = await client.query(`
              SELECT table_name 
              FROM information_schema.tables 
              WHERE table_schema = 'public'
          `);
          return {
              content: [{ type: "text", text: result.rows.map(row => row.table_name).join("\n") }],
          };
      } catch (err) {
          return {
              content: [{ type: "text", text: `Error listing tables: ${err.message}` }],
              isError: true,
          };
      } finally {
          client.release();
      }
    }

    // ---------------- SUMMARIZE DATABASE ----------------
    if (name === "summarize_database" || name === "summarise_database") {
      const { table_name } = args || {};
      const scriptPath = path.resolve(__dirname, "db_summary.py");
      const argsList = [scriptPath];
      if (table_name) argsList.push(table_name);

      try {
          const output = await new Promise((resolve, reject) => {
              const proc = spawn("python3", argsList, {
                  env: process.env,
                  cwd: path.dirname(scriptPath)
              });
              let stdout = "";
              let stderr = "";
              proc.stdout.on("data", (data) => { stdout += data.toString(); });
              proc.stderr.on("data", (data) => { stderr += data.toString(); });
              proc.on("close", (code) => {
                  if (code === 0) resolve(stdout);
                  else reject(new Error(stderr || `Process exited with code ${code}`));
              });
          });
          
          return {
              content: [{ type: "text", text: output }],
          };
      } catch (err) {
          return {
              content: [{ type: "text", text: `Error summarizing: ${err.message}` }],
              isError: true,
          };
      }
    }

    // ---------------- SAVE QUERY TO CSV ----------------
    if (name === "save_query_to_csv") {
      const { sql, file_path } = args;
      const normalizedSql = sql.trim().toLowerCase();
      if (!normalizedSql.startsWith("select") && !normalizedSql.startsWith("with")) {
          return {
              content: [{ type: "text", text: "Only SELECT or WITH queries are allowed for safety." }],
              isError: true,
          };
      }
      
      const client = await pool.connect();
      try {
          const result = await client.query(sql);
          if (result.rows.length === 0) {
              return { content: [{ type: "text", text: "No data found." }] };
          }
          const headers = Object.keys(result.rows[0]);
          const csvRows = result.rows.map(row => 
              headers.map(fieldName => {
                  const val = row[fieldName];
                  if (val instanceof Date) return val.toISOString();
                  if (val === null || val === undefined) return '';
                  return String(val).replace(/"/g, '""'); // basic escaping
              }).join(',')
          );
          const content = [headers.join(','), ...csvRows].join('\n');
          
          let finalPath = file_path;
          if (!finalPath) {
               const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
               finalPath = `query_result_${timestamp}.csv`;
          }
          
          if (!path.isAbsolute(finalPath)) {
               finalPath = path.join('/app/data', finalPath);
          }
          
          const dir = path.dirname(finalPath);
          if (!fs.existsSync(dir)) {
               try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
          }

          await fsPromises.writeFile(finalPath, content);
          return { 
              content: [{ type: "text", text: `File saved to ${finalPath}.\nTotal rows: ${result.rows.length}` }] 
          };
      } catch (err) {
          return {
              content: [{ type: "text", text: `Error saving: ${err.message}` }],
              isError: true,
          };
      } finally {
          client.release();
      }
    }

    // ---------------- START LIVE TICKER ----------------
    if (name === "start_live_ticker") {
        const { duration } = args || {};
        return await startLiveTicker(duration || 0);
    }

    // ---------------- REFRESH LIVE TOKEN ----------------
    if (name === "refresh_live_token") {
        const result = await refreshAuthToken(true);
        if (result.success) {
            let syncMsg = "";
            try {
                console.error('[LiveData] Token refreshed. Triggering instruments sync...');
                // we don't await because sync is potentially long and we want to return response quickly?
                // Actually maybe we should await for the user to know it's ready.
                // 90k rows might take seconds.
                await syncInstruments();
                syncMsg = "Instruments table updated.";
            } catch (e) {
                console.error('[LiveData] Post-refresh sync failed:', e);
                syncMsg = `Instruments sync failed: ${e.message}`;
            }

            return {
                content: [{ type: "text", text: `Token Refreshed.\n${result.output}\n${syncMsg}` }],
            };
        } else {
            return {
                content: [{ type: "text", text: `Token Refresh Failed.\n${result.error}` }],
                isError: true,
            };
        }
    }


    // ---------------- SYNC INSTRUMENTS ----------------
    if (name === "sync_instruments") {
         try {
             await syncInstruments();
             return {
                 content: [{ type: "text", text: "Instruments sync completed (or attempted)." }],
             };
         } catch (e) {
             return {
                 content: [{ type: "text", text: `Sync failed: ${e.message}` }],
                 isError: true
             };
         }
    }

    // ---------------- GET HISTORICAL DATA ----------------
    if (name === "get_historical_data") {
        let { instrument_token, trading_symbol, exchange, start_date, end_date, interval, format } = args;
        
        // Default interval
        if (!interval) interval = "day";

        let client = await pool.connect();
        try {
            // Resolve trading_symbol to instrument_token if provided
            if (trading_symbol && !instrument_token) {
                 // Try to strip e.g. .NS suffix if common
                 let symbol = trading_symbol.toUpperCase();
                 let exchangeFilter = exchange ? exchange.toUpperCase() : null;
                 
                 // Basic heuristic: check for suffix
                 const suffixDot = symbol.lastIndexOf(".");
                 if (suffixDot !== -1) {
                     const suffix = symbol.substring(suffixDot + 1).toUpperCase();
                     if (suffix === 'NS') exchangeFilter = exchangeFilter || 'NSE';
                     else if (suffix === 'BO') exchangeFilter = exchangeFilter || 'BSE';
                     else if (['BFO', 'BSE', 'CDS', 'GLOBAL', 'MCX', 'NCO', 'NFO', 'NSE', 'NSEIX'].includes(suffix)) {
                         exchangeFilter = exchangeFilter || suffix;
                     }
                     symbol = symbol.substring(0, suffixDot);
                 }

                 // Try finding in instruments table
                 // Prefer exact match on tradingsymbol
                 let insQuery = `
                    SELECT instrument_token 
                    FROM instruments 
                    WHERE tradingsymbol = $1 
                 `;
                 const params = [symbol];
                 if (exchangeFilter) {
                     insQuery += ` AND exchange = $${params.length + 1}`;
                     params.push(exchangeFilter);
                 }
                 insQuery += ` LIMIT 1`;

                 let res = await client.query(insQuery, params);
                 
                 if (res.rows.length === 0) {
                     // Try with original if stripped failed
                     // If we filtered by exchange, try removing filter?
                     if (exchangeFilter) {
                          // Try without exchange filter but keep stripped symbol
                          const simpleQuery = `SELECT instrument_token FROM instruments WHERE tradingsymbol = $1 LIMIT 1`;
                          res = await client.query(simpleQuery, [symbol]);
                     }
                     
                     if (res.rows.length === 0 && symbol !== trading_symbol.toUpperCase()) {
                         // Try with original full symbol (maybe it really has .NS inside?)
                         const simpleQuery = `SELECT instrument_token FROM instruments WHERE tradingsymbol = $1 LIMIT 1`;
                         res = await client.query(simpleQuery, [trading_symbol.toUpperCase()]);
                     }
                 }
                 
                 if (res.rows.length === 0) {
                     // Map common indices
                     const indexMap = {
                         "NIFTY": "NIFTY 50",
                         "BANKNIFTY": "NIFTY BANK",
                         "FINNIFTY": "NIFTY FIN SERVICE",
                         "MIDCPNIFTY": "NIFTY MID SELECT",
                         "SENSEX": "BSE SENSEX",
                         "BANKEX": "BSE BANKEX"
                     };
                     
                     if (indexMap[symbol]) {
                         const mappedQuery = `SELECT instrument_token FROM instruments WHERE tradingsymbol = $1 LIMIT 1`;
                         res = await client.query(mappedQuery, [indexMap[symbol]]);
                     }
                 }
                 
                 if (res.rows.length === 0) {
                     // Try partial match ? No, dangerous. Maybe try appending '-EQ' for NSE.
                     const eqQuery = `SELECT instrument_token FROM instruments WHERE tradingsymbol = $1 LIMIT 1`;
                     res = await client.query(eqQuery, [`${symbol}-EQ`]);
                 }

                 if (res.rows.length > 0) {
                     instrument_token = res.rows[0].instrument_token.toString();
                 } else {
                     return {
                        content: [{ type: "text", text: `Could not resolve instrument token for symbol: ${trading_symbol}` }],
                        isError: true
                     };
                 }
            }

            if (!instrument_token) {
                 return { content: [{ type: "text", text: "instrument_token or trading_symbol is required" }], isError: true };
            }

            // --- FETCH FROM KITE ---
            const apiKey = process.env.KITE_API_KEY || process.env.ZERODHA_API_KEY;
            const accessTokenPath = process.env.ACCESS_TOKEN_FILE || path.resolve(__dirname, "../kite_access_token.txt");
            
            if (!fs.existsSync(accessTokenPath)) {
                return { content: [{ type: "text", text: "Access token file not found. Please ensure you are logged in." }], isError: true };
            }
            const accessToken = fs.readFileSync(accessTokenPath, 'utf8').trim();
            const kite = new KiteConnect({ api_key: apiKey });
            kite.setAccessToken(accessToken);

            // Fetch from Kite
            const historical = await kite.getHistoricalData(instrument_token, interval, start_date, end_date);

            if (!historical || historical.length === 0) {
                 return { content: [{ type: "text", text: "No historical data found for the given criteria." }] };
            }

            const headers = Object.keys(historical[0]);
            const csvRows = historical.map(row => 
                headers.map(fieldName => {
                    const val = row[fieldName];
                    if (val instanceof Date) return val.toISOString();
                    if (val === null || val === undefined) return '';
                    return String(val); 
                }).join(',')
            );
            const content = [headers.join(','), ...csvRows].join('\n');
            
            // Generate Filename
            // e.g., historical_TCS_day_2023-01-01_2023-01-05.csv
            // Sanitize dates for filename
            const sanitize = (s) => s.replace(/[^a-zA-Z0-9]/g, '-');
            const tokenOrSymbol = trading_symbol ? trading_symbol : instrument_token;
            const filename = `historical_${sanitize(tokenOrSymbol)}_${interval}_${sanitize(start_date)}_${sanitize(end_date)}.csv`;
            const filePath = path.join('/app/data', filename);

            // Ensure dir exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            await fsPromises.writeFile(filePath, content);

            return {
                content: [{ 
                    type: "text", 
                    text: JSON.stringify({
                        message: "Data saved successfully.",
                        file_path: filePath,
                        count: historical.length,
                        start_date,
                        end_date, 
                        interval
                    }, null, 2)
                }],
            };
        } catch (err) {
            return {
                content: [{ type: "text", text: `Error fetching data from Kite: ${err.message}` }],
                isError: true,
            };
        } finally {
            if (client) client.release();
        }
    }
    
    throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);

  } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tool ${name}: ${err.message}`,
            },
          ],
          isError: true,
        };
  }
});

// Initialization
async function run() {
  await initDb();
  startTokenMaintenance();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Postgres MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
