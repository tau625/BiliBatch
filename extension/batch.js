// Firefox / Chrome 兼容
const api = globalThis.browser || globalThis.chrome;

const el = {
  bvidInput: document.getElementById("bvidInput"),
  parseBtn: document.getElementById("parseBtn"),
  clearBtn: document.getElementById("clearBtn"),
  parsedList: document.getElementById("parsedList"),
  parsedCount: document.getElementById("parsedCount"),
  parsedEpisodeCount: document.getElementById("parsedEpisodeCount"),
  parsedItems: document.getElementById("parsedItems"),
  editListBtn: document.getElementById("editListBtn"),
  folderInput: document.getElementById("folderInput"),
  delayInput: document.getElementById("delayInput"),
  startBtn: document.getElementById("startBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  progressSection: document.getElementById("progressSection"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  logContainer: document.getElementById("logContainer"),
  summarySection: document.getElementById("summarySection"),
  summaryContent: document.getElementById("summaryContent"),
  backBtn: document.getElementById("backBtn")
};

let parsedBvids = [];
let parsedMeta = {}; // bvid → { title, author, pages, duration, pageDetails: [{part, page, duration}] }
let isRunning = false;
let abortController = null;

function setSafeHTML(element, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  element.textContent = "";
  const fragment = document.createDocumentFragment();
  while (doc.body.firstChild) {
    fragment.appendChild(doc.body.firstChild);
  }
  element.appendChild(fragment);
}

// ========== BV 号解析 ==========

function extractBvids(text) {
  const bvidPattern = /BV[0-9A-Za-z]{10}/g;
  const matches = text.match(bvidPattern) || [];
  return [...new Set(matches)];
}

function getTotalEpisodes() {
  let total = 0;
  for (const bvid of parsedBvids) {
    const meta = parsedMeta[bvid];
    if (!meta) {
      total += 1; // 未解析的算 1 集
    } else if (meta.pages > 1) {
      total += meta.pages;
    } else {
      total += 1;
    }
  }
  return total;
}

async function parseInput() {
  const text = el.bvidInput.value.trim();
  if (!text) {
    return;
  }
  const bvids = extractBvids(text);
  if (!bvids.length) {
    alert("未找到有效的 BV 号，请检查输入格式（BV 号格式：BV + 10位字母数字）");
    return;
  }
  parsedBvids = bvids;
  parsedMeta = {};
  renderParsedList();

  // 逐个获取视频元数据
  for (let i = 0; i < bvids.length; i++) {
    const bvid = bvids[i];
    try {
      const data = await sendMessage({
        type: "batch-fetch-video",
        bvid: bvid
      });
      if (data && data.ok) {
        const pageDetails = (data.pages || []).map((p) => ({
          page: Number(p.page || 0),
          part: String(p.part || "").trim(),
          duration: Number(p.duration || 0)
        }));
        parsedMeta[bvid] = {
          title: data.meta.title || bvid,
          author: data.meta.author || "",
          pages: (data.pages || []).length,
          duration: data.meta.duration || 0,
          pageDetails
        };
      } else {
        parsedMeta[bvid] = { title: `❌ ${data?.error || "获取失败"}`, author: "", pages: 0, pageDetails: [] };
      }
    } catch (e) {
      parsedMeta[bvid] = { title: `❌ ${e.message}`, author: "", pages: 0, pageDetails: [] };
    }
    updateParsedItem(bvid, i);
    updateParsedCount();
  }
}

function renderParsedList() {
  el.parsedList.style.display = parsedBvids.length ? "block" : "none";
  updateParsedCount();
  el.startBtn.disabled = !parsedBvids.length;

  setSafeHTML(el.parsedItems, parsedBvids.map((bvid, i) => `
    <div class="parsed-item" data-bvid="${bvid}">
      <span class="index">${i + 1}.</span>
      <span class="bvid">${bvid}</span>
      <span class="title">解析中...</span>
      <span class="remove" data-index="${i}" title="移除">✕</span>
    </div>
    <div class="parsed-subitems" data-bvid="${bvid}"></div>
  `).join(""));

  el.parsedItems.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.index);
      parsedBvids.splice(idx, 1);
      renderParsedList();
    });
  });
}

