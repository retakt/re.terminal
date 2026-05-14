  import {
    X,
    AppWindow,
    Blocks,
    Puzzle,
    Package,
    Terminal,
    FlaskConical,
    ChevronRight,
    Moon,
    Sun,
    Monitor,
  } from "lucide-react";

  import { motion, AnimatePresence } from "framer-motion";

  interface SettingsState {
    theme: 'dark' | 'light' | 'system';
    fontSize: number;
    fontFamily: string;
    terminalOpacity: number;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    settings: SettingsState;
    onUpdate: (updates: Partial<SettingsState>) => void;
  }

  const ITEMS = [
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
    settings,
    onUpdate,
  }: Props) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="settings-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />

            <motion.div
              className="settings-panel"
              initial={{
                opacity: 0,
                y: 8,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 8,
                scale: 0.98,
              }}
              transition={{
                duration: 0.12,
              }}
            >
              {/* Header */}
              <div className="settings-header">
                <span className="settings-title">
                  Manage
                </span>

                <button
                  type="button"
                  className="settings-close"
                  onClick={onClose}
                  aria-label="close settings"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Theme Toggle */}
              <div className="settings-theme-toggle">
                <button
                  type="button"
                  className={`settings-theme-btn ${settings.theme === 'dark' ? 'active' : ''}`}
                  onClick={() => onUpdate({ theme: 'dark' })}
                  title="Dark theme"
                >
                  <Moon size={14} />
                </button>
                <button
                  type="button"
                  className={`settings-theme-btn ${settings.theme === 'light' ? 'active' : ''}`}
                  onClick={() => onUpdate({ theme: 'light' })}
                  title="Light theme"
                >
                  <Sun size={14} />
                </button>
                <button
                  type="button"
                  className={`settings-theme-btn ${settings.theme === 'system' ? 'active' : ''}`}
                  onClick={() => onUpdate({ theme: 'system' })}
                  title="System theme"
                >
                  <Monitor size={14} />
                </button>
              </div>

              {/* Menu */}
              <div className="settings-menu">
                {ITEMS.map(item => {
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="settings-menu-item"
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