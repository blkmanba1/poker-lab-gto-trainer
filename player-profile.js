(() => {
  "use strict";

  const STORAGE_KEY = "poker-lab-player-profiles";
  const PROFILE_ORDER = ["green", "blue", "red", "yellow"];
  const PROFILES = {
    green: {
      label: "绿色",
      color: "#4eae7b",
      description: "自我保护、风险厌恶；强牌常直接取值，复杂激进线路诈唬较少。"
    },
    blue: {
      label: "蓝色",
      color: "#5d91c9",
      description: "被动、粘滞、喜欢跟注；强牌更可能过牌设陷阱，大额线路诈唬偏少。"
    },
    red: {
      label: "红色",
      color: "#d95d48",
      description: "赢牌欲望强、情绪化进攻；可能过宽诈唬并持续反击。"
    },
    yellow: {
      label: "黄色",
      color: "#d7a13a",
      description: "理性、纪律、主动剥削人口；需要做二阶调整，不机械套标签。"
    }
  };

  const dialog = document.getElementById("player-profile-dialog");
  const openButton = document.getElementById("player-profile-button");
  if (!dialog || !openButton) return;

  const els = {
    board: document.getElementById("player-profile-board"),
    form: document.getElementById("player-profile-form"),
    name: document.getElementById("player-profile-name"),
    note: document.getElementById("player-profile-note"),
    status: document.getElementById("player-profile-status"),
    save: document.getElementById("player-profile-save"),
    cancel: document.getElementById("player-profile-cancel"),
    roster: document.getElementById("player-profile-roster-list")
  };
  const state = { records: load(), selectedProfile: "green", editingId: null };

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(stored) ? stored.filter(isValidRecord).slice(0, 200) : [];
    } catch {
      return [];
    }
  }

  function isValidRecord(record) {
    return record && typeof record.name === "string" && record.name.trim()
      && PROFILE_ORDER.includes(record.profile);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records.slice(0, 200)));
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setStatus(message = "") {
    els.status.textContent = message;
  }

  function selectProfile(profile) {
    if (!PROFILE_ORDER.includes(profile)) return;
    state.selectedProfile = profile;
    renderBoard();
  }

  function renderBoard() {
    els.board.replaceChildren();
    PROFILE_ORDER.forEach(profile => {
      const info = PROFILES[profile];
      const names = state.records.filter(record => record.profile === profile);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `player-profile-card${state.selectedProfile === profile ? " selected" : ""}`;
      card.style.setProperty("--profile-color", info.color);
      card.setAttribute("aria-pressed", String(state.selectedProfile === profile));
      card.innerHTML = `<div class="player-profile-card-head"><h3>${info.label}画像</h3><span class="player-profile-card-count">${names.length} 人</span></div><p>${info.description}</p>`;
      const nameList = document.createElement("div");
      nameList.className = "player-profile-names";
      if (names.length) {
        names.slice(0, 5).forEach(record => {
          const chip = document.createElement("span");
          chip.className = "player-profile-name-chip";
          chip.textContent = record.name;
          nameList.append(chip);
        });
        if (names.length > 5) {
          const more = document.createElement("span");
          more.className = "player-profile-name-chip";
          more.textContent = `+${names.length - 5}`;
          nameList.append(more);
        }
      } else {
        const empty = document.createElement("span");
        empty.className = "player-profile-empty-chip";
        empty.textContent = "还没有记录";
        nameList.append(empty);
      }
      card.append(nameList);
      card.addEventListener("click", () => selectProfile(profile));
      els.board.append(card);
    });
  }

  function renderRoster() {
    els.roster.replaceChildren();
    if (!state.records.length) {
      const empty = document.createElement("p");
      empty.className = "player-profile-roster-empty";
      empty.textContent = "还没有玩家记录。先在左侧输入名字，再点击四个画像中的一个。";
      els.roster.append(empty);
      return;
    }
    PROFILE_ORDER.forEach(profile => {
      const info = PROFILES[profile];
      const records = state.records.filter(record => record.profile === profile);
      if (!records.length) return;
      const group = document.createElement("section");
      group.className = "player-profile-roster-group";
      group.style.setProperty("--profile-color", info.color);
      group.innerHTML = `<div class="player-profile-roster-group-head"><strong>${info.label}画像</strong><span>${records.length} 人</span></div>`;
      records.forEach(record => {
        const row = document.createElement("div");
        row.className = "player-profile-record";
        const main = document.createElement("div");
        main.className = "player-profile-record-main";
        const name = document.createElement("div");
        name.className = "player-profile-record-name";
        name.textContent = record.name;
        main.append(name);
        if (record.note) {
          const note = document.createElement("div");
          note.className = "player-profile-record-note";
          note.title = record.note;
          note.textContent = record.note;
          main.append(note);
        }
        const actions = document.createElement("div");
        actions.className = "player-profile-record-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "编辑";
        edit.addEventListener("click", () => editRecord(record));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete";
        remove.textContent = "删除";
        remove.addEventListener("click", () => removeRecord(record.id));
        actions.append(edit, remove);
        row.append(main, actions);
        group.append(row);
      });
      els.roster.append(group);
    });
  }

  function render() {
    renderBoard();
    renderRoster();
    els.save.textContent = state.editingId ? "保存修改" : "记下玩家";
    els.cancel.hidden = !state.editingId;
  }

  function resetForm() {
    state.editingId = null;
    els.form.reset();
    state.selectedProfile = "green";
    setStatus("");
    render();
  }

  function editRecord(record) {
    state.editingId = record.id;
    state.selectedProfile = record.profile;
    els.name.value = record.name;
    els.note.value = record.note || "";
    setStatus("正在编辑这条玩家记录");
    render();
    els.name.focus();
  }

  function removeRecord(id) {
    state.records = state.records.filter(record => record.id !== id);
    save();
    setStatus("玩家记录已删除");
    render();
  }

  els.form.addEventListener("submit", event => {
    event.preventDefault();
    const name = els.name.value.trim();
    if (!name) {
      setStatus("先输入玩家名字");
      els.name.focus();
      return;
    }
    const note = els.note.value.trim();
    const existing = state.records.find(record => record.id === state.editingId);
    const record = {
      id: state.editingId || newId(),
      name,
      profile: state.selectedProfile,
      note,
      updatedAt: new Date().toISOString()
    };
    state.records = existing
      ? state.records.map(item => item.id === state.editingId ? record : item)
      : [record, ...state.records];
    save();
    resetForm();
    setStatus(existing ? "玩家画像已更新" : "玩家已记下");
    render();
  });

  els.cancel.addEventListener("click", resetForm);
  openButton.addEventListener("click", () => {
    render();
    if (!dialog.open) dialog.showModal();
  });
  document.getElementById("player-profile-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  window.PokerPlayerProfiles = { open: () => openButton.click(), profiles: PROFILES };
  render();
})();
