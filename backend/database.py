# my-macro-app/backend/database.py

import os
from dotenv import load_dotenv
from supabase.client import create_client, Client

load_dotenv()

# Set these in your environment variables or a .env file
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "your-supabase-key")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)