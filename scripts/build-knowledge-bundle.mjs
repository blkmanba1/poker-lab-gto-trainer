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

const files = [
  new URL("index.md", root),
  new URL("operation-log.md", root),
  new URL("sources/catalog.md", root),
  new URL("sources/coverage.md", root),
  ...await filesUnder(new URL("concepts/", root)),
  ...await filesUnder(new URL("summaries/", root)),
  ...await filesUnder(new URL("topics/", root)),
  ...await filesUnder(new URL("cases/", root))
].sort((a, b) => a.href.localeCompare(b.href));
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
  sequence: ["还原节点", "确认位置与筹码", "比较范围", "识别牌面变化", "计算价格与SPR", "选择尺度与线路", "构造价值/诈唬", "检查阻挡牌", "加入剥削与ICM"],
  sourceDocuments: [
    "concepts-核心概念",
    "concepts-范围结构与频率",
    "concepts-筹码深度SPR位置与ICM",
    "topics-翻前决策框架",
    "topics-翻后决策框架",
    "topics-牌面分类与下注尺度",
    "topics-跨街行动线",
    "topics-玩家画像与剥削",
    "cases-实战牌例卡片"
  ],
  ruleDocuments: {
    preflop: ["topics-翻前决策框架-md", "concepts-范围结构与频率-md"],
    multiway: ["concepts-筹码深度SPR位置与ICM-md", "topics-牌面分类与下注尺度-md"],
    boardTexture: ["topics-牌面分类与下注尺度-md", "topics-翻后决策框架-md"],
    price: ["concepts-范围结构与频率-md", "topics-翻后决策框架-md"],
    sprPosition: ["concepts-筹码深度SPR位置与ICM-md", "topics-跨街行动线-md"],
    blockers: ["concepts-范围结构与频率-md", "topics-跨街行动线-md"],
    sizing: ["concepts-范围结构与频率-md", "topics-牌面分类与下注尺度-md"]
  },
  strategy: {
    multiwayAggressionFactor: 0.72,
    multiwayFoldFactor: 1.12,
    pairedBoardAggressionFactor: 0.86,
    monotoneBoardAggressionFactor: 0.88,
    lowConnectedAggressionFactor: 0.82,
    blockerBluffFactor: 1.12,
    expensiveCallFactor: 0.72,
    cheapCallFactor: 1.12,
    highSprOopAggressionFactor: 0.78,
    highSprOopCallFactor: 0.9,
    lowSprStrongAggressionFactor: 1.16,
    inPositionDrawAggressionFactor: 1.1,
    preflopInPositionContinueFactor: 1.08,
    preflopLargeRaiseContinueFactor: 0.82
  }
};

const payload = JSON.stringify({
  version: "knowledge-2026-08-07.1",
  title: "德州扑克结构化知识库",
  scope: `${documents.length} 个整理知识文件；结构化覆盖 S001-S088；不包含原始课程转写稿`,
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
