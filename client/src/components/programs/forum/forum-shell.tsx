import { MessageCircleMore } from "lucide-react";

const topics = [
  {
    title: "release notes",
    body: "Track what changed in the app and what should land next.",
  },
  {
    title: "bug reports",
    body: "Collect small issues before they become hard to find.",
  },
  {
    title: "feature requests",
    body: "Keep ideas visible while the shell evolves.",
  },
];

export function ForumShell() {
  return (
    <div className="program-shell program-shell--forum">
      <div className="program-hero">
        <div className="program-kicker">
          <MessageCircleMore size={14} />
          <span>forum</span>
        </div>
        <h2>discussion board</h2>
        <p>A simple community-style surface for threads, updates, and discussions.</p>
      </div>

      <div className="program-card-list">
        {topics.map(topic => (
          <article key={topic.title} className="program-card">
            <h3>{topic.title}</h3>
            <p>{topic.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
