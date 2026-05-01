// @ts-nocheck
// mcp-local/src/live-data-ticker.ts
import { KiteConnect, KiteTicker } from 'kiteconnect';
import fs from 'fs';
import { Pool } from 'pg';
import { spawn } from 'child_process';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Type definitions for LiveDataTicker since they might be missing or incomplete in @types
interface LiveDataTick {
  instrument_token: number;
  last_price: number;
  oi: number;
  volume: number;
  exchange_timestamp: Date;
  mode: string;
  tradable: boolean;
  change: number;
  oi_day_high?: number;
  oi_day_low?: number;
  depth?: any;
}

interface LiveDataConfig {
  apiKey: string;
  accessTokenPath: string;
  subscribeTokens?: string; // comma-separated
  subscribeSymbols?: string; // comma-separated
  dbUrl?: string;
}

// Global logger
const logger = {
  info: (msg: string) => console.log(`[LiveData] INFO: ${msg}`),
  error: (msg: string, err?: any) => console.error(`[LiveData] ERROR: ${msg}`, err),
  warn: (msg: string) => console.warn(`[LiveData] WARN: ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.debug(`[LiveData] DEBUG: ${msg}`);
  }
};

class LiveDataManager {
  private kite: any;
  private ticker: any = null;
  private config: LiveDataConfig;
  private pool: Pool | null = null;
  // SSE clients
  private sseClients: Set<http.ServerResponse> = new Set();
  private sseServer: http.Server | null = null;
  private reconnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tokensToSubscribe: number[] = [];

  constructor(config: LiveDataConfig) {
    this.config = config;
    this.kite = new KiteConnect({
      api_key: config.apiKey
    });

    if (config.dbUrl) {
      this.pool = new Pool({
        connectionString: config.dbUrl,
      });
      this.initDb();
    }
  }

  private async initDb() {
    if (!this.pool) return;
    try {
      await this.pool.query(`
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
      logger.info('Database table live_ticks ensured.');
    } catch (err) {
      logger.error('Failed to init DB table', err);
    }
  }

  private getAccessToken(): string | null {
    try {
      if (fs.existsSync(this.config.accessTokenPath)) {
        return fs.readFileSync(this.config.accessTokenPath, 'utf8').trim();
      }
    } catch (err) {
      logger.error('Error reading access token file', err);
    }
    return null;
  }

  private async resolveTokens(): Promise<number[]> {
    const tokens: number[] = [];

    // Debug: show incoming config and environment values used for resolution
    logger.debug(`resolveTokens() config.subscribeTokens=${this.config.subscribeTokens}`);
    logger.debug(`resolveTokens() config.subscribeSymbols=${this.config.subscribeSymbols}`);
    logger.debug(`ENV SUBSCRIBE_TOKENS=${process.env.SUBSCRIBE_TOKENS}`);
    logger.debug(`ENV SUBSCRIBE_SYMBOLS=${process.env.SUBSCRIBE_SYMBOLS}`);
    
    // 1. Direct tokens
    if (this.config.subscribeTokens) {
      this.config.subscribeTokens.split(',').forEach(t => {
        const val = parseInt(t.trim(), 10);
        if (!isNaN(val)) tokens.push(val);
      });
    }

    // 2. Symbols
    if (this.config.subscribeSymbols) {
      const symbols = this.config.subscribeSymbols.split(',').map(s => s.trim()).filter(s => s);
      if (symbols.length > 0) {
        try {
          const accessToken = this.getAccessToken();
          if (accessToken) {
            this.kite.setAccessToken(accessToken);
            const instruments = await this.kite.getInstruments('NSE');
            instruments.forEach((ins: any) => {
              if (symbols.includes(ins.tradingsymbol)) {
                tokens.push(parseInt(ins.instrument_token, 10));
              }
            });
          } else {
            logger.warn('Cannot resolve symbols: no access token available.');
          }
        } catch (err) {
          logger.error('Failed to fetch instruments for symbol resolution', err);
        }
      }
    }
    
    // Unique
    const unique = [...new Set(tokens)];
    logger.info(`Resolved subscribe tokens: ${unique.join(', ')}`);
    return unique;
  }

  public async start() {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      logger.error('No access token found. Cannot start ticker.');
      return;
    }

    this.tokensToSubscribe = await this.resolveTokens();
    if (this.tokensToSubscribe.length === 0) {
      logger.warn('No tokens to subscribe. Config provided?', this.config);
    }

    this.connectTicker(accessToken);

    // Start SSE server so other processes (python-interpreter) can subscribe
    try {
      this.startSseServer();
    } catch (e) {
      logger.error('Failed to start SSE server', e);
    }
  }

  private startSseServer() {
    if (this.sseServer) return;

    const port = parseInt(process.env.LIVE_TICKER_PORT || '6789', 10);
    this.sseServer = http.createServer((req, res) => {
      if (!req.url) return res.end();
      const url = req.url.split('?')[0];
      if (url !== '/ticks') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
      }

      // Setup SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');

      this.sseClients.add(res);

      req.on('close', () => {
        try { this.sseClients.delete(res); } catch (e) {}
      });
    });

    this.sseServer.listen(port, () => {
      logger.info(`SSE server listening on http://0.0.0.0:${port}/ticks`);
    });
  }

  private broadcastTick(tick: LiveDataTick) {
    const payload = JSON.stringify(tick);
    for (const res of Array.from(this.sseClients)) {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch (e) {
        try { this.sseClients.delete(res); } catch (er) {}
      }
    }
  }

  private connectTicker(accessToken: string) {
    if (this.ticker) {
      try { this.ticker.disconnect(); } catch (e) {}
    }

    logger.info('Connecting to Live Data Ticker...');
    this.ticker = new KiteTicker({
      api_key: this.config.apiKey,
      access_token: accessToken
    });

    this.ticker.on('ticks', this.onTicks.bind(this));
    this.ticker.on('connect', this.onConnect.bind(this));
    this.ticker.on('disconnect', this.onDisconnect.bind(this));
    this.ticker.on('error', this.onError.bind(this));
    this.ticker.on('close', this.onClose.bind(this));
    
    // Explicitly connect
    this.ticker.connect();
  }

  private onConnect() {
    logger.info('Live Data Ticker connected.');
    this.reconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ticker && this.tokensToSubscribe.length > 0) {
      logger.info(`Subscribing to ${this.tokensToSubscribe.length} tokens...`);
      this.ticker.subscribe(this.tokensToSubscribe);
      this.ticker.setMode(this.ticker.modeFull, this.tokensToSubscribe);
    }
  }

  private onDisconnect(error?: any) {
    logger.warn('Live Data Ticker disconnected.');
    this.scheduleReconnect();
  }

  private onClose(reason?: any) {
    logger.warn(`Live Data Ticker closed. Reason: ${reason}`);
    this.scheduleReconnect();
  }

  private onError(error: any) {
    logger.error('Live Data Ticker error', error);
  }


  private onTicks(ticks: LiveDataTick[]) {
    // Only log ticks for streaming purposes
    // Output ticks as JSON lines so they can be parsed by the consumer (MCP tool)
    ticks.forEach(t => {
      const line = JSON.stringify(t);
      console.log(line);
      // broadcast to SSE clients
      try { this.broadcastTick(t); } catch (e) { logger.debug('Broadcast error: ' + e); }
    });

    // DB Insertion has been disabled as per requirements
    // if (this.pool) {
    //   this.saveTicksToDb(ticks);
    // }
  }


  private async saveTicksToDb(ticks: LiveDataTick[]) {
    if (!this.pool) return;
    
    // Batch insert?
    // For simplicity, fire-and-forget individual inserts or small batch
    // A real production system would buffer these.
    
    try {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const insertText = `
          INSERT INTO live_ticks (instrument_token, exchange_timestamp, last_price, oi, volume, raw)
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        
        for (const t of ticks) {
             await client.query(insertText, [
                t.instrument_token,
                t.exchange_timestamp,
                t.last_price,
                t.oi,
                t.volume,
                JSON.stringify(t)
             ]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        logger.error('Error saving ticks to DB', e);
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('DB connection error during tick save', err);
    }
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    
    logger.info('Scheduling reconnect in 5s...');
    this.reconnectTimer = setTimeout(async () => {
      logger.info('Attempting reconnect...');
      
      let accessToken = this.getAccessToken();
      const valid = await this.isTokenValid(accessToken);
      
      if (valid && accessToken) {
        this.connectTicker(accessToken);
      } else {
         // Token logic
         logger.info('Token invalid or missing. Attempting refresh...');
         const refreshed = await this.refreshToken();
         if (refreshed) {
           accessToken = this.getAccessToken();
           if (accessToken) {
             this.connectTicker(accessToken);
           }
         } else {
           logger.error('Token refresh failed. Will retry later.');
           // Wait longer before next try
           this.reconnecting = false;
           setTimeout(() => this.scheduleReconnect(), 30000);
         }
      }
    }, 5000);
  }

  private async isTokenValid(token: string | null): Promise<boolean> {
      if (!token) return false;
      try {
          this.kite.setAccessToken(token);
          // lightweight call
          await this.kite.getProfile();
          return true;
      } catch (err: any) {
          return false;
      }
  }

  private async refreshToken(): Promise<boolean> {
      return new Promise((resolve) => {
          const isCompiled = __dirname.endsWith("dist");
          // Python script is not compiled to dist, so it stays in src
          // If running from dist, go up one level then to src
          const script = isCompiled 
            ? path.join(__dirname, "../src/refresh_token.py")
            : path.join(__dirname, "refresh_token.py");
          
          logger.info(`Running token refresh script: ${script}`);
          const proc = spawn('python3', [script], { env: process.env });
          
          proc.stdout.on('data', (d) => logger.debug(`[Refresh] ${d}`));
          proc.stderr.on('data', (d) => logger.error(`[Refresh Error] ${d}`));
          
          proc.on('close', (code) => {
             resolve(code === 0);
          });
      });
  }
}

// Singleton runner if executed directly
if (process.argv[1] === __filename) {
    // Basic env check
    const apiKey = process.env.ZERODHA_API_KEY;
    const accessTokenFile = process.env.ACCESS_TOKEN_FILE || 'kite_access_token.txt';
    // DB URL optional now or ignored
    const dbUrl = null; // process.env.DATABASE_URL;

    if (!apiKey) {
        logger.error('ZERODHA_API_KEY env var is required.');
        process.exit(1);
    }

    const manager = new LiveDataManager({
        apiKey,
        accessTokenPath: accessTokenFile,
        subscribeTokens: process.env.SUBSCRIBE_TOKENS,
        subscribeSymbols: process.env.SUBSCRIBE_SYMBOLS,
        dbUrl: undefined // Disable DB
    });

    // Allow overriding SSE port via env for python-interpreter
    if (process.env.LIVE_TICKER_PORT) {
      logger.info(`LIVE_TICKER_PORT set to ${process.env.LIVE_TICKER_PORT}`);
    }

    manager.start().catch(err => {
        logger.error('Fatal error starting LiveDataManager', err);
    });
    
    // Keep alive
    process.on('SIGINT', () => {
        logger.info('Stopping...');
        process.exit(0);
    });
}

export default LiveDataManager;
