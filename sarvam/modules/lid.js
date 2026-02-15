require('dotenv').config();

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

/**
 * Sends text to Sarvam LID API and returns the language and script codes.
 * @param {string} text - The input text
 * @returns {Promise<{language_code: string, script_code: string}>}
 */
async function identifyLanguage(text) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not found in environment variables.');
  }

  const response = await fetch('https://api.sarvam.ai/text-lid', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `LID API request failed with status ${response.status}: ${errText}`
    );
  }

  return response.json();
}

module.exports = { identifyLanguage };
