(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  Content sources
   * ------------------------------------------------------------------ */

  const SOURCES = {
    web: { key: "web", label: "Web & Tendances", dir: "data", hashPrefix: "" },
    newsletters: { key: "newsletters", label: "Newsletters", dir: "data/newsletters", hashPrefix: "newsletters" },
  };

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */

  const state = {
    bySource: {
      web: { dates: [], cache: new Map(), currentDate: null },
      newsletters: { dates: [], cache: new Map(), currentDate: null },
    },
    activeSource: "web",     // "web" | "newsletters"
    searchQuery: "",
    currentView: "home",     // "home" | "briefing" | "deals"
    deals: null,                // null = not fetched yet, [] = fetched (possibly empty)
    dealsEmptyReason: null,     // "missing" | "invalid" | "empty" | "error" | null
    dealsLoadState: "idle",     // "idle" | "loading" | "ready"
    dealsSort: { key: "date", dir: "desc" },
    dealsFilters: { secteur: "", pays: "", type: "", montantMin: "", montantMax: "" },
  };

  function activeSrc() {
    return state.bySource[state.activeSource];
  }

  const els = {
    sidebarBody: document.getElementById("sidebarBody"),
    content: document.getElementById("content"),
    currentDatePill: document.getElementById("currentDatePill"),
    searchInput: document.getElementById("searchInput"),
    searchClear: document.getElementById("searchClear"),
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    navArchives: document.getElementById("navArchives"),
    searchToggle: document.getElementById("searchToggle"),
    themeToggle: document.getElementById("themeToggle"),
    brandHome: document.getElementById("brandHome"),
    homeView: document.getElementById("homeView"),
    homeInner: document.getElementById("homeInner"),
    subnav: document.getElementById("subnav"),
    briefingLayout: document.getElementById("briefingLayout"),
    tabSourceWeb: document.getElementById("tabSourceWeb"),
    tabSourceNewsletters: document.getElementById("tabSourceNewsletters"),
    tabDeals: document.getElementById("tabDeals"),
    dealsView: document.getElementById("dealsView"),
    statTotal30d: document.getElementById("statTotal30d"),
    statCount30d: document.getElementById("statCount30d"),
    statTopSectors: document.getElementById("statTopSectors"),
    dealsToolbar: document.getElementById("dealsToolbar"),
    filterSecteur: document.getElementById("filterSecteur"),
    filterPays: document.getElementById("filterPays"),
    filterType: document.getElementById("filterType"),
    filterMontantMin: document.getElementById("filterMontantMin"),
    filterMontantMax: document.getElementById("filterMontantMax"),
    filterReset: document.getElementById("filterReset"),
    dealsTableWrap: document.getElementById("dealsTableWrap"),
  };

  /* ------------------------------------------------------------------ *
   *  Theme
   * ------------------------------------------------------------------ */

  function initTheme() {
    const stored = localStorage.getItem("veille-theme");
    const theme = stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("veille-theme", next);
  }

  /* ------------------------------------------------------------------ *
   *  Date helpers
   * ------------------------------------------------------------------ */

  function parseDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatLong(dateStr) {
    const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const s = fmt.format(parseDate(dateStr));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatMonthGroup(dateStr) {
    const fmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
    const s = fmt.format(parseDate(dateStr));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function dayNumber(dateStr) {
    return String(parseInt(dateStr.split("-")[2], 10));
  }

  function weekdayShort(dateStr) {
    const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
    return fmt.format(parseDate(dateStr)).replace(".", "");
  }

  function daysAgoLabel(dateStr, refDateStr) {
    const diff = Math.round((parseDate(refDateStr) - parseDate(dateStr)) / 86400000);
    if (diff <= 0) return "Aujourd'hui";
    if (diff === 1) return "Hier";
    return `Il y a ${diff} jours`;
  }

  function sectionPlainText(bodyMarkdown) {
    const div = document.createElement("div");
    div.innerHTML = window.marked.parse(bodyMarkdown || "");
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function truncateText(text, maxLen) {
    if (text.length <= maxLen) return text;
    const cut = text.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + "…";
  }

  function parseDealDate(value) {
    if (typeof value !== "string") return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDealDateShort(value) {
    const d = parseDealDate(value);
    if (!d) return typeof value === "string" && value.trim() ? value.trim() : "—";
    const fmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    return fmt.format(d).replace(".", "");
  }

  function formatMEUR(n) {
    if (typeof n !== "number" || isNaN(n)) return "—";
    return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  }

  /* ------------------------------------------------------------------ *
   *  Data loading
   * ------------------------------------------------------------------ */

  async function loadIndex(sourceKey) {
    try {
      const res = await fetch(`${SOURCES[sourceKey].dir}/index.json`, { cache: "no-store" });
      if (!res.ok) return [];
      const json = await res.json();
      const dates = Array.isArray(json.dates) ? json.dates.slice() : [];
      dates.sort().reverse();
      return dates;
    } catch (err) {
      return [];
    }
  }

  async function loadMarkdown(sourceKey, dateStr) {
    const src = state.bySource[sourceKey];
    if (src.cache.has(dateStr)) return src.cache.get(dateStr);
    const res = await fetch(`${SOURCES[sourceKey].dir}/${dateStr}.md`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Briefing du ${dateStr} introuvable`);
    const text = await res.text();
    src.cache.set(dateStr, text);
    return text;
  }

  /* ------------------------------------------------------------------ *
   *  Markdown -> structured sections
   * ------------------------------------------------------------------ */

  const EMOJI_RE = /^(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:[️‍]\p{Extended_Pictographic}?)*)\s*/u;

  function extractEmoji(text) {
    const m = EMOJI_RE.exec(text.trim());
    if (m && m[1]) {
      return { emoji: m[1].trim(), rest: text.trim().slice(m[0].length).trim() };
    }
    return { emoji: "", rest: text.trim() };
  }

  function splitMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const preambleLines = [];
    const sections = [];
    let current = null;

    for (const line of lines) {
      if (/^-{3,}\s*$/.test(line.trim())) continue; // drop horizontal rules
      const h2 = /^##(?!#)\s+(.*)$/.exec(line);
      if (h2) {
        if (current) sections.push(current);
        current = { heading: h2[1].trim(), lines: [] };
      } else if (current) {
        current.lines.push(line);
      } else {
        preambleLines.push(line);
      }
    }
    if (current) sections.push(current);

    return {
      preamble: preambleLines.join("\n").trim(),
      sections: sections.map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() })),
    };
  }

  function parsePreamble(preamble) {
    // Expect an H1 title, optionally followed by an H3 subtitle.
    const h1 = /^#(?!#)\s+(.*)$/m.exec(preamble);
    const h3 = /^###(?!#)\s+(.*)$/m.exec(preamble);
    const title = h1 ? h1[1].trim() : "Briefing";
    const subtitle = h3 ? h3[1].trim() : "";
    return { title, subtitle };
  }

  const CATEGORY_RULES = [
    { key: "france", test: /france/i, label: "France" },
    { key: "vc", test: /venture capital|financement/i, label: "VC" },
    { key: "ia", test: /intelligence artificielle/i, label: "IA" },
    { key: "tech", test: /tech europe|monde/i, label: "Tech" },
    { key: "macro", test: /macro|économie/i, label: "Macro" },
  ];

  function classifySection(headingText) {
    if (/avertissement/i.test(headingText)) return { kind: "warning" };
    if (/résumé exécutif/i.test(headingText)) return { kind: "summary" };
    if (/contexte de fond/i.test(headingText)) return { kind: "context" };
    for (const rule of CATEGORY_RULES) {
      if (rule.test.test(headingText)) return { kind: "card", category: rule.key, label: rule.label };
    }
    return { kind: "card" };
  }

  /* ------------------------------------------------------------------ *
   *  Shared markdown -> briefing model (used by detail render + home teasers)
   * ------------------------------------------------------------------ */

  function parseBriefing(markdown) {
    const { preamble, sections } = splitMarkdown(markdown);
    const { title, subtitle } = parsePreamble(preamble);
    const { emoji: titleEmoji, rest: titleText } = extractEmoji(title);

    const parsedSections = sections.map((s) => {
      const info = classifySection(s.heading);
      const { emoji, rest: headingText } = extractEmoji(s.heading);
      return { ...info, emoji, headingText, bodyMarkdown: s.body };
    });

    return { title: titleText || title, titleEmoji, subtitle, sections: parsedSections };
  }

  const TEASER_KINDS = new Set(["card", "context"]);

  function getTeaserSections(parsed) {
    return parsed.sections
      .map((s, index) => ({ ...s, index }))
      .filter((s) => TEASER_KINDS.has(s.kind));
  }

  function getSummarySection(parsed) {
    return parsed.sections.find((s) => s.kind === "summary") || null;
  }

  /* ------------------------------------------------------------------ *
   *  Rendering
   * ------------------------------------------------------------------ */

  function renderBriefing(sourceKey, dateStr, markdown) {
    const parsed = parseBriefing(markdown);
    const { title, titleEmoji, subtitle, sections } = parsed;

    const wrap = document.createElement("div");
    wrap.className = "content-inner";

    const kicker = document.createElement("p");
    kicker.className = "doc-kicker";
    kicker.innerHTML = `<span class="dot"></span> ${SOURCES[sourceKey].label} · ${formatLong(dateStr)}`;
    wrap.appendChild(kicker);

    const h1 = document.createElement("h1");
    h1.className = "doc-title";
    h1.innerHTML = (titleEmoji ? `<span class="title-emoji">${titleEmoji}</span>` : "") + escapeHtml(title);
    wrap.appendChild(h1);

    if (subtitle) {
      const sub = document.createElement("p");
      sub.className = "doc-subtitle";
      sub.textContent = subtitle;
      wrap.appendChild(sub);
    }

    wrap.appendChild(document.createElement("hr")).className = "doc-divider";

    const sectionsWrap = document.createElement("div");
    sectionsWrap.className = "sections";

    sections.forEach((section, index) => {
      const { kind, emoji, headingText, label, category } = section;
      const bodyHtml = window.marked.parse(section.bodyMarkdown || "");

      if (kind === "warning") {
        const banner = document.createElement("div");
        banner.className = "banner";
        banner.innerHTML = `<span class="banner-icon">${emoji || "⚠️"}</span><div class="banner-body">${bodyHtml}</div>`;
        sectionsWrap.appendChild(banner);
        return;
      }

      if (kind === "summary") {
        const hero = document.createElement("div");
        hero.className = "hero";
        hero.innerHTML = `<h2 class="hero-title"><span class="hero-icon">${emoji || "🎯"}</span>${escapeHtml(headingText)}</h2><div class="hero-body">${bodyHtml}</div>`;
        sectionsWrap.appendChild(hero);
        return;
      }

      const card = document.createElement("article");
      card.className = "card" + (kind === "context" ? " card--muted" : "");
      card.id = `section-${index}`;
      if (category) card.dataset.cat = category;

      const header = document.createElement("div");
      header.className = "card-header";
      header.innerHTML = `
        <span class="card-icon" aria-hidden="true">${emoji || "📄"}</span>
        <h2 class="card-title">${escapeHtml(headingText)}</h2>
        ${label ? `<span class="badge"><span class="dot"></span>${label}</span>` : (kind === "context" ? `<span class="badge">Contexte</span>` : "")}
      `;
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "card-body";
      body.innerHTML = bodyHtml;
      card.appendChild(body);

      sectionsWrap.appendChild(card);
    });

    wrap.appendChild(sectionsWrap);

    const footer = document.createElement("div");
    footer.className = "doc-footer";
    footer.innerHTML = `<span>Édition du ${formatLong(dateStr)}</span><span>Généré automatiquement · relecture recommandée</span>`;
    wrap.appendChild(footer);

    els.content.innerHTML = "";
    els.content.appendChild(wrap);
    els.content.scrollTop = 0;
    els.content.focus({ preventScroll: true });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderError(message) {
    els.content.innerHTML = `<p class="content-error">${escapeHtml(message)}</p>`;
  }

  /* ------------------------------------------------------------------ *
   *  Home view (front page): hero + secondary column + card grid
   *  Scoped to the active source — each tab has its own independent front page.
   * ------------------------------------------------------------------ */

  const HOME_TARGET_SECONDARY = 3;
  const HOME_TARGET_GRID = 5;

  function teaserKicker(section) {
    if (section.label) return section.label;
    if (section.kind === "context") return "Contexte";
    return "Brief";
  }

  async function buildEditionItem(dateStr, latestDateStr) {
    try {
      const md = await loadMarkdown(state.activeSource, dateStr);
      const parsed = parseBriefing(md);
      const summary = getSummarySection(parsed);
      const teasers = getTeaserSections(parsed);
      const chapoSource = summary ? summary.bodyMarkdown : (teasers[0] ? teasers[0].bodyMarkdown : "");
      return {
        kind: "edition",
        date: dateStr,
        emoji: parsed.titleEmoji,
        title: parsed.title,
        summary: truncateText(sectionPlainText(chapoSource), 130),
        meta: `${daysAgoLabel(dateStr, latestDateStr)} · Archive`,
      };
    } catch (err) {
      return null;
    }
  }

  async function renderHome() {
    const src = activeSrc();

    if (!src.dates.length) {
      els.homeInner.innerHTML = `<p class="home-error">Aucun briefing disponible pour le moment.</p>`;
      return;
    }

    const latest = src.dates[0];
    src.currentDate = latest;
    els.currentDatePill.textContent = formatLong(latest);

    let md;
    try {
      md = await loadMarkdown(state.activeSource, latest);
    } catch (err) {
      els.homeInner.innerHTML = `<p class="home-error">Impossible de charger la une. ${escapeHtml(err.message)}</p>`;
      return;
    }

    const parsed = parseBriefing(md);
    const summary = getSummarySection(parsed);
    const teasers = getTeaserSections(parsed);

    const secondarySections = teasers.slice(0, HOME_TARGET_SECONDARY);
    const remainingSections = teasers.slice(HOME_TARGET_SECONDARY);

    const otherDates = src.dates.filter((d) => d !== latest);
    const editionSlots = Math.max(0, HOME_TARGET_GRID - remainingSections.length);
    const editionDates = otherDates.slice(0, editionSlots);
    const editionItems = (await Promise.all(editionDates.map((d) => buildEditionItem(d, latest)))).filter(Boolean);

    const gridItems = [...remainingSections, ...editionItems];

    const chapoSource = summary ? summary.bodyMarkdown : (teasers[0] ? teasers[0].bodyMarkdown : "");
    const heroChapo = truncateText(sectionPlainText(chapoSource), 260);

    const wrap = document.createElement("div");

    const heroRow = document.createElement("div");
    heroRow.className = "home-hero-row";

    const heroMain = document.createElement("div");
    heroMain.innerHTML = `
      <p class="hero-kicker"><span class="dot"></span> ${SOURCES[state.activeSource].label} · ${formatLong(latest)}</p>
      <h1 class="hero-headline" tabindex="0" role="link">${parsed.titleEmoji ? escapeHtml(parsed.titleEmoji) + " " : ""}${escapeHtml(parsed.title)}</h1>
      <p class="hero-chapo">${escapeHtml(heroChapo)}</p>
      <div class="hero-visual" tabindex="0" role="link" aria-label="Ouvrir le briefing du jour">${escapeHtml(parsed.titleEmoji || "📊")}</div>
    `;
    const openLatest = () => goToSection(latest, null);
    heroMain.querySelector(".hero-headline").addEventListener("click", openLatest);
    heroMain.querySelector(".hero-headline").addEventListener("keydown", (e) => { if (e.key === "Enter") openLatest(); });
    heroMain.querySelector(".hero-visual").addEventListener("click", openLatest);
    heroMain.querySelector(".hero-visual").addEventListener("keydown", (e) => { if (e.key === "Enter") openLatest(); });
    heroRow.appendChild(heroMain);

    const secondaryList = document.createElement("div");
    secondaryList.className = "secondary-list";
    if (secondarySections.length === 0) {
      secondaryList.innerHTML = `<p class="item-summary">D'autres rubriques arriveront prochainement.</p>`;
    }
    for (const section of secondarySections) {
      const item = document.createElement("article");
      item.className = "secondary-item";
      if (section.category) item.dataset.cat = section.category;
      item.tabIndex = 0;
      item.setAttribute("role", "link");
      item.innerHTML = `
        <p class="item-kicker"><span class="dot"></span>${escapeHtml(teaserKicker(section))}</p>
        <h2 class="item-title">${section.emoji ? escapeHtml(section.emoji) + " " : ""}${escapeHtml(section.headingText)}</h2>
        <p class="item-summary">${escapeHtml(truncateText(sectionPlainText(section.bodyMarkdown), 110))}</p>
        <p class="item-meta">Aujourd'hui<span class="meta-sep">│</span>${escapeHtml(teaserKicker(section))}</p>
      `;
      const go = () => goToSection(latest, section.index);
      item.addEventListener("click", go);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      secondaryList.appendChild(item);
    }
    heroRow.appendChild(secondaryList);
    wrap.appendChild(heroRow);

    if (gridItems.length) {
      const grid = document.createElement("div");
      grid.className = "home-grid";
      for (const g of gridItems) {
        const cell = document.createElement("article");
        cell.className = "grid-item";
        cell.tabIndex = 0;
        cell.setAttribute("role", "link");
        if (g.kind === "edition") {
          cell.innerHTML = `
            <div class="grid-item-icon">${escapeHtml(g.emoji || "📅")}</div>
            <h2 class="item-title">${escapeHtml(g.title)}</h2>
            <p class="item-summary">${escapeHtml(g.summary)}</p>
            <p class="item-meta">${escapeHtml(g.meta)}</p>
          `;
          const go = () => goToSection(g.date, null);
          cell.addEventListener("click", go);
          cell.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        } else {
          if (g.category) cell.dataset.cat = g.category;
          cell.innerHTML = `
            <div class="grid-item-icon">${escapeHtml(g.emoji || "📄")}</div>
            <h2 class="item-title">${escapeHtml(g.headingText)}</h2>
            <p class="item-summary">${escapeHtml(truncateText(sectionPlainText(g.bodyMarkdown), 110))}</p>
            <p class="item-meta">Aujourd'hui<span class="meta-sep">│</span>${escapeHtml(teaserKicker(g))}</p>
          `;
          const go = () => goToSection(latest, g.index);
          cell.addEventListener("click", go);
          cell.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        }
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
    }

    els.homeInner.innerHTML = "";
    els.homeInner.appendChild(wrap);
  }

  async function goToSection(dateStr, sectionIndex) {
    const src = activeSrc();
    if (state.currentView !== "briefing" || src.currentDate !== dateStr) {
      setView("briefing");
      await loadBriefing(dateStr);
    }
    if (sectionIndex === null || sectionIndex === undefined) return;
    const target = document.getElementById(`section-${sectionIndex}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("flash-target");
    setTimeout(() => target.classList.remove("flash-target"), 1600);
  }

  async function goToCategory(category) {
    const src = activeSrc();
    const latest = src.dates[0];
    if (!latest) return;
    if (state.currentView !== "briefing" || src.currentDate !== latest) {
      setView("briefing");
      await loadBriefing(latest);
    }
    const target = document.querySelector(`.card[data-cat="${category}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("flash-target");
    setTimeout(() => target.classList.remove("flash-target"), 1600);
  }

  /* ------------------------------------------------------------------ *
   *  Loading a briefing (navigation) — always targets the active source
   * ------------------------------------------------------------------ */

  async function loadBriefing(dateStr, { pushHash = true } = {}) {
    const src = activeSrc();
    if (!src.dates.includes(dateStr)) return;
    if (state.currentView !== "briefing") setView("briefing", { pushHash: false });
    src.currentDate = dateStr;
    const cfg = SOURCES[state.activeSource];
    els.currentDatePill.textContent = formatLong(dateStr);
    document.title = `${formatLong(dateStr)} — ${cfg.label} — Veille Innovation`;
    if (pushHash) history.replaceState(null, "", cfg.hashPrefix ? `#${cfg.hashPrefix}/${dateStr}` : `#${dateStr}`);
    setActiveSidebarItem(dateStr);
    closeSidebar();

    els.content.innerHTML = `<p class="content-loading">Chargement du briefing…</p>`;
    try {
      const md = await loadMarkdown(state.activeSource, dateStr);
      renderBriefing(state.activeSource, dateStr, md);
    } catch (err) {
      renderError("Impossible de charger ce briefing. " + err.message);
    }
  }

  function setActiveSidebarItem(dateStr) {
    document.querySelectorAll(".archive-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.date === dateStr);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Sidebar: archive list grouped by month, scoped to the active source
   * ------------------------------------------------------------------ */

  function buildSidebarArchives() {
    const dates = activeSrc().dates;
    const groups = new Map(); // "YYYY-MM" -> [dates]
    for (const d of dates) {
      const key = d.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }

    const frag = document.createDocumentFragment();
    let first = true;

    for (const [key, groupDates] of groups) {
      const details = document.createElement("details");
      details.className = "archive-group";
      details.open = first;

      const summary = document.createElement("summary");
      summary.innerHTML = `<svg class="chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg><span>${formatMonthGroup(groupDates[0])}</span><span class="count">${groupDates.length}</span>`;
      details.appendChild(summary);

      const ul = document.createElement("ul");
      ul.className = "archive-list";
      for (const d of groupDates) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.className = "archive-item";
        btn.type = "button";
        btn.dataset.date = d;
        btn.innerHTML = `<span class="day-num">${dayNumber(d)}</span><span class="day-label">${weekdayShort(d)}</span>`;
        btn.addEventListener("click", () => loadBriefing(d));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      details.appendChild(ul);
      frag.appendChild(details);
      first = false;
    }

    els.sidebarBody.innerHTML = "";
    if (dates.length === 0) {
      els.sidebarBody.innerHTML = `<p class="sidebar-empty">Aucune archive disponible.</p>`;
      return;
    }
    els.sidebarBody.appendChild(frag);
  }

  /* ------------------------------------------------------------------ *
   *  Full-text search — global across both sources
   * ------------------------------------------------------------------ */

  function normalize(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^#+\s*/gm, "")
      .replace(/[>*_`~-]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  let searchDebounce = null;

  function onSearchInput() {
    clearTimeout(searchDebounce);
    const q = els.searchInput.value.trim();
    els.searchClear.hidden = q.length === 0;
    searchDebounce = setTimeout(() => runSearch(q), 160);
  }

  async function runSearch(query) {
    state.searchQuery = query;
    if (!query || query.length < 2) {
      buildSidebarArchives();
      return;
    }

    els.sidebarBody.innerHTML = `<p class="search-status">Recherche en cours…</p>`;

    const sourceKeys = Object.keys(SOURCES);
    await Promise.all(
      sourceKeys.flatMap((key) =>
        state.bySource[key].dates.map((d) => loadMarkdown(key, d).catch(() => ""))
      )
    );

    const needle = normalize(query);
    const results = [];
    for (const key of sourceKeys) {
      const src = state.bySource[key];
      for (const d of src.dates) {
        const raw = src.cache.get(d) || "";
        const plain = stripMarkdown(raw);
        const idx = normalize(plain).indexOf(needle);
        if (idx !== -1) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(plain.length, idx + needle.length + 70);
          let snippet = plain.slice(start, end).trim();
          if (start > 0) snippet = "…" + snippet;
          if (end < plain.length) snippet += "…";
          results.push({ source: key, date: d, snippet });
        }
      }
    }
    results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    renderSearchResults(query, results);
  }

  function highlightTerm(text, query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "ig");
    return escapeHtml(text).replace(re, (m) => `<mark>${m}</mark>`);
  }

  function renderSearchResults(query, results) {
    els.sidebarBody.innerHTML = "";
    const status = document.createElement("p");
    status.className = "search-status";
    status.textContent = results.length
      ? `${results.length} résultat${results.length > 1 ? "s" : ""} pour « ${query} »`
      : `Aucun résultat pour « ${query} »`;
    els.sidebarBody.appendChild(status);

    if (!results.length) return;

    const ul = document.createElement("ul");
    ul.className = "search-results-list";
    for (const r of results) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "search-result";
      btn.type = "button";
      btn.innerHTML = `<span class="sr-date">${formatLong(r.date)} · ${SOURCES[r.source].label}</span><span class="sr-snippet">${highlightTerm(r.snippet, query)}</span>`;
      btn.addEventListener("click", async () => {
        switchSource(r.source);
        setView("briefing", { pushHash: false });
        await loadBriefing(r.date);
        flashHighlight(query);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
    els.sidebarBody.appendChild(ul);
  }

  function flashHighlight(query) {
    const needle = normalize(query);
    if (!needle) return;
    const walker = document.createTreeWalker(els.content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const norm = normalize(node.nodeValue);
      const idx = norm.indexOf(needle);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + query.length);
        const mark = document.createElement("mark");
        mark.className = "search-hit";
        try {
          range.surroundContents(mark);
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => {
            mark.style.transition = "background-color 1.2s ease";
            mark.style.background = "transparent";
          }, 900);
        } catch (e) {
          /* range spans multiple elements — skip */
        }
        break;
      }
    }
  }

  function clearSearch() {
    els.searchInput.value = "";
    els.searchClear.hidden = true;
    state.searchQuery = "";
    buildSidebarArchives();
    setActiveSidebarItem(activeSrc().currentDate);
  }

  /* ------------------------------------------------------------------ *
   *  Deals
   * ------------------------------------------------------------------ */

  const DEALS_COLUMNS = [
    { key: "date", label: "Date", sortable: true, cls: "deals-td-date" },
    { key: "societe", label: "Société", sortable: true, cls: "deals-td-company" },
    { key: "type", label: "Type", sortable: true },
    { key: "secteur", label: "Secteur", sortable: true },
    { key: "montant_meur", label: "Montant (M€)", sortable: true, cls: "deals-td-num", numeric: true },
    { key: "serie", label: "Série", sortable: true },
    { key: "investisseurs", label: "Investisseurs", sortable: false, cls: "deals-td-investors" },
    { key: "pays", label: "Pays", sortable: true },
  ];

  const DEALS_EMPTY_MESSAGES = {
    missing: "Le fichier des opérations (data/deals.json) n'est pas encore disponible.",
    error: "Le fichier des opérations (data/deals.json) n'est pas encore disponible.",
    invalid: "Le fichier des opérations est dans un format inattendu.",
    empty: "Aucune opération enregistrée pour le moment.",
  };

  async function fetchDeals() {
    try {
      const res = await fetch("data/deals.json", { cache: "no-store" });
      if (!res.ok) return { deals: [], reason: "missing" };
      const json = await res.json();
      if (!Array.isArray(json)) {
        console.warn("data/deals.json: contenu inattendu (tableau attendu).");
        return { deals: [], reason: "invalid" };
      }
      return { deals: json, reason: json.length === 0 ? "empty" : null };
    } catch (err) {
      console.warn("Impossible de charger data/deals.json", err);
      return { deals: [], reason: "error" };
    }
  }

  function dealAmount(d) {
    const n = typeof d.montant_meur === "number" ? d.montant_meur : parseFloat(d.montant_meur);
    return isNaN(n) ? 0 : n;
  }

  function computeDealStats(deals) {
    const now = new Date();
    const within30 = deals.filter((d) => {
      const dt = parseDealDate(d.date);
      if (!dt) return false;
      const diffDays = (now - dt) / 86400000;
      return diffDays >= 0 && diffDays < 30;
    });

    const total30d = within30.reduce((sum, d) => sum + dealAmount(d), 0);

    const bySector = new Map();
    for (const d of within30) {
      const name = (d.secteur || "").toString().trim() || "Non renseigné";
      bySector.set(name, (bySector.get(name) || 0) + dealAmount(d));
    }
    const topSectors = Array.from(bySector.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, amount]) => ({ name, amount }));

    return { total30d, count30d: within30.length, topSectors };
  }

  function renderDealsStats(stats, hasAnyData) {
    els.statTotal30d.textContent = hasAnyData ? formatMEUR(stats.total30d) : "—";
    els.statCount30d.textContent = hasAnyData ? stats.count30d.toLocaleString("fr-FR") : "—";

    els.statTopSectors.innerHTML = "";
    if (!hasAnyData || stats.topSectors.length === 0) {
      const li = document.createElement("li");
      li.className = "stat-rank-empty";
      li.textContent = "—";
      els.statTopSectors.appendChild(li);
      return;
    }
    stats.topSectors.forEach((s, i) => {
      const li = document.createElement("li");
      const rankNum = document.createElement("span");
      rankNum.className = "rank-num";
      rankNum.textContent = String(i + 1);
      const rankName = document.createElement("span");
      rankName.className = "rank-name";
      rankName.textContent = s.name;
      const rankAmount = document.createElement("span");
      rankAmount.className = "rank-amount";
      rankAmount.textContent = formatMEUR(s.amount);
      li.append(rankNum, rankName, rankAmount);
      els.statTopSectors.appendChild(li);
    });
  }

  function uniqueSortedValues(deals, key) {
    const set = new Set();
    for (const d of deals) {
      const v = (d[key] || "").toString().trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }

  function populateSelect(select, values) {
    while (select.options.length > 1) select.remove(1);
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
  }

  function populateDealsFilters(deals) {
    populateSelect(els.filterSecteur, uniqueSortedValues(deals, "secteur"));
    populateSelect(els.filterPays, uniqueSortedValues(deals, "pays"));
    populateSelect(els.filterType, uniqueSortedValues(deals, "type"));
  }

  function getFilteredSortedDeals() {
    const f = state.dealsFilters;
    let list = (state.deals || []).slice();

    if (f.secteur) list = list.filter((d) => (d.secteur || "") === f.secteur);
    if (f.pays) list = list.filter((d) => (d.pays || "") === f.pays);
    if (f.type) list = list.filter((d) => (d.type || "") === f.type);
    if (f.montantMin !== "" && !isNaN(parseFloat(f.montantMin))) {
      const min = parseFloat(f.montantMin);
      list = list.filter((d) => dealAmount(d) >= min);
    }
    if (f.montantMax !== "" && !isNaN(parseFloat(f.montantMax))) {
      const max = parseFloat(f.montantMax);
      list = list.filter((d) => dealAmount(d) <= max);
    }

    const { key, dir } = state.dealsSort;
    const mult = dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp;
      if (key === "date") {
        const da = parseDealDate(a.date);
        const db = parseDealDate(b.date);
        cmp = (da ? da.getTime() : -Infinity) - (db ? db.getTime() : -Infinity);
      } else if (key === "montant_meur") {
        cmp = dealAmount(a) - dealAmount(b);
      } else if (key === "investisseurs") {
        const sa = Array.isArray(a.investisseurs) ? a.investisseurs.join(", ") : (a.investisseurs || "");
        const sb = Array.isArray(b.investisseurs) ? b.investisseurs.join(", ") : (b.investisseurs || "");
        cmp = sa.localeCompare(sb, "fr", { sensitivity: "base" });
      } else {
        cmp = (a[key] || "").toString().localeCompare((b[key] || "").toString(), "fr", { sensitivity: "base" });
      }
      return cmp * mult;
    });

    return list;
  }

  function renderDealsEmpty(message) {
    els.dealsTableWrap.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "deals-empty";
    const strong = document.createElement("strong");
    strong.textContent = "Aucune opération à afficher";
    const p = document.createElement("p");
    p.style.margin = "0";
    p.textContent = message;
    wrap.append(strong, p);
    els.dealsTableWrap.appendChild(wrap);
  }

  function renderDealsTable(list) {
    const table = document.createElement("table");
    table.className = "deals-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of DEALS_COLUMNS) {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.sortable) {
        th.classList.add("sortable");
        th.dataset.key = col.key;
        th.setAttribute("aria-sort", state.dealsSort.key === col.key ? (state.dealsSort.dir === "asc" ? "ascending" : "descending") : "none");
        th.tabIndex = 0;
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const d of list) {
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.className = "deals-td-date";
      tdDate.textContent = formatDealDateShort(d.date);
      tr.appendChild(tdDate);

      const tdCompany = document.createElement("td");
      tdCompany.className = "deals-td-company";
      tdCompany.textContent = d.societe || "—";
      tr.appendChild(tdCompany);

      const tdType = document.createElement("td");
      if (d.type) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = d.type;
        tdType.appendChild(chip);
      } else {
        tdType.textContent = "—";
      }
      tr.appendChild(tdType);

      const tdSecteur = document.createElement("td");
      if (d.secteur) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = d.secteur;
        tdSecteur.appendChild(chip);
      } else {
        tdSecteur.textContent = "—";
      }
      tr.appendChild(tdSecteur);

      const tdMontant = document.createElement("td");
      tdMontant.className = "deals-td-num";
      const hasAmount = d.montant_meur !== undefined && d.montant_meur !== null && d.montant_meur !== "" && !isNaN(parseFloat(d.montant_meur));
      tdMontant.textContent = hasAmount ? formatMEUR(dealAmount(d)) : "—";
      tr.appendChild(tdMontant);

      const tdSerie = document.createElement("td");
      if (d.serie) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = d.serie;
        tdSerie.appendChild(chip);
      } else {
        tdSerie.textContent = "—";
      }
      tr.appendChild(tdSerie);

      const tdInvestors = document.createElement("td");
      tdInvestors.className = "deals-td-investors";
      tdInvestors.textContent = Array.isArray(d.investisseurs) ? (d.investisseurs.join(", ") || "—") : (d.investisseurs || "—");
      tr.appendChild(tdInvestors);

      const tdPays = document.createElement("td");
      tdPays.textContent = d.pays || "—";
      tr.appendChild(tdPays);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    els.dealsTableWrap.innerHTML = "";
    els.dealsTableWrap.appendChild(table);
  }

  function updateDealsFilterResetVisibility() {
    const f = state.dealsFilters;
    const active = !!(f.secteur || f.pays || f.type || f.montantMin !== "" || f.montantMax !== "");
    els.filterReset.hidden = !active;
  }

  function renderDealsTableView() {
    if (!state.deals || state.deals.length === 0) {
      renderDealsEmpty(DEALS_EMPTY_MESSAGES[state.dealsEmptyReason] || DEALS_EMPTY_MESSAGES.empty);
      return;
    }
    const filtered = getFilteredSortedDeals();
    if (filtered.length === 0) {
      renderDealsEmpty("Aucune opération ne correspond à ces filtres.");
      return;
    }
    renderDealsTable(filtered);
  }

  function onDealsFilterChange() {
    state.dealsFilters.secteur = els.filterSecteur.value;
    state.dealsFilters.pays = els.filterPays.value;
    state.dealsFilters.type = els.filterType.value;
    state.dealsFilters.montantMin = els.filterMontantMin.value;
    state.dealsFilters.montantMax = els.filterMontantMax.value;
    updateDealsFilterResetVisibility();
    renderDealsTableView();
  }

  function resetDealsFilters() {
    els.filterSecteur.value = "";
    els.filterPays.value = "";
    els.filterType.value = "";
    els.filterMontantMin.value = "";
    els.filterMontantMax.value = "";
    onDealsFilterChange();
  }

  async function ensureDealsLoaded() {
    if (state.dealsLoadState !== "idle") return;
    state.dealsLoadState = "loading";
    const { deals, reason } = await fetchDeals();
    state.deals = deals;
    state.dealsEmptyReason = reason;
    state.dealsLoadState = "ready";

    if (deals.length > 0) {
      populateDealsFilters(deals);
      els.dealsToolbar.hidden = false;
    }

    renderDealsStats(computeDealStats(deals), deals.length > 0);
    renderDealsTableView();
  }

  /* ------------------------------------------------------------------ *
   *  Source switching (Web & Tendances / Newsletters tabs)
   * ------------------------------------------------------------------ */

  function switchSource(sourceKey) {
    if (state.activeSource === sourceKey) return;
    state.activeSource = sourceKey;
  }

  function setView(view, { pushHash = true } = {}) {
    state.currentView = view;
    const isDeals = view === "deals";
    const isHome = view === "home";
    document.body.dataset.view = view;
    els.homeView.hidden = !isHome;
    els.briefingLayout.hidden = isHome || isDeals;
    els.dealsView.hidden = !isDeals;
    els.tabSourceWeb.setAttribute("aria-selected", String(!isDeals && state.activeSource === "web"));
    els.tabSourceNewsletters.setAttribute("aria-selected", String(!isDeals && state.activeSource === "newsletters"));
    els.tabDeals.setAttribute("aria-selected", String(isDeals));
    closeSidebar();

    if (isDeals) {
      document.title = "Deals — Veille Innovation";
      if (pushHash) history.replaceState(null, "", "#deals");
      els.dealsView.focus({ preventScroll: true });
      ensureDealsLoaded();
    } else if (isHome) {
      const cfg = SOURCES[state.activeSource];
      document.title = state.activeSource === "web" ? "Veille Innovation" : `${cfg.label} — Veille Innovation`;
      if (pushHash) history.replaceState(null, "", cfg.hashPrefix ? `#${cfg.hashPrefix}` : "#home");
      els.homeView.focus({ preventScroll: true });
      renderHome();
    } else {
      const cur = activeSrc().currentDate;
      if (cur) {
        const cfg = SOURCES[state.activeSource];
        if (pushHash) history.replaceState(null, "", cfg.hashPrefix ? `#${cfg.hashPrefix}/${cur}` : `#${cur}`);
        document.title = `${formatLong(cur)} — ${cfg.label} — Veille Innovation`;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Archives drawer (sidebar overlay)
   * ------------------------------------------------------------------ */

  function openSidebar() {
    els.sidebar.classList.add("open");
    els.sidebarBackdrop.classList.add("open");
    els.navArchives.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
    els.navArchives.setAttribute("aria-expanded", "false");
  }
  function toggleSidebar() {
    if (els.sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  }

  /* ------------------------------------------------------------------ *
   *  Hash routing
   *  - "#deals"                       -> deals view
   *  - "" / "#home"                   -> web home
   *  - "#newsletters"                 -> newsletters home
   *  - "#YYYY-MM-DD"                  -> web briefing (kept unprefixed for backward-compatible links)
   *  - "#newsletters/YYYY-MM-DD"      -> newsletters briefing
   * ------------------------------------------------------------------ */

  function parseHash(hash) {
    if (hash === "deals") return { view: "deals" };
    if (hash === "" || hash === "home") return { view: "home", source: "web" };
    if (hash === "newsletters") return { view: "home", source: "newsletters" };
    const nl = /^newsletters\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
    if (nl) return { view: "briefing", source: "newsletters", date: nl[1] };
    if (/^\d{4}-\d{2}-\d{2}$/.test(hash)) return { view: "briefing", source: "web", date: hash };
    return null;
  }

  /* ------------------------------------------------------------------ *
   *  Init
   * ------------------------------------------------------------------ */

  async function init() {
    initTheme();

    els.themeToggle.addEventListener("click", toggleTheme);
    els.navArchives.addEventListener("click", toggleSidebar);
    els.searchToggle.addEventListener("click", () => {
      openSidebar();
      els.searchInput.focus();
    });
    els.sidebarBackdrop.addEventListener("click", closeSidebar);
    els.searchInput.addEventListener("input", onSearchInput);
    els.searchClear.addEventListener("click", clearSearch);
    els.brandHome.addEventListener("click", (e) => {
      e.preventDefault();
      setView("home");
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSidebar();
    });

    els.tabSourceWeb.addEventListener("click", () => {
      switchSource("web");
      if (!state.searchQuery) buildSidebarArchives();
      setView("home");
    });
    els.tabSourceNewsletters.addEventListener("click", () => {
      switchSource("newsletters");
      if (!state.searchQuery) buildSidebarArchives();
      setView("home");
    });
    els.tabDeals.addEventListener("click", () => setView("deals"));
    els.subnav.addEventListener("click", (e) => {
      const btn = e.target.closest(".subnav-link[data-cat]");
      if (btn) goToCategory(btn.dataset.cat);
    });
    [els.filterSecteur, els.filterPays, els.filterType].forEach((sel) => sel.addEventListener("change", onDealsFilterChange));
    els.filterMontantMin.addEventListener("input", onDealsFilterChange);
    els.filterMontantMax.addEventListener("input", onDealsFilterChange);
    els.filterReset.addEventListener("click", resetDealsFilters);
    els.dealsTableWrap.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th || !state.deals || state.deals.length === 0) return;
      const key = th.dataset.key;
      if (state.dealsSort.key === key) {
        state.dealsSort.dir = state.dealsSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.dealsSort.key = key;
        state.dealsSort.dir = key === "date" || key === "montant_meur" ? "desc" : "asc";
      }
      renderDealsTableView();
    });
    els.dealsTableWrap.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("th[data-key]")) {
        e.preventDefault();
        e.target.click();
      }
    });

    const [webDates, newslettersDates] = await Promise.all([loadIndex("web"), loadIndex("newsletters")]);
    state.bySource.web.dates = webDates;
    state.bySource.newsletters.dates = newslettersDates;

    buildSidebarArchives();

    const hash = location.hash.replace("#", "").trim();
    const parsed = parseHash(hash);

    if (parsed && parsed.view === "deals") {
      setView("deals", { pushHash: false });
    } else if (parsed && parsed.view === "home") {
      if (parsed.source !== state.activeSource) {
        state.activeSource = parsed.source;
        buildSidebarArchives();
      }
      setView("home", { pushHash: false });
    } else if (parsed && parsed.view === "briefing" && state.bySource[parsed.source].dates.includes(parsed.date)) {
      if (parsed.source !== state.activeSource) {
        state.activeSource = parsed.source;
        buildSidebarArchives();
      }
      setView("briefing", { pushHash: false });
      loadBriefing(parsed.date, { pushHash: true });
    } else if (state.bySource.web.dates.length || state.bySource.newsletters.dates.length) {
      if (!state.bySource.web.dates.length) {
        state.activeSource = "newsletters";
        buildSidebarArchives();
      }
      setView("home", { pushHash: false });
    } else {
      renderError("Aucun briefing disponible pour le moment.");
    }

    window.addEventListener("hashchange", () => {
      const h = location.hash.replace("#", "").trim();
      const p = parseHash(h);
      if (!p) return;

      if (p.view === "deals") {
        if (state.currentView !== "deals") setView("deals", { pushHash: false });
        return;
      }
      if (p.view === "home") {
        if (state.currentView !== "home" || state.activeSource !== p.source) {
          if (p.source !== state.activeSource) {
            state.activeSource = p.source;
            buildSidebarArchives();
          }
          setView("home", { pushHash: false });
        }
        return;
      }
      if (p.view === "briefing" && state.bySource[p.source].dates.includes(p.date)) {
        if (p.source !== state.activeSource) {
          state.activeSource = p.source;
          buildSidebarArchives();
        }
        if (state.currentView !== "briefing") setView("briefing", { pushHash: false });
        if (p.date !== activeSrc().currentDate) loadBriefing(p.date, { pushHash: false });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
