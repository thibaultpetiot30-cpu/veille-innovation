(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */

  const state = {
    dates: [],          // all available dates, desc order, e.g. "2026-07-09"
    cache: new Map(),   // date -> raw markdown string
    currentDate: null,
    searchQuery: "",
  };

  const els = {
    sidebarBody: document.getElementById("sidebarBody"),
    content: document.getElementById("content"),
    currentDatePill: document.getElementById("currentDatePill"),
    searchInput: document.getElementById("searchInput"),
    searchClear: document.getElementById("searchClear"),
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    navToggle: document.getElementById("navToggle"),
    searchToggle: document.getElementById("searchToggle"),
    themeToggle: document.getElementById("themeToggle"),
    brandHome: document.getElementById("brandHome"),
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

  /* ------------------------------------------------------------------ *
   *  Data loading
   * ------------------------------------------------------------------ */

  async function loadIndex() {
    const res = await fetch("data/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("index.json introuvable");
    const json = await res.json();
    const dates = Array.isArray(json.dates) ? json.dates.slice() : [];
    dates.sort().reverse();
    return dates;
  }

  async function loadMarkdown(dateStr) {
    if (state.cache.has(dateStr)) return state.cache.get(dateStr);
    const res = await fetch(`data/${dateStr}.md`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Briefing du ${dateStr} introuvable`);
    const text = await res.text();
    state.cache.set(dateStr, text);
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
   *  Rendering
   * ------------------------------------------------------------------ */

  function renderBriefing(dateStr, markdown) {
    const { preamble, sections } = splitMarkdown(markdown);
    const { title, subtitle } = parsePreamble(preamble);
    const { emoji: titleEmoji, rest: titleRest } = extractEmoji(title);

    const wrap = document.createElement("div");
    wrap.className = "content-inner";

    const kicker = document.createElement("p");
    kicker.className = "doc-kicker";
    kicker.innerHTML = `<span class="dot"></span> Briefing quotidien · ${formatLong(dateStr)}`;
    wrap.appendChild(kicker);

    const h1 = document.createElement("h1");
    h1.className = "doc-title";
    h1.innerHTML = (titleEmoji ? `<span class="title-emoji">${titleEmoji}</span>` : "") + escapeHtml(titleRest || title);
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

    for (const section of sections) {
      const info = classifySection(section.heading);
      const { emoji, rest: headingText } = extractEmoji(section.heading);
      const bodyHtml = window.marked.parse(section.body || "");

      if (info.kind === "warning") {
        const banner = document.createElement("div");
        banner.className = "banner";
        banner.innerHTML = `<span class="banner-icon">${emoji || "⚠️"}</span><div class="banner-body">${bodyHtml}</div>`;
        sectionsWrap.appendChild(banner);
        continue;
      }

      if (info.kind === "summary") {
        const hero = document.createElement("div");
        hero.className = "hero";
        hero.innerHTML = `<h2 class="hero-title"><span class="hero-icon">${emoji || "🎯"}</span>${escapeHtml(headingText)}</h2><div class="hero-body">${bodyHtml}</div>`;
        sectionsWrap.appendChild(hero);
        continue;
      }

      const card = document.createElement("article");
      card.className = "card" + (info.kind === "context" ? " card--muted" : "");
      if (info.category) card.dataset.cat = info.category;

      const header = document.createElement("div");
      header.className = "card-header";
      header.innerHTML = `
        <span class="card-icon">${emoji || "📄"}</span>
        <h3 class="card-title">${escapeHtml(headingText)}</h3>
        ${info.label ? `<span class="badge"><span class="dot"></span>${info.label}</span>` : (info.kind === "context" ? `<span class="badge">Contexte</span>` : "")}
      `;
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "card-body";
      body.innerHTML = bodyHtml;
      card.appendChild(body);

      sectionsWrap.appendChild(card);
    }

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
   *  Loading a briefing (navigation)
   * ------------------------------------------------------------------ */

  async function loadBriefing(dateStr, { pushHash = true } = {}) {
    if (!state.dates.includes(dateStr)) return;
    state.currentDate = dateStr;
    els.currentDatePill.textContent = formatLong(dateStr);
    document.title = `${formatLong(dateStr)} — Veille Innovation`;
    if (pushHash) history.replaceState(null, "", `#${dateStr}`);
    setActiveSidebarItem(dateStr);
    closeMobileSidebar();

    els.content.innerHTML = `<p class="content-loading">Chargement du briefing…</p>`;
    try {
      const md = await loadMarkdown(dateStr);
      renderBriefing(dateStr, md);
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
   *  Sidebar: archive list grouped by month
   * ------------------------------------------------------------------ */

  function buildSidebarArchives() {
    const groups = new Map(); // "YYYY-MM" -> [dates]
    for (const d of state.dates) {
      const key = d.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }

    const frag = document.createDocumentFragment();
    const label = document.createElement("p");
    label.className = "sidebar-label";
    let first = true;

    for (const [key, dates] of groups) {
      const details = document.createElement("details");
      details.className = "archive-group";
      details.open = first;

      const summary = document.createElement("summary");
      summary.innerHTML = `<svg class="chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg><span>${formatMonthGroup(dates[0])}</span><span class="count">${dates.length}</span>`;
      details.appendChild(summary);

      const ul = document.createElement("ul");
      ul.className = "archive-list";
      for (const d of dates) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.className = "archive-item";
        btn.type = "button";
        btn.dataset.date = d;
        btn.innerHTML = `<span class="day-num">${dayNumber(d)}</span><span class="day-label">${weekdayShort(d)} ${dayNumber(d)}</span>`;
        btn.addEventListener("click", () => loadBriefing(d));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      details.appendChild(ul);
      frag.appendChild(details);
      first = false;
    }

    els.sidebarBody.innerHTML = "";
    if (state.dates.length === 0) {
      els.sidebarBody.innerHTML = `<p class="sidebar-empty">Aucune archive disponible.</p>`;
      return;
    }
    els.sidebarBody.appendChild(frag);
  }

  /* ------------------------------------------------------------------ *
   *  Full-text search
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

    await Promise.all(state.dates.map((d) => loadMarkdown(d).catch(() => "")));

    const needle = normalize(query);
    const results = [];
    for (const d of state.dates) {
      const raw = state.cache.get(d) || "";
      const plain = stripMarkdown(raw);
      const idx = normalize(plain).indexOf(needle);
      if (idx !== -1) {
        const start = Math.max(0, idx - 50);
        const end = Math.min(plain.length, idx + needle.length + 70);
        let snippet = plain.slice(start, end).trim();
        if (start > 0) snippet = "…" + snippet;
        if (end < plain.length) snippet += "…";
        results.push({ date: d, snippet });
      }
    }

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
      btn.innerHTML = `<span class="sr-date">${formatLong(r.date)}</span><span class="sr-snippet">${highlightTerm(r.snippet, query)}</span>`;
      btn.addEventListener("click", async () => {
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
    buildSidebarArchives();
    setActiveSidebarItem(state.currentDate);
  }

  /* ------------------------------------------------------------------ *
   *  Mobile sidebar toggle
   * ------------------------------------------------------------------ */

  function openMobileSidebar() {
    els.sidebar.classList.add("open");
    els.sidebarBackdrop.classList.add("open");
    els.navToggle.setAttribute("aria-expanded", "true");
  }
  function closeMobileSidebar() {
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
    els.navToggle.setAttribute("aria-expanded", "false");
  }
  function toggleMobileSidebar() {
    if (els.sidebar.classList.contains("open")) closeMobileSidebar();
    else openMobileSidebar();
  }

  /* ------------------------------------------------------------------ *
   *  Init
   * ------------------------------------------------------------------ */

  async function init() {
    initTheme();

    els.themeToggle.addEventListener("click", toggleTheme);
    els.navToggle.addEventListener("click", toggleMobileSidebar);
    els.searchToggle.addEventListener("click", () => {
      openMobileSidebar();
      els.searchInput.focus();
    });
    els.sidebarBackdrop.addEventListener("click", closeMobileSidebar);
    els.searchInput.addEventListener("input", onSearchInput);
    els.searchClear.addEventListener("click", clearSearch);
    els.brandHome.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.dates.length) loadBriefing(state.dates[0]);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMobileSidebar();
    });

    try {
      state.dates = await loadIndex();
    } catch (err) {
      renderError("Impossible de charger l'index des briefings (data/index.json).");
      return;
    }

    buildSidebarArchives();

    if (!state.dates.length) {
      renderError("Aucun briefing disponible pour le moment.");
      return;
    }

    const hashDate = location.hash.replace("#", "").trim();
    const initialDate = state.dates.includes(hashDate) ? hashDate : state.dates[0];
    loadBriefing(initialDate, { pushHash: true });

    window.addEventListener("hashchange", () => {
      const d = location.hash.replace("#", "").trim();
      if (d && d !== state.currentDate && state.dates.includes(d)) loadBriefing(d, { pushHash: false });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
