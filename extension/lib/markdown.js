// Shared markdown/note builders for popup, batch, and content scripts.
const MARKDOWN_DEFAULT_SETTINGS = {
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
  ]
};

function formatLocalDateForMarkdown(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeYamlForMarkdown(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function cleanVideoUrlForMarkdown(href, fallbackUrl = "") {
  const input = String(href || fallbackUrl || "").trim();
  if (!input) {
    return "";
  }
  try {
    const parsed = new URL(input);
    if (parsed.hostname !== "www.bilibili.com") {
      return input;
    }
    if (parsed.pathname === "/list/watchlater" || parsed.pathname === "/list/watchlater/") {
      const bvidMatch = input.match(/BV[0-9A-Za-z]{10}/);
      if (bvidMatch) {
        return `https://www.bilibili.com/video/${bvidMatch[0]}/`;
      }
      return input;
    }
    const bvidMatch = input.match(/BV[0-9A-Za-z]{10}/);
    if (!bvidMatch) {
      return input;
    }
    const p = parsed.searchParams.get("p");
    const qs = p ? `?p=${encodeURIComponent(p)}` : "";
    return `https://www.bilibili.com/video/${bvidMatch[0]}/${qs}`;
  } catch {
    return input;
  }
}

function extractPageIndexForMarkdown(url) {
  try {
    const page = Number(new URL(String(url || "")).searchParams.get("p") || "1");
    if (!Number.isFinite(page) || page <= 0) {
      return 1;
    }
    return page;
  } catch {
    return 1;
  }
}

function normalizeChaptersForMarkdown(chapters) {
  const normalized = (chapters || [])
    .map((item) => ({
      title: String(item?.title || "").trim(),
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0,
      source: String(item?.source || "")
    }))
    .filter((item) => item.title && item.from >= 0)
    .sort((a, b) => a.from - b.from);

  const unique = [];
  const seen = new Set();
  normalized.forEach((item) => {
    const key = `${Math.floor(item.from * 10)}|${item.title.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(item);
  });
  return unique;
}

function buildSubtitlePreview(body, settings) {
  const compactWithHours = shouldShowHoursInSubtitle(body);
  return (body || [])
    .map((item) => {
      const text = String(item?.content || "").trim();
      if (!text) {
        return "";
      }
      if (settings.includeTimestampInBody) {
        return `\`${formatCompactTimestamp(item.from, compactWithHours)}\` ${text}`;
      }
      return text;
    })
    .filter(Boolean)
    .join("\n");
}

function buildMarkdown(meta, body, settings) {
  const created = formatLocalDateForMarkdown();
  const tags = (settings.tags || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const tagsCsv = tags.join(", ");
  const tagsYaml =
    tags.length === 0 ? "[]" : `[${tags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(", ")}]`;

  const compactWithHours = shouldShowHoursInNote(meta, body);
  const chapterLines = buildChapterLines(meta.chapters || [], compactWithHours);
  const subtitleSectionLines = buildSubtitleSectionLines(
    body,
    meta.chapters || [],
    settings,
    compactWithHours
  );
  const frontMatter = buildFrontMatter(meta, settings, created, tagsCsv, tagsYaml);

  const page = Number(meta.pageIndex) > 0 ? Number(meta.pageIndex) : extractPageIndexForMarkdown(meta.url);
  const embedIframe = buildBilibiliEmbedIframe(meta, page);
  const intro = String(meta.description || "").trim();
  const noteSectionContext = buildNotePlaceholderTemplateContext(meta, intro);
  const noteSections = groupNotePlaceholderSections(settings, noteSectionContext);

  const lines = [];
  if (frontMatter) {
    lines.push(frontMatter, "");
  }
  lines.push(embedIframe, "");
  pushOptionalLines(lines, noteSections.before_intro);

  if (intro) {
    lines.push("## 简介", "", intro, "");
  }

  pushOptionalLines(lines, noteSections.before_chapters);

  if (chapterLines.length > 0) {
    lines.push("## 章节", "", ...chapterLines, "");
  }

  pushOptionalLines(lines, noteSections.before_subtitle);
  lines.push("## 字幕", "", ...subtitleSectionLines);

  return lines.join("\n");
}

function buildFrontMatter(meta, settings, created, tagsCsv, tagsYaml) {
  const enabled = getEnabledFrontmatterFields(settings);
  const fixedPropertyLines = getFixedFrontmatterPropertyLines(
    settings,
    buildFrontmatterTemplateContext(meta, created, tagsCsv, tagsYaml)
  );
  if (enabled.length === 0 && fixedPropertyLines.length === 0) {
    return "";
  }

  const fieldLines = {
    title: `title: "${escapeYamlForMarkdown(meta.title)}"`,
    url: `url: "${escapeYamlForMarkdown(cleanVideoUrlForMarkdown(meta.url, meta.url))}"`,
    bvid: `bvid: "${escapeYamlForMarkdown(meta.bvid)}"`,
    cid: `cid: "${escapeYamlForMarkdown(meta.cid)}"`,
    author: `author: "${escapeYamlForMarkdown(meta.author || "unknown")}"`,
    upload_date: `upload_date: "${escapeYamlForMarkdown(meta.uploadDate || "unknown")}"`,
    subtitle_lang: `subtitle_lang: "${escapeYamlForMarkdown(meta.selectedSubtitleLang || "unknown")}"`,
    created: `created: "${created}"`,
    tags: `tags: ${tagsYaml}`
  };

  const lines = enabled.map((field) => fieldLines[field]).filter(Boolean);
  lines.push(...fixedPropertyLines);
  if (lines.length === 0) {
    return "";
  }

  return ["---", ...lines, "---"].join("\n");
}

function getEnabledFrontmatterFields(settings) {
  const defaultFields = Array.isArray(MARKDOWN_DEFAULT_SETTINGS.frontmatterFields)
    ? MARKDOWN_DEFAULT_SETTINGS.frontmatterFields
    : [];
  const raw = Array.isArray(settings?.frontmatterFields) ? settings.frontmatterFields : defaultFields;
  const allowed = new Set(defaultFields);
  const unique = [];
  raw.forEach((item) => {
    const key = String(item || "").trim();
    if (!key || !allowed.has(key) || unique.includes(key)) {
      return;
    }
    unique.push(key);
  });
  return unique;
}

function getFixedFrontmatterPropertyLines(settings, templateContext = {}) {
  const customPropertyKeyPattern = /^[\p{L}\p{N}_\-\s]+$/u;
  const systemFields = new Set(
    (Array.isArray(MARKDOWN_DEFAULT_SETTINGS.frontmatterFields) ? MARKDOWN_DEFAULT_SETTINGS.frontmatterFields : []).map((field) =>
      String(field).toLowerCase()
    )
  );
  const rows = Array.isArray(settings?.fixedFrontmatterProperties) ? settings.fixedFrontmatterProperties : [];
  const seenKeys = new Set();
  const lines = [];

  rows.forEach((item) => {
    const key = String(item?.key || "").trim();
    const type = normalizeFixedPropertyType(item?.type);
    const value = item?.value;
    const lowerKey = key.toLowerCase();
    if (!key || isFixedPropertyRowEffectivelyEmpty(type, value)) {
      return;
    }
    if (!customPropertyKeyPattern.test(key)) {
      return;
    }
    if (systemFields.has(lowerKey) || seenKeys.has(lowerKey)) {
      return;
    }
    seenKeys.add(lowerKey);
    const yamlLine = formatFixedPropertyYamlLine(key, type, value, templateContext);
    if (yamlLine) {
      lines.push(yamlLine);
    }
  });

  return lines;
}

function normalizeFixedPropertyType(value) {
  const type = String(value || "").trim().toLowerCase();
  return type === "number" || type === "checkbox" || type === "list" || type === "date" ? type : "text";
}

function isFixedPropertyRowEffectivelyEmpty(type, value) {
  return !String(value || "").trim();
}

function buildFrontmatterTemplateContext(meta, created, tagsCsv, tagsYaml) {
  return {
    title: String(meta?.title || "").trim(),
    url: String(cleanVideoUrlForMarkdown(meta.url, meta.url) || "").trim(),
    bvid: String(meta?.bvid || "").trim(),
    cid: String(meta?.cid || "").trim(),
    author: String(meta?.author || "unknown").trim(),
    upload_date: String(meta?.uploadDate || "unknown").trim(),
    subtitle_lang: String(meta?.selectedSubtitleLang || "unknown").trim(),
    created: String(created || "").trim(),
    tags: String(tagsCsv || "").trim(),
    tags_csv: String(tagsCsv || "").trim(),
    tags_yaml: String(tagsYaml || "").trim()
  };
}

function buildNotePlaceholderTemplateContext(meta, description) {
  return {
    title: String(meta?.title || "").trim(),
    author: String(meta?.author || "").trim(),
    url: String(cleanVideoUrlForMarkdown(meta.url, meta.url) || "").trim(),
    upload_date: String(meta?.uploadDate || "").trim(),
    description: String(description || "").trim()
  };
}

function groupNotePlaceholderSections(settings, templateContext = {}) {
  const groups = {
    before_intro: [],
    before_chapters: [],
    before_subtitle: []
  };
  const rows = normalizeNotePlaceholderSections(settings?.notePlaceholderSections);
  rows.forEach((item) => {
    const renderedLines = buildNotePlaceholderLines(item, templateContext);
    if (!renderedLines.length) {
      return;
    }
    groups[item.position].push(...renderedLines);
  });
  return groups;
}

function buildNotePlaceholderLines(item, templateContext = {}) {
  const title = String(item?.title || "").trim();
  if (!title) {
    return [];
  }
  const content = resolveFrontmatterTemplateValue(item?.content, templateContext).trim();
  const lines = [`## ${title}`, ""];
  if (content) {
    lines.push(content, "");
  }
  return lines;
}

function pushOptionalLines(targetLines, extraLines) {
  if (!Array.isArray(extraLines) || !extraLines.length) {
    return;
  }
  targetLines.push(...extraLines);
}

function resolveFrontmatterTemplateValue(value, templateContext = {}) {
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, rawKey) => {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key) {
      return "";
    }
    const resolved = templateContext[key];
    return resolved == null ? "" : String(resolved);
  });
}

function isYamlDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseFrontmatterArrayItems(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFixedPropertyYamlLine(key, type, value, templateContext = {}) {
  const normalizedType = normalizeFixedPropertyType(type);
  const resolvedValue = resolveFrontmatterTemplateValue(value, templateContext).trim();

  if (!resolvedValue) {
    return "";
  }

  if (normalizedType === "number") {
    const num = Number(resolvedValue);
    if (!Number.isFinite(num)) {
      return "";
    }
    return `${key}: ${resolvedValue}`;
  }

  if (normalizedType === "checkbox") {
    const normalizedValue = resolvedValue.toLowerCase();
    if (normalizedValue !== "true" && normalizedValue !== "false") {
      return "";
    }
    return `${key}: ${normalizedValue}`;
  }

  if (normalizedType === "list") {
    const items = parseFrontmatterArrayItems(resolvedValue);
    return `${key}: [${items.map((item) => `"${escapeYamlForMarkdown(item)}"`).join(", ")}]`;
  }

  if (normalizedType === "date") {
    if (!isYamlDateValue(resolvedValue)) {
      return "";
    }
    return `${key}: ${resolvedValue}`;
  }

  return `${key}: "${escapeYamlForMarkdown(resolvedValue)}"`;
}

function normalizeNotePlaceholderSections(items) {
  const allowedPositions = new Set(["before_intro", "before_chapters", "before_subtitle"]);
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const title = String(item?.title || "").trim();
      const position = allowedPositions.has(String(item?.position || "").trim())
        ? String(item?.position || "").trim()
        : "before_intro";
      const content = String(item?.content || "").trim();
      return {
        title,
        position,
        content
      };
    })
    .filter((item) => item.title)
    .slice(0, 5);
}

