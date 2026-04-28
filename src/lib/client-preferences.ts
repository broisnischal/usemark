const AUTO_PASTE_LINK_SETTING_KEY = "usemarks.auto-paste-link";
const LEGACY_CLIPBOARD_AUTO_PASTE_SETTING_KEY = "usemarks.clipboard-auto-paste";
const MARKS_FOLDER_STRIP_HIDDEN_KEY = "usemarks.marks-folder-strip-hidden";
export const MARKS_FOLDER_STRIP_VISIBILITY_EVENT = "usemarks:marks-folder-strip-visibility";

export function isClipboardAutoPasteEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  const nextValue = window.localStorage.getItem(AUTO_PASTE_LINK_SETTING_KEY);
  if (nextValue !== null) {
    return nextValue !== "0";
  }

  const legacyValue = window.localStorage.getItem(LEGACY_CLIPBOARD_AUTO_PASTE_SETTING_KEY);
  if (legacyValue !== null) {
    return legacyValue === "1";
  }

  return true;
}

export function setClipboardAutoPasteEnabled(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  if (!enabled) {
    window.localStorage.setItem(AUTO_PASTE_LINK_SETTING_KEY, "0");
    window.localStorage.removeItem(LEGACY_CLIPBOARD_AUTO_PASTE_SETTING_KEY);
    return;
  }

  window.localStorage.removeItem(AUTO_PASTE_LINK_SETTING_KEY);
  window.localStorage.removeItem(LEGACY_CLIPBOARD_AUTO_PASTE_SETTING_KEY);
}

export function isMarksFolderStripVisible() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(MARKS_FOLDER_STRIP_HIDDEN_KEY) !== "1";
}

export function setMarksFolderStripVisible(visible: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (visible) {
    window.localStorage.removeItem(MARKS_FOLDER_STRIP_HIDDEN_KEY);
  } else {
    window.localStorage.setItem(MARKS_FOLDER_STRIP_HIDDEN_KEY, "1");
  }

  window.dispatchEvent(new Event(MARKS_FOLDER_STRIP_VISIBILITY_EVENT));
}
