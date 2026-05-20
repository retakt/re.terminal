let lastJson = "";

const inspectBtn = document.getElementById("inspect");
const copyBtn = document.getElementById("copy");
const downloadBtn = document.getElementById("download");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

function isEzhrmUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "ezhrmsys.com" || host.endsWith(".ezhrmsys.com");
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function inspectPage() {
  setStatus("Inspecting page...");
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  sendBtn.disabled = true;
  lastJson = "";

  const tab = await getActiveTab();

  if (!tab?.id || !tab.url) {
    setStatus("No active tab found.");
    return;
  }

  if (!isEzhrmUrl(tab.url)) {
    setStatus("This extension only works on ezhrmsys.com pages.");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "EZHRM_COLLECT_PAGE_SKILL"
    });

    if (!response?.ok) {
      setStatus(response?.error || "Failed to inspect page.");
      return;
    }

    lastJson = JSON.stringify(response.observation, null, 2);

    const counts = response.observation.counts;
    setStatus(
      [
        "Captured page.",
        "",
        `URL: ${response.observation.page.url}`,
        `Title: ${response.observation.page.title}`,
        "",
        `Forms: ${counts.forms}`,
        `Fields: ${counts.fields}`,
        `Buttons: ${counts.buttons}`,
        `Links: ${counts.links}`,
        `Tables: ${counts.tables}`
      ].join("\n")
    );

    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    sendBtn.disabled = false;
  } catch (err) {
    setStatus(
      "Could not talk to the page content script.\n\nReload the EZHRM tab and try again.\n\n" +
      (err instanceof Error ? err.message : String(err))
    );
  }
}
async function sendToReterm() {
  if (!lastJson) return;

  setStatus("Sending observation to Re.Term...");

  const response = await fetch("http://localhost:3003/api/ezhrm-skill/import-observation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      observation: JSON.parse(lastJson)
    })
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    setStatus(data.error || "Failed to import observation.");
    return;
  }

  setStatus(
    [
      "Imported into Re.Term.",
      "",
      `File: ${data.file}`,
      `Page key: ${data.pageKey}`,
      "",
      `Forms: ${data.imported.forms}`,
      `Fields: ${data.imported.fields}`,
      `Visible buttons: ${data.imported.visibleButtons}`,
      `Visible links: ${data.imported.visibleLinks}`,
      `Actions added/found: ${data.imported.actions}`
    ].join("\n")
  );
}

async function copyJson() {
  if (!lastJson) return;
  await navigator.clipboard.writeText(lastJson);
  setStatus("Copied JSON to clipboard.");
}

function downloadJson() {
  if (!lastJson) return;

  const blob = new Blob([lastJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: `ezhrm-page-observation-${Date.now()}.json`,
    saveAs: true
  });
}

inspectBtn.addEventListener("click", inspectPage);
copyBtn.addEventListener("click", copyJson);
downloadBtn.addEventListener("click", downloadJson);
sendBtn.addEventListener("click", () => {
  sendToReterm().catch((err) => {
    setStatus(err instanceof Error ? err.message : String(err));
  });
});
