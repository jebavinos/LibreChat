const pg = require('pg');
const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'postgres'
});
pool.query("SELECT tradingsymbol, name, exchange FROM instruments WHERE tradingsymbol LIKE '%NIFTY%' LIMIT 20;").then(r => console.log(r.rows)).catch(console.error).finally(()=>pool.end());
