const fs = require("fs");

const file = "server/lib/browser-agent.js";
let s = fs.readFileSync(file, "utf8");

const oldLine = `  if (/\\b(execute|click|open|go to|navigate to|perform|run)\\b/.test(lower)) return "execute_action";`;

const newLine = `  if (/\\b(execute|click|clicking|press|tap|select|choose|open|go to|navigate to|perform|run)\\b/.test(lower) || /\\btry\\s+clicking\\b/.test(lower)) return "execute_action";`;

if (!s.includes(oldLine)) {
  console.log("old classifier line not found. Showing current execute_action lines:");
  console.log(
    s.split("\\n")
      .filter((line) => line.includes("execute_action"))
      .join("\\n")
  );
  process.exit(1);
}

s = s.replace(oldLine, newLine);
fs.writeFileSync(file, s, "utf8");
console.log("patched clicking classifier");