function updateParsedCount() {
  el.parsedCount.textContent = parsedBvids.length;
  const totalEpisodes = getTotalEpisodes();
  const hasMultiP = parsedBvids.some((bvid) => (parsedMeta[bvid]?.pages || 0) > 1);
  if (hasMultiP && totalEpisodes !== parsedBvids.length) {
    el.parsedEpisodeCount.textContent = `（共 ${totalEpisodes} 集）`;
    el.parsedEpisodeCount.style.display = "inline";
  } else {
    el.parsedEpisodeCount.style.display = "none";
  }
}

function updateParsedItem(bvid, index) {
  const meta = parsedMeta[bvid];
  if (!meta) return;
  const item = el.parsedItems.querySelector(`.parsed-item[data-bvid="${bvid}"]`);
  if (!item) return;
  const titleEl = item.querySelector(".title");
  if (titleEl) {
    const parts = meta.pages > 1 ? ` (${meta.pages}集)` : "";
    titleEl.textContent = `${meta.title}${parts} - ${meta.author || "未知UP"}`;
  }

  // 展开多P视频的子集列表
  if (meta.pages > 1 && meta.pageDetails.length > 0) {
    const subContainer = el.parsedItems.querySelector(`.parsed-subitems[data-bvid="${bvid}"]`);
    if (subContainer) {
      setSafeHTML(subContainer, meta.pageDetails.map((p) => `
        <div class="parsed-subitem" data-bvid="${bvid}" data-page="${p.page}">
          <span class="sub-index">P${p.page}</span>
          <span class="sub-title">${p.part || `第${p.page}集`}</span>
          <span class="sub-status">待处理</span>
        </div>
      `).join(""));
      subContainer.style.display = "block";
    }
  }
}

function updateEpisodeStatus(bvid, page, status, text) {
  const subItem = el.parsedItems.querySelector(
    `.parsed-subitem[data-bvid="${bvid}"][data-page="${page}"]`
  );
  if (!subItem) return;
  const statusEl = subItem.querySelector(".sub-status");
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = `sub-status ${status}`;
  }
}

function updateParsedItemStatus(bvid, status, text) {
  const item = el.parsedItems.querySelector(`.parsed-item[data-bvid="${bvid}"]`);
  if (!item) return;
  const titleEl = item.querySelector(".title");
  if (titleEl) {
    titleEl.textContent = text;
    titleEl.className = `title ${status}`;
  }
}

function clearAll() {
  el.bvidInput.value = "";
  parsedBvids = [];
  renderParsedList();
  el.progressSection.style.display = "none";
  el.summarySection.style.display = "none";
  el.startBtn.disabled = true;
  el.cancelBtn.style.display = "none";
}

// ========== 批量处理 ==========

