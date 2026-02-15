require('dotenv').config();

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const TRANSLATE_CHAR_LIMIT = 2000;

/**
 * Split text into chunks respecting word boundaries.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string[]}
 */
function chunkText(text, maxLength = TRANSLATE_CHAR_LIMIT) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim());
  }

  return chunks;
}

/**
 * Call the Sarvam translate API for a single text chunk.
 * @param {string} text
 * @param {string} sourceLanguageCode
 * @param {string} targetLanguageCode
 * @returns {Promise<string>}
 */
async function callTranslateApi(text, sourceLanguageCode, targetLanguageCode) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not found in environment variables.');
  }

  const response = await fetch('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
      mode: 'formal',
      model: 'sarvam-translate:v1',
      enable_preprocessing: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Translate API failed (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  return data.translated_text || '';
}

/**
 * Translate text from an Indian language to English.
 * If the source is already English, returns the text as-is.
 * @param {string} text
 * @param {string} sourceLanguageCode
 * @returns {Promise<string>}
 */
async function translateToEnglish(text, sourceLanguageCode) {
  if (sourceLanguageCode === 'en-IN') {
    return text;
  }

  const chunks = chunkText(text);
  const translatedChunks = [];
  for (const chunk of chunks) {
    const translated = await callTranslateApi(chunk, sourceLanguageCode, 'en-IN');
    translatedChunks.push(translated);
  }
  return translatedChunks.join(' ');
}

/**
 * Translate text from English to an Indian language.
 * If the target is English, returns the text as-is.
 * @param {string} text
 * @param {string} targetLanguageCode
 * @returns {Promise<string>}
 */
async function translateFromEnglish(text, targetLanguageCode) {
  if (targetLanguageCode === 'en-IN') {
    return text;
  }

  const chunks = chunkText(text);
  const translatedChunks = [];
  for (const chunk of chunks) {
    const translated = await callTranslateApi(chunk, 'en-IN', targetLanguageCode);
    translatedChunks.push(translated);
  }
  return translatedChunks.join(' ');
}

module.exports = { translateToEnglish, translateFromEnglish };
