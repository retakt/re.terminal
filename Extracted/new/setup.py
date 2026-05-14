import os
import re
import requests
import json

# The URL you provided
URL = "https://raw.githubusercontent.com/retakt/re.terminal/43598fd5b60f7d7d69b2b0deb57046fdf586a9b8/Extracted/Terminal/server_terminal_formatted.js"
OUTPUT_DIR = "Terminal_Web_Build"
JS_FILE_NAME = "server_terminal.js"

def ensure_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def download_js():
    print("🌐 Downloading formatted JS bundle...")
    try:
        response = requests.get(URL)
        response.raise_for_status()
        with open(os.path.join(OUTPUT_DIR, JS_FILE_NAME), 'w', encoding='utf-8') as f:
            f.write(response.text)
        print(f"✅ Downloaded ({len(response.text)} chars)")
        return response.text
    except Exception as e:
        print(f"❌ Download failed: {e}")
        # Try to read local file if download fails
        if os.path.exists(JS_FILE_NAME):
            with open(JS_FILE_NAME, 'r', encoding='utf-8') as f:
                return f.read()
        return None

def extract_themes(code):
    """Extracts theme objects like { name: { fg, bg, ... } }"""
    themes = {}
    # Regex to find key: { ... content with fg/bg ... }
    # This is safer than complex nested regexes
    theme_pattern = re.compile(r'(?:"?(\w+)"?)\s*:\s*({[^{}]*?(?:fg|background|foreground)[^{}]*})', re.IGNORECASE)
    
    for match in theme_pattern.finditer(code):
        name = match.group(1)
        body = match.group(2)
        # Clean up the body slightly
        if 'fg' in body.lower() or 'bg' in body.lower():
            themes[name] = body
    return themes

def generate_html(themes_count):
    """Generates the HTML wrapper with React CDNs"""
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
    <title>NeoTerminal (Extracted)</title>
    <style>
        body, html {{ margin: 0; padding: 0; height: 100%; overflow: hidden; background: #000; }}
        #root {{ height: 100%; width: 100%; }}
    </style>
    <!-- React 18 Production CDN -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
</head>
<body>
    <div id="root"></div>
    <!-- The extracted bundle -->
    <script src="./{JS_FILE_NAME}"></script>
</body>
</html>
"""
    with open(os.path.join(OUTPUT_DIR, "index.html"), "w") as f:
        f.write(html_content)
    print(f"✅ Generated index.html (Includes {themes_count} themes in JS)")

def analyze_code(code):
    """Simple analysis to report what was found"""
    lines = code.split('\n')
    react_count = len(re.findall(r'React\.createElement', code))
    xterm_count = len(re.findall(r'xterm', code, re.IGNORECASE))
    theme_count = len(re.findall(r'fg\s*:\s*"#', code)) # Approx count
    
    print(f"🔍 Analysis Complete:")
    print(f"   • React Components: {react_count}")
    print(f"   • xterm.js References: {xterm_count}")
    print(f"   • Theme Definitions: ~{theme_count}")
    
    return theme_count

def main():
    ensure_dir()
    code = download_js()
    
    if not code:
        print("❌ Cannot proceed without the JS file.")
        return

    print("🔍 Analyzing bundle structure...")
    theme_count = analyze_code(code)
    
    print("🛠️  Generating web runner...")
    generate_html(theme_count)
    
    print("\n🎉 Done! Open 'Terminal_Web_Build\\index.html' in your browser.")
    print("⚠️  Note: This is the Frontend only. It requires the native iOS WebSocket server (localhost:8089) to function.")

if __name__ == "__main__":
    main()