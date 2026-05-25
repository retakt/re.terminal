import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const debugDir = path.join(root, "server");
const imageDir = path.join(root, "server", ".playwright-mcp");

function latestFile(dir, re) {
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir)
    .filter((name) => re.test(name))
    .map((name) => {
      const filePath = path.join(dir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || "";
}

function walk(value, out = []) {
  if (!value || typeof value !== "object") return out;
  out.push(value);
  for (const item of Object.values(value)) walk(item, out);
  return out;
}

function short(value, n = 140) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

const args = process.argv.slice(2);
const shouldOpen = args.includes("--open");
const traceArg = args.find((arg) => arg !== "--open");

const traceFile = traceArg || latestFile(debugDir, /^debug-browser-agent-.*\.json$/);
if (!traceFile) {
  console.error("No debug-browser-agent JSON found.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(traceFile, "utf8"));
const all = walk(data);

console.log("\n=== TRACE FILE ===");
console.log(traceFile);

console.log("\n=== RESULT ===");
console.table([{
  ok: data.ok,
  status: data.status,
  summary: short(data.summary, 220),
  url: short(data.currentUrl, 120),
}]);

console.log("\n=== STEPS ===");
console.table((data.sequence?.items || []).map((step) => ({
  step: step.index + 1,
  ok: step.ok,
  status: step.status,
  action: step.instruction,
  summary: short(step.summary, 180),
})));

const fields = [];
for (const obj of all) {
  const arrays = [obj.fields, obj.requestedValues, obj.filled].filter(Array.isArray);
  for (const arr of arrays) {
    for (const field of arr) {
      fields.push({
        actionId: field.actionId || "",
        label: field.label || "",
        name: field.name || "",
        selector: field.selector || "",
        value: field.value || "",
        expected: field.expected || "",
        actual: field.actual || "",
      });
    }
  }
}

console.log("\n=== FIELDS / READBACK ===");
console.table(fields.length ? fields : [{ note: "No field/readback objects found in structured JSON" }]);

const failures = [];
for (const obj of all) {
  if (Array.isArray(obj.missing) && obj.missing.length) {
    failures.push({
      kind: "missing",
      value: JSON.stringify(obj.missing).slice(0, 240),
    });
  }
  if (obj.expected !== undefined || obj.actual !== undefined) {
    if (String(obj.expected ?? "") !== String(obj.actual ?? "")) {
      failures.push({
        kind: "mismatch",
        label: obj.label || obj.actionId || "",
        expected: obj.expected ?? "",
        actual: obj.actual ?? "",
      });
    }
  }
}

console.log("\n=== FAILURES ===");
console.table(failures.length ? failures : [{ status: "No mismatch/missing fields found" }]);

const jsonText = JSON.stringify(data);
const imagePathsInJson = [...jsonText.matchAll(/server[\\/]\.playwright-mcp[\\/][^"'\\\s]+?\.(?:png|jpg|jpeg|webp)/gi)]
  .map((m) => m[0]);

const latestImage = latestFile(imageDir, /\.(png|jpe?g|webp)$/i);

console.log("\n=== SCREENSHOTS ===");
console.table([{
  imageInJson: imagePathsInJson[0] || "",
  latestDiskImage: latestImage || "",
}]);

if (shouldOpen && latestImage) {
  const cyg = spawnSync("cygpath", ["-w", latestImage], { encoding: "utf8" });
  const winPath = cyg.status === 0 ? cyg.stdout.trim() : latestImage;
  spawnSync("explorer.exe", [winPath], { stdio: "ignore" });
}
