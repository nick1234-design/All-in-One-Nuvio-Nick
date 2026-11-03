/**
 * hdhub4u - fixed build (domain pinned: https://new10.hdhub4u.cl)
 */
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/**
 * hdhub4u provider (fixed build)
 * Domain pinned to https://new10.hdhub4u.cl (auto-fallback only if it is down)
 */
const cheerio = require("cheerio-without-node-native");
const CryptoJS = require("crypto-js");
// ───────────────────────── constants ─────────────────────────
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// PINNED domain. The remote domains.json is only used if this one is unreachable.
let MAIN_URL = "https://new10.hdhub4u.cl";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const DOMAIN_CACHE_TTL = 30 * 60 * 1000;
// Typesense search hosts used by the site's own search box (tried in order)
const SEARCH_HOSTS = ["https://search.hdhub4u.glass", "https://search.pingora.fyi"];
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    Cookie: "xla=s4t",
    Referer: `${MAIN_URL}/`
};
function updateMainUrl(url) {
    MAIN_URL = url.replace(/\/+$/, "");
    HEADERS.Referer = `${MAIN_URL}/`;
}
// Hosts that only serve an obfuscated redirect page (rotate often)
const REDIRECT_HOSTS = ["techyboy4u", "gadgetsweb", "cryptoinsights", "bloggingvector", "ampproject.org"];
// ───────────────────────── helpers ─────────────────────────
function fetchT(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, options = {}, timeoutMs = 20000) {
        if (typeof AbortController === "undefined")
            return fetch(url, options);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return yield fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
        }
        finally {
            clearTimeout(timer);
        }
    });
}
function formatBytes(bytes) {
    if (!bytes || bytes === 0)
        return "Unknown";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function extractServerName(source) {
    if (!source)
        return "Unknown";
    if (source.startsWith("HubCloud")) {
        const m = source.match(/HubCloud(?:\s*-\s*([^[\]]+))?/);
        return m ? (m[1] || "Download").trim() : "HubCloud";
    }
    if (source.startsWith("Pixeldrain"))
        return "Pixeldrain";
    if (source.startsWith("StreamTape"))
        return "StreamTape";
    if (source.startsWith("HubCdn"))
        return "HubCdn";
    if (source.startsWith("HbLinks"))
        return "HbLinks";
    if (source.startsWith("Vidstack") || source.startsWith("Hubstream"))
        return "Hubstream";
    return source.replace(/^www\./, "").split(/[.\s]/)[0];
}
function rot13(value) {
    return value.replace(/[a-zA-Z]/g, (c) => {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function atob(value) {
    if (!value)
        return "";
    const input = String(value).replace(/=+$/, "");
    let output = "";
    let bc = 0, bs, buffer, idx = 0;
    while ((buffer = input.charAt(idx++))) {
        buffer = BASE64_CHARS.indexOf(buffer);
        if (~buffer) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4)
                output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
        }
    }
    return output;
}
function cleanTitle(title) {
    const name = title.replace(/\.[a-zA-Z0-9]{2,4}$/, "");
    const normalized = name
        .replace(/WEB[-_. ]?DL/gi, "WEB-DL")
        .replace(/WEB[-_. ]?RIP/gi, "WEBRIP")
        .replace(/H[ .]?265/gi, "H265")
        .replace(/H[ .]?264/gi, "H264")
        .replace(/DDP[ .]?([0-9]\.[0-9])/gi, "DDP$1");
    const parts = normalized.split(/[\s_.]/);
    const sourceTags = new Set(["WEB-DL", "WEBRIP", "BLURAY", "HDRIP", "DVDRIP", "HDTV", "CAM", "TS", "BRRIP", "BDRIP"]);
    const codecTags = new Set(["H264", "H265", "X264", "X265", "HEVC", "AVC"]);
    const audioTags = ["AAC", "AC3", "DTS", "MP3", "FLAC", "DD", "DDP", "EAC3"];
    const audioExtras = new Set(["ATMOS"]);
    const hdrTags = new Set(["SDR", "HDR", "HDR10", "HDR10+", "DV", "DOLBYVISION"]);
    const filtered = parts
        .map((part) => {
        const p = part.toUpperCase();
        if (sourceTags.has(p))
            return p;
        if (codecTags.has(p))
            return p;
        if (audioTags.some((tag) => p.startsWith(tag)))
            return p;
        if (audioExtras.has(p))
            return p;
        if (hdrTags.has(p))
            return p === "DOLBYVISION" || p === "DV" ? "DOLBYVISION" : p;
        if (p === "NF" || p === "CR")
            return p;
        return null;
    })
        .filter(Boolean);
    return [...new Set(filtered)].join(" ");
}
// ───────────────────────── domain handling ─────────────────────────
let domainCheckedAt = 0;
function isAlive(base) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetchT(`${base}/`, { headers: HEADERS }, 8000);
            return res.status < 500 && res.status !== 404;
        }
        catch (e) {
            return false;
        }
    });
}
// Keeps the pinned domain unless it is actually down; only then consults domains.json.
function getCurrentDomain() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = Date.now();
        if (now - domainCheckedAt < DOMAIN_CACHE_TTL)
            return MAIN_URL;
        domainCheckedAt = now;
        if (yield isAlive(MAIN_URL))
            return MAIN_URL;
        console.log(`[HDHub4u] ${MAIN_URL} not reachable, checking domains.json...`);
        try {
            const res = yield fetchT(DOMAINS_URL, { headers: { "User-Agent": HEADERS["User-Agent"] } }, 8000);
            if (res.ok) {
                const data = yield res.json();
                const candidate = data && (data.HDHUB4u || data.hdhub4u || data.Hdhub4u);
                if (candidate && candidate.replace(/\/+$/, "") !== MAIN_URL && (yield isAlive(candidate))) {
                    console.log(`[HDHub4u] Switching domain to ${candidate}`);
                    updateMainUrl(candidate);
                }
            }
        }
        catch (e) {
            console.error(`[HDHub4u] domain fallback failed: ${e.message}`);
        }
        return MAIN_URL;
    });
}
// ───────────────────────── title matching ─────────────────────────
function normalizeTitle(title) {
    if (!title)
        return "";
    return title
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\b(the|a|an)\b/g, "")
        .replace(/[:\-_]/g, " ")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
