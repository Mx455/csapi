const NOW_BASE = "https://www.nowtv.it";
const CS_BASE = "https://www.comingsoon.it";

const VERSION = "5.0-csapi";
const TTL = 14400;
const CACHE_VERSION = "v4";
const TIMEOUT = 12000;
const NOW_CONCURRENCY = 5;
const CS_CONCURRENCY = 3;

const HTML_HEADERS = {
  Accept: "text/html",
  "Accept-Language": "it-IT,it;q=0.9"
};

const NOW_HEADERS = {
  Accept: "application/json",
  "X-SkyOTT-Application": "ott-sas-iceberg",
  "X-SkyOTT-Proposition": "NOWOTT",
  "X-SkyOTT-Provider": "NOWTV",
  "X-SkyOTT-Territory": "IT",
  "X-SkyOTT-Language": "it-IT",
  "X-SkyOTT-Device": "COMPUTER",
  "X-SkyOTT-Platform": "PC"
};

// ==========================================================
// CATALOGO UFFICIALE NOW
// ==========================================================

const PAGES = [
  "/cinema-entertainment",
  "/cinema-entertainment/genere/show",
  "/cinema-entertainment/genere/drama",
  "/cinema-entertainment/genere/comedy-romance",
  "/cinema-entertainment/genere/sci-fi-fantasy",
  "/cinema-entertainment/genere/suspense",
  "/cinema-entertainment/genere/true-crime"
];

const COLLECTIONS = [
  "/tv/show-gold-iceberg",
  "/iceberg/movies/film-gold-iceberg",
  "/tv/documentari-true-crime-1",
  "/tv/Scopri-i-titoli-di-Sky-Voices",
  "/home/in-evidenza",
  "/tv/show-gold-iceberg-1",
  "/home/film-dazione-e-fantasy",
  "/tv/serie-tv-crime-piu-viste",
  "/tv/cooking-show",
  "/tv/drammatico-sentimentali",
  "/home/film-comedy-1",
  "/tv/serie-tv-sci-fi-e-fantasy-piu-viste",
  "/tv/serie-tv-thriller-piu-viste",
  "/tv/detective-protagonisti",
  "/tv/gli-show-piu-amati",
  "/tv/reality-show",
  "/home/film-drammatici-1",
  "/tv/serie-poliziesche",
  "/home/serie-drammatiche-e-fantasy",
  "/home/serie-comedy",
  "/tv/commedia-serie-sentimentali",
  "/tv/horror-e-dark-fantasy"
];

// ==========================================================
// MODALITÀ OFFERTE
// ==========================================================

const OFFER_MODES = {
  gratis: {
    type: "free",
    section: "stream"
  },
  abbonamento: {
    type: "subscription",
    section: "stream"
  },
  noleggio: {
    type: "rent",
    section: "rent"
  },
  acquisto: {
    type: "buy",
    section: "buy"
  }
};

// ==========================================================
// UTILITY
// ==========================================================

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);

      return code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);

      return code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function cleanText(value) {
  return decodeHtml(
    String(value || "").replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getAttr(tag, name) {
  const escaped = name.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const pattern = new RegExp(
    "\\s" + escaped +
    "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i"
  );

  const match = String(tag).match(pattern);

  return match
    ? decodeHtml(match[1] ?? match[2] ?? match[3])
    : null;
}

function hasClass(tag, name) {
  return (getAttr(tag, "class") || "")
    .split(/\s+/)
    .includes(name);
}

// ==========================================================
// VALIDAZIONE URL NOW
// ==========================================================

function validNowUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.nowtv.it"
    ) {
      return null;
    }

    const allowedPaths = [
      "/streaming/",
      "/watch/asset/",
      "/watch/home/asset/"
    ];

    if (
      !allowedPaths.some(path =>
        url.pathname.startsWith(path)
      )
    ) {
      return null;
    }

    return url.href;

  } catch {
    return null;
  }
}

// ==========================================================
// FETCH
// ==========================================================

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: HTML_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    html: await response.text(),
    http: response.status,
    finalUrl: response.url
  };
}

async function runBatches(tasks, concurrency) {
  const results = [];

  for (
    let i = 0;
    i < tasks.length;
    i += concurrency
  ) {
    const group = tasks.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      group.map(task => task())
    );

    results.push(...settled);
  }

  return results;
}

// ==========================================================
// ASSET NOW
// ==========================================================

function normalizeAsset(asset, source) {
  if (
    !asset ||
    typeof asset.title !== "string" ||
    typeof asset.url !== "string" ||
    !asset.url.startsWith("/streaming/")
  ) {
    return null;
  }

  const title = asset.title.trim();
  if (!title) return null;

  return {
    title,
    normalizedTitle: normalize(title),
    type: asset.classification || null,
    url: new URL(asset.url, NOW_BASE).href,
    contentId: asset.contentId || null,
    available: asset.available === true,
    upcoming: asset.upcoming === true,
    offerEndTs: asset.offerEndTs || null,
    source
  };
}