async function startBatch() {
  if (!parsedBvids.length) return;

  isRunning = true;
  abortController = new AbortController();
  el.startBtn.style.display = "none";
  el.cancelBtn.style.display = "inline-block";
  el.progressSection.style.display = "block";
  el.summarySection.style.display = "none";
  setSafeHTML(el.logContainer, "");

  const folder = el.folderInput.value.trim() || "Clippings/Bilibili";
  const delay = Number(el.delayInput.value) || 800;
  const nameFormat = document.querySelector('input[name="nameFormat"]:checked')?.value || "date-title";
  const total = parsedBvids.length;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let globalOrder = 1;

  for (let i = 0; i < total; i++) {
    if (!isRunning) {
      addLog(globalOrder, "skipped", "已取消");
      skipped++;
      globalOrder++;
      continue;
    }

    const bvid = parsedBvids[i];
    const meta = parsedMeta[bvid];
    const episodeCount = meta?.pages || 1;
    updateProgress(i, total, `正在处理 ${i + 1}/${total}: ${meta?.title || bvid}`);

    try {
      const result = await processOneVideo(bvid, folder, nameFormat, globalOrder);
      if (Array.isArray(result)) {
        // 多P视频 — 每集已在 processOneVideo 中更新状态
        for (const r of result) {
          if (r.ok) {
            addLog(r.order, "success", `${r.title}`);
            success++;
          } else {
            addLog(r.order, "error", `${r.title}: ${r.error}`);
            failed++;
          }
        }
        globalOrder += result.length;
      } else {
        addLog(globalOrder, "success", `${result.title || bvid}`);
        success++;
        globalOrder++;
      }
    } catch (error) {
      console.error(`[Batch] ${bvid} error:`, error);
      addLog(globalOrder, "error", `${bvid}: ${error.message || error}`);
      failed++;
      globalOrder += episodeCount;
    }

    // 限速
    if (i < total - 1 && isRunning) {
      await sleep(delay);
    }
  }

  // 完成
  updateProgress(total, total, "全部完成");
  isRunning = false;
  el.startBtn.style.display = "inline-block";
  el.startBtn.disabled = true;
  el.cancelBtn.style.display = "none";

  showSummary(getTotalEpisodes(), success, failed, skipped);
}

function cancelBatch() {
  isRunning = false;
  if (abortController) {
    abortController.abort();
  }
  el.cancelBtn.style.display = "none";
  el.startBtn.style.display = "inline-block";
}

async function processOneVideo(bvid, folder, nameFormat, startOrder) {
  // 通过 background.js 获取视频数据
  const data = await sendMessage({
    type: "batch-fetch-video",
    bvid: bvid
  });

  if (!data || !data.ok) {
    throw new Error(data?.error || "获取视频信息失败");
  }

  const meta = data.meta;
  const pages = data.pages || [];

  // 单集视频：直接处理
  if (pages.length <= 1) {
    const result = await processOnePage(meta, data.subtitleBody, data.chapters, folder, nameFormat, startOrder);
    updateParsedItemStatus(bvid, "success", `✓ ${meta.title}`);
    return [{ ok: true, title: meta.title, order: startOrder }];
  }

  // 分P视频：逐集处理
  const results = [];
  for (let i = 0; i < pages.length; i++) {
    if (!isRunning) {
      for (let j = i; j < pages.length; j++) {
        updateEpisodeStatus(bvid, pages[j].page, "skipped", "已取消");
        results.push({ ok: false, title: `${meta.title} P${pages[j].page}`, order: startOrder + j, error: "已取消" });
      }
      break;
    }

    const page = pages[i];
    const pageTitle = page.part || `第${page.page}集`;
    const currentOrder = startOrder + i;

    updateEpisodeStatus(bvid, page.page, "processing", "处理中...");

    try {
      // 获取每集的字幕
      const pageData = await sendMessage({
        type: "batch-fetch-video",
        bvid: bvid,
        page: page.page
      });

      if (!pageData || !pageData.ok) {
        updateEpisodeStatus(bvid, page.page, "error", `✕ ${pageData?.error || "获取失败"}`);
        results.push({ ok: false, title: `${meta.title} ${pageTitle}`, order: currentOrder, error: pageData?.error || "获取失败" });
        continue;
      }

      await processOnePage(
        { ...meta, ...pageData.meta, pageTitle },
        pageData.subtitleBody,
        pageData.chapters,
        folder,
        nameFormat,
        currentOrder
      );

      updateEpisodeStatus(bvid, page.page, "success", `✓ ${pageTitle}`);
      results.push({ ok: true, title: `${meta.title} ${pageTitle}`, order: currentOrder });
    } catch (error) {
      updateEpisodeStatus(bvid, page.page, "error", `✕ ${error.message}`);
      results.push({ ok: false, title: `${meta.title} ${pageTitle}`, order: currentOrder, error: error.message });
    }

    // 分P之间也要限速
    if (i < pages.length - 1 && isRunning) {
      const delay = Number(el.delayInput.value) || 800;
      await sleep(delay);
    }
  }

  // 更新整行状态
  const allOk = results.every((r) => r.ok);
  if (allOk) {
    updateParsedItemStatus(bvid, "success", `✓ ${meta.title} (${results.length}集)`);
  } else {
    const okCount = results.filter((r) => r.ok).length;
    updateParsedItemStatus(bvid, "error", `${meta.title} (${okCount}/${results.length}集成功)`);
  }

  return results;
}

