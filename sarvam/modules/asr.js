const FormData = require('form-data');
require('dotenv').config();

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

/**
 * Sends audio data to Sarvam ASR API and returns the transcript.
 * Uses auto language detection (language_code='unknown').
 * @param {Buffer} audioBuffer - The audio file buffer
 * @returns {Promise<string>} The transcript text
 */
async function speechToText(audioBuffer) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not found in environment variables.');
  }

  const form = new FormData();
  form.append('file', audioBuffer, {
    filename: 'input.wav',
    contentType: 'audio/wav',
  });
  form.append('model', 'saarika:v2.5');
  form.append('language_code', 'unknown');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `ASR API request failed with status ${response.status}: ${text}`
    );
  }

  const data = await response.json();
  return data.transcript;
}

module.exports = { speechToText };