function isActive(item) {
  if (!item.available || item.upcoming) {
    return false;
  }

  if (!item.offerEndTs) {
    return true;
  }

  const raw = item.offerEndTs;
  let expiry;

  if (typeof raw === "number") {
    expiry = raw < 1e12 ? raw * 1000 : raw;
  } else if (/^\d+$/.test(String(raw))) {
    const number = Number(raw);
    expiry = number < 1e12 ? number * 1000 : number;
  } else {
    expiry = Date.parse(String(raw));
  }

  return Number.isFinite(expiry) &&
    expiry > Date.now();
}

// ==========================================================
// PAGINE HTML NOW
// ==========================================================

async function fetchNowPage(path) {
  const { html } = await fetchHtml(NOW_BASE + path);

  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match) {
    throw new Error("NEXT_DATA assente");
  }

  const data = JSON.parse(match[1]);

  const root =
    data.props?.apolloState?.data?.ROOT_QUERY || {};

  return Object.entries(root)
    .filter(([key]) => key.startsWith("fetchCollection("))
    .flatMap(([, value]) =>
      Array.isArray(value?.assets) ? value.assets : []
    )
    .map(asset => normalizeAsset(asset, "html"))
    .filter(Boolean);
}

// ==========================================================
// API COLLEZIONI NOW
// ==========================================================

async function fetchNowCollection(slug) {
  const url = new URL(
    NOW_BASE + "/web-api/web-api/atom/collection"
  );

  url.search = new URLSearchParams({
    collectionType: "collections_v2",
    slug,
    limit: "none",
    filter: "none",
    skip: "0"
  });

  const response = await fetch(url.href, {
    headers: NOW_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data?.assets)) {
    throw new Error("Campo assets assente");
  }

  return data.assets
    .map(asset => normalizeAsset(asset, "api"))
    .filter(Boolean);
}

// ==========================================================
// COSTRUZIONE CATALOGO NOW
// ==========================================================

async function buildNowCatalog() {
  const tasks = [
    ...PAGES.map(path => ({
      source: "html",
      path,
      run: () => fetchNowPage(path)
    })),

    ...COLLECTIONS.map(path => ({
      source: "api",
      path,
      run: () => fetchNowCollection(path)
    }))
  ];

  const settled = await runBatches(
    tasks.map(task => task.run),
    NOW_CONCURRENCY
  );

  const htmlItems = [];
  const apiItems = [];
  const errors = [];
  const sources = [];

  settled.forEach((result, index) => {
    const task = tasks[index];

    if (result.status === "fulfilled") {
      const items = result.value;

      if (task.source === "html") {
        htmlItems.push(...items);
      } else {
        apiItems.push(...items);
      }

      sources.push({
        source: task.source,
        path: task.path,
        status: "ok",
        assets: items.length
      });

    } else {
      const error = String(
        result.reason?.message || result.reason
      );

      errors.push({
        source: task.source,
        path: task.path,
        error
      });

      sources.push({
        source: task.source,
        path: task.path,
        status: "error",
        assets: 0,
        error
      });
    }
  });

  if (errors.length) {
    throw new Error(
      "Catalogo NOW incompleto: " +
      JSON.stringify(errors)
    );
  }

  const htmlUnique = new Map(
    htmlItems.map(item => [item.url, item])
  );

  const apiUnique = new Map(
    apiItems.map(item => [item.url, item])
  );

  const combined = new Map(htmlUnique);

  let overlap = 0;
  let apiNew = 0;

  for (const [url, item] of apiUnique) {
    if (combined.has(url)) {
      overlap++;
    } else {
      apiNew++;
    }

    combined.set(url, item);
  }

  const items = [...combined.values()];
  const active = items.filter(isActive);

  return {
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
    stats: {
      pages: PAGES.length,
      collections: COLLECTIONS.length,
      htmlRaw: htmlItems.length,
      htmlUnique: htmlUnique.size,
      apiRaw: apiItems.length,
      apiUnique: apiUnique.size,
      overlap,
      apiNew,
      totalUniqueUrls: items.length,
      activeUrls: active.length,
      activeUniqueTitles: new Set(
        active.map(item => item.normalizedTitle)
      ).size,
      unavailableOrUpcoming: items.length - active.length,
      errors,
      sources
    }
  };
}

// ==========================================================
// CACHE CATALOGO UFFICIALE NOW
// ==========================================================

async function getNowCatalog(request) {
  const cache = caches.default;

  const key = new Request(
    new URL(
      `/__now_catalog_${CACHE_VERSION}`,
      request.url
    ).href
  );

  const cached = await cache.match(key);

  if (cached) {
    return {
      catalog: await cached.json(),
      cacheStatus: "HIT"
    };
  }

  const catalog = await buildNowCatalog();

  await cache.put(
    key,
    new Response(JSON.stringify(catalog), {
      headers: {
        "Cache-Control": `public, max-age=${TTL}`,
        "Content-Type": "application/json"
      }
    })
  );

  return {
    catalog,
    cacheStatus: "MISS"
  };
}

// ==========================================================
// COMINGSOON - ESTRAZIONE SCHEDE CATALOGO
// ==========================================================

