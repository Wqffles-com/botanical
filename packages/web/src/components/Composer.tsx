import { useRef, useState } from "react";

export function Composer({
  profileReady,
  streaming,
  onSend,
  onStop,
}: {
  profileReady: boolean;
  streaming: boolean;
  onSend: (content: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = profileReady && !streaming && text.trim().length > 0;

  return (
    <form
      className="bc-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        const pending = text;
        setText("");
        if (areaRef.current) areaRef.current.style.height = "auto";
        void onSend(pending).then((ok) => {
          if (!ok) setText(pending);
        });
      }}
    >
      <label className="bc-sr" htmlFor="composer">
        Message
      </label>
      <textarea
        id="composer"
        ref={areaRef}
        data-testid="composer"
        rows={1}
        value={text}
        disabled={!profileReady || streaming}
        placeholder={profileReady ? "Message this agent" : "Choose a model profile to write"}
        onChange={(event) => {
          setText(event.target.value);
          const el = event.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {streaming ? (
        <button className="bc-button bc-button--quiet" type="button" data-testid="stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button className="bc-button" type="submit" data-testid="send" disabled={!canSubmit}>
          Send
        </button>
      )}
    </form>
  );
}
