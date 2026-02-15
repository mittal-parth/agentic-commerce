/**
 * Sarvam AI API helpers.
 * Use your own LLM (e.g. via Vercel SDK); these are for ASR, LID, translation, and TTS only.
 */

const { speechToText } = require('./modules/asr');
const { identifyLanguage } = require('./modules/lid');
const {
  translateToEnglish,
  translateFromEnglish,
} = require('./modules/translate');
const { textToSpeech } = require('./modules/tts');

module.exports = {
  speechToText,
  identifyLanguage,
  translateToEnglish,
  translateFromEnglish,
  textToSpeech,
};
