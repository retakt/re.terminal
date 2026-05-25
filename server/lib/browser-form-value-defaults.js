// Production safety:
// This module used to invent fallback form values such as names, dates,
// passwords, emails, phone numbers, colors, ranges, URLs, and select options.
// That is not allowed anymore.
//
// Form filling must only use values explicitly provided by the user or values
// produced by a deterministic mapper from the user's prompt.
// This file remains only to preserve existing imports.

export function formValueHintsFromInstruction(_instruction = "") {
  return [];
}

export function buildRegistryFormFillCommandFromInstruction(_options = {}) {
  return null;
}
