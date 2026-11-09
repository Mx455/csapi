const NOW_BASE = "https://www.nowtv.it";
const CS_BASE = "https://www.comingsoon.it";

const VERSION = "4.2";
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
// ROUTER PRINCIPALE
// ==========================================================

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {

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

      // --------------------------------------------------
      // CATALOGO UFFICIALE NOW
      // --------------------------------------------------

      const title = url.searchParams
        .get("title")
        ?.trim();

      if (!title && path !== "/stats") {
        return json({
          status: "ready",
          version: VERSION,
          provider: "NOW",
          usage: "/?title=Chicago%20P.D.",
          stats: "/stats",
          testNow: "/test-now-collection",
          testComingSoon: "/test-comingsoon",
          testLink: "/test-comingsoon-link",
          testBatch: "/test-comingsoon-batch",
          testFilms: "/test-comingsoon-films?page=2",
          testSeries: "/test-comingsoon-series?page=1"
        });
      }

      const {
        catalog,
        cacheStatus
      } = await getNowCatalog(request);

      // --------------------------------------------------
      // STATISTICHE
      // --------------------------------------------------

      if (path === "/stats") {
        return json({
          status: "ok",
          provider: "NOW",
          cache: cacheStatus,
          updatedAt: catalog.updatedAt,
          ...catalog.stats
        });
      }

      // --------------------------------------------------
      // RICERCA TITOLO UFFICIALE NOW
      // --------------------------------------------------

      const query = normalize(title);

      const matches = catalog.items.filter(
        item =>
          item.normalizedTitle === query &&
          isActive(item)
      );

      return json({
        status: matches.length
          ? "found_exact"
          : "not_found",
        provider: "NOW",
        query: title,
        catalogCount: catalog.count,
        cache: cacheStatus,
        updatedAt: catalog.updatedAt,
        matches: matches.map(item => ({
          title: item.title,
          type: item.type,
          url: item.url,
          contentId: item.contentId,
          source: item.source
        }))
      });

    } catch (error) {
      return json({
        status: "error",
        provider: "NOW API Test v4.2",
        message: String(
          error?.message || error
        )
      }, 502);
    }
  }
};






