/* Solver: funções de apoio das telas (formatação, busca, reputação). */
(function () {
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var STOP = 'para com que uma uns umas meu minha meus minhas preciso quero queria ajuda ajudar criar fazer sobre como esse essa isso das dos nos nas por mais muito tenho estou seu sua vou um uns num numa ter ser de do da em no na ao aos as os e ou a o'.split(' ');

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function tokens(s) {
    return norm(s).split(/[^a-z0-9]+/).filter(function (t) { return t.length > 2 && STOP.indexOf(t) < 0; });
  }
  function fixed(n, d) {
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  var L = {
    rate: function () { return window.SOLVER.meta.usdcBrl; },
    brl: function (usdc) { return 'R$ ' + fixed(usdc * L.rate(), 2); },
    brl0: function (usdc) { return 'R$ ' + fixed(Math.round(usdc * L.rate()), 0); },
    usdc: function (n) { return fixed(n, n % 1 ? 2 : 0) + ' USDC'; },
    int: function (n) { return Number(n).toLocaleString('pt-BR'); },
    dec1: function (n) { return fixed(n, 1); },
    pct: function (n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fixed(Math.abs(n), 1) + '%'; },
    initials: function (name) {
      var p = String(name).trim().split(/\s+/);
      return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
    },
    short: function (w) { return w ? w.slice(0, 4) + '…' + w.slice(-4) : ''; },
    byId: function (list, id, key) {
      key = key || 'id';
      for (var i = 0; i < list.length; i++) if (list[i][key] === id) return list[i];
      return null;
    },
    agent: function (id) { return L.byId(window.SOLVER.agents, id); },
    creator: function (id) { return L.byId(window.SOLVER.creators, id); },
    agentBySlug: function (slug) { return L.byId(window.SOLVER.agents, slug, 'slug'); },
    nameOf: function (wallet) {
      var p = window.SOLVER.profiles[wallet];
      return p ? p.displayName : 'Usuário ' + L.short(wallet);
    },
    date: function (iso) {
      var d = new Date(iso);
      return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    },
    ago: function (iso) {
      var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      var d = Math.floor(s / 86400);
      if (d >= 60) return 'há ' + Math.floor(d / 30) + ' meses';
      if (d >= 2) return 'há ' + d + ' dias';
      if (d === 1) return 'ontem';
      var h = Math.floor(s / 3600);
      if (h >= 1) return 'há ' + h + ' h';
      return 'agora há pouco';
    },
    countdown: function (iso) {
      var ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return { text: 'Liberação automática em andamento', h: 0, m: 0, s: 0, urgent: true };
      var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      var pad = function (x) { return x < 10 ? '0' + x : '' + x; };
      return { text: h + ' h ' + pad(m) + ' min', clock: pad(h) + ':' + pad(m) + ':' + pad(s), h: h, m: m, s: s, urgent: h < 24 };
    },
    starPct: function (r) { return Math.round((r / 5) * 100); },
    repLevel: function (score) {
      if (score >= 95) return { key: 'ref', label: 'Referência', tone: 'ok' };
      if (score >= 90) return { key: 'trust', label: 'Confiável', tone: 'ok' };
      if (score >= 80) return { key: 'grow', label: 'Em crescimento', tone: 'brand' };
      if (score >= 60) return { key: 'new', label: 'Começando', tone: 'soft' };
      return { key: 'low', label: 'Em observação', tone: 'warn' };
    },
    hue: function (category) { return window.SOLVER.categoryHue[category] || 260; },
    icon: function (category) {
      var c = L.byId(window.SOLVER.categories, category);
      return c ? c.icon : 'spark';
    },
    /* caminho de uma linha (sparkline) dentro de w x h */
    spark: function (series, w, h) {
      var min = Math.min.apply(null, series), max = Math.max.apply(null, series);
      var span = max - min || 1, pad = 3;
      return series.map(function (v, i) {
        var x = (i / (series.length - 1)) * w;
        var y = pad + (1 - (v - min) / span) * (h - pad * 2);
        return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
    },
    /* Busca em linguagem natural: devolve até 3 especialistas com o motivo */
    search: function (query) {
      var D = window.SOLVER, qt = tokens(query);
      var scored = D.agents.map(function (a) {
        var nameT = tokens(a.name), catT = tokens(a.category),
          bodyT = tokens(a.tagline + ' ' + a.description + ' ' + (D.keywords[a.id] || '') + ' ' +
            a.requirements.map(function (r) { return r.label; }).join(' '));
        var score = 0, hits = [];
        qt.forEach(function (t) {
          var p = t.slice(0, 5), got = 0;
          if (nameT.some(function (x) { return x.indexOf(p) === 0; })) got = 3;
          else if (catT.some(function (x) { return x.indexOf(p) === 0; })) got = 2;
          else if (bodyT.some(function (x) { return x.indexOf(p) === 0; })) got = 1;
          if (got) { score += got; if (hits.indexOf(t) < 0) hits.push(t); }
        });
        return { agent: a, score: score + a.evalScore / 1000, hits: hits, matched: score > 0 };
      });
      var found = scored.filter(function (s) { return s.matched; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
      if (!found.length) {
        found = scored.sort(function (a, b) { return b.agent.userRating - a.agent.userRating; }).slice(0, 3);
        found.forEach(function (f) { f.reason = 'Muito bem avaliado por quem já usou'; });
      } else {
        found.forEach(function (f) {
          f.reason = 'Combina com ' + f.hits.slice(0, 3).map(function (h) { return '“' + h + '”'; }).join(', ');
        });
      }
      return found;
    },
    /* Estado comum de tema e sessão, usado no cabeçalho de todas as telas */
    chrome: function (c, who) {
      var dark = c.state.dark === null || c.state.dark === undefined ? c.props.theme === 'dark' : c.state.dark;
      var D = window.SOLVER;
      var person = who === 'creator' ? L.creator(D.session.creator.creatorId) : null;
      var name = person ? person.name : D.me.displayName;
      return {
        theme: dark ? 'dark' : 'light',
        isDark: dark, isLight: !dark,
        toggleTheme: function () { c.setState({ dark: !dark }); },
        themeLabel: dark ? 'Usar tema claro' : 'Usar tema escuro',
        meName: name,
        meFirst: name.split(' ')[0],
        meInitials: L.initials(name)
      };
    },
    /* valores prontos para um cartão de especialista */
    card: function (a, href) {
      var c = L.creator(a.creatorId), lv = L.repLevel(c.reputationScore), h = window.SOLVER.aux.priceHistory[a.id];
      return {
        id: a.id, name: a.name, tagline: a.tagline, category: a.category, hue: L.hue(a.category), icon: L.icon(a.category), href: href,
        creatorName: c.name, repLabel: lv.label, repTone: lv.tone, starPct: L.starPct(a.userRating), rating: L.dec1(a.userRating),
        reviews: L.int(a.reviewsCount), evalScore: a.evalScore, priceBrl: L.brl0(a.priceUsdc), priceUsdc: L.usdc(a.priceUsdc),
        uses: L.int(a.verifiedUses), trend: L.pct(a.trend7d), trendCls: a.trend7d > 0.5 ? 'up' : a.trend7d < -0.5 ? 'down' : 'flat',
        guarantee: a.guaranteeAvailable, spark: h ? L.spark(h, 72, 28) : 'M0 14 L72 14',
        floorBrl: a.resaleFloorUsdc ? L.brl0(a.resaleFloorUsdc) : '', hasFloor: !!a.resaleFloorUsdc
      };
    },
    copyText: function (text) {
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text); } catch (e) { /* sem permissão: segue */ }
    }
  };
  window.SolverLib = L;
})();
