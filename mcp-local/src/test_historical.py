import os
import psycopg2
import json

def get_connection():
    try:
        conn = psycopg2.connect(
            dbname=os.getenv("POSTGRES_DB", "postgres"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "password"),
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432")
        )
        return conn
    except Exception as e:
        print(f"Error connecting: {e}")
        return None

def test_instruments():
    conn = get_connection()
    if not conn: return

    cur = conn.cursor()
    try:
        print("\n--- Instruments Table Sample ---")
        cur.execute("SELECT instrument_token, tradingsymbol, exchange FROM instruments LIMIT 5")
        rows = cur.fetchall()
        for row in rows:
            print(row)
            
        print("\n--- Live Ticks Table Sample ---")
        cur.execute("SELECT instrument_token, last_price, exchange_timestamp FROM live_ticks LIMIT 5")
        rows = cur.fetchall() 
        for row in rows:
            print(row)

    except Exception as e:
        print(f"Error executing query: {e}")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    test_instruments()
