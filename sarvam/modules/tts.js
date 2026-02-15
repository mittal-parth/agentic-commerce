require('dotenv').config();

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const TTS_CHARACTER_LIMIT = 2500; // As per Sarvam API documentation (bulbul:v3)
const MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT = 20;

/**
 * Cleans text by removing common markdown, multiple spaces, and emojis.
 * @param {string} textInput
 * @returns {string}
 */
function cleanTextForTts(textInput) {
  if (!textInput) return '';

  // Remove common markdown (asterisks for bold/italics, hashes for headers)
  let cleaned = textInput
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1') // ***bolditalic***
    .replace(/\*\*(.*?)\*\*/g, '$1')     // **bold**
    .replace(/\*(.*?)\*/g, '$1');         // *italic*

  // Remove # headers
  cleaned = cleaned.replace(/^#+\s*/gm, '');

  // Remove emojis (broad Unicode ranges)
  cleaned = cleaned.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
    ''
  );

  // Replace multiple spaces with a single space
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Remove code block markers
  cleaned = cleaned.replace(/```/g, '');

  console.log(
    `[modules/tts.js] cleanTextForTts: Original (len ${textInput.length}): '${textInput.slice(0, 100)}...', Cleaned (len ${cleaned.length}): '${cleaned.slice(0, 100)}...'`
  );
  return cleaned;
}

/**
 * Helper function to call Sarvam TTS API for a single text chunk.
 * @param {string} textChunk
 * @param {string} langCode
 * @param {string} speaker
 * @param {string} model
 * @returns {Promise<string>} base64 encoded audio
 */
async function callSarvamTts(textChunk, langCode, speaker = 'shubh', model = 'bulbul:v3') {
  console.log(
    `[modules/tts.js] callSarvamTts: Calling API for chunk (length: ${textChunk.length}): '${textChunk.slice(0, 100)}...'`
  );

  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not found for TTS call.');
  }

  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: textChunk,
      target_language_code: langCode,
      speaker,
      model,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Sarvam TTS API request failed for chunk with status ${response.status}: ${errText}`
    );
  }

  const data = await response.json();

  if (!data.audios || !data.audios[0]) {
    throw new Error(
      "Sarvam TTS API response OK, but no audio data found in 'audios' list."
    );
  }

  const base64Audio = data.audios[0];

  if (!base64Audio || base64Audio.length < 100) {
    throw new Error(
      `Sarvam TTS API returned what seems to be invalid or too short base64 audio data: ${base64Audio.slice(0, 100)}...`
    );
  }

  console.log(
    `[modules/tts.js] callSarvamTts: Successfully received audio for chunk. Base64 length: ${base64Audio.length}`
  );
  return base64Audio;
}

/**
 * Chunks text, trying to respect sentence/word boundaries.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string[]}
 */
function chunkTextBoundaryAware(text, maxLength) {
  const chunks = [];
  let currentPos = 0;
  const textLen = text.length;

  while (currentPos < textLen) {
    // If remaining text is within limit, it's the last chunk
    if (textLen - currentPos <= maxLength) {
      chunks.push(text.slice(currentPos));
      break;
    }

    const splitAt = currentPos + maxLength;
    let bestSplitPoint = splitAt;

    // Try to find sentence boundaries
    const sentenceDelimiters = ['. ', '! ', '? ', '\n'];
    let foundSentenceSplit = -1;

    for (const delim of sentenceDelimiters) {
      const lastOccurrence = text.lastIndexOf(delim, splitAt - 1);
      if (lastOccurrence >= currentPos) {
        const potentialSplit = lastOccurrence + delim.length;
        if (potentialSplit > foundSentenceSplit) {
          foundSentenceSplit = potentialSplit;
        }
      }
    }

    if (foundSentenceSplit > currentPos) {
      bestSplitPoint = foundSentenceSplit;
    } else {
      // Try word boundary (space)
      const lastSpace = text.lastIndexOf(' ', splitAt - 1);
      if (lastSpace > currentPos) {
        bestSplitPoint = lastSpace + 1;
      }
    }

    chunks.push(text.slice(currentPos, bestSplitPoint));
    currentPos = bestSplitPoint;
  }

  const finalChunks = chunks.map((c) => c.trim()).filter(Boolean);
  console.log(
    `[modules/tts.js] chunkTextBoundaryAware: Text (len ${textLen}) chunked into ${finalChunks.length} pieces.`
  );
  return finalChunks;
}

