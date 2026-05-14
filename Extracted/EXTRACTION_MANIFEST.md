# NeoServer Extraction - Complete Structure

## Overview
This extraction contains the **NeoEditor** (code editor) and **xterm.js Terminal** components extracted from NeoServer.app.

---

## 📁 Directory Structure

```
Extracted/
├── Editor/                    # Code Editor Component
│   ├── index.html            # Main editor HTML entry point
│   ├── main.js               # Editor JavaScript bundle (needs extraction from app)
│   ├── fonts/                # Monospace fonts for editor
│   │   ├── DejaVuSansMonoPowerline-Bold.ttf
│   │   ├── DejaVuSansMonoPowerline.ttf
│   │   ├── FiraCodeNerdFontCompleteMono-Regular.ttf
│   │   ├── Hack-Bold.ttf
│   │   ├── Hack-Regular.ttf
│   │   ├── JetBrainsMonoNerdFontCompleteMono-Regular.ttf
│   │   ├── UbuntuMonoPowerline-Bold.ttf
│   │   ├── UbuntuMonoPowerline-Regular.ttf
│   │   ├── SourceCodeProPowerline-Bold.otf
│   │   └── SourceCodeProPowerline-Regular.otf
│   ├── themes/               # Editor themes (Runestone framework)
│   │   ├── TomorrowNight/    # Dark theme
│   │   └── Tomorrow/         # Light theme
│   ├── languages/            # TreeSitter syntax highlighting
│   │   ├── bash.bundle/
│   │   ├── c.bundle/
│   │   ├── cpp.bundle/
│   │   ├── csharp.bundle/
│   │   ├── css.bundle/
│   │   ├── go.bundle/
│   │   ├── html.bundle/
│   │   ├── java.bundle/
│   │   ├── javascript.bundle/
│   │   ├── json.bundle/
│   │   ├── lua.bundle/
│   │   ├── markdown.bundle/
│   │   ├── objectivec.bundle/
│   │   ├── perl.bundle/
│   │   ├── php.bundle/
│   │   ├── python.bundle/
│   │   ├── ruby.bundle/
│   │   ├── rust.bundle/
│   │   ├── sql.bundle/
│   │   ├── swift.bundle/
│   │   ├── tsx.bundle/
│   │   ├── typescript.bundle/
│   │   ├── xml.bundle/
│   │   └── yaml.bundle/
│   └── plugins/              # Editor plugins
│       └── SymbolPicker.bundle/
│
└── Terminal/                  # xterm.js Terminal Component
    ├── index.html            # Terminal HTML entry point
    ├── server_terminal.js    # Main terminal bundle (React + xterm.js + 100+ themes)
    ├── 473.server_terminal.js # xterm.js addons (Canvas, Fit, WebLinks, Terminal core)
    ├── bell.m4a              # Terminal bell sound
    └── fonts/                # Terminal fonts (same as editor)
        └── [same font files as Editor/fonts/]
```

---

## 🔧 Component Details

### Editor Component (Runestone Framework)

**Core Framework:**
- `Runestone_Runestone.bundle` - Main text editor framework with:
  - Syntax highlighting engine
  - Text rendering and layout
  - Cursor management and selection
  - Undo/redo functionality
  - Line numbers and gutter
  - Scrolling and viewport management

**Themes:**
- `RunestoneTomorrowNightTheme.bundle` - Tomorrow Night dark theme
- `RunestoneTomorrowTheme.bundle` - Tomorrow light theme

**Language Support (TreeSitter):**
All language bundles provide:
- Syntax parsing and highlighting
- Code folding
- Bracket matching
- Indentation rules

**Fonts Included:**
1. **DejaVu Sans Mono Powerline** - Classic monospace with Powerline glyphs
2. **Fira Code Nerd Font** - Programming ligatures + Nerd Font icons
3. **JetBrains Mono Nerd Font** - JetBrains' programming font + icons
4. **Ubuntu Mono Powerline** - Ubuntu's monospace with Powerline
5. **Hack** - Source code typeface
6. **Source Code Pro Powerline** - Adobe's source code font

**Plugins:**
- `SymbolPicker.bundle` - Symbol/emoji picker plugin

---

### Terminal Component (xterm.js)

**Core Files:**