function buildSubtitleSectionLines(body, chapters, settings, withHours) {
  const subtitleItems = (body || [])
    .map((item, index) => ({
      ...item,
      _index: index,
      text: String(item?.content || "").trim()
    }))
    .filter((item) => item.text);
  if (subtitleItems.length === 0) {
    return ["（暂无字幕）"];
  }

  const chapterItems = normalizeChaptersForMarkdown(chapters);
  if (chapterItems.length === 0) {
    return subtitleItems.map((item) => formatSubtitleLine(item, settings, withHours));
  }

  const lines = [];
  const usedIndexes = new Set();

  chapterItems.forEach((chapter, idx) => {
    const start = Number(chapter.from || 0) || 0;
    const next = chapterItems[idx + 1];
    const chapterTo = Number(chapter.to || 0) || 0;
    let end = Infinity;
    if (next && Number(next.from) > start) {
      end = Number(next.from);
    } else if (chapterTo > start) {
      end = chapterTo;
    }

    const sectionItems = subtitleItems.filter((item) => {
      const from = Number(item.from || 0) || 0;
      const inStart = from + 0.001 >= start;
      const inEnd = end === Infinity ? true : from < end;
      return inStart && inEnd;
    });

    if (sectionItems.length === 0) {
      return;
    }

    const chapterStamp = settings.includeTimestampInBody
      ? ` \`${formatCompactTimestamp(start, withHours)}\``
      : "";
    lines.push(`### ${chapter.title}${chapterStamp}`, "");
    sectionItems.forEach((item) => {
      usedIndexes.add(item._index);
      lines.push(formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  });

  const remaining = subtitleItems.filter((item) => !usedIndexes.has(item._index));
  if (remaining.length > 0) {
    lines.push("### 其他片段", "");
    remaining.forEach((item) => {
      lines.push(formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  }

  if (lines.length === 0) {
    return subtitleItems.map((item) => formatSubtitleLine(item, settings, withHours));
  }

  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }
  return lines;
}

function formatSubtitleLine(item, settings, withHours) {
  const text = String(item?.content || "").trim();
  if (!text) {
    return "";
  }
  if (!settings.includeTimestampInBody) {
    return text;
  }
  return `\`${formatCompactTimestamp(item.from, withHours)}\` ${text}`;
}

function buildChapterLines(chapters, withHours = false) {
  const chapterItems = normalizeChaptersForMarkdown(chapters);
  if (chapterItems.length === 0) {
    return [];
  }

  return chapterItems.map((item) => {
    const fromText = formatCompactTimestamp(item.from, withHours);
    return `- \`${fromText}\` ${item.title}`;
  });
}

function buildBilibiliEmbedIframe(meta, page = 1) {
  const safeAid = encodeURIComponent(String(meta?.aid || "").trim());
  const safeBvid = encodeURIComponent(String(meta?.bvid || "").trim());
  const safeCid = encodeURIComponent(String(meta?.cid || "").trim());
  const safePage = Number(page) > 0 ? Number(page) : 1;

  return `<iframe src="https://player.bilibili.com/player.html?aid=${safeAid}&bvid=${safeBvid}&cid=${safeCid}&page=${safePage}&autoplay=0" scrolling="no" border="0" frameborder="no" framespacing="0" allow="fullscreen; picture-in-picture" allowfullscreen="true" style="height:100%;width:100%; aspect-ratio: 16 / 9;"> </iframe>`;
}

function buildSrt(body) {
  return body
    .map((item, index) => {
      const from = formatTimestamp(item.from, true);
      const to = formatTimestamp(item.to, true);
      const text = (item.content || "").trim();
      return `${index + 1}\n${from} --> ${to}\n${text}`;
    })
    .join("\n\n");
}

function buildTxt(body, settings) {
  const withHours = shouldShowHoursInSubtitle(body);
  return (body || [])
    .map((item) => {
      const text = String(item?.content || "").trim();
      if (!text) {
        return "";
      }
      if (!settings?.includeTimestampInBody) {
        return text;
      }
      return `${formatCompactTimestamp(item.from, withHours)} ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function shouldShowHoursInSubtitle(body) {
  const maxTo = (body || []).reduce((max, item) => {
    const to = Number(item?.to || 0);
    return Number.isFinite(to) && to > max ? to : max;
  }, 0);
  return maxTo >= 3600;
}

function shouldShowHoursInNote(meta, body) {
  const subtitleMaxTo = (body || []).reduce((max, item) => {
    const to = Number(item?.to || 0);
    return Number.isFinite(to) && to > max ? to : max;
  }, 0);
  const chapterMaxTo = normalizeChaptersForMarkdown(meta?.chapters || []).reduce((max, item) => {
    const from = Number(item?.from || 0) || 0;
    const to = Number(item?.to || 0) || 0;
    return Math.max(max, from, to);
  }, 0);
  const duration = Number(meta?.videoDuration || 0) || 0;
  return Math.max(subtitleMaxTo, chapterMaxTo, duration) >= 3600;
}

function formatCompactTimestamp(seconds, withHours) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  const second = safe % 60;

  if (withHours) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(
      second
    ).padStart(2, "0")}`;
  }

  const totalMinutes = Math.floor(safe / 60);
  return `${String(totalMinutes).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function formatTimestamp(seconds, forSrt = false) {
  const safe = Number(seconds) || 0;
  const msTotal = Math.max(0, Math.floor(safe * 1000));
  const hour = Math.floor(msTotal / 3600000);
  const minute = Math.floor((msTotal % 3600000) / 60000);
  const second = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  if (!forSrt) {
    return `${hh}:${mm}:${ss}.${String(ms).padStart(3, "0")}`;
  }

  return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
}

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeDownloadFormat(value) {
  return value === "txt" ? "txt" : "srt";
}

function buildNoteFilename(meta, settings = {}, stateRef = null) {
  const includeDate = settings?.includeDateInFilename !== false;
  const baseParts = [];
  if (includeDate) {
    baseParts.push(formatLocalDateForMarkdown());
  }
  baseParts.push(meta.title || meta.bvid || "bilibili-subtitle");
  if (Number(meta.pageCount) > 1) {
    baseParts.push(`P${Number(meta.pageIndex) > 0 ? Number(meta.pageIndex) : 1}`);
    const pageTitle = String(meta.pageTitle || "").trim();
    if (pageTitle) {
      baseParts.push(pageTitle);
    }
  }
  const baseName = sanitizeFileName(baseParts.filter(Boolean).join("-"));
  return `${baseName || "bilibili-subtitle"}.md`;
}

function normalizeFolder(input) {
  return String(input || "").trim().replace(/^\/+|\/+$/g, "");
}
globalThis.BiliBatchMarkdown = {
  buildMarkdown,
  buildSrt,
  buildTxt,
  buildSubtitlePreview,
  buildNoteFilename,
  sanitizeFileName,
  normalizeDownloadFormat,
  normalizeFolder,
  formatTimestamp,
  formatCompactTimestamp,
  normalizeChapters: normalizeChaptersForMarkdown,
  MARKDOWN_DEFAULT_SETTINGS
};