/**
 * Parse WAV header from a Buffer.
 * Returns { numChannels, sampleWidth, sampleRate, dataOffset, dataSize }
 */
function parseWavHeader(buf) {
  // RIFF header
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const sampleWidth = bitsPerSample / 8;

  // Find "data" subchunk
  let offset = 12; // skip RIFF header
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return {
        numChannels,
        sampleWidth,
        sampleRate,
        dataOffset: offset + 8,
        dataSize: chunkSize,
      };
    }
    offset += 8 + chunkSize;
  }

  throw new Error('Could not find data chunk in WAV file');
}

/**
 * Create a WAV file Buffer from raw PCM data.
 * @param {Buffer} pcmData
 * @param {number} numChannels
 * @param {number} sampleWidth - bytes per sample
 * @param {number} sampleRate
 * @returns {Buffer}
 */
function createWavBuffer(pcmData, numChannels, sampleWidth, sampleRate) {
  const byteRate = sampleRate * numChannels * sampleWidth;
  const blockAlign = numChannels * sampleWidth;
  const bitsPerSample = sampleWidth * 8;
  const dataSize = pcmData.length;
  const headerSize = 44;

  const header = Buffer.alloc(headerSize);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (PCM = 1)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * Decodes list of base64 WAV audio, concatenates them, and re-encodes to base64.
 * @param {string[]} base64AudioList
 * @returns {string|null}
 */
function concatenateWavFromBase64List(base64AudioList) {
  if (!base64AudioList || base64AudioList.length === 0) {
    console.log('[modules/tts.js] concatenateWavFromBase64List: No audio list provided.');
    return null;
  }

  if (base64AudioList.length === 1) {
    console.log('[modules/tts.js] concatenateWavFromBase64List: Only one chunk, no concatenation needed.');
    return base64AudioList[0];
  }

  console.log(
    `[modules/tts.js] concatenateWavFromBase64List: Concatenating ${base64AudioList.length} audio chunks.`
  );

  const allFrames = [];
  let wavParams = null;

  for (let i = 0; i < base64AudioList.length; i++) {
    try {
      const wavBuf = Buffer.from(base64AudioList[i], 'base64');
      const parsed = parseWavHeader(wavBuf);

      if (i === 0) {
        wavParams = parsed;
        console.log(
          `[modules/tts.js] concatenateWavFromBase64List: Audio params from first chunk: channels=${parsed.numChannels}, sampleWidth=${parsed.sampleWidth}, sampleRate=${parsed.sampleRate}`
        );
      } else if (
        wavParams.numChannels !== parsed.numChannels ||
        wavParams.sampleWidth !== parsed.sampleWidth ||
        wavParams.sampleRate !== parsed.sampleRate
      ) {
        throw new Error(
          'Mismatch in critical audio parameters (channels, sampleWidth, sampleRate) between chunks.'
        );
      }

      const pcmData = wavBuf.slice(parsed.dataOffset, parsed.dataOffset + parsed.dataSize);
      allFrames.push(pcmData);
    } catch (err) {
      console.log(
        `[modules/tts.js] concatenateWavFromBase64List: Error processing base64 chunk ${i}: ${err.message}`
      );
      throw err;
    }
  }

  if (allFrames.length === 0 || !wavParams) {
    console.log('[modules/tts.js] concatenateWavFromBase64List: No valid audio frames to concatenate.');
    return null;
  }

  const concatenatedPcm = Buffer.concat(allFrames);
  const wavBuffer = createWavBuffer(
    concatenatedPcm,
    wavParams.numChannels,
    wavParams.sampleWidth,
    wavParams.sampleRate
  );

  const finalBase64 = wavBuffer.toString('base64');
  console.log(
    `[modules/tts.js] concatenateWavFromBase64List: Concatenation successful. Final base64 length: ${finalBase64.length}`
  );
  return finalBase64;
}

/**
 * Converts text to speech. Handles chunking for texts longer than TTS_CHARACTER_LIMIT.
 * For texts <= TTS_CHARACTER_LIMIT but >= MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT,
 * it will be split into two.
 * Returns a single base64 encoded string of the full audio.
 * @param {string} text
 * @param {string} langCode
 * @param {string} speaker
 * @param {string} model
 * @returns {Promise<string>}
 */
async function textToSpeech(text, langCode, speaker = 'shubh', model = 'bulbul:v3') {
  console.log(
    `[modules/tts.js] textToSpeech called with raw text (length: ${text.length}): '${text.slice(0, 100)}...', langCode: ${langCode}, speaker: ${speaker}, model: ${model}`
  );

  // Clean the input text first
  const cleanedText = cleanTextForTts(text);
  let textChunks = [];

  if (!cleanedText || !cleanedText.trim()) {
    console.log('[modules/tts.js] textToSpeech: Empty or whitespace-only text after cleaning.');
    // Return placeholder for silent audio
    return 'UklGRkoAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQYAAAAAAQ==';
  }

  if (cleanedText.length > TTS_CHARACTER_LIMIT) {
    console.log(
      `[modules/tts.js] textToSpeech: Cleaned text exceeds limit (${cleanedText.length} > ${TTS_CHARACTER_LIMIT}). Using boundary-aware chunking.`
    );
    textChunks = chunkTextBoundaryAware(cleanedText, TTS_CHARACTER_LIMIT);
  } else if (cleanedText.length < MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT) {
    console.log(
      `[modules/tts.js] textToSpeech: Cleaned text is very short (len ${cleanedText.length} < ${MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT}). Treating as a single chunk.`
    );
    textChunks = [cleanedText.trim()];
  } else {
    console.log(
      `[modules/tts.js] textToSpeech: Cleaned text (len ${cleanedText.length}) will be forcibly split into two chunks.`
    );
    const stripped = cleanedText.trim();
    const midPoint = Math.floor(stripped.length / 2);

    const splitPosBackward = stripped.lastIndexOf(' ', midPoint);
    const splitPosForward = stripped.indexOf(' ', midPoint);

    let actualSplit = -1;

    if (splitPosBackward !== -1 && splitPosForward !== -1) {
      if (midPoint - splitPosBackward <= splitPosForward - midPoint) {
        actualSplit = splitPosBackward + 1;
      } else {
        actualSplit = splitPosForward + 1;
      }
    } else if (splitPosBackward !== -1) {
      actualSplit = splitPosBackward + 1;
    } else if (splitPosForward !== -1) {
      actualSplit = splitPosForward + 1;
    } else {
      actualSplit = midPoint;
    }

    const chunk1 = stripped.slice(0, actualSplit).trim();
    const chunk2 = stripped.slice(actualSplit).trim();

    textChunks = [];
    if (chunk1) textChunks.push(chunk1);
    if (chunk2) textChunks.push(chunk2);

    if (textChunks.length === 0) {
      textChunks = [stripped];
    }

    const previews = textChunks.map((c) =>
      c.length > 50 ? c.slice(0, 50) + '...' : c
    );
    console.log(
      `[modules/tts.js] textToSpeech: Forced split resulted in ${textChunks.length} chunks: ${JSON.stringify(previews)}`
    );
  }

  if (textChunks.length === 0) {
    throw new Error('Text resulted in no processable chunks unexpectedly.');
  }

  const base64AudioParts = [];
  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    if (!chunk) {
      console.log(`[modules/tts.js] textToSpeech: Skipping empty chunk ${i + 1}.`);
      continue;
    }
    console.log(`[modules/tts.js] textToSpeech: Processing chunk ${i + 1}/${textChunks.length}.`);
    try {
      const base64AudioChunk = await callSarvamTts(chunk, langCode, speaker, model);
      base64AudioParts.push(base64AudioChunk);
    } catch (err) {
      console.log(
        `[modules/tts.js] textToSpeech: CRITICAL - Error synthesizing audio for chunk ${i + 1} ('${chunk.slice(0, 50)}...'). Error: ${err.message}`
      );
      throw new Error(
        `Failed to synthesize complete audio due to error in chunk ${i + 1}. ${err.message}`
      );
    }
  }

  if (base64AudioParts.length === 0) {
    throw new Error('No audio parts were generated from text chunks.');
  }

  console.log(
    `[modules/tts.js] textToSpeech: All ${base64AudioParts.length} chunks processed. Concatenating audio.`
  );

  const finalAudioBase64 = concatenateWavFromBase64List(base64AudioParts);
  if (!finalAudioBase64) {
    throw new Error('Audio chunk concatenation resulted in no data.');
  }
  return finalAudioBase64;
}

module.exports = { textToSpeech };
