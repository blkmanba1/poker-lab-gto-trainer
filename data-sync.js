(() => {
  "use strict";

  const SCHEMA = "poker-lab-local-sync";
  const VERSION = 1;
  const KEYS = {
    history: "poker-lab-history",
    wrongBank: "poker-lab-wrong-questions",
    reviews: "poker-lab-match-reviews",
    profiles: "poker-lab-player-profiles"
  };
  const dialog = document.getElementById("data-sync-dialog");
  const openButton = document.getElementById("data-sync-button");
  if (!dialog || !openButton) return;

  const els = {
    summary: document.getElementById("data-sync-summary"),
    status: document.getElementById("data-sync-status"),
    file: document.getElementById("data-sync-file"),
    export: document.getElementById("data-sync-export"),
    import: document.getElementById("data-sync-import")
  };

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function currentData() {
    return {
      history: read(KEYS.history, { answered: 0, score: 0 }),
      wrongBank: read(KEYS.wrongBank, []),
      reviews: read(KEYS.reviews, []),
      profiles: read(KEYS.profiles, [])
    };
  }

  function number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function statCount(data) {
    return [
      ["练习题", number(data.history.answered)],
      ["错题", array(data.wrongBank).length],
      ["牌谱", array(data.reviews).length],
      ["玩家", array(data.profiles).length]
    ];
  }

  function renderSummary() {
    els.summary.replaceChildren();
    statCount(currentData()).forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "data-sync-stat";
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      item.append(small, strong);
      els.summary.append(item);
    });
  }

  function setStatus(message = "") {
    els.status.textContent = message;
  }

  function exportData() {
    const payload = {
      schema: SCHEMA,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      data: currentData()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `poker-lab-sync-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("同步文件已下载。把这个 JSON 文件传到另一台自己的设备，再导入即可。");
  }

  function timeValue(item) {
    const value = item?.updatedAt || item?.savedAt || item?.timestamp || 0;
    return typeof value === "number" ? value : Date.parse(value) || 0;
  }

  function newer(a, b) {
    const aTime = timeValue(a);
    const bTime = timeValue(b);
    return aTime >= bTime ? a : b;
  }

  function mergeById(localItems, importedItems, limit) {
    const merged = new Map();
    [...array(localItems), ...array(importedItems)].forEach(item => {
      if (!item || typeof item !== "object" || !item.id) return;
      const previous = merged.get(String(item.id));
      merged.set(String(item.id), previous ? newer(item, previous) : item);
    });
    return [...merged.values()]
      .sort((a, b) => timeValue(b) - timeValue(a))
      .slice(0, limit);
  }

  function normalizePayload(value) {
    if (!value || value.schema !== SCHEMA || value.version !== VERSION || !value.data) {
      throw new Error("这不是 POKER LAB 的同步文件");
    }
    const data = value.data;
    return {
      history: {
        answered: Math.max(number(data.history?.answered), 0),
        score: Math.max(number(data.history?.score), 0)
      },
      wrongBank: array(data.wrongBank),
      reviews: array(data.reviews),
      profiles: array(data.profiles)
    };
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const imported = normalizePayload(JSON.parse(String(reader.result)));
        const local = currentData();
        const merged = {
          history: {
            answered: Math.max(number(local.history.answered), imported.history.answered),
            score: Math.max(number(local.history.score), imported.history.score)
          },
          wrongBank: mergeById(local.wrongBank, imported.wrongBank, 200),
          reviews: mergeById(local.reviews, imported.reviews, 20),
          profiles: mergeById(local.profiles, imported.profiles, 200)
        };
        localStorage.setItem(KEYS.history, JSON.stringify(merged.history));
        localStorage.setItem(KEYS.wrongBank, JSON.stringify(merged.wrongBank));
        localStorage.setItem(KEYS.reviews, JSON.stringify(merged.reviews));
        localStorage.setItem(KEYS.profiles, JSON.stringify(merged.profiles));
        renderSummary();
        setStatus("合并完成，页面即将刷新以加载全部数据。");
        window.setTimeout(() => window.location.reload(), 650);
      } catch (error) {
        setStatus(error.message || "同步文件读取失败，请重新选择 JSON 文件。");
      } finally {
        els.file.value = "";
      }
    });
    reader.addEventListener("error", () => {
      els.file.value = "";
      setStatus("同步文件读取失败，请重试。");
    });
    reader.readAsText(file, "utf-8");
  }

  openButton.addEventListener("click", () => {
    renderSummary();
    setStatus("");
    if (!dialog.open) dialog.showModal();
  });
  els.export.addEventListener("click", exportData);
  els.import.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => importData(els.file.files?.[0]));
  document.getElementById("data-sync-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  renderSummary();
})();
