// CSAPI — ComingSoon streaming availability for Italian film and TV titles.
const CS_BASE = "https://www.comingsoon.it";
const VERSION = "5.1";
const TIMEOUT = 12000;
const HTML_HEADERS = {Accept:"text/html","Accept-Language":"it-IT,it;q=0.9"};
const OFFER_MODES = {
  gratis:{type:"free",section:"stream"},
  abbonamento:{type:"subscription",section:"stream"},
  noleggio:{type:"rent",section:"rent"},
  acquisto:{type:"buy",section:"buy"}
};

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

async function csapiDetails(url) {
  const kind = (url.searchParams.get("type") || "film").toLowerCase();
  const raw = url.searchParams.get("url");
  if (!["film", "serietv"].includes(kind) || !raw) {
    return { httpStatus: 400, body: {status:"invalid_request",
      usage:"/api/details?type=film&url=https%3A%2F%2Fwww.comingsoon.it%2Ffilm%2Funa-notte-da-leoni%2F47321%2Fscheda%2F"} };
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
  const response = {status:"ok",provider:"CSAPI",kind,
    detailUrl:target.href,detailHttp:page.http,streamingUrl,
    metadata:csMetadata(page.html,kind),streamingHttp:null,platforms:[],streamingError:null};
  try {
    const streaming = await fetchHtml(streamingUrl);
    response.streamingHttp = streaming.http;
    response.platforms = extractStreamingPlatforms(streaming.html);
  } catch(e) {
    response.streamingError = String(e?.message || e);
  }
  return {httpStatus:200,body:response};
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
  const detail = await csapiDetails(new URL("https://csapi.invalid/api/details?type="+type+"&url="+encodeURIComponent(selected.detailUrl)));
  const data = detail.body;
  if (data.streamingError) return {httpStatus:502,body:{status:"upstream_error",provider:"CSAPI",
    title,year,type,detailUrl:selected.detailUrl,message:data.streamingError}};
  const metadata = {...data.metadata};
  if (metadata.image && metadata.image.includes(",")) metadata.image = metadata.image.split(",")[0].trim();
  return {httpStatus:200,body:{status:"found_exact",provider:"CSAPI",title,year,type,
    matchedTitle:selected.title,matchedYear:selected.year,detailUrl:selected.detailUrl,
    metadata,platforms:csapiNormalizePlatforms(data.platforms)}};
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect("https://tvstasera.online/", 302);
    try {
      if (url.pathname === "/api/search") {
        const result = await csapiSearch(url);
        return json(result.body,result.httpStatus);
      }
      if (url.pathname === "/api/details") {
        const result = await csapiDetails(url);
        if (result.httpStatus !== 200) return json(result.body,result.httpStatus);
        const data = result.body;
        const metadata = {...data.metadata};
        if (metadata.image && metadata.image.includes(",")) metadata.image = metadata.image.split(",")[0].trim();
        return json({status:data.streamingError ? "upstream_error":"ok",provider:"CSAPI",
          type:data.kind,detailUrl:data.detailUrl,metadata,
          platforms:csapiNormalizePlatforms(data.platforms),error:data.streamingError},
          data.streamingError ? 502 : 200);
      }
      return json({status:"ready",provider:"CSAPI",version:VERSION,
        search:"/api/search?title=Interstellar&year=2014&type=film",
        details:"/api/details?type=film&url=https%3A%2F%2Fwww.comingsoon.it%2Ffilm%2Finterstellar%2F49750%2Fscheda%2F"},url.pathname === "/" ? 200 : 404);
    } catch(error) {
      return json({status:"error",provider:"CSAPI",message:String(error?.message || error)},502);
    }
  }
};
