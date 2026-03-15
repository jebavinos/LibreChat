# Kite Live MCP Integration

This module allows you to stream live market data from Zerodha Kite Connect directly into your PostgreSQL database using a persistent WebSocket connection.

## Features

- **Persistent Connection**: Runs as a background process that stays connected to Kite Ticker.
- **Auto-Reconnect**: Automatically reconnects with exponential backoff if the connection drops.
- **Database Integration**: Saves every tick to a `live_ticks` table in Postgres (created automatically).
- **Control via MCP**: Start and manage the ticker using the `start-kite-live` MCP tool.

## Setup

1. **Install Dependencies**:
   Ensure `kiteconnect` and `pg` are installed:
   ```bash
   cd mcp-local
   npm install kiteconnect pg
   ```

2. **Environment Variables**:
   Add these to your `.env` file or export them:
   ```bash
   ZERODHA_API_KEY=your_api_key
   ACCESS_TOKEN_FILE=/path/to/kite_access_token.txt
   DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
   # Optional defaults
   SUBSCRIBE_SYMBOLS=RELIANCE,INFY,TCS
   ```

3. **Access Token**:
   You must have a valid access token in the file specified by `ACCESS_TOKEN_FILE`. The `IndianStock.py` script in `/opt/Stock_data/` generates this file. ensure this MCP can read it.

## Usage

You can start the ticker from the Chat interface using the MCP tool:

**Prompt:** "Start the live data ticker for RELIANCE and HDFCBANK"

**Tool Call:** `start-live-ticker`
- `subscribeSymbols`: "RELIANCE,HDFCBANK"

This will spawn a background process. Check the container logs for output.

## Database Schema

The `live_ticks` table is created automatically:
- `instrument_token`: Integer
- `exchange_timestamp`: Timestamp
- `last_price`: Numeric
- `oi`: Numeric
- `volume`: Numeric
- `raw`: JSONB (full tick data)