function extractCatalogCards(html, kind) {
  const cards = [];

  const starts = [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\bheader-scheda\b[^"']*\bstreaming\b[^"']*["'][^>]*>/gi
    )
  ];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];

    const end =
      i + 1 < starts.length
        ? starts[i + 1].index
        : Math.min(html.length, start.index + 10000);

    const fragment = html.slice(
      start.index,
      Math.min(end, start.index + 10000)
    );

    const openingTag = start[0];

    if (
      kind === "film" &&
      !hasClass(openingTag, "film")
    ) {
      continue;
    }

    const anchors = [
      ...fragment.matchAll(/<a\b[^>]*>/gi)
    ];

    let detailUrl = null;

    for (const match of anchors) {
      const href = getAttr(match[0], "href");
      if (!href) continue;

      try {
        const url = new URL(href, CS_BASE);

        if (url.hostname !== "www.comingsoon.it") {
          continue;
        }

        const validPath =
          kind === "film"
            ? /^\/film\/.+\/streaming\/?$/i.test(url.pathname)
            : /^\/(?:serietv|serie-tv)\/.+\/streaming\/?$/i.test(url.pathname);

        if (!validPath) continue;

        detailUrl = url.href;
        break;

      } catch {
        continue;
      }
    }

    if (!detailUrl) continue;

    const titleMatch = fragment.match(
      /<div\b[^>]*class=["'][^"']*\btitolo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

    if (!titleMatch) continue;

    const title = cleanText(titleMatch[1]);
    if (!title) continue;

    let originalTitle = null;

    const titleArea = fragment.slice(
      titleMatch.index + titleMatch[0].length,
      titleMatch.index + titleMatch[0].length + 1200
    );

    const originalMatch = titleArea.match(
      /<div\b[^>]*class=["'][^"']*\bsottotitolo\b[^"']*\bh3\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

    if (originalMatch) {
      const candidate = cleanText(originalMatch[1])
        .replace(/^\(\s*|\s*\)$/g, "")
        .trim();

      if (
        candidate &&
        !/^(film|serie tv|serie televisiva)$/i.test(candidate)
      ) {
        originalTitle = candidate;
      }
    }

    cards.push({
      title,
      originalTitle,
      detailUrl
    });
  }

  return [
    ...new Map(
      cards.map(item => [item.detailUrl, item])
    ).values()
  ];
}

// ==========================================================
// COMINGSOON - ESTRAZIONE OFFERTE NOW
// ==========================================================

function extractNowLinks(html) {
  const offers = [];
  const all = [];
  const tracked = [];

  const rows = [
    ...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)
  ];

  for (const rowMatch of rows) {
    const row = rowMatch[0];

    // Identifica la riga della piattaforma NOW.
    const rowHeader = row.match(
      /<th\b[^>]*>[\s\S]*?<\/th>/i
    );

    if (!rowHeader) continue;

    const providerLinks = [
      ...rowHeader[0].matchAll(/<a\b[^>]*>/gi)
    ];

    const isNowRow = providerLinks.some(match =>
      getAttr(match[0], "data-ref")?.toUpperCase() === "NOW"
    );

    if (!isNowRow) continue;

    // Ogni cella indica una modalità di disponibilità.
    const cells = [
      ...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)
    ];

    for (const cellMatch of cells) {
      const cell = cellMatch[0];
      const tdTag = cell.match(/^<td\b[^>]*>/i)?.[0];

      if (!tdTag) continue;

      const column = getAttr(tdTag, "data-th");
      const mode = OFFER_MODES[normalize(column)];

      if (!mode) continue;

      const anchors = [
        ...cell.matchAll(/<a\b[^>]*>/gi)
      ];

      for (const anchorMatch of anchors) {
        const tag = anchorMatch[0];

        if (
          !hasClass(tag, "vodTrack") ||
          getAttr(tag, "data-ref")?.toUpperCase() !== "NOW"
        ) {
          continue;
        }

        const nowUrl = validNowUrl(
          getAttr(tag, "href")
        );

        if (!nowUrl) continue;

        all.push(nowUrl);
        tracked.push(nowUrl);

        offers.push({
          type: mode.type,
          section: mode.section,
          label: column,
          url: nowUrl
        });
      }
    }
  }

  const uniqueOffers = [
    ...new Map(
      offers.map(offer => [
        offer.type + "|" + offer.url,
        offer
      ])
    ).values()
  ];

  return {
    links: [...new Set(all)],
    vodTrackLinks: [...new Set(tracked)],
    offers: uniqueOffers
  };
}

// ==========================================================
// COMINGSOON - TUTTE LE PIATTAFORME STREAMING
// ==========================================================

