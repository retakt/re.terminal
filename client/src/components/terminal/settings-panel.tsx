/**
 * SettingsPanel — VS Code-style settings popup
 * Opens from bottom-right corner of status bar
 */

import { X, Moon, Sun, Monitor, Type, Palette, Terminal as TerminalIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface SettingsState {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  fontFamily: string;
  terminalOpacity: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsState;
  onUpdate: (settings: Partial<SettingsState>) => void;
}

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18];
const FONT_FAMILIES = [
  { label: "Ubuntu Mono", value: '"Ubuntu Mono", monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { label: "Fira Code", value: '"Fira Code", monospace' },
  { label: "Consolas", value: '"Consolas", monospace' },
];

// Theme display names
const THEME_LABELS = {
  dark: 'github dark legacy',
  light: 'github light',
  system: 'system default',
};

export function SettingsPanel({ isOpen, onClose, settings, onUpdate }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          
          {/* Panel */}
          <motion.div
            className="settings-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="settings-header">
              <span className="settings-title">settings</span>
              <button className="settings-close" onClick={onClose}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            <div className="settings-content">
              {/* Theme */}
              <div className="settings-section">
                <div className="settings-label">
                  <Palette size={12} />
                  <span>theme</span>
                </div>
                <div className="settings-options">
                  {(['dark', 'light', 'system'] as const).map(theme => (
                    <button
                      key={theme}
                      className={`settings-option ${settings.theme === theme ? 'settings-option--active' : ''}`}
                      onClick={() => onUpdate({ theme })}
                    >
                      {theme === 'dark' && <Moon size={11} />}
                      {theme === 'light' && <Sun size={11} />}
                      {theme === 'system' && <Monitor size={11} />}
                      <span>{THEME_LABELS[theme]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div className="settings-section">
                <div className="settings-label">
                  <Type size={12} />
                  <span>font size</span>
                </div>
                <div className="settings-options settings-options--grid">
                  {FONT_SIZES.map(size => (
                    <button
                      key={size}
                      className={`settings-option settings-option--small ${settings.fontSize === size ? 'settings-option--active' : ''}`}
                      onClick={() => onUpdate({ fontSize: size })}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Family */}
              <div className="settings-section">
                <div className="settings-label">
                  <TerminalIcon size={12} />
                  <span>terminal font</span>
                </div>
                <div className="settings-options settings-options--vertical">
                  {FONT_FAMILIES.map(font => (
                    <button
                      key={font.value}
                      className={`settings-option ${settings.fontFamily === font.value ? 'settings-option--active' : ''}`}
                      onClick={() => onUpdate({ fontFamily: font.value })}
                      style={{ fontFamily: font.value, fontSize: 11 }}
                    >
                      {font.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terminal Opacity */}
              <div className="settings-section">
                <div className="settings-label">
                  <span>terminal opacity</span>
                  <span className="settings-value">{Math.round(settings.terminalOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1"
                  step="0.05"
                  value={settings.terminalOpacity}
                  onChange={(e) => onUpdate({ terminalOpacity: parseFloat(e.target.value) })}
                  className="settings-slider"
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
