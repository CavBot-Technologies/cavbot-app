// CavAi (Gen 1.0)
// Analytics + suggestion engine + site intelligence + head/eye/pupil tracking

(function () {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  'use strict';

 // ===== HARD GUARD: prevent double-loading (glitchy eyes = duplicate listeners / transform fights) =====
 if (typeof window !== 'undefined') {
   if (window.__cavaiGen1Loaded) return;
   window.__cavaiGen1Loaded = true;
 }

 // ===== Shared Utilities & Analytics Bridge =====

 function randomFrom(array) {
   if (!array || !array.length) return '';
   var idx = Math.floor(Math.random() * array.length);
   return array[idx];
 }

 function safeParseJSON(raw, fallback) {
   if (!raw) return fallback;
   try {
     var parsed = JSON.parse(raw);
     return (parsed && typeof parsed === 'object') ? parsed : fallback;
   } catch (e) {
     return fallback;
   }
 }

 function safeString(value, maxLen) {
   try {
     var text = value == null ? '' : String(value);
     var limit = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 1200;
     return text.length > limit ? text.slice(0, limit) : text;
   } catch (e) {
     return '';
   }
 }

 var SESSION_KEY = 'cavbotSessionKey';
 var LEGACY_SESSION_KEY = 'cavbotSessionId';

 function createSessionId() {
   return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
 }

 function getOrCreateSessionId() {
   try {
     var existing = globalThis.__cbSessionStore.getItem(SESSION_KEY);
     if (existing) return existing;
     var legacy = globalThis.__cbSessionStore.getItem(LEGACY_SESSION_KEY);
     if (legacy) {
       globalThis.__cbSessionStore.setItem(SESSION_KEY, legacy);
       try {
         globalThis.__cbSessionStore.removeItem(LEGACY_SESSION_KEY);
       } catch (e2) {
         // ignore migration cleanup errors
       }
       return legacy;
     }
     var fresh = createSessionId();
     globalThis.__cbSessionStore.setItem(SESSION_KEY, fresh);
     return fresh;
   } catch (e) {
     // globalThis.__cbSessionStore not available, fall back to ephemeral id
     return createSessionId();
   }
 }

 // Device-level analytics snapshot (local only)
 var analytics = {
   visitCount: 1,
   lifetimeCatches: 0,
   lifetimeMisses: 0,
   lifetimeRounds: 0,
   bestMs: null,
   bestRuns: [], // [{ ms, at }]
   lastVisit: null
 };

 // Session-level info (per browser session / tab)
 var session = {
   id: getOrCreateSessionId(),
   startedAt: new Date().toISOString(),
   catches: 0,
   misses: 0,
   rounds: 0,
   bestMs: null
 };
 var runtimeEvents = [];

 // Companion-layer constants (declared early to avoid any IIFE hoist/ordering footguns).
 var GEO_STORAGE_KEY = 'cb_cavai_geo_v1';
 var MEMORY_STORAGE_KEY = 'cb_cavai_memory_v1';
 var MEMORY_VERSION = 1;
 var MEMORY_MAX_ORIGINS = 25;
 var MEMORY_MAX_RUNS = 12;
 var intentCallState = (
   typeof window !== 'undefined' &&
   window.__cavaiIntentCallState &&
   typeof window.__cavaiIntentCallState === 'object'
 ) ? window.__cavaiIntentCallState : {};
 if (typeof window !== 'undefined') {
   window.__cavaiIntentCallState = intentCallState;
 }
 var DEBUG_STORAGE_KEY = 'cb_cavai_debug';
 var SOFT_BURST_SCAN_KEY = 'cb_cavai_scan_history_v1';
 var SOFT_BURST_WINDOW_MS = 10 * 60 * 1000;
 var SOFT_BURST_SCAN_LIMIT = 2;
 var SOFT_BURST_MESSAGE = 'Recent scan detected. Make changes first, then run again.';
 var CAVBOT_PENDING_EVENT_KEY = '__cavbotPendingEvents';
 var CAVBOT_PENDING_EVENT_MAX = 200;

 function getDocumentAttr(name) {
   if (!name || typeof document === 'undefined') return '';
   var bodyValue = '';
   var htmlValue = '';
   try {
     bodyValue = document.body && document.body.getAttribute(name);
   } catch (e) {
     bodyValue = '';
   }
   try {
     htmlValue = document.documentElement && document.documentElement.getAttribute(name);
   } catch (e2) {
     htmlValue = '';
   }
   return bodyValue || htmlValue || '';
 }

 function isAttrOff(name) {
   var value = getDocumentAttr(name);
   return typeof value === 'string' && value.toLowerCase() === 'off';
 }

 function hasDoNotTrackEnabled() {
   try {
     var dnt = navigator.doNotTrack || navigator.msDoNotTrack || window.doNotTrack;
     return dnt === '1' || dnt === 'yes';
   } catch (e) {
     return false;
   }
 }

 function hasGlobalPrivacyControlEnabled() {
   try {
     if (navigator.globalPrivacyControl === true) return true;
     if (navigator.gpc === true || navigator.gpc === '1') return true;
   } catch (e) {}
   return false;
 }

 function analyticsSuppressedForBrain() {
   if (isAttrOff('data-cavbot-analytics')) return true;
   if (isAttrOff('data-cavai-analytics')) return true;
   if (hasGlobalPrivacyControlEnabled()) return true;
   if (hasDoNotTrackEnabled()) return true;
   return false;
 }

 function getCurrentPathname() {
   try {
     if (window && window.location && typeof window.location.pathname === 'string') {
       return window.location.pathname.toLowerCase();
     }
   } catch (e) {}
   return '';
 }

 function isConsolePath(pathname) {
   var p = typeof pathname === 'string' ? pathname : '';
   if (!p) return false;
   return (
     p.indexOf('control-room') !== -1 ||
     p.indexOf('guardian') !== -1 ||
     p.indexOf('console') !== -1
   );
 }

 function resolveBrainTrackingOverrides(overrides) {
   var next = Object.assign({}, overrides || {});

   var attrPageType = getDocumentAttr('data-cavbot-page-type');
   var attrComponent = getDocumentAttr('data-cavbot-component');

   if (!next.pageType && attrPageType) {
     next.pageType = attrPageType;
   }
   if (!next.component && attrComponent) {
     next.component = attrComponent;
   }

   if ((!next.pageType || !next.component) && isConsolePath(getCurrentPathname())) {
     if (!next.pageType) next.pageType = 'cavai-console';
     if (!next.component) next.component = 'cavai-console-shell';
   }

   return next;
 }

 function clearPendingCavbotEvents() {
   try {
     if (typeof window === 'undefined') return;
     window[CAVBOT_PENDING_EVENT_KEY] = [];
   } catch (e) {}
 }

 function queuePendingCavbotEvent(eventName, payload, overrides) {
   try {
     if (typeof window === 'undefined') return;
     if (!Array.isArray(window[CAVBOT_PENDING_EVENT_KEY])) {
       window[CAVBOT_PENDING_EVENT_KEY] = [];
     }
     var queue = window[CAVBOT_PENDING_EVENT_KEY];
     queue.push({
       eventName: eventName,
       payload: payload || {},
       overrides: overrides || {},
       ts: Date.now()
     });
     while (queue.length > CAVBOT_PENDING_EVENT_MAX) {
       queue.shift();
     }
   } catch (e) {}
 }

 function cavbotTrack(eventName, payload, overrides) {
   if (analyticsSuppressedForBrain()) {
     clearPendingCavbotEvents();
     return Promise.resolve();
   }
   try {
     if (
       window.cavbotAnalytics &&
       typeof window.cavbotAnalytics.track === 'function'
     ) {
       return Promise.resolve(window.cavbotAnalytics.track(eventName, payload || {}, overrides));
     }
   } catch (e) {
     // never let analytics break anything
   }
   queuePendingCavbotEvent(eventName, payload || {}, overrides || {});
   return Promise.resolve();
 }

 function persistAnalytics() {
   return analytics;
 }

 function persistEventLog(events) {
   return events || [];
 }

 function trackEvent(eventName, payload, overrides) {
   if (analyticsSuppressedForBrain()) {
     clearPendingCavbotEvents();
     return Promise.resolve();
   }
   var resolvedOverrides = resolveBrainTrackingOverrides(overrides);
   var evt = {
     name: eventName,
     ts: Date.now(),
     sessionId: session.id,
     path: (typeof window !== 'undefined' && window.location)
       ? window.location.pathname + window.location.search
       : '',
     referrer: (typeof document !== 'undefined') ? (document.referrer || '') : '',
     payload: payload || {}
   };

   runtimeEvents.push(evt);
   if (runtimeEvents.length > 80) {
     runtimeEvents.shift();
   }

   persistEventLog(runtimeEvents);

   return cavbotTrack(eventName, payload || {}, resolvedOverrides);
 }

 // ===== CavBot Site Intelligence · Suggestion Engine (SEO / A11y / UX / Perf / Engagement) =====

 var SUGGESTION_SEVERITY_WEIGHT = {
   critical: 4,
   high: 3,
   medium: 2,
   low: 1,
   note: 0
 };

 function clampNumber(value, min, max) {
   if (typeof value !== 'number' || isNaN(value)) return min;
   if (value < min) return min;
   if (value > max) return max;
   return value;
 }

 function coerceScore(value, fallback) {
   if (typeof value === 'number' && !isNaN(value)) {
     return clampNumber(value, 0, 100);
   }
   return fallback;
 }

 function pushSuggestion(list, spec) {
   if (!list) return;
   var suggestion = {
     id: spec.id || null,
     category: spec.category || 'seo',
     severity: spec.severity || 'medium',
     message: spec.message || '',
     hint: spec.hint || '',
     metric: spec.metric || null,
     scoreImpact: typeof spec.scoreImpact === 'number' ? spec.scoreImpact : 0,
     context: spec.context || null
   };
   list.push(suggestion);
 }

 function resolveAbsoluteHrefSafe(rawHref, maxLen) {
   var href = safeString(rawHref || '', 1200);
   if (!href) return null;
   try {
     var resolved = new URL(href, window.location && window.location.href ? window.location.href : undefined);
     return safeString(resolved.toString(), maxLen || 900) || null;
   } catch (e) {
     var fallback = safeString(href, maxLen || 900);
     return fallback || null;
   }
 }

 function relTokenPresent(relValue, token) {
   var rel = safeString(relValue || '', 120).toLowerCase();
   var want = safeString(token || '', 60).toLowerCase();
   if (!rel || !want) return false;
   var parts = rel.split(/\s+/);
   for (var i = 0; i < parts.length; i++) {
     if (parts[i] === want) return true;
   }
   return false;
 }

 function normalizeFaviconSnapshot(raw) {
   if (!raw || typeof raw !== 'object') return null;
   var iconHref = raw.iconHref ? resolveAbsoluteHrefSafe(raw.iconHref, 900) : null;
   var appleTouchHref = raw.appleTouchHref ? resolveAbsoluteHrefSafe(raw.appleTouchHref, 900) : null;
   var manifestHref = raw.manifestHref ? resolveAbsoluteHrefSafe(raw.manifestHref, 900) : null;
   var maskIconHref = raw.maskIconHref ? resolveAbsoluteHrefSafe(raw.maskIconHref, 900) : null;
   var msTileImage = raw.msTileImage ? resolveAbsoluteHrefSafe(raw.msTileImage, 900) : null;
   var hasFavicon = raw.hasFavicon === true;
   if (!hasFavicon && iconHref) {
     hasFavicon = true;
   }
   return {
     hasFavicon: hasFavicon,
     iconHref: iconHref,
     iconType: raw.iconType ? safeString(raw.iconType, 80) : null,
     iconSizes: raw.iconSizes ? safeString(raw.iconSizes, 80) : null,
     iconSizesFound: raw.iconSizesFound ? safeString(raw.iconSizesFound, 240) : null,
     appleTouchHref: appleTouchHref,
     appleTouchSizes: raw.appleTouchSizes ? safeString(raw.appleTouchSizes, 80) : null,
     appleTouchSizesFound: raw.appleTouchSizesFound ? safeString(raw.appleTouchSizesFound, 240) : null,
     manifestHref: manifestHref,
     maskIconHref: maskIconHref,
     maskIconColor: raw.maskIconColor ? safeString(raw.maskIconColor, 80) : null,
     themeColor: raw.themeColor ? safeString(raw.themeColor, 80) : null,
     msTileColor: raw.msTileColor ? safeString(raw.msTileColor, 80) : null,
     msTileImage: msTileImage
   };
 }

 function isWhiteLikeThemeColor(value) {
   var t = safeString(value || '', 80).toLowerCase().replace(/\s+/g, '');
   if (!t) return false;
   if (t === '#fff' || t === '#ffffff' || t === 'white') return true;
   if (t === 'rgb(255,255,255)' || t === 'rgba(255,255,255,1)' || t === 'rgba(255,255,255,1.0)') {
     return true;
   }
   return false;
 }

 function addSizeTokens(rawSizes, set) {
   var text = safeString(rawSizes || '', 120).toLowerCase().trim();
   if (!text) return;
   var tokens = text.split(/\s+/);
   for (var i = 0; i < tokens.length; i++) {
     var token = tokens[i];
     if (!token) continue;
     if (token === 'any') {
       set[token] = 1;
       continue;
     }
     if (/^\d+x\d+$/.test(token)) {
       set[token] = 1;
     }
   }
 }

 function formatSizeTokens(set) {
   var keys = Object.keys(set || {});
   if (!keys.length) return null;
   keys.sort(function (a, b) {
     if (a === 'any') return 1;
     if (b === 'any') return -1;
     var ap = a.split('x');
     var bp = b.split('x');
     var aw = Number(ap[0] || 0);
     var ah = Number(ap[1] || 0);
     var bw = Number(bp[0] || 0);
     var bh = Number(bp[1] || 0);
     if (aw !== bw) return aw - bw;
     return ah - bh;
   });
   return safeString(keys.join(','), 240) || null;
 }

 function readHeadMetaContent(name) {
   if (typeof document === 'undefined' || !document.querySelector) return '';
   try {
     var el = document.querySelector('meta[name="' + name + '"]');
     return el && typeof el.getAttribute === 'function' ? (el.getAttribute('content') || '') : '';
   } catch (e) {
     return '';
   }
 }

 function readFaviconSnapshotFromHead() {
   var empty = {
     hasFavicon: false,
     iconHref: null,
     iconType: null,
     iconSizes: null,
     iconSizesFound: null,
     appleTouchHref: null,
     appleTouchSizes: null,
     appleTouchSizesFound: null,
     manifestHref: null,
     maskIconHref: null,
     maskIconColor: null,
     themeColor: null,
     msTileColor: null,
     msTileImage: null
   };
   if (typeof document === 'undefined' || !document.querySelectorAll) return empty;
   try {
     var links = document.querySelectorAll('link[rel]');
     if (!links || !links.length) return empty;

     var iconCandidates = [];
     var appleTouch = null;
     var manifest = null;
     var maskIcon = null;
     var iconSizeSet = {};
     var appleSizeSet = {};

     for (var i = 0; i < links.length; i++) {
       var link = links[i];
       if (!link || typeof link.getAttribute !== 'function') continue;
       var rel = link.getAttribute('rel') || '';
       var href = resolveAbsoluteHrefSafe(link.getAttribute('href') || '', 900);
       if (!href) continue;

       var sizes = safeString(link.getAttribute('sizes') || '', 80) || null;
       var type = safeString(link.getAttribute('type') || '', 80) || null;

       if (relTokenPresent(rel, 'icon')) {
         iconCandidates.push({ href: href, sizes: sizes, type: type, idx: i });
         addSizeTokens(sizes, iconSizeSet);
       }
       if (relTokenPresent(rel, 'apple-touch-icon')) {
         addSizeTokens(sizes, appleSizeSet);
         if (!appleTouch) {
           appleTouch = { href: href, sizes: sizes };
         }
       }
       if (!manifest && relTokenPresent(rel, 'manifest')) {
         manifest = { href: href };
       }
       if (!maskIcon && relTokenPresent(rel, 'mask-icon')) {
         maskIcon = {
           href: href,
           color: safeString(link.getAttribute('color') || '', 80) || null
         };
       }
     }

     var best = null;
     var bestRank = -1;
     for (var j = 0; j < iconCandidates.length; j++) {
       var candidate = iconCandidates[j];
       var sz = String(candidate.sizes || '').toLowerCase();
       var rank = sz.indexOf('32x32') > -1 ? 3 : (sz.indexOf('16x16') > -1 ? 2 : 1);
       if (!best || rank > bestRank || (rank === bestRank && candidate.idx < best.idx)) {
         best = candidate;
         bestRank = rank;
       }
     }

     return {
       hasFavicon: !!best,
       iconHref: best ? best.href : null,
       iconType: best ? best.type : null,
       iconSizes: best ? best.sizes : null,
       iconSizesFound: formatSizeTokens(iconSizeSet),
       appleTouchHref: appleTouch ? appleTouch.href : null,
       appleTouchSizes: appleTouch ? appleTouch.sizes : null,
       appleTouchSizesFound: formatSizeTokens(appleSizeSet),
       manifestHref: manifest ? manifest.href : null,
       maskIconHref: maskIcon ? maskIcon.href : null,
       maskIconColor: maskIcon ? maskIcon.color : null,
       themeColor: safeString(readHeadMetaContent('theme-color') || '', 80) || null,
       msTileColor: safeString(readHeadMetaContent('msapplication-TileColor') || '', 80) || null,
       msTileImage: resolveAbsoluteHrefSafe(readHeadMetaContent('msapplication-TileImage') || '', 900)
     };
   } catch (e) {
     return empty;
   }
 }

 function elementSelector(el) {
   if (!el || !el.tagName) return '*';
   var tag = String(el.tagName || '').toLowerCase();
   var id = '';
   try { id = el.id || ''; } catch (_e) { id = ''; }
   if (id) return tag + '#' + id;
   var className = '';
   try { className = String(el.className || '').trim(); } catch (_e2) { className = ''; }
   if (className) {
     var firstClass = className.split(/\s+/)[0] || '';
     if (firstClass) return tag + '.' + firstClass;
   }
   var parent = el.parentElement;
   if (!parent || !parent.children) return tag;
   var index = 1;
   for (var i = 0; i < parent.children.length; i++) {
     var child = parent.children[i];
     if (!child || String(child.tagName || '').toLowerCase() !== tag) continue;
     if (child === el) break;
     index += 1;
   }
   return tag + ':nth-of-type(' + index + ')';
 }

 function parseColorValue(raw) {
   var value = String(raw || '').trim().toLowerCase();
   if (!value) return null;
   var hex3 = /^#([0-9a-f]{3})$/i.exec(value);
   if (hex3) {
     var chunk = hex3[1];
     return {
       r: parseInt(chunk.charAt(0) + chunk.charAt(0), 16),
       g: parseInt(chunk.charAt(1) + chunk.charAt(1), 16),
       b: parseInt(chunk.charAt(2) + chunk.charAt(2), 16)
     };
   }
   var hex6 = /^#([0-9a-f]{6})$/i.exec(value);
   if (hex6) {
     var hex = hex6[1];
     return {
       r: parseInt(hex.slice(0, 2), 16),
       g: parseInt(hex.slice(2, 4), 16),
       b: parseInt(hex.slice(4, 6), 16)
     };
   }
   var rgb = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/.exec(value);
   if (rgb) {
     return {
       r: Math.max(0, Math.min(255, Number(rgb[1]))),
       g: Math.max(0, Math.min(255, Number(rgb[2]))),
       b: Math.max(0, Math.min(255, Number(rgb[3])))
     };
   }
   return null;
 }

 function relativeLum(color) {
   if (!color) return 0;
   function ch(v) {
     var n = v / 255;
     return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
   }
   return (0.2126 * ch(color.r)) + (0.7152 * ch(color.g)) + (0.0722 * ch(color.b));
 }

 function contrastRatioFromCss(fgRaw, bgRaw) {
   var fg = parseColorValue(fgRaw);
   var bg = parseColorValue(bgRaw);
   if (!fg || !bg) return null;
   var l1 = relativeLum(fg);
   var l2 = relativeLum(bg);
   var lighter = Math.max(l1, l2);
   var darker = Math.min(l1, l2);
   return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2));
 }

 function readStructuredDataSnapshotFromHead() {
   if (typeof document === 'undefined' || !document.querySelectorAll) {
     return { scripts: [], scriptCount: 0 };
   }
   var scripts = document.querySelectorAll('script[type=\"application/ld+json\"]');
   var rows = [];
   for (var i = 0; i < scripts.length && i < 10; i++) {
     var script = scripts[i];
     if (!script) continue;
     var text = '';
     try { text = String(script.textContent || '').trim(); } catch (_e) { text = ''; }
     if (!text) continue;
     rows.push({
       selector: 'script[type=\"application/ld+json\"]:nth-of-type(' + (i + 1) + ')',
       text: text.slice(0, 40000)
     });
   }
   return {
     scripts: rows,
     scriptCount: rows.length
   };
 }

 function readHeadMetaSnapshotFromDom() {
   if (typeof document === 'undefined' || !document.querySelector) {
     return {
       canonical: null,
       ogSiteName: null,
       ogTitle: null,
       ogUrl: null,
       ogImage: null
     };
   }
   function read(selector, attr) {
     try {
       var el = document.querySelector(selector);
       if (!el || typeof el.getAttribute !== 'function') return null;
       var value = String(el.getAttribute(attr) || '').trim();
       return value || null;
     } catch (_e) {
       return null;
     }
   }
   return {
     canonical: read('link[rel=\"canonical\"]', 'href'),
     ogSiteName: read('meta[property=\"og:site_name\"]', 'content'),
     ogTitle: read('meta[property=\"og:title\"]', 'content'),
     ogUrl: read('meta[property=\"og:url\"]', 'content'),
     ogImage: read('meta[property=\"og:image\"]', 'content')
   };
 }

 function readAccessibilityPlusSnapshotFromDom() {
   if (typeof document === 'undefined' || !document.querySelectorAll) return null;
   try {
     var controls = document.querySelectorAll('button, a[href], input, textarea, select');
     var inputs = document.querySelectorAll('input, textarea, select');
     var headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
     var images = document.querySelectorAll('img');
     var tables = document.querySelectorAll('table');
     var iconButtons = document.querySelectorAll('button');
     var dialogs = document.querySelectorAll('dialog,[role=\"dialog\"],.modal');
     var charts = document.querySelectorAll('canvas,svg,[data-chart]');
     var videos = document.querySelectorAll('video');
     var medias = document.querySelectorAll('audio,video');

     var missingAccessibleNames = 0;
     for (var i = 0; i < controls.length; i++) {
       var control = controls[i];
       var text = String((control && control.textContent) || '').trim();
       var ariaLabel = String((control && control.getAttribute && control.getAttribute('aria-label')) || '').trim();
       var labelledBy = String((control && control.getAttribute && control.getAttribute('aria-labelledby')) || '').trim();
       if (!text && !ariaLabel && !labelledBy) missingAccessibleNames += 1;
     }

     var missingFormLabels = 0;
     var placeholderAsLabelCount = 0;
     for (var j = 0; j < inputs.length; j++) {
       var input = inputs[j];
       var id = String((input && input.getAttribute && input.getAttribute('id')) || '').trim();
       var label = null;
       try {
         label = id ? document.querySelector('label[for=\"' + id.replace(/\"/g, '\\\\\"') + '\"]') : null;
       } catch (_e2) {
         label = null;
       }
       var ariaLabel2 = String((input && input.getAttribute && input.getAttribute('aria-label')) || '').trim();
       var labelledBy2 = String((input && input.getAttribute && input.getAttribute('aria-labelledby')) || '').trim();
       if (!label && !ariaLabel2 && !labelledBy2) {
         missingFormLabels += 1;
         var placeholder = String((input && input.getAttribute && input.getAttribute('placeholder')) || '').trim();
         if (placeholder) placeholderAsLabelCount += 1;
       }
     }

     var headingSkipCount = 0;
     var lastLevel = 0;
     for (var h = 0; h < headings.length; h++) {
       var heading = headings[h];
       var tag = String((heading && heading.tagName) || '').toLowerCase();
       var level = Number(tag.replace('h', '')) || 0;
       if (lastLevel > 0 && level > lastLevel + 1) headingSkipCount += 1;
       if (level > 0) lastLevel = level;
     }

     var focusOutlineRemovedCount = 0;
     for (var f = 0; f < controls.length && f < 60; f++) {
       var node = controls[f];
       if (!node || !window.getComputedStyle) continue;
       var style = window.getComputedStyle(node);
       if (!style) continue;
       if ((style.outlineStyle === 'none' || style.outlineWidth === '0px') && style.boxShadow === 'none') {
         focusOutlineRemovedCount += 1;
       }
     }

     var tabindexMisuseCount = 0;
     var tabNodes = document.querySelectorAll('[tabindex]');
     for (var t = 0; t < tabNodes.length; t++) {
       var tabVal = Number((tabNodes[t].getAttribute('tabindex') || '').trim());
       if (tabVal > 0) tabindexMisuseCount += 1;
     }

     var contrastFailures = [];
     var textNodes = document.querySelectorAll('h1,h2,h3,p,li,button,a,label,span');
     for (var c = 0; c < textNodes.length && contrastFailures.length < 6; c++) {
       var textEl = textNodes[c];
       var textValue = String((textEl && textEl.textContent) || '').replace(/\s+/g, ' ').trim();
       if (textValue.length < 3) continue;
       if (!window.getComputedStyle) continue;
       var textStyle = window.getComputedStyle(textEl);
       if (!textStyle) continue;
       var fg = String(textStyle.color || '').trim();
       var bg = String(textStyle.backgroundColor || '').trim();
       if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
         var parent = textEl.parentElement;
         while (parent && (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
           var parentStyle = window.getComputedStyle(parent);
           bg = String((parentStyle && parentStyle.backgroundColor) || '').trim();
           parent = parent.parentElement;
         }
         if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
           bg = '#ffffff';
         }
       }
       var ratio = contrastRatioFromCss(fg, bg);
       if (ratio != null && ratio < 4.5) {
         contrastFailures.push({
           selector: elementSelector(textEl),
           ratio: ratio,
           fg: fg,
           bg: bg
         });
       }
     }

     var tapTargetsTooSmall = [];
     for (var k = 0; k < controls.length && tapTargetsTooSmall.length < 8; k++) {
       var ctl = controls[k];
       var rect = ctl && typeof ctl.getBoundingClientRect === 'function' ? ctl.getBoundingClientRect() : null;
       if (!rect) continue;
       if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
         tapTargetsTooSmall.push({
           selector: elementSelector(ctl),
           width: Number(rect.width.toFixed(2)),
           height: Number(rect.height.toFixed(2))
         });
       }
     }

     var imageMissingAltCount = 0;
     for (var m = 0; m < images.length; m++) {
       var alt = images[m] && images[m].getAttribute ? images[m].getAttribute('alt') : null;
       if (alt == null || !String(alt).trim()) imageMissingAltCount += 1;
     }

     var autoplayAudioUnmutedCount = 0;
     for (var n = 0; n < medias.length; n++) {
       var media = medias[n];
       var autoplay = !!(media && media.autoplay);
       var muted = !!(media && media.muted);
       if (autoplay && !muted) autoplayAudioUnmutedCount += 1;
     }

     var mediaMissingControlsCount = 0;
     for (var q = 0; q < medias.length; q++) {
       if (!medias[q] || medias[q].controls) continue;
       mediaMissingControlsCount += 1;
     }

     var mediaMissingCaptionsCount = 0;
     for (var v = 0; v < videos.length; v++) {
       var video = videos[v];
       var hasTrack = false;
       try {
         var tracks = video.querySelectorAll('track[kind=\"captions\"], track[kind=\"subtitles\"]');
         hasTrack = !!(tracks && tracks.length);
       } catch (_e3) {
         hasTrack = false;
       }
       if (!hasTrack) mediaMissingCaptionsCount += 1;
     }

     var prefersReducedMotionRespected = true;
     try {
       var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
       if (mq && mq.matches) {
         var animatedNodes = document.querySelectorAll('*');
         for (var an = 0; an < animatedNodes.length && an < 120; an++) {
           var anStyle = window.getComputedStyle(animatedNodes[an]);
           if (!anStyle) continue;
           var dur = parseFloat(String(anStyle.animationDuration || '0').replace('s', '').trim()) || 0;
           var tdur = parseFloat(String(anStyle.transitionDuration || '0').replace('s', '').trim()) || 0;
           if (dur > 0.15 || tdur > 0.15) {
             prefersReducedMotionRespected = false;
             break;
           }
         }
       }
     } catch (_e4) {}

     var tablesMissingHeaderCount = 0;
     for (var tb = 0; tb < tables.length; tb++) {
       var table = tables[tb];
       var hasTh = false;
       try { hasTh = !!(table.querySelector('th')); } catch (_e5) { hasTh = false; }
       if (!hasTh) tablesMissingHeaderCount += 1;
     }

     var iconButtonMissingLabelCount = 0;
     for (var ib = 0; ib < iconButtons.length; ib++) {
       var btn = iconButtons[ib];
       var btnText = String((btn.textContent || '')).trim();
       var aria = String((btn.getAttribute('aria-label') || '')).trim();
       var labelledBy = String((btn.getAttribute('aria-labelledby') || '')).trim();
       var hasSvgOnly = false;
       try {
         hasSvgOnly = !!btn.querySelector('svg, i, [data-icon]');
       } catch (_e6) {}
       if (hasSvgOnly && !btnText && !aria && !labelledBy) iconButtonMissingLabelCount += 1;
     }

     var modalAriaMissingCount = 0;
     for (var md = 0; md < dialogs.length; md++) {
       var dialog = dialogs[md];
       var ariaModal = String((dialog.getAttribute('aria-modal') || '')).trim().toLowerCase();
       if (ariaModal !== 'true') modalAriaMissingCount += 1;
     }

     var chartSummaryMissingCount = 0;
     for (var ch = 0; ch < charts.length; ch++) {
       var chart = charts[ch];
       var hasSummary = false;
       try {
         hasSummary = !!(
           chart.getAttribute('aria-label') ||
           chart.getAttribute('aria-describedby') ||
           (chart.parentElement && chart.parentElement.querySelector && chart.parentElement.querySelector('figcaption,.chart-summary,[data-chart-summary]'))
         );
       } catch (_e7) {
         hasSummary = false;
       }
       if (!hasSummary) chartSummaryMissingCount += 1;
     }

     return {
       missingAccessibleNames: missingAccessibleNames,
       missingFormLabels: missingFormLabels,
       placeholderAsLabelCount: placeholderAsLabelCount,
       hasH1: document.querySelectorAll('h1').length > 0,
       h1Count: document.querySelectorAll('h1').length,
       headingSkipCount: headingSkipCount,
       hasMainLandmark: !!document.querySelector('main,[role=\"main\"]'),
       focusOutlineRemovedCount: focusOutlineRemovedCount,
       tabindexMisuseCount: tabindexMisuseCount,
       focusTrapCount: dialogs.length ? modalAriaMissingCount : 0,
       contrastFailures: contrastFailures,
       tapTargetsTooSmall: tapTargetsTooSmall,
       imageMissingAltCount: imageMissingAltCount,
       autoplayAudioUnmutedCount: autoplayAudioUnmutedCount,
       mediaMissingControlsCount: mediaMissingControlsCount,
       mediaMissingCaptionsCount: mediaMissingCaptionsCount,
       prefersReducedMotionRespected: prefersReducedMotionRespected,
       tablesMissingHeaderCount: tablesMissingHeaderCount,
       iconButtonMissingLabelCount: iconButtonMissingLabelCount,
       modalAriaMissingCount: modalAriaMissingCount,
       chartSummaryMissingCount: chartSummaryMissingCount
     };
   } catch (_err) {
     return null;
   }
 }

 function readUxLayoutSnapshotFromDom(snapshot) {
   if (typeof document === 'undefined' || !document.documentElement) return null;
   try {
     var root = document.documentElement;
     var viewportWidth = root.clientWidth || 0;
     var scrollWidth = root.scrollWidth || 0;
     var horizontalOverflowPx = Math.max(0, scrollWidth - viewportWidth);
     var hasHorizontalOverflow = horizontalOverflowPx > 2;
     var overflowOffenders = [];
     if (hasHorizontalOverflow) {
       var nodes = document.querySelectorAll('body *');
       for (var i = 0; i < nodes.length && overflowOffenders.length < 8; i++) {
         var node = nodes[i];
         if (!node || typeof node.getBoundingClientRect !== 'function') continue;
         var rect = node.getBoundingClientRect();
         if (rect && rect.right - viewportWidth > 2) {
           overflowOffenders.push({
             selector: elementSelector(node),
             overflowPx: Number((rect.right - viewportWidth).toFixed(2))
           });
         }
       }
     }

     var textClipRisks = [];
     var headings = document.querySelectorAll('h1,h2,h3,.headline,[data-headline]');
     for (var h = 0; h < headings.length && textClipRisks.length < 8; h++) {
       var heading = headings[h];
       var style = window.getComputedStyle ? window.getComputedStyle(heading) : null;
       if (!style) continue;
       var overflowMode = String(style.overflow || '').toLowerCase();
       var clipLike = overflowMode === 'hidden' || overflowMode === 'clip';
       if (clipLike && heading.scrollWidth > heading.clientWidth + 2) {
         textClipRisks.push({
           selector: elementSelector(heading),
           overflowMode: overflowMode
         });
       }
     }

     var logo = { existsInHeader: false, altMissing: false, selector: null, estimatedKb: null };
     var header = document.querySelector('header');
     if (header) {
       var logoEl = header.querySelector('img[alt*=\"logo\" i], img[class*=\"logo\" i], [class*=\"logo\" i] img, img');
       if (logoEl && logoEl.tagName && String(logoEl.tagName).toLowerCase() === 'img') {
         logo.existsInHeader = true;
         logo.selector = elementSelector(logoEl);
         var alt = String((logoEl.getAttribute('alt') || '')).trim();
         logo.altMissing = !alt;
         var w = Number(logoEl.naturalWidth || logoEl.width || 0) || 0;
         var hgt = Number(logoEl.naturalHeight || logoEl.height || 0) || 0;
         if (w > 0 && hgt > 0) {
           // rough upper-bound estimate (RGBA bytes) converted to KB
           logo.estimatedKb = Number((((w * hgt * 4) / 1024)).toFixed(0));
         }
       }
     }

     var cls = null;
     try {
       cls = Number(
         (snapshot && snapshot.performance && (snapshot.performance.cls || snapshot.performance.clsP75)) ||
         (snapshot && snapshot.webVitals && (snapshot.webVitals.clsP75 || snapshot.webVitals.cls)) ||
         NaN
       );
       if (!isFinite(cls)) cls = null;
     } catch (_e8) {
       cls = null;
     }

     return {
       hasHorizontalOverflow: hasHorizontalOverflow,
       horizontalOverflowPx: Number(horizontalOverflowPx.toFixed(2)),
       overflowOffenders: overflowOffenders,
       hasViewportMeta: !!document.querySelector('meta[name=\"viewport\"]'),
       textClipRisks: textClipRisks,
       hasLoadingState: !!document.querySelector('[aria-busy=\"true\"], .skeleton, .loading, [data-loading]'),
       cls: cls,
       logo: logo
     };
   } catch (_err2) {
     return null;
   }
 }

 function readTrustPagesSnapshotFromDom() {
   if (typeof document === 'undefined' || !document.querySelectorAll) return null;
   try {
     var links = document.querySelectorAll('a[href]');
     var out = [];
     for (var i = 0; i < links.length && out.length < 160; i++) {
       var link = links[i];
       var href = String((link.getAttribute('href') || '')).trim();
       if (!href) continue;
       var text = String((link.textContent || '')).replace(/\s+/g, ' ').trim();
       var inFooter = false;
       try { inFooter = !!(link.closest && link.closest('footer')); } catch (_e) { inFooter = false; }
       out.push({
         href: href,
         text: text.slice(0, 220),
         inFooter: inFooter
       });
     }
     return { links: out };
   } catch (_err) {
     return null;
   }
 }

 function tokenizeKeywordText(raw) {
   var text = String(raw || '').toLowerCase();
   if (!text) return [];
   var parts = text
     .replace(/https?:\/\/\S+/g, ' ')
     .replace(/[^\w\s-]/g, ' ')
     .split(/\s+/)
     .map(function (item) { return item.trim(); })
     .filter(Boolean);
   var stop = {
     the:1, and:1, for:1, with:1, from:1, this:1, that:1, are:1, was:1, were:1, have:1, has:1, you:1,
     your:1, our:1, but:1, not:1, all:1, can:1, will:1, into:1, about:1, page:1, home:1, more:1
   };
   // Privacy guard: only keep broad site-topic tokens, never free-form personal-like strings.
   var allow = {
     accessibility:1, analytics:1, api:1, app:1, article:1, articles:1, auth:1, billing:1, blog:1, cart:1,
     checkout:1, cloud:1, company:1, compliance:1, contact:1, conversion:1, cookies:1, dashboard:1,
     delivery:1, design:1, developer:1, development:1, docs:1, ecommerce:1, engineering:1, feature:1,
     features:1, guide:1, guides:1, help:1, integration:1, integrations:1, onboarding:1, performance:1,
     platform:1, policy:1, portfolio:1, pricing:1, privacy:1, product:1, products:1, refund:1, refunds:1,
     reliability:1, resource:1, resources:1, returns:1, review:1, reviews:1, security:1, service:1,
     services:1, shipping:1, software:1, solutions:1, support:1, terms:1, trust:1, tutorial:1, tutorials:1,
     ux:1, website:1
   };
   var out = [];
   for (var i = 0; i < parts.length; i++) {
     var token = parts[i];
     if (!token) continue;
     if (token.length < 3 || token.length > 32) continue;
     if (/@/.test(token)) continue; // avoid emails/handles
     if (/\d{3,}/.test(token)) continue;
     if (stop[token]) continue;
     if (!allow[token]) continue;
     out.push(token);
   }
   return out;
 }

 function readKeywordSignalsFromDom() {
   if (typeof document === 'undefined' || !document.querySelectorAll) return null;
   try {
     var sources = [];
     var title = String(document.title || '').trim();
     if (title) sources.push({ source: 'title', text: title });
     var md = document.querySelector('meta[name=\"description\"]');
     var mdContent = md && md.getAttribute ? String(md.getAttribute('content') || '').trim() : '';
     if (mdContent) sources.push({ source: 'meta[name=\"description\"]', text: mdContent });
     var h1 = document.querySelector('h1');
     if (h1) sources.push({ source: 'h1', text: String(h1.textContent || '').trim() });
     var h2s = document.querySelectorAll('h2');
     for (var h = 0; h < h2s.length && h < 8; h++) {
       sources.push({ source: 'h2', text: String(h2s[h].textContent || '').trim() });
     }
     var navLinks = document.querySelectorAll('nav a[href]');
     for (var n = 0; n < navLinks.length && n < 12; n++) {
       sources.push({ source: 'nav a', text: String(navLinks[n].textContent || '').trim() });
     }
     var main = document.querySelector('main');
     if (main) {
       var mainText = String(main.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2400);
       if (mainText) sources.push({ source: 'main', text: mainText });
     }

     var counts = {};
     var sourceMap = {};
     for (var i = 0; i < sources.length; i++) {
       var source = sources[i];
       var tokens = tokenizeKeywordText(source.text);
       for (var t = 0; t < tokens.length; t++) {
         var token = tokens[t];
         counts[token] = (counts[token] || 0) + 1;
         if (!sourceMap[token]) sourceMap[token] = {};
         sourceMap[token][source.source] = 1;
       }
     }

     var entries = Object.keys(counts).map(function (key) {
       return {
         term: key,
         count: counts[key],
         sources: Object.keys(sourceMap[key] || {}).sort().slice(0, 6)
       };
     });
     entries.sort(function (a, b) {
       if (b.count !== a.count) return b.count - a.count;
       return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
     });

     return {
       candidates: entries.slice(0, 40)
     };
   } catch (_err) {
     return null;
   }
 }

 function readNavigationSnapshotFromDom() {
   if (typeof document === 'undefined' || !document.querySelector) return null;
   try {
     var header = document.querySelector('header');
     var hasHomeLink = !!document.querySelector('header a[href=\"/\"], header a[aria-label*=\"home\" i], a[href=\"/\"]');
     var hasNavLandmark = !!document.querySelector('nav,[role=\"navigation\"]');
     var backToTop = document.querySelector('a[href=\"#top\"], [data-back-to-top]');
     var hasTopTarget = !!document.querySelector('#top');
     return {
       hasHomeLink: hasHomeLink,
       hasNavLandmark: hasNavLandmark,
       backToTopBroken: !!backToTop && !hasTopTarget,
       inconsistentAcrossPages: null,
       headerDetected: !!header
     };
   } catch (_err) {
     return null;
   }
 }

 function readReliability404SnapshotFromDom() {
   if (typeof document === 'undefined' || !document.querySelectorAll) return null;
   try {
     var links = document.querySelectorAll('a[href]');
     var internal = [];
     var seen = {};
     for (var i = 0; i < links.length && internal.length < 40; i++) {
       var href = String((links[i].getAttribute('href') || '')).trim();
       if (!href) continue;
       if (href.charAt(0) === '#') continue;
       if (/^javascript:/i.test(href)) continue;
       if (/^mailto:/i.test(href)) continue;
       if (/^tel:/i.test(href)) continue;
       if (/^https?:\/\//i.test(href)) {
         try {
           var resolved = new URL(href, window.location.href);
           if (resolved.origin !== window.location.origin) continue;
           href = (resolved.pathname || '/') + (resolved.search || '');
         } catch (_e) {
           continue;
         }
       }
       if (href.charAt(0) !== '/') continue;
       if (seen[href]) continue;
       seen[href] = 1;
       internal.push(href);
     }

     var bodyText = '';
     try {
       bodyText = String((document.body && document.body.textContent) || '').toLowerCase().slice(0, 1000);
     } catch (_e2) {
       bodyText = '';
     }

     var on404LikePage = /404|not found|page not found/.test(bodyText);
     var hasHomeLinkOn404 = !!document.querySelector('main a[href=\"/\"], a[href=\"/\"]');

     return {
       internalLinks: internal,
       hasCustom404Page: on404LikePage ? true : null,
       hasHomeLinkOn404: hasHomeLinkOn404
     };
   } catch (_err) {
     return null;
   }
 }

 function readAuthFunnelSnapshotFromSummary(snapshot) {
   var auth = (snapshot && (snapshot.auth || snapshot.authFunnel || (snapshot.metrics && snapshot.metrics.auth))) || null;
   if (!auth || typeof auth !== 'object') return null;
   var toNum = function (value) {
     var n = Number(value);
     return isFinite(n) ? n : 0;
   };
   return {
     loginAttempts: toNum(auth.loginAttempts || auth.login_attempts || auth.loginTotal),
     loginFailures: toNum(auth.loginFailures || auth.login_failures || auth.loginFailed),
     signupAttempts: toNum(auth.signupAttempts || auth.signup_attempts || auth.signupTotal),
     signupFailures: toNum(auth.signupFailures || auth.signup_failures || auth.signupFailed),
     errorClusters: Array.isArray(auth.errorClusters) ? auth.errorClusters.slice(0, 20) : []
   };
 }

 function readGeoTrendSnapshotFromSummary(snapshot) {
   var geo = (snapshot && (snapshot.geo || (snapshot.metrics && snapshot.metrics.geo))) || null;
   if (!geo || typeof geo !== 'object') return null;
   var countries = Array.isArray(geo.countries) ? geo.countries : [];
   return {
     countries: countries.slice(0, 20).map(function (row) {
       if (!row || typeof row !== 'object') return null;
       var country = String(row.country || row.countryCode || '').trim();
       var share = Number(row.sharePct || row.share || row.pageViewsPct || 0);
       if (!country) return null;
       return {
         country: country,
         sharePct: isFinite(share) ? share : 0
       };
     }).filter(Boolean)
   };
 }

 // --- SEO suggestions (on-page + structure) ---

 function buildSeoSuggestions(diag) {
   var suggestions = [];
   if (!diag || typeof diag !== 'object') return suggestions;

   if (!diag.hasTitle) {
     pushSuggestion(suggestions, {
       id: 'missing_title',
       category: 'seo',
       severity: 'high',
       message: 'Add a clear, unique <title> tag for this page.',
       hint: 'Aim for 45–60 characters that naturally include your primary keyword and feel human to read.',
       metric: 'title',
       scoreImpact: 8
     });
   }

   if (typeof diag.titleLength === 'number' && diag.hasTitle) {
     if (diag.titleLength < 25) {
       pushSuggestion(suggestions, {
         id: 'short_title',
         category: 'seo',
         severity: 'medium',
         message: 'Title is very short.',
         hint: 'Give search engines and users more context; aim for a descriptive, compelling title, not just 1–2 words.',
         metric: 'titleLength',
         scoreImpact: 3
       });
     } else if (diag.titleLength > 65) {
       pushSuggestion(suggestions, {
         id: 'long_title',
         category: 'seo',
         severity: 'medium',
         message: 'Title is likely to be truncated in search results.',
         hint: 'Keep titles within roughly 45–65 characters so the most important part remains visible.',
         metric: 'titleLength',
         scoreImpact: 3
       });
     }
   }

   if (!diag.hasMetaDescription) {
     pushSuggestion(suggestions, {
       id: 'missing_meta_description',
       category: 'seo',
       severity: 'high',
       message: 'Add a meta description.',
       hint: 'Write 140–160 characters that summarize the page and encourage clicks from search results.',
       metric: 'metaDescription',
       scoreImpact: 6
     });
   }

   if (typeof diag.metaDescriptionLength === 'number' && diag.hasMetaDescription) {
     if (diag.metaDescriptionLength < 80) {
       pushSuggestion(suggestions, {
         id: 'short_meta_description',
         category: 'seo',
         severity: 'medium',
         message: 'Meta description is quite short.',
         hint: 'Use the meta description to answer “Why should I click?” in 1–2 concise sentences.',
         metric: 'metaDescriptionLength',
         scoreImpact: 2
       });
     } else if (diag.metaDescriptionLength > 180) {
       pushSuggestion(suggestions, {
         id: 'long_meta_description',
         category: 'seo',
         severity: 'low',
         message: 'Meta description may be too long.',
         hint: 'Keep descriptions roughly in the 140–160 character range to avoid truncation.',
         metric: 'metaDescriptionLength',
         scoreImpact: 1
       });
     }
   }

   if (diag.indexable === false) {
     pushSuggestion(suggestions, {
       id: 'noindex',
       category: 'seo',
       severity: 'critical',
       message: 'This page is currently not indexable.',
       hint: 'Remove noindex from the robots meta or HTTP header if you want this page to appear in search.',
       metric: 'indexable',
       scoreImpact: 12
     });
   }

   if (diag.h1Count === 0) {
     pushSuggestion(suggestions, {
       id: 'missing_h1',
       category: 'seo',
       severity: 'medium',
       message: 'Add a primary H1 heading.',
       hint: 'Use a single H1 that clearly states the main topic of the page and matches search intent.',
       metric: 'h1Count',
       scoreImpact: 4
     });
   } else if (diag.h1Count > 1) {
     pushSuggestion(suggestions, {
       id: 'multiple_h1',
       category: 'seo',
       severity: 'medium',
       message: 'Multiple H1 headings detected.',
       hint: 'Limit each page to one H1 and use H2 / H3 to build a clear content hierarchy.',
       metric: 'h1Count',
       scoreImpact: 3
     });
   }

   if (typeof diag.wordCount === 'number' && diag.wordCount < 150) {
     pushSuggestion(suggestions, {
       id: 'thin_content',
       category: 'seo',
       severity: 'medium',
       message: 'Content is very thin.',
       hint: 'Expand the page with genuinely useful, descriptive content that answers the questions users bring.',
       metric: 'wordCount',
       scoreImpact: 4
     });
   }

   if (typeof diag.wordCount === 'number' && diag.wordCount >= 150 && diag.wordCount < 400) {
     pushSuggestion(suggestions, {
       id: 'light_content',
       category: 'seo',
       severity: 'low',
       message: 'Content is somewhat light.',
       hint: 'Consider adding a bit more depth—examples, FAQs, or supporting sections—to strengthen relevance.',
       metric: 'wordCount',
       scoreImpact: 2
     });
   }

   if (diag.imageCount > 0 && typeof diag.imagesMissingAlt === 'number') {
     var ratio = diag.imagesMissingAlt / diag.imageCount;
     if (ratio > 0.3) {
       pushSuggestion(suggestions, {
         id: 'missing_alt_text',
         category: 'seo',
         severity: 'medium',
         message: 'Many images are missing alt text.',
         hint: 'Add short, descriptive alt attributes so search engines and screen readers understand each image.',
         metric: 'imagesMissingAlt',
         scoreImpact: 4
       });
     }
   }

   if (!diag.hasViewport) {
     pushSuggestion(suggestions, {
       id: 'missing_viewport',
       category: 'seo',
       severity: 'medium',
       message: 'Missing responsive viewport meta tag.',
       hint: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to improve mobile experience and SEO.',
       metric: 'viewport',
       scoreImpact: 3
     });
   }

   if (!diag.hasLang) {
     pushSuggestion(suggestions, {
       id: 'missing_lang',
       category: 'accessibility',
       severity: 'low',
       message: 'Missing lang attribute on <html>.',
       hint: 'Add lang="en" or the correct language code to help screen readers and search engines interpret the page.',
       metric: 'htmlLang',
       scoreImpact: 2
     });
   }

   if (!diag.hasOg || !diag.hasTwitter) {
     pushSuggestion(suggestions, {
       id: 'social_tags',
       category: 'seo',
       severity: 'low',
       message: 'Social sharing tags are incomplete.',
       hint: 'Add Open Graph and Twitter meta tags so links to this page render strong, branded previews.',
       metric: 'socialMeta',
       scoreImpact: 2
     });
   }

   var favicon = normalizeFaviconSnapshot(diag.favicon);
   if (favicon && favicon.hasFavicon === false) {
     pushSuggestion(suggestions, {
       id: 'missing_favicon',
       category: 'seo',
       severity: 'medium',
       message: 'No favicon link detected in the page head.',
       hint: 'Add a favicon set and head links so tabs, bookmarks, and browser UI display your brand icon reliably.',
       metric: 'favicon',
       scoreImpact: 3
     });
   }

   if (favicon && favicon.hasFavicon === true && !favicon.appleTouchHref) {
     pushSuggestion(suggestions, {
       id: 'missing_apple_touch_icon',
       category: 'seo',
       severity: 'low',
       message: 'Apple touch icon is missing.',
       hint: 'Add <link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\"> for iOS home-screen quality.',
       metric: 'appleTouchIcon',
       scoreImpact: 1
     });
   }

   if (favicon && favicon.hasFavicon === true && !favicon.manifestHref) {
     pushSuggestion(suggestions, {
       id: 'missing_web_manifest_icon_set',
       category: 'seo',
       severity: 'note',
       message: 'Web manifest icon set is missing.',
       hint: 'Add /site.webmanifest with 192x192 and 512x512 icons to improve installability and PWA branding.',
       metric: 'manifest',
       scoreImpact: 1
     });
   }

   if (favicon && favicon.hasFavicon === true) {
     var themeColor = safeString(favicon.themeColor || '', 80);
     if (!themeColor || isWhiteLikeThemeColor(themeColor)) {
       pushSuggestion(suggestions, {
         id: 'theme_color_needs_branding',
         category: 'ux',
         severity: 'low',
         message: 'Theme color is missing or too generic.',
         hint: 'Set <meta name="theme-color"> (and msapplication tile color) to a brand-safe value so browser surfaces do not default to plain white.',
         metric: 'themeColor',
         scoreImpact: 1
       });
     }
   }

   // Advanced SEO structure / technical

   if (diag.hasCanonical === false) {
     pushSuggestion(suggestions, {
       id: 'missing_canonical',
       category: 'seo',
       severity: 'medium',
       message: 'No canonical URL specified for this page.',
       hint: 'Add a <link rel="canonical"> pointing to the preferred URL to consolidate ranking signals.',
       metric: 'canonical',
       scoreImpact: 3
     });
   }

   if (diag.canonicalConflict === true) {
     pushSuggestion(suggestions, {
       id: 'canonical_conflict',
       category: 'seo',
       severity: 'high',
       message: 'Canonical URL may conflict with the requested URL.',
       hint: 'Verify that the canonical points to the correct version of this content and that you’re not self-cannibalizing rankings.',
       metric: 'canonical',
       scoreImpact: 6
     });
   }

   if (typeof diag.urlLength === 'number' && diag.urlLength > 120) {
     pushSuggestion(suggestions, {
       id: 'long_url',
       category: 'seo',
       severity: 'low',
       message: 'URL path is very long.',
       hint: 'Shorten the URL where possible to keep it readable and shareable while retaining important keywords.',
       metric: 'urlLength',
       scoreImpact: 2
     });
   }

   if (typeof diag.urlDepth === 'number' && diag.urlDepth > 4) {
     pushSuggestion(suggestions, {
       id: 'deep_url',
       category: 'seo',
       severity: 'low',
       message: 'This URL is deeply nested.',
       hint: 'Consider simplifying your directory depth for better crawlability and a clearer information architecture.',
       metric: 'urlDepth',
       scoreImpact: 2
     });
   }

   if (typeof diag.internalLinkCount === 'number' && diag.internalLinkCount < 3) {
     pushSuggestion(suggestions, {
       id: 'few_internal_links',
       category: 'seo',
       severity: 'medium',
       message: 'Very few internal links point to or from this page.',
       hint: 'Add contextual internal links so this page is woven into your site structure and easier for crawlers and users to reach.',
       metric: 'internalLinkCount',
       scoreImpact: 4
     });
   }

   if (typeof diag.brokenLinkCount === 'number' && diag.brokenLinkCount > 0) {
     pushSuggestion(suggestions, {
       id: 'broken_links',
       category: 'seo',
       severity: diag.brokenLinkCount > 3 ? 'high' : 'medium',
       message: 'Broken links detected.',
       hint: 'Fix or remove broken internal and external links to avoid sending users into dead ends and wasting crawl budget.',
       metric: 'brokenLinkCount',
       scoreImpact: 5
     });
   }

   if (diag.duplicateTitle === true) {
     pushSuggestion(suggestions, {
       id: 'duplicate_title',
       category: 'seo',
       severity: 'medium',
       message: 'Page title appears to be duplicated on multiple URLs.',
       hint: 'Differentiate this page with a unique, intent-matched title to avoid internal competition in search.',
       metric: 'duplicateTitle',
       scoreImpact: 4
     });
   }

   if (diag.duplicateMetaDescription === true) {
     pushSuggestion(suggestions, {
       id: 'duplicate_meta_description',
       category: 'seo',
       severity: 'low',
       message: 'Meta description appears to be reused on other pages.',
       hint: 'Write a description that reflects the specific value of this page instead of reusing generic copy.',
       metric: 'duplicateMetaDescription',
       scoreImpact: 2
     });
   }

   if (diag.hasStructuredData === false && diag.contentType) {
     pushSuggestion(suggestions, {
       id: 'missing_structured_data',
       category: 'seo',
       severity: 'low',
       message: 'Structured data is missing for this content type.',
       hint: 'Consider adding schema.org structured data (e.g. Article, Product, LocalBusiness) to unlock richer search results.',
       metric: 'structuredData',
       scoreImpact: 3
     });
   }

   return suggestions;
 }

 // --- Accessibility suggestions ---

 function buildAccessibilitySuggestions(a11y) {
   var suggestions = [];
   if (!a11y || typeof a11y !== 'object') return suggestions;

   if (typeof a11y.colorContrastIssues === 'number' && a11y.colorContrastIssues > 0) {
     pushSuggestion(suggestions, {
       id: 'color_contrast',
       category: 'accessibility',
       severity: a11y.colorContrastIssues > 5 ? 'high' : 'medium',
       message: 'Color contrast issues detected.',
       hint: 'Increase contrast between text and background to meet WCAG guidelines, especially for body copy and buttons.',
       metric: 'colorContrastIssues',
       scoreImpact: 7
     });
   }

   if (typeof a11y.missingAlt === 'number' && a11y.missingAlt > 0) {
     pushSuggestion(suggestions, {
       id: 'a11y_missing_alt',
       category: 'accessibility',
       severity: 'medium',
       message: 'Images without alt text detected.',
       hint: 'Add meaningful alt attributes for images that convey information. Decorative images can use empty alt="" attributes.',
       metric: 'missingAlt',
       scoreImpact: 4
     });
   }

   if (typeof a11y.missingFormLabels === 'number' && a11y.missingFormLabels > 0) {
     pushSuggestion(suggestions, {
       id: 'missing_form_labels',
       category: 'accessibility',
       severity: 'high',
       message: 'Form inputs without labels detected.',
       hint: 'Associate every input with a visible <label> or ARIA label so assistive technologies can announce it properly.',
       metric: 'missingFormLabels',
       scoreImpact: 8
     });
   }

   if (typeof a11y.focusVisibleIssues === 'number' && a11y.focusVisibleIssues > 0) {
     pushSuggestion(suggestions, {
       id: 'focus_visible',
       category: 'accessibility',
       severity: 'medium',
       message: 'Keyboard focus states are difficult to see or missing.',
       hint: 'Ensure interactive elements have a clearly visible focus outline so keyboard users can track their position.',
       metric: 'focusVisibleIssues',
       scoreImpact: 5
     });
   }

   if (typeof a11y.keyboardTrapCount === 'number' && a11y.keyboardTrapCount > 0) {
     pushSuggestion(suggestions, {
       id: 'keyboard_trap',
       category: 'accessibility',
       severity: 'critical',
       message: 'Potential keyboard trap detected.',
       hint: 'Review dialogs/menus so keyboard users can both reach and exit them using Tab/Shift+Tab and Escape.',
       metric: 'keyboardTrapCount',
       scoreImpact: 12
     });
   }

   if (a11y.headingOrderIssues === true) {
     pushSuggestion(suggestions, {
       id: 'heading_order',
       category: 'accessibility',
       severity: 'medium',
       message: 'Heading levels may be out of logical order.',
       hint: 'Use headings in sequence (H1 → H2 → H3) to reflect the actual structure of the content.',
       metric: 'headingOrderIssues',
       scoreImpact: 4
     });
   }

   if (a11y.landmarkIssues === true) {
     pushSuggestion(suggestions, {
       id: 'landmarks',
       category: 'accessibility',
       severity: 'low',
       message: 'Landmark regions are incomplete or missing.',
       hint: 'Add ARIA landmarks (main, nav, header, footer) to help assistive tech users navigate by regions.',
       metric: 'landmarkIssues',
       scoreImpact: 2
     });
   }

   if (a11y.hasSkipLink === false) {
     pushSuggestion(suggestions, {
       id: 'skip_link',
       category: 'accessibility',
       severity: 'low',
       message: 'Skip-to-content link not detected.',
       hint: 'Consider adding a “Skip to main content” link at the top of the page for keyboard users.',
       metric: 'hasSkipLink',
       scoreImpact: 2
     });
   }

   if (a11y.prefersReducedMotionRespected === false) {
     pushSuggestion(suggestions, {
       id: 'reduced_motion',
       category: 'accessibility',
       severity: 'medium',
       message: 'Prefers-reduced-motion is not fully respected.',
       hint: 'Honor the prefers-reduced-motion media query by toning down or disabling large animations where possible.',
       metric: 'prefersReducedMotion',
       scoreImpact: 4
     });
   }

   return suggestions;
 }

 // --- Performance suggestions (runtime feel / loading) ---

 function buildPerformanceSuggestions(perf) {
   var suggestions = [];
   if (!perf || typeof perf !== 'object') return suggestions;

   if (typeof perf.lcpMs === 'number') {
     if (perf.lcpMs > 4000) {
       pushSuggestion(suggestions, {
         id: 'lcp_slow',
         category: 'performance',
         severity: 'high',
         message: 'Largest Contentful Paint (LCP) is slow.',
         hint: 'Optimize your hero image, critical CSS, and server response so the main content appears within ~2.5s.',
         metric: 'lcpMs',
         scoreImpact: 8
       });
     } else if (perf.lcpMs > 2500) {
       pushSuggestion(suggestions, {
         id: 'lcp_borderline',
         category: 'performance',
         severity: 'medium',
         message: 'Largest Contentful Paint could be faster.',
         hint: 'Audit above-the-fold content and defer non-critical scripts to bring LCP closer to 2.5s.',
         metric: 'lcpMs',
         scoreImpact: 4
       });
     }
   }

   if (typeof perf.cls === 'number' && perf.cls > 0.1) {
     pushSuggestion(suggestions, {
       id: 'cls_high',
       category: 'performance',
       severity: perf.cls > 0.25 ? 'high' : 'medium',
       message: 'Cumulative Layout Shift (CLS) is high.',
       hint: 'Reserve space for images and embeds, and avoid inserting content above existing content after load.',
       metric: 'cls',
       scoreImpact: 7
     });
   }

   if (typeof perf.totalBlockingTimeMs === 'number' && perf.totalBlockingTimeMs > 300) {
     pushSuggestion(suggestions, {
       id: 'tbt_high',
       category: 'performance',
       severity: 'high',
       message: 'Long tasks are blocking the main thread.',
       hint: 'Split heavy JavaScript into smaller chunks and defer non-critical work so the UI stays responsive.',
       metric: 'totalBlockingTimeMs',
       scoreImpact: 8
     });
   }

   if (typeof perf.javascriptBytesKb === 'number' && perf.javascriptBytesKb > 300) {
     pushSuggestion(suggestions, {
       id: 'js_bundle_size',
       category: 'performance',
       severity: 'medium',
       message: 'JavaScript bundle size is heavy.',
       hint: 'Remove unused libraries, tree-shake imports, and lazy-load routes to keep shipped JS lean.',
       metric: 'javascriptBytesKb',
       scoreImpact: 5
     });
   }

   if (typeof perf.imageBytesKb === 'number' && perf.imageBytesKb > 1000) {
     pushSuggestion(suggestions, {
       id: 'large_images',
       category: 'performance',
       severity: 'medium',
       message: 'Images contribute a lot of weight.',
       hint: 'Use modern formats (WebP/AVIF), compress images, and avoid sending full-resolution assets where not needed.',
       metric: 'imageBytesKb',
       scoreImpact: 5
     });
   }

   if (perf.usesLazyLoading === false && perf.imageCountAboveFold > 0) {
     pushSuggestion(suggestions, {
       id: 'lazy_loading',
       category: 'performance',
       severity: 'low',
       message: 'Images below the fold are not lazy-loaded.',
       hint: 'Enable loading="lazy" for non-critical images to delay their loading until needed.',
       metric: 'usesLazyLoading',
       scoreImpact: 3
     });
   }

   return suggestions;
 }

 // --- UX suggestions (layout, navigation, interaction) ---

 function buildUxSuggestions(ux) {
   var suggestions = [];
   if (!ux || typeof ux !== 'object') return suggestions;

   if (ux.navDepth && ux.navDepth > 3) {
     pushSuggestion(suggestions, {
       id: 'deep_navigation',
       category: 'ux',
       severity: 'medium',
       message: 'Navigation may feel deep or complex.',
       hint: 'Flatten key navigation paths so important pages are accessible within 1–2 clicks.',
       metric: 'navDepth',
       scoreImpact: 3
     });
   }

   if (ux.hasCompetingPrimaryButtons === true) {
     pushSuggestion(suggestions, {
       id: 'competing_ctas',
       category: 'ux',
       severity: 'medium',
       message: 'Multiple primary CTAs compete for attention.',
       hint: 'Choose a single primary action per view and downgrade others to secondary styles.',
       metric: 'hasCompetingPrimaryButtons',
       scoreImpact: 3
     });
   }

   if (ux.heroAboveFoldMessageWeak === true) {
     pushSuggestion(suggestions, {
       id: 'weak_hero_message',
       category: 'ux',
       severity: 'medium',
       message: 'Hero section may not clearly state what this page is about.',
       hint: 'Refine your main headline and subcopy so a new visitor understands the product within a few seconds.',
       metric: 'heroClarity',
       scoreImpact: 4
     });
   }

   if (ux.hasAutoPlayingMedia === true && ux.mutedByDefault === false) {
     pushSuggestion(suggestions, {
       id: 'autoplay_media',
       category: 'ux',
       severity: 'medium',
       message: 'Autoplaying media with sound can be disruptive.',
       hint: 'Avoid auto-playing audio; let users choose when to play and keep sound muted by default if autoplay is necessary.',
       metric: 'autoplayMedia',
       scoreImpact: 3
     });
   }

   if (ux.modalCountOnLoad && ux.modalCountOnLoad > 0) {
     pushSuggestion(suggestions, {
       id: 'onload_modals',
       category: 'ux',
       severity: ux.modalCountOnLoad > 1 ? 'medium' : 'low',
       message: 'Modals or popups appear immediately on page load.',
       hint: 'Consider showing modals after engagement (scroll, time on page) rather than blocking the initial experience.',
       metric: 'modalCountOnLoad',
       scoreImpact: 3
     });
   }

   return suggestions;
 }

 // --- Engagement suggestions (clicks, scroll, behavior) ---

 function buildEngagementSuggestions(eng) {
   var suggestions = [];
   if (!eng || typeof eng !== 'object') return suggestions;

   if (typeof eng.bounceRate === 'number' && eng.bounceRate > 0.6) {
     pushSuggestion(suggestions, {
       id: 'high_bounce',
       category: 'engagement',
       severity: 'medium',
       message: 'Bounce rate looks high.',
       hint: 'Check whether the page answers the query quickly, loads fast, and offers a clear next step above the fold.',
       metric: 'bounceRate',
       scoreImpact: 4
     });
   }

   if (typeof eng.avgScrollDepth === 'number' && eng.avgScrollDepth < 0.4) {
     pushSuggestion(suggestions, {
       id: 'shallow_scroll',
       category: 'engagement',
       severity: 'medium',
       message: 'Most users are not scrolling very far.',
       hint: 'Bring key content and CTAs higher on the page and reduce “hero-only” fluff that blocks progression.',
       metric: 'avgScrollDepth',
       scoreImpact: 3
     });
   }

   if (
     typeof eng.primaryCtaImpressions === 'number' &&
     eng.primaryCtaImpressions > 30 &&
     typeof eng.primaryCtaClicks === 'number'
   ) {
     var ctr = eng.primaryCtaClicks / Math.max(1, eng.primaryCtaImpressions);
     if (ctr < 0.05) {
       pushSuggestion(suggestions, {
         id: 'low_cta_ctr',
         category: 'engagement',
         severity: 'medium',
         message: 'Primary call-to-action button has a low click-through rate.',
         hint: 'Experiment with clearer copy (e.g. “Start free trial” instead of “Learn more”), stronger contrast, and positioning above the fold.',
         metric: 'primaryCtaCtr',
         scoreImpact: 4,
         context: { ctr: ctr }
       });
     }
   }

   if (typeof eng.returnVisitorShare === 'number' && eng.returnVisitorShare < 0.1) {
     pushSuggestion(suggestions, {
       id: 'low_return_visitors',
       category: 'engagement',
       severity: 'low',
       message: 'Few visitors are coming back.',
       hint: 'Consider adding content worth returning for—blog posts, release notes, or resources—and simple ways to follow or subscribe.',
       metric: 'returnVisitorShare',
       scoreImpact: 2
     });
   }

   return suggestions;
 }

 // --- Aggregator + scoring + coach voice ---

 function buildCavbotSuggestions(snapshot) {
   snapshot = snapshot || {};
   var all = [];

   var seoSuggestions = buildSeoSuggestions(snapshot.seo);
   var a11ySuggestions = buildAccessibilitySuggestions(snapshot.accessibility);
   var perfSuggestions = buildPerformanceSuggestions(snapshot.performance);
   var uxSuggestions = buildUxSuggestions(snapshot.ux);
   var engagementSuggestions = buildEngagementSuggestions(snapshot.engagement);

   Array.prototype.push.apply(all, seoSuggestions);
   Array.prototype.push.apply(all, a11ySuggestions);
   Array.prototype.push.apply(all, perfSuggestions);
   Array.prototype.push.apply(all, uxSuggestions);
   Array.prototype.push.apply(all, engagementSuggestions);

   // Sort by severity (critical → low), then category
   all.sort(function (a, b) {
     var wa = SUGGESTION_SEVERITY_WEIGHT[a.severity] || 0;
     var wb = SUGGESTION_SEVERITY_WEIGHT[b.severity] || 0;
     if (wa !== wb) return wb - wa;
     if (a.category < b.category) return -1;
     if (a.category > b.category) return 1;
     return 0;
   });

   return all;
 }

 function computeHealthScores(snapshot) {
   snapshot = snapshot || {};
   var seoScore = coerceScore(snapshot.seo && snapshot.seo.seoScore, 80);
   var perfScore = coerceScore(
     snapshot.performance &&
     (snapshot.performance.perfScore || snapshot.performance.runtimeFeelScore),
     80
   );
   var a11yScore = coerceScore(
     snapshot.accessibility && snapshot.accessibility.accessibilityScore,
     80
   );
   var uxScore = coerceScore(snapshot.ux && snapshot.ux.uxScore, 80);
   var engagementScore = coerceScore(
     snapshot.engagement && snapshot.engagement.engagementScore,
     80
   );

   var weights = {
     seo: 0.35,
     performance: 0.20,
     accessibility: 0.20,
     ux: 0.15,
     engagement: 0.10
   };

   var overall = Math.round(
     seoScore * weights.seo +
     perfScore * weights.performance +
     a11yScore * weights.accessibility +
     uxScore * weights.ux +
     engagementScore * weights.engagement
   );

   return {
     overall: clampNumber(overall, 0, 100),
     seo: seoScore,
     performance: perfScore,
     accessibility: a11yScore,
     ux: uxScore,
     engagement: engagementScore
   };
 }

 function buildCoachMessage(snapshot) {
   var suggestions = buildCavbotSuggestions(snapshot || {});
   var scores = computeHealthScores(snapshot || {});

   if (!suggestions.length) {
     return 'System check: this page looks healthy. No high-severity issues detected. Keep an eye on performance and accessibility as you ship new changes.';
   }

   var countsBySeverity = {
     critical: 0,
     high: 0,
     medium: 0,
     low: 0,
     note: 0
   };
   var countsByCategory = {};

   suggestions.forEach(function (s) {
     if (countsBySeverity[s.severity] != null) {
       countsBySeverity[s.severity] += 1;
     }
     var cat = s.category || 'other';
     countsByCategory[cat] = (countsByCategory[cat] || 0) + 1;
   });

   var topCategories = Object.keys(countsByCategory)
     .sort(function (a, b) {
       return countsByCategory[b] - countsByCategory[a];
     })
     .slice(0, 2);

   var totalCritical = countsBySeverity.critical;
   var totalHigh = countsBySeverity.high;
   var totalMedium = countsBySeverity.medium;

   var line1 = 'Health snapshot · overall ' + scores.overall + '/100.';
   var line2 = '';
   var line3 = '';

   if (totalCritical + totalHigh > 0) {
     line2 =
       'I’m seeing ' +
       (totalCritical > 0 ? totalCritical + ' critical ' : '') +
       (totalCritical > 0 && totalHigh > 0 ? 'and ' : '') +
       (totalHigh > 0 ? totalHigh + ' high-severity ' : '') +
       'items to fix first.';
   } else if (totalMedium > 0) {
     line2 =
       'Most issues here are medium impact. Cleaning them up will steadily push this page into the 90s.';
   } else {
     line2 =
       'Remaining issues are mostly low impact—good candidates to refine once core features are stable.';
   }

   if (topCategories.length) {
     line3 =
       'Biggest leverage right now is in ' +
       topCategories.join(' & ') +
       '. Start there, then fine-tune the rest.';
   } else {
     line3 =
       'Tackle the highest severity items first, then iterate on the rest as you ship.';
   }

   return line1 + ' ' + line2 + ' ' + line3;
 }

 // --- Severity & category summaries (for Guardian / console) ---

 function buildSeveritySummaryFromSuggestions(suggestions) {
   var summary = {
     total: 0,
     bySeverity: {
       critical: 0,
       high: 0,
       medium: 0,
       low: 0,
       note: 0
     }
   };

   if (!Array.isArray(suggestions) || !suggestions.length) {
     return summary;
   }

   summary.total = suggestions.length;

   suggestions.forEach(function (s) {
     var sev = s.severity || 'note';
     if (summary.bySeverity[sev] == null) {
       summary.bySeverity[sev] = 0;
     }
     summary.bySeverity[sev] += 1;
   });

   return summary;
 }

 function buildCategorySummaryFromSuggestions(suggestions) {
   if (!Array.isArray(suggestions) || !suggestions.length) {
     return [];
   }

   var map = {};

   suggestions.forEach(function (s) {
     var cat = s.category || 'other';
     if (!map[cat]) {
       map[cat] = {
         category: cat,
         count: 0,
         bySeverity: {
           critical: 0,
           high: 0,
           medium: 0,
           low: 0,
           note: 0
         },
         topIds: []
       };
     }
     var bucket = map[cat];
     bucket.count += 1;
     var sev = s.severity || 'note';
     if (bucket.bySeverity[sev] == null) {
       bucket.bySeverity[sev] = 0;
     }
     bucket.bySeverity[sev] += 1;
     if (s.id && bucket.topIds.length < 5) {
       bucket.topIds.push(s.id);
     }
   });

   var list = Object.keys(map).map(function (key) {
     return map[key];
   });

   list.sort(function (a, b) {
     return b.count - a.count;
   });

   return list;
 }

 function labelForScore(score) {
   score = typeof score === 'number' ? score : 0;
   if (score >= 90) return 'Excellent';
   if (score >= 80) return 'Strong';
   if (score >= 65) return 'Stable';
   if (score >= 50) return 'Fragile';
   return 'At risk';
 }

 // explainScores(snapshot) – human-readable breakdown per pillar
 function explainScoresInternal(snapshot) {
   snapshot = snapshot || {};
   var scores = computeHealthScores(snapshot);
   var suggestions = buildCavbotSuggestions(snapshot);
   var severitySummary = buildSeveritySummaryFromSuggestions(suggestions);
   var categorySummary = buildCategorySummaryFromSuggestions(suggestions);

   function pillarInfo(pillarKey, humanLabel, categoryKey) {
     var score = scores[pillarKey];
     var scoreLabel = labelForScore(score);
     var cat = categoryKey || pillarKey;
     var catSuggestions = suggestions.filter(function (s) {
       return s.category === cat;
     });
     var catSeverity = buildSeveritySummaryFromSuggestions(catSuggestions);
     var explanation;

     if (!catSuggestions.length) {
       explanation =
         'No ' + humanLabel.toLowerCase() + '-specific issues detected in this snapshot.';
     } else {
       var majorParts = [];
       if (catSeverity.bySeverity.critical) {
         majorParts.push(catSeverity.bySeverity.critical + ' critical');
       }
       if (catSeverity.bySeverity.high) {
         majorParts.push(catSeverity.bySeverity.high + ' high');
       }
       if (!catSeverity.bySeverity.critical &&
         !catSeverity.bySeverity.high &&
         catSeverity.bySeverity.medium) {
         majorParts.push(catSeverity.bySeverity.medium + ' medium');
       }

       var issuePhrase;
       if (majorParts.length) {
         issuePhrase = majorParts.join(' and ') + ' issues to address.';
       } else {
         issuePhrase = catSeverity.total + ' low-impact issues to refine.';
       }

       var topMsg = '';
       if (catSuggestions[0] && catSuggestions[0].message) {
         topMsg = ' Focus first on: ' + catSuggestions[0].message;
       }

       explanation =
         humanLabel + ' is ' + scoreLabel.toLowerCase() + ' at ' + score +
         '/100. ' + issuePhrase + topMsg;
     }

     return {
       score: score,
       label: scoreLabel,
       issues: catSeverity.total,
       explanation: explanation
     };
   }

   var overallExplanation = (function () {
     var overallLabel = labelForScore(scores.overall);
     if (!suggestions.length) {
       return 'Overall health is ' + overallLabel.toLowerCase() +
         ' with no blocking issues in this snapshot.';
     }
     var topCats = categorySummary.slice(0, 2).map(function (c) { return c.category; });
     var catPhrase = topCats.length
       ? ' Biggest leverage is in ' + topCats.join(' & ') + '.'
       : '';
     return 'Overall health is ' + overallLabel.toLowerCase() +
       ' at ' + scores.overall + '/100 with ' + severitySummary.total +
       ' items flagged across all pillars.' + catPhrase;
   })();

   return {
     scores: scores,
     overall: {
       score: scores.overall,
       label: labelForScore(scores.overall),
       issues: severitySummary.total,
       explanation: overallExplanation
     },
     seo: pillarInfo('seo', 'SEO', 'seo'),
     performance: pillarInfo('performance', 'Performance', 'performance'),
     accessibility: pillarInfo('accessibility', 'Accessibility', 'accessibility'),
     ux: pillarInfo('ux', 'UX', 'ux'),
     engagement: pillarInfo('engagement', 'Engagement', 'engagement'),
     severitySummary: severitySummary,
     categorySummary: categorySummary
   };
 }

 // summarize(snapshot) – single call for Guardian / console
 function summarizeInternal(snapshot) {
   snapshot = snapshot || {};
   var scores = computeHealthScores(snapshot);
   var suggestions = buildCavbotSuggestions(snapshot);
   var coachMessage = buildCoachMessage(snapshot);
   var severitySummary = buildSeveritySummaryFromSuggestions(suggestions);
   var categorySummary = buildCategorySummaryFromSuggestions(suggestions);

   return {
     scores: scores,
     suggestions: suggestions,
     coachMessage: coachMessage,
     severitySummary: severitySummary,
     categorySummary: categorySummary
   };
 }

 // ===== Init core visit analytics =====

 (function initAnalytics() {
   if (typeof window === 'undefined') {
     return;
   }

   try {
     analytics.lastVisit = new Date().toISOString();
     persistAnalytics();

     trackEvent('cavbot_control_room_visit', {
       visitCount: analytics.visitCount,
       lifetimeCatches: analytics.lifetimeCatches,
       lifetimeMisses: analytics.lifetimeMisses,
       lifetimeRounds: analytics.lifetimeRounds,
       bestMs: analytics.bestMs
      }, resolveBrainTrackingOverrides({
        pageType: 'cavai-console',
        component: 'cavai-console-shell'
      }));
   } catch (e) {
     // run with in-memory values only
   }
 })();

