import {
  AppWindow,
  Blocks,
  Puzzle,
  Package,
  Terminal,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  Globe,
  MessageSquare,
  ScrollText,
  Users,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
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

type ProgramMenuItem = {
  id: ProgramKind;
  label: string;
  icon: LucideIcon;
};

const APP_ITEMS: ProgramMenuItem[] = [
  {
    id: "chat",
    label: "ai chat",
    icon: MessageSquare,
  },
  {
    id: "browser",
    label: "browser",
    icon: Globe,
  },
  {
    id: "forum",
    label: "forum",
    icon: MessageSquare,
  },
  {
    id: "community",
    label: "community",
    icon: Users,
  },
];

const TOOL_ITEMS: SettingsItem[] = [
  {
    id: "apps",
    label: "apps",
    icon: AppWindow,
  },
  {
    id: "logs",
    label: "Logs",
    icon: ScrollText,
  },
  {
    id: "mcp",
    label: "mcp",
    icon: Blocks,
  },
  {
    id: "extensions",
    label: "extensions",
    icon: Puzzle,
  },
  {
    id: "plugins",
    label: "plugins",
    icon: Package,
  },
  {
    id: "scripts",
    label: "scripts",
    icon: Terminal,
  },
  {
    id: "playground",
    label: "playground",
    icon: FlaskConical,
  },
];

export function SettingsPanel({
  isOpen,
  onClose,
}: { isOpen: boolean; onClose: () => void }) {
  const { openProgram } = useApp();
  const [appsOpen, setAppsOpen] = useState(false);

  const handleItemClick = (item: SettingsItem) => {
    if (item.id === "apps") {
      setAppsOpen(open => !open);
      return;
    }
    openProgram(item.id);
    onClose();
  };

  const handleProgramClick = (item: ProgramMenuItem) => {
    openProgram(item.id);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            onClick={onClose}
          />

          <motion.div
            className="settings-panel"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="settings-menu">
              {TOOL_ITEMS.map(item => {
                const Icon = item.icon;

                return (
                  <div key={item.id} className="settings-menu-group">
                    <button
                      type="button"
                      className="settings-menu-item"
                      onClick={() => handleItemClick(item)}
                      aria-expanded={item.id === "apps" ? appsOpen : undefined}
                    >
                      <div className="settings-menu-left">
                        <Icon size={14} strokeWidth={1.8} />
                        <span>{item.label}</span>
                      </div>

                      {item.id === "apps" && (
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={appsOpen ? "apps-open" : "apps-closed"}
                            className="settings-menu-chevron"
                            initial={{ opacity: 0, y: appsOpen ? 2 : -2 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: appsOpen ? -2 : 2 }}
                            transition={{ duration: 0.12, ease: "easeOut" }}
                          >
                            {appsOpen
                              ? <ChevronUp size={13} strokeWidth={1.9} />
                              : <ChevronDown size={13} strokeWidth={1.9} />
                            }
                          </motion.span>
                        </AnimatePresence>
                      )}
                    </button>

                    <AnimatePresence initial={false}>
                      {item.id === "apps" && appsOpen && (
                        <motion.div
                          className="settings-submenu"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.16, ease: "easeOut" }}
                        >
                          {APP_ITEMS.map(app => {
                            const AppIcon = app.icon;

                            return (
                              <button
                                key={app.id}
                                type="button"
                                className="settings-submenu-item"
                                onClick={() => handleProgramClick(app)}
                              >
                                <AppIcon size={14} strokeWidth={1.8} />
                                <span>{app.label}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