// Site titles look like "Dune Part Two (2024) WEB-DL Hindi 480p 720p 1080p" - cut the release noise.
function stripReleaseNoise(title) {
    const idx = title.search(/[([{]|\b(?:19|20)\d{2}\b|\b(?:480p|720p|1080p|2160p|4k|web-?dl|webrip|blu-?ray|hdrip|hdtv|hdcam|dual audio|hindi|season)\b/i);
    return (idx > 0 ? title.slice(0, idx) : title).trim();
}
function calculateTitleSimilarity(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    if (norm1 === norm2)
        return 1;
    const words1 = norm1.split(/\s+/).filter(Boolean);
    const words2 = norm2.split(/\s+/).filter(Boolean);
    if (!words1.length || !words2.length)
        return 0;
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = words1.filter((w) => set2.has(w));
    const union = new Set([...words1, ...words2]);
    const jaccard = intersection.length / union.size;
    const extra = words2.filter((w) => !set1.has(w)).length;
    let score = jaccard - extra * 0.05;
    if (words1.every((w) => set2.has(w)))
        score += 0.2;
    return score;
}
function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
    if (!searchResults || !searchResults.length)
        return null;
    let best = null;
    let bestScore = 0;
    for (const result of searchResults) {
        const raw = result.title || "";
        let score = calculateTitleSimilarity(mediaInfo.title, stripReleaseNoise(raw));
        if (mediaInfo.year && result.year) {
            const diff = Math.abs(mediaInfo.year - result.year);
            if (diff === 0)
                score += 0.2;
            else if (diff <= 1)
                score += 0.1;
            else if (diff > 5)
                score -= 0.3;
        }
        if (mediaType === "tv" && season) {
            const lower = raw.toLowerCase();
            const m = lower.match(/\bseason\s*(\d+)|\bs(\d{1,2})\b/i);
            if (m) {
                const found = parseInt(m[1] || m[2], 10);
                if (found === season)
                    score += 0.5;
                else
                    score -= 0.8;
            }
            else {
                score -= 0.3;
            }
        }
        if (/2160p|4k/i.test(raw))
            score += 0.05;
        if (score > bestScore && score > 0.3) {
            bestScore = score;
            best = result;
        }
    }
    if (best)
        console.log(`[HDHub4u] Best title match: "${best.title}" (score: ${bestScore.toFixed(2)})`);
    return best;
}
function getTMDBDetails(tmdbId, mediaType) {
    return __awaiter(this, void 0, void 0, function* () {
        const endpoint = mediaType === "tv" ? "tv" : "movie";
        const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
        const response = yield fetchT(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
        if (!response.ok)
            throw new Error(`TMDB API error: ${response.status}`);
        const data = yield response.json();
        const title = mediaType === "tv" ? data.name : data.title;
        const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
        const year = releaseDate ? parseInt(releaseDate.split("-")[0], 10) : null;
        return { title, year, imdbId: (data.external_ids && data.external_ids.imdb_id) || null };
    });
}
// ───────────────────────── extractors ─────────────────────────
const KNOWN_HOST_HINTS = [
    "hubdrive", "hubcloud", "hubcdn", "hblinks", "hubstream", "hdstream4u", "pixeldrain", "streamtape"
];
function absUrl(href, base) {
    try {
        return new URL(href, base).toString();
    }
    catch (e) {
        return null;
    }
}
function getRedirectLinks(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, depth = 0) {
        try {
            if (depth > 3)
                return null;
            const response = yield fetchT(url, { headers: HEADERS });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const doc = yield response.text();
            const regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
            let combined = "";
            let match;
            while ((match = regex.exec(doc)) !== null) {
                const v = match[1] || match[2];
                if (v)
                    combined += v;
            }
            if (!combined) {
                const redirect = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
                if (redirect && redirect[1] && redirect[1] !== url) {
                    const next = absUrl(redirect[1], url);
                    if (next)
                        return yield getRedirectLinks(next, depth + 1);
                }
                return null;
            }
            const decoded = atob(rot13(atob(atob(combined))));
            const json = JSON.parse(decoded);
            const encodedUrl = atob(json.o || "").trim();
            if (encodedUrl)
                return encodedUrl;
            const data = atob(json.data || "").trim();
            const wpHttp = (json.blog_url || "").trim();
            if (wpHttp && data) {
                const r = yield fetchT(`${wpHttp}?re=${data}`, { headers: HEADERS });
                const html = yield r.text();
                const $ = cheerio.load(html);
                return ($("body").text() || html).trim();
            }
            return null;
        }
        catch (e) {
            return null;
        }
    });
}
function vidStackExtractor(url) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const hash = url.split("#").pop().split("/").pop().split("?").pop();
            const baseUrl = new URL(url).origin;
            const apiUrl = `${baseUrl}/api/v1/video?id=${hash}`;
            const response = yield fetchT(apiUrl, { headers: Object.assign({}, HEADERS, { Referer: url }) });
            const encoded = (yield response.text()).trim();
            const key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
            for (const ivStr of ["1234567890oiuytr", "0123456789abcdef"]) {
                try {
                    const iv = CryptoJS.enc.Utf8.parse(ivStr);
                    const decrypted = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Hex.parse(encoded) }, key, {
                        iv,
                        mode: CryptoJS.mode.CBC,
                        padding: CryptoJS.pad.Pkcs7
                    });
                    const text = decrypted.toString(CryptoJS.enc.Utf8);
                    if (text && text.includes("source")) {
                        const sm = text.match(/"source":"(.*?)"/);
                        const m3u8 = sm && sm[1] ? sm[1].replace(/\\/g, "") : null;
                        const subtitles = [];
                        const subSection = (text.match(/"subtitle":\{(.*?)\}/) || [])[1];
                        if (subSection) {
                            const pat = /"([^"]+)":\s*"([^"]+)"/g;
                            let sub;
                            while ((sub = pat.exec(subSection)) !== null) {
                                const subPath = sub[2].split("#")[0].replace(/\\/g, "");
                                if (subPath) {
                                    subtitles.push({ language: sub[1], url: subPath.startsWith("http") ? subPath : `${baseUrl}${subPath}` });
                                }
                            }
                        }
                        if (m3u8) {
                            return [
                                {
                                    source: "Vidstack Hubstream",
                                    quality: "M3U8",
                                    url: m3u8,
                                    headers: { Referer: `${baseUrl}/`, Origin: baseUrl },
                                    subtitles
                                }
                            ];
                        }
                    }
                }
                catch (e) {
                    /* try next IV */
                }
            }
            return [];
        }
        catch (e) {
            return [];
        }
    });
}
function hbLinksExtractor(url, depth) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetchT(url, { headers: Object.assign({}, HEADERS, { Referer: url }) });
            const data = yield response.text();
            const $ = cheerio.load(data);
            const links = [
                ...new Set($("h3 a, h4 a, h5 a, div.entry-content a, .entry-content p a")
                    .map((i, el) => $(el).attr("href"))
                    .get()
                    .filter((h) => h && h.startsWith("http")))
            ];
            const results = yield Promise.all(links.map((l) => loadExtractor(l, url, depth + 1)));
            return results.flat().map((link) => Object.assign({}, link, { source: `${link.source} Hblinks` }));
        }
        catch (e) {
            return [];
        }
    });
}
function pixelDrainExtractor(link) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const urlObj = new URL(link);
            const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
            const m = link.match(/(?:file|u)\/([A-Za-z0-9]+)/);
            const fileId = (m && m[1]) || link.split("/").pop().split("?")[0];
            if (!fileId)
                return [{ source: "Pixeldrain", quality: 0, url: link }];
            const finalUrl = link.includes("/api/file/") ? link : `${baseUrl}/api/file/${fileId}?download`;
            return [{ source: "Pixeldrain", quality: 0, url: finalUrl }];
        }
        catch (e) {
            return [{ source: "Pixeldrain", quality: 0, url: link }];
        }
    });
}
function streamTapeExtractor(link) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetchT(link, { headers: HEADERS });
            const data = yield res.text();
            let videoSrc = null;
            // Current layout: innerHTML = '//host/get_video?...&token=' + ('xxxTOKEN').substring(n)[.substring(m)]
            const exprMatch = data.match(/getElementById\(['"](?:robotlink|videolink|ideoolink)['"]\)\.innerHTML\s*=\s*(.*?);/);
            if (exprMatch) {
                const expr = exprMatch[1];
                const m = expr.match(/['"]([^'"]*get_video[^'"]*)['"]\s*\+\s*\(\s*['"]([^'"]*)['"]\s*\)/);
                if (m) {
                    let offset = 0;
                    const subRe = /\.substring\((\d+)\)/g;
                    let s;
                    while ((s = subRe.exec(expr)) !== null)
                        offset += parseInt(s[1], 10);
                    videoSrc = m[1] + m[2].substring(offset);
                }
            }
            if (!videoSrc) {
                const simple = data.match(/'(\/\/[^']*get_video[^']+)'/);
                if (simple)
                    videoSrc = simple[1];
            }
            if (!videoSrc)
                return [];
            if (videoSrc.startsWith("//"))
                videoSrc = "https:" + videoSrc;
            return [{ source: "StreamTape", quality: 720, url: videoSrc, headers: { Referer: `${new URL(link).origin}/` } }];
        }
        catch (e) {
            return [];
        }
    });
}
// Follows up to 3 redirects manually and returns the value after "link=" (10Gbps links)
function resolveTenGbps(link) {
    return __awaiter(this, void 0, void 0, function* () {
        let current = link;
        try {
            for (let i = 0; i < 3; i++) {
                const resp = yield fetchT(current, { method: "GET", redirect: "manual", headers: HEADERS }, 10000);
                const loc = resp.headers && resp.headers.get && resp.headers.get("location");
                if (!loc)
                    break;
                if (loc.includes("link="))
                    return loc.substring(loc.indexOf("link=") + 5);
                current = absUrl(loc, current) || current;
            }
        }
        catch (e) {
            /* manual redirects unsupported on this runtime */
        }
        try {
            const resp = yield fetchT(link, { method: "GET", headers: HEADERS }, 10000);
            if (resp.url && resp.url.includes("link="))
                return resp.url.substring(resp.url.indexOf("link=") + 5);
        }
        catch (e) {
            /* ignore */
        }
        return link;
    });
}
function hubCloudExtractor(url, referer, depth) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // try the URL as given; only if it fails try the legacy alias
            let currentUrl = url;
            let pageData = "";
            const candidates = [url];
            if (url.includes("hubcloud.ink"))
                candidates.push(url.replace("hubcloud.ink", "hubcloud.dad"));
            for (const candidate of candidates) {
                try {
                    const r = yield fetchT(candidate, { headers: Object.assign({}, HEADERS, { Referer: referer }) });
                    if (r.ok) {
                        pageData = yield r.text();
                        currentUrl = candidate;
                        if (pageData)
                            break;
                    }
                }
                catch (e) {
                    /* try next */
                }
            }
            if (!pageData)
                return [];
            let finalUrl = currentUrl;
            if (!currentUrl.includes("hubcloud.php")) {
                let nextHref = "";
                const $first = cheerio.load(pageData);
                const downloadBtn = $first("#download");
                if (downloadBtn.length) {
                    nextHref = downloadBtn.attr("href");
                }
                else {
                    const m = pageData.match(/var url = '([^']*)'/);
                    if (m)
                        nextHref = m[1];
                }
                if (nextHref) {
                    finalUrl = absUrl(nextHref, currentUrl) || nextHref;
                    const second = yield fetchT(finalUrl, { headers: Object.assign({}, HEADERS, { Referer: currentUrl }) });
                    pageData = yield second.text();
                }
            }
            const $ = cheerio.load(pageData);
            const size = $("i#size").text().trim();
            const header = $("div.card-header").text().trim();
            const qm = header.match(/(\d{3,4})[pP]/);
            const quality = qm ? parseInt(qm[1], 10) : 1080;
            const headerDetails = cleanTitle(header);
            const labelExtras = (headerDetails ? `[${headerDetails}]` : "") + (size ? `[${size}]` : "");
            const sizeInBytes = (() => {
                const sm = size.match(/([\d.]+)\s*(GB|MB|KB)/i);
                if (!sm)
                    return 0;
                const mult = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 };
                return parseFloat(sm[1]) * (mult[sm[2].toUpperCase()] || 0);
            })();
            const links = [];
            const elements = $("a.btn, a[class*='btn-']").get();
            for (const element of elements) {
                const link = $(element).attr("href");
                if (!link || link.startsWith("#") || link.startsWith("javascript") || link.includes("magnet:"))
                    continue;
                const text = $(element).text().toLowerCase();
                const fileName = header || headerDetails || "Unknown";
                if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") ||
                    text.includes("fslv2") || text.includes("mega server") || link.includes("r2.dev")) {
                    let label = "HubCloud";
                    if (link.includes("r2.dev"))
                        label = "Direct R2";
                    else if (link.includes("workers.dev"))
                        label = "ZipDisk Server";
                    else if (text.includes("fsl server"))
                        label = "HubCloud - FSL";
                    else if (text.includes("s3 server"))
                        label = "HubCloud - S3";
                    else if (text.includes("fslv2"))
                        label = "HubCloud - FSLv2";
                    else if (text.includes("mega server"))
                        label = "HubCloud - Mega";
                    links.push({ source: `${label} ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                }
                else if (text.includes("buzzserver")) {
                    try {
                        const buzz = yield fetchT(`${link}/download`, {
                            method: "GET",
                            headers: Object.assign({}, HEADERS, { Referer: link }),
                            redirect: "manual"
                        });
                        let dlink = buzz.headers.get("hx-redirect") || buzz.headers.get("HX-Redirect");
                        if (!dlink && buzz.url && buzz.url !== `${link}/download`)
                            dlink = buzz.url;
                        if (dlink) {
                            links.push({ source: `HubCloud - BuzzServer ${labelExtras}`, quality, url: dlink, size: sizeInBytes, fileName });
                        }
                    }
                    catch (e) {
                        /* skip */
                    }
                }
                else if (text.includes("10gbps") || link.includes("hubcloud.cx")) {
                    const target = link.includes("hubcloud.cx") ? link : yield resolveTenGbps(link);
                    links.push({ source: `HubCloud - 10Gbps ${labelExtras}`, quality, url: target, size: sizeInBytes, fileName });
                }
                else if (text.includes("zipdisk") || link.includes("workers.dev")) {
                    links.push({ source: `ZipDisk Server ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
                }
                else if (link.includes("pixeldra")) {
                    const results = yield pixelDrainExtractor(link);
                    links.push(...results.map((l) => Object.assign({}, l, { source: `${l.source} ${labelExtras}`, size: sizeInBytes, fileName })));
                }
                else if (link.startsWith("http")) {
                    const extracted = yield loadExtractor(link, finalUrl, depth + 1);
                    links.push(...extracted.map((l) => Object.assign({}, l, { quality: l.quality || quality })));
                }
            }
            return links;
        }
        catch (e) {
            return [];
        }
    });
}
function hubCdnExtractor(url, referer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetchT(url, { headers: Object.assign({}, HEADERS, { Referer: referer }) });
            const data = yield response.text();
            const $ = cheerio.load(data);
            let scriptContent = "";
            $("script").each((i, el) => {
                const html = $(el).html();
                if (html && html.includes("reurl"))
                    scriptContent = html;
            });
            const fromReurl = (val) => {
                if (val.includes("?r=")) {
                    try {
                        const decoded = atob(val.split("?r=").pop());
                        const l = decoded.substring(decoded.lastIndexOf("link=") + 5);
                        if (l.startsWith("http"))
                            return l;
                    }
                    catch (e) {
                        /* fall through */
                    }
                }
                else if (val.includes("link=")) {
                    const l = val.split("link=").pop();
                    if (l.startsWith("http"))
                        return l;
                }
                else if (val.startsWith("http")) {
                    return val;
                }
                return null;
            };
            if (scriptContent) {
                const m = scriptContent.match(/reurl\s*=\s*["']([^"']+)["']/);
                if (m && m[1]) {
                    const l = fromReurl(m[1]);
                    if (l)
                        return [{ source: "HubCdn", quality: 1080, url: l }];
                }
            }
            const enc = data.match(/[?&]r=([A-Za-z0-9+/=]+)/);
            if (enc && enc[1]) {
                const l = fromReurl(`?r=${enc[1]}`);
                if (l)
                    return [{ source: "HubCdn", quality: 1080, url: l }];
            }
            return [];
        }
        catch (e) {
            return [];
        }
    });
}
function hubDriveExtractor(url, referer, depth) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetchT(url, { headers: Object.assign({}, HEADERS, { Referer: referer }) });
            const data = yield res.text();
            const $ = cheerio.load(data);
            let href = $(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href") ||
                $("a.btn-success1").attr("href") ||
                $("a[href*='hubcloud']").attr("href") ||
                $("a[href*='hubcdn']").attr("href");
            if (href) {
                href = absUrl(href, url) || href;
                return yield loadExtractor(href, url, depth + 1);
            }
            return [];
        }
        catch (e) {
            return [];
        }
    });
}
function loadExtractor(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, referer = MAIN_URL, depth = 0) {
        try {
            if (!url || depth > 4)
                return [];
            const hostname = new URL(url).hostname.toLowerCase();
            if (hostname.includes("hubcloud"))
                return yield hubCloudExtractor(url, referer, depth);
            if (hostname.includes("hubcdn"))
                return yield hubCdnExtractor(url, referer);
            if (hostname.includes("hubdrive"))
                return yield hubDriveExtractor(url, referer, depth);
            if (hostname.includes("hblinks"))
                return yield hbLinksExtractor(url, depth);
            if (hostname.includes("hubstream") || hostname.includes("vidstack"))
                return yield vidStackExtractor(url);
            if (hostname.includes("pixeldra"))
                return yield pixelDrainExtractor(url);
            if (hostname.includes("streamtape") || hostname.includes("strtape") || hostname.includes("shavetape")) {
                return yield streamTapeExtractor(url);
            }
            if (hostname.includes("hdstream4u"))
                return [{ source: "HdStream4u", quality: 1080, url }];
            // Anything else: try the obfuscated-redirect decoder (these redirector domains rotate constantly)
            const isRedirect = url.includes("?id=") || REDIRECT_HOSTS.some((h) => hostname.includes(h)) || depth === 0;
            if (isRedirect) {
                const finalLink = yield getRedirectLinks(url);
                if (finalLink && finalLink !== url && finalLink.startsWith("http"))
                    return yield loadExtractor(finalLink, url, depth + 1);
            }
            return [];
        }
        catch (e) {
            return [];
        }
    });
}
// ───────────────────────── search ─────────────────────────
function parseYear(title) {
    const m = title.match(/\((\d{4})\)|\b((?:19|20)\d{2})\b/);
    return m ? parseInt(m[1] || m[2], 10) : null;
}
function searchTypesense(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date().toISOString().split("T")[0];
        for (const host of SEARCH_HOSTS) {
            try {
                const url = `${host}/collections/post/documents/search?q=${encodeURIComponent(query)}` +
                    `&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15` +
                    `&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;
                const response = yield fetchT(url, { headers: Object.assign({}, HEADERS, { Origin: MAIN_URL, Referer: `${MAIN_URL}/` }) }, 12000);
                if (!response.ok)
                    continue;
                const data = yield response.json();
                if (!data || !Array.isArray(data.hits) || !data.hits.length)
                    continue;
                return data.hits
                    .map((hit) => {
                    const doc = hit.document || {};
                    const title = doc.post_title || "";
                    let link = doc.permalink || "";
                    if (link && !/^https?:/i.test(link))
                        link = `${MAIN_URL}${link.startsWith("/") ? "" : "/"}${link}`;
                    return { title, url: link, poster: doc.post_thumbnail, year: parseYear(title) };
                })
                    .filter((r) => r.title && r.url);
            }
            catch (e) {
                console.log(`[HDHub4u] search host ${host} failed: ${e.message}`);
            }
        }
        return [];
    });
}
function searchHtml(query) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetchT(`${MAIN_URL}/?s=${encodeURIComponent(query)}`, { headers: HEADERS }, 15000);
            if (!res.ok)
                return [];
            const $ = cheerio.load(yield res.text());
            const out = [];
            const seen = new Set();
            $("li.thumb, .recent-movies li, article, .post").each((i, el) => {
                const $el = $(el);
                const a = $el.find("a[href]").first();
                const href = a.attr("href");
                if (!href || seen.has(href))
                    return;
                const title = ($el.find("figcaption p, figcaption a, h2, h3, .entry-title").first().text() ||
                    a.attr("title") ||
                    $el.find("img").first().attr("alt") ||
                    "").trim();
                if (!title)
                    return;
                seen.add(href);
                out.push({ title, url: absUrl(href, MAIN_URL) || href, poster: $el.find("img").first().attr("src"), year: parseYear(title) });
            });
            return out;
        }
        catch (e) {
            return [];
        }
    });
}
function search(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const fromTypesense = yield searchTypesense(query);
        if (fromTypesense.length)
            return fromTypesense;
        console.log("[HDHub4u] Typesense search returned nothing, falling back to HTML search");
        return yield searchHtml(query);
    });
}
// ───────────────────────── page scraping ─────────────────────────
function isUsableHref(href) {
    return !!href && /^https?:/i.test(href) && !href.includes("magnet:");
}
function collectContentLinks($) {
    const hints = [...KNOWN_HOST_HINTS, "?id="];
    return [
        ...new Set($(".page-body a, .entry-content a, .page-content a, main a")
            .map((i, el) => $(el).attr("href"))
            .get()
            .filter((h) => isUsableHref(h) && hints.some((x) => h.includes(x))))
    ];
}
const EPISODE_RE = /(?:EPiSODE\s*(\d+)|\bE(\d{1,3})\b)/i;
function getDownloadLinks(mediaUrl, mediaType) {
    return __awaiter(this, void 0, void 0, function* () {
        const domain = yield getCurrentDomain();
        // Search results can still carry an older mirror host - always use the working one.
        if (/hdhub4u\./i.test(mediaUrl)) {
            try {
                const u = new URL(mediaUrl);
                u.hostname = new URL(domain).hostname;
                mediaUrl = u.toString();
            }
            catch (e) {
                /* keep url */
            }
        }
        const response = yield fetchT(mediaUrl, { headers: Object.assign({}, HEADERS, { Referer: `${domain}/` }) });
        if (!response.ok)
            throw new Error(`Media page HTTP ${response.status}`);
        const data = yield response.text();
        const $ = cheerio.load(data);
        // Trust TMDB's media type, not fragile page markup.
        const isMovie = mediaType !== "tv";
        const dedupe = (links) => {
            const seen = new Set();
            return links.filter((link) => {
                if (!link.url || /\.zip(\?|$)/i.test(link.url) || /\.zip/i.test(link.fileName || ""))
                    return false;
                if (seen.has(link.url))
                    return false;
                seen.add(link.url);
                return true;
            });
        };
        if (isMovie) {
            const qualityLinks = $("h3 a, h4 a").filter((i, el) => /480|720|1080|2160|4K/i.test($(el).text()));
            const bodyLinks = $(".page-body a, .entry-content a").filter((i, el) => {
                const href = $(el).attr("href");
                return href && (href.includes("hdstream4u") || href.includes("hubstream"));
            });
            let initialLinks = [
                ...new Set([
                    ...qualityLinks.map((i, el) => $(el).attr("href")).get(),
                    ...bodyLinks.map((i, el) => $(el).attr("href")).get()
                ])
            ].filter(isUsableHref);
            if (!initialLinks.length)
                initialLinks = collectContentLinks($);
            console.log(`[HDHub4u] ${initialLinks.length} candidate links on movie page`);
            const results = yield Promise.all(initialLinks.map((u) => loadExtractor(u, mediaUrl)));
            return { finalLinks: dedupe(results.flat()), isMovie };
        }
        // ── TV ──
        const episodeLinksMap = new Map();
        const directLinkBlocks = [];
        $("h3, h4").each((i, element) => {
            const $el = $(element);
            const text = $el.text();
            const anchors = $el.find("a");
            const links = anchors.map((j, a) => $(a).attr("href")).get().filter(isUsableHref);
            const isDirectBlock = anchors.get().some((a) => /1080|720|4K|2160/i.test($(a).text()));
            if (isDirectBlock) {
                directLinkBlocks.push(...links);
                return;
            }
            const em = text.match(EPISODE_RE);
            if (em) {
                const epNum = parseInt(em[1] || em[2], 10);
                if (!episodeLinksMap.has(epNum))
                    episodeLinksMap.set(epNum, []);
                episodeLinksMap.get(epNum).push(...links);
                // pick up links in following siblings until the next episode heading / <hr>
                let next = $el.next();
                while (next.length) {
                    const tag = (next.get(0).tagName || "").toLowerCase();
                    if (tag === "hr")
                        break;
                    if ((tag === "h3" || tag === "h4") && EPISODE_RE.test(next.text()))
                        break;
                    const sib = next.find("a[href]").map((j, a) => $(a).attr("href")).get().filter(isUsableHref);
                    episodeLinksMap.get(epNum).push(...sib);
                    next = next.next();
                }
            }
        });
        if (directLinkBlocks.length) {
            yield Promise.all(directLinkBlocks.map((blockUrl) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const resolved = (yield getRedirectLinks(blockUrl)) || blockUrl;
                    const blockRes = yield fetchT(resolved, { headers: HEADERS });
                    const $$ = cheerio.load(yield blockRes.text());
                    $$("h5 a, h4 a, h3 a").each((j, el) => {
                        const linkText = $$(el).text();
                        const linkHref = $$(el).attr("href");
                        const epm = linkText.match(/Episode\s*(\d+)/i);
                        if (epm && isUsableHref(linkHref)) {
                            const epNum = parseInt(epm[1], 10);
                            if (!episodeLinksMap.has(epNum))
                                episodeLinksMap.set(epNum, []);
                            episodeLinksMap.get(epNum).push(linkHref);
                        }
                    });
                }
                catch (e) {
                    /* skip block */
                }
            })));
        }
        const initialLinks = [];
        episodeLinksMap.forEach((links, epNum) => {
            [...new Set(links)].forEach((u) => initialLinks.push({ url: u, episode: epNum }));
        });
        console.log(`[HDHub4u] ${initialLinks.length} candidate episode links, ${episodeLinksMap.size} episodes`);
        const results = yield Promise.all(initialLinks.map((info) => __awaiter(this, void 0, void 0, function* () {
            try {
                const extracted = yield loadExtractor(info.url, mediaUrl);
                return extracted.map((ext) => Object.assign({}, ext, { episode: info.episode }));
            }
            catch (e) {
                return [];
            }
        })));
        return { finalLinks: dedupe(results.flat()), isMovie };
    });
}
// ───────────────────────── entry point ─────────────────────────
function getStreams(tmdbId_1) {
    return __awaiter(this, arguments, void 0, function* (tmdbId, mediaType = "movie", season = null, episode = null) {
        console.log(`[HDHub4u] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
        try {
            yield getCurrentDomain();
            const mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
            console.log(`[HDHub4u] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || "N/A"}) via ${MAIN_URL}`);
            const queries = mediaType === "tv" && season
                ? [`${mediaInfo.title} Season ${season}`, mediaInfo.title]
                : [mediaInfo.title, mediaInfo.year ? `${mediaInfo.title} ${mediaInfo.year}` : null].filter(Boolean);
            let selectedMedia = null;
            let firstResult = null;
            for (const q of queries) {
                const results = yield search(q);
                if (!results.length)
                    continue;
                if (!firstResult)
                    firstResult = results[0];
                const best = findBestTitleMatch(mediaInfo, results, mediaType, season);
                if (best) {
                    selectedMedia = best;
                    break;
                }
            }
            if (!selectedMedia && firstResult) {
                const sim = calculateTitleSimilarity(mediaInfo.title, stripReleaseNoise(firstResult.title));
                if (sim >= 0.5)
                    selectedMedia = firstResult;
            }
            if (!selectedMedia) {
                console.log("[HDHub4u] No matching post found");
                return [];
            }
            console.log(`[HDHub4u] Selected: "${selectedMedia.title}" (${selectedMedia.url})`);
            const result = yield getDownloadLinks(selectedMedia.url, mediaType);
            let filtered = result.finalLinks;
            if (mediaType === "tv" && episode !== null) {
                filtered = filtered.filter((link) => link.episode === episode);
            }
            const streams = filtered.map((link) => {
                let mediaTitle = link.fileName && link.fileName !== "Unknown" ? link.fileName : mediaInfo.title;
                if (mediaType === "tv" && season && episode) {
                    mediaTitle = `${mediaInfo.title} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
                }
                const serverName = extractServerName(link.source);
                let qualityStr = "Unknown";
                if (typeof link.quality === "number" && link.quality > 0) {
                    if (link.quality >= 2160)
                        qualityStr = "4K";
                    else if (link.quality >= 1080)
                        qualityStr = "1080p";
                    else if (link.quality >= 720)
                        qualityStr = "720p";
                    else if (link.quality >= 480)
                        qualityStr = "480p";
                }
                else if (typeof link.quality === "string") {
                    qualityStr = link.quality;
                }
                return {
                    name: `HDHub4u ${serverName}`,
                    title: mediaTitle,
                    url: link.url,
                    quality: qualityStr,
                    size: formatBytes(link.size),
                    headers: link.headers || undefined,
                    subtitles: link.subtitles && link.subtitles.length ? link.subtitles : undefined,
                    provider: "hdhub4u"
                };
            });
            const qualityOrder = { "4K": 4, "1080p": 3, "720p": 2, "480p": 1, M3U8: 2, Unknown: 0 };
            const rank = (q) => (qualityOrder[q] !== undefined ? qualityOrder[q] : -1);
            return streams.sort((a, b) => rank(b.quality) - rank(a.quality));
        }
        catch (error) {
            console.error(`[HDHub4u] Scraping error: ${error.message}`);
            return [];
        }
    });
}
module.exports = { getStreams };