1. **server_terminal.js** - Main webpack bundle containing:
   - React 18.2.0 UI framework
   - Tab view management system
   - xterm.js CSS styles
   - **100+ Terminal Themes** including:
     - Night 3024, AdventureTime, Afterglow, AlienBlood
     - Argonaut, Arthur, AtelierSulphurpool, Atom
     - Batman, Belafonte Night, BirdsOfParadise, Blazer
     - Borland, Bright Lights, Broadcast, Brogrammer
     - C64, Chalk, Chalkboard, Ciapre, Cobalt2
     - Cobalt Neon, CrayonPonyFish, Dark Pastel, Darkside
     - Desert, DimmedMonokai, DotGov, **Dracula**
     - Duotone Dark, ENCOM, Earthsong, Elemental
     - Elementary, Espresso, Espresso Libre, Fideloper
     - FirefoxDev, Firewatch, FishTank, Flat, Flatland
     - Floraverse, ForestBlue, FrontEndDelight, FunForrest
     - Galaxy, Github, Glacier, Grape, Grass
     - **Gruvbox Dark**, Hardcore, Harper, Highway
     - Hipster Green, Homebrew, Hurtado, Hybrid
     - IC Green PPL, IC Orange PPL, IR Black
     - Jackie Brown, Japanesque, Jellybeans
     - **JetBrains Darcula**, Kibble, Later This Evening
     - Lavandula, LiquidCarbon, Man Page
     - **Material**, MaterialDark, Mathias, Medallion
     - Misterioso, **Molokai**, MonaLisa
     - Monokai Soda, Monokai Vivid, N0tch2k
     - Neopolitan, Neutron, NightLion v1/v2, Novel
     - Obsidian, Ocean, OceanicMaterial, Ollie
     - **OneHalfDark**, OneHalfLight, Pandora
     - Paraiso Dark, PaulMillr, PencilDark/Light
     - Piatto Light, Pnevma, Pro, Red Alert, Red Sands
     - Rippedcasts, Royal, Ryuuko, SeaShells
     - Seafoam Pastel, **Seti**, Shaman, Slate, Smyck
     - SoftServer, Solarized Darcula, **Solarized Dark**
     - Solarized Dark Higher Contrast, Solarized Light
     - **SpaceGray**, SpaceGray Eighties, Spacedust
     - Spiderman, Spring, Square, Sundried, Symfonic
     - Teerb, Terminal Basic, Thayer Bright, The Hulk
     - **Tomorrow**, Tomorrow Night, Tomorrow Night Blue
     - Tomorrow Night Bright, Tomorrow Night Eighties
     - ToyChest, Treehouse, **Ubuntu**, UnderTheSea
     - Urple, Vaughn, VibrantInk, Violet Dark/Light
     - WarmNeon, Wez, WildCherry, Wombat, Wryan
     - **Zenburn**, ayu, deep, idleToes

2. **473.server_terminal.js** - xterm.js addons:
   - `CanvasAddon` - GPU-accelerated canvas rendering
   - `FitAddon` - Auto-fit terminal to container
   - `WebLinksAddon` - Clickable web links
   - `Terminal` - Core xterm.js terminal class
   - Full terminal emulation (VT100/VT220/VT500)
   - Unicode support (v6)
   - Mouse events and scrolling
   - Bracketed paste mode
   - 256-color and true color support
   - Cursor styles (block, underline, bar, outline)
   - Selection and copy/paste
   - Accessibility support (screen reader mode)

**Terminal Features:**
- WebSocket connectivity (`ws://localhost:8089/ws`)
- Resize handling with FitAddon
- Theme switching via URL parameter (`?theme=Dracula`)
- Font size configuration (`?fontSize=14`)
- Double-click event handling
- Line content retrieval (`getLineBeforeCursor()`)
- Terminal resize notifications

---

## 🚀 Usage Instructions

### Editor
1. Copy all `.bundle` directories from `NeoServer.app` to `Editor/`
2. Copy all font files to `Editor/fonts/`
3. Extract `main.js` from the app bundle
4. Open `index.html` in a browser

### Terminal
1. Copy font files to `Terminal/fonts/`
2. Copy `bell.m4a` to `Terminal/`
3. Open `index.html` in a browser
4. Configure WebSocket endpoint in `server_terminal.js`

### URL Parameters (Terminal)
- `?theme=Dracula` - Set terminal theme
- `?fontSize=16` - Set font size

---

## 📋 Files to Copy Manually

These binary files need to be copied from `NeoServer.app`:

### Editor Bundles:
```
Runestone_Runestone.bundle/
RunestoneThemes_RunestoneTomorrowNightTheme.bundle/
RunestoneThemes_RunestoneTomorrowTheme.bundle/
SymbolPicker_SymbolPicker.bundle/
TreeSitterLanguages_*.bundle/ (all 24 language bundles)
```

### Terminal:
```
bell.m4a
```

### Fonts (copy to both Editor/fonts/ and Terminal/fonts/):
```
DejaVuSansMonoPowerline-Bold.ttf
DejaVuSansMonoPowerline.ttf
FiraCodeNerdFontCompleteMono-Regular.ttf
Hack-Bold.ttf
Hack-Regular.ttf
JetBrainsMonoNerdFontCompleteMono-Regular.ttf
UbuntuMonoPowerline-Bold.ttf
UbuntuMonoPowerline-Regular.ttf
SourceCodeProPowerline-Bold.otf
SourceCodeProPowerline-Regular.otf
```

---

## 🔑 Key Features Extracted

### Editor:
- ✅ Full code editing with syntax highlighting
- ✅ 24 programming languages supported
- ✅ Dark and light themes
- ✅ 6 monospace font families
- ✅ Symbol picker plugin
- ✅ Line numbers and gutter
- ✅ Code folding and bracket matching
- ✅ Undo/redo functionality
- ✅ Viewport scrolling management

### Terminal:
- ✅ Full xterm.js terminal emulation
- ✅ 100+ color themes
- ✅ GPU-accelerated canvas rendering
- ✅ Auto-fit to container
- ✅ Clickable web links
- ✅ WebSocket connectivity
- ✅ Unicode and emoji support
- ✅ Mouse events and scrolling
- ✅ 256-color and true color
- ✅ Multiple cursor styles
- ✅ Selection and copy/paste
- ✅ Accessibility support
- ✅ Terminal bell sound
- ✅ 6 monospace font families

---

## 📝 Notes

- The editor uses the **Runestone** text editor framework (iOS/macOS native)
- The terminal uses **xterm.js** with React wrapper
- Both components share the same font collection
- Terminal themes are embedded in `server_terminal.js` as JavaScript objects
- Editor themes are in Apple's `.car` asset catalog format
- Language bundles contain compiled TreeSitter parsers (`.wasm` files)
