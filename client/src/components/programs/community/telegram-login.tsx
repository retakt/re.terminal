import { MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";

type TelegramLoginProps = {
  onDone: () => void;
};

export function TelegramLogin({ onDone }: TelegramLoginProps) {
  return (
    <div className="community-login">
      <div className="community-login-card">
        <div className="community-login-titlebar" aria-hidden="true">
          <span className="community-login-dot" />
          <span className="community-login-dot" />
          <span className="community-login-dot" />
          <span className="community-login-title">telegram auth</span>
        </div>

        <div className="community-login-logo">
          <MessageSquare size={22} strokeWidth={1.8} />
          <span>telegram</span>
        </div>

        <p className="community-login-subtitle">
          connect your telegram account to re.Term
        </p>

        <form
          className="community-login-form"
          onSubmit={(event) => {
            event.preventDefault();
            onDone();
          }}
        >
          <label className="community-login-field">
            <span className="community-login-label">phone number</span>

            <div className="community-login-command">
              <span className="community-login-prompt">&gt;</span>
              <input
                className="community-login-input"
                placeholder="+1 555 000 0000"
                inputMode="tel"
              />

              <button className="community-login-btn" type="submit">
                <ChevronRight size={14} />
                continue
              </button>
            </div>
          </label>
        </form>

        <div className="community-login-actions">
          <button type="button" className="community-login-link" onClick={onDone}>
            <ChevronLeft size={13} />
            back to chats
          </button>
        </div>

        <p className="community-login-note">
          this is still mock auth. next step is wiring this flow to tdlib.
        </p>
      </div>
    </div>
  );
}
