import { UsersRound } from "lucide-react";

const rooms = [
  {
    name: "builders",
    note: "Share progress and ship small wins.",
  },
  {
    name: "templates",
    note: "Collect reusable layouts and snippets.",
  },
  {
    name: "mobile",
    note: "Keep phone-first details easy to spot.",
  },
];

export function CommunityShell() {
  return (
    <div className="program-shell program-shell--community">
      <div className="program-hero">
        <div className="program-kicker">
          <UsersRound size={14} />
          <span>community</span>
        </div>
        <h2>shared workspace</h2>
        <p>Use this tab for member pages, announcements, and lightweight coordination.</p>
      </div>

      <div className="program-card-grid">
        {rooms.map(room => (
          <article key={room.name} className="program-card program-card--room">
            <h3>{room.name}</h3>
            <p>{room.note}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
