import os
import sys
import shutil
import subprocess

# Auto-install jsbeautifier if not present
try:
    import jsbeautifier
except ImportError:
    print("📦 Installing jsbeautifier (first run only)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "jsbeautifier"])
    import jsbeautifier

SOURCE_APP = r"C:\Users\re_Lax\Desktop\NeoServer\Payload\NeoServer.app"
BASE_DIR   = r"C:\Users\re_Lax\Desktop\NeoServer\Extracted"

# 1️⃣ Create clean directory structure
for folder in ["Terminal/fonts", "Terminal", "Editor/fonts", "Editor"]:
    os.makedirs(os.path.join(BASE_DIR, folder), exist_ok=True)

# 2️⃣ Font files to extract
fonts = [
    "DejaVuSansMonoPowerline-Bold.ttf", "DejaVuSansMonoPowerline.ttf",
    "FiraCodeNerdFontCompleteMono-Regular.ttf",
    "JetBrainsMonoNerdFontCompleteMono-Regular.ttf",
    "UbuntuMonoPowerline-Bold.ttf", "UbuntuMonoPowerline-Regular.ttf",
    "Hack-Bold.ttf", "Hack-Regular.ttf",
    "SourceCodeProPowerline-Regular.otf", "SourceCodeProPowerline-Bold.otf"
]

print("📦 Copying fonts to Terminal & Editor...")
for font in fonts:
    src = os.path.join(SOURCE_APP, font)
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(BASE_DIR, "Terminal/fonts", font))
        shutil.copy2(src, os.path.join(BASE_DIR, "Editor/fonts", font))
        print(f"  ✅ {font}")

# 3️⃣ Extract & Format JavaScript files
print("\n🔧 Formatting JavaScript bundles...")
js_files = ["server_terminal.js", "473.server_terminal.js"]

for js in js_files:
    src_js = os.path.join(SOURCE_APP, js)
    if not os.path.exists(src_js):
        continue

    with open(src_js, "r", encoding="utf-8", errors="ignore") as f:
        minified = f.read()

    # Configure beautifier for modern React/JS
    opts = jsbeautifier.default_options()
    opts.indent_size = 2
    opts.preserve_newlines = True
    opts.max_preserve_newlines = 15
    opts.space_in_empty_paren = False
    opts.break_chained_methods = True
    opts.wrap_line_length = 0  # Keep logical lines intact

    formatted = jsbeautifier.beautify(minified, opts)

    out_name = js.replace(".js", "_formatted.js")
    dest_js  = os.path.join(BASE_DIR, "Terminal", out_name)
    with open(dest_js, "w", encoding="utf-8") as f:
        f.write(formatted)

    print(f"  ✅ {out_name} ({os.path.getsize(dest_js) / 1024:.1f} KB)")

# 4️⃣ Final message
print("\n✅ Extraction & Formatting Complete!")
print(f"📂 Open terminal: {BASE_DIR}\\Terminal\\index.html")
print("📝 Formatted JS files have `_formatted` suffix.")