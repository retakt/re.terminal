// NeoTerminal Themes - Extracted from server_terminal.js
// Contains 100+ terminal color themes for xterm.js

const NeoTerminalThemes = {
    // Default theme
    Night_3024: {
        foreground: "#a5a2a2", background: "#090300", cursor: "#a5a2a2",
        black: "#090300", brightBlack: "#5c5855",
        red: "#db2d20", brightRed: "#e8bbd0",
        green: "#01a252", brightGreen: "#3a3432",
        yellow: "#fded02", brightYellow: "#4a4543",
        blue: "#01a0e4", brightBlue: "#807d7c",
        magenta: "#a16a94", brightMagenta: "#d6d5d4",
        cyan: "#b5e4f4", brightCyan: "#cdab53",
        white: "#a5a2a2", brightWhite: "#f7f7f7"
    },
    
    AdventureTime: {
        foreground: "#f8dcc0", background: "#1f1d45", cursor: "#efbf38",
        black: "#050404", brightBlack: "#4e7cbf",
        red: "#bd0013", brightRed: "#fc5f5a",
        green: "#4ab118", brightGreen: "#9eff6e",
        yellow: "#e7741e", brightYellow: "#efc11a",
        blue: "#0f4ac6", brightBlue: "#1997c6",
        magenta: "#665993", brightMagenta: "#9b5953",
        cyan: "#70a598", brightCyan: "#c8faf4",
        white: "#f8dcc0", brightWhite: "#f6f5fb"
    },
    
    Afterglow: {
        foreground: "#d0d0d0", background: "#212121", cursor: "#d0d0d0",
        black: "#151515", brightBlack: "#505050",
        red: "#ac4142", brightRed: "#ac4142",
        green: "#7e8e50", brightGreen: "#7e8e50",
        yellow: "#e5b567", brightYellow: "#e5b567",
        blue: "#6c99bb", brightBlue: "#6c99bb",
        magenta: "#9f4e85", brightMagenta: "#9f4e85",
        cyan: "#7dd6cf", brightCyan: "#7dd6cf",
        white: "#d0d0d0", brightWhite: "#f5f5f5"
    },
    
    Dracula: {
        foreground: "#f8f8f2", background: "#1e1f29", cursor: "#bbbbbb",
        black: "#000000", brightBlack: "#555555",
        red: "#ff5555", brightRed: "#ff5555",
        green: "#50fa7b", brightGreen: "#50fa7b",
        yellow: "#f1fa8c", brightYellow: "#f1fa8c",
        blue: "#bd93f9", brightBlue: "#bd93f9",
        magenta: "#ff79c6", brightMagenta: "#ff79c6",
        cyan: "#8be9fd", brightCyan: "#8be9fd",
        white: "#bbbbbb", brightWhite: "#ffffff"
    },
    
    Gruvbox_Dark: {
        foreground: "#e6d4a3", background: "#1e1e1e", cursor: "#bbbbbb",
        black: "#161819", brightBlack: "#7f7061",
        red: "#f73028", brightRed: "#be0f17",
        green: "#aab01e", brightGreen: "#868715",
        yellow: "#f7b125", brightYellow: "#cc881a",
        blue: "#719586", brightBlue: "#377375",
        magenta: "#c77089", brightMagenta: "#a04b73",
        cyan: "#7db669", brightCyan: "#578e57",
        white: "#faefbb", brightWhite: "#e6d4a3"
    },
    
    Monokai_Soda: {
        foreground: "#c4c5b5", background: "#1a1a1a", cursor: "#f6f7ec",
        black: "#1a1a1a", brightBlack: "#625e4c",
        red: "#f4005f", brightRed: "#f4005f",
        green: "#98e024", brightGreen: "#98e024",
        yellow: "#fa8419", brightYellow: "#e0d561",
        blue: "#9d65ff", brightBlue: "#9d65ff",
        magenta: "#f4005f", brightMagenta: "#f4005f",
        cyan: "#58d1eb", brightCyan: "#58d1eb",
        white: "#c4c5b5", brightWhite: "#f6f6ef"
    },
    
    OneHalfDark: {
        foreground: "#dcdfe4", background: "#282c34", cursor: "#a3b3cc",
        black: "#282c34", brightBlack: "#282c34",
        red: "#e06c75", brightRed: "#e06c75",
        green: "#98c379", brightGreen: "#98c379",
        yellow: "#e5c07b", brightYellow: "#e5c07b",
        blue: "#61afef", brightBlue: "#61afef",
        magenta: "#c678dd", brightMagenta: "#c678dd",
        cyan: "#56b6c2", brightCyan: "#56b6c2",
        white: "#dcdfe4", brightWhite: "#dcdfe4"
    },
    
    OneHalfLight: {
        foreground: "#383a42", background: "#fafafa", cursor: "#bfceff",
        black: "#383a42", brightBlack: "#4f525e",
        red: "#e45649", brightRed: "#e06c75",
        green: "#50a14f", brightGreen: "#98c379",
        yellow: "#c18401", brightYellow: "#e5c07b",
        blue: "#0184bc", brightBlue: "#61afef",
        magenta: "#a626a4", brightMagenta: "#c678dd",
        cyan: "#0997b3", brightCyan: "#56b6c2",
        white: "#fafafa", brightWhite: "#ffffff"
    },
    
    Solarized_Dark: {
        foreground: "#708284", background: "#001e27", cursor: "#708284",
        black: "#002831", brightBlack: "#001e27",
        red: "#d11c24", brightRed: "#bd3613",
        green: "#738a05", brightGreen: "#475b62",
        yellow: "#a57706", brightYellow: "#536870",
        blue: "#2176c7", brightBlue: "#708284",
        magenta: "#c61c6f", brightMagenta: "#5956ba",
        cyan: "#259286", brightCyan: "#819090",
        white: "#eae3cb", brightWhite: "#fcf4dc"
    },
    
    Solarized_Light: {
        foreground: "#536870", background: "#fcf4dc", cursor: "#536870",
        black: "#002831", brightBlack: "#001e27",
        red: "#d11c24", brightRed: "#bd3613",
        green: "#738a05", brightGreen: "#475b62",
        yellow: "#a57706", brightYellow: "#536870",
        blue: "#2176c7", brightBlue: "#708284",
        magenta: "#c61c6f", brightMagenta: "#5956ba",
        cyan: "#259286", brightCyan: "#819090",
        white: "#eae3cb", brightWhite: "#fcf4dc"
    },
    
    SpaceGray: {
        foreground: "#b3b8c3", background: "#20242d", cursor: "#b3b8c3",
        black: "#000000", brightBlack: "#000000",
        red: "#b04b57", brightRed: "#b04b57",
        green: "#87b379", brightGreen: "#87b379",
        yellow: "#e5c179", brightYellow: "#e5c179",
        blue: "#7d8fa4", brightBlue: "#7d8fa4",
        magenta: "#a47996", brightMagenta: "#a47996",
        cyan: "#85a7a5", brightCyan: "#85a7a5",
        white: "#b3b8c3", brightWhite: "#ffffff"
    },
    
    Tomorrow: {
        foreground: "#4d4d4c", background: "#ffffff", cursor: "#4d4d4c",
        black: "#000000", brightBlack: "#000000",
        red: "#c82829", brightRed: "#c82829",
        green: "#718c00", brightGreen: "#718c00",
        yellow: "#eab700", brightYellow: "#eab700",
        blue: "#4271ae", brightBlue: "#4271ae",
        magenta: "#8959a8", brightMagenta: "#8959a8",
        cyan: "#3e999f", brightCyan: "#3e999f",
        white: "#ffffff", brightWhite: "#ffffff"
    },
    
    Tomorrow_Night: {
        foreground: "#c5c8c6", background: "#1d1f21", cursor: "#c5c8c6",
        black: "#000000", brightBlack: "#000000",
        red: "#cc6666", brightRed: "#cc6666",
        green: "#b5bd68", brightGreen: "#b5bd68",
        yellow: "#f0c674", brightYellow: "#f0c674",
        blue: "#81a2be", brightBlue: "#81a2be",
        magenta: "#b294bb", brightMagenta: "#b294bb",
        cyan: "#8abeb7", brightCyan: "#8abeb7",
        white: "#ffffff", brightWhite: "#ffffff"
    },
    
    Tomorrow_Night_Blue: {
        foreground: "#ffffff", background: "#002451", cursor: "#ffffff",
        black: "#000000", brightBlack: "#000000",
        red: "#ff9da4", brightRed: "#ff9da4",
        green: "#d1f1a9", brightGreen: "#d1f1a9",
        yellow: "#ffeead", brightYellow: "#ffeead",
        blue: "#bbdaff", brightBlue: "#bbdaff",
        magenta: "#ebbbff", brightMagenta: "#ebbbff",
        cyan: "#99ffff", brightCyan: "#99ffff",
        white: "#ffffff", brightWhite: "#ffffff"
    },
    
    Tomorrow_Night_Bright: {
        foreground: "#eaeaea", background: "#000000", cursor: "#eaeaea",
        black: "#000000", brightBlack: "#000000",
        red: "#d54e53", brightRed: "#d54e53",
        green: "#b9ca4a", brightGreen: "#b9ca4a",
        yellow: "#e7c547", brightYellow: "#e7c547",
        blue: "#7aa6da", brightBlue: "#7aa6da",
        magenta: "#c397d8", brightMagenta: "#c397d8",
        cyan: "#70c0b1", brightCyan: "#70c0b1",
        white: "#ffffff", brightWhite: "#ffffff"
    },
    
    Tomorrow_Night_Eighties: {
        foreground: "#cccccc", background: "#2d2d2d", cursor: "#cccccc",
        black: "#000000", brightBlack: "#000000",
        red: "#f2777a", brightRed: "#f2777a",
        green: "#99cc99", brightGreen: "#99cc99",
        yellow: "#ffcc66", brightYellow: "#ffcc66",
        blue: "#6699cc", brightBlue: "#6699cc",
        magenta: "#cc99cc", brightMagenta: "#cc99cc",
        cyan: "#66cccc", brightCyan: "#66cccc",
        white: "#ffffff", brightWhite: "#ffffff"
    },
    
    Ubuntu: {
        foreground: "#eeeeec", background: "#300a24", cursor: "#bbbbbb",
        black: "#2e3436", brightBlack: "#555753",
        red: "#cc0000", brightRed: "#ef2929",
        green: "#4e9a06", brightGreen: "#8ae234",
        yellow: "#c4a000", brightYellow: "#fce94f",
        blue: "#3465a4", brightBlue: "#729fcf",
        magenta: "#75507b", brightMagenta: "#ad7fa8",
        cyan: "#06989a", brightCyan: "#34e2e2",
        white: "#d3d7cf", brightWhite: "#eeeeec"
    },
    
    Zenburn: {
        foreground: "#dcdccc", background: "#3f3f3f", cursor: "#73635a",
        black: "#4d4d4d", brightBlack: "#709080",
        red: "#705050", brightRed: "#dca3a3",
        green: "#60b48a", brightGreen: "#c3bf9f",
        yellow: "#f0dfaf", brightYellow: "#e0cf9f",
        blue: "#506070", brightBlue: "#94bff3",
        magenta: "#dc8cc3", brightMagenta: "#ec93d3",
        cyan: "#8cd0d3", brightCyan: "#93e0e3",
        white: "#dcdccc", brightWhite: "#ffffff"
    },
    
    JetBrains_Darcula: {
        foreground: "#adadad", background: "#1b1c1d", cursor: "#cdcdcd",
        black: "#242526", brightBlack: "#5fac6d",
        red: "#f8511b", brightRed: "#f74319",
        green: "#565747", brightGreen: "#74ec4c",
        yellow: "#fa771d", brightYellow: "#fdc325",
        blue: "#2c70b7", brightBlue: "#3393ca",
        magenta: "#f02e4f", brightMagenta: "#e75e4f",
        cyan: "#3ca1a6", brightCyan: "#4fbce6",
        white: "#adadad", brightWhite: "#8c735b"
    },
    
    Seti: {
        foreground: "#cacecd", background: "#111213", cursor: "#e3bf21",
        black: "#323232", brightBlack: "#323232",
        red: "#c22832", brightRed: "#c22832",
        green: "#8ec43d", brightGreen: "#8ec43d",
        yellow: "#e0c64f", brightYellow: "#e0c64f",
        blue: "#43a5d5", brightBlue: "#43a5d5",
        magenta: "#8b57b5", brightMagenta: "#8b57b5",
        cyan: "#8ec43d", brightCyan: "#8ec43d",
        white: "#eeeeee", brightWhite: "#ffffff"
    },
    
    Molokai: {
        foreground: "#bbbbbb", background: "#121212", cursor: "#bbbbbb",
        black: "#121212", brightBlack: "#555555",
        red: "#fa2573", brightRed: "#f6669d",
        green: "#98e123", brightGreen: "#b1e05f",
        yellow: "#dfd460", brightYellow: "#fff26d",
        blue: "#1080d0", brightBlue: "#00afff",
        magenta: "#8700ff", brightMagenta: "#af87ff",
        cyan: "#43a8d0", brightCyan: "#51ceff",
        white: "#bbbbbb", brightWhite: "#ffffff"
    },
    
    Material: {
        foreground: "#e5e5e5", background: "#232322", cursor: "#16afca",
        black: "#212121", brightBlack: "#424242",
        red: "#b7141f", brightRed: "#e83b3f",
        green: "#457b24", brightGreen: "#7aba3a",
        yellow: "#f6981e", brightYellow: "#ffea2e",
        blue: "#134eb2", brightBlue: "#54a4f3",
        magenta: "#560088", brightMagenta: "#aa4dbc",
        cyan: "#0e717c", brightCyan: "#26bbd1",
        white: "#efefef", brightWhite: "#d9d9d9"
    },
    
    ayu: {
        foreground: "#e6e1dc", background: "#2b2b2b", cursor: "#ffffff",
        black: "#000000", brightBlack: "#323232",
        red: "#da4939", brightRed: "#ff7b6b",
        green: "#519f50", brightGreen: "#83d182",
        yellow: "#ffd24a", brightYellow: "#ffff7c",
        blue: "#6d9cbe", brightBlue: "#9fcef0",
        magenta: "#d0d0ff", brightMagenta: "#ffffff",
        cyan: "#6e9cbe", brightCyan: "#a0cef0",
        white: "#ffffff", brightWhite: "#ffffff"
    }
};

// Export for use in terminal
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NeoTerminalThemes;
}

// Usage: window.theme = NeoTerminalThemes.Dracula;
