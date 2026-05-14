// Minimal Terminal Setup - Extracted from server_terminal.js
// This file contains only the essential code needed to run a terminal with xterm.js

// ============================================================
// 1. GLOBAL CONFIGURATION
// ============================================================
window.termList = [];
window.fitAddon = null;
window.resizeTimeout = null;

// Default configuration
const DEFAULT_CONFIG = {
    theme: 'Dracula',
    fontSize: 14,
    fontFamily: 'JetBrains Mono Nerd, DejaVu Sans Mono, monospace',
    cursorStyle: 'block',
    cursorBlink: true
};

// ============================================================
// 2. TERMINAL INITIALIZATION
// ============================================================
async function initTerminal(containerId, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };
    
    // Dynamically load xterm.js and addons from CDN
    const [
        { Terminal },
        { FitAddon },
        { WebLinksAddon }
    ] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/+esm')
    ]);
    
    // Create terminal instance
    const term = new Terminal({
        cursorStyle: config.cursorStyle,
        cursorInactiveStyle: 'block',
        cursorBlink: config.cursorBlink,
        theme: window.xtermTheme?.[config.theme] || window.xtermTheme?.Dracula,
        fontSize: config.fontSize,
        fontFamily: config.fontFamily
    });
    
    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    
    // Open terminal in container
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Container element #${containerId} not found`);
    }
    term.open(container);
    term.focus();
    
    // Store references
    window.termList.push(term);
    window.fitAddon = fitAddon;
    
    // Initial fit
    fitAddon.fit();
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.resizeTimeout) clearTimeout(window.resizeTimeout);
        window.resizeTimeout = setTimeout(() => {
            fitAddon.fit();
            onResize(term);
        }, 500);
    });
    
    return { term, fitAddon };
}

// ============================================================
// 3. RESIZE HANDLER
// ============================================================
function onResize(term) {
    const size = { cols: term.cols, rows: term.rows };
    console.log('Terminal resized:', size);
    
    // Emit resize event for WebSocket/backend
    const event = new CustomEvent('terminalResize', { detail: size });
    window.dispatchEvent(event);
    
    // If using native bridge (iOS/Android)
    if (window.webkit?.messageHandlers?.jsBridge) {
        window.webkit.messageHandlers.jsBridge.postMessage(
            JSON.stringify({ type: 'onResize', data: JSON.stringify(size) })
        );
    }
}

// ============================================================
// 4. WEBSOCKET CONNECTION (Optional)
// ============================================================
function connectWebSocket(term, url = 'ws://localhost:8089/ws') {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        
        socket.onopen = () => {
            term.write('\r\n\x1b[32mConnected to server!\x1b[0m\r\n');
            resolve(socket);
        };
        
        socket.onerror = (err) => {
            term.write('\r\n\x1b[31mConnection failed!\x1b[0m\r\n');
            reject(err);
        };
        
        socket.onmessage = (event) => {
            term.write(event.data);
        };
        
        // Send terminal input to server
        term.onData((data) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
            }
        });
    });
}

// ============================================================
// 5. THEME MANAGEMENT
// ============================================================
function setTheme(themeName) {
    const term = window.termList[0];
    if (!term) return false;
    
    const theme = window.xtermTheme?.[themeName];
    if (!theme) {
        console.warn(`Theme "${themeName}" not found`);
        return false;
    }
    
    term.options.theme = theme;
    document.body.style.backgroundColor = theme.background;
    return true;
}

function setFontSize(size) {
    const term = window.termList[0];
    if (!term) return false;
    
    term.options.fontSize = size;
    window.fitAddon?.fit();
    return true;
}

function setFontFamily(family) {
    const term = window.termList[0];
    if (!term) return false;
    
    term.options.fontFamily = family;
    window.fitAddon?.fit();
    return true;
}

// ============================================================
// 6. UTILITY FUNCTIONS
// ============================================================
function getLineBeforeCursor() {
    const term = window.termList[0];
    if (!term) return '';
    
    const buffer = term.buffer.active;
    const line = buffer.getLine(buffer.cursorY + buffer.viewportY);
    if (!line) return '';
    
    let result = '';
    for (let i = 0; i < buffer.cursorX; i++) {
        const cell = line.getCell(i);
        if (cell) result += cell.getChars();
    }
    return result;
}

function clearTerminal() {
    const term = window.termList[0];
    if (term) term.clear();
}

function writeToTerminal(text) {
    const term = window.termList[0];
    if (term) term.write(text);
}

// Export functions globally
window.initTerminal = initTerminal;
window.connectWebSocket = connectWebSocket;
window.setTheme = setTheme;
window.setFontSize = setFontSize;
window.setFontFamily = setFontFamily;
window.onResize = onResize;
window.getLineBeforeCursor = getLineBeforeCursor;
window.clearTerminal = clearTerminal;
window.writeToTerminal = writeToTerminal;

console.log('Minimal Terminal JS loaded successfully');
