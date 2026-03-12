const OpenLibraryClient = (() => {
  const BASE_URL = "https://openlibrary.org/search.json";

  function buildParams(query, options) {
    const params = new URLSearchParams();
    const { type, language, yearFrom, yearTo, page, limit } = options;

    if (type === "all") {
      params.set("q", query);
    } else {
      params.set(type, query);
    }

    if (language) params.set("language", language);
    if (page) params.set("page", String(page));
    if (limit) params.set("limit", String(limit));

    
    const yearFilters = [];
    if (yearFrom) yearFilters.push(`first_publish_year:>=${yearFrom}`);
    if (yearTo) yearFilters.push(`first_publish_year:<=${yearTo}`);
    if (yearFilters.length > 0) {
      const existingQ = params.get("q");
      const filterQuery = yearFilters.join(" AND ");
      if (existingQ) {
        params.set("q", `${existingQ} AND ${filterQuery}`);
      } else {
        
        if (type !== "all") {
          params.delete(type);
          params.set("q", `${type}:"${query}" AND ${filterQuery}`);
        } else {
          params.set("q", filterQuery);
        }
      }
    }

    return params;
  }

  async function search(query, options) {
    const params = buildParams(query, options);
    const url = `${BASE_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }
    return res.json();
  }

  return { search };
})();

const FavoritesStore = (() => {
  const KEY = "book_finder_favorites_v1";
  function getAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  }
  function setAll(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }
  function keyFor(doc) { return doc.key || doc.cover_edition_key || `${doc.title}|${(doc.author_name||[]).join(',')}`; }
  function isFav(doc) { return getAll().some(x => x.id === keyFor(doc)); }
  function toggle(doc) {
    const id = keyFor(doc);
    const all = getAll();
    const idx = all.findIndex(x => x.id === id);
    if (idx >= 0) {
      all.splice(idx, 1);
      setAll(all);
      return false;
    }
    const fav = {
      id,
      title: doc.title,
      author_name: doc.author_name || [],
      first_publish_year: doc.first_publish_year || null,
      cover_i: doc.cover_i || null,
      key: doc.key || null,
      language: doc.language || [],
    };
    all.unshift(fav);
    setAll(all);
    return true;
  }
  return { getAll, toggle, isFav };
})();

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function formatAuthors(a) { return (a && a.length) ? a.join(", ") : "Unknown author"; }
function coverUrl(cover_i) { return cover_i ? `https://covers.openlibrary.org/b/id/${cover_i}-M.jpg` : ""; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

const ui = {
  form: $("#search-form"),
  type: $("#search-type"),
  query: $("#search-query"),
  language: $("#language"),
  yearFrom: $("#year-from"),
  yearTo: $("#year-to"),
  sortBy: $("#sort-by"),
  perPage: $("#per-page"),
  searchBtn: $("#search-button"),
  clearBtn: $("#clear-button"),
  toggleFavs: $("#toggle-favorites"),
  status: $("#status"),
  grid: $("#grid"),
  empty: $("#empty"),
  error: $("#error"),
  loading: $("#loading"),
  prev: $("#prev"),
  next: $("#next"),
  pageNumber: $("#page-number"),
  totalPages: $("#total-pages"),
  cardTpl: $("#book-card-template"),
};

let state = {
  view: "results", // or "favorites"
  page: 1,
  totalPages: 1,
  query: "",
  type: "title",
  language: "",
  yearFrom: "",
  yearTo: "",
  perPage: 20,
  sortBy: "relevance",
  hits: [],
  numFound: 0,
  lastRequestMs: 0,
};

function setView(view) {
  state.view = view;
  const favMode = view === "favorites";
  ui.toggleFavs.setAttribute("aria-pressed", String(favMode));
  ui.toggleFavs.textContent = favMode ? "⟲ Back to results" : "❤ Favorites";
  render();
}

function setLoading(on) {
  ui.loading.classList.toggle("hidden", !on);
}

function setError(message) {
  ui.error.textContent = message || "";
  ui.error.classList.toggle("hidden", !message);
}

function setStatus(text) {
  ui.status.textContent = text || "";
}

function clearResults() {
  ui.grid.innerHTML = "";
}

function applySorting(docs) {
  if (state.sortBy === "relevance") return docs;
  const sorted = [...docs];
  if (state.sortBy === "year-asc") {
    sorted.sort((a,b) => (a.first_publish_year||Infinity) - (b.first_publish_year||Infinity));
  } else if (state.sortBy === "year-desc") {
    sorted.sort((a,b) => (b.first_publish_year||-Infinity) - (a.first_publish_year||-Infinity));
  }
  return sorted;
}

function renderCards(docs) {
  clearResults();
  const frag = document.createDocumentFragment();
  docs.forEach(doc => {
    const card = ui.cardTpl.content.firstElementChild.cloneNode(true);
    const img = $(".cover", card);
    const favBtn = $(".fav", card);
    const titleEl = $(".title", card);
    const authorsEl = $(".authors", card);
    const metaEl = $(".meta-line", card);
    const readA = $(".action-read", card);
    const dlA = $(".action-download", card);

    const url = coverUrl(doc.cover_i);
    if (url) {
      img.src = url;
    } else {
      img.alt = "No cover available";
      img.style.background = "#0b1220";
    }

    titleEl.textContent = doc.title || "Untitled";
    authorsEl.textContent = formatAuthors(doc.author_name);
    const year = doc.first_publish_year ? ` • ${doc.first_publish_year}` : "";
    metaEl.textContent = `${doc.language && doc.language.length ? doc.language.join(', ') : ''}${year}`;

    
    const iaList = Array.isArray(doc.ia) ? doc.ia : [];
    const iaId = iaList.length ? iaList[0] : null;
    const workKey = doc.key || null; 

    
    readA.classList.add("hidden");
    dlA.classList.add("hidden");

    if (iaId) {
      
      readA.href = `https://openlibrary.org/borrow/ia/${encodeURIComponent(iaId)}`;
      readA.textContent = "Read";
      readA.classList.remove("hidden");
 
      dlA.href = `https://archive.org/details/${encodeURIComponent(iaId)}?download=1`;
      dlA.textContent = "Download";
      dlA.classList.remove("hidden");
    } else if (workKey) {
      
      readA.href = `https://openlibrary.org${workKey}`;
      readA.textContent = "Open"
      readA.classList.remove("hidden");
    }

    const favActive = FavoritesStore.isFav(doc);
    favBtn.setAttribute("aria-pressed", String(favActive));
    favBtn.title = favActive ? "Remove from favorites" : "Add to favorites";
    favBtn.addEventListener("click", () => {
      const nowFav = FavoritesStore.toggle(doc);
      favBtn.setAttribute("aria-pressed", String(nowFav));
      favBtn.title = nowFav ? "Remove from favorites" : "Add to favorites";
      if (state.view === "favorites") render();
    });

    frag.appendChild(card);
  });
  ui.grid.appendChild(frag);
}

function render() {
  setError("");
  setLoading(false);

  if (state.view === "favorites") {
    const list = FavoritesStore.getAll();
    ui.totalPages.textContent = "1";
    ui.pageNumber.value = "1";
    ui.prev.disabled = true;
    ui.next.disabled = true;
    setStatus(`${list.length} favorite${list.length===1?'':'s'}`);
    ui.empty.classList.toggle("hidden", list.length !== 0);
    renderCards(list);
    return;
  }

  const { hits, numFound, page, totalPages } = state;
  ui.totalPages.textContent = String(totalPages || 1);
  ui.pageNumber.value = String(page);
  ui.prev.disabled = page <= 1;
  ui.next.disabled = page >= totalPages;
  ui.empty.classList.toggle("hidden", hits.length !== 0);
  const perPage = state.perPage;
  const start = numFound === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(numFound, page * perPage);
  setStatus(numFound === 0 ? `0 results` : `Showing ${start}–${end} of ${numFound}`);

  renderCards(applySorting(hits));
}

async function performSearch() {
  const query = state.query.trim();
  if (!query) {
    setError("Enter a search query.");
    return;
  }

  setError("");
  setLoading(true);
  clearResults();
  setStatus("Searching…");
  const startedAt = Date.now();
  state.lastRequestMs = startedAt;

  try {
   
    const apiPageSize = 100;
    const desiredPerPage = state.perPage;
    const desiredPage = state.page;
    const startIndex = (desiredPage - 1) * desiredPerPage; 
    const endIndexExclusive = startIndex + desiredPerPage;

    const apiPageStart = Math.floor(startIndex / apiPageSize) + 1; 
    const apiPageEnd = Math.floor((endIndexExclusive - 1) / apiPageSize) + 1;

    
    const fetchApiPage = async (apiPage) => OpenLibraryClient.search(query, {
      type: state.type === "all" ? "all" : state.type,
      language: state.language,
      yearFrom: state.yearFrom,
      yearTo: state.yearTo,
      page: apiPage,
      
    });

    const firstRes = await fetchApiPage(apiPageStart);
    
    if (state.lastRequestMs !== startedAt) return;

    let combinedDocs = Array.isArray(firstRes.docs) ? firstRes.docs : [];
    const numFound = Number(firstRes.numFound || combinedDocs.length);

    if (apiPageEnd > apiPageStart) {
      const secondRes = await fetchApiPage(apiPageEnd);
      if (state.lastRequestMs !== startedAt) return;
      const secondDocs = Array.isArray(secondRes.docs) ? secondRes.docs : [];
      combinedDocs = combinedDocs.concat(secondDocs);
    }

   
    const offsetWithinFirstFetched = startIndex - (apiPageStart - 1) * apiPageSize;
    const pageDocs = combinedDocs.slice(offsetWithinFirstFetched, offsetWithinFirstFetched + desiredPerPage);

    state.numFound = numFound;
    state.totalPages = Math.max(1, Math.ceil(numFound / desiredPerPage));
    state.hits = pageDocs;
    setLoading(false);
    render();
  } catch (err) {
    if (state.lastRequestMs !== startedAt) return;
    setLoading(false);
    setError(err.message || "Something went wrong. Please try again.");
  }
}

function readFormToState() {
  state.type = ui.type.value;
  state.query = ui.query.value;
  state.language = ui.language.value;
  state.yearFrom = ui.yearFrom.value;
  state.yearTo = ui.yearTo.value;
  state.sortBy = ui.sortBy.value;
  state.perPage = Number(ui.perPage.value);
}

function debounced(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function initEvents() {
  ui.form.addEventListener("submit", (e) => {
    e.preventDefault();
    readFormToState();
    state.page = 1;
    setView("results");
    performSearch();
  });

  const autoSearch = debounced(() => {
    readFormToState();
    state.page = 1;
    if (state.query.trim()) performSearch();
  }, 450);

  ui.query.addEventListener("input", autoSearch);
  ui.type.addEventListener("change", autoSearch);
  ui.language.addEventListener("change", autoSearch);
  ui.yearFrom.addEventListener("input", autoSearch);
  ui.yearTo.addEventListener("input", autoSearch);
  ui.sortBy.addEventListener("change", () => {
    readFormToState();
    render();
  });
  ui.perPage.addEventListener("change", () => {
    readFormToState();
    state.page = 1;
    performSearch();
  });

  ui.clearBtn.addEventListener("click", () => {
    ui.query.value = "";
    ui.yearFrom.value = "";
    ui.yearTo.value = "";
    ui.language.value = "";
    state.page = 1;
    state.query = "";
    state.hits = [];
    state.numFound = 0;
    render();
  });

  ui.prev.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    performSearch();
  });
  ui.next.addEventListener("click", () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    performSearch();
  });
  ui.pageNumber.addEventListener("change", () => {
    const val = clamp(Number(ui.pageNumber.value || 1), 1, state.totalPages);
    state.page = val;
    performSearch();
  });

  ui.toggleFavs.addEventListener("click", () => {
    setView(state.view === "favorites" ? "results" : "favorites");
  });
}

function hydrateFromURL() {
  const url = new URL(location.href);
  const get = (k, d = "") => url.searchParams.get(k) || d;
  ui.type.value = get("type", "title");
  ui.query.value = get("q", "");
  ui.language.value = get("lang", "");
  ui.yearFrom.value = get("y1", "");
  ui.yearTo.value = get("y2", "");
  ui.sortBy.value = get("sort", "relevance");
  ui.perPage.value = get("pp", "20");
  state.page = Number(get("page", "1"));
  readFormToState();
}

function persistToURL() {
  const url = new URL(location.href);
  url.searchParams.set("type", state.type);
  url.searchParams.set("q", state.query);
  if (state.language) url.searchParams.set("lang", state.language); else url.searchParams.delete("lang");
  if (state.yearFrom) url.searchParams.set("y1", state.yearFrom); else url.searchParams.delete("y1");
  if (state.yearTo) url.searchParams.set("y2", state.yearTo); else url.searchParams.delete("y2");
  if (state.sortBy !== "relevance") url.searchParams.set("sort", state.sortBy); else url.searchParams.delete("sort");
  if (state.perPage !== 20) url.searchParams.set("pp", String(state.perPage)); else url.searchParams.delete("pp");
  url.searchParams.set("page", String(state.page));
  history.replaceState(null, "", url);
}

function init() {
  hydrateFromURL();
  initEvents();
  if (state.query.trim()) performSearch();

  
  const sync = debounced(() => persistToURL(), 150);
  [ui.pageNumber, ui.perPage, ui.type, ui.query, ui.language, ui.yearFrom, ui.yearTo, ui.sortBy]
    .forEach(el => el.addEventListener("change", sync));
}

window.addEventListener("DOMContentLoaded", init);


