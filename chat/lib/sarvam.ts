/**
 * Sarvam AI API wrappers for ASR, LID, translation, and TTS.
 * Uses process.env.SARVAM_API_KEY (set in chat/.env).
 */

const SARVAM_BASE = "https://api.sarvam.ai";
const TRANSLATE_CHAR_LIMIT = 2000;
const TTS_CHARACTER_LIMIT = 2500;
const MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT = 20;

function getApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error("SARVAM_API_KEY not found in environment variables.");
  }
  return key;
}

// --- ASR ---

/**
 * Sends audio buffer to Sarvam ASR API and returns the transcript.
 * Uses auto language detection (language_code='unknown').
 */
export async function speechToText(audioBuffer: Buffer): Promise<string> {
  getApiKey();
  const form = new FormData();
  form.append(
    "file",
    new Blob([audioBuffer], { type: "audio/wav" }),
    "input.wav"
  );
  form.append("model", "saarika:v2.5");
  form.append("language_code", "unknown");

  const response = await fetch(`${SARVAM_BASE}/speech-to-text`, {
    method: "POST",
    headers: {
      "api-subscription-key": getApiKey(),
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ASR API request failed with status ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { transcript?: string };
  return data.transcript ?? "";
}

// --- LID ---

export interface LidResult {
  language_code: string;
  script_code: string;
}

/**
 * Identifies language and script of the input text.
 */
export async function identifyLanguage(text: string): Promise<LidResult> {
  const response = await fetch(`${SARVAM_BASE}/text-lid`, {
    method: "POST",
    headers: {
      "api-subscription-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LID API request failed with status ${response.status}: ${errText}`);
  }

  return response.json() as Promise<LidResult>;
}

// --- Translation ---

function chunkText(text: string, maxLength: number = TRANSLATE_CHAR_LIMIT): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(" ", maxLength);
    if (splitIndex === -1) splitIndex = maxLength;
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim());
  }
  return chunks;
}

async function callTranslateApi(
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string
): Promise<string> {
  const response = await fetch(`${SARVAM_BASE}/translate`, {
    method: "POST",
    headers: {
      "api-subscription-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
      mode: "formal",
      model: "sarvam-translate:v1",
      enable_preprocessing: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Translate API failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { translated_text?: string };
  return data.translated_text ?? "";
}

/**
 * Translate text from an Indian language to English.
 * If source is already English, returns text as-is.
 */
export async function translateToEnglish(
  text: string,
  sourceLanguageCode: string
): Promise<string> {
  if (sourceLanguageCode === "en-IN") return text;
  const chunks = chunkText(text);
  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    const translated = await callTranslateApi(chunk, sourceLanguageCode, "en-IN");
    translatedChunks.push(translated);
  }
  return translatedChunks.join(" ");
}

/**
 * Translate text from English to an Indian language.
 * If target is English, returns text as-is.
 */
export async function translateFromEnglish(
  text: string,
  targetLanguageCode: string
): Promise<string> {
  if (targetLanguageCode === "en-IN") return text;
  const chunks = chunkText(text);
  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    const translated = await callTranslateApi(chunk, "en-IN", targetLanguageCode);
    translatedChunks.push(translated);
  }
  return translatedChunks.join(" ");
}

// --- TTS ---

function cleanTextForTts(textInput: string): string {
  if (!textInput) return "";
  let cleaned = textInput
    .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1");
  cleaned = cleaned.replace(/^#+\s*/gm, "");
  cleaned = cleaned.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
    ""
  );
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/```/g, "");
  return cleaned;
}

async function callSarvamTts(
  textChunk: string,
  langCode: string,
  speaker: string = "shubh",
  model: string = "bulbul:v3"
): Promise<string> {
  const response = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "api-subscription-key": getApiKey(),
      "Content-Type": "application/json",
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
    throw new Error(`Sarvam TTS API request failed: ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as { audios?: string[] };
  if (!data.audios?.[0]) {
    throw new Error("Sarvam TTS API response OK, but no audio data in 'audios' list.");
  }
  const base64Audio = data.audios[0];
  if (!base64Audio || base64Audio.length < 100) {
    throw new Error("Sarvam TTS API returned invalid or too short base64 audio.");
  }
  return base64Audio;
}

function chunkTextBoundaryAware(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentPos = 0;
  const textLen = text.length;

  while (currentPos < textLen) {
    if (textLen - currentPos <= maxLength) {
      chunks.push(text.slice(currentPos));
      break;
    }
    const splitAt = currentPos + maxLength;
    let bestSplitPoint = splitAt;
    const sentenceDelimiters = [". ", "! ", "? ", "\n"];
    let foundSentenceSplit = -1;
    for (const delim of sentenceDelimiters) {
      const lastOccurrence = text.lastIndexOf(delim, splitAt - 1);
      if (lastOccurrence >= currentPos) {
        const potentialSplit = lastOccurrence + delim.length;
        if (potentialSplit > foundSentenceSplit) foundSentenceSplit = potentialSplit;
      }
    }
    if (foundSentenceSplit > currentPos) {
      bestSplitPoint = foundSentenceSplit;
    } else {
      const lastSpace = text.lastIndexOf(" ", splitAt - 1);
      if (lastSpace > currentPos) bestSplitPoint = lastSpace + 1;
    }
    chunks.push(text.slice(currentPos, bestSplitPoint));
    currentPos = bestSplitPoint;
  }
  return chunks.map((c) => c.trim()).filter(Boolean);
}

function parseWavHeader(buf: Buffer): {
  numChannels: number;
  sampleWidth: number;
  sampleRate: number;
  dataOffset: number;
  dataSize: number;
} {
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const sampleWidth = bitsPerSample / 8;
  let offset = 12;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      return { numChannels, sampleWidth, sampleRate, dataOffset: offset + 8, dataSize: chunkSize };
    }
    offset += 8 + chunkSize;
  }
  throw new Error("Could not find data chunk in WAV file");
}

function createWavBuffer(
  pcmData: Buffer,
  numChannels: number,
  sampleWidth: number,
  sampleRate: number
): Buffer {
  const byteRate = sampleRate * numChannels * sampleWidth;
  const blockAlign = numChannels * sampleWidth;
  const bitsPerSample = sampleWidth * 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const header = Buffer.alloc(headerSize);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

function concatenateWavFromBase64List(base64AudioList: string[]): string | null {
  if (!base64AudioList?.length) return null;
  if (base64AudioList.length === 1) return base64AudioList[0];

  const allFrames: Buffer[] = [];
  let wavParams: ReturnType<typeof parseWavHeader> | null = null;

  for (let i = 0; i < base64AudioList.length; i++) {
    const wavBuf = Buffer.from(base64AudioList[i], "base64");
    const parsed = parseWavHeader(wavBuf);
    if (i === 0) {
      wavParams = parsed;
    } else if (
      !wavParams ||
      wavParams.numChannels !== parsed.numChannels ||
      wavParams.sampleWidth !== parsed.sampleWidth ||
      wavParams.sampleRate !== parsed.sampleRate
    ) {
      throw new Error("Mismatch in audio parameters between TTS chunks.");
    }
    const pcmData = wavBuf.subarray(parsed.dataOffset, parsed.dataOffset + parsed.dataSize);
    allFrames.push(pcmData);
  }

  if (allFrames.length === 0 || !wavParams) return null;
  const concatenatedPcm = Buffer.concat(allFrames);
  const wavBuffer = createWavBuffer(
    concatenatedPcm,
    wavParams.numChannels,
    wavParams.sampleWidth,
    wavParams.sampleRate
  );
  return wavBuffer.toString("base64");
}

/**
 * Converts text to speech. Handles chunking and returns single base64 WAV.
 */
export async function textToSpeech(
  text: string,
  langCode: string,
  speaker: string = "shubh",
  model: string = "bulbul:v3"
): Promise<string> {
  const cleanedText = cleanTextForTts(text);
  let textChunks: string[] = [];

  if (!cleanedText?.trim()) {
    return "UklGRkoAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQYAAAAAAQ==";
  }

  if (cleanedText.length > TTS_CHARACTER_LIMIT) {
    textChunks = chunkTextBoundaryAware(cleanedText, TTS_CHARACTER_LIMIT);
  } else if (cleanedText.length < MIN_TEXT_LENGTH_FOR_FORCED_TWO_WAY_SPLIT) {
    textChunks = [cleanedText.trim()];
  } else {
    const stripped = cleanedText.trim();
    const midPoint = Math.floor(stripped.length / 2);
    const splitPosBackward = stripped.lastIndexOf(" ", midPoint);
    const splitPosForward = stripped.indexOf(" ", midPoint);
    let actualSplit: number;
    if (splitPosBackward !== -1 && splitPosForward !== -1) {
      actualSplit =
        midPoint - splitPosBackward <= splitPosForward - midPoint
          ? splitPosBackward + 1
          : splitPosForward + 1;
    } else if (splitPosBackward !== -1) {
      actualSplit = splitPosBackward + 1;
    } else if (splitPosForward !== -1) {
      actualSplit = splitPosForward + 1;
    } else {
      actualSplit = midPoint;
    }
    const chunk1 = stripped.slice(0, actualSplit).trim();
    const chunk2 = stripped.slice(actualSplit).trim();
    textChunks = [chunk1, chunk2].filter(Boolean);
    if (textChunks.length === 0) textChunks = [stripped];
  }

  if (textChunks.length === 0) {
    throw new Error("Text resulted in no processable chunks.");
  }

  const base64AudioParts: string[] = [];
  for (const chunk of textChunks) {
    if (!chunk) continue;
    const base64AudioChunk = await callSarvamTts(chunk, langCode, speaker, model);
    base64AudioParts.push(base64AudioChunk);
  }

  if (base64AudioParts.length === 0) {
    throw new Error("No audio parts were generated from text chunks.");
  }

  const finalAudioBase64 = concatenateWavFromBase64List(base64AudioParts);
  if (!finalAudioBase64) {
    throw new Error("Audio chunk concatenation resulted in no data.");
  }
  return finalAudioBase64;
}
