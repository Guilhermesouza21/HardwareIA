import os
import time
import logging
from collections import defaultdict
from typing import List, Dict
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Depends, HTTPException, Header, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from groq import AsyncGroq
from dotenv import load_dotenv

from database import (
    init_db,
    get_or_create_active_conversation,
    save_message,
    get_messages,
    get_user_message_count,
    get_connection,
    release_connection
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
USER_MESSAGE_LIMIT = int(os.getenv("USER_MESSAGE_LIMIT", 50))

groq_client = None
if GROQ_API_KEY:
    groq_client = AsyncGroq(api_key=GROQ_API_KEY)
else:
    logger.warning("GROQ_API_KEY is missing! Groq calls will fail.")

user_request_timestamps: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 10

@asynccontextmanager
async def lifespan(app: FastAPI):
    db_ok = init_db()
    if not db_ok:
        logger.error("Failed to connect to the database on startup. Please verify DATABASE_URL.")
    yield

app = FastAPI(
    title="HardwareIA API",
    description="Backend para streaming de IA e persistência no Supabase PostgreSQL",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header de Autorização ausente ou inválido. Deve ser 'Bearer <token>'."
        )
    
    token = authorization.split(" ")[1]
    
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Configuração do Supabase ausente no servidor."
        )
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": SUPABASE_ANON_KEY
                },
                timeout=10.0
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Sessão expirada ou token inválido."
                )
            return response.json()
        except httpx.RequestError as e:
            logger.error(f"Erro ao conectar ao Supabase Auth: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível validar a sessão no momento."
            )

def enforce_rate_limit(user_id: str):
    now = time.time()
    timestamps = user_request_timestamps[user_id]
    active_timestamps = [ts for ts in timestamps if now - ts < RATE_LIMIT_WINDOW_SECONDS]
    user_request_timestamps[user_id] = active_timestamps
    if len(active_timestamps) >= RATE_LIMIT_MAX_REQUESTS:
        logger.warning(f"User {user_id} exceeded rate limit.")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas requisições. Limite de 10 mensagens por minuto excedido."
        )
    user_request_timestamps[user_id].append(now)

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_stream(
    request: Request,
    payload: ChatRequest,
    current_user: dict = Depends(get_current_user)
):
    if not groq_client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Cliente Groq não configurado no backend."
        )

    user_id = current_user["id"]
    user_message = payload.message.strip()

    if not user_message:
        raise HTTPException(status_code=400, detail="A mensagem não pode estar vazia.")

    enforce_rate_limit(user_id)

    msg_count = get_user_message_count(user_id)
    if msg_count >= USER_MESSAGE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Limite de mensagens excedido. Você atingiu o limite máximo de {USER_MESSAGE_LIMIT} mensagens."
        )

    conversation_id = get_or_create_active_conversation(user_id)
    save_message(user_id, conversation_id, "user", user_message)
    history_messages = get_messages(user_id, conversation_id)

    groq_messages = [
        {
            "role": "system",
            "content": (
                "Você é o HardwareIA, um assistente virtual inteligente especialista em "
                "Hardware de computadores, montagem de PCs, compatibilidade de peças e arquitetura de computadores. "
                "Responda em português, com clareza, formatação amigável (markdown com listas, tabelas e negrito se necessário) "
                "e precisão técnica. Auxilie o usuário em suas dúvidas sobre componentes."
            )
        }
    ]

    for msg in history_messages[-20:]:
        groq_messages.append({"role": msg["role"], "content": msg["content"]})

    async def event_generator():
        accumulated_content = ""
        try:
            response_stream = await groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=groq_messages,
                stream=True
            )
            async for chunk in response_stream:
                if await request.is_disconnected():
                    logger.info("Client disconnected, terminating generation stream.")
                    break
                text_chunk = chunk.choices[0].delta.content or ""
                if text_chunk:
                    accumulated_content += text_chunk
                    yield text_chunk
        except Exception as e:
            logger.error(f"Error streaming from Groq: {e}")
            yield f"\n[Erro na geração da resposta: {str(e)}]"
        finally:
            if accumulated_content.strip():
                try:
                    save_message(user_id, conversation_id, "assistant", accumulated_content)
                except Exception as e:
                    logger.error(f"Error saving assistant message: {e}")

    return StreamingResponse(event_generator(), media_type="text/plain")

@app.get("/api/history")
async def chat_history(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    conversation_id = get_or_create_active_conversation(user_id)
    messages = get_messages(user_id, conversation_id)
    return {"messages": messages}

@app.get("/api/limit-status")
async def limit_status(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    count = get_user_message_count(user_id)
    return {
        "count": count,
        "limit": USER_MESSAGE_LIMIT,
        "remaining": max(0, USER_MESSAGE_LIMIT - count)
    }

@app.post("/api/chat/clear")
async def clear_chat(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO conversations (user_id, title) VALUES (%s, %s) RETURNING id",
                (user_id, "Assistente de Hardware")
            )
            new_id = cursor.fetchone()[0]
            conn.commit()
            return {"status": "success", "conversation_id": str(new_id)}
    except Exception as e:
        logger.error(f"Error clearing chat for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Não foi possível iniciar uma nova conversa.")
    finally:
        release_connection(conn)