/*
 * Offer finder on /prosfores/ (2026-11-23, owner: "fix all of the above" = the competitor gaps: filters, sort, result
 * count, clear filters, saved offers, map). Data: uploads/tx-assist/offers.json, written by the offer sync (inc/offers.php).
 * - Filters: destination (our page), travel month, nights, max «από» price, board, stars, hotel type, partner, saved only.
 *   Month, board and type come from the partner's own tags (Ekdromi.gr); untagged offers never match those filters.
 * - The choice lives in the URL (?dest=kriti&m=8…); the server marks such URLs noindex, follow.
 * - One card per hotel (the same hotel at both partners counts once), 24 cards per step.
 * - Map: Leaflet (assets/leaflet/, in the theme) + OpenStreetMap tiles, loaded only after a click on «Προβολή στον χάρτη».
 * Never throws on bad data: a failed load shows a message and the server-rendered list below still works.
 */
(function () {
	'use strict';
	var F = window.TX_FINDER || {};
	var root = document.getElementById('evresi');
	if (!root || !F.offers || !window.fetch) { return; }
	var HOME = (F.home || '').replace(/\/$/, '');
	var form = root.querySelector('.tx-f-form'), out = root.querySelector('.tx-f-results'), countEl = root.querySelector('.tx-f-count');
	var moreBtn = root.querySelector('.tx-f-more'), mapBox = root.querySelector('.tx-f-map'), mapBtn = root.querySelector('.tx-f-mapbtn');
	var FIELDS = ['dest', 'm', 'n', 'max', 'bd', 'st', 'ty', 'pk', 'sort'];
	var DATA = [], CHECKED = '', shown = 0, current = [], map = null, layer = null;
	var STEP = 24;

	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
	function price(n) {
		var whole = Math.floor(n) === n, s = whole ? String(n) : n.toFixed(2).replace('.', ',');
		return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
	}
	function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + '/' + (+m[2]) + '/' + m[1] : ''; }
	function saved() {
		try { return (JSON.parse(localStorage.getItem('tx_saved') || '[]') || []).map(function (x) { return x.u; }); } catch (e) { return []; }
	}
	function val(name) { var e = form.elements[name]; return e ? (e.type === 'checkbox' ? (e.checked ? '1' : '') : e.value) : ''; }

	function matches(o, f, sv) {
		if (f.dest && (o.p || []).indexOf(f.dest) < 0) { return false; }
		if (f.m && (o.m || []).indexOf(+f.m) < 0) { return false; }
		if (f.n) {
			var n = +o.n || 0;
			if ((f.n === '1' && n !== 1) || (f.n === '2' && n !== 2) || (f.n === '3' && (n < 3 || n > 4)) || (f.n === '5' && n < 5)) { return false; }
		}
		if (f.max && !(o.pr > 0 && o.pr <= +f.max)) { return false; }
		if (f.bd && (o.bd || []).indexOf(f.bd) < 0) { return false; }
		if (f.st && (f.st === '5' ? o.st !== 5 : !(o.st >= +f.st))) { return false; }
		if (f.ty && (o.ty || []).indexOf(f.ty) < 0) { return false; }
		if (f.pk && o.pk !== f.pk) { return false; }
		if (f.saved && sv.indexOf(o.u) < 0) { return false; }
		return true;
	}
	function filters() { var f = {}; FIELDS.concat(['saved']).forEach(function (k) { f[k] = val(k); }); return f; }

	function card(o, more) {
		var bits = (o.d || '').split(' · ').filter(function (x) { return x && x !== o.pl && !/^από /.test(x); });
		var partner = (o.k || '').replace(/^Προσφορά · /, '');
		var u = HOME + o.u;
		var title = (o.pl && o.t.slice(-(o.pl.length + 2)) === ', ' + o.pl) ? o.t.slice(0, -(o.pl.length + 2)) : o.t;
		var sv = saved().indexOf(o.u) > -1;
		return '<article class="tx-ocard" data-price="' + (+o.pr || 0) + '" data-bought="' + (+o.b || 0) + '">' +
			'<button type="button" class="tx-save" data-save="' + esc(o.u) + '" data-title="' + esc(o.t) + '" aria-pressed="' + sv + '" aria-label="' + esc('Αποθήκευση: ' + o.t) + '">' +
			'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 21s-7.5-4.6-9.6-9.1C.9 8.6 3 5 6.6 5c2 0 3.5 1.1 4.4 2.5C11.9 6.1 13.4 5 15.4 5 19 5 21.1 8.6 19.6 11.9 17.5 16.4 12 21 12 21z" fill="currentColor"/></svg></button>' +
			(o.im ? '<a class="tx-ocard-img" href="' + esc(u) + '" tabindex="-1" aria-hidden="true"><img src="' + esc(HOME + o.im) + '" alt="' + esc(o.t) + '" width="480" height="320" loading="lazy" decoding="async"></a>' : '') +
			'<div class="tx-ocard-body">' + (o.pl ? '<p class="tx-ocard-place">' + esc(o.pl) + '</p>' : '') +
			'<h3 class="tx-ocard-title"><a href="' + esc(u) + '">' + esc(title) + '</a></h3>' +
			(bits.length ? '<ul class="tx-ocard-facts"><li>' + bits.map(esc).join('</li><li>') + '</li></ul>' : '') +
			'<p class="tx-ocard-price"><span>από</span> ' + esc(price(+o.pr || 0)) + '</p>' +
			'<p class="tx-ocard-meta">' + esc(partner) + ' · έλεγχος ' + esc(dmy(CHECKED)) + '</p>' +
			(more ? '<p class="tx-ocard-compare">Και ' + more + (more === 1 ? ' ακόμη προσφορά' : ' ακόμη προσφορές') + ' για το ίδιο κατάλυμα</p>' : '') +
			'<a class="tx-ocard-btn" href="' + esc(u) + '">Δείτε την προσφορά</a></div></article>';
	}

	function run(push) {
		var f = filters(), sv = saved();
		var hits = DATA.filter(function (o) { return matches(o, f, sv); });
		var by = f.sort || 'pop';
		hits.sort(function (a, b) {
			if (by === 'price') { return (a.pr || 1e9) - (b.pr || 1e9); }
			if (by === 'price-desc') { return (b.pr || 0) - (a.pr || 0); }
			return (b.b || 0) - (a.b || 0);
		});
		var groups = {}, list = [];
		hits.forEach(function (o) {  // one card per hotel; the count of the hotel's other offers goes on the card
			var g = o.gr || o.u;
			if (groups[g]) { groups[g].more++; return; }
			groups[g] = { o: o, more: 0 }; list.push(groups[g]);
		});
		current = list; shown = 0; out.innerHTML = '';
		countEl.textContent = list.length ? (list.length === 1 ? '1 κατάλυμα' : list.length + ' καταλύματα') + ' σε ' + hits.length + (hits.length === 1 ? ' προσφορά' : ' προσφορές') +
			' · τιμές «από» του ελέγχου της ' + dmy(CHECKED) : 'Καμία προσφορά με αυτά τα φίλτρα. Αφαιρέστε ένα φίλτρο ή πατήστε «Καθαρισμός φίλτρων».';
		step();
		if (map) { drawMap(); }
		if (push !== false) { syncUrl(f); }
	}
	function step() {
		var next = current.slice(shown, shown + STEP);
		out.insertAdjacentHTML('beforeend', next.map(function (x) { return card(x.o, x.more); }).join(''));
		shown += next.length;
		moreBtn.hidden = shown >= current.length;
		if (!moreBtn.hidden) { moreBtn.textContent = 'Περισσότερες προσφορές (' + (current.length - shown) + ')'; }
	}
	function syncUrl(f) {
		try {
			var q = new URLSearchParams();
			Object.keys(f).forEach(function (k) { if (f[k] && !(k === 'sort' && f[k] === 'pop')) { q.set(k, f[k]); } });
			if (map) { q.set('view', 'map'); }
			var s = q.toString();
			history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + '#evresi');
		} catch (e) { /* old browser: the URL simply does not follow the filters */ }
	}
	function fromUrl() {
		var q;
		try { q = new URLSearchParams(location.search); } catch (e) { return false; }
		FIELDS.concat(['saved']).forEach(function (k) {
			var e = form.elements[k], v = q.get(k);
			if (!e || v === null) { return; }
			if (e.type === 'checkbox') { e.checked = v === '1'; } else if ([].some.call(e.options, function (o) { return o.value === v; })) { e.value = v; }
		});
		return q.get('view') === 'map';
	}

	/* ---------- map (Leaflet in the theme, OpenStreetMap tiles; nothing loads before the click) ---------- */
	function loadLeaflet() {
		if (window.L) { return Promise.resolve(); }
		return new Promise(function (ok, bad) {
			var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = F.leaflet + 'leaflet.css'; document.head.appendChild(css);
			var s = document.createElement('script'); s.src = F.leaflet + 'leaflet.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
		});
	}
	function drawMap() {
		if (!map || !window.L) { return; }
		if (layer) { layer.remove(); }
		layer = window.L.layerGroup().addTo(map);
		var pts = [];
		current.slice(0, 600).forEach(function (x) {
			var o = x.o;
			if (!o.la || !o.lo) { return; }
			pts.push([o.la, o.lo]);
			window.L.circleMarker([o.la, o.lo], { radius: 7, color: '#0E3B7D', weight: 2, fillColor: '#BF4F2C', fillOpacity: 0.9 })
				.bindPopup('<strong><a href="' + esc(HOME + o.u) + '">' + esc(o.t) + '</a></strong><br>από ' + esc(price(+o.pr || 0)) + ' · έλεγχος ' + esc(dmy(CHECKED)))
				.addTo(layer);
		});
		if (pts.length) { map.fitBounds(pts, { padding: [24, 24], maxZoom: 13 }); }
	}
	function openMap() {
		mapBox.hidden = false; mapBtn.setAttribute('aria-pressed', 'true'); mapBtn.textContent = 'Απόκρυψη χάρτη';
		if (map) { map.invalidateSize(); drawMap(); syncUrl(filters()); return; }
		var div = document.createElement('div'); div.className = 'tx-f-mapcanvas'; div.setAttribute('role', 'region'); div.setAttribute('aria-label', 'Χάρτης προσφορών');
		mapBox.appendChild(div);
		loadLeaflet().then(function () {
			map = window.L.map(div, { scrollWheelZoom: false }).setView([38.3, 24.2], 6);
			window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18,
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
			drawMap(); syncUrl(filters());
		}, function () { div.textContent = 'Ο χάρτης δεν φόρτωσε. Δοκιμάστε ξανά αργότερα.'; });
	}
	function closeMap() { mapBox.hidden = true; mapBtn.setAttribute('aria-pressed', 'false'); mapBtn.textContent = 'Προβολή στον χάρτη'; map && map.remove(); map = null; layer = null; mapBox.querySelectorAll('.tx-f-mapcanvas').forEach(function (e) { e.remove(); }); syncUrl(filters()); }

	/* ---------- wiring ---------- */
	var wantMap = fromUrl();
	fetch(F.offers, { credentials: 'omit' }).then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.json(); }).then(function (d) {
		DATA = (d && d.offers) || []; CHECKED = (d && d.checked) || '';
		run(false);
		if (wantMap) { openMap(); }
	}).catch(function () { countEl.textContent = 'Οι προσφορές δεν φόρτωσαν. Δείτε πιο κάτω τις προσφορές ανά προορισμό.'; });
	form.addEventListener('change', function () { run(); });
	root.querySelector('.tx-f-clear').addEventListener('click', function () {
		form.reset(); run();
	});
	moreBtn.addEventListener('click', step);
	mapBtn.addEventListener('click', function () { if (map || !mapBox.hidden) { closeMap(); } else { openMap(); } });
	document.addEventListener('tx-saved-change', function () { if (form.elements.saved && form.elements.saved.checked) { run(); } });
})();
