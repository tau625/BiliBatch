const DEFAULT_SETTINGS = {
  noteFolder: "Clippings/Bilibili",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
  tags: "clippings,bilibili",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeTimestampInBody: true,
  enableDebugLogs: false,
  readerTheme: "light",
  readerFontScale: "m",
  readerLetterSpacing: "normal",
  readerLineHeight: "tight",
  readerContentWidth: "medium",
  readerChapterVisibility: "show",
  readerTranscriptVisible: true,
  frontmatterFields: [
    "title",
    "url",
    "bvid",
    "cid",
    "author",
    "upload_date",
    "subtitle_lang",
    "created",
    "tags"
  ],
  fixedFrontmatterProperties: [],
  notePlaceholderSections: []
};

const BB_VERSION = chrome.runtime.getManifest().version || "";
const CACHE_KEY_PREFIX = "bb_subtitle_cache_";
globalThis.__BB_CONTENT_SCRIPT_LOADED__ = BB_VERSION;
const state = {
  currentUrl: location.href,
  fetchRunId: 0,
  bvid: "",
  aid: "",
  cid: "",
  cidSource: "",
  pageIndex: 1,
  pageCount: 0,
  pageTitle: "",
  videoDuration: 0,
  description: "",
  title: "",
  author: "",
  uploadDate: "",
  subtitles: [],
  selectedSubtitleId: "",
  selectedSubtitleUrl: "",
  selectedSubtitleLang: "",
  subtitleBody: [],
  subtitleFetchState: "idle",
  chapters: [],
  markdown: "",
  srt: "",
  txt: "",
  readingViewOpen: false,
  readingNativePageMode: false,
  readingRootOriginalParent: null,
  readingAutoScroll: true,
  readingTheme: "light",
  readingFontScale: "m",
  readingLetterSpacing: "normal",
  readingLineHeight: "tight",
  readingContentWidth: "medium",
  readingChapterVisible: true,
  readingTranscriptVisible: true,
  readingSettingsExpanded: false,
  readingDescriptionExpanded: false,
  readingActiveSubtitleIndex: -1,
  readingActiveChapterIndex: -1,
  readingNextScrollBehavior: "smooth",
  readingSyncTimer: 0,
  currentClipSignature: "",
  readingVideoEl: null,
  readingPlayerHost: null,
  readingMainOriginalParent: null,
  readingMainOriginalNextSibling: null,
  readingPlayerAdjustedNodes: [],
  readingPlayerObserver: null,
  readingPlayerMountTimer: 0,
  readingPlayerRetryTimer: 0,
  readingMiniDismissTimer: 0,
  readingControlsHideTimer: 0,
  readingControlsRecoveryTimer: 0,
  readingControlsRecoveryInFlight: false,
  readingControlsLastRecoverAt: 0,
  readingControlsHoverHost: null,
  readingHeaderHoverHost: null,
  readingHeaderHideTimer: 0,
  readingVideoEventsBound: false,
  readingLayoutBound: false,
  uiEventsBound: false,
  runtimeEventsBound: false,
  urlWatcherStarted: false,
  readingDocumentClickBound: false,
  readingManualScrollPauseUntil: 0,
  readingProgrammaticScrollUntil: 0,
  readingViewReady: false,
  statusText: "准备就绪，点击「刷新抓取」开始。",
  messageText: "",
  settings: { ...DEFAULT_SETTINGS }
};

const ids = {
  root: "boc-root",
  panel: "boc-panel",
  status: "boc-status",
  meta: "boc-meta",
  subtitleSelect: "boc-subtitle-select",
  preview: "boc-preview",
  message: "boc-message",
  copyBtn: "boc-copy-btn",
  downloadBtn: "boc-download-btn",
  sendBtn: "boc-send-btn",
  refreshBtn: "boc-refresh-btn",
  closeBtn: "boc-close-btn",
  settingsBtn: "boc-settings-btn",
  readingView: "boc-reading-view",
  readingPlayerSlot: "boc-reading-player-slot",
  readingStatus: "boc-reading-status",
  readingCloseBtn: "boc-reading-close-btn",
  readingRefreshBtn: "boc-reading-refresh-btn",
  readingAutoScroll: "boc-reading-autoscroll",
  readingTranscriptVisible: "boc-reading-transcript-visible",
  readingThemeSelect: "boc-reading-theme-select",
  readingSettingsBtn: "boc-reading-settings-btn",
  readingSettingsPanel: "boc-reading-settings-panel",
  readingFontScaleSelect: "boc-reading-font-scale-select",
  readingLetterSpacingSelect: "boc-reading-letter-spacing-select",
  readingLineHeightSelect: "boc-reading-line-height-select",
  readingContentWidthSelect: "boc-reading-content-width-select",
  readingChapterVisibilitySelect: "boc-reading-chapter-visibility-select",
  readingChapterVisible: "boc-reading-chapter-visible",
  readingSubtitleSelect: "boc-reading-subtitle-select",
  readingInfoSummary: "boc-reading-info-summary",
  readingInfoDescription: "boc-reading-info-description",
  readingDescriptionBtn: "boc-reading-description-btn",
  readingMeta: "boc-reading-meta",
  readingChapterList: "boc-reading-chapters",
  readingTranscriptList: "boc-reading-transcript",
  readingTranscriptTailSpacer: "boc-reading-tail-spacer"
};

function shouldDebugLog() {
  return Boolean(state.settings?.enableDebugLogs);
}

function logInfo(...args) {
  if (shouldDebugLog()) {
    console.info(...args);
  }
}

function logWarn(...args) {
  if (shouldDebugLog()) {
    console.warn(...args);
  }
}

function formatLocalDate(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeYaml(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

// Safe DOM lookup — returns null instead of throwing when element is missing.
function byId(id) {
  return document.getElementById(id) || null;
}

// AMO-safe wrappers using DOMParser to avoid innerHTML/insertAdjacentHTML flags.
function setSafeHTML(element, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  element.textContent = "";
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(doc.body.firstChild);
  }
  element.appendChild(fragment);
}

function safeInsertAdjacentHTML(element, position, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(doc.body.firstChild);
  }
  if (position === "beforebegin" && element.parentNode) {
    element.parentNode.insertBefore(fragment, element);
  } else if (position === "afterbegin") {
    element.insertBefore(fragment, element.firstChild);
  } else if (position === "beforeend") {
    element.appendChild(fragment);
  } else if (position === "afterend" && element.parentNode) {
    element.parentNode.insertBefore(fragment, element.nextSibling);
  }
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ─── Timer management ───
// Prevents leaks on SPA navigation by tracking all active timers.
const _timers = new Map();

function setManagedTimer(key, callback, delay) {
  clearManagedTimer(key);
  _timers.set(key, setTimeout(() => {
    _timers.delete(key);
    callback();
  }, delay));
}

function setManagedInterval(key, callback, interval) {
  clearManagedTimer(key);
  _timers.set(key, setInterval(callback, interval));
}

function clearManagedTimer(key) {
  const id = _timers.get(key);
  if (id != null) {
    clearTimeout(id);
    clearInterval(id);
    _timers.delete(key);
  }
}

function clearAllManagedTimers() {
  for (const [, id] of _timers) {
    clearTimeout(id);
    clearInterval(id);
  }
  _timers.clear();
}

globalThis.BiliBatchTimers = {
  set: setManagedTimer,
  setInterval: setManagedInterval,
  clear: clearManagedTimer,
  clearAll: clearAllManagedTimers
};
