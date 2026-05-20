const fs = require("fs");

const file = "server/lib/lightpanda-client.js";
let src = fs.readFileSync(file, "utf8");

const helper = `
async function evaluateBasicSnapshot(session, sid) {
  const expression = \`(() => {
    const pick = (value, limit = 240) => String(value || "").replace(/\\\\s+/g, " ").trim().slice(0, limit);
    const safeUrl = () => {
      try { return location.href || ""; } catch { return ""; }
    };
    const safeTitle = () => {
      try { return document.title || ""; } catch { return ""; }
    };
    const textFromBody = () => {
      try {
        return pick(document.body ? (document.body.innerText || document.body.textContent || "") : "", 2400);
      } catch {
        return "";
      }
    };
    const links = (() => {
      try {
        return Array.from(document.querySelectorAll("a[href]")).slice(0, 80).map((a, index) => ({
          index,
          text: pick(a.innerText || a.textContent || a.getAttribute("aria-label") || a.href, 180),
          href: a.href || a.getAttribute("href") || "",
          selector: a.id ? "#" + a.id : ""
        }));
      } catch {
        return [];
      }
    })();
    const buttons = (() => {
      try {
        return Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']")).slice(0, 80).map((button, index) => ({
          index,
          text: pick(button.innerText || button.textContent || button.getAttribute("aria-label") || button.value || button.name, 180),
          selector: button.id ? "#" + button.id : "",
          tag: button.tagName ? button.tagName.toLowerCase() : "",
          type: button.getAttribute ? (button.getAttribute("type") || "") : ""
        }));
      } catch {
        return [];
      }
    })();
    const forms = (() => {
      try {
        return Array.from(document.querySelectorAll("form")).slice(0, 20).map((form, index) => ({
          index,
          action: form.action || "",
          method: form.method || "get",
          selector: form.id ? "#" + form.id : "",
          fields: Array.from(form.querySelectorAll("input, textarea, select")).slice(0, 40).map((field, fieldIndex) => ({
            index: fieldIndex,
            name: field.getAttribute("name") || "",
            id: field.getAttribute("id") || "",
            type: field.getAttribute("type") || field.tagName.toLowerCase(),
            placeholder: field.getAttribute("placeholder") || "",
            ariaLabel: field.getAttribute("aria-label") || "",
            selector: field.id ? "#" + field.id : "",
            secret: /password/i.test(field.getAttribute("type") || "")
          }))
        }));
      } catch {
        return [];
      }
    })();

    return {
      url: safeUrl(),
      title: safeTitle(),
      text: textFromBody(),
      textPreview: textFromBody(),
      links,
      buttons,
      inputs: forms.flatMap((form) => form.fields || []),
      forms,
      interactiveElements: [
        ...buttons.map((button) => ({ ...button, role: "button" })),
        ...links.map((link) => ({ ...link, role: "link", tag: "a" }))
      ],
      stats: {
        links: links.length,
        buttons: buttons.length,
        forms: forms.length,
        inputs: forms.flatMap((form) => form.fields || []).length
      },
      fallback: "basic"
    };
  })()\`;

  try {
    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false,
    }, 3500, sid);

    return evaluated?.result?.value || {
      url: "",
      title: "",
      text: "",
      textPreview: "",
      links: [],
      buttons: [],
      inputs: [],
      forms: [],
      interactiveElements: [],
      stats: {},
      fallback: "basic-empty"
    };
  } catch (err) {
    return {
      url: "",
      title: "",
      text: "",
      textPreview: "Lightpanda could not evaluate page DOM: " + (err instanceof Error ? err.message : String(err)),
      links: [],
      buttons: [],
      inputs: [],
      forms: [],
      interactiveElements: [],
      stats: {},
      fallback: "basic-error",
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
`;

if (!src.includes("async function evaluateBasicSnapshot(session, sid)")) {
  const marker = "async function evaluateSemanticSnapshot(session, sid) {";
  if (!src.includes(marker)) throw new Error("Could not find evaluateSemanticSnapshot marker");
  src = src.replace(marker, helper + "\n" + marker);
  console.log("inserted evaluateBasicSnapshot");
} else {
  console.log("evaluateBasicSnapshot already present");
}

const oldBlock = `export async function lightpandaSnapshotCurrent(args = {}) {
  const page = await withCurrentPage(async (session, sid, target) => {
    const snapshot = await evaluateSemanticSnapshot(session, sid);
    return {
      ok: true,
      action: "snapshot",
      target: {
        targetId: target.targetId,
        created: target.created,
        selectedUrl: target.selectedUrl,
        requestedUrl: target.requestedUrl,
      },
      page: snapshot,
    };
  }, args);

  return page;
}`;

const newBlock = `export async function lightpandaSnapshotCurrent(args = {}) {
  const page = await withCurrentPage(async (session, sid, target) => {
    let snapshot;
    let snapshotError = "";

    try {
      snapshot = await evaluateSemanticSnapshot(session, sid);
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : String(err);
      snapshot = await evaluateBasicSnapshot(session, sid);
    }

    return {
      ok: true,
      action: "snapshot",
      target: {
        targetId: target.targetId,
        created: target.created,
        selectedUrl: target.selectedUrl,
        requestedUrl: target.requestedUrl,
      },
      snapshotError,
      page: snapshot,
    };
  }, args);

  return page;
}`;

if (!src.includes(oldBlock)) {
  console.log("exact lightpandaSnapshotCurrent block not found; trying regex");
  src = src.replace(
    /export async function lightpandaSnapshotCurrent\\(args = \\{\\}\\) \\{[\\s\\S]*?\\n\\}/,
    newBlock
  );
} else {
  src = src.replace(oldBlock, newBlock);
}

fs.writeFileSync(file, src, "utf8");
console.log("patched safe Lightpanda snapshot fallback");
