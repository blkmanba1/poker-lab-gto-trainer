(() => {
  "use strict";

  const kb = window.PokerKnowledgeBase;
  const policy = kb?.rules?.strategy || {};
  const streetLabels = { PREFLOP: "翻前", FLOP: "翻牌", TURN: "转牌", RIVER: "河牌" };
  const positionOrder = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };
  const rankOrder = "23456789TJQKA";
  const suitSymbol = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const ids = [
    "advisor-workspace", "advisor-question", "advisor-parse", "advisor-hero-position",
    "advisor-villain-position", "advisor-hero-cards", "advisor-flop", "advisor-turn",
    "advisor-river", "advisor-pot", "advisor-stack", "advisor-players", "advisor-action",
    "advisor-initiative", "advisor-line", "advisor-run", "advisor-error", "advisor-empty",
    "advisor-result", "advisor-stage-badge", "advisor-result-stage", "advisor-result-title",
    "advisor-result-meta", "advisor-cards", "advisor-takeaway-title", "advisor-takeaway-copy",
    "advisor-mix", "advisor-street-path", "advisor-reasons", "advisor-sources"
  ];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  if (!el["advisor-workspace"]) return;

  function parseCards(value) {
    const normalized = String(value || "")
      .replace(/10/gi, "T")
      .replace(/♠|黑桃/g, "s")
      .replace(/♥|红桃/g, "h")
      .replace(/♦|方片|方块/g, "d")
      .replace(/♣|梅花/g, "c");
    const cards = [];
    for (const match of normalized.matchAll(/([2-9TJQKA])\s*([shdc])/gi)) {
      cards.push(`${match[1].toUpperCase()}${match[2].toLowerCase()}`);
    }
    return cards;
  }

  function cardText(card) {
    return `${card[0]}${suitSymbol[card[1]]}`;
  }

  function segment(text, start, ends) {
    const endPattern = ends.join("|");
    const pattern = new RegExp(`(?:${start})[：:]?\\s*(.+?)(?=\\s*(?:${endPattern})[：:]?|$)`, "i");
    return text.match(pattern)?.[1]?.trim() || "";
  }

  function parseQuestion() {
    const text = el["advisor-question"].value.trim();
    if (!text) return showError("先输入一段牌局描述，或直接填写下方字段。");
    const positions = [...text.toUpperCase().matchAll(/\b(UTG|HJ|CO|BTN|SB|BB)\b/g)].map(match => match[1]);
    const heroPosition = text.match(/(?:我|HERO|英雄)[^，。;；\n]{0,16}?\b(UTG|HJ|CO|BTN|SB|BB)\b/i)?.[1]?.toUpperCase() || positions[0];
    const villainPosition = text.match(/(?:对手|VILLAIN)[^，。;；\n]{0,16}?\b(UTG|HJ|CO|BTN|SB|BB)\b/i)?.[1]?.toUpperCase()
      || positions.find(position => position !== heroPosition);
    const heroCards = parseCards(segment(text, "我的手牌|我的牌|手牌|底牌|HERO牌", ["翻牌", "转牌", "河牌", "底池", "有效筹码", "对手", "面对"]));
    const flop = parseCards(segment(text, "翻牌|FLOP", ["转牌", "河牌", "底池", "有效筹码", "对手", "面对"]));
    const turn = parseCards(segment(text, "转牌|TURN", ["河牌", "底池", "有效筹码", "对手", "面对"]));
    const river = parseCards(segment(text, "河牌|RIVER", ["底池", "有效筹码", "对手", "面对"]));
    const pot = text.match(/底池[约为是：:\s]*([\d.]+)\s*BB/i)?.[1];
    const stack = text.match(/(?:有效筹码|后手|筹码)[约为是：:\s]*([\d.]+)\s*BB/i)?.[1];

    if (heroPosition) el["advisor-hero-position"].value = heroPosition;
    if (villainPosition) el["advisor-villain-position"].value = villainPosition;
    if (heroCards.length) el["advisor-hero-cards"].value = heroCards.map(cardText).join(" ");
    if (flop.length) el["advisor-flop"].value = flop.map(cardText).join(" ");
    if (turn.length) el["advisor-turn"].value = turn.map(cardText).join(" ");
    if (river.length) el["advisor-river"].value = river.map(cardText).join(" ");
    if (pot) el["advisor-pot"].value = pot;
    if (stack) el["advisor-stack"].value = stack;
    if (!el["advisor-line"].value.trim()) el["advisor-line"].value = text;

    const lower = text.toLowerCase();
    if (/3bet|3-bet|三bet/i.test(lower)) el["advisor-action"].value = "face-3bet";
    else if (/4bet|4-bet|四bet/i.test(lower)) el["advisor-action"].value = "face-4bet";
    else if (/全下|all.?in/i.test(lower)) el["advisor-action"].value = "face-allin";
    else if (/超池|overbet|1\.25|125%/i.test(lower)) el["advisor-action"].value = "face-overbet";
    else if (/大注|75%|3\/4/i.test(lower)) el["advisor-action"].value = "face-large";
    else if (/小注|33%|1\/3/i.test(lower)) el["advisor-action"].value = "face-small";
    else if (/无人入池|弃牌到我/i.test(lower)) el["advisor-action"].value = "unopened";
    else if (/open|开池|加注到/i.test(lower)) el["advisor-action"].value = "face-open";
    else if (/过牌到我|都过牌|无人下注/i.test(lower)) el["advisor-action"].value = "checked";

    if (/我(?:是|有)?(?:翻前)?主动|我开池|我3bet/i.test(lower)) el["advisor-initiative"].value = "hero";
    else if (/对手(?:是|有)?(?:翻前)?主动|对手开池|对手3bet/i.test(lower)) el["advisor-initiative"].value = "villain";

    clearError();
    analyze();
  }

  function readSpot() {
    const hero = parseCards(el["advisor-hero-cards"].value);
    const flop = parseCards(el["advisor-flop"].value);
    const turn = parseCards(el["advisor-turn"].value);
    const river = parseCards(el["advisor-river"].value);
    const board = [...flop, ...turn, ...river];
    if (hero.length !== 2) throw new Error("手牌需要正好两张，例如 A♠ K♥。");
    if (![0, 3].includes(flop.length)) throw new Error("翻牌需要留空或填写三张牌。");
    if (turn.length > 1 || river.length > 1) throw new Error("转牌和河牌各只能填写一张。");
    if (turn.length && flop.length !== 3) throw new Error("填写转牌前，需要先填写完整翻牌。");
    if (river.length && turn.length !== 1) throw new Error("填写河牌前，需要先填写转牌。");
    const allCards = [...hero, ...board];
    if (new Set(allCards).size !== allCards.length) throw new Error("牌局中出现了重复牌，请检查花色和点数。");
    const pot = Number(el["advisor-pot"].value);
    const stack = Number(el["advisor-stack"].value);
    if (!(pot > 0) || !(stack > 0)) throw new Error("底池和有效筹码必须大于 0BB。");
    if (el["advisor-hero-position"].value === el["advisor-villain-position"].value) throw new Error("你和主要对手不能处在同一个位置。");
    return {
      hero,
      flop,
      turn,
      river,
      board,
      pot,
      stack,
      players: Number(el["advisor-players"].value),
      action: el["advisor-action"].value,
      initiative: el["advisor-initiative"].value,
      line: el["advisor-line"].value.trim(),
      heroPosition: el["advisor-hero-position"].value,
      villainPosition: el["advisor-villain-position"].value
    };
  }

  function streetFor(board) {
    return board.length === 0 ? "PREFLOP" : board.length === 3 ? "FLOP" : board.length === 4 ? "TURN" : "RIVER";
  }

  function preflopScore(cards) {
    const values = cards.map(card => rankOrder.indexOf(card[0]) + 2).sort((a, b) => b - a);
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
    const values = new Set(cards.map(card => rankOrder.indexOf(card[0]) + 2));
    if (values.has(14)) values.add(1);
    for (let start = 1; start <= 10; start += 1) {
      let hits = 0;
      for (let rank = start; rank < start + 5; rank += 1) if (values.has(rank)) hits += 1;
      if (hits === 4) return true;
    }
    return false;
  }

  function postflopProfile(spot) {
    const cards = [...spot.hero, ...spot.board];
    const hand = window.PokerSolver.Hand.solve(cards);
    const strengthMap = {
      "High Card": 0, Pair: 1, "Two Pair": 4, "Three of a Kind": 4,
      Straight: 5, Flush: 5, "Full House": 6, "Four of a Kind": 6, "Straight Flush": 6
    };
    let strength = strengthMap[hand.name] ?? 0;
    const holeValues = spot.hero.map(card => rankOrder.indexOf(card[0]) + 2);
    const boardValues = spot.board.map(card => rankOrder.indexOf(card[0]) + 2);
    const topBoard = Math.max(...boardValues);
    const pocketPair = holeValues[0] === holeValues[1];
    if (hand.name === "Pair" && (holeValues.includes(topBoard) || (pocketPair && holeValues[0] > topBoard))) strength = 3;
    else if (hand.name === "Pair") strength = 2;
    const suits = cards.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const flushDraw = spot.board.length < 5 && Object.values(suits).some(count => count === 4);
    const openDraw = spot.board.length < 5 && straightDraw(cards);
    return { hand, strength, flushDraw, straightDraw: openDraw, draw: flushDraw || openDraw };
  }

  function textureFor(spot) {
    const rankCounts = spot.board.reduce((counts, card) => ({ ...counts, [card[0]]: (counts[card[0]] || 0) + 1 }), {});
    const suitCounts = spot.board.reduce((counts, card) => ({ ...counts, [card[1]]: (counts[card[1]] || 0) + 1 }), {});
    const values = [...new Set(spot.board.map(card => rankOrder.indexOf(card[0]) + 2))].sort((a, b) => a - b);
    const maxSuit = spot.board.length ? Math.max(...Object.values(suitCounts)) : 0;
    const paired = Object.values(rankCounts).some(count => count >= 2);
    const connected = values.length >= 3 && values.at(-1) - values[0] <= 5;
    return {
      paired,
      monotone: maxSuit >= 3,
      highDry: values.length >= 3 && values.at(-1) >= 12 && !paired && maxSuit <= 2 && !connected,
      lowConnected: values.length >= 3 && values.at(-1) <= 11 && connected,
      maxSuit
    };
  }

  function facingInfo(spot, street) {
    const preflopAmounts = { "face-open": 2.5, "face-3bet": 9, "face-4bet": 22 };
    const postflopFactors = { "face-small": .33, "face-large": .75, "face-overbet": 1.25 };
    if (street === "PREFLOP" && preflopAmounts[spot.action]) {
      const amount = preflopAmounts[spot.action];
      return { facing: true, amount, price: amount / (spot.pot + amount * 2), label: `面对 ${amount}BB` };
    }
    if (postflopFactors[spot.action]) {
      const amount = spot.pot * postflopFactors[spot.action];
      return { facing: true, amount, price: amount / (spot.pot + amount * 2), label: `面对 ${Math.round(postflopFactors[spot.action] * 100)}% 底池下注` };
    }
    if (spot.action === "face-allin") {
      const amount = Math.min(spot.stack, Math.max(spot.pot, 1));
      return { facing: true, amount, price: amount / (spot.pot + amount * 2), label: "面对全下" };
    }
    return { facing: false, amount: 0, price: 0, label: street === "PREFLOP" ? "前面无人入池" : "当前无人下注" };
  }

  function baseStrategy(spot, street, profile, facing) {
    if (street === "PREFLOP") {
      const details = preflopScore(spot.hero);
      const threshold = { UTG: 65, HJ: 59, CO: 51, BTN: 44, SB: 48, BB: 50 }[spot.heroPosition];
      if (!facing.facing) {
        if (spot.heroPosition === "SB") {
          if (details.score >= threshold + 20) return { aggressive: .82, call: .14, fold: .04 };
          if (details.score >= threshold) return { aggressive: .62, call: .2, fold: .18 };
          return { fold: .68, call: .2, aggressive: .12 };
        }
        if (spot.heroPosition === "BB") return { check: .82, aggressive: .18 };
        if (details.score >= threshold + 20) return { aggressive: .92, fold: .08 };
        if (details.score >= threshold) return { aggressive: .75, fold: .25 };
        return { fold: .86, aggressive: .14 };
      }
      const pressure = spot.action === "face-4bet" ? 18 : spot.action === "face-3bet" ? 10 : 0;
      if (details.score >= 91) return { aggressive: .67, call: .31, fold: .02 };
      if (details.score >= 58 + pressure) return { call: .64, aggressive: .18, fold: .18 };
      return { fold: .79, call: .16, aggressive: .05 };
    }
    if (facing.facing) {
      if (profile.strength >= 5) return { aggressive: .58, call: .4, fold: .02 };
      if (profile.strength >= 4) return { aggressive: .36, call: .59, fold: .05 };
      if (profile.strength >= 3) return { call: .71, aggressive: .11, fold: .18 };
      if (profile.draw && facing.price <= .36) return { call: .57, aggressive: .24, fold: .19 };
      if (profile.strength >= 2 && facing.price <= .28) return { call: .55, fold: .4, aggressive: .05 };
      return { fold: .8, call: .15, aggressive: .05 };
    }
    if (profile.strength >= 5) return { aggressive: .88, check: .12 };
    if (profile.strength >= 4) return { aggressive: .76, check: .24 };
    if (profile.strength >= 3) return { aggressive: .59, check: .41 };
    if (profile.draw) return { aggressive: .54, check: .46 };
    if (profile.strength >= 2) return { check: .7, aggressive: .3 };
    return { check: .73, aggressive: .27 };
  }

  function adjustStrategy(weights, spot, street, profile, texture, facing) {
    const adjusted = { ...weights };
    const notes = [];
    const ruleKeys = new Set(street === "PREFLOP" ? ["preflop"] : []);
    const multiway = street !== "PREFLOP" && spot.players >= 3;
    const spr = spot.stack / spot.pot;
    const inPosition = positionOrder[spot.heroPosition] > positionOrder[spot.villainPosition];
    let size = "下注约 33% 底池";
    if (street === "PREFLOP") {
      const details = preflopScore(spot.hero);
      if (facing.facing) {
        if (inPosition && adjusted.call) adjusted.call *= policy.preflopInPositionContinueFactor || 1.08;
        if (["face-3bet", "face-4bet"].includes(spot.action) && adjusted.call) adjusted.call *= policy.preflopLargeRaiseContinueFactor || .82;
        notes.push(["翻前范围", `${spot.heroPosition} 的位置、${facing.label}，以及${details.suited ? "同花" : "非同花"}属性共同决定继续方式。`]);
      } else {
        notes.push(["首入池范围", `${spot.heroPosition} 首入池先按位置宽度和后方未行动人数定范围，再用对子、同花与连通性选择组合。`]);
      }
    }
    if (multiway) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.multiwayAggressionFactor || .72;
      if (adjusted.fold) adjusted.fold *= policy.multiwayFoldFactor || 1.12;
      notes.push(["多人底池", `${spot.players} 人仍在牌局，提高价值阈值并减少边缘诈唬。`]);
      ruleKeys.add("multiway");
    }
    if (texture.paired) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.pairedBoardAggressionFactor || .86;
      notes.push(["成对牌面", "重注前先确认谁保留更多三条和葫芦，不能机械持续下注。"]);
      ruleKeys.add("boardTexture");
    }
    if (texture.monotone) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.monotoneBoardAggressionFactor || .88;
      notes.push(["同花压力", "无关键花色阻挡时减少边缘进攻，价值端也要尊重坚果分布。"]);
      ruleKeys.add("boardTexture");
    }
    if (texture.lowConnected) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.lowConnectedAggressionFactor || .82;
      if (profile.strength >= 4 || profile.draw) size = "下注约 75% 底池";
      notes.push(["低张连接面", "防守方拥有更多两对、顺子与强听牌，降低自动下注。"]);
      ruleKeys.add("boardTexture");
      ruleKeys.add("sizing");
    } else if (texture.highDry) {
      size = "下注约 33% 底池";
      notes.push(["高牌干燥面", "若选择进攻，较宽的小尺度范围通常比重注更容易保持线性。"]);
      ruleKeys.add("boardTexture");
      ruleKeys.add("sizing");
    }
    if (street !== "PREFLOP" && facing.facing && adjusted.call) {
      if (facing.price <= .2) adjusted.call *= policy.cheapCallFactor || 1.12;
      else if (facing.price >= .32) adjusted.call *= policy.expensiveCallFactor || .72;
      notes.push(["价格", `跟注所需权益约 ${Math.round(facing.price * 100)}%，再结合后续街权益实现修正。`]);
      ruleKeys.add("price");
    }
    if (street !== "PREFLOP" && texture.highDry && adjusted.aggressive) {
      if (spot.initiative === "hero") {
        adjusted.aggressive *= 1.08;
        notes.push(["范围来源", "你是翻前主动方，高牌干燥面保留较宽的小尺度进攻，但主动权不是重注许可。"]);
      } else if (spot.initiative === "villain") {
        adjusted.aggressive *= .9;
        notes.push(["范围来源", "对手是翻前主动方；其过牌可能封顶也可能保护范围，先减少无依据的自动抢池。"]);
      }
    }
    if (street !== "PREFLOP" && spr >= 6 && !inPosition && profile.strength <= 3) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.highSprOopAggressionFactor || .78;
      if (adjusted.call) adjusted.call *= policy.highSprOopCallFactor || .9;
      notes.push(["高 SPR 无位置", `SPR ${spr.toFixed(1)}，中等牌减少构建大底池并保留过牌保护。`]);
      ruleKeys.add("sprPosition");
    } else if (street !== "PREFLOP" && spr <= 2.5 && profile.strength >= 3) {
      if (adjusted.aggressive) adjusted.aggressive *= policy.lowSprStrongAggressionFactor || 1.16;
      size = "规划两街内打光，合适时全下";
      notes.push(["低 SPR", `SPR ${spr.toFixed(1)}，强一对以上更容易实现价值并进入打光线路。`]);
      ruleKeys.add("sprPosition");
      ruleKeys.add("sizing");
    }
    if (!notes.length) notes.push(["范围结构", "先确定行动频率和范围形状，再用当前组合选择具体分支。"]);
    return { weights: normalize(adjusted), notes: notes.slice(0, 4), ruleKeys: [...ruleKeys], spr, inPosition, size };
  }

  function normalize(weights) {
    const clean = Object.fromEntries(Object.entries(weights).filter(([, value]) => value > 0));
    const total = Object.values(clean).reduce((sum, value) => sum + value, 0) || 1;
    return Object.fromEntries(Object.entries(clean).map(([key, value]) => [key, value / total]));
  }

  function actionLabel(group, facing, size, street) {
    if (group === "aggressive") {
      if (street === "PREFLOP") return facing.facing ? "再加注" : "开池加注";
      return facing.facing ? "加注" : size;
    }
    return { call: "跟注", check: "过牌", fold: "弃牌" }[group] || group;
  }

  function handLabel(spot, street, profile) {
    if (street === "PREFLOP") {
      const details = preflopScore(spot.hero);
      if (details.pair) return "口袋对子";
      return [details.suited && "同花", details.gap === 1 && "连张", details.high >= 13 && "高张"].filter(Boolean).join(" · ") || "非同花非连接牌";
    }
    const names = {
      "High Card": "高牌", Pair: "一对", "Two Pair": "两对", "Three of a Kind": "三条",
      Straight: "顺子", Flush: "同花", "Full House": "葫芦", "Four of a Kind": "四条", "Straight Flush": "同花顺"
    };
    const draws = [profile.flushDraw && "同花听牌", profile.straightDraw && "顺子听牌"].filter(Boolean);
    return `${names[profile.hand.name] || profile.hand.name}${draws.length ? ` + ${draws.join("、")}` : ""}`;
  }

  function nextStreetPlan(street, profile, texture, topGroup) {
    if (street === "RIVER") return "最后一街：下注要明确更差牌是否跟注，诈唬要明确更好牌是否弃牌。";
    if (street === "PREFLOP") return topGroup === "aggressive"
      ? "翻牌重新比较范围与坚果优势；高牌干燥面偏小注，低张连接面降低自动持续下注。"
      : "进入翻牌后按位置和权益实现防守，不沿用翻前绝对牌力直接打大底池。";
    if (profile.draw) return "下一街听牌完成时转入价值；未完成时只在范围优势、阻挡和弃牌权益仍成立时继续开火。";
    if (profile.strength >= 4) return "下一街优先规划剩余 SPR 和价值尺度；危险牌出现时重新检查坚果上限。";
    if (texture.lowConnected || texture.monotone) return "下一街变化较多：面对继续压力时收紧边缘牌，不机械执行第二枪。";
    return "下一街重新判断新牌改变了谁的权益和坚果优势，再决定延续下注还是控池。";
  }

  function sourceMatches(ruleKeys, street) {
    const ids = ruleKeys.flatMap(key => kb?.rules?.ruleDocuments?.[key] || []);
    if (street === "PREFLOP") ids.unshift("topics-翻前决策框架-md");
    else ids.unshift("topics-翻后决策框架-md");
    return [...new Set(ids)].map(id => kb?.get?.(id)).filter(Boolean).slice(0, 4);
  }

  function analyze() {
    try {
      const spot = readSpot();
      const street = streetFor(spot.board);
      const preflopActions = new Set(["unopened", "face-open", "face-3bet", "face-4bet", "face-allin"]);
      const postflopActions = new Set(["checked", "face-small", "face-large", "face-overbet", "face-allin"]);
      if (street === "PREFLOP" && !preflopActions.has(spot.action)) throw new Error("当前是翻前，请在“轮到你时”选择翻前节点。");
      if (street !== "PREFLOP" && !postflopActions.has(spot.action)) throw new Error("已经填写公共牌，请在“轮到你时”选择翻后节点。");
      const profile = street === "PREFLOP" ? { strength: 0, draw: false } : postflopProfile(spot);
      const texture = textureFor(spot);
      const facing = facingInfo(spot, street);
      const adjusted = adjustStrategy(baseStrategy(spot, street, profile, facing), spot, street, profile, texture, facing);
      const distribution = Object.entries(adjusted.weights).sort((a, b) => b[1] - a[1]);
      const topGroup = distribution[0][0];
      const topAction = actionLabel(topGroup, facing, adjusted.size, street);
      const label = handLabel(spot, street, profile);
      const sources = sourceMatches(adjusted.ruleKeys, street);
      render({ spot, street, profile, texture, facing, adjusted, distribution, topGroup, topAction, label, sources });
      clearError();
    } catch (error) {
      showError(error.message);
    }
  }

  function render(result) {
    const { spot, street, facing, adjusted, distribution, topGroup, topAction, label, sources, profile, texture } = result;
    el["advisor-empty"].hidden = true;
    el["advisor-result"].hidden = false;
    el["advisor-stage-badge"].textContent = streetLabels[street];
    el["advisor-result-stage"].textContent = `${streetLabels[street]} · ${spot.heroPosition} 对 ${spot.villainPosition}`;
    el["advisor-result-title"].textContent = `${cardText(spot.hero[0])} ${cardText(spot.hero[1])} · ${label}`;
    const depthText = street === "PREFLOP" ? `有效筹码 ${spot.stack}BB` : `后手 ${spot.stack}BB · SPR ${adjusted.spr.toFixed(1)}`;
    el["advisor-result-meta"].textContent = `${spot.players} 人池 · 底池 ${spot.pot}BB · ${depthText} · ${facing.label}`;
    renderCards(spot);
    el["advisor-takeaway-title"].textContent = `主线：${topAction}`;
    const topPercent = Math.round(distribution[0][1] * 100);
    el["advisor-takeaway-copy"].textContent = `${adjusted.notes[0][1]} 当前近似策略给该行动约 ${topPercent}% 权重；先执行主线，只有满足对应范围条件时才使用低频分支。`;
    renderMix(distribution, facing, adjusted.size, street);
    renderStreetPath(street, nextStreetPlan(street, profile, texture, topGroup));
    renderReasons(adjusted.notes, spot, adjusted, street);
    renderSources(sources);
  }

  function renderCards(spot) {
    el["advisor-cards"].replaceChildren();
    [...spot.hero, ...spot.board].forEach((card, index) => {
      const node = document.createElement("span");
      node.className = `advisor-card ${/[hd]/.test(card[1]) ? "red" : ""}${index === 2 ? " board-start" : ""}`;
      node.textContent = cardText(card);
      node.setAttribute("aria-label", cardText(card));
      el["advisor-cards"].append(node);
    });
  }

  function renderMix(distribution, facing, size, street) {
    el["advisor-mix"].replaceChildren();
    distribution.slice(0, 3).forEach(([group, frequency]) => {
      const row = document.createElement("div");
      row.className = "advisor-mix-row";
      const name = document.createElement("span");
      name.textContent = actionLabel(group, facing, size, street);
      const track = document.createElement("div");
      track.className = "advisor-mix-track";
      const bar = document.createElement("i");
      bar.style.setProperty("--mix-width", `${Math.round(frequency * 100)}%`);
      track.append(bar);
      const value = document.createElement("strong");
      value.textContent = `${Math.round(frequency * 100)}%`;
      row.append(name, track, value);
      el["advisor-mix"].append(row);
    });
  }

  function renderStreetPath(currentStreet, plan) {
    const streets = ["PREFLOP", "FLOP", "TURN", "RIVER"];
    const currentIndex = streets.indexOf(currentStreet);
    el["advisor-street-path"].replaceChildren();
    streets.forEach((street, index) => {
      const step = document.createElement("div");
      step.className = `advisor-street-step${index === currentIndex ? " current" : index < currentIndex ? " past" : ""}`;
      const status = document.createElement("small");
      status.textContent = index === currentIndex ? "CURRENT" : index < currentIndex ? "DONE" : "NEXT";
      const title = document.createElement("strong");
      title.textContent = streetLabels[street];
      const copy = document.createElement("p");
      copy.textContent = index === currentIndex ? "执行当前主线" : index === currentIndex + 1 ? plan : index < currentIndex ? "范围已被前序行动筛选" : "根据新牌重新计算";
      step.append(status, title, copy);
      el["advisor-street-path"].append(step);
    });
  }

  function renderReasons(notes, spot, adjusted, street) {
    const details = [
      ...notes,
      ["位置与筹码", street === "PREFLOP"
        ? `${spot.heroPosition} 对 ${spot.villainPosition}，有效筹码 ${spot.stack}BB；筹深会改变跟注、非全压与全压分支。`
        : `${adjusted.inPosition ? "有位置" : "无位置"}，有效后手 ${spot.stack}BB，当前 SPR ${adjusted.spr.toFixed(1)}。`],
      ["前序行动", spot.line || "未补充额外行动线，结论按当前字段给出条件化基线。"]
    ].slice(0, 4);
    el["advisor-reasons"].replaceChildren();
    details.forEach(([title, copy]) => {
      const item = document.createElement("div");
      item.className = "advisor-reason";
      const strong = document.createElement("strong");
      strong.textContent = title;
      const paragraph = document.createElement("p");
      paragraph.textContent = copy;
      item.append(strong, paragraph);
      el["advisor-reasons"].append(item);
    });
  }

  function renderSources(sources) {
    el["advisor-sources"].replaceChildren();
    sources.forEach(doc => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "advisor-source-button";
      button.textContent = doc.title;
      button.addEventListener("click", () => window.PokerKnowledgeUI?.openDocument(doc.id));
      el["advisor-sources"].append(button);
    });
  }

  function showError(message) {
    el["advisor-error"].textContent = message;
    el["advisor-error"].hidden = false;
  }

  function clearError() {
    el["advisor-error"].hidden = true;
    el["advisor-error"].textContent = "";
  }

  function reset() {
    el["advisor-question"].value = "";
    el["advisor-hero-position"].value = "BTN";
    el["advisor-villain-position"].value = "BB";
    el["advisor-hero-cards"].value = "";
    el["advisor-flop"].value = "";
    el["advisor-turn"].value = "";
    el["advisor-river"].value = "";
    el["advisor-pot"].value = "6";
    el["advisor-stack"].value = "97";
    el["advisor-players"].value = "2";
    el["advisor-action"].value = "checked";
    el["advisor-initiative"].value = "hero";
    el["advisor-line"].value = "";
    el["advisor-result"].hidden = true;
    el["advisor-empty"].hidden = false;
    el["advisor-stage-badge"].textContent = "待输入";
    clearError();
  }

  function enter() {
    el["advisor-hero-cards"].focus();
  }

  el["advisor-parse"].addEventListener("click", parseQuestion);
  el["advisor-run"].addEventListener("click", analyze);
  el["advisor-question"].addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") parseQuestion();
  });

  window.ScenarioAdvisor = { enter, reset, analyze, parseCards };
})();
