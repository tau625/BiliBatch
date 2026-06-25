// Core subtitle capture and messaging.

let readerModulePromise = null;

function ensureReaderModule() {
  if (globalThis.__BB_READER_LOADED__) {
    return Promise.resolve();
  }
  if (readerModulePromise) {
    return readerModulePromise;
  }
  readerModulePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content-reader.js");
    script.onload = () => {
      globalThis.__BB_READER_LOADED__ = true;
      resolve();
    };
    script.onerror = () => reject(new Error("阅读模式模块加载失败"));
    (document.head || document.documentElement).appendChild(script);
  });
  return readerModulePromise;
}

async function enterReaderModeWrapper() {
  await ensureReaderModule();
  return enterReaderMode();
}

function buildVideoMetaForMarkdown() {
  return {
    title: state.title,
    author: state.author,
    uploadDate: state.uploadDate,
    bvid: state.bvid,
    aid: state.aid,
    cid: state.cid,
    url: cleanVideoUrl(),
    pageIndex: state.pageIndex,
    pageCount: state.pageCount,
    pageTitle: state.pageTitle,
    videoDuration: state.videoDuration,
    description: state.description,
    chapters: state.chapters,
    selectedSubtitleLang: state.selectedSubtitleLang
  };
}

function buildMarkdownFromState(body, settings = state.settings) {
  return BiliBatchMarkdown.buildMarkdown(buildVideoMetaForMarkdown(), body, settings);
}

function buildSrtFromState(body) {
  return BiliBatchMarkdown.buildSrt(body);
}

function buildTxtFromState(body, settings = state.settings) {
  return BiliBatchMarkdown.buildTxt(body, settings);
}

function buildSubtitlePreviewFromState(body, settings = state.settings) {
  return BiliBatchMarkdown.buildSubtitlePreview(body, settings);
}
function isReaderMode(url = location.href) {
  try {
    return new URL(url).searchParams.get("bb_reader") === "1";
  } catch {
    return false;
  }
}

function stripReaderModeUrl(url = location.href) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("bb_reader");
    return parsed.toString();
  } catch {
    return url;
  }
}

function replaceReaderModeUrl(nextUrl) {
  const targetUrl = String(nextUrl || "").trim();
  if (!targetUrl || targetUrl === location.href) {
    return;
  }

  try {
    history.replaceState(history.state, "", targetUrl);
    state.currentUrl = location.href;
    state.currentClipSignature = computeCurrentClipSignature(location.href);
  } catch (error) {
    logWarn("[BiliBatch] failed to replace reader mode url", error);
  }
}

function isWatchlaterPage(url = location.href) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "/list/watchlater";
  } catch {
    return false;
  }
}

function init() {
  console.info(`[BiliBatch] content script init, version=${BB_VERSION}`, location.href);
  ensureUiReady({ forceRecreate: true });

  // installReaderDebugHelpers / hydrateReaderStateFromSettings / applyReadingViewPresentation
  // live in content-reader.js which is lazy-loaded. Guard all reader-only calls.
  if (typeof installReaderDebugHelpers === "function") {
    installReaderDebugHelpers();
  }

  const shouldEnterReaderMode = isReaderMode();
  if (shouldEnterReaderMode) {
    document.documentElement.setAttribute("data-boc-reader-mode", "1");
    document.body.setAttribute("data-boc-reader-mode", "1");
  }

  bindRuntimeEvents();
  startUrlWatcher();
  getSettings().then((settings) => {
    state.settings = settings;
    if (typeof hydrateReaderStateFromSettings === "function") {
      hydrateReaderStateFromSettings(settings);
    }
    if (typeof applyReadingViewPresentation === "function") {
      applyReadingViewPresentation();
    }
    if (shouldEnterReaderMode) {
      enterReaderModeWrapper().catch((error) => {
        if (typeof renderReadingStatus === "function") {
          renderReadingStatus(`阅读视图启动失败：${getErrorMessage(error)}`);
        }
      });
    }
  });
}

