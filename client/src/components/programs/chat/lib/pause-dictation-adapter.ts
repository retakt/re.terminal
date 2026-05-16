import type { DictationAdapter } from "@assistant-ui/react";

export class PauseDictationAdapter implements DictationAdapter {
  public disableInputDuringDictation = true;
  private lang: string;

  constructor(options: { lang?: string } = {}) {
    this.lang = options.lang ?? navigator.language;
  }

  listen(): DictationAdapter.Session {
    const speechCallbacks = new Set<(r: DictationAdapter.Result) => void>();
    const endCallbacks = new Set<(r: DictationAdapter.Result) => void>();
    const startCallbacks = new Set<() => void>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.lang;

    const session: DictationAdapter.Session = {
      status: { type: "starting" },
      stop: async () => recognition.stop(),
      cancel: () => recognition.abort(),
      onSpeechStart: (cb) => {
        startCallbacks.add(cb);
        return () => startCallbacks.delete(cb);
      },
      onSpeechEnd: (cb) => {
        endCallbacks.add(cb);
        return () => endCallbacks.delete(cb);
      },
      onSpeech: (cb) => {
        speechCallbacks.add(cb);
        return () => speechCallbacks.delete(cb);
      },
    };

    recognition.onstart = () => {
      (session as { status: DictationAdapter.Status }).status = { type: "running" };
      for (const cb of startCallbacks) cb();
    };

    recognition.onresult = (event: { resultIndex: number; results: SpeechRecognitionResultList }) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        const isFinal = result.isFinal;
        for (const cb of speechCallbacks) cb({ transcript, isFinal });
      }
    };

    recognition.onend = () => {
      (session as { status: DictationAdapter.Status }).status = { type: "ended", reason: "stopped" };
      for (const cb of endCallbacks) cb({ transcript: "" });
    };

    recognition.onerror = () => {
      (session as { status: DictationAdapter.Status }).status = { type: "ended", reason: "error" };
      for (const cb of endCallbacks) cb({ transcript: "" });
    };

    recognition.start();
    return session;
  }
}