async function processOnePage(meta, subtitleBody, chapters, folder, nameFormat, order) {
  if (!subtitleBody || !subtitleBody.length) {
    throw new Error("该集无可用字幕");
  }

  // 构建文件名
  const filename = buildFilename(meta, meta.bvid, nameFormat, order);
  const filepath = `${folder}/${filename}.md`;

  // 构建 Markdown
  const markdown = buildMarkdown(meta, subtitleBody, chapters);

  // 写入 Obsidian
  const settings = await getSettings();
  const writeResult = await sendMessage({
    type: "write-obsidian-note",
    baseUrl: settings.obsidianApiBaseUrl || "http://127.0.0.1:27123",
    apiKey: settings.obsidianApiKey || "",
    filepath: filepath,
    content: markdown
  });

  if (!writeResult || !writeResult.ok) {
    throw new Error(writeResult?.error || "写入 Obsidian 失败");
  }

  return { title: meta.title, filepath };
}

function buildFilename(meta, bvid, nameFormat, order) {
  const date = meta.uploadDate || formatDate(new Date());
  const pageTitle = meta.pageTitle || "";
  const rawTitle = pageTitle || meta.title || bvid;
  const safeTitle = rawTitle
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  switch (nameFormat) {
    case "bvid":
      return bvid;
    case "order":
      return `${String(order).padStart(3, "0")}-${safeTitle}`;
    case "date-title":
    default:
      return `${date}-${safeTitle}`;
  }
}

function buildMarkdown(meta, subtitleBody, chapters) {
  const includeTimestamp = true;
  const maxTime = subtitleBody.reduce((max, item) => Math.max(max, Number(item?.to || 0)), 0);
  const withHours = maxTime >= 3600;

  const lines = [];

  // Frontmatter
  lines.push("---");
  lines.push(`title: "${escapeYaml(meta.title || "")}"`);
  lines.push(`url: "${meta.url || ""}"`);
  lines.push(`bvid: "${meta.bvid || ""}"`);
  lines.push(`author: "${escapeYaml(meta.author || "")}"`);
  lines.push(`upload_date: "${meta.uploadDate || ""}"`);
  lines.push(`created: "${formatDate(new Date())}"`);
  lines.push(`tags: [clippings, bilibili]`);
  lines.push("---");
  lines.push("");

  // 章节
  if (chapters.length) {
    lines.push("## 章节");
    lines.push("");
    chapters.forEach((ch) => {
      const stamp = includeTimestamp ? `\`${formatTimestamp(ch.from, withHours)}\` ` : "";
      lines.push(`- ${stamp}${ch.title}`);
    });
    lines.push("");
  }

  // 字幕
  lines.push("## 字幕");
  lines.push("");

  if (chapters.length) {
    // 按章节分组
    const usedIndexes = new Set();
    chapters.forEach((chapter, idx) => {
      const start = Number(chapter.from || 0);
      const next = chapters[idx + 1];
      let end = next ? Number(next.from) : Infinity;
      if (end <= start) end = Infinity;

      const sectionItems = subtitleBody.filter((item) => {
        const from = Number(item.from || 0);
        return from >= start - 0.001 && from < end;
      });

      if (sectionItems.length) {
        const chapterStamp = includeTimestamp ? ` \`${formatTimestamp(start, withHours)}\`` : "";
        lines.push(`### ${chapter.title}${chapterStamp}`);
        lines.push("");
        sectionItems.forEach((item) => {
          usedIndexes.add(item);
          const text = String(item.content || "").trim();
          if (text) {
            lines.push(includeTimestamp ? `\`${formatTimestamp(item.from, withHours)}\` ${text}` : text);
          }
        });
        lines.push("");
      }
    });

    // 剩余字幕
    const remaining = subtitleBody.filter((item) => !usedIndexes.has(item));
    if (remaining.length) {
      lines.push("### 其他片段");
      lines.push("");
      remaining.forEach((item) => {
        const text = String(item.content || "").trim();
        if (text) {
          lines.push(includeTimestamp ? `\`${formatTimestamp(item.from, withHours)}\` ${text}` : text);
        }
      });
      lines.push("");
    }
  } else {
    // 无章节，直接输出
    subtitleBody.forEach((item) => {
      const text = String(item.content || "").trim();
      if (text) {
        lines.push(includeTimestamp ? `\`${formatTimestamp(item.from, withHours)}\` ${text}` : text);
      }
    });
    lines.push("");
  }

  return lines.join("\n");
}

