const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  user: process.env.POSTGRES_USER || "librechat",
  password: process.env.POSTGRES_PASSWORD || "librechat",
  database: process.env.POSTGRES_DB || "librechat",
});

async function check() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT * FROM instruments WHERE tradingsymbol LIKE 'NIFTY%' LIMIT 20");
    console.log("NIFTY symbols found:", res.rows.map(r => ({ token: r.instrument_token, symbol: r.tradingsymbol, exchange: r.exchange })));
    
    const res2 = await client.query("SELECT * FROM instruments WHERE name LIKE 'NIFTY%' LIMIT 20");
    console.log("NIFTY names found:", res2.rows.map(r => ({ token: r.instrument_token, symbol: r.tradingsymbol, name: r.name })));

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

check();