// ===== CavBot Head, Eye & Pupil Tracking (Gen 1.0) =====

var headTrackingInitialized = false;

function collectCavbotHeadElements() {
  if (typeof document === 'undefined') return [];
  var nodes = [];
  var rawHeads = document.querySelectorAll('[data-cavbot-head]');
  var rawDmHeads = document.querySelectorAll('.cavbot-dm-avatar');
  var i;
  if (rawHeads && rawHeads.length) {
    for (i = 0; i < rawHeads.length; i++) {
      nodes.push(rawHeads[i]);
    }
  }
  if (rawDmHeads && rawDmHeads.length) {
    for (i = 0; i < rawDmHeads.length; i++) {
      nodes.push(rawDmHeads[i]);
    }
  }
  return nodes;
}

function readStableBaseTransform(el, attrName) {
  if (!el || !attrName || typeof window === 'undefined') return '';
  var cached = null;
  try {
    cached = el.getAttribute(attrName);
  } catch (e) {
    cached = null;
  }
  if (cached != null) {
    return cached && cached !== 'none' ? cached : '';
  }
  var cs = window.getComputedStyle(el);
  var next = cs && cs.transform && cs.transform !== 'none' ? cs.transform : '';
  try {
    el.setAttribute(attrName, next || '');
  } catch (e) {
    // ignore write failures
  }
  return next;
}