// ========== 工具函数 ==========

function formatTimestamp(seconds, withHours) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (withHours) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeYaml(str) {
  return String(str || "").replace(/"/g, '\\"');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      // Firefox MV3 用 Promise，Chrome MV3 也支持 Promise
      const result = api.runtime.sendMessage(msg);
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else {
        // 兼容旧版 callback 模式
        resolve(result);
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    api.storage.sync.get(null, (data) => {
      api.storage.local.get(["obsidianApiKey"], (local) => {
        resolve({
          ...data,
          ...local
        });
      });
    });
  });
}

// ========== UI 更新 ==========

function updateProgress(current, total, text) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  el.progressFill.style.width = `${pct}%`;
  el.progressText.textContent = text;
}

function addLog(index, status, text) {
  const statusIcon = status === "success" ? "✓" : status === "error" ? "✕" : "⊘";
  const item = document.createElement("div");
  item.className = `log-item ${status}`;
  setSafeHTML(item, `
    <span class="log-index">${index}.</span>
    <span class="log-status">${statusIcon}</span>
    <span class="log-title">${text}</span>
  `);
  el.logContainer.appendChild(item);
  el.logContainer.scrollTop = el.logContainer.scrollHeight;
}

function showSummary(total, success, failed, skipped) {
  el.summarySection.style.display = "block";
  setSafeHTML(el.summaryContent, `
    <div class="summary-stat">
      <span class="stat-label">总计</span>
      <span class="stat-value total">${total} 集</span>
    </div>
    <div class="summary-stat">
      <span class="stat-label">成功</span>
      <span class="stat-value success">${success} 集</span>
    </div>
    <div class="summary-stat">
      <span class="stat-label">失败</span>
      <span class="stat-value error">${failed} 集</span>
    </div>
    ${skipped ? `<div class="summary-stat">
      <span class="stat-label">跳过</span>
      <span class="stat-value">${skipped} 集</span>
    </div>` : ""}
  `);
}

// ========== 事件绑定 ==========

el.parseBtn.addEventListener("click", parseInput);
el.clearBtn.addEventListener("click", clearAll);
el.startBtn.addEventListener("click", startBatch);
el.cancelBtn.addEventListener("click", cancelBatch);
el.backBtn.addEventListener("click", () => {
  window.close();
});

el.editListBtn.addEventListener("click", () => {
  el.bvidInput.value = parsedBvids.join("\n");
  el.parsedList.style.display = "none";
  el.startBtn.disabled = true;
  parsedBvids = [];
});

// 支持粘贴时自动解析
el.bvidInput.addEventListener("paste", () => {
  setTimeout(parseInput, 100);
});
