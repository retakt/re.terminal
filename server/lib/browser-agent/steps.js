function sameUrl(left = "", right = "") {
  return String(left || "") === String(right || "");
}

function canMergeFillStep(left = {}, right = {}) {
  const leftKind = String(left.kind || "").toLowerCase();
  const rightKind = String(right.kind || "").toLowerCase();
  if (leftKind !== "fill" || rightKind !== "fill") return false;
  if (!sameUrl(left.url || "", right.url || "")) return false;
  return Array.isArray(left.fields) && left.fields.length > 0 &&
    Array.isArray(right.fields) && right.fields.length > 0;
}

export function tidySteps(steps = []) {
  const result = [];

  for (const step of Array.isArray(steps) ? steps : []) {
    const last = result[result.length - 1];
    if (last && canMergeFillStep(last, step)) {
      last.fields = [...last.fields, ...step.fields];
      last.text = [last.text, step.text].filter(Boolean).join("; ");
      last.notes = [last.notes, step.notes].filter(Boolean).join(" ");
      last.shouldVerify = Boolean(last.shouldVerify || step.shouldVerify);
      last.shouldScreenshot = Boolean(last.shouldScreenshot || step.shouldScreenshot);
      continue;
    }
    result.push({ ...step });
  }

  return result.map((step, index) => ({
    ...step,
    index: index + 1,
  }));
}