function buildCavbotHeadRecords(headNodes) {
  var heads = [];
  if (!headNodes || !headNodes.length || typeof window === 'undefined') {
    return heads;
  }
  for (var i = 0; i < headNodes.length; i++) {
    var headEl = headNodes[i];
    // Root-cause fix: keep static base transforms stable across refreshes.
    // Re-reading computed transforms after pointer updates compounds motion and can eject pupils.
    var baseTransform = readStableBaseTransform(headEl, 'data-cavbot-head-base-transform');

    var eyeNodes = headEl.querySelectorAll(
      '[data-cavbot-eye], .cavbot-eye, .cavbot-dm-eye'
    );
    var eyes = [];
    for (var j = 0; j < eyeNodes.length; j++) {
      var eyeEl = eyeNodes[j];
      var eyeBase = readStableBaseTransform(eyeEl, 'data-cavbot-eye-base-transform');

      var pupilNodes = eyeEl.querySelectorAll(
        '.cavbot-eye-pupil, [data-cavbot-pupil], .cavbot-dm-eye-pupil'
      );
      var pupils = [];
      for (var k = 0; k < pupilNodes.length; k++) {
        var pupilEl = pupilNodes[k];
        try {
          pupilEl.setAttribute('data-cavbot-pupil-managed', '1');
        } catch (e) {}
        var pupilBase = readStableBaseTransform(pupilEl, 'data-cavbot-pupil-base-transform');
        pupils.push({
          el: pupilEl,
          baseTransform: pupilBase
        });
      }

      eyes.push({
        el: eyeEl,
        baseTransform: eyeBase,
        pupils: pupils
      });
    }

    heads.push({
      el: headEl,
      baseTransform: baseTransform,
      eyes: eyes
    });
  }
  return heads;
}

 function onReady(fn) {
   if (!fn || typeof fn !== 'function') return;
   if (typeof document === 'undefined') return;
   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', fn);
   } else {
     fn();
   }
 }

 function shouldDeferTrackingBootstrap() {
   if (typeof document === 'undefined') return false;
   try {
     var html = document.documentElement;
     if (html && html.getAttribute('data-cavbot-react-app') === '1') return true;
   } catch (e) {
     // ignore
   }
   try {
     if (typeof window !== 'undefined' && window.__cavbotDeferTrackingBootstrap === true) return true;
   } catch (e) {
     // ignore
   }
   return false;
 }

 function initCavbotHeadTracking() {
   if (typeof window === 'undefined' || typeof document === 'undefined') {
     return;
   }

   // respect prefers-reduced-motion
   var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
   if (mq && mq.matches) {
     return;
   }

  // ----- UPDATED: include DM badge as heads -----
  var headNodes = collectCavbotHeadElements();
  if (!headNodes.length) {
    return;
  }

  var heads = buildCavbotHeadRecords(headNodes);
  if (!heads.length) {
    return;
  }

  var vw = Math.max(window.innerWidth || 1, 1);
  var vh = Math.max(window.innerHeight || 1, 1);
  var pointer = { x: 0.5, y: 0.45 }; // slight upward idle
  var POINTER_X_MARGIN = 0.15;
  var POINTER_Y_MARGIN = 0.2;
   var rafId = null;

   function updatePointer(evtLike) {
    var rawX = evtLike && typeof evtLike.clientX === 'number'
      ? evtLike.clientX / vw
      : 0.5;
    var rawY = evtLike && typeof evtLike.clientY === 'number'
      ? evtLike.clientY / vh
      : 0.45;

    pointer.x = rawX < POINTER_X_MARGIN
      ? POINTER_X_MARGIN
      : rawX > 1 - POINTER_X_MARGIN
        ? 1 - POINTER_X_MARGIN
        : rawX;
    pointer.y = rawY < POINTER_Y_MARGIN
      ? POINTER_Y_MARGIN
      : rawY > 1 - POINTER_Y_MARGIN
        ? 1 - POINTER_Y_MARGIN
        : rawY;

    queueFrame();
  }

  function queueFrame() {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(applyTransforms);
  }

  function refreshHeadRecords() {
    var updated = buildCavbotHeadRecords(collectCavbotHeadElements());
    if (!updated.length) return;
    heads.length = 0;
    for (var r = 0; r < updated.length; r++) {
      heads.push(updated[r]);
    }
    queueFrame();
    if (typeof window !== 'undefined') {
      window.__cavbotHeadTrackingLastRefresh = Date.now();
      window.__cavbotHeadTrackingHeadCount = heads.length;
    }
  }

   function applyTransforms() {
     rafId = null;

     // Normalized pointer (-1 → 1)
     var normX = (pointer.x - 0.5) * 2;
     var normY = (pointer.y - 0.5) * 2;

     // Pupil behavior (matches your local rolling script)
     var pupilMaxOffset = 6;
     var pupilX = normX * pupilMaxOffset;
     var pupilY = normY * pupilMaxOffset;
     if (pupilX < -3.2) pupilX = -3.2;
     if (pupilX > 3.2) pupilX = 3.2;
     if (pupilY < -2.6) pupilY = -2.6;
     if (pupilY > 2.6) pupilY = 2.6;

     for (var h = 0; h < heads.length; h++) {
       var head = heads[h];
       var headEl = head.el;

       var strengthAttr = headEl.getAttribute('data-cavbot-tilt') || '1';
       var strength = parseFloat(strengthAttr);
       if (!isFinite(strength) || strength <= 0) strength = 1;

       // ----- UPDATED: DM badge = eyes only, no head tilt -----
       var isDm = headEl.className &&
         headEl.className.indexOf('cavbot-dm-avatar') !== -1;

      var headStrength = isDm ? 0 : strength; // keep DM badge fixed
      var eyeStrength = isDm ? 0.62 : strength;  // keep DM badge pupils visible in sockets
       // -------------------------------------------------------

       // HEAD: broader, heavier motion
       var maxTranslate = 10 * headStrength;
       var maxTilt = 10 * headStrength;

       var tx = normX * maxTranslate;
       var ty = normY * maxTranslate * -0.6;
       var rotY = normX * maxTilt;
       var rotX = normY * -maxTilt * 0.8;

       var composite =
         'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) ' +
         'rotateX(' + rotX.toFixed(2) + 'deg) ' +
         'rotateY(' + rotY.toFixed(2) + 'deg)';

       if (head.baseTransform && head.baseTransform !== 'none') {
         composite += ' ' + head.baseTransform;
       }

       headEl.style.transform = composite;

       // EYES: subtle socket movement
       if (head.eyes && head.eyes.length) {
         var eyeTx = normX * 6 * eyeStrength;
         var eyeTy = normY * 4 * eyeStrength;

         for (var e = 0; e < head.eyes.length; e++) {
           var eye = head.eyes[e];

           // Eye container
           var eyeComposite =
             'translate3d(' + eyeTx.toFixed(2) + 'px,' + eyeTy.toFixed(2) + 'px,0)';
           if (eye.baseTransform && eye.baseTransform !== 'none') {
             eyeComposite += ' ' + eye.baseTransform;
           }
           eye.el.style.transform = eyeComposite;

           // Pupils: pure 2D translate, same feel as your snippet
           if (eye.pupils && eye.pupils.length) {
             for (var p = 0; p < eye.pupils.length; p++) {
               var pupil = eye.pupils[p];
               var pupilComposite =
                 'translate(' + pupilX.toFixed(2) + 'px,' + pupilY.toFixed(2) + 'px)';
               if (pupil.baseTransform && pupil.baseTransform !== 'none') {
                 pupilComposite += ' ' + pupil.baseTransform;
               }
               pupil.el.style.transform = pupilComposite;
             }
           }
         }
       }
     }
   }

   function handleMouseMove(evt) {
     updatePointer(evt);
   }

   function handleTouchMove(evt) {
     if (!evt.touches || !evt.touches.length) return;
     updatePointer(evt.touches[0]);
   }

   window.addEventListener('mousemove', handleMouseMove, { passive: true });
   window.addEventListener('touchmove', handleTouchMove, { passive: true });
   window.addEventListener('resize', function () {
     vw = Math.max(window.innerWidth || 1, 1);
     vh = Math.max(window.innerHeight || 1, 1);
   });

  // initial idle pose
  queueFrame();

  if (typeof window !== 'undefined') {
    window.__cavbotHeadTrackingReady = true;
    window.__cavbotHeadTrackingHeadCount = heads.length;
    window.__cavbotHeadTrackingLastRefresh = Date.now();
    window.__cavaiHeadTrackingRefresh = refreshHeadRecords;
  }

   try {
      trackEvent('cavbot_head_tracking_enabled', {
        headCount: heads.length
      });
    } catch (e) {
      // analytics is a nice-to-have
    }
    emitEvent('head_tracking_enabled', { headCount: heads.length });
  }

 function ensureHeadTracking() {
   if (headTrackingInitialized) return;
   headTrackingInitialized = true;

   // Global data-cavbot-head tracking (heads, eyes, pupils)
   initCavbotHeadTracking();

   // About-page full-body orbit bot tracking (cavbot-shell / cavbot-head / cavbot-eye-pupil)
   initCavbotBodyOrbitTracking();
 }

 // ===== CavBot Full-Body Orbit Head + Eye Tracking (about page) =====

 function initCavbotBodyOrbitTracking() {
   if (typeof window === 'undefined' || typeof document === 'undefined') {
     return;
   }

   // respect prefers-reduced-motion
   var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
   if (mq && mq.matches) {
     return;
   }

   // This is the about-page full body bot orbit container
   var shell = document.querySelector('.about-hero-bot-orbit .cavbot-shell');
   if (!shell) return;

   var head = shell.querySelector('.cavbot-head');
   var pupils = shell.querySelectorAll('.cavbot-eye-pupil');

   if (!head || !pupils.length) return;

   var targetX = 0;
   var targetY = 0;
   var currentX = 0;
   var currentY = 0;
   var ticking = false;

   function applyMotion() {
     ticking = false;

     // ease towards target
     currentX += (targetX - currentX) * 0.18;
     currentY += (targetY - currentY) * 0.18;

     var headTranslateX = currentX * 6; // px
     var headTranslateY = currentY * 4;

     head.style.transform = 'translate(' + headTranslateX + 'px,' + headTranslateY + 'px)';

     var eyeShiftX = currentX * 10;
     var eyeShiftY = currentY * 8;

     // move pupils
     for (var i = 0; i < pupils.length; i++) {
       var pupil = pupils[i];
       pupil.style.transform = 'translate(' + eyeShiftX + 'px,' + eyeShiftY + 'px)';
     }

     // keep easing until very close
     if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
       ticking = true;
       window.requestAnimationFrame(applyMotion);
     }
   }

   function onPointerMove(evt) {
     var rect = shell.getBoundingClientRect();
     if (!rect || !rect.width || !rect.height) return;

     var x = (evt.clientX - rect.left) / rect.width - 0.5; // -0.5 .. 0.5
     var y = (evt.clientY - rect.top) / rect.height - 0.5;

     // clamp
     if (x < -0.5) x = -0.5;
     if (x >  0.5) x =  0.5;
     if (y < -0.5) y = -0.5;
     if (y >  0.5) y =  0.5;

     targetX = x;
     targetY = y;

     if (!ticking) {
       ticking = true;
       window.requestAnimationFrame(applyMotion);
     }
   }

   function resetMotion() {
     targetX = 0;
     targetY = 0;
     if (!ticking) {
       ticking = true;
       window.requestAnimationFrame(applyMotion);
     }
   }

   // Global pointer tracking, motion is localized to the shell via its rect
   window.addEventListener('pointermove', onPointerMove);
   window.addEventListener('pointerleave', resetMotion);

   // start from neutral pose
   resetMotion();
 }

 // auto-init when DOM is ready (deferred on React shell to avoid hydration mutations)
 if (!shouldDeferTrackingBootstrap()) {
   onReady(ensureHeadTracking);
 }

 // ===== Public brain API for other pages / future backend & console =====

 try {
   window.cavai = window.cavai || {};

   window.cavai.getSnapshot = function () {
     return {
       analytics: Object.assign({}, analytics),
       session: Object.assign({}, session),
       recentEvents: runtimeEvents.slice(-40)
     };
   };

   window.cavai.getSessionId = function () {
     session.id = getOrCreateSessionId();
     return session.id;
   };

   window.cavai.getDeviceRecords = function () {
     return {
       bestMs: analytics.bestMs,
       bestRuns: analytics.bestRuns.slice()
     };
   };

   // Full suggestion + scoring API
   window.cavai.buildSuggestions = function (snapshot) {
     return buildCavbotSuggestions(snapshot || {});
   };

   window.cavai.getHealthScores = function (snapshot) {
     return computeHealthScores(snapshot || {});
   };

   window.cavai.getCoachMessage = function (snapshot) {
     return buildCoachMessage(snapshot || {});
   };

   window.cavai.scanPage = function () {
     try {
       if (typeof document === 'undefined') return null;
       var html = document.documentElement || null;
       var title = document.title || '';
       var metaDescriptionEl = document.querySelector('meta[name="description"]');
       var canonicalEl = document.querySelector('link[rel="canonical"]');
       var robotsEl = document.querySelector('meta[name="robots"]');
       var h1s = document.querySelectorAll('h1');
       var links = document.querySelectorAll('a[href]');
       var images = document.querySelectorAll('img');
       var favicon = readFaviconSnapshotFromHead();

       var missingAltCount = 0;
       for (var i = 0; i < images.length; i++) {
         var alt = images[i].getAttribute('alt');
         if (alt == null || !String(alt).trim()) {
           missingAltCount += 1;
         }
       }

       return {
         ts: Date.now(),
         titleLength: title.length,
         hasTitle: !!title,
         hasMetaDescription: !!(metaDescriptionEl && metaDescriptionEl.getAttribute('content')),
         hasCanonical: !!(canonicalEl && canonicalEl.getAttribute('href')),
         robotsMeta: robotsEl ? (robotsEl.getAttribute('content') || '') : '',
         lang: html ? (html.getAttribute('lang') || '') : '',
         h1Count: h1s ? h1s.length : 0,
         linkCount: links ? links.length : 0,
         missingAltCount: missingAltCount,
         favicon: favicon
       };
     } catch (e) {
       return null;
     }
   };

   window.cavai.trackSiteSnapshot = function (snapshot, context) {
     snapshot = snapshot || {};
     var scores = computeHealthScores(snapshot);
     var suggestions = buildCavbotSuggestions(snapshot);

     trackEvent('cavbot_site_snapshot', {
       scores: scores,
       suggestions: suggestions,
       snapshot: snapshot,
       context: context || {}
     });

     return {
       scores: scores,
       suggestions: suggestions
     };
   };

   // New: explainScores(snapshot) – human-readable breakdown per pillar
   window.cavai.explainScores = function (snapshot) {
     return explainScoresInternal(snapshot || {});
   };

   // New: summarize(snapshot) – clutch helper for Guardian panel / console
    window.cavai.summarize = function (snapshot) {
      var context = (snapshot && snapshot.context) ? snapshot.context : buildContextSnapshot();
      var summary = summarizeInternal(snapshot || {});
      var originKey = resolveOriginKey(context);
      try {
        if (
          originKey &&
          window &&
          window.cavAI &&
          window.cavAI.memory &&
          typeof window.cavAI.memory.recordFromSummary === 'function'
        ) {
          window.cavAI.memory.recordFromSummary({
            origin: originKey,
            summary: summary,
            context: context
          });
        }
      } catch (err) {
        // swallow recorder errors
      }
      return summary;
    };

   // New: utility summaries you can call directly if you already have suggestions
   window.cavai.getSeveritySummary = function (input) {
     var suggestions = Array.isArray(input)
       ? input
       : buildCavbotSuggestions(input || {});
     return buildSeveritySummaryFromSuggestions(suggestions);
   };

   window.cavai.getCategorySummary = function (input) {
     var suggestions = Array.isArray(input)
       ? input
       : buildCavbotSuggestions(input || {});
     return buildCategorySummaryFromSuggestions(suggestions);
   };

   // New: public event hook for non-game pages
   window.cavai.trackEvent = function (eventName, payload) {
     return trackEvent(eventName, payload);
   };

   // New: public switch to (re)enable head / eye tracking on demand
   window.cavai.enableHeadTracking = function () {
     onReady(ensureHeadTracking);
   };
   window.cavai.enableEyeTracking = function () {
     if (typeof window.__cavaiEyeTrackingStart === 'function') {
       window.__cavaiEyeTrackingStart();
     }
   };

   // Version flag for debugging (kept at 1.0 as requested)
   window.cavai.version = '1.0';

   // Internal bridge for game modules (404 arena / future games)
  window.cavai._internal = {
    analytics: analytics,
    session: session,
    persistAnalytics: persistAnalytics,
    trackEvent: trackEvent
  };
} catch (e) {
  // ignore if window not available
}

  // ===== CavAI — new companion layer (Gen 1.x) =====

  var CAVAI_DEFAULT_CONFIG = {
    diagnosticsEndpoint: '/api/cavai/diagnostics',
    fixEndpoint: '/api/cavai/fixes',
    timeoutMs: 10000,
    debounceMs: 520,
    geoTimeoutMs: 14000
  };

  var cavAIConfig = Object.assign({}, CAVAI_DEFAULT_CONFIG);

  var eventHandlers = {};

  var diagAbortController = null;
  var diagDebounceTimer = null;
  var diagPendingPayload = null;
  var diagPendingResolvers = [];
  var diagRequestId = 0;

  var privacyReasons = [];
  var privacyGateActive = false;
  var scanHistoryCache = null;

  function isPrivacyGateActive() {
    // data-cavbot-analytics="off" disables analytics pipeline.
    // data-cavai-analytics="off" disables CavAi and analytics for backward compatibility.
    if (isAttrOff('data-cavbot-analytics')) return true;
    if (isAttrOff('data-cavai-analytics')) return true;
    if (hasGlobalPrivacyControlEnabled()) return true;
    if (hasDoNotTrackEnabled()) return true;
    return false;
  }

  function getSafeStorage(preferSession) {
    try {
      if (typeof window === 'undefined') return null;
      if (globalThis.__cbSessionStore) return globalThis.__cbSessionStore;
    } catch (e) {}
    return null;
  }

  function readStoredJson(key, fallback, preferSession) {
    try {
      var primary = getSafeStorage(!!preferSession);
      var secondary = getSafeStorage(!preferSession);
      var raw = null;
      if (primary) raw = primary.getItem(key);
      if (!raw && secondary) raw = secondary.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeStoredJson(key, value, preferSession) {
    try {
      var json = JSON.stringify(value || {});
      var primary = getSafeStorage(!!preferSession);
      if (primary) {
        primary.setItem(key, json);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function removeStoredValue(key) {
    var stores = [getSafeStorage(true), getSafeStorage(false)];
    for (var i = 0; i < stores.length; i++) {
      try {
        if (stores[i]) stores[i].removeItem(key);
      } catch (e) {}
    }
  }

  function clearCompanionPersistedState() {
    removeStoredValue(GEO_STORAGE_KEY);
    removeStoredValue(SOFT_BURST_SCAN_KEY);
    removeStoredValue(MEMORY_STORAGE_KEY);
    scanHistoryCache = {};
    try {
      coarseGeoSnapshot = buildGeoSnapshot();
    } catch (e) {}
  }

  function updatePrivacyState() {
    var active = isPrivacyGateActive();
    privacyReasons = active ? ['privacy_gate_active'] : [];
    if (active && !privacyGateActive) {
      clearPendingCavbotEvents();
      clearCompanionPersistedState();
    }
    privacyGateActive = active;
    return active;
  }

  function canPersistScanHistory() {
    return !updatePrivacyState();
  }

  function sanitizeScanHistory(input) {
    var out = {};
    if (!input || typeof input !== 'object') return out;
    var keys = Object.keys(input).slice(0, MEMORY_MAX_ORIGINS);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var values = Array.isArray(input[key]) ? input[key] : [];
      var next = [];
      for (var j = 0; j < values.length; j++) {
        var ts = values[j];
        if (typeof ts === 'number' && isFinite(ts)) next.push(ts);
      }
      if (next.length) out[key] = next.slice(-MEMORY_MAX_RUNS);
    }
    return out;
  }

  function readScanHistory() {
    if (!canPersistScanHistory()) {
      scanHistoryCache = {};
      return scanHistoryCache;
    }
    if (scanHistoryCache) {
      return scanHistoryCache;
    }
    var data = sanitizeScanHistory(readStoredJson(SOFT_BURST_SCAN_KEY, {}, false));
    scanHistoryCache = data;
    return data;
  }

  function persistScanHistory(history) {
    scanHistoryCache = sanitizeScanHistory(history || {});
    if (!canPersistScanHistory()) {
      removeStoredValue(SOFT_BURST_SCAN_KEY);
      return;
    }
    writeStoredJson(SOFT_BURST_SCAN_KEY, scanHistoryCache, false);
  }

  function pruneScanEntries(entries, now) {
    var kept = [];
    if (!Array.isArray(entries)) {
      return kept;
    }
    for (var i = 0; i < entries.length; i++) {
      var ts = entries[i];
      if (typeof ts !== 'number') continue;
      if (now - ts <= SOFT_BURST_WINDOW_MS) {
        kept.push(ts);
      }
    }
    return kept;
  }

  function reserveSoftBurstSlot(origin) {
    if (!origin) {
      return { allowed: true };
    }
    var now = Date.now();
    var history = readScanHistory();
    var entries = history[origin] || [];
    entries = pruneScanEntries(entries, now);
    history[origin] = entries;
    if (entries.length >= SOFT_BURST_SCAN_LIMIT) {
      persistScanHistory(history);
      return { allowed: false };
    }
    entries.push(now);
    history[origin] = entries;
    persistScanHistory(history);
    return { allowed: true };
  }

  function emitEvent(eventName, payload) {
    if (!eventHandlers) return;
    var handlers = eventHandlers[eventName];
    if (!handlers || !handlers.length) return;
    for (var i = 0; i < handlers.length; i++) {
      try {
        handlers[i](payload);
      } catch (err) {
        // swallow handler errors
      }
    }
  }

  function trackLifecycleAnalytics(eventName, payload, overrides) {
    if (!eventName || analyticsSuppressedForBrain()) return;
    try {
      trackEvent(eventName, payload || {}, resolveBrainTrackingOverrides(overrides));
    } catch (err) {
      // never let analytics lifecycle events throw
    }
  }

  function onEvent(eventName, handler) {
    if (!eventHandlers[eventName]) {
      eventHandlers[eventName] = [];
    }
    eventHandlers[eventName].push(handler);
  }

  function offEvent(eventName, handler) {
    var handlers = eventHandlers[eventName];
    if (!handlers) return;
    for (var i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i] === handler) {
        handlers.splice(i, 1);
      }
    }
  }

  function fetchWithTimeout(url, options, timeout) {
    return new Promise(function (resolve, reject) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        reject(new Error('fetch_unavailable'));
        return;
      }
      var timer = window.setTimeout(function () {
        reject(new Error('timeout'));
        if (options && options.signal && options.signal.abort) {
          options.signal.abort();
        }
      }, timeout || 0);
      window.fetch(url, options || {})
        .then(function (res) {
          window.clearTimeout(timer);
          resolve(res);
        })
        .catch(function (err) {
          window.clearTimeout(timer);
          reject(err);
        });
    });
  }

  function getWindowSiteOrigin() {
    if (typeof window === 'undefined') return '';
    var cavbot = window.__CAVBOT__ || {};
    if (typeof cavbot.siteOrigin === 'string' && cavbot.siteOrigin) {
      return cavbot.siteOrigin;
    }
    if (window.location && window.location.origin) {
      return window.location.origin;
    }
    return '';
  }

  function buildContextSnapshot() {
    var browserOrigin = window && window.location ? window.location.origin : '';
    var context = {
      origin: browserOrigin,
      siteOrigin: getWindowSiteOrigin(),
      path: window && window.location ? window.location.pathname : '',
      mode: 'browser',
      planTier: (window.cavai && window.cavai.planTier) || null,
      activeFile: getActiveFileFromUrl(),
      pagesScanned: null,
      pageLimit: null
    };
    return context;
  }

  function getActiveFileFromUrl() {
    if (typeof window === 'undefined' || !window.location) return null;
    var params = new URLSearchParams(window.location.search);
    var file = params.get('file');
    return file ? file : null;
  }

  function deriveNextActions(suggestions) {
    if (!Array.isArray(suggestions)) return [];
    var sorted = suggestions.slice().sort(function (a, b) {
      var weightA = SUGGESTION_SEVERITY_WEIGHT[a.severity] || 0;
      var weightB = SUGGESTION_SEVERITY_WEIGHT[b.severity] || 0;
      if (weightB !== weightA) return weightB - weightA;
      if (a.id && b.id) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }
      return 0;
    });
    var next = [];
    for (var i = 0; i < Math.min(3, sorted.length); i++) {
      var suggestion = sorted[i];
      if (!suggestion || !suggestion.id) continue;
      next.push({
        suggestionId: suggestion.id,
        title: suggestion.message,
        hint: suggestion.hint || '',
        priority: i + 1
      });
    }
    return next;
  }

  function buildGeoSnapshot() {
    if (typeof window === 'undefined') return {};
    var tz = '';
    if (window.Intl && window.Intl.DateTimeFormat) {
      try {
        tz = window.Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (e) {
        tz = '';
      }
    }
    var locale = (navigator && navigator.language) ? navigator.language : '';
    var regionHint = '';
    if (locale && locale.indexOf('-') !== -1) {
      regionHint = locale.split('-').slice(1).join('-');
    }
    var snapshot = {
      tz: tz,
      locale: locale,
      regionHint: regionHint,
      updatedAt: Date.now()
    };
    return snapshot;
  }

  function readGeoFromStorage() {
    if (updatePrivacyState()) {
      return buildGeoSnapshot();
    }
    var base = buildGeoSnapshot();
    var stored = readStoredJson(GEO_STORAGE_KEY, null, true);
    if (!stored || typeof stored !== 'object') {
      return base;
    }
    return {
      tz: typeof stored.tz === 'string' ? stored.tz : base.tz,
      locale: typeof stored.locale === 'string' ? stored.locale : base.locale,
      regionHint: typeof stored.regionHint === 'string' ? stored.regionHint : base.regionHint,
      updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : base.updatedAt
    };
  }

  function persistGeoSnapshot(snapshot) {
    coarseGeoSnapshot = snapshot || coarseGeoSnapshot;
    if (updatePrivacyState()) {
      removeStoredValue(GEO_STORAGE_KEY);
      return;
    }
    var next = {
      tz: coarseGeoSnapshot.tz || '',
      locale: coarseGeoSnapshot.locale || '',
      regionHint: coarseGeoSnapshot.regionHint || '',
      updatedAt: coarseGeoSnapshot.updatedAt || Date.now()
    };
    writeStoredJson(GEO_STORAGE_KEY, next, true);
  }

  var coarseGeoSnapshot = (typeof window !== 'undefined') ? readGeoFromStorage() : buildGeoSnapshot();

  function sanitizeCoords(lat, lon, precision) {
    var factor = precision || 0.2;
    var roundedLat = Math.round(lat / factor) * factor;
    var roundedLon = Math.round(lon / factor) * factor;
    return {
      lat: Number(roundedLat.toFixed(3)),
      lon: Number(roundedLon.toFixed(3))
    };
  }

  function requestGeoInternal(opts) {
    opts = opts || {};
    if (updatePrivacyState()) {
      emitEvent('geo_denied', { reason: 'privacy' });
      trackLifecycleAnalytics('geo_denied', {
        ok: false,
        reason: 'privacy_gate_active',
        accuracy: opts.precise ? 'precise' : 'coarse'
      }, { component: 'cavai-console-shell' });
      return Promise.resolve({ ok: false, reason: 'privacy_gate_active' });
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      emitEvent('geo_unavailable', { reason: 'geolocation_missing' });
      trackLifecycleAnalytics('geo_unavailable', {
        ok: false,
        reason: 'geolocation_unavailable',
        accuracy: opts.precise ? 'precise' : 'coarse'
      }, { component: 'cavai-console-shell' });
      return Promise.resolve({ ok: false, reason: 'geolocation_unavailable' });
    }

    return new Promise(function (resolve) {
      var timeout = opts.timeoutMs || cavAIConfig.geoTimeoutMs;
      var resolved = false;
      var startedAt = Date.now();

      function cleanup() {
        resolved = true;
      }

      var timer = window.setTimeout(function () {
        if (resolved) return;
        cleanup();
        emitEvent('geo_unavailable', { reason: 'timeout' });
        trackLifecycleAnalytics('geo_unavailable', {
          ok: false,
          reason: 'timeout',
          durationMs: Date.now() - startedAt,
          accuracy: opts.precise ? 'precise' : 'coarse'
        }, { component: 'cavai-console-shell' });
        resolve({ ok: false, reason: 'timeout' });
      }, timeout);

      navigator.geolocation.getCurrentPosition(function (position) {
        if (resolved) return;
        cleanup();
        window.clearTimeout(timer);
        var coords = position && position.coords;
        if (!coords) {
          emitEvent('geo_unavailable', { reason: 'empty' });
          trackLifecycleAnalytics('geo_unavailable', {
            ok: false,
            reason: 'no_coords',
            durationMs: Date.now() - startedAt,
            accuracy: opts.precise ? 'precise' : 'coarse'
          }, { component: 'cavai-console-shell' });
          resolve({ ok: false, reason: 'no_coords' });
          return;
        }
        var sanitized = sanitizeCoords(coords.latitude, coords.longitude, opts.precisionGrid || 0.3);
        var payload = {
          ok: true,
          geo: {
            ts: Date.now(),
            country: opts.country || '',
            region: opts.region || '',
            city: opts.city || '',
            coordinates: sanitized,
            accuracy: opts.precise ? 'precise' : 'coarse'
          }
        };
        emitEvent('geo_available', payload);
        trackLifecycleAnalytics('geo_available', {
          ok: true,
          reason: null,
          durationMs: Date.now() - startedAt,
          accuracy: opts.precise ? 'precise' : 'coarse'
        }, { component: 'cavai-console-shell' });
        resolve(payload);
      }, function (err) {
        if (resolved) return;
        cleanup();
        window.clearTimeout(timer);
        var reason = err && err.code ? 'error_' + err.code : 'permission_denied';
        emitEvent('geo_denied', { reason: reason });
        trackLifecycleAnalytics('geo_denied', {
          ok: false,
          reason: reason,
          durationMs: Date.now() - startedAt,
          accuracy: opts.precise ? 'precise' : 'coarse'
        }, { component: 'cavai-console-shell' });
        resolve({ ok: false, reason: reason });
      }, {
        timeout: timeout,
        maximumAge: opts.maximumAge || 600000,
        enableHighAccuracy: !!opts.precise
      });
    });
  }

  function scheduleDiagnosticsRequest(payload) {
    if (diagDebounceTimer) {
      window.clearTimeout(diagDebounceTimer);
      diagDebounceTimer = null;
    }

    diagPendingPayload = payload;
    return new Promise(function (resolve) {
      diagPendingResolvers.push(resolve);
      diagDebounceTimer = window.setTimeout(function () {
        diagDebounceTimer = null;
        internalDiagnosticsRequest(payload).then(function (result) {
          finishPendingResolvers(result);
        }).catch(function (err) {
          finishPendingResolvers({ ok: false, reason: err && err.message ? err.message : 'unknown' });
        });
      }, cavAIConfig.debounceMs);
    });
  }

  function finishPendingResolvers(result) {
    while (diagPendingResolvers.length) {
      var resolver = diagPendingResolvers.shift();
      try {
        resolver(result);
      } catch (e) {
        // ignore
      }
    }
  }

  function normalizeDiagnosticSeverity(value) {
    var v = safeString(value || '', 24).toLowerCase();
    if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'note') return v;
    if (v === 'warn' || v === 'warning') return 'medium';
    return 'medium';
  }

  function pillarFromSuggestionCategory(category) {
    var c = safeString(category || '', 40).toLowerCase();
    if (c === 'seo') return 'seo';
    if (c === 'performance' || c === 'perf') return 'performance';
    if (c === 'a11y' || c === 'accessibility') return 'accessibility';
    if (c === 'ux') return 'ux';
    if (c === 'engagement') return 'engagement';
    if (c === 'errors' || c === 'routes' || c === 'reliability') return 'reliability';
    return 'reliability';
  }

  function toNormalizedDiagnosticsPayload(payloadBody, context) {
    payloadBody = payloadBody || {};
    context = context || {};

    if (
      typeof payloadBody.origin === 'string' &&
      Array.isArray(payloadBody.pagesSelected) &&
      Array.isArray(payloadBody.findings) &&
      typeof payloadBody.pageLimit === 'number'
    ) {
      return payloadBody;
    }

    var snapshot = payloadBody.snapshot || payloadBody.diagnostics || payloadBody.summary || {};
    var suggestions = Array.isArray(payloadBody.suggestions)
      ? payloadBody.suggestions
      : buildCavbotSuggestions(snapshot);

    var origin = safeString(
      context.siteOrigin || context.origin || getWindowSiteOrigin() || (window.location && window.location.origin) || '',
      500
    );
    if (!origin && window.location && window.location.origin) {
      origin = window.location.origin;
    }
    var pagePath = safeString(
      context.path || (window.location && window.location.pathname) || '/',
      600
    ) || '/';

    var pagesSelected = Array.isArray(payloadBody.pagesSelected)
      ? payloadBody.pagesSelected.slice(0, 200)
      : [pagePath];
    if (!pagesSelected.length) pagesSelected = [pagePath];
    var routeMetadata = {};
    if (context.routeMetadata && typeof context.routeMetadata === 'object') {
      for (var routeKey in context.routeMetadata) {
        if (!Object.prototype.hasOwnProperty.call(context.routeMetadata, routeKey)) continue;
        routeMetadata[routeKey] = context.routeMetadata[routeKey];
      }
    }

    var snapshotFavicon = null;
    if (snapshot && snapshot.seo && typeof snapshot.seo === 'object') {
      snapshotFavicon = normalizeFaviconSnapshot(snapshot.seo.favicon);
    }
    if (!snapshotFavicon) {
      snapshotFavicon = normalizeFaviconSnapshot(snapshot.favicon);
    }
    if (!snapshotFavicon) {
      snapshotFavicon = normalizeFaviconSnapshot(readFaviconSnapshotFromHead());
    }
    if (snapshotFavicon) {
      routeMetadata.favicon = snapshotFavicon;
    }

    var structuredDataSnapshot = readStructuredDataSnapshotFromHead();
    if (structuredDataSnapshot && Array.isArray(structuredDataSnapshot.scripts) && structuredDataSnapshot.scripts.length) {
      routeMetadata.structuredData = structuredDataSnapshot;
    }

    var headMetaSnapshot = readHeadMetaSnapshotFromDom();
    if (headMetaSnapshot) {
      routeMetadata.headMeta = headMetaSnapshot;
    }

    var accessibilityPlusSnapshot = readAccessibilityPlusSnapshotFromDom();
    if (accessibilityPlusSnapshot) {
      routeMetadata.accessibilityPlus = accessibilityPlusSnapshot;
    }

    var uxLayoutSnapshot = readUxLayoutSnapshotFromDom(snapshot);
    if (uxLayoutSnapshot) {
      routeMetadata.uxLayout = uxLayoutSnapshot;
    }

    var trustPagesSnapshot = readTrustPagesSnapshotFromDom();
    if (trustPagesSnapshot) {
      routeMetadata.trustPages = trustPagesSnapshot;
    }

    var keywordSignals = readKeywordSignalsFromDom();
    if (keywordSignals) {
      routeMetadata.keywords = keywordSignals;
    }

    var navigationSnapshot = readNavigationSnapshotFromDom();
    if (navigationSnapshot) {
      routeMetadata.navigation = navigationSnapshot;
    }

    var reliabilitySnapshot = readReliability404SnapshotFromDom();
    if (reliabilitySnapshot) {
      routeMetadata.reliability404 = reliabilitySnapshot;
    }

    var authFunnelSnapshot = readAuthFunnelSnapshotFromSummary(snapshot);
    if (authFunnelSnapshot) {
      routeMetadata.authFunnel = authFunnelSnapshot;
    }

    var geoTrendSnapshot = readGeoTrendSnapshotFromSummary(snapshot);
    if (geoTrendSnapshot) {
      routeMetadata.geoTrend = geoTrendSnapshot;
    }

    var outputContext = {
      environment: {
        sdkVersion: safeString(payloadBody.sdkVersion || '', 40) || null,
        appEnv: safeString(payloadBody.env || '', 40) || null
      }
    };
    if (Object.keys(routeMetadata).length) {
      outputContext.routeMetadata = routeMetadata;
    }
    if (Array.isArray(context.telemetrySummaryRefs) && context.telemetrySummaryRefs.length) {
      outputContext.telemetrySummaryRefs = context.telemetrySummaryRefs.slice(0, 40);
    }
    if (context.traits && typeof context.traits === 'object') {
      outputContext.traits = context.traits;
    }
    if (typeof context.piiAllowed === 'boolean') {
      outputContext.piiAllowed = context.piiAllowed;
    }

    var findings = [];
    for (var i = 0; i < suggestions.length; i++) {
      var suggestion = suggestions[i];
      if (!suggestion) continue;
      var code = safeString(suggestion.id || ('legacy_signal_' + (i + 1)), 120).toLowerCase();
      if (!code) continue;
      findings.push({
        id: safeString('legacy_' + (i + 1) + '_' + code, 96),
        code: code,
        pillar: pillarFromSuggestionCategory(suggestion.category),
        severity: normalizeDiagnosticSeverity(suggestion.severity),
        evidence: [
          {
            type: 'route',
            path: pagePath,
            reason: safeString(suggestion.message || suggestion.hint || 'legacy_signal', 240)
          }
        ],
        origin: origin,
        pagePath: pagePath,
        templateHint: null,
        detectedAt: new Date().toISOString()
      });
    }

    return {
      origin: origin,
      pagesSelected: pagesSelected,
      pageLimit: Math.max(1, Math.min(500, Number(payloadBody.pageLimit || pagesSelected.length || 1))),
      findings: findings,
      context: outputContext
    };
  }

  function internalDiagnosticsRequest(payload) {
    diagRequestId += 1;
    var requestId = diagRequestId;
    var startedAt = Date.now();

    if (updatePrivacyState()) {
      var privacyResult = { ok: false, reason: 'privacy_gate_active' };
      emitEvent('diagnostics_failed', { requestId: requestId, reason: privacyResult.reason });
      return Promise.resolve(privacyResult);
    }

    if (window && window.fetch) {
      if (diagAbortController) {
        try {
          diagAbortController.abort();
        } catch (e) {}
      }
      diagAbortController = new AbortController();
    }

    var context = buildContextSnapshot();
    var payloadBody = payload || {};
    payloadBody.context = payloadBody.context || context;
    var normalizedPayload = toNormalizedDiagnosticsPayload(payloadBody, payloadBody.context);
    if (!normalizedPayload || !Array.isArray(normalizedPayload.findings) || !normalizedPayload.findings.length) {
      emitEvent('diagnostics_failed', { requestId: requestId, reason: 'missing_findings' });
      return Promise.resolve({ ok: false, reason: 'missing_findings' });
    }

    var emitPayload = {
      requestId: requestId,
      payload: normalizedPayload
    };
    emitEvent('diagnostics_requested', emitPayload);
    var originKey = resolveOriginKey(payloadBody.context || normalizedPayload.context || {});
    var pagesScanned = null;
    if (normalizedPayload.context && typeof normalizedPayload.context.pagesScanned === 'number') {
      pagesScanned = normalizedPayload.context.pagesScanned;
    } else if (typeof normalizedPayload.pagesSelected === 'object' && normalizedPayload.pagesSelected.length) {
      pagesScanned = normalizedPayload.pagesSelected.length;
    } else if (typeof normalizedPayload.pagesScanned === 'number') {
      pagesScanned = normalizedPayload.pagesScanned;
    }
    trackLifecycleAnalytics('diagnostics_requested', {
      requestId: requestId,
      ok: true,
      reason: null,
      durationMs: 0,
      originKey: originKey || null,
      pagesScanned: pagesScanned
    }, { component: 'cavai-console-shell' });

    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedPayload),
      signal: diagAbortController ? diagAbortController.signal : undefined,
      credentials: 'same-origin'
    };


    var token = window.__cavbotEmbedConfigToken;
    if (token) {
      options.headers.Authorization = 'Bearer ' + token;
    }
    return fetchWithTimeout(cavAIConfig.diagnosticsEndpoint, options, cavAIConfig.timeoutMs)
      .then(function (res) {
        if (!res || !res.ok) {
          throw new Error('diagnostics_failed');
        }
        return res.json && res.json();
      })
      .then(function (json) {
        emitEvent('diagnostics_received', { requestId: requestId, result: json });
        trackLifecycleAnalytics('diagnostics_received', {
          requestId: requestId,
          ok: true,
          reason: null,
          durationMs: Date.now() - startedAt,
          originKey: originKey || null,
          pagesScanned: pagesScanned
        }, { component: 'cavai-console-shell' });
        return { ok: true, data: json };
      })
      .catch(function (err) {
        var reason = err && err.message ? err.message : 'unknown';
        emitEvent('diagnostics_failed', { requestId: requestId, reason: reason });
        trackLifecycleAnalytics('diagnostics_failed', {
          requestId: requestId,
          ok: false,
          reason: reason,
          durationMs: Date.now() - startedAt,
          originKey: originKey || null,
          pagesScanned: pagesScanned
        }, { component: 'cavai-console-shell' });
        return { ok: false, reason: reason };
      });
  }

  function requestFixDiff(payload) {
    payload = payload || {};
    var startedAt = Date.now();
    var suggestionId = payload && payload.suggestionId
      ? safeString(payload.suggestionId, 120)
      : null;
    if (updatePrivacyState()) {
      emitEvent('diagnostics_failed', { reason: 'privacy_gate_active' });
      emitEvent('fix_failed', { reason: 'privacy_gate_active' });
      return Promise.resolve({ ok: false, reason: 'privacy_gate_active' });
    }
    if (!window || !window.fetch) {
      emitEvent('fix_failed', { reason: 'fetch_unavailable' });
      trackLifecycleAnalytics('fix_failed', {
        ok: false,
        reason: 'fetch_unavailable',
        durationMs: Date.now() - startedAt,
        suggestionId: suggestionId
      }, { component: 'cavai-console-shell' });
      return Promise.resolve({ ok: false, reason: 'fetch_unavailable' });
    }
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    };
    emitEvent('diagnostics_requested', { payload: payload, type: 'fix' });
    emitEvent('fix_requested', { suggestionId: suggestionId });
    trackLifecycleAnalytics('fix_requested', {
      ok: true,
      reason: null,
      durationMs: 0,
      suggestionId: suggestionId
    }, { component: 'cavai-console-shell' });
    return fetchWithTimeout(cavAIConfig.fixEndpoint, options, cavAIConfig.timeoutMs)
      .then(function (res) {
        if (!res || !res.ok) throw new Error('fix_failed');
        return res.json && res.json();
      })
      .then(function (json) {
        emitEvent('diagnostics_received', { payload: payload, type: 'fix', result: json });
        emitEvent('fix_received', { suggestionId: suggestionId, ok: true });
        trackLifecycleAnalytics('fix_received', {
          ok: true,
          reason: null,
          durationMs: Date.now() - startedAt,
          suggestionId: suggestionId
        }, { component: 'cavai-console-shell' });
        return { ok: true, data: json };
      })
      .catch(function (err) {
        var reason = err && err.message ? err.message : 'unknown';
        emitEvent('diagnostics_failed', { payload: payload, type: 'fix', reason: reason });
        emitEvent('fix_failed', { suggestionId: suggestionId, reason: reason });
        trackLifecycleAnalytics('fix_failed', {
          ok: false,
          reason: reason,
          durationMs: Date.now() - startedAt,
          suggestionId: suggestionId
        }, { component: 'cavai-console-shell' });
        return { ok: false, reason: reason };
      });
  }

  function buildSuggestionPack(snapshot, context) {
    snapshot = snapshot || {};
    var suggestions = buildCavbotSuggestions(snapshot);
    var keySignals = buildKeySignalsFromSuggestions(suggestions);
    var scores = computeHealthScores(snapshot);
    var coach = buildCoachMessage(snapshot);
    var severitySummary = buildSeveritySummaryFromSuggestions(suggestions);
    var categorySummary = buildCategorySummaryFromSuggestions(suggestions);
    var nextActions = deriveNextActions(suggestions);
    emitEvent('suggestion_pack_generated', {
      snapshot: snapshot,
      context: context || {},
      suggestions: suggestions,
      scores: scores
    });
    return {
      scores: scores,
      suggestions: suggestions,
      coachMessage: coach,
      severitySummary: severitySummary,
      categorySummary: categorySummary,
      keySignals: keySignals,
      nextActions: nextActions
    };
  }

  function buildCavAIStatus() {
    var privacyActive = updatePrivacyState();
    return {
      ready: true,
      mode: 'browser',
      privacy: privacyActive ? 'restricted' : 'open',
      contextComplete: true,
      reasons: privacyReasons.slice()
    };
  }

  function resolveOriginKey(context) {
    if (context && typeof context.siteOrigin === 'string' && context.siteOrigin) {
      return context.siteOrigin;
    }
    if (context && typeof context.origin === 'string' && context.origin) {
      return context.origin;
    }
    return getWindowSiteOrigin();
  }

  function extractTopSuggestionIds(suggestions, limit) {
    var ids = [];
    if (!Array.isArray(suggestions)) return ids;
    var sorted = suggestions.slice();
    sorted.sort(function (a, b) {
      var wa = SUGGESTION_SEVERITY_WEIGHT[a.severity] || 0;
      var wb = SUGGESTION_SEVERITY_WEIGHT[b.severity] || 0;
      if (wb !== wa) return wb - wa;
      if (a.id && b.id) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }
      return 0;
    });
    for (var i = 0; i < sorted.length && ids.length < (limit || 5); i++) {
      var suggestion = sorted[i];
      if (suggestion && suggestion.id && ids.indexOf(suggestion.id) === -1) {
        ids.push(suggestion.id);
      }
    }
    return ids;
  }

  function extractTopCategories(categorySummary, limit) {
    var categories = [];
    if (!Array.isArray(categorySummary)) return categories;
    for (var i = 0; i < categorySummary.length && categories.length < (limit || 3); i++) {
      var entry = categorySummary[i];
      if (entry && entry.category) {
        categories.push(entry.category);
      }
    }
    return categories;
  }

  function buildKeySignalsFromSuggestions(suggestions) {
    var signals = {};
    if (!Array.isArray(suggestions)) return signals;
    var counters = {
      missingMeta: 0,
      missingTitle: 0,
      missingH1: 0,
      multipleH1: 0,
      socialTags: 0,
      focusVisible: 0,
      missingAlt: 0,
      brokenLinks: 0
    };
    var keyboardTrap = false;
    var noindex = false;

    for (var i = 0; i < suggestions.length; i++) {
      var item = suggestions[i];
      if (!item || !item.id) continue;
      var id = item.id;
      switch (id) {
        case 'missing_meta_description':
          counters.missingMeta += 1;
          break;
        case 'missing_title':
          counters.missingTitle += 1;
          break;
        case 'missing_h1':
          counters.missingH1 += 1;
          break;
        case 'multiple_h1':
          counters.multipleH1 += 1;
          break;
        case 'social_tags':
          counters.socialTags += 1;
          break;
        case 'focus_visible':
          counters.focusVisible += 1;
          break;
        case 'broken_links':
          counters.brokenLinks += 1;
          break;
        case 'missing_alt_text':
        case 'a11y_missing_alt':
          counters.missingAlt += 1;
          break;
        case 'keyboard_trap':
          keyboardTrap = true;
          break;
        case 'noindex':
          noindex = true;
          break;
        default:
          break;
      }
    }

    if (counters.missingMeta) {
      signals.missingMetaDescriptionCount = counters.missingMeta;
    }
    if (counters.missingTitle) {
      signals.missingTitleCount = counters.missingTitle;
    }
    if (counters.missingH1) {
      signals.missingH1Count = counters.missingH1;
    }
    if (counters.multipleH1) {
      signals.multipleH1Count = counters.multipleH1;
    }
    if (counters.socialTags) {
      signals.socialTagsMissingCount = counters.socialTags;
    }
    if (counters.focusVisible) {
      signals.focusVisibleIssuesCount = counters.focusVisible;
    }
    if (counters.missingAlt) {
      signals.missingAltCount = counters.missingAlt;
    }
    if (counters.brokenLinks) {
      signals.brokenLinksCount = counters.brokenLinks;
      signals.brokenLinksDetected = true;
    }
    if (keyboardTrap) {
      signals.keyboardTrapDetected = true;
    }
    if (noindex) {
      signals.noindexDetected = true;
    }

    return signals;
  }

  var MEMORY_SIGNATURE_WINDOW_MS = 3000;

  var cavAIMemory = (function () {
    var cachedMemory = null;
    var lastSignature = { origin: '', signature: '', ts: 0 };
    var MV = (typeof MEMORY_VERSION === 'number' && MEMORY_VERSION > 0) ? MEMORY_VERSION : 1;
    var MMO = (typeof MEMORY_MAX_ORIGINS === 'number' && MEMORY_MAX_ORIGINS > 0) ? MEMORY_MAX_ORIGINS : 25;
    var MMR = (typeof MEMORY_MAX_RUNS === 'number' && MEMORY_MAX_RUNS > 0) ? MEMORY_MAX_RUNS : 12;

    function createEmptyMemory() {
      return {
        version: MV,
        updatedAt: Date.now(),
        byOrigin: {}
      };
    }

    function sanitizeMemory(memory) {
      if (!memory || typeof memory !== 'object') {
        return createEmptyMemory();
      }
      memory.byOrigin = memory.byOrigin || {};
      if (typeof memory.updatedAt !== 'number') {
        memory.updatedAt = Date.now();
      }
      if (typeof memory.version !== 'number' || memory.version <= 0) {
        memory.version = MV;
      }
      return memory;
    }

    function canPersistMemory() {
      if (updatePrivacyState()) {
        cachedMemory = createEmptyMemory();
        removeStoredValue(MEMORY_STORAGE_KEY);
        return false;
      }
      return true;
    }

    function readMemory() {
      if (!canPersistMemory()) {
        return createEmptyMemory();
      }
      if (cachedMemory) {
        return cachedMemory;
      }
      cachedMemory = sanitizeMemory(readStoredJson(MEMORY_STORAGE_KEY, createEmptyMemory(), false));
      pruneOrigins(cachedMemory);
      return cachedMemory;
    }

    function persistMemory(memory) {
      cachedMemory = sanitizeMemory(memory || createEmptyMemory());
      if (!canPersistMemory()) {
        return cachedMemory;
      }
      writeStoredJson(MEMORY_STORAGE_KEY, cachedMemory, false);
      return cachedMemory;
    }

    function pruneOrigins(memory) {
      var keys = Object.keys(memory.byOrigin || {});
      if (keys.length <= MMO) {
        return;
      }
      keys.sort(function (a, b) {
        var aTs = memory.byOrigin[a] && memory.byOrigin[a].lastSeenAt ? memory.byOrigin[a].lastSeenAt : 0;
        var bTs = memory.byOrigin[b] && memory.byOrigin[b].lastSeenAt ? memory.byOrigin[b].lastSeenAt : 0;
        return aTs - bTs;
      });
      while (keys.length > MMO) {
        var remove = keys.shift();
        delete memory.byOrigin[remove];
      }
    }

    function buildRunEntry(summary, context, topIds, topCategories) {
      var scores = summary.scores || {};
      var severity = summary.severitySummary || {};
      var severityBy = severity.bySeverity || {};
      var run = {
        ts: Date.now(),
        pagesScanned:
          typeof context.pagesScanned === 'number' && context.pagesScanned >= 1
            ? context.pagesScanned
            : (typeof summary.pagesScanned === 'number' && summary.pagesScanned >= 1 ? summary.pagesScanned : 1),
        scores: {
          overall: typeof scores.overall === 'number' ? scores.overall : 0,
          seo: typeof scores.seo === 'number' ? scores.seo : 0,
          performance: typeof scores.performance === 'number' ? scores.performance : 0,
          accessibility: typeof scores.accessibility === 'number' ? scores.accessibility : 0,
          ux: typeof scores.ux === 'number' ? scores.ux : 0,
          engagement: typeof scores.engagement === 'number' ? scores.engagement : 0
        },
        severitySummary: {
          total: typeof severity.total === 'number' ? severity.total : 0,
          bySeverity: {
            critical: typeof severityBy.critical === 'number' ? severityBy.critical : 0,
            high: typeof severityBy.high === 'number' ? severityBy.high : 0,
            medium: typeof severityBy.medium === 'number' ? severityBy.medium : 0,
            low: typeof severityBy.low === 'number' ? severityBy.low : 0,
            note: typeof severityBy.note === 'number' ? severityBy.note : 0
          }
        },
        topSuggestionIds: topIds.slice(),
        topCategories: topCategories.slice(),
        keySignals: buildKeySignalsFromSuggestions(summary.suggestions),
        originContext: {
          path: context.path || '',
          planTier: context.planTier || null
        }
      };
      return run;
    }

    function buildStorageSignature(origin, summary, topIds) {
      var severity = summary.severitySummary || {};
      var total = typeof severity.total === 'number' ? severity.total : 0;
      var score = summary.scores && typeof summary.scores.overall === 'number'
        ? summary.scores.overall
        : 0;
      var ids = Array.isArray(topIds) ? topIds.join(',') : '';
      return origin + '|' + score + '|' + total + '|' + ids;
    }

    function recordFromSummary(opts) {
      opts = opts || {};
      var context = opts.context || {};
      var origin = typeof opts.origin === 'string' ? opts.origin : resolveOriginKey(context);
      var summary = opts.summary || {};
      var memory = readMemory();
      if (!origin) {
        return { memory: memory };
      }
      if (!canPersistMemory()) {
        return { memory: memory };
      }
      var topIds = extractTopSuggestionIds(summary.suggestions, 5);
      var categories = extractTopCategories(summary.categorySummary, 3);
      var signature = buildStorageSignature(origin, summary, topIds);
      var now = Date.now();
      if (
        lastSignature.origin === origin &&
        lastSignature.signature === signature &&
        now - lastSignature.ts < MEMORY_SIGNATURE_WINDOW_MS
      ) {
        return {
          memory: memory,
          run: memory.byOrigin[origin] &&
            memory.byOrigin[origin].runs &&
            memory.byOrigin[origin].runs[0]
        };
      }

      var originData = memory.byOrigin[origin] || { lastSeenAt: 0, runs: [] };
      var run = buildRunEntry(summary, context, topIds, categories);
      originData.runs = originData.runs || [];
      originData.runs.unshift(run);
      if (originData.runs.length > MMR) {
        originData.runs.pop();
      }
      originData.lastSeenAt = now;
      memory.byOrigin[origin] = originData;
      memory.updatedAt = now;
      memory.version = MV;
      pruneOrigins(memory);
      persistMemory(memory);
      lastSignature = { origin: origin, signature: signature, ts: now };

      return { memory: memory, run: run };
    }

    function getLast(origin) {
      var key = typeof origin === 'string' ? origin : '';
      var memory = readMemory();
      var entry = memory.byOrigin[key];
      return entry && Array.isArray(entry.runs) ? entry.runs[0] : null;
    }

    function getDelta(origin) {
      var key = typeof origin === 'string' ? origin : '';
      var memory = readMemory();
      var entry = memory.byOrigin[key];
      if (!entry || !Array.isArray(entry.runs) || entry.runs.length < 2) {
        return null;
      }
      var current = entry.runs[0];
      var previous = entry.runs[1];
      var deltaScores = {};
      var pillars = ['overall', 'seo', 'performance', 'accessibility', 'ux', 'engagement'];
      for (var i = 0; i < pillars.length; i++) {
        var pillar = pillars[i];
        var currScore = current.scores && typeof current.scores[pillar] === 'number'
          ? current.scores[pillar]
          : 0;
        var prevScore = previous.scores && typeof previous.scores[pillar] === 'number'
          ? previous.scores[pillar]
          : 0;
        deltaScores[pillar] = Math.round(currScore - prevScore);
      }
      var deltaIssues = {
        total: current.severitySummary.total - previous.severitySummary.total
      };
      var severities = ['critical', 'high', 'medium', 'low', 'note'];
      for (var s = 0; s < severities.length; s++) {
        var severityKey = severities[s];
        var currCount = current.severitySummary.bySeverity[severityKey] || 0;
        var prevCount = previous.severitySummary.bySeverity[severityKey] || 0;
        deltaIssues[severityKey] = currCount - prevCount;
      }
      var summaryParts = [];
      if (deltaScores.overall !== 0) {
        summaryParts.push(
          'Overall score ' +
            (deltaScores.overall > 0 ? 'up ' : 'down ') +
            Math.abs(deltaScores.overall) +
            ' points'
        );
      }
      if (deltaIssues.high !== 0) {
        summaryParts.push(
          'High-impact items ' +
            (deltaIssues.high > 0 ? 'increased by ' : 'decreased by ') +
            Math.abs(deltaIssues.high)
        );
      }
      var deltaSummaryText = summaryParts.length
        ? summaryParts.join('; ') + '.'
        : 'No meaningful change versus the previous scan.';
      return {
        deltaScores: deltaScores,
        deltaIssues: deltaIssues,
        deltaSummaryText: deltaSummaryText
      };
    }

    function getTrend(origin) {
      var delta = getDelta(origin);
      if (!delta) {
        return {
          state: 'stagnating',
          reason: 'Not enough history to establish a trend yet.'
        };
      }
      var overall = delta.deltaScores.overall;
      if (overall > 1) {
        return {
          state: 'improving',
          reason: 'Overall score has been rising since the last scan.'
        };
      }
      if (overall < -1) {
        return {
          state: 'declining',
          reason: 'Overall score dropped compared to the previous scan.'
        };
      }
      return {
        state: 'stagnating',
        reason: 'Score movement is minimal, so the trend is steady.'
      };
    }

    function resetOrigin(origin) {
      var key = typeof origin === 'string' ? origin : '';
      var memory = readMemory();
      if (key && memory.byOrigin && memory.byOrigin[key]) {
        delete memory.byOrigin[key];
        memory.updatedAt = Date.now();
        persistMemory(memory);
      }
      return memory;
    }

    function writeMemory(next) {
      if (!next || typeof next !== 'object') {
        return readMemory();
      }
      next.byOrigin = next.byOrigin || {};
      next.updatedAt = Date.now();
      next.version = MV;
      pruneOrigins(next);
      return persistMemory(next);
    }

    return {
      read: readMemory,
      write: writeMemory,
      recordFromSummary: recordFromSummary,
      getLast: getLast,
      getDelta: getDelta,
      getTrend: getTrend,
      resetOrigin: resetOrigin
    };
  })();

  var cavAIIntel = (function () {
    var ICS = (intentCallState && typeof intentCallState === 'object') ? intentCallState : {};
    intentCallState = ICS;
    if (typeof window !== 'undefined') {
      window.__cavaiIntentCallState = ICS;
    }

    var CONFIG_GLOBAL_IDS = {
      missing_viewport: true,
      missing_lang: true,
      missing_canonical: true,
      noindex: true
    };
    var CONFIDENCE_BASE_SCORE = 45;
    var CONFIDENCE_COVERAGE_WEIGHT = 35;
    var CONFIDENCE_RUN_WEIGHT = 5;
    var CONFIDENCE_REPEAT_WEIGHT = 6;
    var CONFIDENCE_CATEGORY_WEIGHT = 5;
    var DEFAULT_PAGE_CAP = 5;

    function getRunsForOrigin(memory, origin) {
      if (!origin || !memory || typeof memory !== 'object') {
        return [];
      }
      var entry = memory.byOrigin && memory.byOrigin[origin];
      if (!entry || !Array.isArray(entry.runs)) {
        return [];
      }
      return entry.runs;
    }

    function getRepeatDetails(summary, memory, origin) {
      var details = { count: 0, ids: [], categories: [] };
      if (!summary || !Array.isArray(summary.suggestions)) {
        return details;
      }
      var runs = getRunsForOrigin(memory, origin);
      if (runs.length < 2) {
        return details;
      }
      var previous = runs[1];
      if (!previous || !Array.isArray(previous.topSuggestionIds)) {
        return details;
      }
      var seenIds = {};
      var seenCategories = {};
      for (var i = 0; i < summary.suggestions.length; i++) {
        var suggestion = summary.suggestions[i];
        if (!suggestion || !suggestion.id) continue;
        if (previous.topSuggestionIds.indexOf(suggestion.id) === -1) continue;
        if (seenIds[suggestion.id]) continue;
        seenIds[suggestion.id] = true;
        details.ids.push(suggestion.id);
        details.count += 1;
        var category = suggestion.category || 'other';
        if (!seenCategories[category]) {
          seenCategories[category] = true;
          details.categories.push(category);
        }
      }
      return details;
    }

    function countConsecutiveRuns(id, runs) {
      if (!id || !Array.isArray(runs) || !runs.length) return 0;
      var consecutive = 0;
      for (var i = 0; i < runs.length; i++) {
        var run = runs[i];
        if (!run || !Array.isArray(run.topSuggestionIds)) {
          break;
        }
        if (run.topSuggestionIds.indexOf(id) !== -1) {
          consecutive += 1;
        } else {
          break;
        }
      }
      return consecutive;
    }

    function detectIntent(opts) {
      opts = opts || {};
      var origin = opts.origin || '';
      var memory = opts.memory || { byOrigin: {} };
      var state = ICS[origin] || { calls: 0, lastCallAt: 0 };
      var now = Date.now();
      var gap = state.lastCallAt ? now - state.lastCallAt : null;
      state.calls += 1;
      state.lastCallAt = now;
      ICS[origin] = state;

      var runs = (memory.byOrigin && memory.byOrigin[origin] && memory.byOrigin[origin].runs) || [];
      var runCount = runs.length;
      var intent = 'exploratory';
      var reason = 'Limited history suggests you are exploring this origin.';

      if (runCount <= 1 && state.calls <= 2) {
        intent = 'exploratory';
        reason = 'Early scans point toward familiarization.';
      } else if (gap !== null && gap > 24 * 60 * 60 * 1000) {
        var durationText;
        if (gap < 2 * 60 * 60 * 1000) {
          var minutes = Math.max(1, Math.round(gap / (60 * 1000)));
          durationText = minutes + ' minute' + (minutes === 1 ? '' : 's');
        } else if (gap < 48 * 60 * 60 * 1000) {
          var hours = Math.round(gap / (60 * 60 * 1000));
          durationText = hours + ' hour' + (hours === 1 ? '' : 's');
        } else {
          var days = Math.round(gap / (24 * 60 * 60 * 1000));
          durationText = days + ' day' + (days === 1 ? '' : 's');
        }
        intent = 'audit_mode';
        reason =
          'About ' + durationText + ' passed since the last scan; a great moment for an audit refresh.';
      } else if (gap !== null && gap < 5 * 60 * 1000) {
        intent = 'active_work';
        reason = 'Quick follow-up scans signal active troubleshooting.';
      } else if (runCount > 1) {
        intent = 'active_work';
        reason = 'Repeated scans show you are iterating on this origin.';
      }

      return { intent: intent, intentReason: reason };
    }

    function computeConfidence(opts) {
      opts = opts || {};
      var summary = opts.summary || {};
      var context = opts.context || {};
      var memory = opts.memory || { byOrigin: {} };
      var origin = opts.origin || '';
      var pagesScanned =
        typeof context.pagesScanned === 'number'
          ? context.pagesScanned
          : typeof summary.pagesScanned === 'number'
            ? summary.pagesScanned
            : 0;
      var pageLimit =
        typeof context.pageLimit === 'number' && context.pageLimit > 0
          ? context.pageLimit
          : DEFAULT_PAGE_CAP;
      var coverage = pagesScanned > 0
        ? Math.min(1, pagesScanned / Math.max(1, pageLimit))
        : 0;
      var runs = getRunsForOrigin(memory, origin);
      var runCount = runs.length;
      var repeatDetails = getRepeatDetails(summary, memory, origin);
      var categoryConsistency = repeatDetails.categories.length;
      var score = CONFIDENCE_BASE_SCORE;
      score += Math.round(coverage * CONFIDENCE_COVERAGE_WEIGHT);
      score += Math.min(20, runCount * CONFIDENCE_RUN_WEIGHT);
      score += Math.min(20, repeatDetails.count * CONFIDENCE_REPEAT_WEIGHT);
      score += Math.min(10, categoryConsistency * CONFIDENCE_CATEGORY_WEIGHT);
      if (score > 100) score = 100;
      if (score < 0) score = 0;
      var level = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';

      var reasonParts = [];
      if (pagesScanned > 0) {
        var percent = Math.round(coverage * 100);
        reasonParts.push(
          'Coverage: ' +
            pagesScanned +
            ' page' +
            (pagesScanned === 1 ? '' : 's') +
            ' (' +
            percent +
            '% of cap)'
        );
      } else {
        reasonParts.push('Coverage signal is limited (no page count).');
      }
      if (runCount >= 2) {
        reasonParts.push('Seen across ' + runCount + ' scans.');
      } else {
        reasonParts.push(
          'History limited to ' +
            runCount +
            ' scan' +
            (runCount === 1 ? '' : 's') +
            '.'
        );
      }
      if (repeatDetails.count) {
        reasonParts.push(
          'Detected ' +
            repeatDetails.count +
            ' repeat issue' +
            (repeatDetails.count === 1 ? '' : 's') +
            '.'
        );
        if (categoryConsistency > 1) {
          reasonParts.push('Across ' + categoryConsistency + ' pillars.');
        }
      }
      var reason = reasonParts.filter(Boolean).join(' ');
      return { level: level, reason: reason };
    }

    function computeRisk(opts) {
      opts = opts || {};
      var summary = opts.summary || {};
      var severity = summary.severitySummary || {};
      var severityBy = severity.bySeverity || {};
      var keySignals = opts.keySignals || {};
      var overallScore =
        summary.scores && typeof summary.scores.overall === 'number'
          ? summary.scores.overall
          : null;
      var high = severityBy.high || 0;
      var critical = severityBy.critical || 0;
      var riskLevel = 'low';
      var brokenLinks = keySignals.brokenLinksCount || 0;

      if (critical > 0 || keySignals.noindexDetected || brokenLinks > 2) {
        riskLevel = 'high';
      } else if (
        high >= 2 ||
        (overallScore !== null && overallScore < 60) ||
        brokenLinks > 0
      ) {
        riskLevel = 'medium';
      }

      var reasons = [];
      if (critical > 0) {
        reasons.push(critical + ' critical item' + (critical === 1 ? '' : 's'));
      }
      if (high > 0) {
        reasons.push(high + ' high-severity item' + (high === 1 ? '' : 's'));
      }
      if (keySignals.noindexDetected) {
        reasons.push('page is set to noindex');
      }
      if (brokenLinks > 0) {
        reasons.push(
          brokenLinks + ' broken link' + (brokenLinks === 1 ? '' : 's')
        );
      }
      if (overallScore !== null) {
        reasons.push('overall score ' + overallScore + '/100');
      }
      var reason = reasons.slice(0, 3).join('; ');
      if (!reason) {
        reason = 'No high-impact signals detected yet.';
      }
      return { risk: riskLevel, riskReason: reason };
    }

    function countRepetition(summary, memory, origin) {
      var topIds = summary.topSuggestionIds || extractTopSuggestionIds(summary.suggestions, 3);
      if (!Array.isArray(topIds) || !topIds.length) {
        return 0;
      }
      var runs = (memory.byOrigin && memory.byOrigin[origin] && memory.byOrigin[origin].runs) || [];
      if (runs.length < 2) return 0;
      var previous = runs[1];
      if (!previous || !Array.isArray(previous.topSuggestionIds)) {
        return 0;
      }
      var count = 0;
      for (var i = 0; i < topIds.length; i++) {
        if (previous.topSuggestionIds.indexOf(topIds[i]) !== -1) {
          count += 1;
        }
      }
      return count;
    }

    function classifyFixReadiness(opts) {
      opts = opts || {};
      var suggestion = opts.suggestion || null;
      var origin = opts.origin || '';
      var memory = opts.memory || { byOrigin: {} };
      var context = opts.context || {};
      if (!suggestion || !suggestion.id) {
        return {
          readiness: 'content',
          why: 'This item lacks a stable identifier, so treat it as content-level.'
        };
      }
      var id = suggestion.id;
      var runs = getRunsForOrigin(memory, origin);
      var consecutive = countConsecutiveRuns(id, runs);
      var pagesScanned =
        typeof context.pagesScanned === 'number' ? context.pagesScanned : null;
      var pageLimit =
        typeof context.pageLimit === 'number' && context.pageLimit > 0
          ? context.pageLimit
          : null;
      var coveragePct = null;
      if (pagesScanned != null && pageLimit) {
        coveragePct = Math.min(1, pagesScanned / pageLimit);
      }
      if (coveragePct !== null && coveragePct >= 0.6) {
        return {
          readiness: 'config',
          why: 'Appears on about ' + Math.round(coveragePct * 100) + '% of the scanned pages.'
        };
      }
      var category = suggestion.category || '';
      var isGlobal = CONFIG_GLOBAL_IDS[id];
      if (isGlobal && consecutive >= 2 && (category === 'seo' || category === 'accessibility')) {
        return {
          readiness: 'config',
          why: 'Global metadata persisted across scans, so treat it as template-level config.'
        };
      }
      if (isGlobal && consecutive >= 2) {
        return {
          readiness: 'config',
          why: 'Global tag detected across multiple runs; this is a config-level signal.'
        };
      }
      if (consecutive >= 2) {
        return {
          readiness: 'template',
          why:
            'Detected in ' +
            consecutive +
            ' scans in the ' +
            (category || 'site') +
            ' pillar; likely template-level.'
        };
      }
      var historyNote =
        runs.length
          ? 'History: ' + runs.length + ' scan' + (runs.length === 1 ? '' : 's') + '.'
          : 'No prior scans yet.';
      return {
        readiness: 'content',
        why: 'Limited to this run; ' + historyNote
      };
    }

    function assessFatigue(origin, suggestions, memory) {
      var runs = (memory.byOrigin && memory.byOrigin[origin] && memory.byOrigin[origin].runs) || [];
      if (runs.length < 2) {
        return {
          persistedCount: 0,
          fatigueTone: 'none',
          fatigueMessage: 'Need at least two scans before we can surface persistent issues.'
        };
      }
      var persisted = [];
      var suggestionMap = {};
      for (var i = 0; i < suggestions.length; i++) {
        var item = suggestions[i];
        if (item && item.id) {
          suggestionMap[item.id] = item;
        }
      }
      var keys = Object.keys(suggestionMap);
      for (var k = 0; k < keys.length; k++) {
        var id = keys[k];
        var runsCount = countConsecutiveRuns(id, runs);
        if (runsCount >= 2) {
          persisted.push({
            id: id,
            runs: runsCount,
            severity: suggestionMap[id].severity || 'medium'
          });
        }
      }

      var persistedCount = persisted.length;
      var fatigueTone = 'none';
      var fatigueMessage = 'No persistent issues detected yet.';
      var hasFirm = persisted.some(function (item) {
        return item.runs >= 3 && (item.severity === 'high' || item.severity === 'critical');
      });
      if (hasFirm) {
        fatigueTone = 'firm';
        fatigueMessage = 'A high-impact issue has persisted for 3+ scans; escalate it to keep momentum.';
      } else if (persistedCount >= 2) {
        fatigueTone = 'nudge';
        fatigueMessage = 'Several issues are showing up repeatedly; resolve them to avoid fatigue.';
      } else if (persistedCount === 1) {
        fatigueTone = 'nudge';
        fatigueMessage = 'One issue has appeared in recent scans; tackling it now keeps the trend moving.';
      }

      return {
        persistedCount: persistedCount,
        fatigueTone: fatigueTone,
        fatigueMessage: fatigueMessage
      };
    }

    function buildInsightsViewModel(opts) {
      opts = opts || {};
      var pack = opts.pack || {};
      var origin = opts.origin || '';
      var scan = opts.scan || {};
      var memory = opts.memory || { byOrigin: {} };
      var keySignals = pack.keySignals || buildKeySignalsFromSuggestions(pack.suggestions || []);
      var scores = pack.scores || {};
      var severitySummary = pack.severitySummary || { total: 0, bySeverity: {} };
      var trend = (pack.intel && pack.intel.trend) || { state: 'stagnating', reason: '' };
      var confidenceLevel = (pack.intel && pack.intel.confidence) || 'medium';
      var riskLevel = (pack.intel && pack.intel.risk) || 'medium';
      var confidenceReason = (pack.intel && pack.intel.confidenceReason) || '';
      var riskReason = (pack.intel && pack.intel.riskReason) || '';
      var headerSubtitle = scan.pagesScanned
        ? 'Based on ' +
          scan.pagesScanned +
          ' deterministic page scan' +
          (scan.pagesScanned === 1 ? '' : 's')
        : 'Based on the latest snapshot';

      function capitalize(value) {
        return typeof value === 'string' && value.length
          ? value.charAt(0).toUpperCase() + value.slice(1)
          : '';
      }

      function toneForBadge(value, type) {
        if (type === 'confidence') {
          return value === 'high' ? 'good' : value === 'medium' ? 'caution' : 'alert';
        }
        if (type === 'risk') {
          return value === 'high' ? 'alert' : value === 'medium' ? 'caution' : 'good';
        }
        return 'neutral';
      }

      function toneForTrend(state) {
        if (state === 'improving') return 'good';
        if (state === 'declining') return 'alert';
        return 'neutral';
      }

      var badges = [
        {
          label: 'Confidence: ' + capitalize(confidenceLevel),
          tone: toneForBadge(confidenceLevel, 'confidence')
        },
        {
          label: 'Risk: ' + capitalize(riskLevel),
          tone: toneForBadge(riskLevel, 'risk')
        }
      ];
      if (trend && trend.state) {
        badges.push({
          label: 'Trend: ' + capitalize(trend.state),
          tone: toneForTrend(trend.state)
        });
      }

      var scoreCards = [];
      if (typeof scores.overall === 'number') {
        scoreCards.push({
          label: 'Overall health',
          value: scores.overall,
          detail: labelForScore(scores.overall)
        });
      }
      var pillarKeys = ['seo', 'performance', 'accessibility', 'ux', 'engagement'];
      for (var p = 0; p < pillarKeys.length; p++) {
        var pillarKey = pillarKeys[p];
        if (typeof scores[pillarKey] === 'number') {
          scoreCards.push({
            label: pillarKey.charAt(0).toUpperCase() + pillarKey.slice(1),
            value: scores[pillarKey],
            detail: labelForScore(scores[pillarKey])
          });
        }
      }

      var priorityList = [];
      var suggestions = pack.suggestions || [];
      for (var i = 0; i < Math.min(3, suggestions.length); i++) {
        var suggestion = suggestions[i];
        if (!suggestion) continue;
        priorityList.push({
          id: suggestion.id || null,
          title: suggestion.message || 'Untitled insight',
          severity: suggestion.severity || 'medium',
          metric: suggestion.metric || null,
          scoreImpact: typeof suggestion.scoreImpact === 'number' ? suggestion.scoreImpact : 0,
          category: suggestion.category || 'other'
        });
      }

      var nextActions = (pack.nextActions || []).map(function (action) {
        return {
          suggestionId: action.suggestionId,
          title: action.title,
          hint: action.hint,
          priority: action.priority,
          readiness: action.readiness,
          why: action.why
        };
      });

      var runs = getRunsForOrigin(memory, origin);
      var historyLinks = runs.slice(0, 3).map(function (run) {
        return {
          ts: run.ts || 0,
          label: run.ts ? 'Scan ' + new Date(run.ts).toISOString() : 'Previous scan',
          overall: run.scores && typeof run.scores.overall === 'number' ? run.scores.overall : null,
          issues:
            run.severitySummary && typeof run.severitySummary.total === 'number'
              ? run.severitySummary.total
              : 0
        };
      });

      var rationale = {
        coachMessage: pack.coachMessage || '',
        severitySummary: severitySummary,
        keySignals: keySignals,
        scanSummary: scan.summary || '',
        pagesScanned: scan.pagesScanned || null,
        pagesSelected: scan.pagesSelected || []
      };

      return {
        header: {
          title: origin ? 'Insights · ' + origin : 'CavAi Insights',
          subtitle: headerSubtitle
        },
        badges: badges,
        scoreCards: scoreCards,
        trendCard: {
          state: trend.state || 'stagnating',
          reason: trend.reason || 'Trend data is stabilizing.'
        },
        confidenceCard: {
          level: confidenceLevel,
          reason: confidenceReason || 'Available signals are limited.'
        },
        riskCard: {
          level: riskLevel,
          reason: riskReason || 'No high-impact signals detected.'
        },
        priorities: priorityList,
        nextActions: nextActions,
        rationale: rationale,
        historyLinks: historyLinks
      };
    }

    return {
      computeConfidence: computeConfidence,
      computeRisk: computeRisk,
      classifyFixReadiness: classifyFixReadiness,
      detectIntent: detectIntent,
      assessFatigue: assessFatigue,
      buildInsightsViewModel: buildInsightsViewModel
    };
  })();

  function isDebugModeEnabled() {
    if (typeof window === 'undefined') return false;
    try {
      if (globalThis.__cbSessionStore && globalThis.__cbSessionStore.getItem(DEBUG_STORAGE_KEY) === '1') {
        return true;
      }
      if (window.location && window.location.search) {
        var params = new URLSearchParams(window.location.search);
        if (params.get('cavaiDebug') === '1') {
          return true;
        }
      }
    } catch (e) {
      // ignore debug detection issues
    }
    return false;
  }

  var cavAI = {
    version: '1.x',
    build: {
      ts: '1.0',
      features: ['diagnostics', 'fixes', 'geo'],
      sdkVersion: '1.0.0'
    },
    status: buildCavAIStatus,
    configure: function (opts) {
      opts = opts || {};
      if (typeof opts.diagnosticsEndpoint === 'string') {
        cavAIConfig.diagnosticsEndpoint = opts.diagnosticsEndpoint;
      }
      if (typeof opts.fixEndpoint === 'string') {
        cavAIConfig.fixEndpoint = opts.fixEndpoint;
      }
      if (typeof opts.timeoutMs === 'number') {
        cavAIConfig.timeoutMs = opts.timeoutMs;
      }
      if (typeof opts.debounceMs === 'number') {
        cavAIConfig.debounceMs = opts.debounceMs;
      }
      if (typeof opts.geoTimeoutMs === 'number') {
        cavAIConfig.geoTimeoutMs = opts.geoTimeoutMs;
      }
      return cavAIConfig;
    },
  requestDiagnostics: function (opts) {
    var payload = opts || {};
    if (updatePrivacyState()) {
      emitEvent('diagnostics_failed', { reason: 'privacy_gate_active' });
      return Promise.resolve({ ok: false, reason: 'privacy_gate_active' });
    }
    var context = buildContextSnapshot();
    payload.context = payload.context || context;
    var originKey = resolveOriginKey(payload.context);
    var reservation = reserveSoftBurstSlot(originKey);
    if (!reservation.allowed) {
      emitEvent('diagnostics_rate_limited', {
        reason: 'soft_burst_control',
        origin: originKey
      });
      trackLifecycleAnalytics('diagnostics_rate_limited', {
        ok: false,
        reason: 'soft_burst_control',
        durationMs: 0,
        originKey: originKey || null,
        pagesScanned:
          payload.context && typeof payload.context.pagesScanned === 'number'
            ? payload.context.pagesScanned
            : null
      }, { component: 'cavai-console-shell' });
      return Promise.resolve({
        ok: false,
        reason: 'soft_burst_control',
        message: SOFT_BURST_MESSAGE
      });
    }
    return scheduleDiagnosticsRequest(payload);
  },
    requestFixDiff: requestFixDiff,
    getSuggestionPack: function (snapshot, context) {
      var pack = buildSuggestionPack(snapshot, context);
      var ctx = context || buildContextSnapshot();
      var originKey = resolveOriginKey(ctx);
      var keySignals = pack.keySignals || buildKeySignalsFromSuggestions(pack.suggestions);
      var summaryForMemory = {
        scores: pack.scores,
        suggestions: pack.suggestions,
        severitySummary: pack.severitySummary,
        categorySummary: pack.categorySummary,
        pagesScanned: ctx.pagesScanned || 1,
        topSuggestionIds: extractTopSuggestionIds(pack.suggestions, 5),
        keySignals: keySignals
      };
      try {
        if (originKey && cavAI.memory && typeof cavAI.memory.recordFromSummary === 'function') {
          cavAI.memory.recordFromSummary({
            origin: originKey,
            summary: summaryForMemory,
            context: ctx
          });
        }
      } catch (err) {
        // ignore recorder errors
      }
      var memoryState = cavAI.memory.read();
      var confidence = cavAI.intel.computeConfidence({
        origin: originKey,
        summary: summaryForMemory,
        memory: memoryState,
        context: ctx
      });
      var risk = cavAI.intel.computeRisk({
        origin: originKey,
        summary: summaryForMemory,
        keySignals: keySignals
      });
      var delta = cavAI.memory.getDelta(originKey);
      var trend = cavAI.memory.getTrend(originKey);
      var fatigue = cavAI.intel.assessFatigue(originKey, pack.suggestions, memoryState);
      var intentInfo = cavAI.intel.detectIntent({
        origin: originKey,
        memory: memoryState,
        session: session
      });
      pack.nextActions = pack.nextActions.map(function (action) {
        var suggestion = null;
        for (var i = 0; i < pack.suggestions.length; i++) {
          var candidate = pack.suggestions[i];
          if (candidate && candidate.id === action.suggestionId) {
            suggestion = candidate;
            break;
          }
        }
        var classification = cavAI.intel.classifyFixReadiness({
          suggestion: suggestion,
          summary: pack,
          memory: memoryState,
          origin: originKey,
          context: ctx
        });
        return Object.assign({}, action, classification);
      });
      pack.intel = pack.intel || {};
      pack.intel.confidence = confidence.level;
      pack.intel.confidenceReason = confidence.reason;
      pack.intel.risk = risk.risk;
      pack.intel.riskReason = risk.riskReason;
      pack.intel.keySignals = keySignals;
      pack.intel.delta = delta;
      pack.intel.fatigue = fatigue;
      pack.intel.intent = intentInfo.intent;
      pack.intel.intentReason = intentInfo.intentReason;
      pack.intel.trend = trend;
      if (isDebugModeEnabled() && typeof window !== 'undefined' && window.console && typeof window.console.debug === 'function') {
        var debugPayload = {
          origin: originKey,
          confidence: pack.intel.confidence,
          delta: pack.intel.delta,
          fatigue: pack.intel.fatigue,
          intent: pack.intel.intent,
          memorySize: memoryState && memoryState.byOrigin
            ? Object.keys(memoryState.byOrigin).length
            : 0
        };
        window.console.debug('cavAI intel', debugPayload);
      }
      return pack;
    },
    getGeoSnapshot: function () {
      return Object.assign({}, coarseGeoSnapshot);
    },
    requestGeo: function (opts) {
      return requestGeoInternal(opts).then(function (result) {
        if (result.ok && result.geo) {
          coarseGeoSnapshot = {
            tz: coarseGeoSnapshot.tz,
            locale: coarseGeoSnapshot.locale,
            regionHint: result.geo.region || coarseGeoSnapshot.regionHint,
            updatedAt: Date.now()
          };
          if (typeof window !== 'undefined') {
            persistGeoSnapshot(coarseGeoSnapshot);
          }
        }
        return result;
      });
    },
    getContext: function () {
      return buildContextSnapshot();
    },
    on: onEvent,
    off: offEvent,
    emit: emitEvent
  };

  cavAI.memory = cavAIMemory;
  cavAI.intel = cavAIIntel;

  window.cavAI = window.cavAI || cavAI;
  window.cavAI.memory = window.cavAI.memory || cavAI.memory;
  window.cavAI.intel = window.cavAI.intel || cavAI.intel;
  window.cavai.requestDiagnostics = window.cavai.requestDiagnostics || window.cavAI.requestDiagnostics;
  window.cavai.requestFixDiff = window.cavai.requestFixDiff || window.cavAI.requestFixDiff;
  window.cavai.getSuggestionPack = window.cavai.getSuggestionPack || window.cavAI.getSuggestionPack;
  window.cavai.cavAI = window.cavAI;
  window.cavai.memory = window.cavai.memory || window.cavAI.memory;
  window.cavai.intel = window.cavai.intel || window.cavAI.intel;
 /* =========================================================
   CavAi — Eye Tracking (supports ALL CavBot heads)
   Targets:
   - Grid heads: .cavbot-eye-pupil inside .cavbot-eye-inner
   - DM avatar:  .cavbot-dm-eye-pupil inside .cavbot-dm-eye-inner
   ========================================================= */

 (function () {
   'use strict';

   // prevent double-binding if brain loads twice
   if (window.__cavbotEyeTrackingBound) return;
   window.__cavbotEyeTrackingBound = true;

   const MAX_PX = 5; // pupil travel
   const MAX_SHIFT_X = 3.2; // clamp horizontal travel so pupils stay inside bezel
   const MAX_SHIFT_Y = 2.6; // clamp vertical travel as well

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

   function getPupilPairs() {
     const pupils = Array.from(
       document.querySelectorAll(
         // IMPORTANT: exclude pupils already managed by the head-tracking engine
         '.cavbot-eye-pupil:not([data-cavbot-pupil-managed]), .cavbot-dm-eye-pupil:not([data-cavbot-pupil-managed])'
       )
     );

     return pupils.map(p => {
       const inner =
         p.closest('.cavbot-eye-inner') ||
         p.closest('.cavbot-dm-eye-inner') ||
         p.parentElement;

       const cs = window.getComputedStyle(p);
       const baseTransform = (cs && cs.transform && cs.transform !== 'none') ? cs.transform : '';

       return inner ? { pupil: p, inner, baseTransform } : null;
     }).filter(Boolean);
   }

   var eyeTrackingStarted = false;

   function start() {
     if (eyeTrackingStarted) return;
     eyeTrackingStarted = true;
     let pairs = getPupilPairs();

     // If your page dynamically injects heads later, this keeps it resilient
    const refresh = () => {
      pairs = getPupilPairs();
      if (typeof window !== 'undefined') {
        window.__cavbotEyeTrackingLastRefresh = Date.now();
      }
    };

     let lastX = null, lastY = null, raf = null;

     // ===== ADDED: persist last pointer across navigations + seed on load (prevents static DM badge eyes) =====
     const LAST_POINTER_KEY = 'cavbotLastPointerV1';

     function readLastPointer() {
       try {
         const raw = globalThis.__cbSessionStore && globalThis.__cbSessionStore.getItem(LAST_POINTER_KEY);
         if (!raw) return null;
         const obj = JSON.parse(raw);
         if (!obj || typeof obj !== 'object') return null;
         const x = typeof obj.x === 'number' ? obj.x : null;
         const y = typeof obj.y === 'number' ? obj.y : null;
         if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
         return { x, y };
       } catch (e) {
         return null;
       }
     }

     function writeLastPointer(x, y) {
       try {
         if (!globalThis.__cbSessionStore) return;
         if (typeof x !== 'number' || typeof y !== 'number') return;
         if (!isFinite(x) || !isFinite(y)) return;
         globalThis.__cbSessionStore.setItem(LAST_POINTER_KEY, JSON.stringify({ x: x, y: y, ts: Date.now() }));
       } catch (e) {
         // ignore
       }
     }

     function seedPointer() {
       const saved = readLastPointer();
       if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
         queue(saved.x, saved.y);
         return;
       }
       // deterministic-ish, subtle offset (keeps badge eyes "alive" on first paint)
       const w = Math.max(window.innerWidth || 1, 1);
       const h = Math.max(window.innerHeight || 1, 1);
       const t = Date.now() % 1000;
       const ox = ((t / 1000) - 0.5) * 60; // -30..30 px
       const oy = (((1000 - t) / 1000) - 0.5) * 40; // -20..20 px
       queue(w * 0.55 + ox, h * 0.45 + oy);
     }
     // ================================================================================================

     function update() {
       raf = null;
       if (lastX == null || lastY == null) return;

       for (const { pupil, inner, baseTransform } of pairs) {
         const r = inner.getBoundingClientRect();
         const cx = r.left + r.width / 2;
         const cy = r.top + r.height / 2;

         const dx = lastX - cx;
         const dy = lastY - cy;

         const dist = Math.hypot(dx, dy) || 1;
         const nx = dx / dist;
         const ny = dy / dist;

         const amt = clamp(dist / 90, 0, 1) * MAX_PX;
         const shiftX = clamp(nx * amt, -MAX_SHIFT_X, MAX_SHIFT_X);
         const shiftY = clamp(ny * amt, -MAX_SHIFT_Y, MAX_SHIFT_Y);

         let t = `translate(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px)`;
         if (baseTransform) t += ` ${baseTransform}`;
         pupil.style.transform = t;
       }
     }

     function queue(x, y) {
       lastX = x; lastY = y;
       writeLastPointer(x, y);
       if (raf == null) raf = requestAnimationFrame(update);
     }

     // Primary pointer tracking
     window.addEventListener('pointermove', e => queue(e.clientX, e.clientY), { passive: true });
     window.addEventListener('mousemove',   e => queue(e.clientX, e.clientY), { passive: true });

     // Touch support
     window.addEventListener('touchmove', e => {
       const t = e.touches && e.touches[0];
       if (t) queue(t.clientX, t.clientY);
     }, { passive: true });

     // Reset on leave
     window.addEventListener('pointerleave', () => {
       lastX = lastY = null;
       for (const { pupil, baseTransform } of pairs) {
         pupil.style.transform = baseTransform ? baseTransform : 'translate(0,0)';
       }
     });

     // Optional: refresh pairs when user interacts (covers injected DOM)
     window.addEventListener('click', refresh, { passive: true });
     window.addEventListener('keydown', refresh, { passive: true });

     // ===== ADDED: auto-refresh on DOM changes / route changes (fixes DM badge pupils injected after load) =====
     let refreshScheduled = false;
     function scheduleRefresh() {
       if (refreshScheduled) return;
       refreshScheduled = true;
       requestAnimationFrame(() => {
         refreshScheduled = false;
         refresh();
       });
     }

     try {
       const mo = new MutationObserver(muts => {
         for (const m of muts) {
           if (!m || !m.addedNodes || !m.addedNodes.length) continue;
           for (const n of m.addedNodes) {
             if (!n || n.nodeType !== 1) continue;
             // Fast-path: if any injected node contains/IS a pupil/inner/head, refresh pairs
             if (
               (n.matches && (n.matches('.cavbot-eye-pupil, .cavbot-dm-eye-pupil, .cavbot-eye-inner, .cavbot-dm-eye-inner, [data-cavbot-head], .cavbot-dm-avatar'))) ||
               (n.querySelector && n.querySelector('.cavbot-eye-pupil, .cavbot-dm-eye-pupil, .cavbot-eye-inner, .cavbot-dm-eye-inner, [data-cavbot-head], .cavbot-dm-avatar'))
             ) {
               scheduleRefresh();
               return;
             }
           }
         }
       });
       mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
     } catch (e) {
       // ignore
     }

     window.addEventListener('pageshow', () => { scheduleRefresh(); seedPointer(); }, { passive: true });
     window.addEventListener('popstate', () => { scheduleRefresh(); seedPointer(); }, { passive: true });
    window.addEventListener('hashchange', () => { scheduleRefresh(); seedPointer(); }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
        seedPointer();
      }
    }, { passive: true });
    // ================================================================================================

    if (typeof window !== 'undefined') {
      window.__cavbotEyeTrackingReady = true;
      window.__cavbotEyeTrackingLastRefresh = Date.now();
      window.__cavaiEyeTrackingRefresh = refresh;
    }

    // ===== ADDED: seed pointer on start so badge eyes are never static on initial paint =====
    seedPointer();
     // ====================================================================================
   }

   function bootEyeTracking() {
     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', start, { once: true });
     } else {
       start();
     }
   }

   if (typeof window !== 'undefined') {
     window.__cavaiEyeTrackingStart = bootEyeTracking;
   }

   if (!shouldDeferTrackingBootstrap()) {
     bootEyeTracking();
   }
 })();
})();
