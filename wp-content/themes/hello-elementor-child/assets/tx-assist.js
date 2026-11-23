/*!
 * taxidiotis.gr search + chat assistant (2026-11-20). No API, no model, no cookies: everything runs in the browser
 * on two files built from the site's own pages (site/assist_index.py): search.json (pages) and chat.json (passages + FAQ).
 * The files load only when a visitor opens the search or the chat. Retrieval = BM25 over Greek-normalized tokens
 * (accents, final sigma, ι/η/υ/ει/οι, ω/ο, αι/ε, double consonants) with prefix stems, so «Σαντορίνης», «σαντορινη»
 * and Greeklish «santorini» find the same pages. The chat answers by quoting the best FAQ answer or passage with its
 * page link; when nothing matches well it says so and offers the search results instead.
 */
(function () {
	'use strict';
	var C = window.TX_ASSIST || {};
	var HOME = (C.home || '/').replace(/\/$/, '');
	/* ---------- text normalization ---------- */
	function fold(s) {
		return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');
	}
	var GL = [['th', 'θ'], ['ch', 'χ'], ['ps', 'ψ'], ['ks', 'ξ'], ['ou', 'ου'], ['mp', 'μπ'], ['nt', 'ντ'], ['a', 'α'], ['b', 'μπ'],
		['v', 'β'], ['g', 'γ'], ['d', 'δ'], ['e', 'ε'], ['z', 'ζ'], ['h', 'η'], ['i', 'ι'], ['k', 'κ'], ['c', 'κ'], ['l', 'λ'],
		['m', 'μ'], ['n', 'ν'], ['x', 'ξ'], ['o', 'ο'], ['p', 'π'], ['r', 'ρ'], ['s', 'σ'], ['t', 'τ'], ['u', 'υ'], ['y', 'υ'],
		['f', 'φ'], ['w', 'ω'], ['j', 'τζ'], ['q', 'κ']];
	function greek(t) { // Greeklish word -> Greek letters (approximate; canon() then removes the spelling differences)
		var o = '', i = 0;
		while (i < t.length) {
			var hit = false;
			for (var k = 0; k < GL.length; k++) {
				if (t.substr(i, GL[k][0].length) === GL[k][0]) { o += GL[k][1]; i += GL[k][0].length; hit = true; break; }
			}
			if (!hit) { o += t[i]; i++; }
		}
		return o;
	}
	function canon(t) {
		t = fold(t);
		if (/[a-z]/.test(t)) { t = greek(t); }
		return t.replace(/ου/g, 'u').replace(/ει|οι|υι/g, 'ι').replace(/[ηυ]/g, 'ι').replace(/ω/g, 'ο').replace(/αι/g, 'ε')
			.replace(/μπ/g, 'b').replace(/ντ/g, 'd').replace(/γκ|γγ/g, 'g').replace(/([βγδζθκλμνξπρστφχψ])\1/g, '$1');
	}
	function toks(s) {
		return (fold(s).match(/[a-z0-9α-ω]+/g) || []).map(canon).filter(function (w) { return w.length > 1; });
	}
	var STOP = {};
	('και να το τα τη την της του των τον στο στη στην στον στα στις στους σε με για απο από ειναι είναι ενα ένα μια μία ' +
	 'ο η οι τι ποιο ποια ποιος ποιες πως πώς που πού ποτε πότε θα δεν μη μην αν ή η κι ως ειναι εχει έχει εχω έχω μου σας ' +
	 'μας τους ειμαι είμαι θελω θέλω μπορω μπορώ μπορει μπορεί ποσο πόσο κανει κάνει υπαρχει υπάρχει ολα όλα λιγο λίγο ' +
	 'βάλω βάζω πάρω παίρνω φέρω κλείσω δω δούμε πάω πάμε πας πάει πήγαινα πηγαίνω ταξιδέψω επισκεφθώ επισκεφτώ κάνω κάνουμε έχουμε είμαστε μας μου καλά καλή ' +
	 'the and for to of in a an is what how when where').split(' ').forEach(function (w) { STOP[canon(w)] = 1; });
	function stem(w) { return w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w; }

	/* ---------- BM25 index with prefix lookup ---------- */
	function Index(docs) { // docs: [[ [text, weight], ... ], ...]
		var post = {}, lens = [], total = 0;
		docs.forEach(function (fields, d) {
			var tf = {}, n = 0;
			fields.forEach(function (f) {
				toks(f[0]).forEach(function (w) { tf[w] = (tf[w] || 0) + f[1]; n += f[1]; });
			});
			lens[d] = n; total += n;
			Object.keys(tf).forEach(function (w) { (post[w] = post[w] || []).push([d, tf[w]]); });
		});
		this.post = post; this.vocab = Object.keys(post).sort(); this.lens = lens; this.N = docs.length;
		this.avg = total / Math.max(1, docs.length);
	}
	Index.prototype.prefix = function (p) {
		var v = this.vocab, lo = 0, hi = v.length, out = [];
		while (lo < hi) { var m = (lo + hi) >> 1; if (v[m] < p) { lo = m + 1; } else { hi = m; } }
		for (var i = lo; i < v.length && v[i].lastIndexOf(p, 0) === 0 && out.length < 60; i++) { out.push(v[i]); }
		return out;
	};
	Index.prototype.search = function (q) {
		var self = this, sc = {}, hit = {}, qt = toks(q).filter(function (w) { return !STOP[w]; });
		var uniq = qt.filter(function (w, i) { return qt.indexOf(w) === i; });
		uniq.forEach(function (w, qi) {
			var terms = self.prefix(stem(w)), seen = {};
			terms.forEach(function (t) {
				var pl = self.post[t], idf = Math.log(1 + (self.N - pl.length + 0.5) / (pl.length + 0.5));
				var exact = t === w ? 1 : 0.8;
				pl.forEach(function (x) {
					var d = x[0], tf = x[1];
					var s = exact * idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * self.lens[d] / self.avg));
					if (!seen[d] || s > seen[d]) {
						sc[d] = (sc[d] || 0) - (seen[d] || 0) + s; seen[d] = s;
					}
					(hit[d] = hit[d] || {})[qi] = 1;
				});
			});
		});
		var n = uniq.length;
		return Object.keys(sc).map(function (d) {
			var cov = Object.keys(hit[d]).length / Math.max(1, n);
			return { d: +d, s: sc[d] * (0.5 + cov), cov: cov };
		}).sort(function (a, b) { return b.s - a.s; });
	};

	/* ---------- data ---------- */
	var cache = {};
	function load(url) {
		if (!cache[url]) {
			cache[url] = fetch(url, { credentials: 'omit' }).then(function (r) {
				if (!r.ok) { throw new Error(r.status); }
				return r.json();
			});
		}
		return cache[url];
	}
	var SI = null, SD = null, CI = null, CD = null, OI = null, OD = [], OCHK = '';
	function chk() { // «έλεγχος 20/11/2026»: every price shows the date of the feed check (project rule)
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(OCHK);
		return m ? ' · έλεγχος ' + (+m[3]) + '/' + (+m[2]) + '/' + m[1] : '';
	}
	function searchIndex() {
		if (SI) { return Promise.resolve(); }
		var offers = C.offers ? load(C.offers).then(function (d) { OCHK = d.checked || ''; return d.offers || []; }, function () { return []; }) : Promise.resolve([]);
		return Promise.all([load(C.search), offers]).then(function (r) {
			SD = r[0]; OD = r[1];
			SI = new Index(SD.map(function (p) {
				return [[p.t, 4], [p.h1, 3], [p.k || '', 2], [p.d || '', 2], [(p.hs || []).join(' '), 1], [p.l || '', 3]];
			}));
			OI = new Index(OD.map(function (o) { return [[o.t, 3], [o.d || '', 2], [o.l || '', 2], [o.g || '', 1]]; }));
		});
	}
	function findOffers(q, max, cheap) {  // every word must match; «cheap» questions get the lowest prices first
		if (!OI) { return []; }
		var hits = OI.search(q).filter(function (r) { return r.cov >= 0.99; }).slice(0, cheap ? 60 : max).map(function (r) { return OD[r.d]; });
		if (cheap) { hits.sort(function (a, b) { return (a.pr || 1e9) - (b.pr || 1e9); }); }
		return hits.slice(0, max);
	}
	function chatIndex() {
		return CI ? Promise.resolve() : load(C.chat).then(function (d) {
			CD = d;
			CI = new Index(d.chunks.map(function (c) {
				var pg = d.pages[c.n] || {};
				return c.q ? [[c.q, 3], [c.x, 1], [pg.t || '', 1]] : [[c.h || '', 2], [c.x, 1], [pg.t || '', 1]];
			}));
		});
	}
	function href(u) { return HOME + u; }
	function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
	function el(tag, attrs, html) {
		var e = document.createElement(tag);
		Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
		if (html !== undefined) { e.innerHTML = html; }
		return e;
	}
	function mark(text, q) { // bold the words of the query (by stem) in plain text
		var st = toks(q).filter(function (w) { return !STOP[w]; }).map(stem);
		return esc(text).replace(/[A-Za-zΆ-ώ0-9]+/g, function (w) {
			var c = canon(w);
			return st.some(function (s) { return s.length > 2 && c.lastIndexOf(s, 0) === 0; }) ? '<mark>' + w + '</mark>' : w;
		});
	}

	/* ---------- search dialog ---------- */
	var sdlg, sinput, slist, sstatus, lastFocus;
	function buildSearch() {
		sdlg = el('div', { 'class': 'txa-overlay', id: 'anazitisi', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Αναζήτηση στον Ταξιδιώτη', hidden: '' });
		sdlg.innerHTML = '<div class="txa-search"><form class="txa-sform" role="search"><label for="txa-q" class="txa-sr">Αναζήτηση</label>' +
			'<input id="txa-q" type="search" autocomplete="off" placeholder="Προορισμός, γιορτή ή είδος ταξιδιού" enterkeyhint="search">' +
			'<button type="button" class="txa-x" aria-label="Κλείσιμο αναζήτησης">×</button></form>' +
			'<p class="txa-status" aria-live="polite"></p><ol class="txa-results"></ol></div>';
		document.body.appendChild(sdlg);
		sinput = sdlg.querySelector('input'); slist = sdlg.querySelector('ol'); sstatus = sdlg.querySelector('.txa-status');
		var t;
		sinput.addEventListener('input', function () { clearTimeout(t); t = setTimeout(runSearch, 120); });
		sdlg.querySelector('form').addEventListener('submit', function (e) {
			e.preventDefault(); var a = slist.querySelector('a'); if (a) { a.click(); }
		});
		sdlg.querySelector('.txa-x').addEventListener('click', closeSearch);
		sdlg.addEventListener('click', function (e) { if (e.target === sdlg) { closeSearch(); } });
	}
	function openSearch(q) {
		if (!sdlg) { buildSearch(); }
		lastFocus = document.activeElement;
		sdlg.hidden = false; document.documentElement.classList.add('txa-lock');
		sinput.value = q || sinput.value; sinput.focus();
		sstatus.textContent = SI ? '' : 'Φόρτωση…';
		searchIndex().then(function () { runSearch(); }, function () { sstatus.textContent = 'Η αναζήτηση δεν φορτώθηκε. Δοκιμάστε ξανά.'; });
	}
	function closeSearch() {
		if (!sdlg || sdlg.hidden) { return; }
		sdlg.hidden = true; document.documentElement.classList.remove('txa-lock');
		if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
	}
	function findPages(q, max) {
		return SI.search(q).filter(function (r) { return r.cov >= 0.5; }).slice(0, max).map(function (r) { return SD[r.d]; });
	}
	function runSearch() {
		if (!SI) { return; }
		var q = sinput.value.trim();
		slist.innerHTML = '';
		if (q.length < 2) { sstatus.textContent = 'Γράψτε τουλάχιστον δύο γράμματα.'; return; }
		var res = findPages(q, 12), offs = findOffers(q, 6);
		sstatus.textContent = res.length || offs.length ? (res.length === 1 ? '1 σελίδα' : res.length + ' σελίδες') + (offs.length ? ' και ' + offs.length + (offs.length === 1 ? ' προσφορά' : ' προσφορές') : '')
			: 'Δεν βρέθηκαν σελίδες για «' + q + '». Δοκιμάστε έναν προορισμό ή μια γιορτή.';
		res.forEach(function (p) {
			var li = el('li');
			li.innerHTML = '<a href="' + esc(href(p.u)) + '"><span class="txa-k">' + esc(p.k || 'Σελίδα') + '</span>' +
				'<span class="txa-t">' + mark(p.t, q) + '</span><span class="txa-d">' + mark(p.d, q) + '</span></a>';
			slist.appendChild(li);
		});
		if (offs.length) {
			slist.appendChild(el('li', { 'class': 'txa-group' }, 'Προσφορές συνεργατών'));
			offs.forEach(function (o) {
				var li = el('li');
				li.innerHTML = '<a href="' + esc(href(o.u)) + '"><span class="txa-k">' + esc(o.k) + '</span><span class="txa-t">' + mark(o.t, q) + '</span><span class="txa-d">' + mark(o.d, q) + esc(chk()) + '</span></a>';
				slist.appendChild(li);
			});
		}
	}

	/* ---------- chat ---------- */
	var cbox, clog, cinput, cbtn, HIST = [];  // last turns of this chat, for follow-up questions (never stored)
	var SUGGEST = ['Πότε να πάω στη Σαντορίνη;', 'Τι έγγραφα χρειάζομαι για ταξίδι στο εξωτερικό;', 'Πακέτα για το Πάσχα', 'Τι σημαίνει all inclusive;'];
	function buildChat() {
		cbtn = el('button', { type: 'button', 'class': 'txa-fab', 'aria-expanded': 'false', 'aria-controls': 'txa-chat' },
			'<span aria-hidden="true">?</span> Ρωτήστε τον Ταξιδιώτη');
		cbox = el('section', { id: 'txa-chat', 'class': 'txa-chat', role: 'dialog', 'aria-label': 'Βοηθός του Ταξιδιώτη', hidden: '' });
		cbox.innerHTML = '<header class="txa-ch"><strong>Βοηθός του Ταξιδιώτη</strong><button type="button" class="txa-x" aria-label="Κλείσιμο συνομιλίας">×</button></header>' +
			'<div class="txa-log" aria-live="polite"></div>' +
			'<form class="txa-cform"><label for="txa-m" class="txa-sr">Η ερώτησή σας</label><input id="txa-m" type="text" autocomplete="off" placeholder="Γράψτε την ερώτησή σας" maxlength="200">' +
			'<button type="submit">Αποστολή</button></form>' +
			'<p class="txa-note">' + (C.rag ? 'Οι απαντήσεις γράφονται αυτόματα μόνο από τις σελίδες του Ταξιδιώτη και μπορεί να έχουν λάθη: ελέγξτε τις πηγές. ' : 'Οι απαντήσεις προέρχονται από τις σελίδες του Ταξιδιώτη. ') + 'Δεν αποθηκεύουμε τις ερωτήσεις.</p>';
		document.body.appendChild(cbtn); document.body.appendChild(cbox);
		clog = cbox.querySelector('.txa-log'); cinput = cbox.querySelector('input');
		cbtn.addEventListener('click', function () { cbox.hidden ? openChat() : closeChat(); });
		cbox.querySelector('.txa-x').addEventListener('click', closeChat);
		cbox.querySelector('form').addEventListener('submit', function (e) {
			e.preventDefault(); var q = cinput.value.trim(); if (q) { cinput.value = ''; ask(q); }
		});
	}
	function say(html, who) {
		var m = el('div', { 'class': 'txa-msg txa-' + (who || 'bot') }, html);
		clog.appendChild(m); clog.scrollTop = clog.scrollHeight;
		return m;
	}
	function openChat() {
		cbox.hidden = false; cbtn.setAttribute('aria-expanded', 'true'); cinput.focus();
		if (!clog.children.length) {
			say('<p>Γεια σας! Ρωτήστε με για προορισμούς, εποχές, έγγραφα ή είδη ταξιδιού. Απαντώ με πληροφορίες από τις σελίδες μας.</p>' +
				'<p class="txa-sugg">' + SUGGEST.map(function (s) { return '<button type="button">' + esc(s) + '</button>'; }).join('') + '</p>');
			clog.querySelectorAll('.txa-sugg button').forEach(function (b) { b.addEventListener('click', function () { ask(b.textContent); }); });
		}
		chatIndex(); searchIndex();
	}
	function closeChat() { cbox.hidden = true; cbtn.setAttribute('aria-expanded', 'false'); cbtn.focus(); }
	function sentences(text, q) { // the 2-3 sentences of a passage that hold most query words, in order
		var ss = text.match(/[^.;!?·]+[.;!?·]?/g) || [text], st = toks(q).filter(function (w) { return !STOP[w]; }).map(stem);
		var scored = ss.map(function (s, i) {
			var c = toks(s), n = st.filter(function (p) { return c.some(function (w) { return w.lastIndexOf(p, 0) === 0; }); }).length;
			return { i: i, s: s.trim(), n: n };
		});
		var best = scored.slice().sort(function (a, b) { return b.n - a.n || a.i - b.i; }).slice(0, 3).filter(function (x, k) { return k === 0 || x.n > 0; });
		return best.sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.s; }).join(' ');
	}
	function has(q, words) { // intent words compare on accent-folded spelling, not canon(): canon('γεια') = canon('για')
		var t = (fold(q).match(/[a-z0-9α-ω]+/g) || []);
		return words.some(function (w) { return t.indexOf(fold(w)) > -1; });
	}
	function ask(q) {
		say('<p>' + esc(q) + '</p>', 'user');
		var wait = say('<p class="txa-dots">Ψάχνω στις σελίδες μας…</p>');
		Promise.all([chatIndex(), searchIndex()]).then(function () {
			wait.remove(); answer(q);
		}, function () { wait.innerHTML = '<p>Ο βοηθός δεν φορτώθηκε. Δοκιμάστε ξανά σε λίγο.</p>'; });
	}
	function answer(q) {
		var tq = toks(q).filter(function (w) { return !STOP[w]; });
		if (has(q, ['γεια', 'γειά', 'καλημέρα', 'καλησπέρα', 'hello', 'hi', 'χαίρετε']) && tq.length <= 2) {
			say('<p>Γεια σας! Πείτε μου πού ή πότε θέλετε να ταξιδέψετε και θα σας δείξω τις σωστές σελίδες.</p>'); return;
		}
		if (has(q, ['ευχαριστώ', 'ευχαριστω', 'thanks', 'thank'])) { say('<p>Παρακαλώ! Καλό ταξίδι.</p>'); return; }
		var extra = '';
		if (has(q, ['τιμή', 'τιμές', 'κόστος', 'κοστίζει', 'φθηνό', 'φθηνά', 'οικονομικό', 'προσφορά', 'προσφορές', 'κράτηση', 'κλείσω'])) {
			extra = '<p class="txa-info">Ο Ταξιδιώτης δεν πουλάει ταξίδια. Συγκρίνουμε προσφορές συνεργατών· κάθε τιμή δείχνει την ημερομηνία ελέγχου ' +
				'και η τελική τιμή είναι στη σελίδα του συνεργάτη. <a href="' + esc(href('/pos-epilegoume-prosfores/')) + '">Πώς επιλέγουμε τις προσφορές</a></p>';
		}
		if (has(q, ['επικοινωνία', 'επικοινωνήσω', 'email', 'mail', 'τηλέφωνο'])) {
			say('<p>Μπορείτε να μας γράψετε από τη <a href="' + esc(href('/epikoinonia/')) + '">σελίδα επικοινωνίας</a>.</p>' + extra); return;
		}
		var here = location.pathname.replace(HOME.replace(/^https?:\/\/[^/]+/, ''), '') || '/';
		// question words that carry meaning but are stop words: «πότε» asks for the season, «πόσες μέρες» for the length
		// question words that carry meaning but are stop words: «πότε» asks for the season, «πόσες μέρες» for the length
		function retrieve(text) {
			var qq = text + (has(text, ['πότε', 'ποτε']) ? ' εποχή' : '') + (has(text, ['μέρες', 'ημέρες', 'διανυκτερεύσεις']) && has(text, ['πόσες', 'ποσες']) ? ' ημέρες' : '');
			var qtok = toks(qq).filter(function (w) { return !STOP[w]; });
			var list = CI.search(qq).slice(0, 60).map(function (r) {
				var c = CD.chunks[r.d], pg = CD.pages[c.n] || {};
				// a page whose title holds the question's words is the better source (family question -> the family page)
				var tt = toks(pg.t || ''), tc = qtok.length ? qtok.filter(function (w) { var st = stem(w); return tt.some(function (x) { return x.lastIndexOf(st, 0) === 0; }); }).length / qtok.length : 0;
				return { d: r.d, c: c, pg: pg, s: r.s * (pg.u === here ? 1.25 : 1) * (c.q ? 1.15 : 1) * (1 + 0.6 * tc), cov: r.cov };
			}).sort(function (a, b) { return b.s - a.s; });
			var n = toks(text).filter(function (w) { return !STOP[w]; }).length;
			var need = n <= 2 ? 1 : n === 3 ? 0.66 : 0.6;  // every word of a short question must be found
			return { res: list, need: need, ok: !!(list[0] && list[0].cov >= need && list[0].s >= 4) };
		}
		// follow-ups: «και για παιδιά;» / «τι γίνεται με…» try the previous question's topic first; any other short question
		// that finds nothing alone gets one retry with that topic
		var prev = HIST.length ? HIST[HIST.length - 1].q : '';
		var looksFollow = prev && tq.length <= 3 && /^(και|κι|ενώ|τι γίνεται|τι γινεται|κι αν|και αν|αν|μήπως)\s/i.test(q.trim());
		var R = looksFollow ? retrieve(prev + ' ' + q) : retrieve(q);
		if (!R.ok && prev && tq.length <= 3) {
			var R2 = looksFollow ? retrieve(q) : retrieve(prev + ' ' + q);
			if (R2.ok) { R = R2; }
		}
		var res = R.res;
		var top = res[0];
		var cheap = /φθιν|οικονομ|χαμηλ/.test(toks(q).join(' '));
		var offs = /προσφορ|τιμ|κοστ|φθιν|ξενοδοχ|κλισ|διανικτ|πακετ|διαμον/.test(toks(q).join(' '))
			? findOffers(q.replace(/προσφορ\S*|τιμ\S*|κόστ\S*|κοστ\S*|φθην\S*|οικονομ\S*|ξενοδοχ\S*|πακέτ\S*|πακετ\S*|διακοπ\S*|ταξίδ\S*|ταξιδ\S*|διαμον\S*|πόσο|θέλω|ψάχνω/gi, ''), 3, cheap) : [];
		var lead = offs.length ? '<p class="txa-q">Προσφορές συνεργατών τώρα' + (cheap ? ', από τη χαμηλότερη τιμή' : '') + '</p><ul>' + offs.map(function (o) {
			return '<li><a href="' + esc(href(o.u)) + '">' + esc(o.t) + '</a>: ' + esc(o.d + chk()) + '</li>'; }).join('') + '</ul><p class="txa-src">Τελική τιμή και όροι στη σελίδα του συνεργάτη.</p>' : '';
		if (!R.ok) {
			var pages = tq.length ? SI.search(q).filter(function (r) { return r.cov >= 0.99; }).slice(0, 3).map(function (r) { return SD[r.d]; }) : [];
			if (lead) { say(lead + '<p class="txa-src">Δείτε και τις σελίδες μας:</p><ul>' + (tq.length ? findPages(q, 3) : []).map(function (p) { return '<li><a href="' + esc(href(p.u)) + '">' + esc(p.t) + '</a></li>'; }).join('') + '</ul>' + extra); return; }
			say('<p>Δεν βρήκα σαφή απάντηση σε αυτό στις σελίδες μας.' + (pages.length ? ' Ίσως σας βοηθήσουν:' : ' Δοκιμάστε με έναν προορισμό, μια γιορτή ή ένα είδος ταξιδιού.') + '</p>' +
				(pages.length ? '<ul>' + pages.map(function (p) { return '<li><a href="' + esc(href(p.u)) + '">' + esc(p.t) + '</a></li>'; }).join('') + '</ul>' : '') +
				'<p>Για κάτι άλλο, γράψτε μας από τη <a href="' + esc(href('/epikoinonia/')) + '">σελίδα επικοινωνίας</a>.</p>' + extra);
			return;
		}
		function extractive() {  // quoting answer: always available, also the fallback when the RAG endpoint fails
			var body = top.c.q ? top.c.x : sentences(top.c.x, q);
			var more = [], seenU = {}; seenU[top.pg.u] = 1;
			res.slice(1).forEach(function (r) { if (more.length < 2 && !seenU[r.pg.u] && r.cov >= 0.5 && r.s > top.s * 0.55) { seenU[r.pg.u] = 1; more.push(r.pg); } });
			say(lead + (top.c.q ? '<p class="txa-q">' + esc(top.c.q) + '</p>' : '') + '<p>' + mark(body, q) + '</p>' +
				'<p class="txa-src">Πηγή: <a href="' + esc(href(top.pg.u)) + '">' + esc(top.pg.t) + '</a></p>' +
				(more.length ? '<p class="txa-src">Δείτε επίσης: ' + more.map(function (p) { return '<a href="' + esc(href(p.u)) + '">' + esc(p.t) + '</a>'; }).join(' · ') + '</p>' : '') + extra);
			HIST.push({ q: q, a: body.slice(0, 500) });
		}
		if (!C.rag || !window.fetch) { extractive(); return; }
		// RAG: the endpoint writes the answer from these passages only (ids into chat.json) and the matching offers
		var ids = [], pagesUsed = {};
		res.forEach(function (r) { if (ids.length < 6 && r.cov >= 0.5 && (pagesUsed[r.pg.u] || 0) < 3) { ids.push(r.d); pagesUsed[r.pg.u] = (pagesUsed[r.pg.u] || 0) + 1; } });
		var wait = say('<p class="txa-dots">Γράφω την απάντηση από τις σελίδες μας…</p>');
		var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) { ctl.abort(); } }, 20000);
		fetch(C.rag, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
			q: q, ids: ids, offers: offs.map(function (o) { return o.u; }), history: HIST.slice(-2), page: here }), signal: ctl ? ctl.signal : undefined })
			.then(function (r) { return r.json(); })
			.then(function (j) {
				clearTimeout(timer); wait.remove();
				if (!j || !j.answer) { extractive(); return; }
				var src = {};
				(j.sources || []).forEach(function (x) { src[x.n] = x; });
				var html = esc(j.answer).replace(/\n+/g, '</p><p>').replace(/\[(\d+)\]/g, function (m, n) {
					var x = src[n]; return x ? '<a class="txa-cite" href="' + esc(href(x.url)) + '" title="' + esc(x.title) + '">' + n + '</a>' : '';
				});
				var used = (j.sources || []).filter(function (x) { return new RegExp('\\[' + x.n + '\\]').test(j.answer); });
				say('<p>' + html + '</p>' + (used.length ? '<p class="txa-src">Πηγές: ' + used.map(function (x) {
					return '<a href="' + esc(href(x.url)) + '">' + x.n + '. ' + esc(x.title) + '</a>'; }).join(' · ') + '</p>' : '') + extra);
				HIST.push({ q: q, a: j.answer.slice(0, 500) });
				if (HIST.length > 4) { HIST.shift(); }
			})
			.catch(function () { clearTimeout(timer); wait.remove(); extractive(); });
	}

	/* ---------- wiring ---------- */
	function hideExpired() { // dated partner promotions on the static preview (the live site removes them in PHP)
		var today = new Date().toISOString().slice(0, 10);
		document.querySelectorAll('[data-tx-until]').forEach(function (e) { if (e.getAttribute('data-tx-until') < today) { e.style.display = 'none'; } });
	}
	function init() {
		hideExpired();
		document.addEventListener('click', function (e) {
			var a = e.target.closest && e.target.closest('.tx-search-open a, a.tx-search-open, a[href$="#anazitisi"]');
			if (a) { e.preventDefault(); openSearch(); }
		});
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') { closeSearch(); if (cbox && !cbox.hidden) { closeChat(); } }
			if (e.key === '/' && !/input|textarea|select/i.test((e.target.tagName || '')) && !e.target.isContentEditable) { e.preventDefault(); openSearch(); }
		});
		if (C.chat) { buildChat(); }
		if (location.hash === '#anazitisi') { openSearch(); }
	}
	if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
