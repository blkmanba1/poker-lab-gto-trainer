(() => {
  "use strict";

  const SCALE = 2;
  const STARTING_STACK = 200;
  const HERO_SEAT = 0;
  const HERO_ID = "hero";
  const REVIEW_STORAGE_KEY = "poker-lab-match-reviews";
  const POSITIONS = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
  const STREET_LABELS = { PREFLOP: "翻前", FLOP: "翻牌", TURN: "转牌", RIVER: "河牌", SHOWDOWN: "摊牌" };
  const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  // Translated from the local knowledge layer: knowledge/index.md,
  // knowledge/concepts/核心概念.md and knowledge/topics/翻后决策框架.md.
  // These are teaching heuristics, not a claim of exact Solver output.
  const KNOWLEDGE_BUNDLE = window.PokerKnowledgeBase;
  const KNOWLEDGE_RULE_DOCUMENTS = KNOWLEDGE_BUNDLE?.rules?.ruleDocuments || {};
  const KNOWLEDGE_POLICY = {
    sources: "核心概念 · 翻后决策框架 · 一手牌讲解集合摘要",
    sequence: "还原节点 → 比较范围 → 计算价格 → 构造价值/诈唬 → 检查阻挡牌",
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
    preflopLargeRaiseContinueFactor: 0.82,
    ...(KNOWLEDGE_BUNDLE?.rules?.strategy || {}),
    sequence: KNOWLEDGE_BUNDLE?.rules?.sequence?.join(" → ") || "还原节点 → 比较范围 → 计算价格 → 构造价值/诈唬 → 检查阻挡牌",
    sources: KNOWLEDGE_BUNDLE?.rules?.sourceDocuments?.join(" · ") || "核心概念 · 翻后决策框架 · 一手牌讲解集合摘要"
  };
  const KNOWLEDGE_CASE_DOCUMENT_ID = "cases-实战牌例卡片-md";
  const KNOWLEDGE_CASES = (() => {
    const document = KNOWLEDGE_BUNDLE?.get?.(KNOWLEDGE_CASE_DOCUMENT_ID);
    if (!document?.content) return [];
    const headings = [...document.content.matchAll(/^###\s+(S\d+)：(.+)$/gm)];
    return headings.map((match, index) => {
      const start = match.index + match[0].length;
      const end = headings[index + 1]?.index ?? document.content.length;
      const body = document.content.slice(start, end).trim();
      const node = body.match(/- 关键节点：(.+)/)?.[1]?.trim() || "";
      const lesson = body.match(/- 可复用结论：(.+)/)?.[1]?.trim() || "";
      return {
        id: document.id,
        caseId: match[1],
        caseTitle: match[2].trim(),
        title: `${match[1]} · ${match[2].trim()}`,
        path: document.path,
        section: "cases",
        node,
        lesson,
        content: `${match[2]} ${node} ${lesson}`
      };
    });
  })();
  const TABLE_PLAYERS = [
    { id: HERO_ID, name: "你" },
    { id: "bot-mina", name: "Mina" },
    { id: "bot-river", name: "River" },
    { id: "bot-theo", name: "Theo" },
    { id: "bot-nova", name: "Nova" },
    { id: "bot-alex", name: "Alex" }
  ];

  const ids = [
    "live-table-shell", "live-hand-number", "live-street", "live-board", "live-pot", "live-seats",
    "live-action-bubble", "live-node-label", "live-prompt", "live-context", "live-actions",
    "live-bet-control", "live-bet-slider", "live-bet-output", "live-bet-confirm", "live-hand-result",
    "live-result-mark", "live-result-title", "live-result-copy", "live-review-button", "live-next-hand-button",
    "live-history-button", "live-hero-position", "live-line-log", "live-session-net", "live-session-hands",
    "live-session-score", "live-hero-stack", "live-review-dialog", "live-review-close", "live-review-title",
    "live-review-hand-select", "live-review-summary", "live-review-board", "live-review-pot",
    "live-review-seats", "live-review-prev", "live-review-next", "live-review-slider",
    "live-review-caption", "live-review-decisions"
  ];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

  const state = {
    engine: null,
    initialized: false,
    active: false,
    handRunning: false,
    botTimer: null,
    bubbleTimer: null,
    handStartHeroStack: STARTING_STACK,
    heroBuyIns: STARTING_STACK,
    timeline: [],
    decisions: [],
    liveLog: [],
    reviews: loadReviews(),
    currentReview: null,
    reviewStep: 0,
    sessionHands: 0,
    sessionDecisionPoints: 0,
    sessionDecisionScore: 0,
    customAction: null
  };

  function loadReviews() {
    try {
      const stored = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY));
      return Array.isArray(stored) ? stored.slice(0, 20) : [];
    } catch {
      return [];
    }
  }

  function saveReviews() {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state.reviews.slice(0, 20)));
  }

  function secureRandom() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 0x100000000;
  }

  function chipsToBb(chips) {
    return chips / SCALE;
  }

  function formatBb(chips, withUnit = true) {
    const value = Number(chipsToBb(chips).toFixed(1));
    return `${value}${withUnit ? "BB" : ""}`;
  }

  function signedBb(chips) {
    const value = Number(chipsToBb(chips).toFixed(1));
    return `${value > 0 ? "+" : ""}${value}BB`;
  }

  function totalPot(gameState = state.engine.state) {
    const pots = gameState.pots.reduce((sum, pot) => sum + pot.amount, 0);
    const bets = [...gameState.currentBets.values()].reduce((sum, amount) => sum + amount, 0);
    const settled = gameState.winners?.reduce((sum, winner) => sum + winner.amount, 0) || 0;
    return Math.max(pots + bets, settled);
  }

  function currentBet(gameState = state.engine.state) {
    return Math.max(0, ...gameState.currentBets.values());
  }

  function positionForSeat(seat, gameState = state.engine.state) {
    if (gameState.buttonSeat === null) return "—";
    return POSITIONS[(seat - gameState.buttonSeat + 6) % 6];
  }

  function displayCard(card) {
    return card ? `${card[0]}${SUIT_SYMBOL[card[1]]}` : "";
  }

  function cardNode(card, hidden = false, compact = false) {
    const node = document.createElement("span");
    if (hidden || !card) {
      node.className = `live-card back${compact ? " compact" : ""}`;
      node.setAttribute("aria-label", "暗牌");
      return node;
    }
    const suit = SUIT_SYMBOL[card[1]];
    node.className = `live-card ${/[hd]/.test(card[1]) ? "red" : "black"}${compact ? " compact" : ""}`;
    node.textContent = card[0];
    node.dataset.suit = suit;
    node.setAttribute("aria-label", displayCard(card));
    return node;
  }

  function setBubble(text) {
    clearTimeout(state.bubbleTimer);
    el["live-action-bubble"].textContent = text;
    el["live-action-bubble"].hidden = false;
    state.bubbleTimer = setTimeout(() => { el["live-action-bubble"].hidden = true; }, 1150);
  }

  function addLog(text) {
    state.liveLog.push(text);
    state.liveLog = state.liveLog.slice(-9);
    el["live-line-log"].replaceChildren();
    state.liveLog.forEach(line => {
      const li = document.createElement("li");
      li.textContent = line;
      el["live-line-log"].append(li);
    });
  }

  function renderBoard(gameState = state.engine.state) {
    el["live-board"].replaceChildren();
    gameState.board.forEach((card, index) => {
      const node = cardNode(card);
      node.style.animationDelay = `${index * 55}ms`;
      el["live-board"].append(node);
    });
  }

  function shouldRevealSeat(seat, gameState) {
    if (seat === HERO_SEAT) return true;
    if (gameState.street !== "SHOWDOWN") return false;
    return gameState.players[seat]?.status !== "FOLDED";
  }

  function renderSeats(gameState = state.engine.state) {
    el["live-seats"].replaceChildren();
    gameState.players.forEach((player, seat) => {
      if (!player) return;
      const wrapper = document.createElement("div");
      const isHero = seat === HERO_SEAT;
      const isActor = gameState.actionTo === seat;
      const isFolded = player.status === "FOLDED";
      const isAllIn = player.status === "ALL_IN";
      wrapper.className = `live-seat${isHero ? " hero" : ""}${isActor ? " actor" : ""}${isFolded ? " folded" : ""}${isAllIn ? " all-in" : ""}`;
      wrapper.dataset.index = seat;

      const cards = document.createElement("div");
      cards.className = "live-seat-cards";
      const reveal = shouldRevealSeat(seat, gameState);
      (player.hand || [null, null]).forEach(card => cards.append(cardNode(card, !reveal)));

      const info = document.createElement("div");
      info.className = "live-seat-info";
      const avatar = document.createElement("span");
      avatar.className = "live-avatar";
      avatar.textContent = isHero ? "YOU" : player.name[0];
      const name = document.createElement("span");
      name.className = "live-seat-name";
      name.textContent = player.name;
      const stack = document.createElement("span");
      stack.className = "live-seat-stack";
      stack.textContent = player.status === "BUSTED" ? "等待补码" : formatBb(player.stack);
      const position = document.createElement("span");
      position.className = "live-position";
      position.textContent = positionForSeat(seat, gameState);
      info.append(avatar, name, stack, position);

      const bet = gameState.currentBets.get(seat) || 0;
      if (bet > 0) {
        const betNode = document.createElement("span");
        betNode.className = "live-seat-bet";
        betNode.textContent = formatBb(bet);
        wrapper.append(betNode);
      }
      if (isAllIn) {
        const allIn = document.createElement("span");
        allIn.className = "live-all-in-label";
        allIn.textContent = "ALL-IN";
        wrapper.append(allIn);
      }
      wrapper.append(cards, info);
      el["live-seats"].append(wrapper);
    });
  }

  function renderSession() {
    const hero = state.engine?.state.players[HERO_SEAT];
    const net = hero ? hero.stack - state.heroBuyIns : 0;
    const score = state.sessionDecisionPoints
      ? `${Math.round(state.sessionDecisionScore / state.sessionDecisionPoints)}%`
      : "—";
    el["live-session-hands"].textContent = String(state.sessionHands);
    el["live-session-score"].textContent = score;
    el["live-hero-stack"].textContent = hero ? formatBb(hero.stack) : "100BB";
    el["live-session-net"].textContent = `本场盈亏 ${signedBb(net)}`;
  }

  function renderTable() {
    const gameState = state.engine.state;
    renderBoard(gameState);
    renderSeats(gameState);
    el["live-pot"].textContent = `底池 ${formatBb(totalPot(gameState))}`;
    el["live-hand-number"].textContent = `第 ${gameState.handNumber} 手`;
    el["live-street"].textContent = STREET_LABELS[gameState.street];
    el["live-hero-position"].textContent = positionForSeat(HERO_SEAT, gameState);
    renderSession();
  }

  function clearControls() {
    el["live-actions"].replaceChildren();
    el["live-bet-control"].hidden = true;
    state.customAction = null;
  }

  function setStatus(label, prompt, context) {
    el["live-node-label"].textContent = label;
    el["live-prompt"].textContent = prompt;
    el["live-context"].textContent = context;
  }

  function candidateKey(action) {
    return `${action.type}:${"amount" in action ? action.amount : ""}`;
  }

  function legalCandidates(seat) {
    const gameState = state.engine.state;
    const player = gameState.players[seat];
    if (!player || gameState.actionTo !== seat) return [];
    const playerId = player.id;
    const bet = gameState.currentBets.get(seat) || 0;
    const highBet = currentBet(gameState);
    const toCall = Math.max(0, highBet - bet);
    const pot = totalPot(gameState);
    const candidates = [];

    const add = (action, label, group, size = null) => {
      if (!state.engine.validate(action).valid) return;
      const key = candidateKey(action);
      if (candidates.some(item => item.key === key)) return;
      candidates.push({ action, label, group, size, key });
    };

    if (toCall > 0) {
      add({ type: "FOLD", playerId }, "弃牌", "fold");
      add({ type: "CALL", playerId }, `跟注 ${formatBb(Math.min(toCall, player.stack))}`, "call");
    } else {
      add({ type: "CHECK", playerId }, "过牌", "check");
    }

    const maxTotal = bet + player.stack;
    if (highBet === 0) {
      const sizes = [
        Math.max(gameState.bigBlind, Math.round(pot * 0.33)),
        Math.max(gameState.bigBlind, Math.round(pot * 0.75)),
        player.stack
      ];
      sizes.forEach((amount, index) => {
        const capped = Math.min(player.stack, amount);
        const allIn = capped === player.stack;
        add(
          { type: "BET", playerId, amount: capped },
          allIn ? `全下 ${formatBb(capped)}` : `下注 ${formatBb(capped)}`,
          "aggressive",
          allIn ? "allin" : index === 0 ? "small" : "large"
        );
      });
    } else {
      const raisePot = Math.round(highBet + (pot + toCall) * 0.7);
      const sizes = [state.engine.state.minRaise, raisePot, maxTotal];
      sizes.forEach((amount, index) => {
        const capped = Math.min(maxTotal, Math.max(highBet + 1, amount));
        const allIn = capped === maxTotal;
        add(
          { type: "RAISE", playerId, amount: capped },
          allIn ? `全下到 ${formatBb(capped)}` : `加注到 ${formatBb(capped)}`,
          "aggressive",
          allIn ? "allin" : index === 0 ? "small" : "large"
        );
      });
    }
    return candidates;
  }

  function rankValue(rank) {
    return RANKS.indexOf(rank) + 2;
  }

  function preflopScore(cards) {
    const values = cards.map(card => rankValue(card[0])).sort((a, b) => b - a);
    const [high, low] = values;
    const pair = high === low;
    const suited = cards[0][1] === cards[1][1];
    const gap = high - low;
    let score = high * 4 + low * 1.7;
    if (pair) score = 44 + high * 4;
    if (suited) score += 6;
    if (!pair && gap === 1) score += 4;
    if (!pair && gap === 2) score += 2;
    if (high === 14) score += 4;
    if (low <= 6 && gap >= 5) score -= 5;
    return { score, high, low, pair, suited, gap };
  }

  function straightDraw(cards) {
    const values = new Set(cards.map(card => rankValue(card[0])));
    if (values.has(14)) values.add(1);
    for (let start = 1; start <= 10; start += 1) {
      let hits = 0;
      for (let rank = start; rank < start + 5; rank += 1) if (values.has(rank)) hits += 1;
      if (hits === 4) return true;
    }
    return false;
  }

  function postflopProfile(seat, gameState = state.engine.state) {
    const cards = [...gameState.players[seat].hand, ...gameState.board];
    const hand = window.PokerSolver.Hand.solve(cards);
    const baseStrength = {
      "High Card": 0, Pair: 1, "Two Pair": 4, "Three of a Kind": 4,
      Straight: 5, Flush: 5, "Full House": 6, "Four of a Kind": 6, "Straight Flush": 6
    }[hand.name] ?? 0;
    let strength = baseStrength;
    const holeRanks = gameState.players[seat].hand.map(card => rankValue(card[0]));
    const boardRanks = gameState.board.map(card => rankValue(card[0]));
    const topBoard = Math.max(...boardRanks);
    const pocketPair = holeRanks[0] === holeRanks[1];
    if (hand.name === "Pair" && (holeRanks.includes(topBoard) || (pocketPair && holeRanks[0] > topBoard))) strength = 3;
    else if (hand.name === "Pair") strength = 2;

    const suits = cards.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const flushDraw = gameState.board.length < 5 && Object.values(suits).some(count => count === 4);
    const hasStraightDraw = gameState.board.length < 5 && straightDraw(cards);
    return { hand, strength, flushDraw, straightDraw: hasStraightDraw };
  }

  function knowledgeSignals(seat, gameState, toCall) {
    const player = gameState.players[seat];
    const activePlayers = gameState.players.filter(item => item && item.status !== "FOLDED" && item.status !== "BUSTED").length;
    const suits = gameState.board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const ranks = gameState.board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
    const maxSuit = gameState.board.length ? Math.max(...Object.values(suits)) : 0;
    const pairedBoard = Object.values(ranks).some(count => count >= 2);
    const boardValues = [...new Set(gameState.board.map(card => rankValue(card[0])))].sort((a, b) => a - b);
    const connectedBoard = boardValues.length >= 3 && boardValues.at(-1) - boardValues[0] <= 5;
    const highCardDry = gameState.board.length >= 3 && boardValues.at(-1) >= 12 && !pairedBoard && maxSuit <= 2 && !connectedBoard;
    const lowConnected = gameState.board.length >= 3 && boardValues.at(-1) <= 11 && connectedBoard;
    const pot = totalPot(gameState);
    const potOdds = toCall > 0 ? toCall / Math.max(1, pot + toCall) : 0;
    const spr = gameState.street === "PREFLOP" ? null : player.stack / Math.max(1, pot);
    const positionOrder = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };
    const activeSeats = gameState.players
      .filter(item => item && item.status !== "FOLDED" && item.status !== "BUSTED")
      .map(item => item.seat);
    const inPosition = activeSeats.every(activeSeat => activeSeat === seat
      || positionOrder[positionForSeat(seat, gameState)] >= positionOrder[positionForSeat(activeSeat, gameState)]);
    const blockerSuit = gameState.board.length && maxSuit >= 2
      ? Object.entries(suits).find(([, count]) => count === maxSuit)?.[0]
      : null;
    const blocksFlush = Boolean(blockerSuit && player.hand.some(card => card[1] === blockerSuit));
    return {
      activePlayers,
      multiway: gameState.street !== "PREFLOP" && activePlayers >= 3,
      pairedBoard,
      monotonePressure: maxSuit >= 3,
      highCardDry,
      lowConnected,
      blocksFlush,
      potOdds,
      spr,
      inPosition,
      raiseInBb: currentBet(gameState) / Math.max(1, gameState.bigBlind),
      position: positionForSeat(seat, gameState)
    };
  }

  function recentActionLine() {
    return state.timeline.slice(-8).map(step => step.note).join("；");
  }

  function pairPositionLabel(cards, board) {
    if (!board.length) return "";
    const holeValues = cards.map(card => rankValue(card[0]));
    const boardValues = [...new Set(board.map(card => rankValue(card[0])))].sort((a, b) => b - a);
    if (holeValues[0] === holeValues[1]) {
      const pairValue = holeValues[0];
      if (pairValue > boardValues[0]) return "超对";
      const higher = boardValues.filter(value => value > pairValue);
      return higher.length === 1 ? "牌面第二对" : higher.length === 2 ? "牌面第三对" : "口袋小对子";
    }
    const matched = holeValues.find(value => boardValues.includes(value));
    if (!matched) return "";
    const position = boardValues.indexOf(matched);
    return position === 0 ? "顶对" : position === 1 ? "中对" : "底对";
  }

  function handCaseTerms(gameState, seat, profile, signals, facingBet) {
    const player = gameState.players[seat];
    const terms = [STREET_LABELS[gameState.street], positionForSeat(seat, gameState)];
    const pairLabel = gameState.street === "PREFLOP" ? "" : pairPositionLabel(player.hand, gameState.board);
    if (pairLabel) terms.push(pairLabel, pairLabel === "牌面第三对" ? "中对" : "");
    const handTerms = {
      "High Card": "高牌",
      Pair: "一对",
      "Two Pair": "两对",
      "Three of a Kind": "三条",
      Straight: "顺子",
      Flush: "同花",
      "Full House": "葫芦",
      "Four of a Kind": "四条",
      "Straight Flush": "同花顺"
    };
    if (profile?.hand?.name) terms.push(handTerms[profile.hand.name] || profile.hand.name);
    if (profile?.flushDraw) terms.push("同花听牌", "听牌");
    if (profile?.straightDraw) terms.push("顺子听牌", "听牌");
    if (signals.multiway) terms.push("多人池", "三人池");
    if (signals.pairedBoard) terms.push("成对牌面");
    if (signals.monotonePressure) terms.push("同花完成", "同花");
    if (signals.lowConnected) terms.push("低张连接面", "连接面");
    if (signals.highCardDry) terms.push("高牌干燥面");
    if (signals.spr !== null && signals.spr >= 6) terms.push("深筹码", "高 SPR");
    if (signals.spr !== null && signals.spr <= 2.5) terms.push("低 SPR", "短筹码");
    if (facingBet) terms.push("面对下注");
    const line = recentActionLine();
    if (/3Bet/i.test(line)) terms.push("3Bet 底池", "3Bet");
    if (/全下/.test(line)) terms.push("全压", "全下");
    if (/加注/.test(line)) terms.push("加注");
    if (/跟注/.test(line)) terms.push("跟注");
    if (/过牌/.test(line)) terms.push("过牌");
    return [...new Set(terms.filter(Boolean))];
  }

  function matchKnowledgeCases(gameState, seat, profile, signals, facingBet, limit = 3) {
    if (!KNOWLEDGE_CASES.length) return [];
    const terms = handCaseTerms(gameState, seat, profile, signals, facingBet);
    const street = STREET_LABELS[gameState.street];
    const streetWords = ["翻牌", "转牌", "河牌"];
    const semanticAnchor = /多人|3Bet|同花|顺子|顶对|中对|底对|超对|口袋小对子|两对|三条|成对牌面|低张连接面|高牌干燥面/;
    const weighted = new Map(terms.map(term => [term, /多人|3Bet|全压|同花|顺子|顶对|中对|底对|超对|口袋小对子|两对|三条/.test(term) ? 4 : 2]));
    return KNOWLEDGE_CASES.map(card => {
      let score = 0;
      let anchorHits = 0;
      let semanticHits = 0;
      const matchedTerms = [];
      weighted.forEach((weight, term) => {
        if (!card.content.includes(term)) return;
        score += weight;
        matchedTerms.push(term);
        if (weight >= 4) anchorHits += 1;
        if (semanticAnchor.test(term)) semanticHits += 1;
      });
      const mentionedStreets = streetWords.filter(word => card.content.includes(word));
      if (gameState.street !== "PREFLOP" && mentionedStreets.length && !mentionedStreets.includes(street)) score -= 4;
      if (card.node.includes("材料只") || card.lesson.includes("不能据此")) score -= 3;
      if (profile?.strength <= 2 && /成坚果|顺子|同花|三条|两对/.test(card.caseTitle)) score -= 4;
      return {
        id: card.id,
        caseId: card.caseId,
        title: card.title,
        path: card.path,
        section: card.section,
        node: card.node,
        lesson: card.lesson,
        score,
        anchorHits,
        semanticHits,
        matchedTerms,
        kind: "case",
        excerpt: `关键节点：${card.node} 可迁移结论：${card.lesson}`
      };
    }).filter(item => item.score >= 9 && item.anchorHits >= 1 && item.semanticHits >= 1)
      .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId))
      .slice(0, limit);
  }

  function applyKnowledgePolicy(weights, signals, street, facingBet, profile) {
    const adjusted = { ...weights };
    const notes = [];
    const ruleKeys = new Set();
    let sizing = { small: 0.56, large: 0.36, allin: 0.08 };
    if (signals.multiway) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.multiwayAggressionFactor;
      if (adjusted.fold) adjusted.fold *= KNOWLEDGE_POLICY.multiwayFoldFactor;
      sizing = { small: 0.62, large: 0.32, allin: 0.06 };
      ruleKeys.add("multiway");
      notes.push(`多人池 ${signals.activePlayers} 人：减少边缘诈唬，收紧薄价值`);
    }
    if (street !== "PREFLOP" && signals.pairedBoard) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.pairedBoardAggressionFactor;
      ruleKeys.add("boardTexture");
      notes.push("公共牌成对：重注范围需要更明确的坚果与极化依据");
    }
    if (street !== "PREFLOP" && signals.monotonePressure) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.monotoneBoardAggressionFactor;
      ruleKeys.add("boardTexture");
      notes.push("同花压力：减少无阻挡的边缘进攻");
    }
    if (street !== "PREFLOP" && signals.lowConnected) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.lowConnectedAggressionFactor;
      if (profile.strength >= 4 || profile.draw) sizing = { small: 0.38, large: 0.5, allin: 0.12 };
      ruleKeys.add("boardTexture");
      ruleKeys.add("sizing");
      notes.push("低张连接面：降低自动进攻，强价值与强听牌采用更极化的尺度");
    } else if (street !== "PREFLOP" && signals.highCardDry) {
      sizing = { small: 0.72, large: 0.24, allin: 0.04 };
      ruleKeys.add("boardTexture");
      ruleKeys.add("sizing");
      notes.push("高牌干燥面：保留更宽的小尺度范围，不把牌面优势自动等同于重注");
    }
    if (facingBet && adjusted.call) {
      if (signals.potOdds <= 0.2) {
        adjusted.call *= KNOWLEDGE_POLICY.cheapCallFactor;
        notes.push(`价格约 ${Math.round(signals.potOdds * 100)}%：提高有权益继续牌的跟注权重`);
      } else if (signals.potOdds >= 0.32) {
        adjusted.call *= KNOWLEDGE_POLICY.expensiveCallFactor;
        notes.push(`价格约 ${Math.round(signals.potOdds * 100)}%：收紧没有足够权益实现的跟注`);
      }
      ruleKeys.add("price");
    }
    if (street !== "PREFLOP" && profile.draw && signals.blocksFlush && adjusted.aggressive) {
      adjusted.aggressive *= KNOWLEDGE_POLICY.blockerBluffFactor;
      ruleKeys.add("blockers");
      notes.push("手牌阻挡同花组合：保留少量更合适的半诈唬/施压组合");
    }
    if (street !== "PREFLOP" && signals.spr >= 6 && !signals.inPosition && profile.strength <= 3) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.highSprOopAggressionFactor;
      if (adjusted.call) adjusted.call *= KNOWLEDGE_POLICY.highSprOopCallFactor;
      ruleKeys.add("sprPosition");
      notes.push(`高 SPR ${signals.spr.toFixed(1)} 且无位置：中等牌减少构建大底池，保留过牌保护`);
    } else if (street !== "PREFLOP" && signals.spr <= 2.5 && profile.strength >= 3) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.lowSprStrongAggressionFactor;
      if (adjusted.fold) adjusted.fold *= 0.8;
      sizing = { small: 0.32, large: 0.4, allin: 0.28 };
      ruleKeys.add("sprPosition");
      ruleKeys.add("sizing");
      notes.push(`低 SPR ${signals.spr.toFixed(1)}：强一对以上更容易实现价值并进入打光线路`);
    }
    if (street !== "PREFLOP" && signals.inPosition && profile.draw && adjusted.aggressive) {
      adjusted.aggressive *= KNOWLEDGE_POLICY.inPositionDrawAggressionFactor;
      ruleKeys.add("sprPosition");
      notes.push("有位置且持有听牌：保留主动施压，也可利用位置延后兑现权益");
    }
    if (street === "PREFLOP" && facingBet) {
      if (signals.inPosition && adjusted.call) adjusted.call *= KNOWLEDGE_POLICY.preflopInPositionContinueFactor;
      if (signals.raiseInBb >= 8 && adjusted.call) adjusted.call *= KNOWLEDGE_POLICY.preflopLargeRaiseContinueFactor;
      ruleKeys.add("preflop");
      notes.push(`${signals.position} 面对 ${signals.raiseInBb.toFixed(1)}BB 压力：按位置、尺度和权益实现调整继续范围`);
    }
    if (!notes.length) notes.push("按节点、价格和范围结构维持基础混合");
    return { weights: adjusted, notes, ruleKeys: [...ruleKeys], sizing };
  }

  function normalizeGroupWeights(weights, candidates) {
    const availableGroups = new Set(candidates.map(item => item.group));
    const filtered = Object.fromEntries(Object.entries(weights).filter(([group]) => availableGroups.has(group)));
    if (!Object.keys(filtered).length) filtered[candidates[0].group] = 1;
    const total = Object.values(filtered).reduce((sum, value) => sum + value, 0) || 1;
    Object.keys(filtered).forEach(group => { filtered[group] /= total; });
    return filtered;
  }

  function strategyFor(seat, candidates) {
    const gameState = state.engine.state;
    const player = gameState.players[seat];
    const bet = gameState.currentBets.get(seat) || 0;
    const toCall = Math.max(0, currentBet(gameState) - bet);
    const facingBet = toCall > 0;
    const signals = knowledgeSignals(seat, gameState, toCall);
    let weights;
    let reason;
    let draw = false;
    let decisionProfile = null;

    if (gameState.street === "PREFLOP") {
      const details = preflopScore(player.hand);
      const position = positionForSeat(seat, gameState);
      const unopened = currentBet(gameState) <= gameState.bigBlind;
      const openThreshold = { UTG: 65, HJ: 59, CO: 51, BTN: 44, SB: 48, BB: 50 }[position];
      if (unopened) {
        if (details.score >= openThreshold + 20) weights = { aggressive: 0.88, call: 0.08, check: 0.08, fold: 0.04 };
        else if (details.score >= openThreshold) weights = { aggressive: 0.72, call: 0.12, check: 0.12, fold: 0.16 };
        else if (position === "BB" && !facingBet) weights = { check: 0.82, aggressive: 0.18 };
        else weights = { fold: 0.76, call: 0.13, aggressive: 0.11 };
        reason = `${position} 首入池基线结合牌型可玩性和位置宽度进行随机混合。`;
      } else {
        const pressure = currentBet(gameState) >= 16 ? 18 : currentBet(gameState) >= 6 ? 10 : 0;
        const continueThreshold = 58 + pressure;
        if (details.score >= 91) weights = { aggressive: 0.67, call: 0.31, fold: 0.02 };
        else if (details.score >= continueThreshold) weights = { call: 0.64, aggressive: 0.18, fold: 0.18 };
        else weights = { fold: 0.79, call: 0.16, aggressive: 0.05 };
        reason = `面对翻前加注，策略按牌力、位置、价格和再加注压力收紧继续范围。`;
      }
    } else {
      const profile = postflopProfile(seat, gameState);
      decisionProfile = profile;
      draw = profile.flushDraw || profile.straightDraw;
      const odds = facingBet ? toCall / Math.max(1, totalPot(gameState) + toCall) : 0;
      if (facingBet) {
        if (profile.strength >= 5) weights = { aggressive: 0.58, call: 0.4, fold: 0.02 };
        else if (profile.strength >= 4) weights = { aggressive: 0.36, call: 0.59, fold: 0.05 };
        else if (profile.strength >= 3) weights = { call: 0.71, aggressive: 0.11, fold: 0.18 };
        else if (draw && odds <= 0.36) weights = { call: 0.57, aggressive: 0.24, fold: 0.19 };
        else if (profile.strength >= 2 && odds <= 0.28) weights = { call: 0.55, fold: 0.4, aggressive: 0.05 };
        else weights = { fold: 0.8, call: 0.15, aggressive: 0.05 };
        reason = `面对下注，策略根据成牌强度、听牌权益和约 ${Math.round(odds * 100)}% 的底池赔率混合继续。`;
      } else {
        if (profile.strength >= 5) weights = { aggressive: 0.88, check: 0.12 };
        else if (profile.strength >= 4) weights = { aggressive: 0.76, check: 0.24 };
        else if (profile.strength >= 3) weights = { aggressive: 0.59, check: 0.41 };
        else if (draw) weights = { aggressive: 0.54, check: 0.46 };
        else if (profile.strength >= 2) weights = { check: 0.7, aggressive: 0.3 };
        else weights = { check: 0.73, aggressive: 0.27 };
        reason = `无人下注时，策略用牌力和听牌构造价值、半诈唬与过牌保护的混合范围。`;
      }
    }

    const policy = applyKnowledgePolicy(weights, signals, gameState.street, facingBet, {
      draw,
      strength: gameState.street === "PREFLOP" ? 0 : postflopProfile(seat, gameState).strength
    });
    weights = policy.weights;
    const queryTerms = [
      signals.multiway && "多人底池",
      signals.pairedBoard && "成对牌面",
      signals.monotonePressure && "同花",
      signals.highCardDry && "高牌干燥面",
      signals.lowConnected && "低张连接面",
      facingBet && "底池赔率",
      signals.spr !== null && "SPR 位置",
      signals.blocksFlush && "阻挡",
      gameState.street === "PREFLOP" ? "翻前范围" : "范围优势 坚果优势 下注尺度"
    ].filter(Boolean);
    const ruleMatches = policy.ruleKeys
      .flatMap(key => KNOWLEDGE_RULE_DOCUMENTS[key] || [])
      .map(id => KNOWLEDGE_BUNDLE?.get?.(id))
      .filter(Boolean)
      .map(doc => ({ id: doc.id, title: doc.title, path: doc.path, section: doc.section, excerpt: doc.content.slice(0, 260) }));
    const searchedMatches = KNOWLEDGE_BUNDLE?.search?.(queryTerms, 3) || [];
    const caseMatches = matchKnowledgeCases(gameState, seat, decisionProfile, signals, facingBet, 3);
    const knowledgeMatches = [...caseMatches, ...ruleMatches, ...searchedMatches]
      .filter((item, index, list) => list.findIndex(candidate => (candidate.caseId || candidate.id) === (item.caseId || item.id)) === index)
      .slice(0, 4);
    const knowledgeSummary = `${policy.notes.join("；")}。依据：${KNOWLEDGE_POLICY.sequence}。`;
    const groupWeights = normalizeGroupWeights(weights, candidates);
    const entries = [];
    Object.entries(groupWeights).forEach(([group, groupFrequency]) => {
      const groupCandidates = candidates.filter(item => item.group === group);
      if (group !== "aggressive" || groupCandidates.length === 1) {
        groupCandidates.forEach(item => entries.push({ ...item, frequency: groupFrequency / groupCandidates.length }));
        return;
      }
      const allocations = groupCandidates.map(item => policy.sizing[item.size] || 0.08);
      const allocationTotal = allocations.reduce((sum, value) => sum + value, 0);
      groupCandidates.forEach((item, index) => entries.push({
        ...item,
        frequency: groupFrequency * allocations[index] / allocationTotal
      }));
    });
    entries.sort((a, b) => b.frequency - a.frequency);
    return { entries, reason, groupWeights, knowledgeSummary, knowledgeSignals: signals, knowledgeSources: KNOWLEDGE_POLICY.sources, knowledgeMatches, caseMatches };
  }

  function chooseMixedAction(strategy) {
    let roll = secureRandom();
    for (const entry of strategy.entries) {
      roll -= entry.frequency;
      if (roll <= 0) return entry;
    }
    return strategy.entries[strategy.entries.length - 1];
  }

  function plainSnapshot(note, actorSeat = null, actionLabel = "") {
    const gameState = state.engine.state;
    return {
      street: gameState.street,
      board: [...gameState.board],
      pot: totalPot(gameState),
      buttonSeat: gameState.buttonSeat,
      actionTo: gameState.actionTo,
      note,
      actorSeat,
      actionLabel,
      players: gameState.players.map(player => player ? {
        seat: player.seat,
        name: player.name,
        stack: player.stack,
        hand: player.hand ? [...player.hand] : null,
        status: player.status,
        bet: gameState.currentBets.get(player.seat) || 0
      } : null)
    };
  }

  function recordStep(note, actorSeat = null, actionLabel = "") {
    state.timeline.push(plainSnapshot(note, actorSeat, actionLabel));
  }

  function actionScore(strategy, chosen) {
    const groupFrequency = strategy.groupWeights[chosen.group] || 0;
    const maxFrequency = Math.max(...Object.values(strategy.groupWeights));
    const ratio = maxFrequency ? groupFrequency / maxFrequency : 0;
    if (ratio >= 0.65) return { score: 100, rating: "贴合", tone: "good" };
    if (ratio >= 0.3) return { score: 68, rating: "可混合", tone: "mixed" };
    return { score: 28, rating: "明显偏离", tone: "leak" };
  }

  function decisionDistribution(strategy) {
    return strategy.entries.map(entry => ({
      label: entry.label,
      group: entry.group,
      frequency: Math.round(entry.frequency * 100)
    }));
  }

  function preflopHandLabel(cards) {
    const details = preflopScore(cards);
    const ranks = cards.map(card => card[0]).sort((a, b) => rankValue(b) - rankValue(a)).join("");
    const traits = [];
    if (details.pair) traits.push("口袋对子");
    else {
      if (details.suited) traits.push("同花");
      if (details.gap === 1) traits.push("连张");
      else if (details.gap === 2) traits.push("隔张连接");
      if (details.high >= 13) traits.push("高张");
    }
    return `${ranks} · ${traits.join("、") || "非同花非连接牌"}`;
  }

  function postflopHandLabel(seat) {
    const profile = postflopProfile(seat);
    const names = {
      "High Card": "高牌", Pair: "一对", "Two Pair": "两对", "Three of a Kind": "三条",
      Straight: "顺子", Flush: "同花", "Full House": "葫芦", "Four of a Kind": "四条",
      "Straight Flush": "同花顺"
    };
    const draws = [];
    if (profile.flushDraw) draws.push("同花听牌");
    if (profile.straightDraw) draws.push("顺子听牌");
    return `${names[profile.hand.name] || profile.hand.name}${draws.length ? ` + ${draws.join("、")}` : ""}`;
  }

  function boardTexture(board) {
    if (!board.length) return "翻前尚无公共牌";
    const rankCounts = board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
    const suitCounts = board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const notes = [];
    if (Object.values(rankCounts).some(count => count >= 2)) notes.push("公共牌成对");
    const maxSuit = Math.max(...Object.values(suitCounts));
    if (maxSuit >= 3) notes.push("同花压力较高");
    else if (maxSuit === 2) notes.push("双色牌面");
    else notes.push("彩虹牌面");
    return notes.join(" · ");
  }

  function boardFacts(board) {
    if (!board.length) return "当前还没有公共牌";
    const ranks = board.map(card => card[0]).join("-");
    const suits = board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const maxSuit = Math.max(...Object.values(suits));
    const rankCounts = board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
    const paired = Object.entries(rankCounts).find(([, count]) => count >= 2)?.[0];
    const texture = paired
      ? `牌面 ${ranks} 已成对（${paired}）`
      : maxSuit >= 3
        ? `牌面 ${ranks} 三张同花，存在同花压力`
        : maxSuit === 2
          ? `牌面 ${ranks} 两张同花，保留同花听牌可能`
          : `牌面 ${ranks} 彩虹面`;
    const latest = board.length >= 4 ? `本街新增 ${displayCard(board.at(-1))}` : "翻牌三张同时发出";
    return `${texture}；${latest}`;
  }

  function heroHandFacts(gameState) {
    const player = gameState.players[HERO_SEAT];
    if (!player?.hand?.length) return "你的手牌暂不可用";
    const cards = player.hand.map(displayCard).join(" ");
    if (gameState.street === "PREFLOP") {
      return `你拿 ${cards}（${preflopHandLabel(player.hand)}），${positionForSeat(HERO_SEAT, gameState)} 位面对当前前序行动`;
    }
    const profile = postflopProfile(HERO_SEAT, gameState);
    const board = gameState.board;
    const boardRanks = board.map(card => rankValue(card[0]));
    const holeRanks = player.hand.map(card => rankValue(card[0]));
    const topBoard = Math.max(...boardRanks);
    const madeNames = {
      "High Card": "高牌", Pair: "一对", "Two Pair": "两对", "Three of a Kind": "三条",
      Straight: "顺子", Flush: "同花", "Full House": "葫芦", "Four of a Kind": "四条",
      "Straight Flush": "同花顺"
    };
    let made = madeNames[profile.hand.name] || profile.hand.name;
    if (profile.hand.name === "Pair") {
      const pairLabel = pairPositionLabel(player.hand, board);
      if (!pairLabel) made = `公共牌对子，手牌以 ${RANKS[Math.max(...holeRanks) - 2]} 高踢脚参与`;
      else if (holeRanks.includes(topBoard)) made = `顶对（${RANKS[topBoard - 2]}）`;
      else if (holeRanks[0] === holeRanks[1] && holeRanks[0] > topBoard) made = "超对";
      else if (holeRanks[0] === holeRanks[1]) made = `${pairLabel}（口袋 ${player.hand[0][0]}${player.hand[1][0]}）`;
      else made = pairLabel;
    }
    const draws = [];
    if (profile.flushDraw) draws.push("同花听牌");
    if (profile.straightDraw) draws.push("顺子听牌");
    const drawText = draws.length ? `，同时有${draws.join("和")}` : "";
    return `你拿 ${cards}，公共牌 ${board.map(displayCard).join(" ")}；当前是${made}${drawText}。${boardFacts(board)}`;
  }

  function hasMadeStraight(cards) {
    const values = new Set(cards.map(card => rankValue(card[0])));
    if (values.has(14)) values.add(1);
    for (let start = 1; start <= 10; start += 1) {
      let hits = 0;
      for (let value = start; value < start + 5; value += 1) if (values.has(value)) hits += 1;
      if (hits === 5) return true;
    }
    return false;
  }

  function straightDrawExamples(board, limit = 4, unpairedOnly = true) {
    if (board.length >= 5) return [];
    const results = [];
    const boardRanks = new Set(board.map(card => card[0]));
    for (let highIndex = RANKS.length - 1; highIndex >= 0; highIndex -= 1) {
      for (let lowIndex = highIndex - 1; lowIndex >= 0; lowIndex -= 1) {
        if (unpairedOnly && (boardRanks.has(RANKS[highIndex]) || boardRanks.has(RANKS[lowIndex]))) continue;
        const cards = [`${RANKS[highIndex]}s`, `${RANKS[lowIndex]}h`, ...board];
        if (straightDraw(cards) && !hasMadeStraight(cards)) results.push(`${RANKS[highIndex]}${RANKS[lowIndex]}`);
      }
    }
    return results.slice(0, limit);
  }

  function flushDrawExamples(board, limit = 3) {
    if (board.length >= 5) return [];
    const suitCounts = board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const target = Object.entries(suitCounts).find(([, count]) => count === 2);
    if (!target) return [];
    const [suit] = target;
    const boardRanks = new Set(board.map(card => card[0]));
    const available = [...RANKS].reverse().filter(rank => !boardRanks.has(rank));
    const results = [];
    for (let high = 0; high < available.length; high += 1) {
      for (let low = high + 1; low < available.length; low += 1) {
        const cards = [`${available[high]}${suit}`, `${available[low]}${suit}`, ...board];
        if (!hasMadeStraight(cards)) results.push(`${available[high]}${SUIT_SYMBOL[suit]}${available[low]}${SUIT_SYMBOL[suit]}`);
      }
    }
    return results.slice(0, limit);
  }

  function lowerPocketExamples(value, board, limit = 3) {
    const boardRanks = new Set(board.map(card => card[0]));
    return RANKS.filter(rank => rankValue(rank) < value && !boardRanks.has(rank))
      .reverse().slice(0, limit).map(rank => `${rank}${rank}`);
  }

  function sameHighExamples(highValue, lowValue, stronger = false, limit = 3) {
    const values = RANKS.map(rank => rankValue(rank)).filter(value => stronger
      ? value > lowValue && value < highValue
      : value < lowValue && value >= 6);
    values.sort((a, b) => stronger ? b - a : b - a);
    return values.slice(0, limit).map(value => `${RANKS[highValue - 2]}${RANKS[value - 2]}`);
  }

  function higherPocketExamples(value, board) {
    const boardRanks = new Set(board.map(card => card[0]));
    const higher = RANKS.filter(rank => rankValue(rank) > value && !boardRanks.has(rank)).reverse();
    return higher.length ? higher.map(rank => `${rank}${rank}`).join("、") : "";
  }

  function signalsTextForBoard(board) {
    const suitCounts = board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const rankCounts = board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
    const notes = [];
    if (Math.max(...Object.values(suitCounts)) >= 3) notes.push("两张同花手牌构成的同花");
    if (Object.values(rankCounts).some(count => count >= 2)) notes.push("命中公共牌点数的三条");
    return notes.length ? `，以及${notes.join("、")}` : "";
  }

  function specificRangeComparison(gameState, recommended, facingBet = false) {
    if (gameState.street === "PREFLOP") {
      const cards = gameState.players[HERO_SEAT].hand;
      const details = preflopScore(cards);
      const worseHigh = sameHighExamples(details.high, details.low, false);
      const betterHigh = sameHighExamples(details.high, details.low, true);
      const dominated = worseHigh.length ? worseHigh.join("、") : "更差高张和非同花宽范围";
      const dominating = betterHigh.length ? betterHigh.join("、") : "更强高张";
      return {
        relative: `翻前这手 ${cards.map(displayCard).join(" ")} 的价值来自绝对牌力、同花/连接属性和位置，不存在公共牌坚果比较。`,
        ahead: `继续后通常领先 ${dominated}，但会被 ${dominating}、口袋大对子和更强同花高张压制。`,
        worseContinue: `若再加注，可能继续的更差牌主要是 ${dominated}、中小对子和部分同花连接牌；具体数量取决于对手面对再加注是跟注还是 4Bet/fold。`,
        betterFold: "更强高张和大对子通常不会弃牌；翻前诈唬收益主要来自让对手弃掉有不错权益的中小对子、同花高张与可玩组合。",
        verdict: `因此当前近似策略把 ${recommended} 放在主频，而不是只按两张牌的牌面观感行动。`
      };
    }

    const player = gameState.players[HERO_SEAT];
    const profile = postflopProfile(HERO_SEAT, gameState);
    const board = gameState.board;
    const boardValues = [...new Set(board.map(card => rankValue(card[0])))].sort((a, b) => b - a);
    const boardRanks = boardValues.map(value => RANKS[value - 2]);
    const top = boardRanks[0];
    const second = boardRanks[1] || top;
    const bottom = boardRanks.at(-1);
    const pairLabel = pairPositionLabel(player.hand, board);
    const holeValues = player.hand.map(card => rankValue(card[0]));
    const pocketPair = holeValues[0] === holeValues[1];
    const draws = [...flushDrawExamples(board), ...straightDrawExamples(board)];
    const drawText = draws.length ? [...new Set(draws)].slice(0, 6).join("、") : "可用听牌";
    const setText = boardRanks.map(rank => `${rank}${rank}`).join("、");
    let relative;
    let ahead;
    let worseContinue;
    let betterFold;
    let boardPair = false;
    let pairedValueZone = [];
    let flushValueZone = "";
    let betterHighCards = [];

    if (profile.strength >= 5) {
      relative = `你已经是${postflopHandLabel(HERO_SEAT)}，位于当前牌面的强价值区，但仍要检查更高顺子、同花或葫芦是否存在。`;
      ahead = `你明确领先两对、三条、顶对/超对以及 ${drawText} 这类强听牌。`;
      worseContinue = `能支付的更差牌主要是两对、三条、超对/顶对和带额外听牌的组合；尺度越大，纯一对留下得越少。`;
      betterFold = "比你更好的坚果组合通常不会弃牌，所以这里的下注目标是从更差成牌取值，不是逼更好牌弃牌。";
    } else if (profile.strength >= 4) {
      relative = `你是${postflopHandLabel(HERO_SEAT)}，高于普通一对，但落后已经完成的顺子、同花和更高两对/三条。`;
      ahead = `你领先 ${top}x、超对、较弱两对以及 ${drawText} 等听牌。`;
      worseContinue = `更差继续主要来自强 ${top}x、超对、较弱两对和强听牌；这是价值下注能成立的支付区。`;
      betterFold = "顺子、同花、暗三条等更好牌很少弃牌；若这些组合密度高，重注会把你自己送进更强范围。";
    } else if (profile.strength >= 3 || pairLabel === "顶对" || pairLabel === "超对") {
      relative = `你是${pairLabel || postflopHandLabel(HERO_SEAT)}，属于中上段一对，但并非坚果：两对 ${top}${second}、暗三条 ${setText} 和已完成顺/同花都在你上方。`;
      ahead = `你领先更差 ${top}x、${second}x、较小口袋对子以及 ${drawText} 等未完成听牌。`;
      worseContinue = `小中尺度下，可能支付的更差牌是较差踢脚的 ${top}x、${second}x、部分口袋对子和强听牌。`;
      betterFold = "两对、暗三条和更强成牌通常不弃；因此这是薄到中等价值问题，不是用一对把坚果区打掉。";
    } else if (pocketPair) {
      const pairValue = holeValues[0];
      const lowerPairs = lowerPocketExamples(pairValue, board).join("、") || "更小口袋对子";
      const higherBoardPairs = boardValues.filter(value => value > pairValue).map(value => `${RANKS[value - 2]}x`);
      const lowerBoardPairs = boardValues.filter(value => value < pairValue).map(value => `${RANKS[value - 2]}x`);
      const higherPocket = higherPocketExamples(pairValue, board);
      relative = `你是${pairLabel}（口袋 ${player.hand[0][0]}${player.hand[1][0]}）。你落后 ${[...higherBoardPairs, higherPocket, `两对 ${top}${second}`, `暗三条 ${setText}`].filter(Boolean).join("、")}。`;
      ahead = `你领先 ${[...lowerBoardPairs, lowerPairs, drawText].filter(Boolean).join("、")}；这些才是你的实际优势区。`;
      worseContinue = higherBoardPairs.length >= 2
        ? `若你主动下注，现实支付主要来自 ${drawText} 这类自然听牌；${lowerPairs} 虽然被你领先，但在多张高牌面上通常会弃，只可能在极小尺度下少量继续。`
        : `若你主动下注，更差继续主要是 ${[...lowerBoardPairs, lowerPairs, drawText].filter(Boolean).join("、")}；纯空气不会支付。`;
      betterFold = `比你更好的 ${[...higherBoardPairs, higherPocket].filter(Boolean).join("、")} 在小中尺度下通常不会稳定弃牌；两对和暗三条更不会弃。`;
    } else if (profile.hand.name === "Pair" && pairLabel) {
      const pairValue = pocketPair ? holeValues[0] : Math.max(...holeValues.filter(value => boardValues.includes(value)));
      const lowerPairs = lowerPocketExamples(pairValue, board).join("、") || `${bottom}x`;
      relative = `你当前是${pairLabel || "较弱一对"}。在 ${boardRanks.join("-")} 上，你落后 ${top}x、${second}x、JJ+、两对 ${top}${second} 和暗三条 ${setText}。`;
      ahead = `你主要领先 ${lowerPairs}、未成对高张，以及 ${drawText} 这类尚未完成的听牌。`;
      worseContinue = `若用小注，真正可能用更差牌继续的是 ${lowerPairs}、${bottom}x 和 ${drawText} 等强听牌；纯空气通常直接弃牌，不能贡献价值。`;
      betterFold = `对合理小中尺度，${top}x、${second}x、JJ+ 通常不会稳定弃牌。可能被较大尺度逼弃的更好牌主要是弱 ${second}x 或脆弱小对子，但需要你的线路能代表两对、暗三条或强顺子。`;
    } else {
      const boardRankCounts = board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
      const pairedRank = Object.entries(boardRankCounts).find(([, count]) => count >= 2)?.[0] || "";
      boardPair = Boolean(pairedRank);
      const heroHigh = Math.max(...holeValues);
      const heroHighRank = RANKS[heroHigh - 2];
      const unpairedBoardRanks = [...new Set(board.map(card => card[0]))].filter(rank => rank !== pairedRank);
      const boardSuitCounts = board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
      flushValueZone = Math.max(...Object.values(boardSuitCounts)) >= 3 ? "，以及已完成同花" : "";
      pairedValueZone = [
        ...unpairedBoardRanks.map(rank => `${rank}x（两对）`),
        pairedRank && `${pairedRank}x（三条）`,
        "口袋对子（两对或更好）"
      ].filter(Boolean);
      betterHighCards = [...RANKS].reverse()
        .filter(rank => rankValue(rank) > heroHigh && !boardRankCounts[rank])
        .slice(0, 4)
        .map(rank => `${rank}-high`);
      relative = boardPair
        ? `公共牌本身已经成对，但你的两张手牌没有配对；你实际依靠 ${heroHighRank} 高踢脚。${pairedValueZone.join("、")} 都明确领先你${flushValueZone}。`
        : `你目前是${postflopHandLabel(HERO_SEAT)}，没有稳定摊牌价值；牌面上的 ${top}x、${second}x、口袋对子和两对/暗三条都领先你。`;
      ahead = gameState.street === "RIVER"
        ? "你只领先更低高牌以及没有成牌的破产听牌；面对大额下注时，这部分组合必须真实存在，跟注才有依据。"
        : "你只领先更差高牌和部分更弱听牌；如果没有听牌，过牌后的摊牌价值很有限。";
      worseContinue = gameState.street === "RIVER"
        ? "比你更差的牌已经没有继续取值空间；若你主动下注，它们大多直接弃牌，因此下注只能作为诈唬。"
        : `比你更差的高牌和空气通常不会跟注，因此下注不是为了价值；${drawText} 即使尚未成牌，也可能已经凭高牌领先你，不能误算成“更差支付”。`;
      betterFold = boardPair
        ? `可争取逼弃的是 ${betterHighCards.join("、") || "更高但未成对的高牌"}；${pairedValueZone.join("、")} 不是现实弃牌目标。`
        : `可争取逼弃的是未带强听牌的小对子、弱 ${second}x 和部分 A-high；${top}x、两对、暗三条通常不是现实弃牌目标。`;
    }
    if (facingBet) {
      const missedDraws = gameState.street === "RIVER"
        ? "破产顺子听牌、没有形成同花的单花阻挡牌，以及没有摊牌价值的高张"
        : `${drawText} 等听牌、较低对子和部分宽范围高张`;
      if (profile.strength <= 2 && !pairLabel && !pocketPair) {
        worseContinue = `你能击败的下注主要是 ${missedDraws}；如果对手的行动线没有这些自然诈唬，你就没有足够抓诈对象。`;
        betterFold = boardPair
          ? `你落后的价值区包括 ${pairedValueZone.join("、")}${flushValueZone}。此外 ${betterHighCards.join("、") || "更高未成对高牌"} 也领先你，但它们只有主动转诈才会形成下注。`
          : `你落后的价值区包括 ${top}x、${second}x、口袋对子、两对/暗三条${signalsTextForBoard(board)}。这些牌在大尺度下注中占比越高，弃牌越明确。`;
      } else if (pocketPair) {
        const pairValue = holeValues[0];
        const higherBoardPairs = boardValues.filter(value => value > pairValue).map(value => `${RANKS[value - 2]}x`);
        const lowerBoardPairs = boardValues.filter(value => value < pairValue).map(value => `${RANKS[value - 2]}x`);
        const lowerPairs = lowerPocketExamples(pairValue, board).join("、") || "更小口袋对子";
        worseContinue = higherBoardPairs.length >= 2
          ? `你能击败的自然下注主要是 ${missedDraws}；${lowerPairs} 必须主动转成诈唬才会下注，不能默认把这些摊牌牌力全部计入对手诈唬。`
          : `你能击败的下注主要来自 ${[...lowerBoardPairs, lowerPairs, missedDraws].filter(Boolean).join("、")}；这些组合的实际诈唬频率决定跟注价值。`;
        betterFold = `你落后的价值区包括 ${[...higherBoardPairs, higherPocketExamples(pairValue, board), `两对 ${top}${second}`, `暗三条 ${setText}`].filter(Boolean).join("、")}；这些是不能被误算成诈唬的具体组合。`;
      } else {
        worseContinue = `你能击败的下注包括更差一对、较低口袋对子和 ${missedDraws}；这些是跟注获得收益的具体来源。`;
        betterFold = `你落后的价值区包括两对、暗三条 ${setText}、已完成顺子/同花和更高一对；加注只有在这些牌会弃掉时才可能优于跟注。`;
      }
    }
    return {
      relative,
      ahead,
      worseContinue,
      betterFold,
      worseLabel: facingBet ? "能击败的下注" : "更差会继续",
      betterLabel: facingBet ? "落后的价值牌" : "更好会弃牌",
      verdict: `把这些具体组合放回策略后，当前主频是 ${recommended}；如果列不出支付、弃牌或诈唬组合，就不应把低频动作当成默认线路。`
    };
  }

  function coachReview(decisionContext) {
    const {
      street, position, candidate, strategy, gameState, pot, toCall, price, chosenFrequency, topFrequency, handFacts, specific
    } = decisionContext;
    const signals = strategy.knowledgeSignals || {};
    const facingBet = toCall > 0;
    const profile = street === "PREFLOP" ? null : postflopProfile(HERO_SEAT, gameState);
    const boardWords = [];
    if (signals.multiway) boardWords.push("多人池的范围密度");
    if (signals.pairedBoard) boardWords.push("成对牌面的坚果分布");
    if (signals.monotonePressure) boardWords.push("同花组合与阻挡牌");
    if (signals.lowConnected) boardWords.push("低张连接面对防守方的改善");
    if (signals.highCardDry) boardWords.push("高牌干燥面上的小尺度覆盖");
    if (signals.spr !== null && signals.spr >= 6 && !signals.inPosition) boardWords.push("高 SPR 无位置的控池需求");
    if (signals.spr !== null && signals.spr <= 2.5) boardWords.push("低 SPR 下强牌的兑现能力");
    const primary = boardWords[0] || (street === "PREFLOP"
      ? `位置 ${position} 与前序压力下的继续范围`
      : "范围权益、下注尺度和后续街的连接");
    const chosen = candidate.label;
    const recommended = strategy.entries[0]?.label || "主频行动";
    const frequency = chosenFrequency;
    const seed = `${street}-${position}-${chosen}-${signals.pairedBoard}-${signals.potOdds}`;
    const caseMatch = strategy.caseMatches?.[0] || null;
    const casePrefix = caseMatch
      ? `知识库最相似牌例是 ${caseMatch.title}。匹配点包括 ${caseMatch.matchedTerms.slice(0, 4).join("、")}；其中的关键节点是“${caseMatch.node}”，可迁移结论是“${caseMatch.lesson}”。它是相似节点参考，不代表两手牌完全相同。`
      : "知识库没有找到相似度足够高的完整牌例，因此本节点回到结构化范围与牌面规则，不强行套用单手结论。";
    let lead;
    const factLead = `${handFacts}。`;
    if (decisionContext.tone === "good") {
      lead = `${casePrefix}${factLead}${specific.verdict} 你选择 ${chosen}，与这条主线一致。`;
    } else if (decisionContext.tone === "mixed") {
      lead = `${casePrefix}${factLead}${specific.verdict} 你的 ${chosen} 可以保留，但仅约 ${frequency}%，默认仍应优先 ${recommended}。`;
    } else {
      lead = `${casePrefix}${factLead}${specific.verdict} 你选择 ${chosen} 只有约 ${frequency}%，主要问题是它没有足够的支付牌或弃牌目标支撑。`;
    }

    const reasonParts = [specific.relative, specific.ahead];
    if (facingBet) {
      reasonParts.push(`你需要补 ${formatBb(toCall)}，简化盈亏平衡权益约 ${Math.round(price * 100)}%；继续范围要由“能击败的诈唬/听牌”与“落后的价值牌”共同决定。`);
    } else {
      reasonParts.push("当前没有下注，因此下注是否成立直接取决于下面列出的支付牌和弃牌目标，而不是抽象的主动权。" );
    }
    if (signals.spr !== null) reasonParts.push(`有效后手对应 SPR ${signals.spr.toFixed(1)}，${signals.inPosition ? "有位置可以延后压力" : "无位置要保留过牌保护"}。`);
    reasonParts.push(`当前主频行动是 ${recommended}（约 ${topFrequency}%）；你的选择占 ${frequency}%，所以复盘重点是频率位置而不是简单贴“对/错”标签。`);

    const check = `${specific.verdict} 复盘时优先核对：更差继续牌是否真的足够，以及更好牌是否会在当前尺度下实际弃掉。`;
    const plan = facingBet
      ? `若走 ${recommended}，下一街优先观察听牌是否完成、对手是否继续大尺度，以及你的牌是否从成牌退化成纯抓诈。`
      : `若走 ${recommended}，被跟注后要把对手范围收窄到上面列出的对子和听牌；下一街再按完成牌、超牌和成对牌重新筛选。`;
    return {
      lead,
      reason: reasonParts.join(" "),
      caseStudy: casePrefix,
      relative: specific.relative,
      ahead: specific.ahead,
      worseContinue: specific.worseContinue,
      betterFold: specific.betterFold,
      worseLabel: specific.worseLabel,
      betterLabel: specific.betterLabel,
      check,
      plan
    };
  }

  function buildDecisionAnalysis(seat, strategy, candidate, gameState) {
    const player = gameState.players[seat];
    const pot = totalPot(gameState);
    const invested = gameState.currentBets.get(seat) || 0;
    const toCall = Math.max(0, currentBet(gameState) - invested);
    const activePlayers = gameState.players.filter(item => item && item.status !== "FOLDED" && item.status !== "BUSTED").length;
    const price = toCall > 0 ? toCall / Math.max(1, pot + toCall) : 0;
    const spr = gameState.street === "PREFLOP" ? null : player.stack / Math.max(1, pot);
    const chosenFrequency = Math.round((strategy.entries.find(entry => entry.label === candidate.label)?.frequency || 0) * 100);
    const topFrequency = Math.round((strategy.entries[0]?.frequency || 0) * 100);
    const hand = gameState.street === "PREFLOP" ? preflopHandLabel(player.hand) : postflopHandLabel(seat);
    const handFacts = heroHandFacts(gameState);
    const recommended = strategy.entries[0]?.label || "主频行动";
    const specific = specificRangeComparison(gameState, recommended, toCall > 0);
    const tone = actionScore(strategy, candidate).tone;
    const coach = coachReview({
      street: gameState.street,
      position: positionForSeat(seat, gameState),
      candidate,
      strategy,
      gameState,
      pot,
      toCall,
      price,
      chosenFrequency,
      topFrequency,
      handFacts,
      specific,
      tone
    });
    const priceText = toCall > 0
      ? `需补 ${formatBb(toCall)}，跟注后总底池约 ${formatBb(pot + toCall)}，盈亏平衡权益约 ${Math.round(price * 100)}%。`
      : `当前无需补筹码，可以免费过牌；若主动下注，需要说明更差牌为何跟注或更好牌为何弃牌。`;
    const structureText = gameState.street === "PREFLOP"
      ? `翻前先按 ${positionForSeat(seat, gameState)} 位置、前序加注压力和手牌可玩性确定继续范围，再在跟注与再加注之间分配组合。`
      : `翻后按“范围与坚果关系 → 尺度 → 价值/诈唬构造 → 阻挡牌”的顺序检查；当前简化引擎主要使用成牌、听牌和价格。`;
    return {
      node: `${activePlayers} 人仍在牌局 · 底池 ${formatBb(pot)} · 你的后手 ${formatBb(player.stack)}${spr === null ? "" : ` · SPR ${spr.toFixed(1)}`}`,
      hand: handFacts,
      price: priceText,
      structure: structureText,
      frequency: `你的行动在当前近似策略中占 ${chosenFrequency}%，最高频行动占 ${topFrequency}%。频率用于比较策略结构，不是精确 Solver 输出。`,
      knowledge: strategy.knowledgeSummary,
      sources: strategy.knowledgeSources,
      matches: strategy.knowledgeMatches,
      caseMatches: strategy.caseMatches,
      specific,
      coach
    };
  }

  function actCandidate(seat, candidate, strategy, isHero = false) {
    const gameStateBefore = state.engine.state;
    const oldStreet = gameStateBefore.street;
    if (isHero) {
      const verdict = actionScore(strategy, candidate);
      state.decisions.push({
        street: oldStreet,
        position: positionForSeat(seat, gameStateBefore),
        cards: [...gameStateBefore.players[seat].hand],
        board: [...gameStateBefore.board],
        pot: totalPot(gameStateBefore),
        chosen: candidate.label,
        chosenGroup: candidate.group,
        recommended: strategy.entries[0].label,
        distribution: decisionDistribution(strategy),
        reason: strategy.reason,
        analysis: buildDecisionAnalysis(seat, strategy, candidate, gameStateBefore),
        ...verdict
      });
      state.sessionDecisionPoints += 1;
      state.sessionDecisionScore += verdict.score;
    }

    state.engine.act(candidate.action);
    const actorName = gameStateBefore.players[seat].name;
    const line = `${STREET_LABELS[oldStreet]} · ${actorName} ${candidate.label}`;
    addLog(line);
    setBubble(`${actorName} ${candidate.label}`);
    const newStreet = state.engine.state.street;
    const suffix = newStreet !== oldStreet ? `；进入${STREET_LABELS[newStreet]}` : "";
    recordStep(`${line}${suffix}`, seat, candidate.label);
    renderTable();
  }

  function showEngineError(error) {
    clearControls();
    setStatus("牌局暂停", "规则引擎拒绝了该行动", error?.message || "未知错误");
    console.error(error);
  }

  function runLoop() {
    clearTimeout(state.botTimer);
    if (!state.active || !state.handRunning) return;
    const gameState = state.engine.state;
    if (gameState.street === "SHOWDOWN" && gameState.winners) {
      finishHand();
      return;
    }
    if (gameState.actionTo === null) {
      finishHand();
      return;
    }
    if (gameState.actionTo === HERO_SEAT) {
      renderHeroTurn();
      return;
    }

    const seat = gameState.actionTo;
    const player = gameState.players[seat];
    clearControls();
    setStatus(`${STREET_LABELS[gameState.street]} · ${positionForSeat(seat)}`, `${player.name} 思考中`, "机器人正在从混合策略中抽取行动…");
    renderTable();
    state.botTimer = setTimeout(() => {
      if (!state.active || !state.handRunning || state.engine.state.actionTo !== seat) return;
      try {
        const candidates = legalCandidates(seat);
        const strategy = strategyFor(seat, candidates);
        const choice = chooseMixedAction(strategy);
        actCandidate(seat, choice, strategy, false);
        runLoop();
      } catch (error) {
        showEngineError(error);
      }
    }, 520 + Math.round(secureRandom() * 420));
  }

  function customCandidateFor(amount) {
    const gameState = state.engine.state;
    const player = gameState.players[HERO_SEAT];
    const type = currentBet(gameState) === 0 ? "BET" : "RAISE";
    const action = { type, playerId: player.id, amount };
    if (!state.engine.validate(action).valid) return null;
    const allIn = amount >= (gameState.currentBets.get(HERO_SEAT) || 0) + player.stack;
    return {
      action,
      label: allIn ? `全下到 ${formatBb(amount)}` : `${type === "BET" ? "下注" : "加注到"} ${formatBb(amount)}`,
      group: "aggressive",
      size: "custom",
      key: candidateKey(action)
    };
  }

  function setupBetControl(candidates) {
    const aggressive = candidates.filter(item => item.group === "aggressive");
    if (!aggressive.length) {
      el["live-bet-control"].hidden = true;
      return;
    }
    const amounts = aggressive.map(item => item.action.amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    if (max <= min) {
      el["live-bet-control"].hidden = true;
      return;
    }
    const suggested = amounts[Math.min(1, amounts.length - 1)];
    el["live-bet-slider"].min = String(min / SCALE);
    el["live-bet-slider"].max = String(max / SCALE);
    el["live-bet-slider"].step = "0.5";
    el["live-bet-slider"].value = String(suggested / SCALE);
    el["live-bet-output"].textContent = formatBb(suggested);
    state.customAction = customCandidateFor(suggested);
    el["live-bet-control"].hidden = false;
  }

  function renderHeroTurn() {
    const gameState = state.engine.state;
    const hero = gameState.players[HERO_SEAT];
    const candidates = legalCandidates(HERO_SEAT);
    const highBet = currentBet(gameState);
    const heroBet = gameState.currentBets.get(HERO_SEAT) || 0;
    const toCall = Math.max(0, highBet - heroBet);
    const context = `${positionForSeat(HERO_SEAT)} · 底池 ${formatBb(totalPot(gameState))} · ${toCall ? `需跟注 ${formatBb(Math.min(toCall, hero.stack))}` : "无人下注"}`;
    setStatus(`${STREET_LABELS[gameState.street]} · 轮到你`, "你的行动", context);
    clearControls();
    const strategy = strategyFor(HERO_SEAT, candidates);

    candidates.forEach(candidate => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `live-action-button action-${candidate.group}${candidate.group === "aggressive" ? " aggressive" : ""}${candidate.size === "allin" ? " allin" : ""}`;
      button.textContent = candidate.label;
      button.addEventListener("click", () => {
        if (!state.handRunning || state.engine.state.actionTo !== HERO_SEAT) return;
        clearControls();
        setStatus(`${STREET_LABELS[gameState.street]} · 已行动`, "等待其他玩家", "机器人正在继续本轮下注。 ");
        try {
          actCandidate(HERO_SEAT, candidate, strategy, true);
          runLoop();
        } catch (error) {
          showEngineError(error);
        }
      });
      el["live-actions"].append(button);
    });
    setupBetControl(candidates);
    renderTable();
  }

  function describeWinners(gameState) {
    if (!gameState.winners?.length) return "牌局结束";
    const grouped = new Map();
    gameState.winners.forEach(winner => grouped.set(winner.seat, (grouped.get(winner.seat) || 0) + winner.amount));
    return [...grouped.entries()].map(([seat, amount]) => `${gameState.players[seat].name} 赢得 ${formatBb(amount)}`).join("；");
  }

  function createReview(handNet) {
    const gameState = state.engine.state;
    const decisionAverage = state.decisions.length
      ? Math.round(state.decisions.reduce((sum, item) => sum + item.score, 0) / state.decisions.length)
      : null;
    return {
      id: gameState.handId,
      handNumber: gameState.handNumber,
      timestamp: Date.now(),
      heroCards: [...gameState.players[HERO_SEAT].hand],
      board: [...gameState.board],
      result: describeWinners(gameState),
      handNet,
      decisionAverage,
      decisions: state.decisions,
      timeline: state.timeline
    };
  }

  function finishHand() {
    if (!state.handRunning) return;
    state.handRunning = false;
    clearTimeout(state.botTimer);
    clearControls();
    const gameState = state.engine.state;
    const hero = gameState.players[HERO_SEAT];
    const handNet = hero.stack - state.handStartHeroStack;
    state.sessionHands += 1;
    state.currentReview = createReview(handNet);
    state.reviews.unshift(state.currentReview);
    state.reviews = state.reviews.slice(0, 20);
    saveReviews();
    el["live-history-button"].disabled = false;

    renderTable();
    setStatus("本手结束", describeWinners(gameState), `你的本手盈亏 ${signedBb(handNet)}`);
    el["live-result-mark"].textContent = handNet >= 0 ? "+" : "−";
    el["live-result-mark"].style.background = handNet >= 0 ? "#2c7c5c" : "#c95746";
    el["live-result-title"].textContent = signedBb(handNet);
    const scoreText = state.currentReview.decisionAverage === null
      ? "本手没有英雄决策节点。"
      : `本手 ${state.decisions.length} 个决策节点，策略贴合度 ${state.currentReview.decisionAverage}%。`;
    el["live-result-copy"].textContent = `${describeWinners(gameState)}。${scoreText}`;
    el["live-hand-result"].hidden = false;
    renderSession();
  }

  function prepareBustedPlayers() {
    state.engine.state.players.forEach((player, seat) => {
      if (!player || player.stack > 0) return;
      state.engine.act({ type: "ADD_CHIPS", playerId: player.id, amount: STARTING_STACK });
      if (seat === HERO_SEAT) state.heroBuyIns += STARTING_STACK;
    });
  }

  function startHand() {
    if (!state.engine || state.handRunning) return;
    prepareBustedPlayers();
    state.engine.deal();
    const hero = state.engine.state.players[HERO_SEAT];
    state.handStartHeroStack = hero.stack + hero.totalInvestedThisHand;
    state.timeline = [];
    state.decisions = [];
    state.liveLog = [];
    state.handRunning = true;
    state.currentReview = null;
    el["live-hand-result"].hidden = true;
    addLog(`第 ${state.engine.state.handNumber} 手 · ${positionForSeat(HERO_SEAT)} 拿到 ${hero.hand.map(displayCard).join(" ")}`);
    recordStep(`发牌；你在 ${positionForSeat(HERO_SEAT)} 拿到 ${hero.hand.map(displayCard).join(" ")}`);
    renderTable();
    runLoop();
  }

  function createTable() {
    if (!window.PokerTools?.createBrowserEngine) throw new Error("六人桌规则引擎未加载");
    clearTimeout(state.botTimer);
    state.engine = window.PokerTools.createBrowserEngine({
      smallBlind: 1,
      bigBlind: 2,
      maxPlayers: 6,
      rakePercent: 0,
      validateIntegrity: true
    });
    TABLE_PLAYERS.forEach((player, seat) => state.engine.sit(seat, player.id, player.name, STARTING_STACK));
    state.heroBuyIns = STARTING_STACK;
    state.sessionHands = 0;
    state.sessionDecisionPoints = 0;
    state.sessionDecisionScore = 0;
    state.initialized = true;
    state.handRunning = false;
    el["live-history-button"].disabled = !state.reviews.length;
    startHand();
  }

  function newHand() {
    if (!state.engine) {
      createTable();
      return;
    }
    if (state.handRunning) {
      if (!window.confirm("当前手牌仍在进行。确定放弃本场并重新开桌吗？")) return;
      createTable();
      return;
    }
    startHand();
  }

  function snapshotPosition(snapshot, seat) {
    return POSITIONS[(seat - snapshot.buttonSeat + 6) % 6];
  }

  function renderReviewSeats(snapshot) {
    el["live-review-seats"].replaceChildren();
    snapshot.players.forEach((player, seat) => {
      if (!player) return;
      const node = document.createElement("div");
      node.className = `live-review-seat${player.status === "FOLDED" ? " folded" : ""}${snapshot.actionTo === seat ? " actor" : ""}`;
      node.dataset.index = seat;
      const cards = document.createElement("div");
      cards.className = "live-review-hole";
      (player.hand || [null, null]).forEach(card => cards.append(cardNode(card, false, true)));
      const text = document.createElement("span");
      text.textContent = `${player.name} · ${snapshotPosition(snapshot, seat)} · ${formatBb(player.stack)}`;
      node.append(cards, text);
      if (player.bet) {
        const bet = document.createElement("small");
        bet.textContent = `投入 ${formatBb(player.bet)}`;
        node.append(bet);
      }
      el["live-review-seats"].append(node);
    });
  }

  function renderReviewStep(index) {
    if (!state.currentReview) return;
    const max = state.currentReview.timeline.length - 1;
    state.reviewStep = Math.max(0, Math.min(max, index));
    const snapshot = state.currentReview.timeline[state.reviewStep];
    el["live-review-slider"].value = String(state.reviewStep);
    el["live-review-prev"].disabled = state.reviewStep === 0;
    el["live-review-next"].disabled = state.reviewStep === max;
    el["live-review-board"].replaceChildren();
    snapshot.board.forEach(card => el["live-review-board"].append(cardNode(card, false, true)));
    el["live-review-pot"].textContent = `底池 ${formatBb(snapshot.pot)}`;
    el["live-review-caption"].textContent = `${state.reviewStep + 1} / ${max + 1} · ${snapshot.note}`;
    renderReviewSeats(snapshot);
  }

  function distributionNode(distribution) {
    const list = document.createElement("div");
    list.className = "review-frequency-list";
    distribution.forEach(item => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = item.label;
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = `${item.frequency}%`;
      track.append(fill);
      const value = document.createElement("strong");
      value.textContent = `${item.frequency}%`;
      row.append(label, track, value);
      list.append(row);
    });
    return list;
  }

  function knowledgeMatchesNode(matches) {
    const section = document.createElement("div");
    section.className = "review-knowledge-hits";
    matches.slice(0, 3).forEach(match => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-knowledge-hit";
      button.textContent = `${match.kind === "case" ? "相似牌例" : "知识依据"}：${match.title} · 查看条目`;
      button.addEventListener("click", event => {
        event.stopPropagation();
        window.PokerKnowledgeUI?.openDocument(match.id);
      });
      section.append(button);
    });
    return section;
  }

  function reviewDetailNode(label, text) {
    const row = document.createElement("div");
    row.className = "review-detail-row";
    const title = document.createElement("strong");
    title.textContent = label;
    const copy = document.createElement("p");
    copy.textContent = text;
    row.append(title, copy);
    return row;
  }

  function decisionFeedback(decision) {
    if (decision.analysis?.coach?.lead) return decision.analysis.coach.lead;
    const chosenFrequency = decision.distribution.find(item => item.label === decision.chosen)?.frequency || 0;
    const recommendedFrequency = decision.distribution.find(item => item.label === decision.recommended)?.frequency || 0;
    if (decision.tone === "good") {
      return `重点：${decision.chosen} 是主频分支；记住用位置、价格和范围结构解释它，而不是只记答案。`;
    }
    if (decision.tone === "mixed") {
      return `重点：${decision.chosen} 可以混合，但只有 ${chosenFrequency}%；${decision.recommended} 更常见（${recommendedFrequency}%）。`;
    }
    return `重点：${decision.chosen} 只有 ${chosenFrequency}%；优先检查是否高估牌力、忽略价格，或没有构造出可信的价值/诈唬范围。`;
  }

  function renderReviewDecisions(review) {
    el["live-review-decisions"].replaceChildren();
    if (!review.decisions.length) {
      const empty = document.createElement("p");
      empty.className = "review-empty";
      empty.textContent = "本手没有轮到你行动。";
      el["live-review-decisions"].append(empty);
      return;
    }
    review.decisions.forEach((decision, index) => {
      const card = document.createElement("article");
      card.className = `review-decision ${decision.tone}`;
      const header = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${STREET_LABELS[decision.street]} · ${decision.position}`;
      const badge = document.createElement("span");
      badge.textContent = `${decision.rating} ${decision.score}%`;
      header.append(title, badge);
      const comparison = document.createElement("p");
      comparison.className = "review-comparison";
      comparison.textContent = `你选择：${decision.chosen} · 主策略：${decision.recommended}`;
      const takeaway = document.createElement("p");
      takeaway.className = "review-takeaway";
      takeaway.textContent = decisionFeedback(decision);
      const details = document.createElement("div");
      details.className = "review-detail-list";
      const analysis = decision.analysis || {};
      if (analysis.coach?.caseStudy) details.append(reviewDetailNode("相似牌例", analysis.coach.caseStudy));
      if (analysis.coach?.relative) details.append(reviewDetailNode("牌力位置", analysis.coach.relative));
      if (analysis.coach?.ahead) details.append(reviewDetailNode("领先哪些牌", analysis.coach.ahead));
      if (analysis.coach?.worseContinue) details.append(reviewDetailNode(analysis.coach.worseLabel || "更差会继续", analysis.coach.worseContinue));
      if (analysis.coach?.betterFold) details.append(reviewDetailNode(analysis.coach.betterLabel || "更好会弃牌", analysis.coach.betterFold));
      if (analysis.coach?.plan) details.append(reviewDetailNode("后续计划", analysis.coach.plan));
      if (analysis.coach?.check) details.append(reviewDetailNode("复盘结论", analysis.coach.check));
      if (analysis.node) details.append(reviewDetailNode("节点", analysis.node));
      if (analysis.hand) details.append(reviewDetailNode("手牌与牌面", analysis.hand));
      if (analysis.price) details.append(reviewDetailNode("价格", analysis.price));
      if (analysis.matches?.length) details.append(knowledgeMatchesNode(analysis.matches));
      card.append(header, comparison, distributionNode(decision.distribution), takeaway, details);
      card.addEventListener("click", () => {
        const matching = review.timeline.findIndex(step => step.actorSeat === HERO_SEAT
          && step.street === decision.street && step.actionLabel === decision.chosen);
        if (matching >= 0) renderReviewStep(matching);
      });
      el["live-review-decisions"].append(card);
    });
  }

  function populateReviewSelect(selectedId) {
    el["live-review-hand-select"].replaceChildren();
    state.reviews.forEach((review, index) => {
      const option = document.createElement("option");
      option.value = review.id;
      option.textContent = `最近第 ${index + 1} 手 · ${signedBb(review.handNet)}`;
      option.selected = review.id === selectedId;
      el["live-review-hand-select"].append(option);
    });
  }

  function openReview(review = state.currentReview || state.reviews[0]) {
    if (!review) return;
    state.currentReview = review;
    populateReviewSelect(review.id);
    const summary = document.createDocumentFragment();
    const items = [
      ["结果", signedBb(review.handNet)],
      ["英雄手牌", review.heroCards.map(displayCard).join(" ")],
      ["公共牌", review.board.map(displayCard).join(" ") || "未发翻牌"],
      ["贴合度", review.decisionAverage === null ? "—" : `${review.decisionAverage}%`]
    ];
    items.forEach(([label, value]) => {
      const span = document.createElement("span");
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      span.append(small, strong);
      summary.append(span);
    });
    el["live-review-summary"].replaceChildren(summary);
    el["live-review-slider"].max = String(Math.max(0, review.timeline.length - 1));
    el["live-review-title"].textContent = `第 ${review.handNumber} 手复盘`;
    renderReviewDecisions(review);
    renderReviewStep(review.timeline.length - 1);
    el["live-review-dialog"].showModal();
  }

  function enter() {
    state.active = true;
    if (!state.initialized) createTable();
    else if (state.handRunning) runLoop();
  }

  function leave() {
    state.active = false;
    clearTimeout(state.botTimer);
  }

  el["live-bet-slider"].addEventListener("input", () => {
    const chips = Math.round(Number(el["live-bet-slider"].value) * SCALE);
    el["live-bet-output"].textContent = formatBb(chips);
    state.customAction = customCandidateFor(chips);
    el["live-bet-confirm"].disabled = !state.customAction;
  });

  el["live-bet-confirm"].addEventListener("click", () => {
    if (!state.customAction || state.engine.state.actionTo !== HERO_SEAT) return;
    const candidates = legalCandidates(HERO_SEAT);
    const strategy = strategyFor(HERO_SEAT, candidates);
    const candidate = state.customAction;
    clearControls();
    try {
      actCandidate(HERO_SEAT, candidate, strategy, true);
      runLoop();
    } catch (error) {
      showEngineError(error);
    }
  });

  el["live-next-hand-button"].addEventListener("click", startHand);
  el["live-review-button"].addEventListener("click", () => openReview());
  el["live-history-button"].addEventListener("click", () => openReview(state.reviews[0]));
  el["live-review-close"].addEventListener("click", () => el["live-review-dialog"].close());
  el["live-review-prev"].addEventListener("click", () => renderReviewStep(state.reviewStep - 1));
  el["live-review-next"].addEventListener("click", () => renderReviewStep(state.reviewStep + 1));
  el["live-review-slider"].addEventListener("input", () => renderReviewStep(Number(el["live-review-slider"].value)));
  el["live-review-hand-select"].addEventListener("change", () => {
    const review = state.reviews.find(item => item.id === el["live-review-hand-select"].value);
    if (review) openReview(review);
  });
  el["live-review-dialog"].addEventListener("click", event => {
    if (event.target === el["live-review-dialog"]) el["live-review-dialog"].close();
  });

  window.LivePractice = {
    enter,
    leave,
    newHand,
    _state: state,
    _test: { legalCandidates, strategyFor, totalPot, specificRangeComparison, matchKnowledgeCases, postflopProfile }
  };
})();
