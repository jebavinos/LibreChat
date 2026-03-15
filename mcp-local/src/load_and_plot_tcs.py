import os
import pandas as pd
import numpy as np
import plotly.express as px
from sqlalchemy import create_engine

# 1. Setup Database Connection
user = 'myuser'
password = 'mypassword'
host = 'vectordb'
port = '5432'
db_name = 'mydatabase'
db_uri = f'postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}'
engine = create_engine(db_uri)

# 2. Load CSV Data
csv_path = '/app/data/tcs_daily.csv'
print(f"Loading data from {csv_path}...")
df = pd.read_csv(csv_path)

# 3. Clean and Prepare Data
# Remove the extra timezone text which confuses pandas
# "Fri Feb 20 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" -> "Fri Feb 20 2026 00:00:00"
df['date'] = df['date'].astype(str).str.split(' GMT').str[0]
df['date'] = pd.to_datetime(df['date'], format='%a %b %d %Y %H:%M:%S')

# Remove timezone info (already naive after format parse, but just in case)
# df['date'] = df['date'].dt.tz_localize(None) 

# 4. Load Data TO Postgres
table_name = 'tcs_daily'
print(f"Uploading data to PostgreSQL table '{table_name}'...")
df.to_sql(table_name, engine, if_exists='replace', index=False)
print("Data uploaded successfully.")

# 5. Query Data FROM Postgres
print(f"Querying data back from PostgreSQL table '{table_name}'...")
query = f"SELECT * FROM {table_name} ORDER BY date ASC"
df_db = pd.read_sql(query, engine)
df_db['date'] = pd.to_datetime(df_db['date'])

# 6. Technical Analysis
df_db['SMA_5'] = df_db['close'].rolling(window=5).mean()
df_db['SMA_10'] = df_db['close'].rolling(window=10).mean()

# 7. Visualization
print("Generating plot...")
# Melt for Plotly Express
df_plot = df_db.melt(id_vars=['date'], value_vars=['close', 'SMA_5', 'SMA_10'], var_name='Indicator', value_name='Price')

# Create Plot
fig = px.line(df_plot, x='date', y='Price', color='Indicator', 
              title='TCS Daily Price & Technicals (SMA)',
              template='plotly_white')

# 8. Save Plot as PNG
output_path = '/app/tcs_technicals.png'
print(f"Saving plot to {output_path} with kaleido...")
fig.write_image(output_path)
print("Plot saved successfully.")

