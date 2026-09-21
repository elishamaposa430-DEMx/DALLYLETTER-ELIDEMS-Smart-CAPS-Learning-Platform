import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Send, Trash2, Loader2 } from "lucide-react";

interface VoiceRecorderProps {
  onSend: (audio: Blob) => void | Promise<void>;
  isSending?: boolean;
}

export function VoiceRecorder({ onSend, isSending }: VoiceRecorderProps) {
  const [state, setState] = useState<"idle" | "recording" | "preview">("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setState("preview");
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start(100);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
  };

  const discard = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setState("idle");
    setSeconds(0);
    setError(null);
  };

  const sendVoice = async () => {
    if (!audioUrl) return;
    const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType ?? "audio/webm" });
    setError(null);
    try {
      await onSend(blob);
      discard();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Voice message could not be sent.");
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (state === "idle") {
    return (
      <div className="flex flex-col items-center gap-1">
        {error && <p className="text-xs text-destructive text-center max-w-[160px]">{error}</p>}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-primary hover:border-primary"
          title="Record voice note"
          onClick={startRecording}
        >
          <Mic className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-full px-3 py-1.5">
        <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
        <span className="text-xs font-mono text-destructive font-semibold">{fmt(seconds)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Stop recording"
          onClick={stopRecording}
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-muted/50 border rounded-full px-2 py-1">
      <audio src={audioUrl ?? undefined} controls className="h-8 max-w-[150px] sm:max-w-[200px]" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        title="Discard"
        onClick={discard}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        className="h-7 w-7 rounded-full"
        title="Send voice note"
        onClick={sendVoice}
        disabled={isSending}
      >
        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
