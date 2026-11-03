/**
 * hdhub4u - v6
 * - domain pinned: https://new10.hdhub4u.cl (domains.json only used if it is down)
 * - redirector links (greenmotors.club/?id=...) decoded again: older movies/series ONLY have these
 * - HubCloud extractor ported from the working moviesdrive provider
 * - relevance-ranked search, multi-post merge, per-stage [HDHub4u] logging
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
const REDIRECT_HOSTS = ["greenmotors", "techyboy4u", "gadgetsweb", "cryptoinsights", "bloggingvector", "ampproject.org"];
// ───────────────────────── helpers ─────────────────────────
const log = (...args) => console.log("[HDHub4u]", ...args);
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
function scoreResult(mediaInfo, result, mediaType, season) {
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
        const m = raw.toLowerCase().match(/\bseason\s*(\d+)|\bs(\d{1,2})\b/i);
        if (m) {
            const found = parseInt(m[1] || m[2], 10);
            score += found === season ? 0.5 : -0.8;
        }
        else {
            score -= 0.3;
        }
    }
    if (/2160p|4k/i.test(raw))
        score += 0.05;
    return score;
}
// All plausible posts, best first (a title can have several posts, e.g. WEB-DL and BluRay)
function rankMatches(mediaInfo, searchResults, mediaType, season) {
    return (searchResults || [])
        .map((result) => ({ result, score: scoreResult(mediaInfo, result, mediaType, season) }))
        .filter((r) => r.score > 0.3)
        .sort((a, b) => b.score - a.score);
}
function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
    const ranked = rankMatches(mediaInfo, searchResults, mediaType, season);
    if (!ranked.length)
        return null;
    log(`Best title match: "${ranked[0].result.title}" (score: ${ranked[0].score.toFixed(2)})`);
    return ranked[0].result;
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
// ───────── obfuscated redirector decoder (greenmotors.club/?id=..., techyboy4u, ...) ─────────
// These pages are decoy blogs ("Skip Ad in 5s"); the real link is hidden in the page's script as
// s('o','BASE64') / ck('_wp_http_N','...') chunks. We read it straight from the HTML - no countdown needed.
function extractRedirectPayload(html) {
    const re = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=_-]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
    let combined = "";
    let m;
    while ((m = re.exec(html)) !== null) {
        const v = m[1] || m[2];
        if (v)
            combined += v;
    }
    return combined;
}
// Primary chain = b64 -> b64 -> rot13 -> b64 (what the site uses). The alternates only exist so a small
// change on the site's side doesn't silently break every redirector link.
const REDIRECT_CHAINS = [
    ["b64", "b64", "rot", "b64"],
    ["b64", "rot", "b64"],
    ["b64", "b64", "b64"],
    ["rot", "b64", "b64"],
    ["b64", "b64", "rot", "b64", "b64"]
];
function decodeRedirectPayload(combined) {
    const ops = { b64: (x) => atob(x), rot: (x) => rot13(x) };
    for (const chain of REDIRECT_CHAINS) {
        try {
            let v = combined;
            for (const step of chain)
                v = ops[step](v);
            const json = JSON.parse(v);
            if (json && typeof json === "object")
                return json;
        }
        catch (e) {
            /* try next chain */
        }
    }
    return null;
}
function getRedirectLinks(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, referer = MAIN_URL, depth = 0) {
        try {
            if (depth > 3)
                return null;
            let host = "?";
            try {
                host = new URL(url).hostname;
            }
            catch (e) { /* ignore */ }
            const attempts = [url];
            const idMatch = url.match(/[?&]id=([^&]+)/);
            let html = "";
            let combined = "";
            let finalUrl = url;
            let status = 0;
            for (let i = 0; i < attempts.length && i < 3 && !combined; i++) {
                try {
                    const resp = yield fetchT(attempts[i], { headers: hubHeaders(referer) }, 15000);
                    status = resp.status;
                    finalUrl = resp.url || attempts[i];
                    html = yield resp.text();
                    combined = extractRedirectPayload(html);
                    // some redirectors bounce to their blog home and drop ?id= : retry on the final host with the id
                    if (!combined && idMatch && !/[?&]id=/.test(finalUrl)) {
                        try {
                            const retry = `${new URL(finalUrl).origin}/?id=${idMatch[1]}`;
                            if (!attempts.includes(retry))
                                attempts.push(retry);
                        }
                        catch (e) { /* ignore */ }
                    }
                }
                catch (e) {
                    log(`redirect ${host}: request failed (${e.message})`);
                }
            }
            log(`redirect ${host}: HTTP ${status}, ${html.length} bytes, payload ${combined.length} chars${finalUrl !== url ? `, landed on ${finalUrl.slice(0, 60)}` : ""}`);
            if (!combined) {
                const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/);
                if (jsRedirect && jsRedirect[1]) {
                    const next = absUrl(jsRedirect[1], finalUrl);
                    if (next && next !== url && next !== finalUrl)
                        return yield getRedirectLinks(next, referer, depth + 1);
                }
                return null;
            }
            const json = decodeRedirectPayload(combined);
            if (!json) {
                log(`redirect ${host}: payload found but could not be decoded (site format may have changed)`);
                return null;
            }
            let target = "";
            if (json.o) {
                const dec = atob(String(json.o)).trim();
                target = /^https?:/i.test(dec) ? dec : /^https?:/i.test(String(json.o)) ? String(json.o) : "";
            }
            if (!target && (json.url || json.link))
                target = String(json.url || json.link).trim();
            if (target) {
                log(`redirect ${host} -> ${target.slice(0, 80)}`);
                return target;
            }
            const data = json.data ? atob(String(json.data)).trim() : "";
            const wpHttp = (json.blog_url || "").trim();
            if (wpHttp && data) {
                const r = yield fetchT(`${wpHttp}?re=${data}`, { headers: hubHeaders(referer) });
                const text = yield r.text();
                const body = (cheerio.load(text)("body").text() || text).trim();
                if (/^https?:/i.test(body))
                    return body;
            }
            return null;
        }
        catch (e) {
            log(`redirect decode error: ${e.message}`);
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
// ───────── HubCloud (ported from the working moviesdrive provider) ─────────
const HUB_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    Connection: "keep-alive"
};
// HubCloud is a different site: browser-like headers + the page we came from, no hdhub4u cookie.
function hubHeaders(referer) {
    return Object.assign({}, HUB_HEADERS, referer ? { Referer: referer } : {});
}
function getIndexQuality(str) {
    if (!str)
        return 1080;
    const match = str.match(/(\d{3,4})[pP]/);
    if (match)
        return parseInt(match[1], 10);
    const up = str.toUpperCase();
    if (up.includes("4K") || up.includes("2160P") || up.includes("UHD"))
        return 2160;
    return 1080;
}
function fetchHubText(url, referer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield fetchT(url, { headers: hubHeaders(referer) });
            if (!r.ok)
                log(`hubcloud GET ${url.slice(0, 80)} -> HTTP ${r.status}`);
            return yield r.text();
        }
        catch (e) {
            log(`hubcloud GET failed (${url.slice(0, 60)}): ${e.message}`);
            return "";
        }
    });
}
// ".../?r=BASE64" -> the real link page (only used as a fallback)
function decodeRParam(u) {
    const i = u.indexOf("r=");
    if (i < 0)
        return null;
    try {
        const decoded = atob(decodeURIComponent(u.slice(i + 2).split("&")[0])).trim();
        return /^https?:/i.test(decoded) ? decoded : null;
    }
    catch (e) {
        return null;
    }
}
const HUBCLOUD_BUTTON_RE = /download file|instant|fsl|s3 server|mega server|buzz|10gbps|pixel|zipdisk/i;
function hubCloudButtons($) {
    return $("a[href]")
        .get()
        .filter((el) => HUBCLOUD_BUTTON_RE.test($(el).text()) || /r2\.dev|pixeldra|workers\.dev/i.test($(el).attr("href") || ""));
}
// ───────── optional direct-link probing ─────────
// FSLv2 is returned as the plain button URL (exactly like moviesdrive). If a particular link
// redirects or needs headers to play, add its button text to RESOLVE_LABELS (e.g. ["fslv2"]):
// it then follows redirects with a 1-byte Range request and attaches the headers that worked.
const RESOLVE_LABELS = [];
function findMediaLinkInHtml(html, base) {
    const patterns = [
        /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i,
        /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
        /href=["']([^"']+\.(?:mkv|mp4|m3u8|avi|mov|webm)(?:\?[^"']*)?)["']/i,
        /(?:file|source|src)["']?\s*[:=]\s*["']([^"']+\.(?:mkv|mp4|m3u8)(?:\?[^"']*)?)["']/i
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) {
            const u = absUrl(m[1].replace(/&amp;/g, "&"), base);
            if (u && u !== base)
                return u;
        }
    }
    return null;
}
function probeDirect(link, referer) {
    return __awaiter(this, void 0, void 0, function* () {
        const ua = HUB_HEADERS["User-Agent"];
        let current = link;
        for (let hop = 0; hop < 4; hop++) {
            let nextHop = null;
            for (const extra of [{}, { Referer: referer }]) {
                const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
                const timer = setTimeout(() => ctrl && ctrl.abort(), 10000);
                try {
                    const sent = Object.assign({ "User-Agent": ua }, extra);
                    const resp = yield fetch(current, {
                        method: "GET",
                        redirect: "follow",
                        headers: Object.assign({ Range: "bytes=0-0" }, sent),
                        signal: ctrl ? ctrl.signal : undefined
                    });
                    const ct = ((resp.headers && resp.headers.get && resp.headers.get("content-type")) || "").toLowerCase();
                    const finalUrl = resp.url || current;
                    log(`probe ${current.slice(0, 60)} -> HTTP ${resp.status} ${ct || "?"}${extra.Referer ? " (with Referer)" : ""}`);
                    if (resp.status === 401 || resp.status === 403)
                        continue;
                    if (resp.status === 404 || resp.status === 410)
                        return { dead: true };
                    if (resp.ok || resp.status === 206) {
                        if (ct.includes("text/html")) {
                            nextHop = findMediaLinkInHtml(yield resp.text(), finalUrl);
                            if (!nextHop)
                                return null;
                            break;
                        }
                        return { url: finalUrl, headers: sent };
                    }
                }
                catch (e) {
                    log(`probe failed: ${e.message}`);
                    return null;
                }
                finally {
                    clearTimeout(timer);
                    try {
                        if (ctrl)
                            ctrl.abort();
                    }
                    catch (e) { /* ignore */ }
                }
            }
            if (!nextHop)
                return null;
            current = nextHop;
        }
        return null;
    });
}
const HUBCLOUD_BLOCKED = ["tinyurl", "telegram", "hubcloud.cx/tg", "hubcloud.foo/tg"];
function hubCloudExtractor(url, referer, depth) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1) landing page
            let currentUrl = url;
            let pageData = yield fetchHubText(currentUrl, referer);
            if (!pageData && url.includes("hubcloud.ink")) {
                currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
                pageData = yield fetchHubText(currentUrl, referer);
            }
            if (!pageData)
                return [];
            // 2) the page that lists the download buttons: hubcloud.php link -> #download -> var url
            let finalUrl = currentUrl;
            if (!currentUrl.includes("hubcloud.php")) {
                const $first = cheerio.load(pageData);
                const varMatch = pageData.match(/var url = ["']([^"']*)["']/);
                let nextHref = $first('a[href*="hubcloud.php"]').attr("href") || "";
                if (!nextHref) {
                    const downloadBtn = $first("#download");
                    if (downloadBtn.length)
                        nextHref = downloadBtn.attr("href") || "";
                    else if (varMatch)
                        nextHref = varMatch[1];
                }
                const candidates = [];
                if (nextHref)
                    candidates.push(nextHref);
                if (varMatch) {
                    const decoded = decodeRParam(varMatch[1]); // fallback if the plain link is a dead end
                    if (decoded)
                        candidates.push(decoded);
                }
                let chosen = null;
                for (const cand of candidates) {
                    const resolved = cand.startsWith("http") ? cand : `${new URL(currentUrl).origin}/${cand.replace(/^\//, "")}`;
                    const html = yield fetchHubText(resolved, currentUrl);
                    if (!html)
                        continue;
                    if (!chosen)
                        chosen = { url: resolved, html };
                    if (hubCloudButtons(cheerio.load(html)).length) {
                        chosen = { url: resolved, html };
                        break;
                    }
                }
                if (chosen) {
                    finalUrl = chosen.url;
                    pageData = chosen.html;
                }
            }
            const $ = cheerio.load(pageData);
            const size = $("i#size").text().trim();
            const header = $("div.card-header").text().trim();
            const quality = getIndexQuality(header);
            const fileName = header || "Unknown";
            const pxlMatch = pageData.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
            const links = [];
            const elements = $("a[href]").get();
            log(`hubcloud: ${hubCloudButtons($).length} button(s) on ${finalUrl.slice(0, 70)}`);
            for (const el of elements) {
                let link = $(el).attr("href");
                const text = $(el).text().toLowerCase().trim();
                if (!link || HUBCLOUD_BLOCKED.some((b) => link.includes(b)))
                    continue;
                if (link.includes("negn6f") && pxlMatch)
                    link = pxlMatch[1];
                if (text.includes("fslv2")) {
                    let streamUrl = link;
                    let streamHeaders;
                    if (RESOLVE_LABELS.some((l) => text.includes(l))) {
                        const probed = yield probeDirect(link, finalUrl);
                        if (probed && probed.dead)
                            continue;
                        if (probed && probed.url) {
                            streamUrl = probed.url;
                            streamHeaders = probed.headers;
                        }
                    }
                    links.push({ source: "HubCloud - FSLv2", quality, url: streamUrl, size, fileName, headers: streamHeaders });
                }
                else if (text.includes("fsl server") || (text.includes("fsl") && !text.includes("v2"))) {
                    links.push({ source: "HubCloud - FSL Server", quality, url: link, size, fileName });
                }
                else if (text.includes("download file") || text.includes("instant download") || text.includes("instant") || text.includes("10gbps")) {
                    let streamUrl = link;
                    if (streamUrl.includes("link=")) {
                        streamUrl = streamUrl.split("link=")[1];
                    }
                    else {
                        try {
                            const res = yield fetchT(link, { headers: hubHeaders(finalUrl), redirect: "follow" });
                            if (res.url && res.url.startsWith("http")) {
                                streamUrl = res.url;
                                if (streamUrl.includes("link="))
                                    streamUrl = streamUrl.split("link=")[1];
                            }
                        }
                        catch (e) {
                            /* keep the button url */
                        }
                    }
                    if (streamUrl && streamUrl.startsWith("http")) {
                        links.push({ source: "HubCloud - Instant", quality, url: streamUrl, size, fileName });
                    }
                }
                else if (text.includes("pixeldra") || text.includes("pixelserver") || link.includes("pixeldrain")) {
                    let pUrl = link;
                    if (pUrl.includes("/u/")) {
                        const fileId = pUrl.split("/u/")[1].split("?")[0].replace("/", "");
                        pUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
                    }
                    links.push({ source: "HubCloud - Pixeldrain", quality, url: pUrl, size, fileName });
                }
                else if (text.includes("buzzserver") || text.includes("buzz server") || text.includes("buzz") || text.includes("fuckingfast")) {
                    try {
                        const dlRes = yield fetchT(link, {
                            headers: {
                                "User-Agent": HUB_HEADERS["User-Agent"],
                                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                            }
                        });
                        const dlHtml = yield dlRes.text();
                        const copyMatch = dlHtml.match(/copyDownloadLink\(['"]([^'"]+)['"]\)/);
                        const dlPath = copyMatch ? copyMatch[1].replace(/\\\//g, "/") : null;
                        const base = new URL(link).origin;
                        const dlUrl = dlPath ? (dlPath.startsWith("http") ? dlPath : `${base}${dlPath}`) : link.endsWith("/download") ? link : `${link}/download`;
                        const resp = yield fetchT(dlUrl, {
                            headers: { "User-Agent": HUB_HEADERS["User-Agent"], Referer: link, "HX-Request": "true" },
                            redirect: "manual"
                        });
                        const dlink = resp.headers.get("hx-redirect") || resp.headers.get("location");
                        if (dlink)
                            links.push({ source: "HubCloud - BuzzServer", quality, url: dlink, size, fileName });
                    }
                    catch (e) {
                        /* skip */
                    }
                }
                else if (text.includes("s3 server")) {
                    links.push({ source: "HubCloud - S3", quality, url: link, size, fileName });
                }
                else if (text.includes("mega server")) {
                    links.push({ source: "HubCloud - Mega", quality, url: link, size, fileName });
                }
                else if (link.includes("r2.dev")) {
                    links.push({ source: "Direct R2", quality, url: link, size, fileName });
                }
                else if (link.includes("workers.dev")) {
                    links.push({ source: "ZipDisk Server", quality, url: link, size, fileName });
                }
            }
            return links;
        }
        catch (e) {
            log(`hubcloud extractor error: ${e.message}`);
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
            if (!res.ok) {
                log(`hubdrive HTTP ${res.status} for ${url.slice(0, 70)}`);
                return [];
            }
            const data = yield res.text();
            const $ = cheerio.load(data);
            let href = $(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href") ||
                $("a.btn-success1").attr("href") ||
                $("a[href*='hubcloud']").attr("href") ||
                $("a[href*='hubcdn']").attr("href") ||
                $("a[href*='gamerxyt']").attr("href");
            if (!href) {
                // last resort: any button-like link whose text mentions hubcloud
                $("a[href]").each((i, el) => {
                    if (!href && /hubcloud|instant/i.test($(el).text()))
                        href = $(el).attr("href");
                });
            }
            if (!href) {
                log(`hubdrive: no HubCloud link found on ${url.slice(0, 70)}`);
                return [];
            }
            href = absUrl(href, url) || href;
            return yield loadExtractor(href, url, depth + 1);
        }
        catch (e) {
            return [];
        }
    });
}
const SKIP_HOSTS = /4khdhub|imdb\.com|whatsapp|telegram|t\.me|play4u|vidaraa|catimages|snvhost/i;
function loadExtractor(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, referer = MAIN_URL, depth = 0) {
        const results = yield loadExtractorInner(url, referer, depth);
        if (depth === 0) {
            let host = "?";
            try {
                host = new URL(url).hostname;
            }
            catch (e) { /* ignore */ }
            log(`extractor ${host} -> ${results.length} link(s)`);
        }
        return results;
    });
}
function loadExtractorInner(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, referer = MAIN_URL, depth = 0) {
        try {
            if (!url || depth > 4)
                return [];
            const hostname = new URL(url).hostname.toLowerCase();
            if (SKIP_HOSTS.test(hostname))
                return [];
            if (hostname.includes("hubcloud") || hostname.includes("gamerxyt") || url.includes("hubcloud.php")) {
                return yield hubCloudExtractor(url, referer, depth);
            }
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
                const finalLink = yield getRedirectLinks(url, referer);
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
        // The site's own request sorts purely by date and caps at 15 hits, so short/common titles
        // (e.g. "Weapons", "Lupin") push the real post out of the list. Relevance first, date second.
        const variants = [
            "&sort_by=_text_match:desc,sort_by_date:desc&limit=40&prefix=false&num_typos=1",
            "&sort_by=sort_by_date:desc&limit=40"
        ];
        for (const host of SEARCH_HOSTS) {
            for (const variant of variants) {
                try {
                    const url = `${host}/collections/post/documents/search?q=${encodeURIComponent(query)}` +
                        `&query_by=post_title,category&query_by_weights=4,2${variant}` +
                        `&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;
                    const response = yield fetchT(url, { headers: Object.assign({}, HEADERS, { Origin: MAIN_URL, Referer: `${MAIN_URL}/` }) }, 12000);
                    if (!response.ok) {
                        log(`search ${host} HTTP ${response.status} for "${query}"`);
                        continue;
                    }
                    const data = yield response.json();
                    if (!data || !Array.isArray(data.hits) || !data.hits.length)
                        continue;
                    log(`search "${query}" -> ${data.hits.length} hits via ${host}`);
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
                    log(`search host ${host} failed: ${e.message}`);
                }
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
// ───────────────────────── page scraping ─────────────────────────
function isUsableHref(href) {
    return !!href && /^https?:/i.test(href) && !href.includes("magnet:") && !SKIP_HOSTS.test(href);
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
function getDownloadLinks(mediaUrl_1, mediaType_1) {
    return __awaiter(this, arguments, void 0, function* (mediaUrl, mediaType, wantedEpisode = null) {
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
        const blockUrls = [...new Set(directLinkBlocks)].filter((u) => !(/hubdrive|hubcdn|hubcloud/i.test(u) && /\/file\//.test(u)) && !SKIP_HOSTS.test(u));
        const haveWanted = wantedEpisode !== null && episodeLinksMap.has(wantedEpisode) && episodeLinksMap.get(wantedEpisode).length > 0;
        if (blockUrls.length && !haveWanted) {
            log(`${blockUrls.length} season/pack link(s) to expand`);
            yield Promise.all(blockUrls.map((blockUrl) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const resolved = (yield getRedirectLinks(blockUrl, mediaUrl)) || blockUrl;
                    const blockRes = yield fetchT(resolved, { headers: hubHeaders(mediaUrl) });
                    const $$ = cheerio.load(yield blockRes.text());
                    $$("a[href]").each((j, el) => {
                        const linkText = $$(el).text();
                        const linkHref = $$(el).attr("href");
                        const epm = linkText.match(/Episode\s*0*(\d+)/i) || linkText.match(/\bEP[\s.-]*0*(\d+)\b/i);
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
                : [mediaInfo.year ? `${mediaInfo.title} ${mediaInfo.year}` : null, mediaInfo.title].filter(Boolean);
            const pool = [];
            const seenUrls = new Set();
            const addAll = (arr) => arr.forEach((r) => {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    pool.push(r);
                }
            });
            let ranked = [];
            for (const q of queries) {
                addAll(yield searchTypesense(q));
                ranked = rankMatches(mediaInfo, pool, mediaType, season);
                if (ranked.length)
                    break;
            }
            if (!ranked.length) {
                log("Typesense gave no match, trying site HTML search");
                for (const q of queries) {
                    addAll(yield searchHtml(q));
                    ranked = rankMatches(mediaInfo, pool, mediaType, season);
                    if (ranked.length)
                        break;
                }
            }
            log(`candidates: ${pool.length}, matching: ${ranked.length}`);
            ranked.slice(0, 3).forEach((r) => log(`  match ${r.score.toFixed(2)}  ${r.result.title.slice(0, 80)}`));
            let selected = ranked.filter((r) => r.score >= ranked[0].score - 0.25).slice(0, 2).map((r) => r.result);
            if (!selected.length && pool.length) {
                const sim = calculateTitleSimilarity(mediaInfo.title, stripReleaseNoise(pool[0].title));
                if (sim >= 0.5)
                    selected = [pool[0]];
            }
            if (!selected.length) {
                log("No matching post found");
                return [];
            }
            const pages = yield Promise.all(selected.map((media) => __awaiter(this, void 0, void 0, function* () {
                log(`Selected: "${media.title}" (${media.url})`);
                try {
                    return yield getDownloadLinks(media.url, mediaType, mediaType === "tv" ? episode : null);
                }
                catch (e) {
                    log(`page failed: ${e.message}`);
                    return { finalLinks: [] };
                }
            })));
            const mergedSeen = new Set();
            const result = {
                finalLinks: pages
                    .flatMap((p) => p.finalLinks)
                    .filter((l) => (mergedSeen.has(l.url) ? false : (mergedSeen.add(l.url), true)))
            };
            log(`total links: ${result.finalLinks.length}`);
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
                    size: typeof link.size === "string" ? link.size || "Unknown" : formatBytes(link.size),
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
