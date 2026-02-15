import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";
import {
  identifyLanguage,
  speechToText,
  textToSpeech,
  translateFromEnglish,
  translateToEnglish,
} from "@/lib/sarvam";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const action = formData.get("action")?.toString();
      if (action !== "process-voice") {
        return Response.json(
          { error: "Invalid action for FormData; use action: process-voice" },
          { status: 400 }
        );
      }
      const audioFile = formData.get("audio");
      if (!audioFile || !(audioFile instanceof File)) {
        return Response.json(
          { error: "Missing or invalid 'audio' file in FormData" },
          { status: 400 }
        );
      }
      const arrayBuffer = await audioFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const transcript = await speechToText(buffer);
      if (!transcript?.trim()) {
        return Response.json(
          { transcript: "", englishText: "", languageCode: "en-IN" },
          { status: 200 }
        );
      }
      const { language_code: languageCode } = await identifyLanguage(transcript);
      const englishText =
        languageCode === "en-IN"
          ? transcript
          : await translateToEnglish(transcript, languageCode);
      return Response.json({
        transcript,
        englishText,
        languageCode,
      });
    }

    const body = (await request.json()) as {
      action?: string;
      text?: string;
      targetLanguage?: string;
      sourceLanguage?: string;
      languageCode?: string;
    };
    const { action } = body;

    if (action === "lid") {
      const { text } = body;
      if (typeof text !== "string") {
        return Response.json({ error: "lid action requires text" }, { status: 400 });
      }
      const { language_code: languageCode, script_code: scriptCode } =
        await identifyLanguage(text);
      return Response.json({ languageCode, scriptCode });
    }

    if (action === "translate-to-english") {
      const { text, sourceLanguage } = body;
      if (typeof text !== "string" || typeof sourceLanguage !== "string") {
        return Response.json(
          { error: "translate-to-english action requires text and sourceLanguage" },
          { status: 400 }
        );
      }
      const translatedText = await translateToEnglish(text, sourceLanguage);
      return Response.json({ translatedText });
    }

    if (action === "translate") {
      const { text, targetLanguage } = body;
      if (typeof text !== "string" || typeof targetLanguage !== "string") {
        return Response.json(
          { error: "translate action requires text and targetLanguage" },
          { status: 400 }
        );
      }
      const translatedText = await translateFromEnglish(text, targetLanguage);
      return Response.json({ translatedText });
    }

    if (action === "tts") {
      const { text, languageCode } = body;
      if (typeof text !== "string" || typeof languageCode !== "string") {
        return Response.json(
          { error: "tts action requires text and languageCode" },
          { status: 400 }
        );
      }
      const audioBase64 = await textToSpeech(text, languageCode);
      return Response.json({ audioBase64 });
    }

    return Response.json(
      {
        error:
          "Missing or invalid action; use process-voice, lid, translate-to-english, translate, or tts",
      },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    console.error("Sarvam API route error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sarvam request failed" },
      { status: 500 }
    );
  }
}