function extractStreamingPlatforms(html) {
  const platforms = [];
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  for (const match of rows) {
    const row = match[0];
    const header = row.match(/<th\b[^>]*>[\s\S]*?<\/th>/i)?.[0];
    if (!header) continue;
    const providerAnchor = [...header.matchAll(/<a\b[^>]*>/gi)]
      .map(x => x[0]).find(x => getAttr(x, "data-ref")) || null;
    const providerCode = providerAnchor ? getAttr(providerAnchor, "data-ref") : null;
    const logoTag = header.match(/<img\b[^>]*>/i)?.[0];
    const logoRaw = logoTag && (getAttr(logoTag, "data-src") || getAttr(logoTag, "src"));
    let logo = null;
    try {
      const u = new URL(logoRaw, CS_BASE);
      if (u.protocol === "https:") logo = u.href;
    } catch {}
    const providerName = cleanText(header).replace(/\s+/g," ").trim() ||
      (logoTag ? getAttr(logoTag,"alt") : null) || providerCode;
    if (!providerName && !providerCode) continue;
    const offers = [];
    for (const cellMatch of row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)) {
      const cell = cellMatch[0];
      const tag = cell.match(/^<td\b[^>]*>/i)?.[0];
      const column = getAttr(tag || "", "data-th");
      const mode = OFFER_MODES[normalize(column)];
      if (!mode) continue;
      for (const anchorMatch of cell.matchAll(/<a\b[^>]*>/gi)) {
        const anchor = anchorMatch[0];
        const href = getAttr(anchor, "href");
        if (!href) continue;
        let target;
        try {
          target = new URL(href, CS_BASE);
          if (!["http:","https:"].includes(target.protocol)) continue;
        } catch { continue; }
        // Non attribuire disponibilità a link di navigazione interni.
        if (target.hostname.endsWith("comingsoon.it") &&
            !hasClass(anchor,"vodTrack")) continue;
        offers.push({type:mode.type,section:mode.section,label:column,
          url:target.href,linkText:cleanText(anchorMatch[0] + cell.slice(cell.indexOf(anchorMatch[0])+anchorMatch[0].length).split("</a>")[0])});
      }
    }
    if (!offers.length) continue;
    const unique = [...new Map(offers.map(x=>[x.type+"|"+x.url,x])).values()];
    platforms.push({name:providerName,code:providerCode,logo,offers:unique});
  }
  return platforms;
}

// ==========================================================
// COMINGSOON - SCANSIONE PAGINA
// ==========================================================

async function scanComingSoonPage(kind, page) {
  const path =
    kind === "film"
      ? "/film/streaming/nowtv/"
      : "/serietv/streaming/nowtv/";

  const catalogUrl = new URL(path, CS_BASE);

  if (page > 1) {
    catalogUrl.searchParams.set("page", String(page));
  }

  const { html, http } = await fetchHtml(
    catalogUrl.href
  );

  const cards = extractCatalogCards(html, kind);
  const selected = cards.slice(0, 12);

  const tasks = selected.map(card => async () => {
    const detail = await fetchHtml(card.detailUrl);
    const links = extractNowLinks(detail.html);

    const nowUrl =
      links.vodTrackLinks[0] || null;

    return {
      ...card,
      status: nowUrl ? "found" : "no_now_link",
      nowUrl,
      offers: links.offers,
      http: detail.http,
      allNowLinks: links.links.length,
      vodTrackLinks: links.vodTrackLinks.length
    };
  });

  const settled = await runBatches(
    tasks,
    CS_CONCURRENCY
  );

  const results = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      ...selected[index],
      status: "error",
      nowUrl: null,
      offers: [],
      error: String(
        result.reason?.message || result.reason
      )
    };
  });

  const found = results.filter(
    item => item.status === "found"
  ).length;

  const missing = results.filter(
    item => item.status === "no_now_link"
  ).length;

  const errors = results.filter(
    item => item.status === "error"
  ).length;

  const foundUrls = results
    .filter(item => item.nowUrl)
    .map(item => item.nowUrl);

  const duplicateNowUrls =
    foundUrls.length - new Set(foundUrls).size;

  const offerCounts = {
    free: 0,
    subscription: 0,
    rent: 0,
    buy: 0
  };

  for (const result of results) {
    for (const offer of result.offers || []) {
      if (offer.type in offerCounts) {
        offerCounts[offer.type]++;
      }
    }
  }

  return {
    status: "ok",
    provider: "ComingSoon",
    platform: "NOW",
    kind,
    catalogPage: page,
    catalogUrl: catalogUrl.href,
    catalogHttp: http,
    catalogHtmlLength: html.length,
    extractedItems: cards.length,
    testedItems: selected.length,
    found,
    missing,
    errors,
    duplicateNowUrls,
    offerCounts,
    results
  };
}

// ==========================================================
// TEST COLLEZIONE NOW
// ==========================================================

async function testNowCollection() {
  const items = await fetchNowCollection(
    "/tv/show-gold-iceberg"
  );

  return {
    status: "ok",
    provider: "NOW",
    assets: items.length,
    firstTitle: items[0]?.title || null,
    firstUrl: items[0]?.url || null,
    active: items.filter(isActive).length
  };
}

// ==========================================================
// TEST LINK COMINGSOON
// ==========================================================

