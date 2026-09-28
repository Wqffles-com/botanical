"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BROWSER_DICTATION_NOTE,
  CHECKING_REASON,
  buildTranscriptionForm,
  formatElapsed,
  microphoneErrorMessage,
  parseDictationCapability,
  planDictation,
  readApiErrorMessage,
  readDictationSupport,
  speechErrorMessage,
  speechRecognitionConstructor,
  transcriptionFailureMessage,
  isServerAudioType,
  type DictationPlan,
} from "./dictation";

type Phase = "idle" | "recording" | "transcribing";

interface SpeechAlternative {
  transcript?: string;
}

interface SpeechResult {
  isFinal: boolean;
  0?: SpeechAlternative;
  length: number;
  item?: (index: number) => SpeechAlternative;
}

interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}

interface BrowserSpeech {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface Session {
  cancelled: boolean;
  stopping: boolean;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  recognition: BrowserSpeech | null;
  stopTimer: number | null;
  startedAt: number;
  inserted: boolean;
  notified: boolean;
  maxBytes: number;
  maxSeconds: number;
  mimeType: string;
}

export interface DictationController {
  phase: Phase;
  elapsedLabel: string;
  interim: string;
  error: string | null;
  privacyNote: string | null;
  tooltip: string;
  micLabel: string;
  micDisabled: boolean;
  toggle: () => void;
  cancel: () => void;
}

let capabilityPromise: Promise<unknown> | null = null;

function loadCapabilityBody(): Promise<unknown> {
  if (capabilityPromise) return capabilityPromise;
  const pending = fetch("/api/capabilities", {
    headers: { accept: "application/json" },
    credentials: "include",
  })
    .then(async (response) => {
      const raw = await response.text();
      if (!response.ok) throw new Error("capabilities");
      return raw ? (JSON.parse(raw) as unknown) : null;
    })
    .catch((error: unknown) => {
      capabilityPromise = null;
      throw error;
    });
  capabilityPromise = pending;
  return pending;
}

export function useDictation(options: { blocked: boolean; onInsert: (text: string) => void }): DictationController {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [plan, setPlan] = useState<DictationPlan | { state: "loading" }>({ state: "loading" });

  const onInsertRef = useRef(options.onInsert);
  const blockedRef = useRef(options.blocked);
  const sessionRef = useRef<Session | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const mountedRef = useRef(true);
  const armingRef = useRef(false);
  const planRef = useRef(plan);
  const stopRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const report = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setError(message);
  }, []);

  const finishIdle = useCallback(() => {
    setPhaseSafe("idle");
    if (!mountedRef.current) return;
    setInterim("");
    setElapsedMs(0);
    setArming(false);
    armingRef.current = false;
  }, [setPhaseSafe]);

  const releaseStream = useCallback((session: Session) => {
    if (session.stopTimer !== null) {
      window.clearTimeout(session.stopTimer);
      session.stopTimer = null;
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    session.stream = null;
  }, []);

  const notify = useCallback(
    (session: Session, message: string) => {
      if (session.notified || session.cancelled) return;
      session.notified = true;
      report(message);
    },
    [report],
  );

  const handleServerStop = useCallback(
    async (session: Session, chunks: Blob[]) => {
      releaseStream(session);
      if (sessionRef.current === session) sessionRef.current = null;
      if (session.cancelled || !mountedRef.current) return;
      const blob = new Blob(chunks, { type: session.mimeType });
      if (blob.size === 0) {
        notify(session, "No speech detected.");
        finishIdle();
        return;
      }
      if (blob.size > session.maxBytes) {
        notify(session, "That recording is too large.");
        finishIdle();
        return;
      }
      setPhaseSafe("transcribing");
      try {
        const text = await uploadTranscription(blob, Date.now() - session.startedAt, session.maxSeconds);
        if (session.cancelled || !mountedRef.current) return;
        if (!text.trim()) notify(session, "No speech detected.");
        else onInsertRef.current(text);
      } catch (uploadError) {
        if (session.cancelled || !mountedRef.current) return;
        const message = uploadError instanceof Error && uploadError.message ? uploadError.message : "Transcription failed. Try again.";
        notify(session, message);
      } finally {
        if (!session.cancelled) finishIdle();
      }
    },
    [finishIdle, notify, releaseStream, setPhaseSafe],
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.stopping || phaseRef.current !== "recording") return;
    session.stopping = true;
    if (session.stopTimer !== null) {
      window.clearTimeout(session.stopTimer);
      session.stopTimer = null;
    }
    if (session.recognition) {
      try {
        session.recognition.stop();
      } catch {
        sessionRef.current = null;
        finishIdle();
      }
      return;
    }
    const recorder = session.recorder;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        releaseStream(session);
        sessionRef.current = null;
        notify(session, "Couldn't record audio.");
        finishIdle();
      }
      return;
    }
    releaseStream(session);
    sessionRef.current = null;
    finishIdle();
  }, [finishIdle, notify, releaseStream]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session && phaseRef.current === "idle" && !armingRef.current) return;
    if (session) {
      session.cancelled = true;
      session.stopping = true;
      if (session.stopTimer !== null) {
        window.clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }
      try {
        session.recognition?.abort();
      } catch {
        // The recognition session already ended.
      }
      const recorder = session.recorder;
      sessionRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          releaseStream(session);
        }
      } else {
        releaseStream(session);
      }
    }
    if (mountedRef.current) setError(null);
    finishIdle();
  }, [finishIdle, releaseStream]);

  const beginSession = useCallback(
    (session: Session) => {
      sessionRef.current = session;
      session.stopTimer = window.setTimeout(() => stopRef.current(), session.maxSeconds * 1000);
      setElapsedMs(0);
      setInterim("");
      setArming(false);
      armingRef.current = false;
      setPhaseSafe("recording");
    },
    [setPhaseSafe],
  );

  const startBrowser = useCallback(
    (next: Extract<DictationPlan, { state: "browser" }>) => {
      const Ctor = speechRecognitionConstructor(window) as (new () => BrowserSpeech) | null;
      if (!Ctor) {
        report("This browser has no built-in speech recognition.");
        return;
      }
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      const session: Session = {
        cancelled: false,
        stopping: false,
        stream: null,
        recorder: null,
        recognition,
        stopTimer: null,
        startedAt: Date.now(),
        inserted: false,
        notified: false,
        maxBytes: next.maxBytes,
        maxSeconds: next.maxSeconds,
        mimeType: "",
      };
      recognition.onresult = (event) => {
        if (session.cancelled) return;
        let finalText = "";
        let pending = "";
        const start = event.resultIndex ?? 0;
        for (let index = start; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result) continue;
          const piece = transcriptOf(result);
          if (result.isFinal) finalText += piece;
          else pending += piece;
        }
        if (finalText.trim()) {
          session.inserted = true;
          onInsertRef.current(finalText);
        }
        if (mountedRef.current) setInterim(pending.trim());
      };
      recognition.onerror = (event) => {
        const message = speechErrorMessage(event.error);
        if (message) notify(session, message);
      };
      recognition.onend = () => {
        if (session.stopTimer !== null) {
          window.clearTimeout(session.stopTimer);
          session.stopTimer = null;
        }
        if (sessionRef.current === session) sessionRef.current = null;
        if (session.cancelled || !mountedRef.current) return;
        if (!session.inserted && !session.notified) notify(session, "No speech detected.");
        finishIdle();
      };
      try {
        recognition.start();
      } catch (startError) {
        report(microphoneErrorMessage(startError) ?? "Couldn't start dictation.");
        return;
      }
      beginSession(session);
    },
    [beginSession, finishIdle, notify, report],
  );

  const startServer = useCallback(
    async (next: Extract<DictationPlan, { state: "server" }>) => {
      if (armingRef.current) return;
      armingRef.current = true;
      if (mountedRef.current) setArming(true);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (startError) {
        armingRef.current = false;
        if (mountedRef.current) setArming(false);
        report(microphoneErrorMessage(startError) ?? "Couldn't start dictation.");
        return;
      }
      if (!mountedRef.current || blockedRef.current || phaseRef.current !== "idle") {
        stream.getTracks().forEach((track) => track.stop());
        armingRef.current = false;
        if (mountedRef.current) setArming(false);
        return;
      }
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: next.mimeType });
      } catch {
        try {
          recorder = new MediaRecorder(stream);
        } catch (startError) {
          stream.getTracks().forEach((track) => track.stop());
          armingRef.current = false;
          if (mountedRef.current) setArming(false);
          report(microphoneErrorMessage(startError) ?? "Couldn't start dictation.");
          return;
        }
      }
      const mimeType = recorder.mimeType || next.mimeType;
      if (!isServerAudioType(mimeType)) {
        stream.getTracks().forEach((track) => track.stop());
        armingRef.current = false;
        if (mountedRef.current) setArming(false);
        report("This browser records in a format the server can't transcribe.");
        return;
      }
      const chunks: Blob[] = [];
      const session: Session = {
        cancelled: false,
        stopping: false,
        stream,
        recorder,
        recognition: null,
        stopTimer: null,
        startedAt: Date.now(),
        inserted: false,
        notified: false,
        maxBytes: next.maxBytes,
        maxSeconds: next.maxSeconds,
        mimeType,
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        notify(session, "Couldn't record audio.");
        session.cancelled = true;
        releaseStream(session);
        if (sessionRef.current === session) sessionRef.current = null;
        finishIdle();
      };
      recorder.onstop = () => {
        void handleServerStop(session, chunks);
      };
      try {
        recorder.start();
      } catch (startError) {
        stream.getTracks().forEach((track) => track.stop());
        armingRef.current = false;
        if (mountedRef.current) setArming(false);
        report(microphoneErrorMessage(startError) ?? "Couldn't start dictation.");
        return;
      }
      beginSession(session);
    },
    [beginSession, finishIdle, handleServerStop, notify, releaseStream, report],
  );

  const toggle = useCallback(() => {
    if (phaseRef.current === "recording") {
      stop();
      return;
    }
    if (phaseRef.current !== "idle" || armingRef.current || blockedRef.current) return;
    const current = planRef.current;
    if (current.state === "loading" || current.state === "unavailable") return;
    if (mountedRef.current) setError(null);
    if (current.state === "server") void startServer(current);
    else startBrowser(current);
  }, [startBrowser, startServer, stop]);

  useEffect(() => {
    onInsertRef.current = options.onInsert;
    blockedRef.current = options.blocked;
    planRef.current = plan;
    stopRef.current = stop;
    cancelRef.current = cancel;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      session.stopping = true;
      try {
        session.recognition?.abort();
      } catch {
        // already ended
      }
      if (session.stopTimer !== null) window.clearTimeout(session.stopTimer);
      if (session.recorder && session.recorder.state !== "inactive") {
        try {
          session.recorder.stop();
        } catch {
          session.stream?.getTracks().forEach((track) => track.stop());
        }
      } else {
        session.stream?.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadCapabilityBody()
      .then((body) => {
        if (cancelled) return;
        setPlan(planDictation(parseDictationCapability(body), readDictationSupport(window)));
      })
      .catch(() => {
        if (cancelled) return;
        setPlan(planDictation(null, readDictationSupport(window)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = sessionRef.current?.startedAt ?? Date.now();
    const tick = () => {
      if (mountedRef.current) setElapsedMs(Date.now() - started);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-testid='dictation-cancel']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        stopRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase]);

  useEffect(() => {
    if (!options.blocked) return;
    cancelRef.current();
  }, [options.blocked]);

  const privacyNote = phase === "recording" && plan.state === "browser" ? BROWSER_DICTATION_NOTE : null;
  const tooltip = tooltipFor(plan, phase);
  const micDisabled =
    arming ||
    phase === "transcribing" ||
    (phase !== "recording" && (options.blocked || plan.state === "loading" || plan.state === "unavailable"));
  const micLabel =
    phase === "recording"
      ? "Stop dictation"
      : phase === "transcribing" || arming
        ? "Transcribing"
        : plan.state === "loading"
          ? CHECKING_REASON
          : plan.state === "unavailable"
            ? plan.disabledReason
            : "Start dictation";

  return {
    phase,
    elapsedLabel: formatElapsed(elapsedMs),
    interim,
    error: phase === "idle" ? error : null,
    privacyNote,
    tooltip,
    micLabel,
    micDisabled,
    toggle,
    cancel,
  };
}

function tooltipFor(plan: DictationPlan | { state: "loading" }, phase: Phase): string {
  if (plan.state === "loading") return CHECKING_REASON;
  if (plan.state === "unavailable") return plan.disabledReason;
  if (phase === "transcribing") return "Transcribing…";
  if (phase === "recording") {
    const how = "Click again, or press Enter or Space, to stop. Escape cancels.";
    return plan.state === "browser" ? `${BROWSER_DICTATION_NOTE} ${how}` : `Recording. ${how}`;
  }
  if (plan.state === "browser") {
    return `${BROWSER_DICTATION_NOTE} Click to dictate. The text is inserted for editing and is not sent.`;
  }
  return "Dictate. Audio is transcribed on this server and inserted for editing. It is not sent.";
}

function transcriptOf(result: SpeechResult): string {
  const indexed = result[0];
  if (indexed && typeof indexed.transcript === "string") return indexed.transcript;
  if (typeof result.item === "function") {
    const alternative = result.item(0);
    if (alternative && typeof alternative.transcript === "string") return alternative.transcript;
  }
  return "";
}

async function uploadTranscription(blob: Blob, elapsedMs: number, maxSeconds: number): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/transcriptions", {
      method: "POST",
      body: buildTranscriptionForm(blob, elapsedMs, maxSeconds),
      credentials: "include",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("Transcription failed. Try again.");
  }
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new Error(transcriptionFailureMessage(response.status, readApiErrorMessage(body)));
  }
  if (!body || typeof body !== "object" || typeof (body as { text?: unknown }).text !== "string") {
    throw new Error("Transcription failed. Try again.");
  }
  return (body as { text: string }).text;
}
