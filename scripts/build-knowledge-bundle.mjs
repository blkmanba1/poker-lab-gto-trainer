import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../knowledge/", import.meta.url);
const output = new URL("../knowledge-base.js", import.meta.url);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

function titleFor(path) {
  return path.split("/").pop().replace(/\.(md|ps1)$/i, "");
}

const files = await filesUnder(root);
const documents = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  const path = relative(fileURLToPath(root), fileURLToPath(file)).split(sep).join("/");
  documents.push({
    id: path.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, ""),
    path,
    title: titleFor(path),
    section: path.split("/")[0],
    bytes: Buffer.byteLength(content),
    checksum: createHash("sha256").update(content).digest("hex").slice(0, 16),
    content
  });
}

const rules = {
  sequence: ["还原节点", "比较范围", "计算价格", "构造价值/诈唬", "检查阻挡牌"],
  sourceDocuments: ["concepts-核心概念", "topics-翻后决策框架", "topics-玩家画像与剥削", "summaries-一手牌讲解", "summaries-德扑十年理论", "summaries-玩家画像"],
  strategy: {
    multiwayAggressionFactor: 0.72,
    pairedBoardAggressionFactor: 0.86,
    monotoneBoardAggressionFactor: 0.88,
    blockerBluffFactor: 1.12,
    expensiveCallFactor: 0.72,
    cheapCallFactor: 1.12
  }
};

const payload = JSON.stringify({
  version: "knowledge-2026-08-06",
  title: "德州扑克结构化知识库",
  scope: "10 个整理知识文件；不包含原始课程转写稿",
  documents,
  rules
});

const runtime = `(() => {
  const payload = ${payload};
  const normalize = value => String(value || "").toLowerCase().replace(/[\\s，。、“”‘’：:；;（）()]/g, "");
  const terms = query => Array.isArray(query) ? query : String(query || "").split(/[\\s,，、]+/).filter(Boolean);
  function search(query, limit = 5) {
    const wanted = terms(query).map(normalize).filter(Boolean);
    if (!wanted.length) return payload.documents.slice(0, limit).map(doc => ({ id: doc.id, title: doc.title, path: doc.path, section: doc.section, excerpt: doc.content.slice(0, 180) }));
    return payload.documents.map(doc => {
      const haystack = normalize(doc.title + " " + doc.path + " " + doc.content);
      const hits = wanted.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
      const firstTerm = wanted.find(term => haystack.includes(term));
      const rawIndex = firstTerm ? doc.content.toLowerCase().indexOf(firstTerm) : -1;
      const start = rawIndex > 80 ? rawIndex - 80 : 0;
      return { id: doc.id, title: doc.title, path: doc.path, section: doc.section, score: hits, excerpt: doc.content.slice(start, start + 260).replace(/\\s+/g, " ") };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }
  window.PokerKnowledgeBase = { ...payload, search, get: id => payload.documents.find(doc => doc.id === id) || null };
})();`;

await mkdir(new URL("../", output), { recursive: true });
await writeFile(output, runtime + "\n", "utf8");
console.log(`Bundled ${documents.length} knowledge documents (${Buffer.byteLength(payload)} bytes).`);
