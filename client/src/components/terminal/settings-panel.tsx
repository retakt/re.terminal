import {
  AppWindow,
  Blocks,
  Puzzle,
  Package,
  Terminal,
  FlaskConical,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/contexts/app-context";
import type { ProgramKind } from "@/lib/file-routing";
import type { LucideIcon } from "lucide-react";

type SettingsItem =
  | {
      id: "apps";
      label: string;
      icon: LucideIcon;
    }
  | {
      id: ProgramKind;
      label: string;
      icon: LucideIcon;
    };

const ITEMS: SettingsItem[] = [
  {
    id: "apps",
    label: "Apps",
    icon: AppWindow,
  },
  {
    id: "mcp",
    label: "Mcp",
    icon: Blocks,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Puzzle,
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: Package,
  },
  {
    id: "scripts",
    label: "Scripts",
    icon: Terminal,
  },
  {
    id: "playground",
    label: "Playground",
    icon: FlaskConical,
  },
];

export function SettingsPanel({
  isOpen,
  onClose,
}: { isOpen: boolean; onClose: () => void }) {
  const { openProgram } = useApp();

  const handleItemClick = (item: SettingsItem) => {
    if (item.id === "apps") return;
    openProgram(item.id);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="settings-backdrop"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="settings-panel"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
          >
            <div className="settings-menu">
              {ITEMS.map(item => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="settings-menu-item"
                    onClick={() => handleItemClick(item)}
                  >
                    <div className="settings-menu-left">
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </div>

                    {item.id === "apps" && (
                      <ChevronRight size={14} />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
