(() => {
  "use strict";
  const base = window.PokerKnowledgeBase;
  if (!base) return;
  const dialog = document.getElementById("knowledge-dialog");
  const search = document.getElementById("knowledge-search");
  const list = document.getElementById("knowledge-document-list");
  const content = document.getElementById("knowledge-document-content");
  const meta = document.getElementById("knowledge-meta");
  if (!dialog || !search || !list || !content) return;

  let selectedId = base.documents[0]?.id;

  function renderMarkdown(text) {
    content.replaceChildren();
    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const node = document.createElement(/^#{1,6}\s/.test(trimmed) ? "h3" : trimmed.startsWith("- ") ? "li" : "p");
      node.textContent = trimmed.replace(/^#{1,6}\s+/, "").replace(/^-\s+/, "");
      if (node.tagName === "LI") {
        let group = content.lastElementChild;
        if (!group || group.tagName !== "UL") {
          group = document.createElement("ul");
          content.append(group);
        }
        group.append(node);
      } else content.append(node);
    });
  }

  function renderDocument(id) {
    const doc = base.get(id);
    if (!doc) return;
    selectedId = doc.id;
    [...list.querySelectorAll("button")].forEach(button => button.toggleAttribute("aria-current", button.dataset.docId === id));
    meta.textContent = `${doc.path} · ${doc.bytes.toLocaleString()} 字节 · ${doc.checksum}`;
    renderMarkdown(doc.content);
  }

  function renderList(query = "") {
    const needle = query.trim().toLowerCase();
    const matches = base.documents.filter(doc => !needle || `${doc.title} ${doc.path} ${doc.content}`.toLowerCase().includes(needle));
    list.replaceChildren();
    matches.forEach(doc => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.docId = doc.id;
      button.textContent = doc.title;
      button.addEventListener("click", () => renderDocument(doc.id));
      list.append(button);
    });
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "knowledge-empty";
      empty.textContent = "没有匹配的知识文档";
      list.append(empty);
    }
    if (matches.length && !matches.some(doc => doc.id === selectedId)) selectedId = matches[0].id;
    if (base.get(selectedId) && matches.some(doc => doc.id === selectedId)) renderDocument(selectedId);
  }

  function openDocument(id) {
    if (!base.get(id)) return;
    renderList(search.value);
    renderDocument(id);
    if (!dialog.open) dialog.showModal();
  }

  document.getElementById("knowledge-button")?.addEventListener("click", () => {
    meta.textContent = `${base.documents.length} 个整理文档 · ${base.scope}`;
    renderList(search.value);
    dialog.showModal();
  });
  document.getElementById("knowledge-close")?.addEventListener("click", () => dialog.close());
  search.addEventListener("input", () => renderList(search.value));
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  window.PokerKnowledgeUI = { openDocument };
})();