function bindRuntimeEvents() {
  if (state.runtimeEventsBound) {
    return;
  }
  state.runtimeEventsBound = true;
  console.info("[BiliBatch] message listener registered");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "popup-get-state") {
      sendResponse({ ok: true, payload: getPopupPayload() });
      return false;
    }

    if (message.type === "popup-refresh") {
      refreshClip()
        .then(() => sendResponse({ ok: true, payload: getPopupPayload() }))
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-select-subtitle") {
      const url = String(message.url || "").trim();
      const lang = String(message.lang || "unknown");
      const subtitleId = String(message.subtitleId || "");
      if (!url) {
        sendResponse({ ok: false, error: "Missing subtitle URL", payload: getPopupPayload() });
        return false;
      }
      loadSubtitle(url, lang, state.fetchRunId, subtitleId)
        .then(() => {
          setStatus("字幕切换完成。");
          renderSubtitleSelect();
          sendResponse({ ok: true, payload: getPopupPayload() });
        })
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-send-obsidian") {
      sendToObsidian()
        .then(() => sendResponse({ ok: true, payload: getPopupPayload() }))
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-trigger-reading-view") {
      ensureUiReady();
      const readerUrl = String(message.readerUrl || "").trim();
      if (readerUrl) {
        replaceReaderModeUrl(readerUrl);
        document.documentElement.setAttribute("data-boc-reader-mode", "1");
        document.body.setAttribute("data-boc-reader-mode", "1");
      }
      if (!state.readingViewOpen) {
        enterReaderModeWrapper().catch((error) => {
          logWarn("[BiliBatch] reading mode trigger failed", error);
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "sidepanel-get-context") {
      const settings = state.settings || DEFAULT_SETTINGS;
      const body = state.subtitleBody || [];
      let subtitleMarkdown = "";
      try {
        subtitleMarkdown = body.length ? buildMarkdownFromState(body, settings) : "";
      } catch (e) {
        subtitleMarkdown = "";
        logWarn("[BiliBatch] sidepanel-get-context: buildMarkdown failed", e);
      }
      sendResponse({
        ok: true,
        payload: {
          url: location.href,
          title: state.title || "",
          author: state.author || "",
          uploadDate: state.uploadDate || "",
          bvid: state.bvid || "",
          cid: state.cid || "",
          aid: state.aid || "",
          pageIndex: Number(state.pageIndex) > 0 ? Number(state.pageIndex) : 1,
          pageCount: Number(state.pageCount) > 0 ? Number(state.pageCount) : 0,
          pageTitle: state.pageTitle || "",
          subtitleBody: body,
          subtitleMarkdown,
          subtitleLang: state.selectedSubtitleLang || "",
          selectedSubtitleId: state.selectedSubtitleId || "",
          selectedSubtitleUrl: state.selectedSubtitleUrl || "",
          subtitleOptions: state.subtitles || [],
          hotComments: []
        }
      });
      return false;
    }

    if (message.type === "sidepanel-get-hot-comments") {
      const count = 20; // 固定取前 20 条热门评论
      if (!count) {
        sendResponse({ ok: true, comments: [] });
        return false;
      }

      let aid = Number(state.aid) || 0;
      if (!aid && typeof window !== "undefined") {
        try {
          aid = Number(window?.__INITIAL_STATE__?.aid) || 0;
        } catch {}
      }
      if (!aid) {
        sendResponse({ ok: true, comments: [], note: "无法获取视频 aid" });
        return false;
      }

      const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3&ps=${count}&pn=1`;
      sendRuntimeMessage({ type: "fetch-json", url })
        .then((resp) => {
          if (!resp?.ok) {
            sendResponse({ ok: true, comments: [], note: resp?.error || "评论接口失败" });
            return;
          }
          const replies = Array.isArray(resp?.data?.data?.replies) ? resp.data.data.replies : [];
          const hotComments = replies.slice(0, count).map((r) => ({
            uname: r?.member?.uname || "匿名",
            like: r?.like || 0,
            message: String(r?.content?.message || "").slice(0, 500)
          }));
          sendResponse({ ok: true, comments: hotComments });
        })
        .catch((error) => {
          sendResponse({ ok: true, comments: [], note: String(error?.message || error) });
        });
      return true;
    }

    if (message.type === "sidepanel-seek-video-time") {
      const seconds = Number(message.seconds);
      const video = typeof getRuntimeVideoElement === "function" ? getRuntimeVideoElement() : document.querySelector("video");
      if (!video) {
        sendResponse({ ok: false, error: "当前页面没有找到可联动的视频播放器。" });
        return false;
      }
      const nextTime = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
      const wasPaused = Boolean(video.paused);
      video.currentTime = nextTime;
      if (!wasPaused) {
        video.play().catch(() => {});
      }
      if (state.readingViewOpen) {
        state.readingManualScrollPauseUntil = 0;
        state.readingNextScrollBehavior = "auto";
        if (typeof updateReaderFollowState === "function") updateReaderFollowState();
        if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
      }
      sendResponse({ ok: true, currentTime: nextTime });
      return false;
    }

    return false;
  });
}

function startUrlWatcher() {
  if (state.urlWatcherStarted) {
    return;
  }
  state.urlWatcherStarted = true;

  setManagedInterval("url-watcher", () => {
    const nextUrl = location.href;
    const nextSignature = computeCurrentClipSignature();
    if (nextSignature === state.currentClipSignature) {
      return;
    }

    state.currentUrl = nextUrl;
    state.currentClipSignature = nextSignature;
    ensureUiReady();
    resetClipState();
    const shouldEnterReaderMode = isReaderMode(nextUrl);
    if (!state.readingViewOpen && shouldEnterReaderMode) {
      document.documentElement.setAttribute("data-boc-reader-mode", "1");
      document.body.setAttribute("data-boc-reader-mode", "1");
      if (typeof renderReadingStatus === "function") renderReadingStatus("检测到阅读视图跳转，正在打开阅读模式...");
      enterReaderModeWrapper().catch((error) => {
        if (typeof renderReadingStatus === "function") renderReadingStatus(`阅读视图启动失败：${getErrorMessage(error)}`);
      });
      return;
    }
    if (state.readingViewOpen || shouldEnterReaderMode) {
      if (typeof renderReadingStatus === "function") renderReadingStatus("检测到视频变化，正在自动刷新字幕...");
      const waitForMeta = typeof waitForVideoMetadata === "function" ? waitForVideoMetadata() : Promise.resolve();
      waitForMeta.then(() => {
        refreshClip().catch((error) => {
          if (!isStaleRunError(error) && typeof renderReadingStatus === "function") {
            renderReadingStatus(`自动刷新失败：${getErrorMessage(error)}`);
          }
        });
      });
      return;
    }
    setStatus("检测到页面变化，请点击「刷新抓取」加载当前视频字幕。");
  }, 1200);
}

function resetClipState() {
  clearAllManagedTimers();
  state.bvid = "";
  state.aid = "";
  state.cid = "";
  state.cidSource = "";
  state.pageIndex = 1;
  state.pageCount = 0;
  state.pageTitle = "";
  state.videoDuration = 0;
  state.description = "";
  state.title = "";
  state.author = "";
  state.uploadDate = "";
  state.subtitles = [];
  state.selectedSubtitleId = "";
  state.selectedSubtitleUrl = "";
  state.selectedSubtitleLang = "";
  state.subtitleBody = [];
  state.subtitleFetchState = "idle";
  state.chapters = [];
  state.markdown = "";
  state.srt = "";
  state.txt = "";
  state.currentClipSignature = computeCurrentClipSignature();
  if (typeof stopReadingViewSync === "function") stopReadingViewSync();
  state.readingActiveSubtitleIndex = -1;
  state.readingActiveChapterIndex = -1;
  state.readingVideoEl = null;
  if (typeof stopReaderPlayerObserver === "function") stopReaderPlayerObserver();

  renderMeta();
  renderSubtitleSelect();
  const previewEl = byId(ids.preview);
  if (previewEl) previewEl.value = "";
  setMessage("");
  if (state.readingViewOpen) {
    if (typeof renderReadingView === "function") renderReadingView();
    if (typeof renderReadingStatus === "function") renderReadingStatus("请先点击「刷新抓取」加载当前视频字幕。");
  }
}

async function refreshClip() {
  const runId = ++state.fetchRunId;
  try {
    setBusyState(true);
    setMessage("");
    setStatus("正在抓取视频信息...");
    state.subtitleFetchState = "loading";
    if (state.readingViewOpen && typeof renderReadingView === "function") {
      renderReadingView();
    }
    state.settings = await getSettings();
    ensureRunActive(runId);

    state.bvid = extractBvid(location.href);
    if (!state.bvid) {
      throw new Error("当前页面不是标准 BV 视频地址，无法抓取字幕。");
    }

    const pageIndex = extractPageIndex(location.href);
    const oid = extractOid(location.href);
    const hasPageParam = hasExplicitPageParam(location.href);
    const meta = await retryAsync(() => fetchVideoMeta(state.bvid), 2, 250);
    ensureRunActive(runId);

    // 调试：打印 API 返回的原始数据
    logInfo("[BiliBatch] raw meta data", {
      meta,
      defaultCid: meta.defaultCid,
      pagesCount: (meta.pages || []).length
    });

    state.aid = meta.aid || "";
    state.title = meta.title || readVideoTitle();
    state.author = meta.author || readVideoAuthor();
    state.uploadDate = meta.uploadDate || readUploadDate();
    state.description = meta.description || readVideoDescription();
    state.pageCount = Array.isArray(meta.pages) ? meta.pages.length : 0;
    state.currentClipSignature = computeCurrentClipSignature();
    let resolvedPageIndex = pageIndex;
    if ((meta.pages || []).length > 1 && !hasPageParam) {
      const pageIndexFromOid = pickPageIndexFromOid(meta.pages, oid);
      if (pageIndexFromOid > 0) {
        resolvedPageIndex = pageIndexFromOid;
        logInfo("[BiliBatch] resolved page index from oid", {
          oid,
          resolvedPageIndex
        });
      } else {
        // B 站多分P中，P1 常见为无 ?p= 参数；watchlater 等页面可能改用 oid 标识当前分P。
        resolvedPageIndex = 1;
        logInfo("[BiliBatch] multi-page video without p param or valid oid, fallback to P1", {
          oid
        });
      }
    }

    const currentPage = pickPageFromPages(meta.pages, resolvedPageIndex);
    state.pageIndex = resolvedPageIndex;
    state.pageTitle = currentPage?.part || "";
    state.cid = currentPage?.cid || pickCidFromPages(meta.pages, resolvedPageIndex, meta.defaultCid);
    state.cidSource = "meta-pages";
    state.videoDuration = pickDurationFromPages(meta.pages, resolvedPageIndex, meta.defaultDuration);
    if (!(state.videoDuration > 0)) {
      state.videoDuration = readRuntimeVideoDuration();
    }
    if (!(state.videoDuration > 0)) {
      throw new Error("无法获取当前视频时长，已停止抓取以避免串到错误字幕。");
    }

    logInfo("[BiliBatch] resolved video ids", {
      url: location.href,
      aid: state.aid,
      bvid: state.bvid,
      cid: state.cid,
      cidSource: state.cidSource,
      pageIndex: resolvedPageIndex,
      videoDuration: state.videoDuration
    });

    setStatus("正在获取可用字幕...");
    let subtitleBundle = await retryAsync(
      () => fetchSubtitleBundle(state.bvid, state.cid, state.aid),
      3,
      500
    );
    ensureRunActive(runId);
    state.subtitles = normalizeSubtitleTracks(subtitleBundle.tracks);
    state.chapters = normalizeChapters(subtitleBundle.chapters);
    logInfo(
      "[BiliBatch] chapters",
      state.chapters.map((item) => ({
        from: item.from,
        to: item.to,
        title: item.title
      }))
    );
    logInfo(
      "[BiliBatch] subtitle tracks",
      state.subtitles.map((item) => ({
        id: item.id,
        lan: item.lan,
        lanDoc: item.lanDoc,
        url: item.subtitleUrl
      }))
    );

    // 无字幕时也允许进入阅读视图，只是字幕区域保持空态。
    if (state.subtitles.length === 0) {
      applyNoSubtitleState();
      renderMeta();
      renderSubtitleSelect();
      if (state.readingViewOpen) {
        if (typeof moveReadingMainInline === "function") moveReadingMainInline();
        if (typeof renderReadingView === "function") renderReadingView();
        if (typeof renderReadingStatus === "function") renderReadingStatus("当前视频无字幕。");
        if (typeof startReadingViewSync === "function") startReadingViewSync();
        if (typeof startReaderPlayerObserver === "function") startReaderPlayerObserver();
        if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
      }
      setStatus("当前视频无字幕。");
      return;
    }

    // 显式点击「刷新抓取」时默认走网络，避免命中历史缓存导致字幕错位。
    const forceRefresh = true;

    const preferred = pickPreferredSubtitle(state.subtitles, {
      previousId: state.selectedSubtitleId,
      previousUrl: state.selectedSubtitleUrl,
      previousLang: state.selectedSubtitleLang
    });

    if (!preferred) {
      applyNoSubtitleState();
      renderMeta();
      renderSubtitleSelect();
      if (state.readingViewOpen) {
        if (typeof moveReadingMainInline === "function") moveReadingMainInline();
        if (typeof renderReadingView === "function") renderReadingView();
        if (typeof renderReadingStatus === "function") renderReadingStatus("当前视频无字幕。");
        if (typeof startReadingViewSync === "function") startReadingViewSync();
        if (typeof startReaderPlayerObserver === "function") startReaderPlayerObserver();
        if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
      }
      setStatus("当前视频无字幕。");
      return;
    }

    const candidates = buildSubtitleCandidates(state.subtitles, preferred);
    let selected = null;

    try {
      selected = await tryLoadSubtitleCandidates(candidates, runId, forceRefresh);
    } catch (error) {
      const message = getErrorMessage(error, "");
      if (!message.includes("HTTP") && error?.code !== "SUBTITLE_DURATION_MISMATCH") {
        throw error;
      }

      // Retry because subtitle signed URLs may expire quickly or hit rate limit.
      subtitleBundle = await retryAsync(
        () => fetchSubtitleBundle(state.bvid, state.cid, state.aid),
        2,
        500
      );
      ensureRunActive(runId);
      state.subtitles = normalizeSubtitleTracks(subtitleBundle.tracks);
      state.chapters = normalizeChapters(subtitleBundle.chapters);
      const retryPreferred = pickPreferredSubtitle(state.subtitles, {
        previousId: preferred.id,
        previousUrl: preferred.subtitleUrl,
        previousLang: preferred.lanDoc || preferred.lan || ""
      });
      if (!retryPreferred) {
        throw error;
      }
      const retryCandidates = buildSubtitleCandidates(state.subtitles, retryPreferred);
      selected = await tryLoadSubtitleCandidates(retryCandidates, runId, forceRefresh);
    }
    ensureRunActive(runId);
    if (selected) {
      logInfo("[BiliBatch] selected subtitle track", {
        id: selected.id,
        lan: selected.lan,
        lanDoc: selected.lanDoc
      });
    }
    state.subtitleFetchState = "ready";
    renderMeta();
    renderSubtitleSelect();
    if (state.readingViewOpen) {
      if (typeof moveReadingMainInline === "function") moveReadingMainInline();
      if (typeof renderReadingView === "function") renderReadingView();
      if (typeof renderReadingStatus === "function") renderReadingStatus("抓取完成，阅读视图已同步最新字幕。");
      if (typeof startReadingViewSync === "function") startReadingViewSync();
      if (typeof startReaderPlayerObserver === "function") startReaderPlayerObserver();
      if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
    }
    setStatus("抓取完成，可以复制、下载或发送到 Obsidian。");
  } catch (error) {
    if (isStaleRunError(error)) {
      return;
    }
    state.subtitleFetchState = "error";
    resetClipState();
    state.subtitleFetchState = "error";
    if (state.readingViewOpen && typeof renderReadingView === "function") {
      renderReadingView();
    }
    if (error?.code === "SUBTITLE_DURATION_MISMATCH") {
      setStatus("抓取失败：未找到与当前视频时长匹配的字幕轨，可能该视频无可用字幕。");
      return;
    }
    setStatus(`抓取失败：${getErrorMessage(error)}`);
  } finally {
    if (runId === state.fetchRunId) {
      setBusyState(false);
    }
  }
}

async function onSubtitleChange(event) {
  const value = event.target.value;
  const option = event.target.options[event.target.selectedIndex];
  const lang = option?.dataset.lang || "unknown";
  const subtitleId = option?.dataset.id || "";
  if (!value) {
    return;
  }

  try {
    setBusyState(true);
    setStatus(`正在切换字幕：${lang}`);
    setMessage("");
    await loadSubtitle(value, lang, state.fetchRunId, subtitleId);
    setStatus("字幕切换完成。");
  } catch (error) {
    if (isStaleRunError(error)) {
      return;
    }
    setStatus(`切换字幕失败：${getErrorMessage(error)}`);
  } finally {
    setBusyState(false);
  }
}

async function loadSubtitle(url, lang, runId = state.fetchRunId, subtitleId = "", forceRefresh = false) {
  if (!url) {
    throw new Error("字幕 URL 为空。");
  }

  const cacheKey = getSubtitleCacheKey({
    bvid: state.bvid,
    cid: state.cid,
    subtitleId,
    subtitleUrl: url,
    lang
  });

  // 尝试从缓存读取
  if (!forceRefresh) {
    const cachedBody = await loadSubtitleFromCache(cacheKey);
    if (cachedBody && Array.isArray(cachedBody) && cachedBody.length > 0) {
      const cachedCheck = validateSubtitleByDuration(cachedBody, state.videoDuration);
      if (!cachedCheck.ok) {
        logWarn("[BiliBatch] cached subtitle duration mismatch, clearing cache", {
          cacheKey,
          reason: cachedCheck.reason
        });
        await clearSubtitleCacheByKey(cacheKey);
      } else {
        logInfo("[BiliBatch] using cached subtitle", { cacheKey, itemCount: cachedBody.length });
        ensureRunActive(runId);
        state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
        state.selectedSubtitleUrl = url;
        state.selectedSubtitleLang = lang;
        state.subtitleBody = cachedBody;
        state.subtitleFetchState = "ready";
        state.markdown = buildMarkdownFromState(cachedBody);
        state.srt = buildSrt(cachedBody);
        state.txt = buildTxt(cachedBody, state.settings);
        const cachedPreview = byId(ids.preview);
        if (cachedPreview) cachedPreview.value = buildSubtitlePreview(cachedBody, state.settings);
        if (state.readingViewOpen) {
          if (typeof renderReadingView === "function") renderReadingView();
          if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
        }
        return;
      }
    }
  }

  // 从网络获取
  const subtitle = await fetchSubtitleBody(url);
  ensureRunActive(runId);
  const body = Array.isArray(subtitle.body) ? subtitle.body : [];
  if (body.length === 0) {
    throw new Error("字幕文件为空。");
  }
  const durationCheck = validateSubtitleByDuration(body, state.videoDuration);
  if (!durationCheck.ok) {
    const mismatchError = new Error("字幕时长与当前视频不匹配。");
    mismatchError.code = "SUBTITLE_DURATION_MISMATCH";
    mismatchError.details = durationCheck;
    throw mismatchError;
  }

  // 存入缓存
  await saveSubtitleToCache(cacheKey, body);

  state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
  state.selectedSubtitleUrl = url;
  state.selectedSubtitleLang = lang;
  state.subtitleBody = body;
  state.subtitleFetchState = "ready";
  state.markdown = buildMarkdownFromState(body);
  state.srt = buildSrtFromState(body);
  state.txt = buildTxtFromState(body);
  const loadPreview = byId(ids.preview);
  if (loadPreview) loadPreview.value = buildSubtitlePreview(body, state.settings);
  if (state.readingViewOpen) {
    if (typeof renderReadingView === "function") renderReadingView();
    if (typeof syncReadingViewPlayback === "function") syncReadingViewPlayback(true);
  }
}

function getSubtitleCacheKey({ bvid, cid, subtitleId = "", subtitleUrl = "", lang = "" }) {
  return `${bvid}_${cid}_${subtitleId || subtitleUrl || lang}`;
}

function buildSubtitleSourceKey(subtitleId, subtitleUrl, lang) {
  const id = String(subtitleId || "").trim();
  if (id) {
    return `id_${id}`;
  }

  const normalizedUrl = normalizeSubtitleUrlForCache(subtitleUrl);
  if (normalizedUrl) {
    return `url_${normalizedUrl}`;
  }

  return `lang_${String(lang || "").trim().toLowerCase() || "unknown"}`;
}

function normalizeSubtitleUrlForCache(url) {
  const text = String(url || "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    const path = parsed.pathname.replace(/[^\w/.-]+/g, "_");
    return `${parsed.hostname}${path}`;
  } catch {
    return text.replace(/[^\w/.-]+/g, "_");
  }
}

async function loadSubtitleFromCache(cacheKey) {
  try {
    const result = await chrome.storage.local.get(cacheKey);
    return result[cacheKey]?.body || null;
  } catch {
    return null;
  }
}

async function saveSubtitleToCache(cacheKey, body) {
  try {
    await chrome.storage.local.set({
      [cacheKey]: {
        body,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logWarn("[BiliBatch] failed to save subtitle cache", error);
  }
}

async function clearSubtitleCacheByKey(cacheKey) {
  try {
    await chrome.storage.local.remove(cacheKey);
  } catch (error) {
    logWarn("[BiliBatch] failed to clear subtitle cache by key", { cacheKey, error });
  }
}

async function clearSubtitleCache(bvid, cid, lang) {
  const cacheKey = getSubtitleCacheKey({ bvid, cid, lang });
  try {
    await chrome.storage.local.remove(cacheKey);
    logInfo("[BiliBatch] cleared subtitle cache", { cacheKey });
  } catch (error) {
    logWarn("[BiliBatch] failed to clear subtitle cache", error);
  }
}

function renderMeta() {
  const meta = byId(ids.meta);
  if (!meta) return;
  if (!state.bvid) {
    setSafeHTML(meta, '<div class="boc-meta-item">尚未抓取视频信息</div>');
    return;
  }

  const subtitleCount = state.subtitles.length;
  setSafeHTML(meta, `
    <div class="boc-meta-item"><strong>标题：</strong>${escapeHtml(state.title)}</div>
    <div class="boc-meta-item"><strong>URL：</strong>${escapeHtml(cleanVideoUrl())}</div>
    <div class="boc-meta-item"><strong>作者：</strong>${escapeHtml(state.author || "未知")}</div>
    <div class="boc-meta-item"><strong>日期：</strong>${escapeHtml(state.uploadDate || "未知")}</div>
    <div class="boc-meta-item"><strong>字幕轨：</strong>${subtitleCount}</div>
  `);
}

function renderSubtitleSelect() {
  const select = byId(ids.subtitleSelect);
  if (!select) return;
  const subtitles = state.subtitles || [];

  if (subtitles.length === 0) {
    setSafeHTML(select, '<option value="">暂无字幕</option>');
    select.disabled = true;
    return;
  }

  setSafeHTML(select, subtitles
    .map((item) => {
      const selectedById =
        state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
      const selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
      const selected = selectedById || selectedByUrl ? "selected" : "";
      const label = item.lanDoc || item.lan || "unknown";
      const isAi = isAiSubtitle(item);
      const aiTag = isAi ? " [AI自动]" : "";
      const optionLabel = `${label}${aiTag}`;
      return `<option value="${escapeHtml(item.subtitleUrl)}" data-lang="${escapeHtml(
        label
      )}" data-id="${escapeHtml(String(item.id || ""))}" data-isai="${isAi}" ${selected}>${escapeHtml(
        optionLabel
      )}</option>`;
    })
    .join(""));
  select.disabled = false;
}

function getPopupPayload() {
  const subtitleOptions = (state.subtitles || []).map((item) => {
    const label = item.lanDoc || item.lan || "unknown";
    const isAi = isAiSubtitle(item);
    const selectedById =
      state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
    const selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
    return {
      id: String(item.id || ""),
      url: item.subtitleUrl,
      lang: label,
      isAi,
      selected: selectedById || selectedByUrl
    };
  });

  return {
    contentVersion: BB_VERSION,
    url: cleanVideoUrl(),
    title: state.title || "",
    author: state.author || "",
    uploadDate: state.uploadDate || "",
    tags: String(state.settings?.tags || ""),
    status: state.statusText || "",
    message: state.messageText || "",
    subtitlePreview: buildSubtitlePreviewFromState(state.subtitleBody || [], state.settings || DEFAULT_SETTINGS),
    markdown: state.markdown || "",
    srt: state.srt || "",
    txt: state.txt || "",
    downloadFormat: BiliBatchMarkdown.normalizeDownloadFormat(state.settings?.downloadFormat),
    subtitleOptions
  };
}

async function copyMarkdown() {
  if (!state.markdown) {
    setMessage("没有可复制的内容，请先刷新抓取。");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.markdown);
    setMessage("Markdown 已复制到剪贴板。");
  } catch (error) {
    setMessage(`复制失败：${getErrorMessage(error)}`);
  }
}

async function downloadSubtitle() {
  state.settings = await getSettings();
  const format = BiliBatchMarkdown.normalizeDownloadFormat(state.settings?.downloadFormat);
  const content = format === "txt" ? state.txt : state.srt;
  if (!content) {
    setMessage("没有可下载的字幕，请先刷新抓取。");
    return;
  }

  const safeTitle = BiliBatchMarkdown.sanitizeFileName(state.title || state.bvid || "bilibili-subtitle");
  const langSuffix = BiliBatchMarkdown.sanitizeFileName(state.selectedSubtitleLang || "subtitle") || "subtitle";
  const filename = `${safeTitle}.${langSuffix}.${format}`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setMessage(`已下载：${filename}`);
}

async function sendToObsidian() {
  state.settings = await getSettings();
  if (!state.markdown) {
    setMessage("没有可发送内容，请先刷新抓取。");
    return;
  }

  const filename = BiliBatchMarkdown.buildNoteFilename(state);
  const folder = BiliBatchMarkdown.normalizeFolder(state.settings.noteFolder || "");
  const filepath = folder ? `${folder}/${filename}` : filename;
  const baseUrl = String(state.settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(state.settings.obsidianApiKey || "").trim();
  if (!baseUrl || !apiKey) {
    setMessage("请先在设置中填写 Obsidian Local REST API 地址和 API Key。");
    requestOpenOptions();
    return;
  }

  try {
    await writeNoteByLocalApi(baseUrl, apiKey, filepath, state.markdown);
    setMessage(`已写入 Obsidian：${filepath}`);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setMessage("扩展刚刚更新，请刷新当前页面后重试。");
      return;
    }
    setMessage(`写入失败：${getErrorMessage(error)}`);
  }
}

async function writeNoteByLocalApi(baseUrl, apiKey, filepath, content) {
  const resp = await sendRuntimeMessage({
    type: "write-obsidian-note",
    baseUrl,
    apiKey,
    filepath,
    content
  });
  if (!resp?.ok) {
    throw new Error(toReadableText(resp?.error, "Local API 写入失败"));
  }
}

function setBusyState(disabled) {
  const copyBtn = byId(ids.copyBtn);
  if (copyBtn) copyBtn.disabled = disabled;
  const downloadBtn = byId(ids.downloadBtn);
  if (downloadBtn) downloadBtn.disabled = disabled;
  const sendBtn = byId(ids.sendBtn);
  if (sendBtn) sendBtn.disabled = disabled;
  const refreshBtn = byId(ids.refreshBtn);
  if (refreshBtn) refreshBtn.disabled = disabled;
  const settingsBtn = byId(ids.settingsBtn);
  if (settingsBtn) settingsBtn.disabled = disabled;
  const subtitleSelect = byId(ids.subtitleSelect);
  if (subtitleSelect) subtitleSelect.disabled = disabled || state.subtitles.length === 0;
}

function setStatus(text) {
  state.statusText = String(text || "");
  const statusEl = byId(ids.status);
  if (statusEl) statusEl.textContent = state.statusText;
}

function setMessage(text) {
  state.messageText = String(text || "");
  const messageEl = byId(ids.message);
  if (messageEl) messageEl.textContent = state.messageText;
}

function applyNoSubtitleState() {
  state.selectedSubtitleId = "";
  state.selectedSubtitleUrl = "";
  state.selectedSubtitleLang = "";
  state.subtitleBody = [];
  state.subtitleFetchState = "empty";
  state.markdown = "";
  state.srt = "";
  state.txt = "";
  const noSubPreview = byId(ids.preview);
  if (noSubPreview) noSubPreview.value = "";
}

function computeCurrentClipSignature(url = location.href) {
  const bvid = extractBvid(url);
  const page = extractPageIndex(url);
  return [bvid, page].map((item) => String(item || "").trim()).join("|");
}

function toReadableText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "[object Object]") {
      return fallback;
    }
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}") {
      return json;
    }
  } catch {
    // ignore
  }
  const text = String(value);
  if (!text || text === "[object Object]") {
    return fallback;
  }
  return text;
}

function getErrorMessage(error, fallback = "未知错误") {
  const code = toReadableText(error?.code, "");
  const message = toReadableText(error?.message, "");
  if (message) {
    return code ? `${message} (code: ${code})` : message;
  }
  if (code) {
    return `code: ${code}`;
  }
  return toReadableText(error, fallback);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isExtensionContextInvalidated(error) {
  const msg = String(error?.message || "");
  return msg.includes("Extension context invalidated");
}

function requestOpenOptions() {
  sendRuntimeMessage({ type: "open-options" })
    .then((resp) => {
      if (!resp?.ok) {
        setMessage(`打开设置失败：${toReadableText(resp?.error, "未知错误")}`);
      }
    })
    .catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        setMessage("扩展刚刚更新，请刷新当前页面后重试。");
        return;
      }
      setMessage(`打开设置失败：${getErrorMessage(error)}`);
    });
}

async function getSettings() {
  try {
    const response = await sendRuntimeMessage({ type: "get-settings" });
    if (!response?.ok) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(response.settings || {}) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

// byId moved to content-shared.js (returns null instead of throwing)

function extractBvid(url) {
  const match = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (match?.[1]) {
    return match[1];
  }

  try {
    const parsed = new URL(url);
    const fromQuery = String(parsed.searchParams.get("bvid") || "").trim();
    if (/^BV[0-9A-Za-z]+$/.test(fromQuery)) {
      return fromQuery;
    }
  } catch {
    // ignore invalid URL
  }

  return "";
}

function cleanVideoUrl(href = location.href) {
  try {
    const parsed = new URL(href);
    if (parsed.hostname !== "www.bilibili.com") {
      return href;
    }

    if (parsed.pathname === "/list/watchlater" || parsed.pathname === "/list/watchlater/") {
      const bvid = extractBvid(href);
      if (bvid) {
        return `https://www.bilibili.com/video/${bvid}/`;
      }
      return href;
    }

    const bvid = extractBvid(href);
    if (!bvid) {
      return href;
    }
    const p = parsed.searchParams.get("p");
    const qs = p ? `?p=${encodeURIComponent(p)}` : "";
    return `https://www.bilibili.com/video/${bvid}/${qs}`;
  } catch {
    return href;
  }
}

