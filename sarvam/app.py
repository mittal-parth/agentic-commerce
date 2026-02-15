import os
from flask import Flask, request, jsonify, render_template, Response
from dotenv import load_dotenv
import uuid
import base64

from modules.asr import speech_to_text
from modules.lid import identify_language
from modules.translate import translate_to_english, translate_from_english
from modules.llm import get_chat_completion
from modules.tts import text_to_speech

load_dotenv()

app = Flask(__name__)

# Temporary in-memory store for audio data
temp_audio_store = {}

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_API_KEY:
    print("WARNING: SARVAM_API_KEY not found in .env file or environment variables.")
    print("Please create a .env file with SARVAM_API_KEY='your_key'")

# Language code to human-readable name mapping
LANGUAGE_NAMES = {
    'hi-IN': 'Hindi',
    'bn-IN': 'Bengali',
    'ta-IN': 'Tamil',
    'te-IN': 'Telugu',
    'mr-IN': 'Marathi',
    'gu-IN': 'Gujarati',
    'kn-IN': 'Kannada',
    'ml-IN': 'Malayalam',
    'pa-IN': 'Punjabi',
    'od-IN': 'Odia',
    'en-IN': 'English',
    'as-IN': 'Assamese',
    'ur-IN': 'Urdu',
    'ne-IN': 'Nepali',
    'sd-IN': 'Sindhi',
    'kok-IN': 'Konkani',
    'doi-IN': 'Dogri',
    'brx-IN': 'Bodo',
    'mai-IN': 'Maithili',
    'mni-IN': 'Manipuri',
    'sa-IN': 'Sanskrit',
    'sat-IN': 'Santali',
    'ks-IN': 'Kashmiri',
}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/process', methods=['POST'])
def process_audio():
    """
    Full pipeline: Audio -> ASR -> LID -> Translate to EN -> LLM -> Translate back -> TTS
    Returns all intermediate results for display in the chat UI.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['file']

    result = {
        'transcript': None,
        'language_code': None,
        'language_name': None,
        'script_code': None,
        'english_translation': None,
        'llm_response': None,
        'translated_response': None,
        'audio_id': None,
    }

    try:
        # Step 1: ASR — transcribe audio to text
        print("[app.py] Step 1: ASR")
        transcript = speech_to_text(audio_file.read())
        if not transcript:
            return jsonify({'error': 'Could not transcribe audio. Please try again.'}), 400
        result['transcript'] = transcript
        print(f"[app.py] ASR result: '{transcript}'")

        # Step 2: LID — detect language
        print("[app.py] Step 2: LID")
        try:
            lid_result = identify_language(transcript)
            lang_code = lid_result.get('language_code', 'hi-IN')
            script_code = lid_result.get('script_code', 'Deva')
        except Exception as e:
            print(f"[app.py] LID failed, defaulting to Hindi: {e}")
            lang_code = 'hi-IN'
            script_code = 'Deva'
        result['language_code'] = lang_code
        result['script_code'] = script_code
        result['language_name'] = LANGUAGE_NAMES.get(lang_code, lang_code)
        print(f"[app.py] LID result: {lang_code} ({result['language_name']})")

        # Step 3: Translate to English
        print("[app.py] Step 3: Translate to English")
        try:
            english_text = translate_to_english(transcript, lang_code)
        except Exception as e:
            print(f"[app.py] Translation to English failed, using original text: {e}")
            english_text = transcript
        result['english_translation'] = english_text
        print(f"[app.py] English translation: '{english_text}'")

        # Step 4: LLM (in English)
        print("[app.py] Step 4: LLM")
        llm_response = get_chat_completion(english_text)
        result['llm_response'] = llm_response
        print(f"[app.py] LLM response: '{llm_response[:100]}...'")

        # Step 5: Translate back to detected language
        print(f"[app.py] Step 5: Translate back to {lang_code}")
        try:
            translated_response = translate_from_english(llm_response, lang_code)
        except Exception as e:
            print(f"[app.py] Translation back failed, using English response: {e}")
            translated_response = llm_response
        result['translated_response'] = translated_response
        print(f"[app.py] Translated response: '{translated_response[:100]}...'")

        # Step 6: TTS
        print("[app.py] Step 6: TTS")
        audio_base64 = text_to_speech(translated_response, lang_code)
        if audio_base64:
            audio_id = str(uuid.uuid4())
            temp_audio_store[audio_id] = f"data:audio/wav;base64,{audio_base64}"
            result['audio_id'] = audio_id
            # Cleanup if store grows too large
            if len(temp_audio_store) > 100:
                oldest_key = next(iter(temp_audio_store))
                del temp_audio_store[oldest_key]
            print(f"[app.py] TTS complete, audio_id: {audio_id}")

        return jsonify(result)

    except Exception as e:
        print(f"[app.py] Pipeline error: {e}")
        result['error'] = str(e)
        return jsonify(result), 500


@app.route('/get_audio/<audio_id>', methods=['GET'])
def get_audio_route(audio_id):
    """Serve stored audio by ID as a WAV binary response."""
    audio_data_uri = temp_audio_store.pop(audio_id, None)

    if audio_data_uri:
        try:
            header, base64_data = audio_data_uri.split(',', 1)
            audio_bytes = base64.b64decode(base64_data)
            mimetype = header.split(':')[1].split(';')[0]
            return Response(audio_bytes, mimetype=mimetype)
        except Exception as e:
            print(f"[app.py] Error processing audio {audio_id}: {e}")
            return jsonify({'error': 'Error processing stored audio data'}), 500
    else:
        return jsonify({'error': 'Audio not found or already retrieved'}), 404


if __name__ == '__main__':
    app.run(debug=True, port=5002)
