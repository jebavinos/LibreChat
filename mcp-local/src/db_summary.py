import os
import sys
import json
from langchain_community.utilities import SQLDatabase
from sqlalchemy import create_engine

def summarize_table(table_name=None):
    try:
        # Construct connection string from environment variables
        user = os.getenv("POSTGRES_USER", "postgres")
        password = os.getenv("POSTGRES_PASSWORD", "password")
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        db_name = os.getenv("POSTGRES_DB", "postgres")

        # Create connection string
        # using psycopg2 driver
        db_uri = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}"

        db = SQLDatabase.from_uri(db_uri)

        if table_name:
            # Get info for specific table
            table_info = db.get_table_info(table_names=[table_name])
            return json.dumps({"description": table_info})
        else:
            # Get info for all tables
            table_info = db.get_table_info()
            return json.dumps({"description": table_info})

    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    if len(sys.argv) > 1:
        table_name = sys.argv[1]
    else:
        table_name = None
    
    print(summarize_table(table_name))
