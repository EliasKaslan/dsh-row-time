/**
 * Logic test for the hand-written client bundle, run in plain Node with a
 * miniature DOM. No jsdom, no build step: `node test/run.mjs`.
 *
 * What it proves:
 *  - the bundle parses and its factory returns { apply, inject }
 *  - the adapter chain finds the chat store through uiConversation.binding().target('chat')
 *  - the legacy adapter (session snapshot with `.chat`) still works
 *  - tool rows get their start time from `data.root.callTime`
 *  - assistant steps get theirs from `finalNode.timing.stepStartTime`
 *  - a transcript without a session id produces no badges and no throw
 *  - dispose removes every badge
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

// ----------------------------------------------------------------- mini DOM

class El {
	constructor(tag) {
		this.tagName = tag;
		this.attrs = Object.create(null);
		this.children = [];
		this.parentElement = null;
		this._text = '';
		this.title = '';
	}
	setAttribute(n, v) { this.attrs[n] = String(v); }
	getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	insertBefore(c, ref) {
		c.parentElement = this;
		const i = ref ? this.children.indexOf(ref) : -1;
		if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
		return c;
	}
	removeChild(c) {
		const i = this.children.indexOf(c);
		if (i >= 0) this.children.splice(i, 1);
		c.parentElement = null;
		return c;
	}
	remove() { if (this.parentElement) this.parentElement.removeChild(this); }
	querySelector(sel) { const hit = descendants(this, sel); return hit.length ? hit[0] : null; }
	querySelectorAll(sel) { return descendants(this, sel); }
	get firstChild() { return this.children.length ? this.children[0] : null; }
	get parentNode() { return this.parentElement; }
	get textContent() { return this._text; }
	set textContent(v) { this._text = String(v); }
	get className() { return this.getAttribute('class') || ''; }
	set className(v) { this.setAttribute('class', v); }
}

function matchPart(el, part) {
	const m = /^([a-zA-Z][\w-]*)?((?:\[[^\]]+\])*)$/.exec(part);
	if (!m) return false;
	if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
	const re = /\[([\w-]+)(?:="([^"]*)")?\]/g;
	let a;
	while ((a = re.exec(m[2] || '')) !== null) {
		const v = el.getAttribute(a[1]);
		if (v === null) return false;
		if (a[2] !== undefined && v !== a[2]) return false;
	}
	return true;
}

const matches = (el, sel) => sel.split(',').some((p) => matchPart(el, p.trim()));

function descendants(root, sel, out = []) {
	for (const c of root.children) {
		if (matches(c, sel)) out.push(c);
		descendants(c, sel, out);
	}
	return out;
}

function createDocument() {
	const html = new El('html');
	const head = new El('head');
	const body = new El('body');
	html.appendChild(head);
	html.appendChild(body);
	const all = (sel) => [...descendants(head, sel), ...descendants(body, sel)];
	return {
		head, body, documentElement: html,
		createElement: (t) => new El(t),
		querySelector: (sel) => all(sel)[0] || null,
		querySelectorAll: all,
	};
}

// ------------------------------------------------------- globals for bundle

globalThis.window = globalThis;
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };   // run synchronously
globalThis.cancelAnimationFrame = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

let captured = null;
globalThis.__ModuleLoader__ = { load: (mod) => { captured = mod; } };
// eslint-disable-next-line no-eval
(0, eval)(SRC);
if (!captured || typeof captured.factory !== 'function') throw new Error('bundle did not register a factory');
const exportsObj = captured.factory();
if (typeof exportsObj.apply !== 'function') throw new Error('factory did not export apply');

// ------------------------------------------------------------------ fixtures

const T1 = new Date(2026, 10, 12, 10, 42, 3).getTime();       // tool call start
const T1_END = T1 + 4123;
const T3 = new Date(2026, 10, 12, 10, 43, 10).getTime();      // assistant step start
const T4 = new Date(2026, 10, 12, 10, 43, 40).getTime();      // Think (reasoning) step start
const T5 = new Date(2026, 10, 12, 10, 44, 5).getTime();       // step nested in a process group

function chatSnapshot() {
	const nodes = new Map();
	nodes.set('n1', { key: 'n1', kind: 'tool-call', data: { root: { callId: 'c1', callTime: T1, time: T1_END } } });
	nodes.set('n2', { key: 'n2', kind: 'assistant-step', data: { finalNode: { timing: { stepStartTime: T3 } } } });
	nodes.set('n3', { key: 'n3', kind: 'turn-tail', data: { time: T3 + 5000 } });
	nodes.set('n4', { key: 'n4', kind: 'assistant-step', data: { finalNode: { timing: { stepStartTime: T4 } } } });
	nodes.set('n5', { key: 'n5', kind: 'assistant-step', data: { finalNode: { timing: { stepStartTime: T5 } } } });
	return { order: ['n1', 'n2', 'n3', 'n4', 'n5'], nodes };
}

function buildTranscript(doc, withSession) {
	const root = new El('div');
	if (withSession) root.setAttribute('data-conversation-session', 'S1');
	const flow1 = new El('div');
	flow1.setAttribute('data-chat-node-key', 'n1');
	flow1.setAttribute('data-chat-flow-kind', 'tool-call');
	// realistic shape: the call row carries the id, the disclosure header sits inside it
	const row = new El('div');
	row.setAttribute('data-chat-call-id', 'c1');
	const header = new El('div');
	header.setAttribute('data-disclosure-row', '');
	row.appendChild(header);
	flow1.appendChild(row);
	root.appendChild(flow1);
	const flow2 = new El('div');
	flow2.setAttribute('data-chat-node-key', 'n2');
	flow2.setAttribute('data-chat-flow-kind', 'assistant-step');
	root.appendChild(flow2);
	// the host prints its own clock on the turn tail — we must not add a second one
	const tail = new El('div');
	tail.setAttribute('data-chat-node-key', 'n3');
	tail.setAttribute('data-chat-flow-kind', 'turn-tail');
	tail.setAttribute('data-turn-tail', '5');
	root.appendChild(tail);
	// a Think row: block-level flow item that CONTAINS a collapse header. The badge
	// must land on the flow item (own line, top-left), never inside the flex header.
	const flow4 = new El('div');
	flow4.setAttribute('data-chat-node-key', 'n4');
	flow4.setAttribute('data-chat-flow-kind', 'assistant-step');
	flow4.setAttribute('data-chat-group-part', 'reasoning');
	const thinkHeader = new El('div');
	thinkHeader.setAttribute('data-disclosure-row', '');
	flow4.appendChild(thinkHeader);
	root.appendChild(flow4);
	// a collapse header inside a skipped wrapper (step-process group): the flow pass
	// skips the wrapper, so the fallback pass must put the badge on the header's
	// block parent instead of inside the flex header.
	const flow6 = new El('div');
	flow6.setAttribute('data-chat-node-key', 'n5');
	flow6.setAttribute('data-chat-flow-kind', 'turn-process');
	const wrap = new El('div');
	const nestedHeader = new El('div');
	nestedHeader.setAttribute('data-disclosure-row', '');
	wrap.appendChild(nestedHeader);
	flow6.appendChild(wrap);
	root.appendChild(flow6);
	doc.body.appendChild(root);
	return { root, flow1, row, header, flow2, tail, flow4, thinkHeader, flow6, wrap, nestedHeader };
}

function makeCtx(mode) {
	const binding = { session: { getSnapshot: () => ({}) } };
	const chatTarget = { getSnapshot: () => chatSnapshot(), subscribe: () => () => {} };
	const legacyTarget = { getSnapshot: () => chatSnapshot() };
	const sessions = {
		binding: (id) => (id === 'S1' ? binding : undefined),
	};
	if (mode === 'legacy') {
		binding.session.getSnapshot = () => ({ chat: chatSnapshot() });
	}
	const uiConversation = mode === 'legacy' ? undefined : {
		binding: () => ({ target: (name) => (name === 'chat' ? chatTarget : undefined) }),
	};
	return {
		effect(fn) { this._effect = fn; },
		get(name) {
			if (name === 'sessions') return sessions;
			if (name === 'uiConversation') return uiConversation;
			if (name === 'legacy') return legacyTarget;
			return undefined;
		},
	};
}

const hhmmss = (ms) => {
	const d = new Date(ms);
	const p = (n) => (n < 10 ? '0' + n : '' + n);
	return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};

// ------------------------------------------------------------------- runner

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
	if (cond) { pass += 1; console.log('  PASS', name); }
	else { fail += 1; console.log('  FAIL', name, detail === undefined ? '' : '→ ' + detail); }
}

function badges(el) { return descendants(el, '[data-dsh-row-time]'); }

// case 1: primary adapter
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, true);
	const ctx = makeCtx('primary');
	const dispose = exportsObj.apply(ctx);
	check('tool row gets a badge', badges(tree.row).length === 1, String(badges(tree.row).length));
	check('tool row badge text', badges(tree.row)[0] && badges(tree.row)[0].textContent === hhmmss(T1), badges(tree.row)[0] && badges(tree.row)[0].textContent);
	check('tool row badge sits at the row head', tree.row.children[0] === badges(tree.row)[0], 'first child');
	check('no tooltip on the badge', (badges(tree.row)[0] || {}).title === '', String((badges(tree.row)[0] || {}).title));
	check('assistant step gets a badge', badges(tree.flow2).length === 1);
	check('assistant step badge text', (badges(tree.flow2)[0] || {}).textContent === hhmmss(T3), (badges(tree.flow2)[0] || {}).textContent);
	check('assistant step badge sits at the row head', tree.flow2.children[0] === badges(tree.flow2)[0], 'first child');
	check('no badge on the tool flow wrapper', badges(tree.flow1).length === 1, 'wrapper carries only the child row badge');
	check('disclosure header inside a call row gets no second badge', badges(tree.header).length === 0, String(badges(tree.header).length));
	check('badge count total', doc.querySelectorAll('[data-dsh-row-time]').length === 4, String(doc.querySelectorAll('[data-dsh-row-time]').length));
	check('turn tail keeps only the host clock', badges(tree.tail).length === 0, String(badges(tree.tail).length));
	check('Think row badge sits on the flow item, not the collapse header', badges(tree.flow4).length === 1 && badges(tree.thinkHeader).length === 0, badges(tree.flow4).length + '/' + badges(tree.thinkHeader).length);
	check('Think row badge text', (badges(tree.flow4)[0] || {}).textContent === hhmmss(T4), (badges(tree.flow4)[0] || {}).textContent);
	check('Think row badge sits at the row head', tree.flow4.children[0] === badges(tree.flow4)[0], 'first child');
	check('skipped wrapper: badge lands on the header parent', badges(tree.wrap).length === 1, String(badges(tree.wrap).length));
	check('skipped wrapper: header itself stays clean', badges(tree.nestedHeader).length === 0);
	check('skipped wrapper: wrapper line is not doubled by the flow item', badges(tree.flow6).length === 1, String(badges(tree.flow6).length));
	dispose();
	check('dispose removes every badge', doc.querySelectorAll('[data-dsh-row-time]').length === 0, String(doc.querySelectorAll('[data-dsh-row-time]').length));
}

// case 2: no session id in the DOM
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, false);
	const dispose = exportsObj.apply(makeCtx('primary'));
	check('no session id → no badges', badges(tree.row).length === 0 && badges(tree.flow2).length === 0);
	dispose();
}

// case 3: legacy adapter (session snapshot carries .chat)
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, true);
	const dispose = exportsObj.apply(makeCtx('legacy'));
	check('legacy adapter still resolves', badges(tree.row).length === 1, String(badges(tree.row).length));
	dispose();
}

// case 4: services entirely missing must not throw
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, true);
	let threw = null;
	try {
		const dispose = exportsObj.apply({ get: () => undefined });
		dispose();
	} catch (e) { threw = e; }
	check('missing services do not throw', threw === null, threw && threw.message);
	check('missing services produce no badges', badges(tree.row).length === 0);
}

// case 5: services arrive late → the next scan picks them up
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, true);
	let ready = false;
	const real = makeCtx('primary');
	const ctx = { effect() {}, get: (n) => (ready ? real.get(n) : undefined) };
	const dispose = exportsObj.apply(ctx);
	check('late services: nothing before they exist', badges(tree.row).length === 0);
	ready = true;
	const realNow = Date.now;
	Date.now = () => realNow() + 5000; // step past the adapter retry backoff
	globalThis.__dshRowTime.rescan();
	Date.now = realNow;
	check('late services: badges appear on the next scan', badges(tree.row).length === 1, String(badges(tree.row).length));
	dispose();
}

// case 6: rows inside a hidden section are skipped
{
	const doc = createDocument();
	globalThis.document = doc;
	const tree = buildTranscript(doc, true);
	tree.row.setAttribute('hidden', '');
	const dispose = exportsObj.apply(makeCtx('primary'));
	check('hidden row gets no badge', badges(tree.row).length === 0, String(badges(tree.row).length));
	check('visible row still decorated', badges(tree.flow2).length === 1);
	dispose();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
