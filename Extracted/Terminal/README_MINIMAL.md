# Minimal Terminal Setup

This directory contains a **clean, minimal version** of the terminal extracted from the 11,000+ line `server_terminal_formatted.js` bundle.

## 📁 Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `minimal_terminal.js` | Core terminal logic (init, resize, WebSocket, theme switching) | ~200 |
| `minimal_index.html` | Ready-to-run HTML page with toolbar | ~160 |
| `themes.js` | Pre-extracted 100+ themes (already existed) | ~288 |
| `README_MINIMAL.md` | This documentation | - |

## 🚀 Quick Start

### Option 1: Direct Browser (No Build Tools)

1. Open `minimal_index.html` in your browser
2. The terminal will initialize automatically
3. Use the toolbar to change themes and font sizes

**Note:** For ES module imports to work, you need to serve via HTTP:
```bash
# Using Python
cd /workspace/Extracted/Terminal
python -m http.server 8000

# Using Node.js
npx serve .

# Then open: http://localhost:8000/minimal_index.html
```

### Option 2: With Local Backend

Edit `minimal_index.html` and set:
```javascript
const TERMINAL_CONFIG = {
  theme: 'Dracula',
  fontSize: 14,
  enableWebSocket: true,  // Enable this
  webSocketUrl: 'ws://your-server:8089/ws'
};
```

## 🎯 What Was Extracted

From the original 11,642 lines, we kept only:

### 1. Terminal Initialization (~50 lines)
- Dynamic loading of xterm.js + addons from CDN
- Terminal configuration (theme, font, cursor)
- Container binding

### 2. Resize Handling (~30 lines)
- Window resize listener with debounce
- Fit addon integration
- Native bridge support (iOS/Android webkit)

### 3. WebSocket Connection (~30 lines)
- Connection management
- Bidirectional data flow
- Error handling

### 4. Theme/Font Management (~40 lines)
- Runtime theme switching
- Font size/family changes
- Background color sync

### 5. Utility Functions (~30 lines)
- Get line before cursor
- Clear terminal
- Write to terminal

### Ignored (~11,400 lines)
- ❌ React 18 runtime & hooks
- ❌ CSS-in-JS bundler code
- ❌ Tab view components
- ❌ Complex state management
- ❌ Build artifacts & polyfills

## 🎨 Available Themes

All 100+ themes from the original bundle are available in `themes.js`:

**Popular ones:**
- Dracula
- OneHalfDark / OneHalfLight
- Gruvbox_Dark
- Solarized_Dark / Solarized_Light
- Tomorrow_Night
- Monokai_Vivid
- Nord
- Material / MaterialDark
- And 90+ more...

Use them like:
```javascript
setTheme('Gruvbox_Dark');
// or
window.setTheme('Solarized_Dark');
```

## 🔧 API Reference

### Initialize Terminal
```javascript
const { term, fitAddon } = await initTerminal('container-id', {
  theme: 'Dracula',
  fontSize: 16,
  fontFamily: 'Monospace',
  cursorStyle: 'block',
  cursorBlink: true
});
```

### Connect WebSocket
```javascript
await connectWebSocket(term, 'ws://localhost:8089/ws');
```

### Change Theme
```javascript
setTheme('Tomorrow_Night');
```

### Change Font Size
```javascript
setFontSize(18);
```

### Change Font Family
```javascript
setFontFamily("'Fira Code', monospace");
```

### Utilities
```javascript
clearTerminal();
writeToTerminal("Hello World\r\n");
const line = getLineBeforeCursor();
```

## 🛠️ Customization

### Add Your Own Theme
Edit `themes.js`:
```javascript
const NeoTerminalThemes = {
  // ... existing themes ...
  
  MyCustomTheme: {
    foreground: "#ffffff",
    background: "#000000",
    cursor: "#ffff00",
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff"
  }
};
```

### Add Custom Key Handler
In `minimal_index.html`:
```javascript
term.attachCustomKeyEventHandler((arg) => {
  if (arg.ctrlKey && arg.key === 'l') {
    clearTerminal();
    return false; // Prevent default
  }
  return true;
});
```

### Handle Resize Events
```javascript
window.addEventListener('terminalResize', (e) => {
  console.log('New size:', e.detail.cols, 'x', e.detail.rows);
  // Send to backend
  websocket.send(JSON.stringify({
    type: 'resize',
    cols: e.detail.cols,
    rows: e.detail.rows
  }));
});
```

## 📊 Comparison

| Feature | Original Bundle | Minimal Version |
|---------|----------------|-----------------|
| Total Lines | 11,642 | ~200 |
| Dependencies | React 18, bundled xterm | CDN xterm.js |
| Build Required | Yes (Webpack) | No |
| Themes | 100+ embedded | 100+ external file |
| WebSocket | iOS-specific | Generic |
| Resizing | Complex handlers | Simple debounce |
| Readability | Minified → formatted | Clean from start |

## 🐛 Troubleshooting

### "Failed to fetch" errors
- You must serve via HTTP (not `file://`)
- Use `python -m http.server 8000` or similar

### Themes not loading
- Ensure `themes.js` loads before `minimal_terminal.js`
- Check `window.xtermTheme` is set

### Terminal not fitting container
- Call `fitAddon.fit()` after initialization
- Ensure container has explicit height (100%)

### WebSocket connection fails
- Check server is running on specified URL
- Verify CORS settings if cross-origin

## 📝 Next Steps

Want to add more features? Here's what you can extend:

1. **Tab Support**: Add multiple terminal tabs
2. **Local Storage**: Persist theme/font preferences
3. **Command History**: Implement up/down arrow history
4. **Auto-complete**: Add command suggestions
5. **Session Restore**: Save/restore terminal state
6. **File Transfer**: Drag-and-drop file upload
7. **Search**: Add xterm search addon

## 🙏 Credits

Original extraction from:
- `server_terminal_formatted.js` (11,642 lines)
- `server_terminal.js` (minified bundle)

Themes extracted from the same source, cleaned into `themes.js`.

---

**Created**: 2024
**Purpose**: Provide a clean, maintainable terminal setup without 11k lines of bundle bloat
