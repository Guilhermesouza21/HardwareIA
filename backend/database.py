import os
import logging
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global connection pool
db_pool = None

def init_db():
    global db_pool
    if not DATABASE_URL:
        logger.error("DATABASE_URL not found in environment variables!")
        return False
        
    try:
        # Create a connection pool (min 1, max 10 connections)
        db_pool = pool.SimpleConnectionPool(1, 10, dsn=DATABASE_URL)
        logger.info("Database connection pool initialized successfully.")
        
        # Verify connection and create tables if not exists
        conn = db_pool.getconn()
        try:
            with conn.cursor() as cursor:
                # Create conversations table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS conversations (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id UUID NOT NULL,
                        title VARCHAR(255) NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                # Create messages table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS messages (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL,
                        role VARCHAR(10) NOT NULL,
                        content TEXT NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                # Create indexes for performance
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);")
                
                conn.commit()
                logger.info("Database tables initialized successfully.")
        finally:
            db_pool.putconn(conn)
        return True
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
        return False

def get_connection():
    if not db_pool:
        raise Exception("Database connection pool not initialized. Call init_db() first.")
    return db_pool.getconn()

def release_connection(conn):
    if db_pool and conn:
        db_pool.putconn(conn)

def get_or_create_active_conversation(user_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Get latest conversation for user
            cursor.execute(
                "SELECT id FROM conversations WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
                (user_id,)
            )
            row = cursor.fetchone()
            if row:
                return str(row[0])
            
            # Create a new conversation if none exists
            cursor.execute(
                "INSERT INTO conversations (user_id, title) VALUES (%s, %s) RETURNING id",
                (user_id, "Assistente de Hardware")
            )
            new_id = cursor.fetchone()[0]
            conn.commit()
            return str(new_id)
    except Exception as e:
        logger.error(f"Error getting/creating conversation for user {user_id}: {e}")
        raise e
    finally:
        release_connection(conn)

def save_message(user_id, conversation_id, role, content):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO messages (user_id, conversation_id, role, content) VALUES (%s, %s, %s, %s) RETURNING id",
                (user_id, conversation_id, role, content)
            )
            msg_id = cursor.fetchone()[0]
            conn.commit()
            return str(msg_id)
    except Exception as e:
        logger.error(f"Error saving message for user {user_id}: {e}")
        raise e
    finally:
        release_connection(conn)

def get_messages(user_id, conversation_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT role, content, created_at FROM messages WHERE user_id = %s AND conversation_id = %s ORDER BY created_at ASC",
                (user_id, conversation_id)
            )
            rows = cursor.fetchall()
            return [{"role": r[0], "content": r[1], "created_at": r[2].isoformat()} for r in rows]
    except Exception as e:
        logger.error(f"Error fetching messages for conversation {conversation_id}: {e}")
        raise e
    finally:
        release_connection(conn)

def get_user_message_count(user_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Only count messages sent by the user (role = 'user')
            cursor.execute(
                "SELECT COUNT(*) FROM messages WHERE user_id = %s AND role = 'user'",
                (user_id,)
            )
            count = cursor.fetchone()[0]
            return count
    except Exception as e:
        logger.error(f"Error counting messages for user {user_id}: {e}")
        raise e
    finally:
        release_connection(conn)