async function testComingSoonLink() {
  const target =
    CS_BASE +
    "/film/un-matrimonio-mostruoso/62202/streaming/";

  const { html, http } = await fetchHtml(target);
  const links = extractNowLinks(html);

  const expected =
    "https://www.nowtv.it/watch/asset/" +
    "un-matrimonio-mostruoso/R_632058_HD";

  return {
    status: "ok",
    provider: "ComingSoon",
    title: "Un Matrimonio Mostruoso",
    http,
    htmlLength: html.length,
    nowLinks: links.links.length,
    links: links.links,
    vodTrackLinks: links.vodTrackLinks,
    offers: links.offers,
    hasVodTrack: links.vodTrackLinks.length > 0,
    expectedUrlFound:
      links.vodTrackLinks.includes(expected)
  };
}


// ==========================================================
// COMINGSOON - DIAGNOSTICA RICERCA INTERNA GOOGLE CSE
// Endpoint sperimentale: non modifica i test NOW esistenti.
// ==========================================================

const CS_CSE_CX = "001228879720830619245:WMX2023538107";

function parseCseJsonp(body) {
  const start = body.indexOf("(");
  const end = body.lastIndexOf(")");
  if (start < 0 || end <= start) {
    throw new Error("Risposta CSE non riconosciuta (JSONP)");
  }
  return JSON.parse(body.slice(start + 1, end));
}

function comingSoonSearchCandidate(item, type, title, year) {
  const candidateUrl = item.unescapedUrl || item.url || "";
  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return null;
  }

  if (parsed.hostname !== "www.comingsoon.it") return null;
  if (type === "film" && !/^\/film\/[^/]+\/\d+\/scheda\/?$/i.test(parsed.pathname)) return null;
  if (type === "serietv" && !/^\/(?:serietv|serie-tv)\/[^/]+\/\d+\/scheda\/?$/i.test(parsed.pathname)) return null;

  const resultTitle = cleanText(item.titleNoFormatting || item.title || "");
  const yearMatch = resultTitle.match(/\((19\d{2}|20\d{2})\)/);
  const resultYear = yearMatch ? Number(yearMatch[1]) : null;
  const cleanTitle = resultTitle
    .replace(/\s*-\s*(?:Film|Serie TV|Serie Televisiva)\b.*$/i, "")
    .trim();
  const exactTitle = normalize(cleanTitle) === normalize(title);
  const yearMatches = year === null || resultYear === year;
  const id = parsed.pathname.match(/\/(\d+)\/scheda\/?$/)?.[1] || null;

  return {
    title: cleanTitle,
    year: resultYear,
    id,
    detailUrl: parsed.href,
    streamingUrl: parsed.href.replace(/\/scheda\/?$/i, "/streaming/"),
    exactTitle,
    yearMatches,
    match: exactTitle && yearMatches
  };
}

function extractNativeFilmCandidates(html, title, year) {
  const candidates = [];
  const seen = new Set();
  const cards = /<a\b([^>]*\bclass=["'][^"']*\bcards\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(cards)) {
    const href = getAttr("<a " + match[1] + ">", "href");
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href, CS_BASE); } catch { continue; }
    if (parsed.hostname !== "www.comingsoon.it" ||
        !/^\/film\/[^/]+\/\d+\/scheda\/?$/i.test(parsed.pathname) ||
        seen.has(parsed.pathname)) continue;
    const fragment = match[2];
    const heading = fragment.match(/<div\b[^>]*class=["'][^"']*\btitolo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (!heading) continue;
    const candidateTitle = cleanText(heading[1]);
    const yearMatch = fragment.match(/<b>\s*Anno:\s*<\/b>\s*<span>\s*(\d{4})\s*<\/span>/i);
    const candidateYear = yearMatch ? Number(yearMatch[1]) : null;
    const exactTitle = normalize(candidateTitle) === normalize(title);
    const yearMatches = year === null || candidateYear === year;
    const id = parsed.pathname.match(/\/(\d+)\/scheda\/?$/)?.[1] || null;
    seen.add(parsed.pathname);
    candidates.push({
      title: candidateTitle,
      year: candidateYear,
      id,
      detailUrl: parsed.href,
      streamingUrl: parsed.href.replace(/\/scheda\/?$/i, "/streaming/"),
      exactTitle,
      yearMatches,
      match: exactTitle && yearMatches
    });
  }
  return candidates;
}

async function testComingSoonSearch(url) {
  const title = (url.searchParams.get("title") || "").trim();
  const type = (url.searchParams.get("type") || "film").toLowerCase();
  const yearText = url.searchParams.get("year");
  const year = yearText ? Number(yearText) : null;
  if (!title || title.length > 180 || !["film", "serietv"].includes(type) ||
      (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100))) {
    return { httpStatus: 400, body: {
      status: "invalid_request",
      usage: "/test-comingsoon-search?title=Una%20notte%20da%20leoni&year=2009&type=film",
      supportedTypes: ["film"]
    }};
  }
  if (type !== "film") {
    return { httpStatus: 400, body: {
      status: "unsupported_type",
      provider: "ComingSoon Native Search",
      message: "La ricerca nativa per serie TV non è stata ancora verificata."
    }};
  }

  const searchPage = new URL("/film/", CS_BASE);
  searchPage.searchParams.set("titolo", title);
  const diagnostic = {
    status: "error",
    provider: "ComingSoon Native Film Search",
    title, year, type,
    searchPageUrl: searchPage.href,
    searchPageHttp: null,
    resultCount: 0,
    candidates: [],
    selected: null,
    message: null
  };
  try {
    const page = await fetchHtml(searchPage.href);
    diagnostic.searchPageHttp = page.http;
    diagnostic.resultCount = Number(page.html.match(/data-count=["'](\d+)["']/i)?.[1] || 0);
    diagnostic.candidates = extractNativeFilmCandidates(page.html, title, year);
    diagnostic.selected = diagnostic.candidates.find(item => item.match) || null;
    diagnostic.status = diagnostic.selected ? "found_exact" : "no_exact_match";
    diagnostic.message = diagnostic.selected
      ? "Scheda individuata; URL streaming candidato da verificare."
      : "Nessuna corrispondenza esatta nel primo elenco; nessuna scheda selezionata.";
    return { httpStatus: 200, body: diagnostic };
  } catch (error) {
    diagnostic.message = "Ricerca nativa ComingSoon non riuscita: " + String(error?.message || error);
    return { httpStatus: 502, body: diagnostic };
  }
}

// ==========================================================
// COMINGSOON - METADATI E DIAGNOSTICA SERIE TV
// Nessun trailer ComingSoon viene acquisito.
// ==========================================================

function csMetaContent(html, key, value) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((getAttr(match[0], key) || "").toLowerCase() === value.toLowerCase()) {
      return getAttr(match[0], "content") || null;
    }
  }
  return null;
}

function csJsonLd(html) {
  const items = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const walk = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (value["@graph"]) walk(value["@graph"]);
        items.push(value);
      };
      walk(parsed);
    } catch {}
  }
  return items;
}

