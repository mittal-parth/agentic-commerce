import requests
import os
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
SARVAM_BEARER = f"Bearer {SARVAM_API_KEY}"

SYSTEM_PROMPT = """You are a helpful, friendly, and knowledgeable AI assistant.
You always respond in English. Keep your responses concise, clear, and informative.
Your responses will be translated to the user's language and then converted to speech,
so use simple sentences and avoid special characters, markdown formatting,
or emojis. Write numbers as words when possible (for example, "fifteen hundred"
instead of "1500"). Avoid bullet points and numbered lists; use flowing prose instead."""


def get_chat_completion(user_text):
    """
    Sends user text (in English) to Sarvam Chat Completion API
    and returns the assistant's response.
    """
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY not found in environment variables.")

    headers = {
        'Authorization': SARVAM_BEARER,
        'Content-Type': 'application/json'
    }
    payload = {
        'model': 'sarvam-m',
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': user_text}
        ],
        'stream': False
    }

    response = requests.post(
        'https://api.sarvam.ai/v1/chat/completions',
        json=payload,
        headers=headers
    )

    if not response.ok:
        raise Exception(
            f"Chat API request failed with status {response.status_code}: {response.text}"
        )

    return response.json()['choices'][0]['message']['content']
