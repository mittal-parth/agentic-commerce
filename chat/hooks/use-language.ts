"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";

export interface ProcessVoiceResult {
  transcript: string;
  englishText: string;
  languageCode: string;
}

export interface UseLanguageResult {
  userLanguage: string | null;
  isVoiceMode: boolean;
  isProcessing: boolean;
  setUserLanguage: (lang: string | null) => void;
  setVoiceMode: (value: boolean) => void;
  processVoiceInput: (audioBlob: Blob) => Promise<ProcessVoiceResult | null>;
  translateAssistantMessage: (
    message: ChatMessage
  ) => Promise<{ translatedByPart: Map<number, string> } | null>;
  synthesizeAndPlay: (messageId: string, text: string) => Promise<void>;
  getTranslatedText: (messageId: string, partIndex: number) => string | undefined;
  getTtsAudio: (messageId: string) => string | undefined;
  playTtsAudio: (messageId: string) => void;
  stopTtsAudio: () => void;
  isPlaying: boolean;
}

const SARVAM_API = "/api/sarvam";

export function useLanguage(): UseLanguageResult {
  const [userLanguage, setUserLanguage] = useState<string | null>(null);
  const [isVoiceMode, setVoiceMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState<
    Map<string, Map<number, string>>
  >(() => new Map());
  const [ttsAudio, setTtsAudio] = useState<Map<string, string>>(() => new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const processVoiceInput = useCallback(
    async (audioBlob: Blob): Promise<ProcessVoiceResult | null> => {
      setIsProcessing(true);
      try {
        const formData = new FormData();
        formData.append("action", "process-voice");
        formData.append("audio", audioBlob, "audio.webm");
        const res = await fetch(SARVAM_API, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? "Voice processing failed");
        }
        const data = (await res.json()) as ProcessVoiceResult;
        setUserLanguage(data.languageCode);
        setVoiceMode(true);
        return data;
      } catch (e) {
        console.error("processVoiceInput error:", e);
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const translateAssistantMessage = useCallback(
    async (
      message: ChatMessage
    ): Promise<{ translatedByPart: Map<number, string> } | null> => {
      if (message.role !== "assistant" || !userLanguage || userLanguage === "en-IN") {
        return null;
      }
      if (!message.parts?.some((p) => p.type === "text")) return null;

      try {
        const updates = new Map<number, string>();
        for (let i = 0; i < (message.parts?.length ?? 0); i++) {
          const part = message.parts![i];
          if (part.type !== "text") continue;
          const text = (part as { text?: string }).text ?? "";
          if (!text.trim()) continue;
          const res = await fetch(SARVAM_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "translate",
              text,
              targetLanguage: userLanguage,
            }),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { translatedText?: string };
          if (data.translatedText) updates.set(i, data.translatedText);
        }
        if (updates.size > 0) {
          setTranslatedMessages((prev) => {
            const next = new Map(prev);
            const inner = new Map(next.get(message.id) ?? []);
            updates.forEach((v, k) => inner.set(k, v));
            next.set(message.id, inner);
            return next;
          });
          return { translatedByPart: updates };
        }
        return null;
      } catch (e) {
        console.error("translateAssistantMessage error:", e);
        return null;
      }
    },
    [userLanguage]
  );

  const stopTtsAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
      setIsPlaying(false);
    }
  }, []);

  const playAudioFromBase64 = useCallback(
    (base64: string) => {
      stopTtsAudio();
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      currentAudioRef.current = audio;
      setIsPlaying(true);
      audio.addEventListener("ended", () => {
        currentAudioRef.current = null;
        setIsPlaying(false);
      });
      audio.addEventListener("error", () => {
        currentAudioRef.current = null;
        setIsPlaying(false);
      });
      audio.play().catch(() => {
        currentAudioRef.current = null;
        setIsPlaying(false);
      });
    },
    [stopTtsAudio]
  );

  const synthesizeAndPlay = useCallback(
    async (messageId: string, text: string): Promise<void> => {
      if (!userLanguage || !text.trim()) return;
      try {
        const res = await fetch(SARVAM_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "tts",
            text,
            languageCode: userLanguage,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { audioBase64?: string };
        if (!data.audioBase64) return;
        setTtsAudio((prev) => {
          const next = new Map(prev);
          next.set(messageId, data.audioBase64!);
          return next;
        });
        playAudioFromBase64(data.audioBase64);
      } catch (e) {
        console.error("synthesizeAndPlay error:", e);
      }
    },
    [userLanguage, playAudioFromBase64]
  );

  const getTranslatedText = useCallback(
    (messageId: string, partIndex: number): string | undefined => {
      return translatedMessages.get(messageId)?.get(partIndex);
    },
    [translatedMessages]
  );

  const getTtsAudio = useCallback(
    (messageId: string): string | undefined => ttsAudio.get(messageId),
    [ttsAudio]
  );

  const playTtsAudio = useCallback((messageId: string) => {
    const base64 = ttsAudio.get(messageId);
    if (!base64) return;
    playAudioFromBase64(base64);
  }, [ttsAudio, playAudioFromBase64]);

  return {
    userLanguage,
    isVoiceMode,
    isProcessing,
    setUserLanguage,
    setVoiceMode,
    processVoiceInput,
    translateAssistantMessage,
    synthesizeAndPlay,
    getTranslatedText,
    getTtsAudio,
    playTtsAudio,
    stopTtsAudio,
    isPlaying,
  };
}