function extractPageIndex(url) {
  try {
    const page = Number(new URL(url).searchParams.get("p") || "1");
    if (!Number.isFinite(page) || page <= 0) {
      return 1;
    }
    return page;
  } catch {
    return 1;
  }
}

function hasExplicitPageParam(url) {
  try {
    return new URL(url).searchParams.has("p");
  } catch {
    return false;
  }
}

function extractOid(url) {
  try {
    return String(new URL(url).searchParams.get("oid") || "").trim();
  } catch {
    return "";
  }
}

function ensureRunActive(runId) {
  if (runId !== state.fetchRunId) {
    const error = new Error("Stale refresh run");
    error.code = "STALE_RUN";
    throw error;
  }
}

function isStaleRunError(error) {
  return error?.code === "STALE_RUN";
}

async function retryAsync(task, retries = 1, delayMs = 180) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      // 如果不是网络错误也不是可重试的业务错误，立即抛出
      const isNetworkError = isRetryableNetworkError(error);
      const isRetryable = error?.retryable === true;
      if (!isNetworkError && !isRetryable) {
        throw error;
      }
      if (attempt >= retries) {
        throw error;
      }
      // 指数退避：delayMs * 2^(attempt-1)，最多等待 5 秒
      const backoffDelay = Math.min(delayMs * Math.pow(2, attempt - 1), 5000);
      logInfo(`[BiliBatch] retrying after ${backoffDelay}ms, attempt ${attempt + 1}/${retries}`, {
        error: getErrorMessage(error),
        code: error.code
      });
      await sleep(backoffDelay);
    }
  }
  throw lastError || new Error("Unknown retry error");
}