function csMetadata(html, kind) {
  const types = kind === "film" ? ["Movie"] : ["TVSeries", "TVShow", "Series"];
  const item = csJsonLd(html).find(x =>
    types.some(type => [x["@type"]].flat().includes(type))
  ) || {};
  const description = cleanText(item.description ||
    csMetaContent(html, "name", "description") ||
    csMetaContent(html, "property", "og:description") || "");
  const rawImage = typeof item.image === "string" ? item.image :
    (item.image?.url || csMetaContent(html, "property", "og:image"));
  let image = null;
  try {
    if (rawImage) {
      const u = new URL(rawImage, CS_BASE);
      if (u.protocol === "https:") image = u.href;
    }
  } catch {}
  const genres = Array.isArray(item.genre) ? item.genre :
    (typeof item.genre === "string" ? [item.genre] : []);
  const seasons = Number(item.numberOfSeasons);
  return {
    title: cleanText(item.name || csMetaContent(html, "property", "og:title") || "") || null,
    description: description || null,
    image,
    genres,
    numberOfSeasons: Number.isInteger(seasons) && seasons > 0 ? seasons : null,
    metadataSource: Object.keys(item).length ? "jsonld" : "meta",
    trailer: null
  };
}

function csSeriesCandidates(html, title, year) {
  const candidates = [];
  // La pagina contiene anche suggerimenti nella sidebar: isoliamo le card
  // dei risultati, prima della paginazione della ricerca.
  const resultStart = html.indexOf('class="row mtl mbl"');
  const pagination = html.indexOf('<ul class="pagination serie-tv', resultStart);
  if (resultStart < 0 || pagination < 0) return candidates;
  const resultsHtml = html.slice(resultStart, pagination);
  const cards = /<a\b([^>]*\bclass=["'][^"']*\bcards\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  for (const match of resultsHtml.matchAll(cards)) {
    const href = getAttr("<a " + match[1] + ">", "href");
    let parsed;
    try { parsed = new URL(href, CS_BASE); } catch { continue; }
    if (parsed.hostname !== "www.comingsoon.it" ||
      !/^\/serietv\/[^/]+\/\d+\/scheda\/?$/i.test(parsed.pathname) ||
      seen.has(parsed.pathname)) continue;
    seen.add(parsed.pathname);
    const fragment = match[2];
    const titleMatch = fragment.match(/<div\b[^>]*class=["'][^"']*\btitolo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const originalMatch = fragment.match(/<div\b[^>]*class=["'][^"']*\bdescrizione\b[^"']*["'][^>]*>\s*\(\s*([\s\S]*?)\s*\)\s*<\/div>/i);
    const yearMatch = fragment.match(/<b>\s*Anno:\s*<\/b>\s*<span>\s*(\d{4})\s*<\/span>/i);
    const label = titleMatch ? cleanText(titleMatch[1]) : "";
    const originalTitle = originalMatch ? cleanText(originalMatch[1]) : null;
    const foundYear = yearMatch ? Number(yearMatch[1]) : null;
    const exactTitle = normalize(label) === normalize(title) ||
      (originalTitle && normalize(originalTitle) === normalize(title));
    const yearMatches = year === null || foundYear === year;
    candidates.push({
      title: label || null, originalTitle, year: foundYear,
      id: parsed.pathname.match(/\/(\d+)\/scheda\/?$/)?.[1] || null,
      detailUrl: parsed.href,
      streamingUrl: parsed.href.replace(/\/scheda\/?$/i, "/streaming/"),
      exactTitle: Boolean(exactTitle), yearMatches,
      match: Boolean(exactTitle && yearMatches)
    });
  }
  return candidates;
}

async function testComingSoonDetails(url) {
  const kind = (url.searchParams.get("type") || "film").toLowerCase();
  const raw = url.searchParams.get("url");
  if (!["film", "serietv"].includes(kind) || !raw) {
    return { httpStatus: 400, body: {status:"invalid_request",
      usage:"/test-comingsoon-details?type=film&url=https%3A%2F%2Fwww.comingsoon.it%2Ffilm%2Funa-notte-da-leoni%2F47321%2Fscheda%2F"} };
  }
  let target;
  try {
    target = new URL(raw);
    const prefix = kind === "film" ? "film" : "serietv";
    if (target.protocol !== "https:" || target.hostname !== "www.comingsoon.it" ||
      !new RegExp("^/" + prefix + "/[^/]+/\\d+/scheda/?$", "i").test(target.pathname) ||
      target.search || target.hash) throw Error("Invalid target");
  } catch {
    return {httpStatus:400,body:{status:"invalid_url",message:"Solo URL scheda ComingSoon del tipo selezionato."}};
  }
  const page = await fetchHtml(target.href);
  const streamingUrl = target.href.replace(/\/scheda\/?$/i, "/streaming/");
  const response = {status:"ok",provider:"ComingSoon",kind,
    detailUrl:target.href,detailHttp:page.http,streamingUrl,
    metadata:csMetadata(page.html,kind),streamingHttp:null,nowOffers:[],platforms:[],streamingError:null};
  try {
    const streaming = await fetchHtml(streamingUrl);
    response.streamingHttp = streaming.http;
    response.nowOffers = extractNowLinks(streaming.html).offers;
    response.platforms = extractStreamingPlatforms(streaming.html);
  } catch(e) {
    response.streamingError = String(e?.message || e);
  }
  return {httpStatus:200,body:response};
}

async function testComingSoonSeriesSearch(url) {
  const title = (url.searchParams.get("title") || "").trim();
  const yearText = url.searchParams.get("year");
  const year = yearText ? Number(yearText) : null;
  if (!title || title.length > 180 ||
    (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100))) {
    return {httpStatus:400,body:{status:"invalid_request",
      usage:"/test-comingsoon-series-search?title=Breaking%20Bad&year=2008"}};
  }
  const search = new URL("/serietv/ricerca/", CS_BASE);
  search.searchParams.set("titolo", title);
  if (year !== null) search.searchParams.set("anno", String(year));
  const page = await fetchHtml(search.href);
  const candidates = csSeriesCandidates(page.html,title,year);
  const resultCount = Number(page.html.match(/data-count=["\'](\d+)["\']/i)?.[1] || 0);
  const selected = candidates.find(x => x.match) || null;
  return {httpStatus:200,body:{
    status:selected ? "found_exact" : "unverified_search",
    provider:"ComingSoon Native Series Search (diagnostic)",
    title,year,searchPageUrl:search.href,searchPageHttp:page.http,
    htmlLength:page.html.length,resultCount,candidates,selected,
    message:selected ? "Corrispondenza esatta trovata; verificare la scheda." :
      "Parametri o struttura HTML della ricerca serie da verificare. Nessuna associazione automatica."
  }};
}


function csapiNormalizePlatforms(platforms) {
  const names = {"apple itunes":"Apple TV Store","amazon prime video":"Prime Video","timvision":"TIMVISION"};
  return platforms.map(p => {
    const name = names[normalize(p.name)] || p.name;
    const offers = p.offers.map(o => {
      let url = o.url;
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "primevideo-eu.pxf.io") {
          const direct = parsed.searchParams.get("u");
          if (direct) {
            const target = new URL(direct);
            if (target.protocol === "https:" && /(^|\.)primevideo\.com$/.test(target.hostname)) url = target.href;
          }
        }
      } catch {}
      return {type:o.type,section:o.section,label:o.label,url};
    });
    return {name,code:normalize(name).replace(/ /g,"_"),logo:p.logo,offers:[...new Map(offers.map(o=>[o.type+"|"+o.url,o])).values()]};
  });
}

async function csapiSearch(url) {
  const title = (url.searchParams.get("title") || "").trim();
  const type = (url.searchParams.get("type") || "film").toLowerCase();
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  if (!title || title.length > 180 || !["film","serietv"].includes(type) ||
      (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100))) {
    return {httpStatus:400,body:{status:"invalid_request",provider:"CSAPI",
      usage:"/api/search?title=Interstellar&year=2014&type=film"}};
  }
  const search = new URL(type === "film" ? "/film/" : "/serietv/ricerca/",CS_BASE);
  search.searchParams.set("titolo",title);
  if (type === "serietv" && year !== null) search.searchParams.set("anno",String(year));
  const page = await fetchHtml(search.href);
  const candidates = type === "film"
    ? extractNativeFilmCandidates(page.html,title,year)
    : csSeriesCandidates(page.html,title,year);
  const selected = candidates.find(c=>c.match);
  if (!selected) return {httpStatus:200,body:{status:"not_found",provider:"CSAPI",
    title,year,type,platforms:[],message:"Nessuna corrispondenza esatta di titolo e anno."}};
  const detail = await testComingSoonDetails(new URL("https://csapi.invalid/test-comingsoon-details?type="+type+"&url="+encodeURIComponent(selected.detailUrl)));
  const data = detail.body;
  if (data.streamingError) return {httpStatus:502,body:{status:"upstream_error",provider:"CSAPI",
    title,year,type,detailUrl:selected.detailUrl,message:data.streamingError}};
  const metadata = {...data.metadata};
  if (metadata.image && metadata.image.includes(",")) metadata.image = metadata.image.split(",")[0].trim();
  return {httpStatus:200,body:{status:"found_exact",provider:"CSAPI",title,year,type,
    matchedTitle:selected.title,matchedYear:selected.year,detailUrl:selected.detailUrl,
    metadata,platforms:csapiNormalizePlatforms(data.platforms)}};
}

