/**
 * dsh-row-time — inline per-row start time for the DSH conversation view.
 *
 * Browser half. Hand-written `__ModuleLoader__` bundle (no build step needed):
 * the loader only registers the factory; materialization happens on import.
 *
 * Design notes (why this survives upgrades):
 *  - Rendering is pure DOM: we never replace or patch a host React component,
 *    so a host re-render can at worst drop our node, which the observer re-adds.
 *  - Data access is expressed as an ordered list of ADAPTERS. Each adapter is a
 *    tiny function; when a future release moves the chat store, only the first
 *    adapter needs editing (or a new one prepended) — the rest of this file,
 *    including formatting and placement, stays untouched.
 *  - Anything unresolvable degrades to "no badge", never to an error or a
 *    half-broken row.
 */

window.__ModuleLoader__.load({
	id: 'dsh-row-time',
	factory: function () {
		'use strict';

		var VERSION = '1.0.1';
		var PLUGIN = 'dsh-row-time';
		var BADGE_ATTR = 'data-dsh-row-time';
		var BADGE_CLASS = 'dsh-row-time-badge';

		// Host DOM seams this plugin reads. Every one of them is a stable,
		// host-authored attribute (not a CSS class), which is what makes the
		// DOM half resilient across releases.
		//
		// Only block-level row containers are used as anchors: node flow items and
		// tool call rows. The inner collapse header (`[data-disclosure-row]`) is a
		// horizontal flex line and must never host a badge.
		var SEL_SESSION = '[data-conversation-session]';
		var SEL_NODE = '[data-chat-node-key]';
		var SEL_CALL = '[data-chat-call-id]';
		var SEL_HEADER = '[data-disclosure-row]';

		var CSS = [
			'.' + BADGE_CLASS + '{',
			'flex:none;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;',
			'color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;',
			'user-select:none;pointer-events:none;opacity:.85;',
			'margin-right:8px;',
			'}'
		].join('');

		// ---------------------------------------------------------------- util

		function pad2(n) {
			return n < 10 ? '0' + n : '' + n;
		}

		var dayCache = { at: 0, start: 0 };

		/**
		 * Start of the local day, cached for a minute: `formatClock` runs for every
		 * row on every pass, and a `new Date()` midnight dance per row is wasteful.
		 */
		function todayStart() {
			var now = Date.now();
			if (dayCache.start !== 0 && now - dayCache.at < 60000) return dayCache.start;
			var d = new Date(now);
			d.setHours(0, 0, 0, 0);
			dayCache.at = now;
			dayCache.start = d.getTime();
			return dayCache.start;
		}

		/** `HH:MM:SS` for today, `MM-DD HH:MM` for anything older. */
		function formatClock(ms) {
			if (typeof ms !== 'number' || !isFinite(ms)) return '';
			var d = new Date(ms);
			var hms = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
			if (todayStart() === todayStartOf(ms)) return hms;
			return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
		}

		function todayStartOf(ms) {
			var d = new Date(ms);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}

		function num(v) {
			return typeof v === 'number' && isFinite(v) ? v : null;
		}

		function isObj(v) {
			return typeof v === 'object' && v !== null;
		}

		function safeGet(ctx, name) {
			try {
				return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
			} catch (e) {
				return undefined;
			}
		}

		// ------------------------------------------------- timing extraction

		/**
		 * Start-of-node extractor. Returns epoch ms or null.
		 *
		 * Field names are the engine's persisted chat model (`callTime`, `time`,
		 * `timing.stepStartTime`) — data, not API surface, so they outlive UI
		 * refactors far better than component internals do.
		 */
		function startOfNode(node) {
			if (!isObj(node)) return null;
			var data = isObj(node.data) ? node.data : null;
			switch (node.kind) {
				case 'tool-call': {
					var root = data && isObj(data.root) ? data.root : null;
					if (!root) return null;
					// Running calls only carry `time` (the moment it started); settled
					// calls carry `callTime` (start) + `time` (finish).
					return num(root.callTime) !== null ? num(root.callTime) : num(root.time);
				}
				case 'assistant-step': {
					var finalNode = data && isObj(data.finalNode) ? data.finalNode : null;
					var timing = finalNode && isObj(finalNode.timing) ? finalNode.timing : null;
					if (timing) {
						if (num(timing.stepStartTime) !== null) return num(timing.stepStartTime);
						if (num(timing.firstTokenTime) !== null) return num(timing.firstTokenTime);
						if (num(timing.completedTime) !== null) return num(timing.completedTime);
					}
					break;
				}
				case 'manual-compaction': {
					var command = data && isObj(data.command) ? data.command : null;
					if (command && num(command.time) !== null) return num(command.time);
					break;
				}
				default:
					break;
			}
			// user / steering / context / command / model-retry / turn-error /
			// turn-max-tokens and any future single-timestamp kind.
			if (data && num(data.time) !== null) return num(data.time);
			if (num(node.time) !== null) return num(node.time);
			return null;
		}

		function indexCall(block, byCall) {
			if (!isObj(block)) return;
			var callId = typeof block.callId === 'string' ? block.callId : null;
			if (callId !== null) {
				var started = num(block.callTime) !== null ? num(block.callTime) : num(block.time);
				if (started !== null) byCall.set(callId, started);
			}
			var subs = block.subCalls;
			if (Array.isArray(subs)) {
				for (var i = 0; i < subs.length; i += 1) indexCall(subs[i], byCall);
			}
		}

		/** Build `{ byKey, byCall }` from one chat snapshot. Never throws. */
		function buildIndex(snapshot, byKey, byCall) {
			if (!isObj(snapshot) || !isObj(snapshot.nodes)) return false;
			var nodes = snapshot.nodes;
			var seen = 0;
			var order = Array.isArray(snapshot.order) ? snapshot.order : null;
			var getNode = function (key) {
				try {
					return typeof nodes.get === 'function' ? nodes.get(key) : nodes[key];
				} catch (e) {
					return undefined;
				}
			};
			var visit = function (node) {
				if (!isObj(node)) return;
				var start = startOfNode(node);
				if (start !== null) byKey.set(node.key, start);
				var data = isObj(node.data) ? node.data : null;
				if (data && isObj(data.root)) indexCall(data.root, byCall);
				seen += 1;
			};
			if (order !== null) {
				for (var i = 0; i < order.length; i += 1) visit(getNode(order[i]));
			} else if (typeof nodes.forEach === 'function') {
				nodes.forEach(visit);
			} else if (isObj(nodes)) {
				for (var k in nodes) {
					if (Object.prototype.hasOwnProperty.call(nodes, k)) visit(nodes[k]);
				}
			}
			return seen > 0;
		}

		// ------------------------------------------------------- data adapters

		/**
		 * Ordered adapters: each returns a `{ getSnapshot, subscribe? }` target
		 * for a session id, or null. Prepend a new one when a release moves the
		 * store; leave the others as legacy fallbacks.
		 */
		var ADAPTERS = [
			function uiConversationTarget(ctx, sessionId) {
				var conversation = safeGet(ctx, 'uiConversation');
				var sessions = safeGet(ctx, 'sessions');
				if (!conversation || !sessions || typeof conversation.binding !== 'function') return null;
				var binding = null;
				try {
					binding = typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null;
				} catch (e) {
					binding = null;
				}
				var tryTarget = function (subject) {
					if (subject === null || subject === undefined) return null;
					try {
						var entry = conversation.binding(subject);
						var target = entry && typeof entry.target === 'function' ? entry.target('chat') : null;
						if (target && typeof target.getSnapshot === 'function') return target;
					} catch (e) {
						/* fall through */
					}
					return null;
				};
				return tryTarget(binding) || tryTarget(sessionId);
			},
			function sessionChatSnapshot(ctx, sessionId) {
				var sessions = safeGet(ctx, 'sessions');
				if (!sessions || typeof sessions.binding !== 'function') return null;
				try {
					var binding = sessions.binding(sessionId);
					var session = binding && binding.session;
					if (!session || typeof session.getSnapshot !== 'function') return null;
					// Pre-0.2 releases exposed the chat tree directly on the session
					// snapshot; keep working there without any other change.
					return {
						getSnapshot: function () {
							var snap = session.getSnapshot();
							return isObj(snap) && isObj(snap.chat) ? snap.chat : undefined;
						},
						subscribe: typeof session.subscribe === 'function' ? function (fn) { return session.subscribe(fn); } : undefined
					};
				} catch (e) {
					return null;
				}
			}
		];

		function targetFor(ctx, sessionId) {
			for (var i = 0; i < ADAPTERS.length; i += 1) {
				var target = null;
				try {
					target = ADAPTERS[i](ctx, sessionId);
				} catch (e) {
					target = null;
				}
				if (target) return target;
			}
			return null;
		}

		// ---------------------------------------------------------- rendering

		function ensureStyle(doc) {
			var marker = 'style[data-plugin="' + PLUGIN + '"]';
			if (doc.querySelector(marker) !== null) return null;
			var tag = doc.createElement('style');
			tag.setAttribute('data-plugin', PLUGIN);
			tag.textContent = CSS;
			doc.head.appendChild(tag);
			return tag;
		}

		function removeBadges(root) {
			var badges = root.querySelectorAll('[' + BADGE_ATTR + ']');
			for (var i = 0; i < badges.length; i += 1) {
				if (badges[i].parentNode) badges[i].parentNode.removeChild(badges[i]);
			}
		}

		function makeBadge(doc, text) {
			var span = doc.createElement('span');
			span.className = BADGE_CLASS;
			span.setAttribute(BADGE_ATTR, '');
			// Purely decorative: the same moment is already audible in the transcript,
			// so keep it out of the accessibility tree.
			span.setAttribute('aria-hidden', 'true');
			span.textContent = text;
			return span;
		}

		/**
		 * One decoration pass over the transcript, scoped to the conversation root
		 * (never the whole document: this runs on every mutation frame).
		 * @param root the `[data-conversation-session]` container
		 * @param index `{ byKey, byCall }` or null
		 * @param doc owning document
		 */
		function decorate(root, index, doc) {
			// Tool rows are decorated where they live: the element carrying
			// `data-chat-call-id` is the row itself (nested sub-calls each get one).
			var callRows = root.querySelectorAll(SEL_CALL);
			for (var i = 0; i < callRows.length; i += 1) {
				var callRow = callRows[i];
				if (hasHiddenAncestor(callRow, root)) continue;
				var callId = callRow.getAttribute('data-chat-call-id');
				var byCall = index && callId ? index.byCall.get(callId) : null;
				if (byCall === null || byCall === undefined) byCall = hitNear(callRow, index, root);
				applyBadge(doc, callRow, byCall);
			}

			// Every other row is decorated on its own block-level flow container, never
			// on the inner collapse header: a header is a horizontal flex line, so a
			// badge inserted there would ride along the title instead of sitting at the
			// row's top-left corner.
			var flowItems = root.querySelectorAll(SEL_NODE);
			for (var j = 0; j < flowItems.length; j += 1) {
				var flow = flowItems[j];
				if (hasHiddenAncestor(flow, root)) continue;
				// A collapsed group / turn wrapper owns no single line of its own.
				if (flow.getAttribute('data-chat-group-key') !== null) continue;
				// The host already prints its own clock on the turn tail.
				if (flow.getAttribute('data-turn-tail') !== null) continue;
				var kind = flow.getAttribute('data-chat-flow-kind');
				if (kind === 'turn-tail' || kind === 'turn-process' || kind === 'turn') continue;
				// Nested flow items own their own line.
				if (flow.querySelector(SEL_NODE) !== null) continue;
				// Tool rows inside carry their badge from the loop above.
				if (flow.querySelector(SEL_CALL) !== null) continue;
				var key = flow.getAttribute('data-chat-node-key');
				if (!key) continue;
				applyBadge(doc, flow, index ? index.byKey.get(key) : null);
			}

			// Rows with no block-level flow item of their own (a Think collapse header
			// nested in a step-process group is the common case). The badge goes on the
			// header's parent — still a block line, still top-left — and only when no
			// ancestor already carries one, so a row never gets two.
			var headers = root.querySelectorAll(SEL_HEADER);
			for (var k = 0; k < headers.length; k += 1) {
				var header = headers[k];
				if (hasHiddenAncestor(header, root)) continue;
				// A tool row above is already decorated on its call row.
				if (closestAttr(header, 'data-chat-call-id', root) !== null) continue;
				var host = header.parentElement;
				// Never let the badge escape to a container that spans several rows.
				if (!host || host === root || host === doc.body) continue;
				if (hasBadgeAbove(header, root)) continue;
				applyBadge(doc, host, hitNear(header, index, root));
			}
		}

		/** Timing entry for the nearest enclosing chat node, if the index has it. */
		function hitNear(el, index, root) {
			if (!index) return null;
			var owner = closestAttr(el, 'data-chat-node-key', root);
			if (!owner) return null;
			var start = index.byKey.get(owner.getAttribute('data-chat-node-key'));
			return start === undefined ? null : start;
		}

		function closestAttr(el, name, stop) {
			var cur = el;
			while (cur && cur !== stop) {
				if (cur.getAttribute && cur.getAttribute(name)) return cur;
				cur = cur.parentElement;
			}
			return null;
		}

		/** Rows inside a collapsed/hidden section are left for the pass that follows
		 *  the expansion, so no work is spent on something nobody can see. */
		function hasHiddenAncestor(el, stop) {
			var cur = el;
			while (cur && cur !== stop) {
				if (cur.getAttribute && cur.getAttribute('hidden') !== null) return true;
				cur = cur.parentElement;
			}
			return false;
		}

		function ownBadge(host) {
			var children = host.children || [];
			for (var i = 0; i < children.length; i += 1) {
				if (children[i].getAttribute && children[i].getAttribute(BADGE_ATTR) !== null) return children[i];
			}
			return null;
		}

		/** True when this element or any ancestor up to `root` already owns a badge. */
		function hasBadgeAbove(el, root) {
			var cur = el;
			while (cur && cur !== root) {
				if (ownBadge(cur) !== null) return true;
				cur = cur.parentElement;
			}
			return false;
		}

		function applyBadge(doc, host, start) {
			var existing = ownBadge(host);
			if (typeof start !== 'number' || !isFinite(start)) {
				if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
				return;
			}
			var text = formatClock(start);
			if (existing) {
				if (existing.textContent !== text) existing.textContent = text;
				return;
			}
			// Every row puts its badge at the head, left of the row's own first child.
			host.insertBefore(makeBadge(doc, text), host.firstChild);
		}

		// ------------------------------------------------------------ plugin

		function apply(ctx) {
			if (typeof document === 'undefined') return undefined; // not a browser surface
			if (document.body === null) {
				// The loader can run before <body> exists; retry rather than silently
				// never initialising.
				var pending = setTimeout(function () { apply(ctx); }, 50);
				return function () { clearTimeout(pending); };
			}

			var doc = document;
			var styleTag = ensureStyle(doc);
			var index = null;
			var haveIndex = false;
			var indexedSnapshot;
			var indexSession = null;
			var target = null;
			var lastTargetTry = 0;
			var unsubscribe = null;
			var disposed = false;
			var frame = 0;

			function detach() {
				if (unsubscribe) {
					try { unsubscribe(); } catch (e) { /* ignore */ }
					unsubscribe = null;
				}
				index = null;
				haveIndex = false;
				indexedSnapshot = undefined;
				target = null;
				indexSession = null;
			}

			/** Resolve the chat target for `sessionId`, retrying at most once a second. */
			function ensureTarget(sessionId) {
				if (indexSession === sessionId && target) return true;
				var now = Date.now();
				if (indexSession === sessionId && now - lastTargetTry < 1000) return false;
				detach();
				indexSession = sessionId;
				lastTargetTry = now;
				target = targetFor(ctx, sessionId);
				if (!target) return false;
				if (typeof target.subscribe === 'function') {
					try {
						unsubscribe = target.subscribe(function () { schedule(); });
					} catch (e) {
						unsubscribe = null;
					}
				}
				return true;
			}

			/**
			 * Re-index only when the chat snapshot object actually changed. The store
			 * publishes on streamed tokens, so rebuilding per notification would be
			 * the hot spot on long sessions.
			 */
			function refreshIndex() {
				if (!target) return;
				var snapshot;
				try { snapshot = target.getSnapshot(); } catch (e) { snapshot = undefined; }
				if (haveIndex && snapshot === indexedSnapshot) return;
				indexedSnapshot = snapshot;
				haveIndex = true;
				var byKey = new Map();
				var byCall = new Map();
				buildIndex(snapshot, byKey, byCall);
				index = { byKey: byKey, byCall: byCall };
			}

			function scan() {
				frame = 0;
				if (disposed || doc.body === null) return;
				try {
					var root = doc.querySelector(SEL_SESSION);
					var sessionId = root ? root.getAttribute('data-conversation-session') : null;
					if (!root || !sessionId) {
						if (indexSession !== null) detach();
						return;
					}
					if (!ensureTarget(sessionId)) return;
					refreshIndex();
					// HMR bookkeeping can drop our <style>; re-add rather than render bare.
					if (!styleTag || styleTag.parentNode === null) styleTag = ensureStyle(doc);
					decorate(root, index, doc);
				} catch (e) {
					// An unanticipated DOM shape must not kill the observer or log once
					// per frame.
				}
			}

			function schedule() {
				if (disposed || frame !== 0) return;
				var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
				frame = raf(scan);
			}

			var observer = null;
			try {
				observer = new MutationObserver(function () { schedule(); });
				observer.observe(doc.body, { childList: true, subtree: true, characterData: false });
			} catch (e) {
				observer = null;
			}

			// The chat service may land after this plugin; poll until the first index
			// exists so a late service still produces badges without a page reload.
			var retries = 0;
			var retryTimer = typeof setInterval === 'function' ? setInterval(function () {
				retries += 1;
				if (disposed || haveIndex || retries > 30) {
					clearInterval(retryTimer);
					return;
				}
				schedule();
			}, 2000) : null;

			schedule();

			// Diagnostics for the curious: window.__dshRowTime.index() etc.
			try {
				globalThis.__dshRowTime = {
					version: VERSION,
					index: function () { return index; },
					badges: function () { return doc.querySelectorAll('[' + BADGE_ATTR + ']').length; },
					rescan: function () { schedule(); }
				};
			} catch (e) {
				/* diagnostics are optional */
			}

			var dispose = function () {
				if (disposed) return;
				disposed = true;
				if (observer) observer.disconnect();
				if (retryTimer) clearInterval(retryTimer);
				if (frame !== 0) {
					var caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
					caf(frame);
					frame = 0;
				}
				detach();
				removeBadges(doc.body);
				if (styleTag && styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
				styleTag = null;
				try { delete globalThis.__dshRowTime; } catch (e) { /* ignore */ }
			};

			if (typeof ctx.effect === 'function') {
				try { ctx.effect(function () { return dispose; }); } catch (e) { /* ignore */ }
			}
			return dispose;
		}

		var inject = [];

		return { apply: apply, inject: inject };
	}
});
