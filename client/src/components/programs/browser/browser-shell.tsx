import * as React from "react";
import { Globe, ExternalLink } from "lucide-react";

const DEFAULT_URL = "https://duckduckgo.com/";
const START_PAGE = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f5f7fb, #edf2ff);
        color: #122033;
      }
      body {
        display: grid;
        place-items: center;
      }
      .card {
        max-width: 420px;
        margin: 24px;
        padding: 22px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 18px 40px rgba(34, 60, 80, 0.18);
      }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; line-height: 1.6; color: #42536a; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>inside browser</h1>
      <p>Use the address bar above to open a web page inside the app.</p>
    </div>
  </body>
</html>
`;

function normalizeUrl(input: string) {
  const raw = input.trim();
  if (!raw) return DEFAULT_URL;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return raw;
  return `https://${raw}`;
}

export function BrowserShell() {
  const [address, setAddress] = React.useState(DEFAULT_URL);
  const [frameUrl, setFrameUrl] = React.useState<string | null>(null);
  const [frameDoc, setFrameDoc] = React.useState(START_PAGE);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeUrl(address);
    setAddress(next);
    setFrameUrl(next);
    setFrameDoc("");
  };

  return (
    <div className="program-shell program-shell--browser">
      <div className="program-hero">
        <div className="program-kicker">
          <Globe size={14} />
          <span>inside browser</span>
        </div>
        <h2>lightweight web view</h2>
        <p>Open a site inside the app with a simple address bar and iframe-based preview.</p>
      </div>

      <form className="program-launcher" onSubmit={handleSubmit}>
        <input
          className="program-input"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="enter a url or domain"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="program-button" type="submit">
          <ExternalLink size={14} />
          <span>open</span>
        </button>
      </form>

      <div className="program-frame-shell">
        <iframe
          className="program-frame"
          src={frameUrl || undefined}
          srcDoc={frameUrl ? undefined : frameDoc}
          title="inside browser"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
}
