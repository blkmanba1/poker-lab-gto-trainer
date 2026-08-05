(() => {
  "use strict";

  const POSITIONS = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
  const STREET_NAMES = { preflop: "翻前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };
  const NEXT_STREET = { preflop: "flop", flop: "turn", turn: "river", river: "showdown" };
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const SUITS = ["s", "h", "d", "c"];
  const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const PLAYER_NAMES = ["你", "Mina", "River", "Theo", "Nova", "Alex"];

  const el = Object.fromEntries([
    "live-workspace", "live-table-shell", "live-hand-number", "live-street", "live-board", "live-pot",
    "live-seats", "live-action-bubble", "live-node-label", "live-prompt", "live-context", "live-actions",
    "live-recommendation", "live-result-mark", "live-best-action", "live-reason", "live-plan",
    "live-continue-button", "live-hero-position", "live-line-log"
  ].map(id => [id, document.getElementById(id)]));

  const state = {
    initialized: false,
    handNumber: 0,
    dealerSeat: -1,
    street: "preflop",
    deck: [],
    holeCards: [],
    board: [],
    positions: [],
    opponentSeat: 0,
    stacks: Array(6).fill(100),
    pot: 1.5,
    node: null,
    recommendation: null,
    chosen: null,
    line: [],
    handOver: false
  };

  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0) throw new RangeError("max must be a positive integer");
    const range = 0x100000000;
    const limit = Math.floor(range / max) * max;
    const value = new Uint32Array(1);
    do crypto.getRandomValues(value); while (value[0] >= limit);
    return value[0] % max;
  }

  function chance(percent) {
    return secureRandomInt(100) < percent;
  }

  function shuffledDeck() {
    const cards = SUITS.flatMap(suit => RANKS.map(rank => `${rank}${suit}`));
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function positionForSeat(seat) {
    return POSITIONS[(seat - state.dealerSeat + 6) % 6];
  }

  function seatForPosition(position) {
    return state.positions.indexOf(position);
  }

  function displayCard(card) {
    return `${card[0]}${SUIT_SYMBOL[card[1]]}`;
  }

  function cardNode(card, hidden = false) {
    const node = document.createElement("span");
    if (hidden) {
      node.className = "live-card back";
      node.setAttribute("aria-label", "暗牌");
      return node;
    }
    const suit = SUIT_SYMBOL[card[1]];
    node.className = `live-card ${/[hd]/.test(card[1]) ? "red" : "black"}`;
    node.textContent = card[0];
    node.dataset.suit = suit;
    node.setAttribute("aria-label", displayCard(card));
    return node;
  }

  function formatBb(value) {
    return `${Number(value.toFixed(1))}BB`;
  }

  function renderSeats(revealOpponent = false) {
    el["live-seats"].replaceChildren();
    for (let seat = 0; seat < 6; seat += 1) {
      const wrapper = document.createElement("div");
      const isHero = seat === 0;
      const isOpponent = seat === state.opponentSeat;
      wrapper.className = `live-seat${isHero ? " hero" : ""}${isOpponent ? " opponent" : ""}${!isHero && !isOpponent ? " folded" : ""}`;
      wrapper.dataset.index = seat;

      const cards = document.createElement("div");
      cards.className = "live-seat-cards";
      const shouldReveal = isHero || (isOpponent && revealOpponent);
      state.holeCards[seat].forEach(card => cards.append(cardNode(card, !shouldReveal)));

      const info = document.createElement("div");
      info.className = "live-seat-info";
      const avatar = document.createElement("span");
      avatar.className = "live-avatar";
      avatar.textContent = isHero ? "YOU" : PLAYER_NAMES[seat][0];
      const name = document.createElement("span");
      name.className = "live-seat-name";
      name.textContent = PLAYER_NAMES[seat];
      const stack = document.createElement("span");
      stack.className = "live-seat-stack";
      stack.textContent = formatBb(state.stacks[seat]);
      const position = document.createElement("span");
      position.className = "live-position";
      position.textContent = state.positions[seat];
      info.append(avatar, name, stack, position);
      wrapper.append(cards, info);
      el["live-seats"].append(wrapper);
    }
  }

  function visibleBoardCount() {
    return { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 }[state.street];
  }

  function renderBoard() {
    el["live-board"].replaceChildren();
    state.board.slice(0, visibleBoardCount()).forEach((card, index) => {
      const node = cardNode(card);
      node.style.animationDelay = `${index * 55}ms`;
      el["live-board"].append(node);
    });
  }

  function renderTable(revealOpponent = false) {
    renderSeats(revealOpponent);
    renderBoard();
    el["live-pot"].textContent = `底池 ${formatBb(state.pot)}`;
    el["live-hand-number"].textContent = `第 ${state.handNumber} 手`;
    el["live-street"].textContent = STREET_NAMES[state.street];
    el["live-hero-position"].textContent = state.positions[0];
  }

  function setBubble(text) {
    el["live-action-bubble"].textContent = text;
    el["live-action-bubble"].hidden = false;
    clearTimeout(setBubble.timer);
    setBubble.timer = setTimeout(() => { el["live-action-bubble"].hidden = true; }, 1500);
  }

  function addLine(text) {
    state.line.push(text);
    el["live-line-log"].replaceChildren();
    state.line.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      el["live-line-log"].append(li);
    });
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

  function chooseOpponent(candidates) {
    const valid = candidates.map(seatForPosition).filter(seat => seat > 0);
    return valid.length ? valid[secureRandomInt(valid.length)] : 1;
  }

  function createPreflopNode() {
    const heroPos = state.positions[0];
    const roll = secureRandomInt(100);
    let type = "unopened";
    if (heroPos === "BB") type = "facingOpen";
    else if (heroPos !== "UTG" && roll < 34) type = "facingOpen";
    else if (roll >= 78) type = "facing3bet";

    if (type === "unopened") {
      state.opponentSeat = chooseOpponent(heroPos === "SB" ? ["BB"] : ["BB", "SB"]);
      state.pot = 1.5;
      return {
        type,
        opponentAction: "前位玩家均弃牌到你",
        prompt: `${heroPos} 首入池怎么行动？`,
        context: `有效筹码 100BB，盲注 0.5/1BB。${state.positions[state.opponentSeat]} 在后续等待。`,
        actions: [
          { key: "fold", label: "弃牌" },
          { key: "raise", label: "加注到 2.5BB", aggressive: true }
        ]
      };
    }

    if (type === "facingOpen") {
      const openersByHero = {
        HJ: ["UTG"], CO: ["UTG", "HJ"], BTN: ["HJ", "CO"],
        SB: ["CO", "BTN"], BB: ["UTG", "HJ", "CO", "BTN", "SB"]
      };
      state.opponentSeat = chooseOpponent(openersByHero[heroPos] || ["UTG"]);
      const opener = state.positions[state.opponentSeat];
      state.pot = opener === "SB" ? 3.5 : 4;
      state.stacks[state.opponentSeat] -= opener === "SB" ? 2.5 : 2.5;
      return {
        type,
        opener,
        opponentAction: `${opener} 加注到 2.5BB，其余玩家弃牌`,
        prompt: `面对 ${opener} 加注怎么行动？`,
        context: `${heroPos} 对 ${opener}，有效筹码约 97.5BB，当前底池 ${formatBb(state.pot)}。`,
        actions: [
          { key: "fold", label: "弃牌" },
          { key: "call", label: "跟注 2.5BB" },
          { key: "raise", label: "3Bet 到 9BB", aggressive: true }
        ]
      };
    }

    state.opponentSeat = chooseOpponent(["SB", "BB", "BTN", "CO"]);
    const aggressor = state.positions[state.opponentSeat];
    state.pot = 12.5;
    state.stacks[0] -= 2.5;
    state.stacks[state.opponentSeat] -= 9;
    return {
      type,
      opener: aggressor,
      opponentAction: `你加注到 2.5BB，${aggressor} 3Bet 到 9BB`,
      prompt: `面对 ${aggressor} 3Bet 怎么行动？`,
      context: `${heroPos} 对 ${aggressor}，你还需投入 6.5BB，当前底池 12.5BB。`,
      actions: [
        { key: "fold", label: "弃牌" },
        { key: "call", label: "跟注 6.5BB" },
        { key: "raise", label: "4Bet 到 22BB", aggressive: true }
      ]
    };
  }

  function preflopRecommendation() {
    const details = preflopScore(state.holeCards[0]);
    const heroPos = state.positions[0];
    const hand = state.holeCards[0].map(displayCard).join(" ");
    let action = "fold";
    let reason;
    let plan;

    if (state.node.type === "unopened") {
      const threshold = { UTG: 65, HJ: 59, CO: 51, BTN: 44, SB: 48 }[heroPos] || 60;
      action = details.score >= threshold ? "raise" : "fold";
      reason = action === "raise"
        ? `${hand} 达到 ${heroPos} 常用首入池基线。牌力与位置允许你主动争夺盲注，并用统一加注尺度保持范围完整。`
        : `${hand} 在 ${heroPos} 的实现权益有限。首入池范围需要受位置约束，直接弃牌比用边缘牌制造弱范围更稳健。`;
      plan = action === "raise" ? "被盲位跟注后进入单加注底池，翻牌根据范围优势和牌面结构决定是否小注。" : "结束本手，下一手继续按位置轮转。";
    } else if (state.node.type === "facingOpen") {
      const openerTightness = { UTG: 8, HJ: 5, CO: 1, BTN: -3, SB: -4 }[state.node.opener] || 0;
      const callThreshold = (heroPos === "BB" ? 49 : 61) + openerTightness;
      if (details.score >= 88 || (details.pair && details.high >= 12)) action = "raise";
      else if (details.score >= callThreshold) action = "call";
      reason = action === "raise"
        ? `${hand} 位于对抗 ${state.node.opener} 开池范围的价值 3Bet 区间，主动加注可以建立底池并降低多人入池概率。`
        : action === "call"
          ? `${hand} 对当前开池范围和价格有足够继续权益。跟注保留对手的弱牌，同时控制边缘牌的底池规模。`
          : `${hand} 对 ${state.node.opener} 的开池范围缺少足够权益或可实现性，继续会在翻后频繁陷入被支配局面。`;
      plan = action === "fold" ? "结束本手。" : action === "raise" ? "对手跟注后以 3Bet 底池进入翻牌，优先关注高牌面的小尺度持续下注。" : "进入单加注底池；有位置时扩大可实现权益，无位置时减少边缘跟注。";
    } else {
      if (details.score >= 94 || (details.pair && details.high >= 13)) action = "raise";
      else if (details.score >= 72 || (details.pair && details.high >= 9)) action = "call";
      reason = action === "raise"
        ? `${hand} 足以进入对抗 3Bet 的价值 4Bet 区间。用小 4Bet 保留对手继续范围，同时为后续街建立低 SPR。`
        : action === "call"
          ? `${hand} 有足够权益继续，但直接 4Bet 会隔离掉许多较弱牌。跟注能保留对手的诈唬并利用位置或牌型可玩性。`
          : `${hand} 面对 3Bet 的价格和强范围难以盈利实现权益。放弃此前投入，避免沉没成本影响决策。`;
      plan = action === "fold" ? "结束本手。" : "进入 3Bet 或 4Bet 底池，低 SPR 下更重视顶对以上牌力，减少无后门的浮动。";
    }
    return { action, reason, plan };
  }

  function knownCards() {
    return [...state.holeCards[0], ...state.board.slice(0, visibleBoardCount())];
  }

  function solve(cards) {
    if (!window.PokerSolver?.Hand) throw new Error("牌型计算器未加载");
    return window.PokerSolver.Hand.solve(cards);
  }

  function handLabel(hand) {
    const rank = hand.cards?.[0]?.value?.replace("T", "10") || "";
    const labels = {
      "High Card": `${rank}高`, Pair: `${rank}对`, "Two Pair": "两对",
      "Three of a Kind": "三条", Straight: "顺子", Flush: "同花",
      "Full House": "葫芦", "Four of a Kind": "四条", "Straight Flush": "同花顺"
    };
    return hand.descr === "Royal Flush" ? "皇家同花顺" : labels[hand.name] || hand.name;
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

  function boardTexture() {
    const visible = state.board.slice(0, visibleBoardCount());
    const suitCounts = visible.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const paired = new Set(visible.map(card => card[0])).size < visible.length;
    const values = visible.map(card => rankValue(card[0])).sort((a, b) => a - b);
    const connected = values.some((value, index) => index && value - values[index - 1] <= 2);
    const monotone = Object.values(suitCounts).some(count => count >= 3);
    const wet = monotone || (connected && Object.values(suitCounts).some(count => count >= 2));
    return { paired, connected, monotone, wet };
  }

  function postflopProfile() {
    const cards = knownCards();
    const hand = solve(cards);
    const category = hand.name;
    const categoryStrength = {
      "High Card": 0, Pair: 1, "Two Pair": 4, "Three of a Kind": 4,
      Straight: 5, Flush: 5, "Full House": 6, "Four of a Kind": 6, "Straight Flush": 6
    }[category] ?? 0;
    let strength = categoryStrength;
    const board = state.board.slice(0, visibleBoardCount());
    const heroRanks = state.holeCards[0].map(card => rankValue(card[0]));
    const boardRanks = board.map(card => rankValue(card[0]));
    const topBoard = Math.max(...boardRanks);
    const pocketPair = heroRanks[0] === heroRanks[1];
    const topPair = heroRanks.includes(topBoard);
    if (category === "Pair" && (topPair || (pocketPair && heroRanks[0] > topBoard))) strength = 3;
    else if (category === "Pair") strength = 2;

    const allSuits = cards.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const flushDraw = visibleBoardCount() < 5 && Object.values(allSuits).some(count => count === 4);
    const hasStraightDraw = visibleBoardCount() < 5 && straightDraw(cards);
    const overcards = category === "High Card" && heroRanks.filter(rank => rank > topBoard).length;
    return { hand, category, strength, flushDraw, straightDraw: hasStraightDraw, overcards, texture: boardTexture() };
  }

  function heroActsFirst() {
    const order = ["SB", "BB", "UTG", "HJ", "CO", "BTN"];
    return order.indexOf(state.positions[0]) < order.indexOf(state.positions[state.opponentSeat]);
  }

  function createPostflopNode() {
    const opponentPos = state.positions[state.opponentSeat];
    const first = heroActsFirst();
    let opponentAction = "";
    let facingBet = false;
    let betSize = 0;

    if (!first) {
      facingBet = chance(state.street === "river" ? 36 : 42);
      if (facingBet) {
        const fraction = chance(62) ? .33 : .66;
        betSize = Math.max(.5, Math.round(state.pot * fraction * 2) / 2);
        state.pot += betSize;
        state.stacks[state.opponentSeat] = Math.max(0, state.stacks[state.opponentSeat] - betSize);
        opponentAction = `${opponentPos} 下注 ${formatBb(betSize)}（约 ${Math.round(fraction * 100)}% 底池）`;
      } else {
        opponentAction = `${opponentPos} 过牌`;
      }
    }

    const actions = facingBet ? [
      { key: "fold", label: "弃牌" },
      { key: "call", label: `跟注 ${formatBb(betSize)}` },
      { key: "raise", label: `加注到 ${formatBb(betSize * 3)}`, aggressive: true }
    ] : [
      { key: "check", label: "过牌" },
      { key: "bet-small", label: "下注 33% 底池", aggressive: true },
      { key: "bet-big", label: "下注 75% 底池", aggressive: true }
    ];

    return {
      type: "postflop",
      facingBet,
      betSize,
      opponentAction,
      prompt: `${STREET_NAMES[state.street]}轮到你，怎么行动？`,
      context: `${state.positions[0]} 对 ${opponentPos} · 底池 ${formatBb(state.pot)}${opponentAction ? ` · ${opponentAction}` : " · 你首先行动"}`,
      actions
    };
  }

  function postflopRecommendation() {
    const profile = postflopProfile();
    const facingBet = state.node.facingBet;
    const draw = profile.flushDraw || profile.straightDraw;
    let action;

    if (facingBet) {
      if (profile.strength >= 5 || (profile.strength >= 4 && !profile.texture.wet)) action = "raise";
      else if (profile.strength >= 2 || draw || (state.node.betSize <= state.pot * .3 && profile.overcards === 2)) action = "call";
      else action = "fold";
    } else if (profile.strength >= 5) {
      action = "bet-big";
    } else if (profile.strength >= 3) {
      action = profile.texture.wet ? "bet-big" : "bet-small";
    } else if (profile.strength === 2) {
      action = "check";
    } else if (draw) {
      action = "bet-small";
    } else if (state.street === "flop" && !profile.texture.wet && chance(48)) {
      action = "bet-small";
    } else {
      action = "check";
    }

    const textureText = profile.texture.monotone ? "同花面" : profile.texture.paired ? "对子面" : profile.texture.wet ? "动态牌面" : "相对静态牌面";
    const madeHand = handLabel(profile.hand);
    const drawText = [profile.flushDraw && "同花听牌", profile.straightDraw && "顺子听牌"].filter(Boolean).join("和");
    let reason;
    if (action === "raise") reason = `当前成牌为${madeHand}，在${textureText}面对下注仍有较强价值。加注能向较弱成牌和听牌收费，并为后续街建立清晰的价值线路。`;
    else if (action === "call") reason = draw
      ? `你有${drawText}，当前价格允许继续实现权益。跟注保留对手的诈唬，同时避免把中等权益牌过度膨胀。`
      : `当前成牌为${madeHand}，足以覆盖对手部分价值下注与诈唬。跟注比加注更能保留其弱范围。`;
    else if (action === "fold") reason = `当前仅为${madeHand}，且缺少足够的强后门或直接听牌。面对该下注继续，长期会为过弱的权益支付过高价格。`;
    else if (action === "bet-big") reason = `当前成牌为${madeHand}，在${textureText}拥有较强价值。大尺度能向听牌或次强成牌收费，并让价值范围与强诈唬保持极化。`;
    else if (action === "bet-small") reason = draw
      ? `你有${drawText}。小尺度半诈唬能制造弃牌率，在被跟注时仍保留改善到强牌的权益。`
      : `在${textureText}上，小尺度可用较低成本争取弃牌并保持宽范围施压，不必把底池立即做大。`;
    else reason = `当前成牌为${madeHand}，在${textureText}更适合过牌控制底池。你保留摊牌价值，也避免让较弱牌只在领先时继续。`;

    const plan = state.street === "river"
      ? "河牌行动后进入摊牌；复盘时比较你的选择与推荐线路，而不是只看单次输赢。"
      : action === "fold"
        ? "结束本手。"
        : draw
          ? `未完成听牌时根据新牌和下注价格重新评估；改善后继续取价值。`
          : `下一街重新检查牌面变化、对手尺度与剩余筹码，不自动延续上一街动作。`;
    return { action, reason, plan, category: profile.category };
  }

  function labelForAction(key) {
    return state.node.actions.find(action => action.key === key)?.label || key;
  }

  function renderNode() {
    state.recommendation = state.street === "preflop" ? preflopRecommendation() : postflopRecommendation();
    state.chosen = null;
    el["live-node-label"].textContent = `${STREET_NAMES[state.street]} · 你的决策`;
    el["live-prompt"].textContent = state.node.prompt;
    el["live-context"].textContent = state.node.context;
    el["live-recommendation"].hidden = true;
    el["live-actions"].replaceChildren();
    state.node.actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `live-action-button${action.aggressive ? " aggressive" : ""}`;
      button.dataset.action = action.key;
      button.textContent = action.label;
      button.addEventListener("click", () => chooseAction(action.key));
      el["live-actions"].append(button);
    });
    if (state.node.opponentAction) setBubble(state.node.opponentAction);
  }

  function commitActionToPot(action) {
    if (state.street === "preflop") {
      if (action === "call") {
        const amount = state.node.type === "facing3bet" ? 6.5 : state.positions[0] === "BB" ? 1.5 : 2.5;
        state.stacks[0] = Math.max(0, state.stacks[0] - amount);
        state.pot += amount;
      } else if (action === "raise") {
        const target = state.node.type === "unopened" ? 2.5 : state.node.type === "facingOpen" ? 9 : 22;
        const heroPaid = state.node.type === "facing3bet" ? 2.5 : 0;
        state.stacks[0] = Math.max(0, state.stacks[0] - (target - heroPaid));
        const blindCall = state.positions[state.opponentSeat] === "BB" ? 1.5 : 2;
        const opponentCall = state.node.type === "unopened" ? blindCall : state.node.type === "facingOpen" ? 6.5 : 13;
        const opponentStackCost = state.node.type === "unopened" ? 2.5 : opponentCall;
        state.stacks[state.opponentSeat] = Math.max(0, state.stacks[state.opponentSeat] - opponentStackCost);
        state.pot += target - heroPaid + opponentCall;
        setBubble(`${state.positions[state.opponentSeat]} 跟注`);
      }
      return;
    }

    if (action === "call") {
      state.stacks[0] = Math.max(0, state.stacks[0] - state.node.betSize);
      state.pot += state.node.betSize;
    } else if (action === "raise") {
      const total = state.node.betSize * 3;
      state.stacks[0] = Math.max(0, state.stacks[0] - total);
      state.stacks[state.opponentSeat] = Math.max(0, state.stacks[state.opponentSeat] - state.node.betSize * 2);
      state.pot += total + state.node.betSize * 2;
      setBubble(`${state.positions[state.opponentSeat]} 跟注加注`);
    } else if (action.startsWith("bet")) {
      const fraction = action === "bet-small" ? .33 : .75;
      const amount = Math.max(.5, Math.round(state.pot * fraction * 2) / 2);
      state.stacks[0] = Math.max(0, state.stacks[0] - amount);
      state.stacks[state.opponentSeat] = Math.max(0, state.stacks[state.opponentSeat] - amount);
      state.pot += amount * 2;
      setBubble(`${state.positions[state.opponentSeat]} 跟注 ${formatBb(amount)}`);
    }
  }

  function chooseAction(action) {
    if (state.chosen || state.handOver) return;
    state.chosen = action;
    const isBest = action === state.recommendation.action;
    const buttons = [...el["live-actions"].querySelectorAll("button")];
    buttons.forEach(button => {
      button.disabled = true;
      if (button.dataset.action === action) button.classList.add("selected");
      if (button.dataset.action === state.recommendation.action) button.classList.add("best");
    });

    addLine(`${STREET_NAMES[state.street]}：你选择${labelForAction(action)}；推荐${labelForAction(state.recommendation.action)}`);
    el["live-result-mark"].textContent = isBest ? "✓" : "↗";
    el["live-result-mark"].style.background = isBest ? "#2c7c5c" : "#c48e26";
    el["live-best-action"].textContent = labelForAction(state.recommendation.action);
    el["live-reason"].textContent = state.recommendation.reason;
    el["live-plan"].textContent = state.recommendation.plan;

    const folded = action === "fold";
    if (!folded) commitActionToPot(action);
    state.handOver = folded;
    el["live-continue-button"].textContent = folded
      ? "开始下一手"
      : state.street === "river" ? "查看摊牌" : `继续到${STREET_NAMES[NEXT_STREET[state.street]]}`;
    el["live-recommendation"].hidden = false;
    renderSeats(false);
    el["live-pot"].textContent = `底池 ${formatBb(state.pot)}`;
  }

  function advance() {
    if (!state.chosen) return;
    if (state.handOver) {
      newHand();
      return;
    }
    const next = NEXT_STREET[state.street];
    if (next === "showdown") {
      showShowdown();
      return;
    }
    state.street = next;
    state.node = createPostflopNode();
    renderTable(false);
    renderNode();
  }

  function showShowdown() {
    state.street = "showdown";
    state.handOver = true;
    const hero = solve([...state.holeCards[0], ...state.board]);
    const opponent = solve([...state.holeCards[state.opponentSeat], ...state.board]);
    const winners = window.PokerSolver.Hand.winners([hero, opponent]);
    const heroWins = winners.includes(hero);
    const opponentWins = winners.includes(opponent);
    const result = heroWins && opponentWins ? "平分底池" : heroWins ? "你赢得底池" : `${state.positions[state.opponentSeat]} 赢得底池`;
    renderTable(true);
    el["live-node-label"].textContent = "摊牌 · 结果";
    el["live-prompt"].textContent = result;
    el["live-context"].textContent = `你：${handLabel(hero)} · 对手：${handLabel(opponent)}`;
    el["live-actions"].replaceChildren();
    addLine(`摊牌：${result}（你是${handLabel(hero)}）`);
    el["live-best-action"].textContent = "本手复盘完成";
    el["live-reason"].textContent = "单手结果不评价决策质量。复盘时优先检查每条街是否依据位置、赔率、牌力和牌面变化更新判断。";
    el["live-plan"].textContent = "开始下一手后庄位顺时针轮转，并重新洗入完整 52 张牌。";
    el["live-continue-button"].textContent = "开始下一手";
    el["live-recommendation"].hidden = false;
  }

  function newHand() {
    state.initialized = true;
    state.handNumber += 1;
    state.dealerSeat = (state.dealerSeat + 1) % 6;
    state.street = "preflop";
    state.deck = shuffledDeck();
    state.holeCards = Array.from({ length: 6 }, () => [state.deck.pop(), state.deck.pop()]);
    state.board = Array.from({ length: 5 }, () => state.deck.pop());
    state.positions = Array.from({ length: 6 }, (_, seat) => positionForSeat(seat));
    state.stacks = Array(6).fill(100);
    state.pot = 1.5;
    state.line = [];
    state.handOver = false;
    state.chosen = null;
    state.node = createPreflopNode();
    addLine(`${state.positions[0]} 拿到 ${state.holeCards[0].map(displayCard).join(" ")}；${state.node.opponentAction}`);
    renderTable(false);
    renderNode();
  }

  function enter() {
    if (!state.initialized) newHand();
  }

  el["live-continue-button"].addEventListener("click", advance);
  window.LivePractice = { enter, newHand, _state: state, _test: { shuffledDeck, solve } };
})();
