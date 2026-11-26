// Token Radar dashboard (radar-2). Reads window.RADAR from data.js and renders the
// ranked pre-token board, the live-token table, and a per-protocol detail view.
// No network: every figure on the page comes from data.js. The farm plan is rendered
// from the row's farm_steps strings only — this page never invents farm steps.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board-panel');
  if (!DATA || !app) {
    if (app) app.innerHTML = '<p class="panel-foot">No radar data loaded. data.js did not set window.RADAR.</p>';
    return;
  }
  var MODEL = DATA.model || {};
  var ROWS = DATA.rows || [];
  var LIVE = DATA.live || [];
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n, d) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n); }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + num(n, 0);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + num(n, 2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    return num(m, 2) + 'x';
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : 'unknown'; }

  // ---- The model, recomputed here from the snapshot figures ----
  // implied = tvl_usd x category_multiple x growth_multiplier x maturity_multiplier
  // growth_multiplier = 1 + clamp(change_7d, floor, cap) / 100 x weight
  // maturity_multiplier = floor + min(max(age, 0), days) / days x range
  // The category multiple is the row's own figure (shrunk median of its live peers);
  // the global multiple is only the fallback for categories with no peers.
  function modelNum(key, fallback) {
    var v = MODEL[key];
    return v === null || v === undefined || !isFinite(v) ? fallback : v;
  }
  function growthMultOf(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(modelNum('growth_cap', 100), Math.max(modelNum('growth_floor', -50), g));
    return 1 + (g / 100) * modelNum('growth_weight', 0.5);
  }
  function maturityOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? modelNum('unknown_age_days', 365) : row.age_days;
    var days = modelNum('maturity_days', 1095);
    return modelNum('maturity_floor', 0.7) + (Math.min(Math.max(age, 0), days) / days) * modelNum('maturity_range', 0.3);
  }
  function categoryMultipleOf(row) {
    if (row.category_multiple !== null && row.category_multiple !== undefined) return row.category_multiple;
    if (DATA.global_multiple !== null && DATA.global_multiple !== undefined) return DATA.global_multiple;
    return modelNum('base_multiple', 0.2049);
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * categoryMultipleOf(row) * growthMultOf(row) * maturityOf(row)));
  }
  function multiplesList() {
    if (Array.isArray(DATA.multiples)) return DATA.multiples.slice();
    if (MODEL.multiples) {
      return Object.keys(MODEL.multiples).map(function (c) {
        return { category: c, multiple: MODEL.multiples[c], peers: (MODEL.peers && MODEL.peers[c]) || 0 };
      });
    }
    return [];
  }

  // ---- Farm plan: render only, from the row's own strings ----
  // Each step arrives as one string: action, then " Cost: ... Time: ...".
  function parseStep(s) {
    s = String(s || '').trim().replace(/\s+$/, '').replace(/\.$/, '');
    var out = { action: s, cost: '', time: '' };
    var ci = s.indexOf(' Cost: ');
    var ti = s.indexOf(' Time: ');
    if (ci >= 0) {
      out.action = s.slice(0, ci);
      var rest = s.slice(ci + 7);
      var t2 = rest.indexOf(' Time: ');
      if (t2 >= 0) { out.cost = rest.slice(0, t2); out.time = rest.slice(t2 + 7); }
      else out.cost = rest;
    } else if (ti >= 0) {
      out.action = s.slice(0, ti);
      out.time = s.slice(ti + 7);
    }
    return out;
  }

  // ---- State in the URL hash, so a row link survives a reload ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---- Filtering and sorting ----
  function allChains(list) {
    var seen = {};
    list.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function filtered(list) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortVal(r, key) {
    if (key === 'name') return (r.name || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null || r.age_days === undefined ? -1 : r.age_days;
    if (key === 'multiple') return r.category_multiple === null || r.category_multiple === undefined ? -Infinity : r.category_multiple;
    if (key === 'mcap') return r.mcap_usd === null || r.mcap_usd === undefined ? -Infinity : r.mcap_usd;
    if (key === 'rank') return r.rank === null || r.rank === undefined ? Infinity : r.rank;
    return r.implied_value_usd;
  }
  var DEFAULT_DIR = { rank: 1, name: 1, tvl: -1, growth: -1, age: -1, multiple: -1, mcap: -1, implied: -1 };
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return (a.slug || '') < (b.slug || '') ? -1 : 1;
    });
  }

  // ---- Header, stats, controls ----
  function renderChrome() {
    $('snap-asof').textContent = fmtDate(DATA.as_of);
    $('snap-source').textContent = DATA.source || 'DefiLlama protocol index';
    $('snap-model').textContent = (DATA.model_version || 'radar-2') + ' model';
    $('snap-global').textContent = fmtMult(DATA.global_multiple) + ' global';
    $('stat-watchlist').textContent = num(DATA.watchlist_size || ROWS.length, 0);
    $('stat-board').textContent = num(DATA.board_size || ROWS.length, 0);
    $('stat-early').textContent = num(DATA.early_size || 0, 0);
    $('stat-live').textContent = num(DATA.live_size || LIVE.length, 0);
    var floor = DATA.floor_usd ? fmtUsd(DATA.floor_usd) : '';
    $('lede-text').textContent = 'The watchlist is the floor' + (floor ? ' — every protocol with at least ' + floor + ' of TVL and no token on record' : '') +
      '. The early radar adds ' + num(DATA.early_size || 0, 0) + ' pre-token protocols below that floor. ' +
      'Implied value is a model estimate, not a price.';
    $('foot-note').textContent = 'Snapshot ' + fmtDate(DATA.as_of) + ' · ' + (DATA.model_version || 'radar-2') +
      ' · global multiple ' + fmtMult(DATA.global_multiple) + ' · all figures from data.js, no network.';
  }
  function fillOptions(sel, values, current) {
    var keep = current;
    sel.innerHTML = '<option value="all">All ' + (sel.id === 'category' ? 'categories' : 'chains') + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === keep ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function renderControls() {
    var cats = Array.from(new Set(ROWS.concat(LIVE).map(function (r) { return r.category || 'Other'; }))).sort();
    fillOptions($('category'), cats, state.category);
    fillOptions($('chain'), allChains(ROWS.concat(LIVE)), state.chain);
    $('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  // ---- Tables ----
  function sortTh(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' &#9660;' : ' &#9650;') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + esc(label) +
      '<span class="arrow" aria-hidden="true">' + arrow + '</span></button></th>';
  }
  function nameCell(r) {
    return '<td class="name-cell"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' +
      esc((r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain')) + '</span></td>';
  }
  function growthCell(r) {
    var cls = r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
    return '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td>';
  }
  function renderBoard() {
    var pre = state.tab === 'pre-token';
    var list = sorted(filtered(pre ? ROWS : LIVE));
    var head, body = '';
    if (pre) {
      head = '<tr>' + sortTh('rank', 'Rank') + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL') + sortTh('growth', '7d') +
        sortTh('age', 'Age') + sortTh('multiple', 'Cat. multiple') + sortTh('implied', 'Implied value') + '<th scope="col">Token</th></tr>';
      var max = list.length ? Math.max.apply(null, list.map(function (r) { return r.implied_value_usd || 0; })) : 1;
      list.forEach(function (r) {
        var pct = Math.max(3, Math.round(((r.implied_value_usd || 0) / (max || 1)) * 100));
        body += '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0">' +
          '<td class="num">' + esc(r.rank) + '</td>' + nameCell(r) +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + growthCell(r) +
          '<td class="num">' + fmtAge(r.age_days) + '</td>' +
          '<td class="num">' + fmtMult(r.category_multiple) + '</td>' +
          '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
          '<span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>' +
          '<td><span class="badge">no token</span></td></tr>';
      });
      $('board-caption').textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
    } else {
      head = '<tr>' + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age') +
        sortTh('mcap', 'Market cap') + '<th scope="col">Token</th></tr>';
      list.forEach(function (r) {
        body += '<tr>' + nameCell(r) +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + growthCell(r) +
          '<td class="num">' + fmtAge(r.age_days) + '</td>' +
          '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
          '<td><span class="badge live">already trades</span></td></tr>';
      });
      $('board-caption').textContent = 'Live-token protocols set aside: their market cap is a fact, not a model. They do not enter the pre-token ranking.';
    }
    $('board-head').innerHTML = head;
    $('board-body').innerHTML = body;
    $('empty').hidden = list.length > 0;
    $('board-table').style.display = list.length ? '' : 'none';
    var total = pre ? ROWS.length : LIVE.length;
    $('count').textContent = list.length + ' of ' + total + ' ' + (pre ? 'pre-token' : 'live-token') + ' rows shown';
    var ok = 0;
    ROWS.forEach(function (r) { if (impliedOf(r) === r.implied_value_usd) ok++; });
    var vl = $('verify-line');
    vl.innerHTML = 'Recomputed check: this page recomputes every board row as TVL &times; category multiple &times; growth &times; maturity — ' +
      '<b class="' + (ok === ROWS.length ? '' : 'bad') + '">' + ok + ' / ' + ROWS.length + ' match the board</b>.';
  }

  // ---- Methodology panel ----
  function renderMethod() {
    $('formula').textContent = 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' +
      modelNum('growth_floor', -50) + ', ' + modelNum('growth_cap', 100) + ') / 100 x ' + modelNum('growth_weight', 0.5) +
      ') x (' + modelNum('maturity_floor', 0.7) + ' + min(age_days, ' + modelNum('maturity_days', 1095) + ') / ' + modelNum('maturity_days', 1095) +
      ' x ' + modelNum('maturity_range', 0.3) + ') )';
    var mults = multiplesList().sort(function (a, b) { return b.multiple - a.multiple; });
    $('mult-body').innerHTML = mults.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">' + fmtMult(m.multiple) + '</td><td class="num">' + num(m.peers || 0, 0) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="sub">No category multiples in data.js.</td></tr>';
    $('selection-rule').textContent = DATA.selection_rule || 'Board selection rule not stated in data.js.';
  }

  // ---- Detail dialog ----
  var dialog = $('detail');
  function openDetail(slug) {
    var row = null;
    ROWS.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    var peers = row.category_peers === null || row.category_peers === undefined ? 'n/a' : num(row.category_peers, 0);
    var peersLabel = peers === 'n/a' ? 'n/a' : peers + (peers === '1' ? ' peer' : ' peers');
    var steps = (row.farm_steps || []).map(function (s) {
      var p = parseStep(s);
      var meta = '';
      if (p.cost) meta += '<span data-k="Cost">' + esc(p.cost) + '</span>';
      if (p.time) meta += '<span data-k="Time">' + esc(p.time) + '</span>';
      return '<li><b>' + esc(p.action) + '</b>' + (meta ? '<div class="step-meta">' + meta + '</div>' : '') + '</li>';
    }).join('');
    dialog.innerHTML = '<div class="detail-inner">' +
      '<div class="detail-head"><div><p class="eyebrow">Rank ' + esc(row.rank) + ' of ' + num(DATA.board_size || ROWS.length, 0) + '</p>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') +
      ' &middot; listed ' + fmtDate(row.listed_at) + '</p></div>' +
      '<button class="close" type="button" data-close aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3><div class="kv">' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>Category multiple</span><b>' + fmtMult(row.category_multiple) + ' (' + peersLabel + ')</b></div>' +
      '<div><span>Growth multiplier</span><b>' + num(growthMultOf(row), 3) + 'x</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + num(maturityOf(row), 3) + 'x</b></div>' +
      '<div><span>Implied value (board)</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '</div><p class="check">Recomputed here: <b>' + fmtUsd(recomputed) + '</b> — ' +
      (match ? '<span class="ok">matches the board</span>' : '<span class="bad">differs from the board</span>') + '.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3>' +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '<p class="model-note">No farm plan in data.js for this protocol.</p>') + '</section>' +
      '<section class="detail-section"><h3>How to read this</h3>' +
      '<p class="model-note">Implied value multiplies this protocol\u2019s TVL by the median market-cap-to-TVL of live-token peers in its category, ' +
      'nudged by recent growth and by how long it has run with no token. It is a model estimate, not a price — and \u201cno token\u201d means no token on record, not a guarantee one is coming.</p></section>' +
      '</div>';
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function closeDetail() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    state.selected = null;
    writeHash();
    renderBoard();
  }

  // ---- Render + events ----
  function render() {
    renderChrome();
    renderControls();
    renderBoard();
    renderMethod();
    if (state.selected) openDetail(state.selected);
  }
  function setTab(tab) {
    state.tab = tab;
    state.sort = tab === 'pre-token' ? 'implied' : 'mcap';
    state.dir = DEFAULT_DIR[state.sort];
    writeHash();
    render();
  }
  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = DEFAULT_DIR[key] || -1; }
    renderBoard();
  }

  $('q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); renderBoard(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); renderBoard(); });
  $('tab-pre').addEventListener('click', function () { setTab('pre-token'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  $('clear-filters').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all';
    $('q').value = '';
    writeHash();
    render();
  });
  $('board-head').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-sort]') : null;
    if (btn) setSort(btn.getAttribute('data-sort'));
  });
  $('board-body').addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('board-body').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
  });
  dialog.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('[data-close]') : null;
    if (c) closeDetail();
  });
  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); renderBoard(); }
  });

  readHash();
  if (state.tab === 'live') { state.sort = 'mcap'; state.dir = -1; }
  $('q').value = state.q;
  render();
})();
