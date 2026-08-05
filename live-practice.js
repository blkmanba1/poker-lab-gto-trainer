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
  const KNOWLEDGE_POLICY = {
    sources: "核心概念 · 翻后决策框架 · 一手牌讲解集合摘要",
    sequence: "还原节点 → 比较范围 → 计算价格 → 构造价值/诈唬 → 检查阻挡牌",
    multiwayAggressionFactor: 0.72,
    pairedBoardAggressionFactor: 0.86,
    monotoneBoardAggressionFactor: 0.88,
    blockerBluffFactor: 1.12,
    expensiveCallFactor: 0.72,
    cheapCallFactor: 1.12,
    ...(KNOWLEDGE_BUNDLE?.rules?.strategy || {}),
    sequence: KNOWLEDGE_BUNDLE?.rules?.sequence?.join(" → ") || "还原节点 → 比较范围 → 计算价格 → 构造价值/诈唬 → 检查阻挡牌",
    sources: KNOWLEDGE_BUNDLE?.rules?.sourceDocuments?.join(" · ") || "核心概念 · 翻后决策框架 · 一手牌讲解集合摘要"
  };
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

  function postflopProfile(seat) {
    const gameState = state.engine.state;
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
    const pot = totalPot(gameState);
    const potOdds = toCall > 0 ? toCall / Math.max(1, pot + toCall) : 0;
    const blockerSuit = gameState.board.length && maxSuit >= 2
      ? Object.entries(suits).find(([, count]) => count === maxSuit)?.[0]
      : null;
    const blocksFlush = Boolean(blockerSuit && player.hand.some(card => card[1] === blockerSuit));
    return {
      activePlayers,
      multiway: activePlayers >= 3,
      pairedBoard,
      monotonePressure: maxSuit >= 3,
      blocksFlush,
      potOdds,
      position: positionForSeat(seat, gameState)
    };
  }

  function applyKnowledgePolicy(weights, signals, street, facingBet, draw) {
    const adjusted = { ...weights };
    const notes = [];
    if (signals.multiway) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.multiwayAggressionFactor;
      if (adjusted.fold) adjusted.fold *= 1.12;
      notes.push(`多人池 ${signals.activePlayers} 人：减少边缘诈唬，收紧薄价值`);
    }
    if (street !== "PREFLOP" && signals.pairedBoard) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.pairedBoardAggressionFactor;
      notes.push("公共牌成对：重注范围需要更明确的坚果与极化依据");
    }
    if (street !== "PREFLOP" && signals.monotonePressure) {
      if (adjusted.aggressive) adjusted.aggressive *= KNOWLEDGE_POLICY.monotoneBoardAggressionFactor;
      notes.push("同花压力：减少无阻挡的边缘进攻");
    }
    if (facingBet && adjusted.call) {
      if (signals.potOdds >= 0.32) {
        adjusted.call *= KNOWLEDGE_POLICY.cheapCallFactor;
        notes.push(`价格约 ${Math.round(signals.potOdds * 100)}%：提高有权益继续牌的跟注权重`);
      } else if (signals.potOdds >= 0.2) {
        adjusted.call *= KNOWLEDGE_POLICY.expensiveCallFactor;
        notes.push(`价格约 ${Math.round(signals.potOdds * 100)}%：收紧没有足够权益实现的跟注`);
      }
    }
    if (street !== "PREFLOP" && draw && signals.blocksFlush && adjusted.aggressive) {
      adjusted.aggressive *= KNOWLEDGE_POLICY.blockerBluffFactor;
      notes.push("手牌阻挡同花组合：保留少量更合适的半诈唬/施压组合");
    }
    if (!notes.length) notes.push("按节点、价格和范围结构维持基础混合");
    return { weights: adjusted, notes };
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
      const profile = postflopProfile(seat);
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

    const policy = applyKnowledgePolicy(weights, signals, gameState.street, facingBet, draw);
    weights = policy.weights;
    const queryTerms = [
      signals.multiway && "多人底池",
      signals.pairedBoard && "成对牌面",
      signals.monotonePressure && "同花",
      facingBet && "底池赔率",
      signals.blocksFlush && "阻挡",
      gameState.street === "PREFLOP" ? "翻前范围" : "范围优势 坚果优势 下注尺度"
    ].filter(Boolean);
    const knowledgeMatches = KNOWLEDGE_BUNDLE?.search?.(queryTerms, 3) || [];
    const knowledgeSummary = `${policy.notes.join("；")}。依据：${KNOWLEDGE_POLICY.sequence}。`;
    const groupWeights = normalizeGroupWeights(weights, candidates);
    const entries = [];
    Object.entries(groupWeights).forEach(([group, groupFrequency]) => {
      const groupCandidates = candidates.filter(item => item.group === group);
      if (group !== "aggressive" || groupCandidates.length === 1) {
        groupCandidates.forEach(item => entries.push({ ...item, frequency: groupFrequency / groupCandidates.length }));
        return;
      }
      const allocations = groupCandidates.map(item => item.size === "small" ? 0.56 : item.size === "large" ? 0.36 : 0.08);
      const allocationTotal = allocations.reduce((sum, value) => sum + value, 0);
      groupCandidates.forEach((item, index) => entries.push({
        ...item,
        frequency: groupFrequency * allocations[index] / allocationTotal
      }));
    });
    entries.sort((a, b) => b.frequency - a.frequency);
    return { entries, reason, groupWeights, knowledgeSummary, knowledgeSignals: signals, knowledgeSources: KNOWLEDGE_POLICY.sources, knowledgeMatches };
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
    const ranks = cards.map(card => card[0]).join("");
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
    const priceText = toCall > 0
      ? `需补 ${formatBb(toCall)}，跟注后总底池约 ${formatBb(pot + toCall)}，盈亏平衡权益约 ${Math.round(price * 100)}%。`
      : `当前无需补筹码，可以免费过牌；若主动下注，需要说明更差牌为何跟注或更好牌为何弃牌。`;
    const structureText = gameState.street === "PREFLOP"
      ? `翻前先按 ${positionForSeat(seat, gameState)} 位置、前序加注压力和手牌可玩性确定继续范围，再在跟注与再加注之间分配组合。`
      : `翻后按“范围与坚果关系 → 尺度 → 价值/诈唬构造 → 阻挡牌”的顺序检查；当前简化引擎主要使用成牌、听牌和价格。`;
    return {
      node: `${activePlayers} 人仍在牌局 · 底池 ${formatBb(pot)} · 你的后手 ${formatBb(player.stack)}${spr === null ? "" : ` · SPR ${spr.toFixed(1)}`}`,
      hand: `${player.hand.map(displayCard).join(" ")} · ${hand}${gameState.board.length ? `；${boardTexture(gameState.board)}` : ""}`,
      price: priceText,
      structure: structureText,
      frequency: `你的行动在当前近似策略中占 ${chosenFrequency}%，最高频行动占 ${topFrequency}%。频率用于比较策略结构，不是精确 Solver 输出。`,
      knowledge: strategy.knowledgeSummary,
      sources: strategy.knowledgeSources,
      matches: strategy.knowledgeMatches
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

  function knowledgeMatchesNode(matches) {
    const section = document.createElement("div");
    section.className = "review-knowledge-hits";
    const title = document.createElement("strong");
    title.textContent = "命中的知识条目";
    section.append(title);
    matches.forEach(match => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-knowledge-hit";
      const heading = document.createElement("b");
      heading.textContent = match.title;
      const excerpt = document.createElement("span");
      excerpt.textContent = match.excerpt;
      button.append(heading, excerpt);
      button.addEventListener("click", event => {
        event.stopPropagation();
        window.PokerKnowledgeUI?.openDocument(match.id);
      });
      section.append(button);
    });
    return section;
  }

  function decisionFeedback(decision) {
    const chosenFrequency = decision.distribution.find(item => item.label === decision.chosen)?.frequency || 0;
    const recommendedFrequency = decision.distribution.find(item => item.label === decision.recommended)?.frequency || 0;
    if (decision.tone === "good") {
      return `这次选择落在策略的主要分支中。重点不是“猜中答案”，而是能否用位置、价格和范围结构解释为什么该分支需要高频存在。`;
    }
    if (decision.tone === "mixed") {
      return `${decision.chosen} 是可保留的混合分支，但当前只有约 ${chosenFrequency}%，低于主策略 ${decision.recommended} 的约 ${recommendedFrequency}%。下次先确认是什么牌型或阻挡条件让你偏向低频支线。`;
    }
    return `${decision.chosen} 在当前模型中只有约 ${chosenFrequency}%，明显低于主策略 ${decision.recommended} 的约 ${recommendedFrequency}%。优先检查是否高估了绝对牌力、忽略了价格，或用“可能有诈唬”代替了范围构造。`;
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
      const details = document.createElement("div");
      details.className = "review-detail-list";
      const analysis = decision.analysis || {};
      if (analysis.node) details.append(reviewDetailNode("节点", analysis.node));
      if (analysis.hand) details.append(reviewDetailNode("手牌与牌面", analysis.hand));
      if (analysis.price) details.append(reviewDetailNode("价格", analysis.price));
      details.append(reviewDetailNode("策略逻辑", analysis.structure || decision.reason));
      details.append(reviewDetailNode("你的选择", decisionFeedback(decision)));
      if (analysis.frequency) details.append(reviewDetailNode("频率边界", analysis.frequency));
      if (analysis.knowledge) details.append(reviewDetailNode("复盘顺序", analysis.knowledge));
      if (analysis.sources) details.append(reviewDetailNode("知识来源", analysis.sources));
      if (analysis.matches?.length) details.append(knowledgeMatchesNode(analysis.matches));
      card.append(header, comparison, distributionNode(decision.distribution), details);
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

  window.LivePractice = { enter, leave, newHand, _state: state, _test: { legalCandidates, strategyFor, totalPot } };
})();
