
const KiteConnect = require("kiteconnect").KiteConnect;
const fs = require("fs");

async function run() {
    const api_key = process.env.ZERODHA_API_KEY;
    const access_token = fs.readFileSync("/app/mcp-local/kite_access_token.txt", "utf8").trim();

    console.log("Using API Key:", api_key);
    console.log("Using Access Token:", access_token.substring(0, 10) + "...");

    const kite = new KiteConnect({ api_key });
    kite.setAccessToken(access_token);

    try {
        console.log("Fetching instruments...");
        const instruments = await kite.getInstruments(["NSE"]);
        console.log("Success! Fetched", instruments.length);
        
        if (instruments.length > 0) {
            const first = instruments[0];
            console.log(`Testing historical data for ${first.tradingsymbol} (${first.instrument_token})...`);
            
            const toDate = new Date();
            const fromDate = new Date();
            fromDate.setDate(toDate.getDate() - 5); // 5 days ago
            
            const history = await kite.getHistoricalData(first.instrument_token, "day", fromDate, toDate);
            console.log("Historical Data Records:", history.length);
            if (history.length > 0) {
                console.log("Sample:", history[0]);
            }
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