function isRetryableNetworkError(error) {
  const message = getErrorMessage(error, "").toLowerCase();
  if (!message) {
    return false;
  }

  if (message.includes("http ")) {
    return true;
  }

  return (
    message.includes("请求失败") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("net::") ||
    message.includes("background fetch failed") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

async function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchVideoMeta(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  logInfo("[BiliBatch] fetch video meta", { url, bvid });
  const payload = await fetchJson(url);
  if (payload.code !== 0) {
    throw new Error(toReadableText(payload?.message, "无法获取视频信息"));
  }

  const data = payload.data || {};
  const pubdate = Number(data.pubdate || 0);
  const uploadDate = pubdate > 0 ? formatLocalDate(pubdate * 1000) : "";
  const pages = Array.isArray(data.pages) ? data.pages : [];

  return {
    aid: data.aid ? String(data.aid) : "",
    title: String(data.title || ""),
    author: String(data.owner?.name || ""),
    description: String(data.desc || ""),
    uploadDate,
    defaultCid: data.cid ? String(data.cid) : "",
    defaultDuration: Number(data.duration || 0) || 0,
    pages: pages.map((item) => ({
      cid: String(item.cid || ""),
      page: Number(item.page || 0) || 0,
      part: String(item.part || "").trim(),
      duration: Number(item.duration || 0) || 0
    }))
  };
}

function pickPageFromPages(pages, pageIndex) {
  const safePageIndex = Number(pageIndex) > 0 ? Number(pageIndex) : 1;
  const safePages = Array.isArray(pages) ? pages : [];
  const pageByIndex = safePages[safePageIndex - 1];
  if (pageByIndex?.cid) {
    return pageByIndex;
  }

  const pageByNo = safePages.find((item) => Number(item.page) === safePageIndex);
  if (pageByNo?.cid) {
    return pageByNo;
  }

  return null;
}

function pickCidFromPages(pages, pageIndex, fallbackCid = "") {
  const matchedPage = pickPageFromPages(pages, pageIndex);
  if (matchedPage?.cid) {
    return String(matchedPage.cid);
  }

  const safePages = Array.isArray(pages) ? pages : [];
  if (safePages[0]?.cid) {
    return String(safePages[0].cid);
  }

  if (fallbackCid) {
    return String(fallbackCid);
  }

  throw new Error("没有找到当前分P的 CID。");
}

function pickPageIndexFromOid(pages, oid) {
  const safeOid = String(oid || "").trim();
  if (!safeOid) {
    return 0;
  }

  const safePages = Array.isArray(pages) ? pages : [];
  const pageByCid = safePages.find((item) => String(item?.cid || "") === safeOid);
  if (pageByCid?.page) {
    return Number(pageByCid.page) || 0;
  }

  return 0;
}

function pickDurationFromPages(pages, pageIndex, fallbackDuration = 0) {
  const matchedPage = pickPageFromPages(pages, pageIndex);
  if (Number(matchedPage?.duration) > 0) {
    return Number(matchedPage.duration);
  }

  const safePages = Array.isArray(pages) ? pages : [];
  if (Number(safePages[0]?.duration) > 0) {
    return Number(safePages[0].duration);
  }

  return Number(fallbackDuration || 0) || 0;
}

function readVideoTitle() {
  const h1 = document.querySelector("h1.video-title");
  if (h1?.textContent?.trim()) {
    return h1.textContent.trim();
  }

  const metaTitle = document.querySelector('meta[property="og:title"]');
  if (metaTitle?.getAttribute("content")) {
    return metaTitle.getAttribute("content").trim();
  }

  return document.title.replace(/_哔哩哔哩_bilibili/i, "").trim();
}

function readVideoAuthor() {
  const owner = document.querySelector(".up-name");
  if (owner?.textContent?.trim()) {
    return owner.textContent.trim();
  }

  const author = document.querySelector('meta[name="author"]');
  return author?.getAttribute("content")?.trim() || "";
}

function readVideoDescription() {
  const descNode = document.querySelector(
    ".desc-info-text, .video-desc .desc-info-text, .video-info-detail .text, .basic-desc-info"
  );
  return descNode?.textContent?.trim() || "";
}

function readUploadDate() {
  const publishNode = document.querySelector('meta[itemprop="uploadDate"]');
  if (publishNode?.getAttribute("content")) {
    return publishNode.getAttribute("content").trim();
  }

  const dateText = document.querySelector(".pubdate-ip-text")?.textContent?.trim();
  if (dateText) {
    return dateText;
  }

  return formatLocalDate();
}

async function fetchSubtitleBundle(bvid, cid, aid = "") {
  const requests = buildSubtitleInfoRequests({ bvid, cid, aid });
  const fetchByRequest = async (request) => {
    logInfo("[BiliBatch] fetch subtitles list", {
      source: request.source,
      url: request.url,
      bvid,
      cid,
      aid
    });

    const payload = await fetchJson(request.url);
    logInfo("[BiliBatch] subtitles API raw response", { source: request.source, payload });
    if (payload.code !== 0) {
      throw buildBiliApiError(payload, "无法获取字幕列表");
    }

    const chapters = mapChaptersFromPlayerData(payload.data);
    const subtitles = mapSubtitleTracks(payload.data?.subtitle?.subtitles || [], request.source);
    const withUrl = subtitles.filter((item) => item.subtitleUrl);
    return { source: request.source, chapters, withUrl };
  };

  if (requests.length === 0) {
    return { tracks: [], chapters: [] };
  }

  const primaryRequest = requests[0];
  try {
    const primaryResult = await fetchByRequest(primaryRequest);
    if (primaryResult.withUrl.length > 0) {
      return { tracks: primaryResult.withUrl, chapters: primaryResult.chapters };
    }
    // 主来源成功但无字幕：直接判定无字幕，不再跨源兜底。
    return { tracks: [], chapters: primaryResult.chapters };
  } catch (primaryError) {
    logWarn("[BiliBatch] subtitles API request failed", {
      source: primaryRequest.source,
      message: getErrorMessage(primaryError)
    });

    // 仅当主来源请求失败时才尝试次来源。
    if (requests.length > 1) {
      const secondaryRequest = requests[1];
      try {
        const secondaryResult = await fetchByRequest(secondaryRequest);
        if (secondaryResult.withUrl.length > 0) {
          logWarn("[BiliBatch] primary subtitles source failed, using fallback source", {
            primary: primaryRequest.source,
            fallback: secondaryRequest.source
          });
          return { tracks: secondaryResult.withUrl, chapters: secondaryResult.chapters };
        }
        return { tracks: [], chapters: secondaryResult.chapters };
      } catch (secondaryError) {
        logWarn("[BiliBatch] fallback subtitles source failed", {
          source: secondaryRequest.source,
          message: getErrorMessage(secondaryError)
        });
        throw secondaryError;
      }
    }

    throw primaryError;
  }
}

function buildSubtitleInfoRequests({ bvid, cid, aid }) {
  const requests = [];

  // 主来源：使用 aid + cid
  if (aid && cid) {
    requests.push({
      source: "aid_cid",
      url: `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`
    });
  }

  // 次来源：使用 bvid + cid
  if (bvid && cid) {
    requests.push({
      source: "bvid_cid",
      url: `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`
    });
  }

  return requests;
}

function buildBiliApiError(payload, fallbackMessage) {
  const msg = toReadableText(payload?.message, fallbackMessage);
  const error = new Error(msg);
  error.code = payload?.code;
  error.retryable = isRetryableError(payload?.code);
  return error;
}

function mapSubtitleTracks(subtitles, source = "unknown") {
  return (subtitles || []).map((item) => ({
    id: item?.id === undefined || item?.id === null ? "" : String(item.id),
    lan: item?.lan || "",
    lanDoc: item?.lan_doc || "",
    subtitleUrl: normalizeSubtitleUrl(item?.subtitle_url || ""),
    source
  }));
}

function mapChaptersFromPlayerData(data) {
  const raw = Array.isArray(data?.view_points) ? data.view_points : [];
  return normalizeChapters(
    raw.map((item) => ({
      title: String(item?.content || item?.title || item?.label || "").trim(),
      from: normalizeChapterTime(item?.from ?? item?.start ?? item?.start_time),
      to: normalizeChapterTime(item?.to ?? item?.end ?? item?.end_time),
      source: "player-view-points"
    }))
  );
}

function normalizeChapterTime(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }

  // 某些接口会返回毫秒级时间戳，这里统一转换成秒。
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

function normalizeChapters(chapters) {
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

function isRetryableError(code) {
  // -509: 请求过于频繁
  // -3: 参数错误（可能是临时性的）
  // 其他负数错误码也可能是临时性的
  return code === -509 || code === -3 || code < 0;
}

function normalizeSubtitleTracks(subtitles) {
  return [...(subtitles || [])].sort((a, b) => {
    const p = subtitlePriority(a) - subtitlePriority(b);
    if (p !== 0) {
      return p;
    }

    const lanA = String(a.lanDoc || a.lan || "").toLowerCase();
    const lanB = String(b.lanDoc || b.lan || "").toLowerCase();
    if (lanA < lanB) {
      return -1;
    }
    if (lanA > lanB) {
      return 1;
    }

    const idA = Number.parseInt(String(a.id || "0"), 10);
    const idB = Number.parseInt(String(b.id || "0"), 10);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
      return idA - idB;
    }

    return String(a.subtitleUrl).localeCompare(String(b.subtitleUrl));
  });
}

function pickPreferredSubtitle(
  subtitles,
  { previousId = "", previousUrl = "", previousLang = "" }
) {
  const tracks = subtitles || [];
  if (!tracks.length) {
    return null;
  }

  // 优先匹配之前的字幕 ID
  if (previousId) {
    const match = tracks.find((t) => String(t.id) === String(previousId));
    if (match) return match;
  }

  // 其次匹配 URL
  if (previousUrl) {
    const normalized = normalizeSubtitleUrlForCache(previousUrl);
    const match = tracks.find((t) => normalizeSubtitleUrlForCache(t.subtitleUrl) === normalized);
    if (match) return match;
  }

  // 再次匹配语言
  if (previousLang) {
    const match = tracks.find((t) => t.lan === previousLang);
    if (match) return match;
  }

  // 默认返回第一个
  return tracks[0];
}

function buildSubtitleCandidates(subtitles, preferred) {
  const tracks = subtitles || [];
  const seen = new Set();
  const list = [];

  const pushUnique = (item) => {
    if (!item) {
      return;
    }
    const key =
      `${String(item.id || "").trim()}|` +
      `${normalizeSubtitleUrlForCache(item.subtitleUrl)}|` +
      `${String(item.lan || "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    list.push(item);
  };

  pushUnique(preferred);
  for (const item of tracks) {
    pushUnique(item);
  }
  return list;
}

async function tryLoadSubtitleCandidates(candidates, runId, forceRefresh) {
  let lastError = null;
  for (const item of candidates || []) {
    try {
      logInfo("[BiliBatch] try subtitle track", {
        id: item.id,
        lan: item.lan,
        lanDoc: item.lanDoc,
        url: item.subtitleUrl
      });
      await loadSubtitle(
        item.subtitleUrl,
        item.lanDoc || item.lan || "unknown",
        runId,
        item.id,
        forceRefresh
      );
      return item;
    } catch (error) {
      lastError = error;
      const reasonCode = toReadableText(error?.code, "");
      const reasonMessage = getErrorMessage(error, "unknown");
      const meta = {
        id: item.id,
        lan: item.lan,
        lanDoc: item.lanDoc,
        reason: reasonCode || reasonMessage
      };
      if (reasonCode === "SUBTITLE_DURATION_MISMATCH") {
        logInfo(`[BiliBatch] subtitle track skipped ${JSON.stringify(meta)}`);
      } else {
        logWarn(`[BiliBatch] subtitle track rejected ${JSON.stringify(meta)}`);
      }
      ensureRunActive(runId);
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("这个视频暂时没有可用字幕。");
}

function isAiSubtitle(item) {
  const lan = String(item?.lan || "").toLowerCase();
  // B站 AI 自动字幕的 lan 以 "ai-" 开头
  return lan.startsWith("ai-");
}

function subtitlePriority(item) {
  const lan = String(item?.lan || "").toLowerCase();
  const label = String(item?.lanDoc || "").toLowerCase();

  // 优先级：中文（包含 AI 中文）-> 英文 -> 其他
  if (lan === "zh-cn" || lan === "zh-hans") {
    return 0;
  }
  if (lan === "zh") {
    return 1;
  }
  if (lan.includes("zh")) {
    return 2;
  }
  if (label.includes("中文")) {
    return 3;
  }

  if (lan === "en" || lan === "en-us" || lan === "en-gb") {
    return 10;
  }
  if (lan.includes("en")) {
    return 11;
  }
  if (label.includes("英文") || label.includes("英语") || label.includes("english")) {
    return 12;
  }

  return 50;
}

function validateSubtitleByDuration(body, videoDuration) {
  const duration = Number(videoDuration || 0);
  if (!Array.isArray(body) || body.length === 0) {
    return { ok: false, reason: "empty", videoDuration: duration, maxTo: 0 };
  }

  let maxTo = 0;
  for (const item of body) {
    const to = Number(item?.to);
    const from = Number(item?.from);
    if (Number.isFinite(to) && to > maxTo) {
      maxTo = to;
    }
    if (Number.isFinite(from) && from > maxTo) {
      maxTo = from;
    }
  }

  if (!(duration > 0)) {
    return { ok: true, reason: "skip-no-video-duration", videoDuration: duration, maxTo };
  }

  const upperTolerance = Math.max(12, duration * 0.15);
  if (maxTo > duration + upperTolerance) {
    return { ok: false, reason: "too-long", videoDuration: duration, maxTo };
  }

  let minCoverageRatio = 0;
  if (duration >= 600) {
    minCoverageRatio = 0.18;
  } else if (duration >= 300) {
    minCoverageRatio = 0.22;
  } else if (duration >= 180) {
    minCoverageRatio = 0.25;
  }

  if (minCoverageRatio > 0 && maxTo < duration * minCoverageRatio) {
    return { ok: false, reason: "too-short", videoDuration: duration, maxTo };
  }

  return { ok: true, reason: "ok", videoDuration: duration, maxTo };
}

function readRuntimeVideoDuration() {
  const video = typeof getRuntimeVideoElement === "function" ? getRuntimeVideoElement() : document.querySelector("video");
  const duration = Number(video?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }
  return 0;
}

async function fetchSubtitleBody(url) {
  logInfo("[BiliBatch] fetch subtitle body", { url });
  return fetchJsonInBackground(url);
}

async function fetchJson(url) {
  if (typeof url === "string" && url.startsWith("https://api.bilibili.com/")) {
    return fetchJsonInBackground(url);
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }

  return response.json();
}

async function fetchJsonInBackground(url) {
  try {
    const resp = await sendRuntimeMessage({ type: "fetch-json", url });
    if (!resp?.ok) {
      throw new Error(toReadableText(resp?.error, "Background fetch failed"));
    }
    return resp.data;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      throw new Error("扩展刚刚更新，请刷新当前页面后重试。");
    }
    throw error;
  }
}

function normalizeSubtitleUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `https://${url.replace(/^\/+/, "")}`;
}

init();