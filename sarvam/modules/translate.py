import requests
import os
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
TRANSLATE_CHAR_LIMIT = 2000


def _chunk_text(text, max_length=TRANSLATE_CHAR_LIMIT):
    """Split text into chunks respecting word boundaries."""
    chunks = []
    while len(text) > max_length:
        split_index = text.rfind(" ", 0, max_length)
        if split_index == -1:
            split_index = max_length
        chunks.append(text[:split_index].strip())
        text = text[split_index:].lstrip()
    if text.strip():
        chunks.append(text.strip())
    return chunks


def _call_translate_api(text, source_language_code, target_language_code):
    """Call the Sarvam translate API for a single text chunk."""
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY not found in environment variables.")

    headers = {
        'api-subscription-key': SARVAM_API_KEY,
        'Content-Type': 'application/json'
    }
    payload = {
        'input': text,
        'source_language_code': source_language_code,
        'target_language_code': target_language_code,
        'mode': 'formal',
        'model': 'sarvam-translate:v1',
        'enable_preprocessing': True
    }

    response = requests.post(
        'https://api.sarvam.ai/translate',
        json=payload,
        headers=headers
    )

    if not response.ok:
        raise Exception(
            f"Translate API failed ({response.status_code}): {response.text}"
        )

    return response.json().get('translated_text', '')


def translate_to_english(text, source_language_code):
    """
    Translate text from an Indian language to English.
    If the source is already English, returns the text as-is.
    """
    if source_language_code == 'en-IN':
        return text

    chunks = _chunk_text(text)
    translated_chunks = []
    for chunk in chunks:
        translated = _call_translate_api(chunk, source_language_code, 'en-IN')
        translated_chunks.append(translated)
    return ' '.join(translated_chunks)


def translate_from_english(text, target_language_code):
    """
    Translate text from English to an Indian language.
    If the target is English, returns the text as-is.
    """
    if target_language_code == 'en-IN':
        return text

    chunks = _chunk_text(text)
    translated_chunks = []
    for chunk in chunks:
        translated = _call_translate_api(chunk, 'en-IN', target_language_code)
        translated_chunks.append(translated)
    return ' '.join(translated_chunks)
