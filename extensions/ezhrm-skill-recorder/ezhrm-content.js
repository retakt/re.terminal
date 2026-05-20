(() => {
  function text(value, limit = 200) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function selectorFor(el) {
    if (!el) return "";

    if (el.id) return `#${CSS.escape(el.id)}`;

    if (el.name) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    }

    const aria = el.getAttribute("aria-label");
    if (aria) {
      return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
    }

    let current = el;
    const parts = [];

    while (current && current !== document.body && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName.toLowerCase() === tag
      );

      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = parent;
    }

    return parts.join(" > ");
  }

  function fieldInfo(el, index) {
    const type = el.getAttribute("type") || el.tagName.toLowerCase();

    return {
      index,
      tag: el.tagName.toLowerCase(),
      type,
      name: el.getAttribute("name") || "",
      id: el.getAttribute("id") || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      required: el.hasAttribute("required"),
      visible: isVisible(el),
      secret: /password|pass/i.test(
        `${type} ${el.name || ""} ${el.id || ""} ${el.placeholder || ""}`
      ),
      selector: selectorFor(el),
      valueCaptured: false
    };
  }

  function buttonInfo(el, index) {
    return {
      index,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      text: text(el.innerText || el.textContent || el.value || el.getAttribute("aria-label")),
      id: el.getAttribute("id") || "",
      name: el.getAttribute("name") || "",
      visible: isVisible(el),
      selector: selectorFor(el)
    };
  }

  function linkInfo(el, index) {
    return {
      index,
      text: text(el.innerText || el.textContent || el.getAttribute("aria-label")),
      href: el.href || "",
      visible: isVisible(el),
      selector: selectorFor(el)
    };
  }

  function formInfo(form, index) {
    const fields = Array.from(form.querySelectorAll("input, textarea, select")).map(fieldInfo);
    const buttons = Array.from(
      form.querySelectorAll("button, input[type='submit'], input[type='button']")
    ).map(buttonInfo);

    return {
      index,
      action: form.action || "",
      method: form.method || "",
      id: form.id || "",
      name: form.getAttribute("name") || "",
      visible: isVisible(form),
      selector: selectorFor(form),
      fields,
      buttons
    };
  }

  function collectObservation() {
    const forms = Array.from(document.querySelectorAll("form")).map(formInfo);
    const fields = Array.from(document.querySelectorAll("input, textarea, select")).map(fieldInfo);
    const buttons = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")
    ).map(buttonInfo);
    const links = Array.from(document.querySelectorAll("a[href]")).map(linkInfo);
    const tables = Array.from(document.querySelectorAll("table")).map((table, index) => ({
      index,
      visible: isVisible(table),
      selector: selectorFor(table),
      rowCount: table.querySelectorAll("tr").length,
      headers: Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"))
        .map((cell) => text(cell.innerText || cell.textContent))
        .filter(Boolean),
      cellTextCaptured: false
    }));

    return {
      kind: "ezhrm_page_observation",
      recorder: "ezhrm-skill-recorder",
      capturedAt: new Date().toISOString(),
      page: {
        url: location.href,
        title: document.title || "",
        origin: location.origin,
        path: location.pathname
      },
      counts: {
        forms: forms.length,
        fields: fields.length,
        buttons: buttons.length,
        links: links.length,
        tables: tables.length
      },
      observations: {
        forms,
        fields,
        buttons,
        links,
        tables
      },
      privacy: {
        inputValuesCaptured: false,
        passwordValuesCaptured: false
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EZHRM_COLLECT_PAGE_SKILL") return false;

    try {
      sendResponse({
        ok: true,
        observation: collectObservation()
      });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }

    return true;
  });
})();