// ==========================================================
// ROUTER PRINCIPALE
// ==========================================================

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {

      if (path === "/api/search") {
        const result = await csapiSearch(url);
        return json(result.body, result.httpStatus);
      }

      if (path === "/api/details") {
        const result = await testComingSoonDetails(url);
        if (result.httpStatus !== 200) return json(result.body,result.httpStatus);
        const data = result.body;
        const metadata = {...data.metadata};
        if (metadata.image && metadata.image.includes(",")) metadata.image = metadata.image.split(",")[0].trim();
        return json({status:data.streamingError ? "upstream_error":"ok",provider:"CSAPI",type:data.kind,detailUrl:data.detailUrl,metadata,
          platforms:csapiNormalizePlatforms(data.platforms),error:data.streamingError},data.streamingError ? 502 : 200);
      }

      if (path === "/test-comingsoon-details") {
        const result = await testComingSoonDetails(url);
        return json(result.body, result.httpStatus);
      }

      if (path === "/test-comingsoon-series-search") {
        const result = await testComingSoonSeriesSearch(url);
        return json(result.body, result.httpStatus);
      }

      // TEST RICERCA NATIVA COMINGSOON (FILM)
      if (path === "/test-comingsoon-search") {
        const result = await testComingSoonSearch(url);
        return json(result.body, result.httpStatus);
      }

      // --------------------------------------------------
      // TEST COLLEZIONE UFFICIALE NOW
      // --------------------------------------------------

      if (path === "/test-now-collection") {
        return json(await testNowCollection());
      }

      // --------------------------------------------------
      // TEST LINK SINGOLO
      // --------------------------------------------------

      if (path === "/test-comingsoon-link") {
        return json(await testComingSoonLink());
      }

      // --------------------------------------------------
      // TEST ACCESSO CATALOGO COMINGSOON
      // --------------------------------------------------

      if (path === "/test-comingsoon") {
        const target =
          CS_BASE +
          "/film/streaming/nowtv/?page=2";

        const {
          html,
          http,
          finalUrl
        } = await fetchHtml(target);

        return json({
          status: "ok",
          provider: "ComingSoon",
          http,
          finalUrl,
          htmlLength: html.length,
          extractedFilms: extractCatalogCards(
            html,
            "film"
          ).length
        });
      }

      // --------------------------------------------------
      // TEST BATCH FILM
      // --------------------------------------------------

      if (path === "/test-comingsoon-batch") {
        return json(
          await scanComingSoonPage("film", 2)
        );
      }

      // --------------------------------------------------
      // TEST FILM PER PAGINA
      // --------------------------------------------------

      if (path === "/test-comingsoon-films") {
        const raw = url.searchParams.get("page") || "1";
        const page = Number(raw);

        if (
          !Number.isInteger(page) ||
          page < 1 ||
          page > 90
        ) {
          return json({
            status: "invalid_page",
            message: "Pagina valida: da 1 a 90"
          }, 400);
        }

        return json(
          await scanComingSoonPage("film", page)
        );
      }

      // --------------------------------------------------
      // TEST SERIE TV PER PAGINA
      // --------------------------------------------------

      if (path === "/test-comingsoon-series") {
        const raw = url.searchParams.get("page") || "1";
        const page = Number(raw);

        if (
          !Number.isInteger(page) ||
          page < 1 ||
          page > 100
        ) {
          return json({
            status: "invalid_page",
            message: "Pagina valida: da 1 a 100"
          }, 400);
        }

        return json(
          await scanComingSoonPage("serietv", page)
        );
      }

      return json({status:"ready",provider:"CSAPI",version:VERSION,
        search:"/api/search?title=Interstellar&year=2014&type=film",
        details:"/api/details?type=film&url=https%3A%2F%2Fwww.comingsoon.it%2Ffilm%2Finterstellar%2F49750%2Fscheda%2F",
        legacyDiagnostics:true},path === "/" ? 200 : 404);

    } catch (error) {
      return json({
        status: "error",
        provider: "CSAPI",
        message: String(
          error?.message || error
        )
      }, 502);
    }
  }
};






