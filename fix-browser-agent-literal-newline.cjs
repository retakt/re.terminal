const fs = require("fs");

const file = "server/lib/browser-agent.js";
let s = fs.readFileSync(file, "utf8");

const bad = `  if (!useExtensions) return executeGenericVisibleAction(args, state, steps);\\n  const observationResult = await observePage(args, state);`;

const good = `  if (!useExtensions) return executeGenericVisibleAction(args, state, steps);
  const observationResult = await observePage(args, state);`;

if (!s.includes(bad)) {
  console.log("Exact bad line not found. Trying regex fallback...");
  s = s.replace(
    /(if \(!useExtensions\) return executeGenericVisibleAction\(args, state, steps\);)\\n\s*(const observationResult = await observePage\(args, state\);)/,
    "$1\n  $2"
  );
} else {
  s = s.replace(bad, good);
}

fs.writeFileSync(file, s, "utf8");
console.log("fixed literal newline in browser-agent.js");
