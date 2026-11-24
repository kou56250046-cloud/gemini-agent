// visual-html: 依存ゼロの図解部品。どの関数も DOM 要素（または要素の配列）を返す。
// 文字列はすべて textContent として扱うので、外部のデータをそのまま渡してよい。
// style へ入れる値は num() で数値に変換する。tone などのクラス名はコード側の固定値を渡す。
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SERIES = ['var(--vz-s1)', 'var(--vz-s2)', 'var(--vz-s3)', 'var(--vz-s4)'];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const clean = (kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== '');

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...clean(kids));
    return el;
  }

  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...clean(kids));
    return el;
  }

  const fill = (el, ...kids) => { el.replaceChildren(...clean(kids)); return el; };

  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const WEEK = '日月火水木金土';
  const mdw = (iso) => { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
  const addClock = (hhmm, minutes) => {
    const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  function wrapText(text, perLine, maxLines) {
    const lines = [];
    let rest = String(text);
    while (rest.length && lines.length < maxLines) {
      lines.push(rest.slice(0, perLine));
      rest = rest.slice(perLine);
    }
    if (rest.length) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, perLine - 1)}…`;
    return lines;
  }

  function pressable(attrs, action) {
    return {
      ...attrs,
      tabindex: 0,
      role: 'button',
      onclick: action,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } },
    };
  }

  // 凡例。items: [{tone, shape:'sq'|'dot'|'bar', color, mark, label}]
  function legend(items) {
    return h('div', { class: 'vz-keys' }, items.map((it) => h('span', {},
      h('i', { class: `vz-${it.shape || 'sq'} ${it.tone ? `vz-t-${it.tone}` : ''}`, style: it.color ? `background:${it.color}` : null }, it.mark),
      it.label)));
  }

  // 切り替えタブ。tabs: [[key, label]]
  function subnav(tabs, current, onChange) {
    return h('div', { class: 'vz-subnav' }, tabs.map(([key, label]) => h('button', {
      type: 'button', 'aria-current': current === key ? 'true' : null, onclick: () => onChange(key),
    }, label)));
  }

  // 押した結果を画面内に出す。詳細パネルが図の下にあるときに使う
  function reveal(el) {
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }

  // 大きな数字の並び。items: [{value, label, tone}]
  function kpis(items) {
    return h('div', { class: 'vz-kpis', style: `grid-template-columns:repeat(${items.length},minmax(0,1fr))` }, items.map((it) => h('div', {},
      h('b', { class: it.tone ? `vz-text-${it.tone}` : '' }, String(it.value)), h('span', {}, it.label))));
  }

  // 割合のメーター。parts: [{label, value, tone}]
  function meter({ parts, note }) {
    const shown = parts.filter((p) => p.value > 0);
    return h('div', { class: 'vz-meter' },
      h('div', { class: 'vz-meter-bar', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${p.value}`).join('、') },
        shown.map((p) => h('div', { class: `vz-t-${p.tone}`, style: `flex:${num(p.value)} 1 0` }))),
      h('div', { class: 'vz-meter-labels', style: `grid-template-columns:repeat(${parts.length},minmax(0,1fr))` }, parts.map((p) => h('div', {},
        h('b', {}, String(p.value)), h('span', {}, h('i', { class: `vz-sq vz-t-${p.tone}` }), p.label)))),
      note && h('p', { class: 'vz-note' }, note));
  }

  const squares = (tones, label) => h('span', { class: 'vz-squares', 'aria-label': label }, tones.map((t) => h('i', { class: `vz-sq vz-t-${t}` })));

  // 開閉できる状況の一覧。rows: [{name, nameTone, marks:[tone], count, body:[要素]}]
  function statusList(rows) {
    return rows.map((r) => h('details', { class: 'vz-status' },
      h('summary', {},
        h('span', { class: `vz-status-name ${r.nameTone ? `vz-text-${r.nameTone}` : ''}` }, r.name),
        r.marks && squares(r.marks, r.markLabel || `${r.marks.length}件`),
        r.count !== undefined && h('span', { class: 'vz-status-count' }, String(r.count))),
      h('div', { class: 'vz-status-body' }, r.body)));
  }

  // 行×列の点の地図。items: [{row, col, tone:'hot'|'warm'|'cool', label, onClick}]
  function dotMap({ rows, cols, items }) {
    return h('div', { class: 'vz-scroll' }, h('table', { class: 'vz-dotmap' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }), cols.map((c) => h('th', { scope: 'col' }, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row' }, r.label),
        cols.map((c) => h('td', {}, items.filter((i) => i.row === r.key && i.col === c.key).map((i) => h('button', {
          type: 'button', class: `vz-dot vz-t-${i.tone}`, title: i.label, 'aria-label': i.label, onclick: i.onClick,
        })))))))));
  }

  function pips(label, value, max) {
    const total = max || 3;
    return h('span', { class: 'vz-pips', 'aria-label': `${label} ${total}段階中${value}` }, h('small', {}, label),
      Array.from({ length: total }, (_, i) => h('i', { class: i < value ? 'on' : '' })));
  }

  // 案の分岐図。options: [{label, recommended, scores:[{label,value}], pros, cons, note, reason}]
  function optionTree(options) {
    return h('div', { class: 'vz-otree' }, options.map((o) => h('div', { class: o.recommended ? 'vz-obranch rec' : 'vz-obranch' },
      h('div', { class: 'vz-ocard' },
        o.recommended && h('span', { class: 'vz-obadge' }, 'おすすめ'),
        h('div', { class: 'vz-olabel' }, o.label),
        o.scores && h('div', { class: 'vz-oscores' }, o.scores.map((s) => pips(s.label, s.value))),
        o.pros && h('p', { class: 'pro' }, h('b', { 'aria-label': '良い点' }, '◎'), o.pros),
        o.cons && h('p', { class: 'con' }, h('b', { 'aria-label': '懸念' }, '△'), o.cons),
        o.note && h('p', { class: 'nt' }, h('b', {}, o.noteLabel || '前例'), o.note),
        o.reason && h('p', { class: 'why' }, o.reason)))));
  }

  // 積み上げ棒。rows: [{label, recommended, segments:[{label, value}]}]、limit は基準線
  function stack({ title, rows, limit, limitLabel, unit }) {
    const u = unit === undefined ? '分' : unit;
    const series = [...new Set(rows.flatMap((r) => r.segments.map((s) => s.label)))];
    const color = (label) => SERIES[series.indexOf(label) % SERIES.length];
    const totals = rows.map((r) => r.segments.reduce((sum, s) => sum + s.value, 0));
    const max = Math.max(limit || 0, ...totals, 1);
    const left = limit ? (limit / max) * 100 : null;
    return h('figure', { class: 'vz-fig' },
      title && h('figcaption', {}, title),
      series.length > 1 && legend(series.map((s) => ({ color: color(s), label: s }))),
      rows.map((r, i) => h('div', { class: r.recommended ? 'vz-srow rec' : 'vz-srow' },
        h('div', { class: 'vz-slabel' }, h('span', {}, r.recommended && '★ ', r.label), h('b', {}, `${totals[i]}${u}`)),
        h('div', { class: 'vz-strack' },
          h('div', { class: 'vz-sbar', style: `width:${(totals[i] / max) * 100}%`, role: 'img', 'aria-label': r.segments.map((s) => `${s.label}${s.value}${u}`).join('、') },
            r.segments.map((s) => h('div', { title: `${s.label} ${s.value}${u}`, style: `flex:${num(s.value)} 1 0;background:${color(s.label)}` }))),
          left !== null && h('div', { class: 'vz-slimit', style: `left:${left}%` })),
        // 色だけに頼らないよう、幅が足りる区間には系列名の頭文字を添える
        h('div', { class: 'vz-snums', style: `width:${(totals[i] / max) * 100}%` }, r.segments.map((s) => h('span', { style: `flex:${num(s.value)} 1 0` },
          series.length > 1 && s.value / max >= 0.09 ? `${s.label[0]}${s.value}` : String(s.value)))))),
      left !== null && h('div', { class: 'vz-slimit-label', style: `padding-left:${left}%` }, `↑ ${limitLabel || `${limit}${u}`}`));
  }

  // 場合分け。{root, branches:[{when, result, onClick, next:{root, branches}}]}
  function treeNode(node) {
    return h('div', { class: 'vz-tnode' },
      h('div', { class: 'vz-troot' }, node.root),
      h('div', { class: 'vz-tbranches' }, node.branches.map((b) => h('div', { class: 'vz-tbranch' },
        h('span', { class: 'vz-twhen' }, b.when),
        b.onClick
          ? h('button', { type: 'button', class: 'vz-tresult link', onclick: b.onClick }, b.result)
          : h('span', { class: 'vz-tresult' }, b.result),
        b.next && treeNode(b.next)))));
  }
  const tree = (v) => h('figure', { class: 'vz-fig' }, v.title && h('figcaption', {}, v.title), treeNode(v));

  // 各駅が止まると後ろの何駅が止まるかを数える
  function metroImpact(tracks, links) {
    const edges = {};
    const ids = [];
    for (const t of tracks) t.stations.forEach((s, i) => {
      ids.push(s.id);
      if (i > 0) (edges[t.stations[i - 1].id] = edges[t.stations[i - 1].id] || []).push(s.id);
    });
    for (const [a, b] of links || []) (edges[a] = edges[a] || []).push(b);
    const out = {};
    for (const id of ids) {
      const seen = new Set();
      const queue = [...(edges[id] || [])];
      while (queue.length) {
        const n = queue.pop();
        if (!seen.has(n)) { seen.add(n); queue.push(...(edges[n] || [])); }
      }
      out[id] = seen.size;
    }
    return out;
  }

  // 路線図。tracks: [{name, stations:[{id,label,state:'done'|'doing'|'todo'|'missing'}]}]、links: [[id,id]]
  function metro({ tracks, links, terminal, keyId, onSelect, ariaLabel }) {
    const ROW = 100;
    const X0 = 36;
    const STEP = 74;
    const END = 322;
    const pos = {};
    tracks.forEach((t, r) => t.stations.forEach((s, c) => { pos[s.id] = { ...s, x: X0 + c * STEP, y: r * ROW + 36 }; }));
    const marks = { done: '✓', missing: '!' };
    const groups = [];
    const lines = tracks.map((t, r) => [
      svg('text', { x: 6, y: r * ROW + 14, class: 'vz-m-track' }, t.name),
      svg('line', { x1: X0, y1: r * ROW + 36, x2: END, y2: r * ROW + 36, class: 'vz-m-line' }),
    ]);
    const edges = (links || []).map(([a, b]) => {
      const s = pos[a];
      const t = pos[b];
      const mid = (s.y + t.y) / 2;
      return svg('path', { d: `M${s.x} ${s.y + 11} C${s.x} ${mid},${t.x} ${mid},${t.x} ${t.y - 13}`, class: 'vz-m-link', 'marker-end': 'url(#vz-arrow)' });
    });
    for (const st of Object.values(pos)) {
      const select = () => {
        groups.forEach((g) => g.classList.remove('on'));
        node.classList.add('on');
        if (onSelect) onSelect(st);
      };
      const node = svg('g', pressable({ class: `vz-m-st ${st.state}`, 'aria-label': st.label }, select),
        svg('rect', { x: st.x - 36, y: st.y - 18, width: 72, height: 78, class: 'vz-m-hit' }),
        st.id === keyId && svg('circle', { cx: st.x, cy: st.y, r: 15, class: 'vz-m-key' }),
        svg('circle', { cx: st.x, cy: st.y, r: 10, class: 'vz-m-dot' }),
        st.state === 'doing' && svg('path', { d: `M${st.x} ${st.y - 7} A7 7 0 0 1 ${st.x} ${st.y + 7} Z`, class: 'vz-m-half' }),
        marks[st.state] && svg('text', { x: st.x, y: st.y + 4.5, class: 'vz-m-mark' }, marks[st.state]),
        wrapText(st.label, 6, 3).map((line, i) => svg('text', { x: st.x, y: st.y + 28 + i * 14, class: 'vz-m-label' }, line)));
      groups.push(node);
    }
    if (keyId && pos[keyId] && onSelect) onSelect(pos[keyId]);
    const span = (tracks.length - 1) * ROW;
    return svg('svg', { viewBox: `0 0 360 ${tracks.length * ROW + 6}`, class: 'vz-metro', role: 'group', 'aria-label': ariaLabel || '路線図' },
      svg('defs', {}, svg('marker', { id: 'vz-arrow', viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' }, svg('path', { d: 'M0 0L8 4L0 8Z', class: 'vz-m-arrow' }))),
      lines, edges,
      terminal && [
        svg('rect', { x: END, y: 16, width: 26, height: Math.max(40, span + 40), rx: 8, class: 'vz-m-end' }),
        svg('text', { x: END + 13, y: span / 2 + 36, class: 'vz-m-end-text', 'writing-mode': 'vertical-rl', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, terminal),
      ],
      groups);
  }
  const metroLegend = () => legend([
    { shape: 'st', tone: 'done', mark: '✓', label: '済' }, { shape: 'st', tone: 'doing', label: '進行中' },
    { shape: 'st', tone: 'todo', label: '未着手' }, { shape: 'st', tone: 'missing', mark: '!', label: '担当未定' },
    { shape: 'st', tone: 'key', label: '最も影響が大きい' },
  ]);

  // 論点×回の変遷。cols: [{key,label}]、rows: [{label, steps:[{col, tone:'idea'|'check'|'done'|'gone', label, onClick}]}]
  function swimlane({ cols, rows, ariaLabel }) {
    return h('div', { class: 'vz-scroll vz-bleed', tabindex: 0, role: 'region', 'aria-label': ariaLabel || '変遷' }, h('table', { class: 'vz-lane' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'vz-sticky' }), cols.map((c) => h('th', { scope: 'col' }, c.label)))),
      h('tbody', {}, rows.map((row) => {
        const index = (key) => cols.findIndex((c) => c.key === key);
        const first = index(row.steps[0].col);
        const last = index(row.steps[row.steps.length - 1].col);
        return h('tr', {},
          h('th', { scope: 'row', class: 'vz-sticky' }, row.label),
          cols.map((c, i) => {
            const step = row.steps.find((s) => s.col === c.key);
            const cls = i < first || i > last ? '' : ['on', i === first && 'start', i === last && 'end'].filter(Boolean).join(' ');
            return h('td', { class: cls }, step && h('button', { type: 'button', class: `vz-step vz-t-${step.tone}`, onclick: step.onClick }, step.label));
          }));
      }))));
  }

  // カレンダー。items: [{date, kind, label}]、kinds: {kind名: 'fill'|'warm'|'outline'|'hot'}
  function calendar({ items, end, kinds, onSelect, today: todayArg }) {
    const now = todayArg ? parseDate(todayArg) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!end && !items.length) return h('p', { class: 'vz-note' }, '日程はまだ決まっていません。');
    const last = parseDate(end || items.map((i) => i.date).sort().slice(-1)[0]);
    const first = items.length ? parseDate(items.map((i) => i.date).sort()[0]) : last;
    const cursor = new Date(today < first ? today : first);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    const stop = new Date(last);
    stop.setDate(stop.getDate() + (6 - stop.getDay()));
    const cells = [];
    const select = (date) => { if (onSelect) onSelect(date, items.filter((i) => i.date === date)); };
    while (cursor <= stop) {
      const date = isoDate(cursor);
      const marks = items.filter((i) => i.date === date);
      const past = cursor < today;
      const label = cursor.getDate() === 1 || cells.length === 0 ? `${cursor.getMonth() + 1}/${cursor.getDate()}` : String(cursor.getDate());
      cells.push(marks.length
        ? h('button', { type: 'button', class: `vz-day vz-k-${kinds[marks[0].kind]}${past ? ' past' : ''}`, 'aria-label': `${mdw(date)} ${marks.map((m) => m.label).join('、')}`, onclick: () => select(date) },
          h('span', {}, label), marks.length > 1 ? h('i', {}, String(marks.length)) : kinds[marks[0].kind] === 'outline' && h('i', {}, '?'))
        : h('div', { class: `vz-day${past ? ' past' : ''}${date === isoDate(today) ? ' today' : ''}` }, h('span', {}, label)));
      cursor.setDate(cursor.getDate() + 1);
    }
    const next = items.map((i) => i.date).sort().find((d) => parseDate(d) >= today);
    if (next) select(next);
    return h('div', { class: 'vz-cal' }, WEEK.split('').map((w) => h('div', { class: 'vz-cal-head' }, w)), cells);
  }

  // 時間に比例した帯。rows: [{title, minutes, note, extra}]
  function timebox({ start, rows, scale }) {
    let clock = start;
    return h('div', { class: 'vz-timebox' }, rows.map((r) => {
      const at = clock;
      if (clock) clock = addClock(clock, r.minutes);
      return h('div', { class: 'vz-tb', style: `min-height:${Math.max(62, r.minutes * (scale || 4.4))}px` },
        h('div', { class: 'vz-tb-time' }, at),
        h('div', { class: 'vz-tb-body' },
          h('div', { class: 'vz-tb-head' }, h('strong', {}, r.title), h('span', {}, `${r.minutes}分`)),
          r.note && h('p', {}, r.note),
          r.extra));
    }));
  }

  // 太さで量を示す流れ図。links: [{from, to, value, tone:'none'}]
  function ribbons({ links, unit, x1, x2, leftOrder, rightText, ariaLabel, rightChars }) {
    const U = unit || 22;
    const GAP = 16;
    const X1 = x1 || 96;
    const X2 = x2 || 256;
    const lefts = leftOrder || [...new Set(links.map((l) => l.from))];
    const rights = [...new Set(links.map((l) => l.to))];
    const place = (names, key) => {
      let y = 8;
      const out = {};
      for (const name of names) {
        const n = links.filter((l) => l[key] === name).reduce((sum, l) => sum + l.value, 0);
        out[name] = { y, h: n * U, used: 0, n };
        y += n * U + GAP;
      }
      return { pos: out, height: y };
    };
    const L = place(lefts, 'from');
    const R = place(rights, 'to');
    const paths = links.map((l) => {
      const a = L.pos[l.from];
      const b = R.pos[l.to];
      const thick = l.value * U;
      const y1 = a.y + a.used + thick / 2;
      const y2 = b.y + b.used + thick / 2;
      a.used += thick;
      b.used += thick;
      const mid = (X1 + X2) / 2;
      return svg('path', { d: `M${X1} ${y1} C${mid} ${y1},${mid} ${y2},${X2} ${y2}`, class: `vz-r-link ${l.tone || ''}`, 'stroke-width': Math.max(2, thick - 3) });
    });
    const noneLeft = (name) => links.some((l) => l.from === name && l.tone === 'none');
    const limit = rightChars || 12;
    const clip = (t) => (t.length > limit ? `${t.slice(0, limit - 1)}…` : t);
    return svg('svg', { viewBox: `0 0 360 ${Math.max(L.height, R.height)}`, class: 'vz-ribbons', role: 'img', 'aria-label': ariaLabel || links.map((l) => `${l.from}から${l.to}へ${l.value}`).join('、') },
      paths,
      lefts.map((o) => [
        svg('rect', { x: X1 - 6, y: L.pos[o].y, width: 6, height: L.pos[o].h, class: `vz-r-node ${noneLeft(o) ? 'none' : ''}` }),
        svg('text', { x: X1 - 12, y: L.pos[o].y + L.pos[o].h / 2 + 5, class: `vz-r-text end ${noneLeft(o) ? 'none' : ''}` }, o),
      ]),
      rights.map((w) => [
        svg('rect', { x: X2, y: R.pos[w].y, width: 6, height: R.pos[w].h, class: 'vz-r-node' }),
        svg('text', { x: X2 + 12, y: R.pos[w].y + R.pos[w].h / 2 + 5, class: 'vz-r-text' }, svg('title', {}, w), clip(rightText ? rightText(w, R.pos[w].n) : w)),
      ]));
  }

  // 先頭列を固定した表。cols: [{label, vertical}]、rows: [{label, cells:[{tone, mark, label} | {text} | null]}]
  function matrix({ cols, rows, ariaLabel, nameWidth }) {
    return h('div', { class: 'vz-scroll vz-bleed', tabindex: 0, role: 'region', 'aria-label': ariaLabel || '表' }, h('table', { class: 'vz-matrix', style: nameWidth ? `--vz-name:${num(nameWidth)}px` : null },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', class: 'vz-sticky' }),
        cols.map((c) => h('th', { scope: 'col', class: c.vertical ? 'vert' : '' }, c.vertical ? h('span', {}, c.label) : c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row', class: 'vz-sticky' }, r.label),
        r.cells.map((c) => {
          if (!c) return h('td', {});
          if (c.text !== undefined) return h('td', { class: 'num' }, String(c.text));
          // role が無い span の aria-label は読み上げで無視されることが多いので、印を 1 つの画像として扱う
          return h('td', {}, h('span', { class: `vz-cell vz-c-${c.tone}`, title: c.label, role: 'img', 'aria-label': c.label || c.mark }, c.mark));
        }))))));
  }

  // 濃淡の表（1色の濃さで量を示す）。rows: [{label, values:[数値|null]}]
  function heat({ cols, rows, ariaLabel }) {
    const max = Math.max(1, ...rows.flatMap((r) => r.values.filter((v) => v !== null)));
    return h('div', { class: 'vz-scroll vz-bleed', tabindex: 0, role: 'region', 'aria-label': ariaLabel || '濃淡の表' }, h('table', { class: 'vz-heat' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'vz-sticky' }), cols.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row', class: 'vz-sticky' }, r.label),
        r.values.map((v) => {
          if (v === null || v === undefined) return h('td', {});
          const a = v / max;
          return h('td', {}, h('span', {}, h('i', { style: `opacity:${0.12 + a * 0.88}` }), h('b', { style: `color:${a > 0.5 ? '#fff' : 'var(--vz-ink)'}` }, String(v))));
        }))))));
  }

  // 横棒。items: [{label, value, ratio}]
  function bars(items) {
    return h('div', { class: 'vz-bars' }, items.map((x) => h('div', {},
      h('div', { class: 'vz-bar-label' }, h('span', {}, x.label), h('span', { class: 'v' }, x.value)),
      h('div', { class: 'vz-bar-track' }, h('div', { class: 'vz-bar-fill', style: `width:${Math.max(0, Math.min(100, x.ratio * 100))}%` })))));
  }

  // 縦棒（度数分布など）。items: [{label, value}]
  function columns(items, unit) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return h('div', { class: 'vz-cols', role: 'img', 'aria-label': items.map((i) => `${i.label} ${i.value}${unit || ''}`).join('、') }, items.map((i) => h('div', {},
      h('b', {}, String(i.value)),
      h('i', { style: `height:${(i.value / max) * 84 + 2}px` }),
      h('span', {}, i.label))));
  }

  // 期間のチャート。rows: [{label, note, start, end, dots:[iso], size}]（size は終点の丸の大きさ）
  function gantt({ rows, ariaLabel }) {
    const dates = rows.flatMap((r) => [r.start, r.end, ...(r.dots || [])].filter(Boolean)).map(parseDate);
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const from = new Date(min.getFullYear(), min.getMonth(), 1);
    const to = new Date(max.getFullYear(), max.getMonth() + 1, 1);
    const L = 8;
    const W = 344;
    const x = (d) => L + ((d - from) / (to - from)) * W;
    const ROW = 50;
    const ticks = [];
    for (const d = new Date(from); d <= to; d.setMonth(d.getMonth() + 1)) ticks.push(new Date(d));
    const maxSize = Math.max(1, ...rows.map((r) => r.size || 0));
    const height = rows.length * ROW + 26;
    return svg('svg', { viewBox: `0 0 360 ${height}`, class: 'vz-gantt', role: 'img', 'aria-label': ariaLabel || rows.map((r) => `${r.label} ${r.note || ''}`).join('、') },
      ticks.map((d, i) => [
        svg('line', { x1: x(d), x2: x(d), y1: 18, y2: height, class: 'vz-g-grid' }),
        i < ticks.length - 1 && svg('text', { x: x(d) + 3, y: 12, class: 'vz-g-tick' }, `${d.getMonth() + 1}月`),
      ]),
      rows.map((r, i) => {
        const y = 26 + i * ROW;
        const a = x(parseDate(r.start));
        const b = x(parseDate(r.end));
        const radius = r.size ? 4 + Math.sqrt(r.size / maxSize) * 7 : 4;
        return [
          svg('text', { x: L, y: y + 11, class: 'vz-g-label' }, r.label),
          svg('text', { x: 352, y: y + 11, class: 'vz-g-note' }, r.note),
          svg('line', { x1: a, x2: b, y1: y + 28, y2: y + 28, class: 'vz-g-bar' }),
          (r.dots || []).map((d) => svg('circle', { cx: x(parseDate(d)), cy: y + 28, r: 3.5, class: 'vz-g-dot' })),
          svg('circle', { cx: b, cy: y + 28, r: radius, class: r.size ? 'vz-g-end' : 'vz-g-end hollow' }),
        ];
      }));
  }

  // 工程のつながり。steps: [{label, sub}]
  function chevrons(steps) {
    return h('ol', { class: 'vz-chev' }, steps.map((s) => h('li', {}, h('b', {}, s.label), s.sub && h('span', {}, s.sub))));
  }

  // 全体の中の位置。cells: [{label, on, mark}]
  function strip(cells) {
    return h('div', { class: 'vz-strip', style: `grid-template-columns:repeat(${cells.length},minmax(0,1fr))` }, cells.map((c) => h('div', { class: c.on ? 'on' : '', title: c.label, 'aria-label': `${c.label}${c.on ? '（出番）' : ''}` }, c.mark)));
  }

  // 配置図。zones: [{label, x, y, w, h, kind:'stage'|'floor'|'seat'|'equip'}]（x,y,w,h は 0〜100）
  function floor({ title, zones, ratio, ariaLabel }) {
    const H = 360 * (ratio || 0.8);
    const sx = (v) => (v / 100) * 360;
    const sy = (v) => (v / 100) * H;
    return h('figure', { class: 'vz-fig' }, title && h('figcaption', {}, title),
      svg('svg', { viewBox: `0 0 360 ${H}`, class: 'vz-floor', role: 'img', 'aria-label': ariaLabel || zones.map((z) => z.label).join('、') },
        svg('rect', { x: 1, y: 1, width: 358, height: H - 2, class: 'vz-f-room' }),
        zones.map((z) => [
          svg('rect', { x: sx(z.x), y: sy(z.y), width: sx(z.w), height: sy(z.h), rx: 4, class: `vz-f-zone ${z.kind || 'floor'}` }),
          svg('text', { x: sx(z.x + z.w / 2), y: sy(z.y + z.h / 2) + 4, class: `vz-f-label ${z.kind || 'floor'}` }, z.label),
        ])));
  }

  // 縦のタイムライン。rows: [{band} | {time, sub, tbd, title, lines:[[見出し, 値]], note, chips, extra}]
  function timeline(rows) {
    return h('div', { class: 'vz-tl' }, rows.map((r) => (r.band
      ? h('div', { class: 'vz-tl-band' }, h('span', {}, r.band), r.bandNote && h('small', {}, r.bandNote))
      : h('div', { class: 'vz-tl-row' },
        h('div', { class: r.tbd ? 'vz-tl-time tbd' : 'vz-tl-time' }, r.time, r.sub && h('small', {}, r.sub)),
        h('div', { class: 'vz-tl-main' },
          h('div', { class: 'vz-tl-title' }, r.title),
          (r.lines || []).filter(([, v]) => v).map(([k, v]) => h('p', { class: 'vz-tl-line' }, h('span', {}, k), v)),
          r.note && h('p', { class: 'vz-tl-note' }, r.note),
          r.extra)))));
  }

  root.VZ = {
    h, svg, fill, reveal, parseDate, isoDate, mdw, addClock, wrapText, legend, subnav, kpis, meter, squares, statusList, dotMap, pips,
    optionTree, stack, tree, metro, metroLegend, metroImpact, swimlane, calendar, timebox, ribbons, matrix, heat,
    bars, columns, gantt, chevrons, strip, floor, timeline,
  };
})(typeof window !== 'undefined' ? window : globalThis);
