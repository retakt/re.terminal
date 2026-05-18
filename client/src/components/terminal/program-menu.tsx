import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/contexts/app-context";
import type { ProgramKind } from "@/lib/file-routing";

type ProgramMenuItem = {
  id: ProgramKind;
  label: string;
};

const ITEMS: ProgramMenuItem[] = [
  { id: "chat", label: "AI Chat" },
  { id: "browser", label: "Lightpanda" },
  { id: "forum", label: "Forum" },
  { id: "community", label: "Community" },
];

export function ProgramMenu({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { openProgram } = useApp();

  const open = (kind: ProgramKind) => {
    openProgram(kind);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="program-menu-backdrop"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="program-menu-panel"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
          >
            <div className="program-menu-list">
              {ITEMS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="program-menu-item"
                  onClick={() => open(item.id)}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
