'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const statuses = { verified_confirmed: ['공식확정', 'confirmed'], reported_confirmed_pending: ['보고된 확정 · 공식 확인대기', 'reported'], estimated: ['추정', 'estimated'], unscheduled: ['미정', 'unscheduled'], cancelled: ['취소', 'cancelled'], conflict: ['충돌', 'conflict'] };
  const types = { earnings_release: '실적 발표', conference_call: '컨퍼런스 콜' };
  const iso = (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
  const string = (value) => typeof value === 'string' && value.length <= 500;
  const day = (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)));
  const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => Object.hasOwn(value, key));
  const refreshStates = ['unverified', 'publishing', 'succeeded', 'partial_failure', 'failed'];
  let snapshot = null;
  let busy = false;
  let monthCursor = kstDay(new Date()).slice(0, 7);
  let view = 'month';
  function validate(data) {
    if (!keys(data, ['schema_version', 'data_sha256', 'source_read_at', 'data_as_of', 'original_source_refresh', 'public_copy', 'counts', 'companies']) || data.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(data.data_sha256) || !iso(data.source_read_at) || data.source_read_at === null) throw new Error('schema');
    if (!keys(data.data_as_of, ['latest_event_change_at', 'latest_evidence_check_at']) || !Object.values(data.data_as_of).every(iso)) throw new Error('schema');
    const origin = data.original_source_refresh;
    if (!keys(origin, ['status', 'last_attempt_at', 'last_success_at', 'coverage']) || !refreshStates.includes(origin.status) || !iso(origin.last_attempt_at) || !iso(origin.last_success_at)) throw new Error('schema');
    if (!keys(origin.coverage, ['expected_companies', 'checked_companies', 'failed_companies']) || !Object.values(origin.coverage).every((n) => n === null || (Number.isInteger(n) && n >= 0))) throw new Error('schema');
    const copy = data.public_copy;
    if (!keys(copy, ['status', 'last_attempt_at', 'last_success_at', 'last_verified_data_sha256']) || !refreshStates.includes(copy.status) || !iso(copy.last_attempt_at) || !iso(copy.last_success_at) || !(copy.last_verified_data_sha256 === null || /^[a-f0-9]{64}$/.test(copy.last_verified_data_sha256))) throw new Error('schema');
    if (!keys(data.counts, ['companies', 'events']) || !Array.isArray(data.companies) || data.companies.length !== data.counts.companies || !Number.isInteger(data.counts.events)) throw new Error('schema');
    let events = 0;
    for (const company of data.companies) {
      if (!keys(company, ['name', 'ticker', 'events']) || !string(company.name) || !company.name.trim() || !(company.ticker === null || string(company.ticker)) || !Array.isArray(company.events)) throw new Error('schema');
      events += company.events.length;
      for (const event of company.events) {
        if (!keys(event, ['event_type', 'lifecycle', 'status', 'schedule', 'updated_at', 'sources']) || !Object.hasOwn(types, event.event_type) || !['active', 'superseded'].includes(event.lifecycle) || !Object.hasOwn(statuses, event.status) || !iso(event.updated_at) || !Array.isArray(event.sources)) throw new Error('schema');
        const schedule = event.schedule;
        if (!keys(schedule, ['precision', 'date_start', 'date_end', 'local_datetime', 'time_zone', 'utc_datetime', 'kst_datetime', 'date_basis']) || !['date', 'datetime', 'week', 'unknown', 'conflict'].includes(schedule.precision) || !day(schedule.date_start) || !day(schedule.date_end) || !iso(schedule.utc_datetime) || !iso(schedule.kst_datetime) || !(schedule.local_datetime === null || string(schedule.local_datetime)) || !(schedule.time_zone === null || string(schedule.time_zone)) || ![null, 'source_printed', 'local', 'kst'].includes(schedule.date_basis)) throw new Error('schema');
        for (const source of event.sources) if (!keys(source, ['source_type', 'label', 'url', 'verification', 'checked_at', 'verified_at']) || !['corporate_ir', 'kind', 'dart', 'exchange', 'broker_pdf', 'manual'].includes(source.source_type) || !string(source.label) || !(source.url === null || (typeof source.url === 'string' && source.url.length <= 2048)) || !['verified', 'pending', 'failed'].includes(source.verification) || !iso(source.checked_at) || !iso(source.verified_at)) throw new Error('schema');
      }
    }
    if (events !== data.counts.events || origin.coverage.expected_companies !== data.counts.companies) throw new Error('coverage');
    if (origin.status === 'succeeded' && (!origin.last_success_at || origin.coverage.checked_companies !== data.counts.companies || origin.coverage.failed_companies !== 0)) throw new Error('coverage');
    if (copy.status === 'succeeded' && (!copy.last_success_at || copy.last_verified_data_sha256 !== data.data_sha256)) throw new Error('schema');
    return data;
  }
  function timestamp(value) {
    return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' KST' : '확인되지 않음';
  }
  const dateText = (value) => value ? value.replaceAll('-', '.') : '날짜 미정';
  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function companyConfirmation(company) {
    const sources = company.events.flatMap((event) => event.sources);
    const latest = (items) => items.flatMap((source) => [source.checked_at, source.verified_at]).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
    return { official: latest(sources.filter((source) => source.verification === 'verified' && ['corporate_ir', 'kind', 'dart', 'exchange'].includes(source.source_type))), reference: latest(sources) };
  }
  function kstDay(value) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const part = (type) => parts.find((p) => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function knownDate(event) {
    if (!['date', 'datetime'].includes(event.schedule.precision) || event.status === 'conflict') return null;
    return event.schedule.kst_datetime ? kstDay(event.schedule.kst_datetime) : event.schedule.date_start;
  }
  function scheduleText(schedule) {
    if (schedule.precision === 'unknown') return ['일정 미정', '발표일이 확정되지 않았습니다.'];
    if (schedule.precision === 'conflict') return ['일정 충돌 · 재확인 필요', '서로 다른 일정 정보가 있어 날짜를 확정하지 않습니다.'];
    const basis = { source_printed: '출처에 표기된 날짜', local: '현지 날짜', kst: '한국 날짜(KST)' }[schedule.date_basis] || '날짜 기준 미확인';
    if (schedule.precision === 'datetime') {
      if (schedule.local_datetime && schedule.date_basis !== 'kst') {
        const parts = schedule.local_datetime.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        if (parts) return [`${dateText(parts[1])} ${parts[2]}`, `출처 현지시각${schedule.time_zone ? ' · ' + schedule.time_zone : ' · 시간대 미확인'}${schedule.kst_datetime ? ' / 한국시간: ' + timestamp(schedule.kst_datetime) : ''}`];
      }
      if (schedule.kst_datetime) return [timestamp(schedule.kst_datetime), '한국시간(KST)으로 표시한 시각'];
      return [dateText(schedule.date_start), basis + ' · 시각 변환 정보 미확인'];
    }
    const range = schedule.date_end && schedule.date_end !== schedule.date_start ? ' – ' + dateText(schedule.date_end) : '';
    return [dateText(schedule.date_start) + range, basis + (schedule.precision === 'week' ? ' · 주간 범위, 개별 발표일 미확정' : ' · 발표 시각·시간대 미정')];
  }
  function safeSourceUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function renderEvent(event) {
    const card = element('section', 'event' + (event.lifecycle === 'superseded' ? ' superseded' : ''));
    const top = element('div', 'event-top');
    top.append(element('span', 'event-type', types[event.event_type]), element('span', 'badge ' + statuses[event.status][1], (event.lifecycle === 'superseded' ? '이전 일정 · ' : '') + statuses[event.status][0]));
    const [date, basis] = scheduleText(event.schedule);
    card.append(top, element('p', 'event-date', date), element('p', 'event-basis', basis));
    const links = element('div', 'sources');
    for (const source of event.sources) {
      const url = source.url && safeSourceUrl(source.url);
      const label = source.label + (source.verification === 'pending' ? ' · 확인대기' : source.verification === 'failed' ? ' · 확인실패' : '');
      const link = element(url ? 'a' : 'span', source.verification === 'verified' ? '' : 'pending', label);
      if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      const checked = source.verified_at || source.checked_at;
      if (checked) link.title = '출처 확인: ' + timestamp(checked);
      links.append(link);
    }
    if (!event.sources.length) links.append(element('span', '', '확인된 공개 출처 없음'));
    card.append(links);
    if (event.updated_at) card.append(element('p', 'event-meta', '일정 기록 변경: ' + timestamp(event.updated_at)));
    return card;
  }
  function openEvent(company, event) {
    text('event-detail-title', company.name);
    text('event-detail-caption', (company.ticker || '종목코드 미확인') + ' · ' + types[event.event_type]);
    const confirmed = companyConfirmation(company), summary = element('section', 'detail-confirmation');
    summary.append(element('p', '', '해당 기업 마지막 공식근거 확인: ' + timestamp(confirmed.official)), element('p', '', '참고 근거 최근 조회·기록: ' + timestamp(confirmed.reference)), element('small', '', '현재 공개본의 해당 기업 근거를 합산한 시각입니다. 참고 시각에는 확인대기·실패 기록도 포함되며, 기업 전체 일정의 최신성이나 전체 조사 완료를 뜻하지 않습니다.'));
    $('event-detail-content').replaceChildren(summary, renderEvent(event));
    $('event-dialog').showModal();
  }
  function chip(company, event, side = false) {
    const node = element('button', side ? 'side-event' : 'event-chip ' + ({ confirmed: 'verified', reported: 'pending' }[statuses[event.status][1]] || statuses[event.status][1]) + (event.lifecycle === 'superseded' ? ' superseded' : ''));
    node.type = 'button';
    const wrap = side ? element('span') : node;
    wrap.append(element('strong', '', company.name));
    const localTime = event.schedule.local_datetime?.match(/[T ](\d{2}:\d{2})/);
    const time = event.schedule.kst_datetime ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(event.schedule.kst_datetime)) + ' KST' : localTime ? localTime[1] + ' 현지' : '시각 미정';
    wrap.append(element('small', '', side ? types[event.event_type] + ' · ' + (event.schedule.precision === 'conflict' ? '날짜 재확인' : '날짜 미정') : time + ' · ' + (event.event_type === 'conference_call' ? '콜' : '실적 발표')));
    if (!side) wrap.append(element('small', 'chip-status', (event.lifecycle === 'superseded' ? '이전 · ' : '') + statuses[event.status][0]));
    if (!side && event.schedule.date_basis === 'source_printed' && !event.schedule.kst_datetime) wrap.append(element('small', 'source-date-note', event.schedule.time_zone ? '출처 현지시각 · ' + event.schedule.time_zone : '출처 표기일 · 시간대 미확인'));
    if (side) node.append(wrap, element('span', '', '›'));
    const [date, basis] = scheduleText(event.schedule);
    const label = company.name + ', ' + types[event.event_type] + ', ' + date + ', ' + statuses[event.status][0] + ', ' + basis;
    node.title = label; node.setAttribute('aria-label', label);
    node.addEventListener('click', () => openEvent(company, event));
    return node;
  }
  function populateCompanies() {
    const selected = $('company-filter').value;
    const options = [element('option', '', '모든 기업')]; options[0].value = 'all';
    [...snapshot.companies].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')).forEach((company) => { const option = element('option', '', company.name + (company.ticker ? ' · ' + company.ticker : '')); option.value = company.name; options.push(option); });
    $('company-filter').replaceChildren(...options);
    $('company-filter').value = options.some((option) => option.value === selected) ? selected : 'all';
  }
  function render() {
    if (!snapshot) return;
    const query = $('search').value.trim().toLocaleLowerCase('ko-KR'), status = $('status-filter').value, selected = $('company-filter').value, previous = $('show-superseded').checked;
    const companies = snapshot.companies.filter((company) => (selected === 'all' || company.name === selected) && (!query || (company.name + ' ' + (company.ticker || '')).toLocaleLowerCase('ko-KR').includes(query)));
    const records = companies.flatMap((company) => company.events.filter((event) => (previous || event.lifecycle === 'active') && (status === 'all' || statuses[event.status][1] === status)).map((event) => ({ company, event })));
    const start = monthCursor + '-01', endDate = new Date(Date.UTC(+monthCursor.slice(0, 4), +monthCursor.slice(5, 7), 0)), end = endDate.toISOString().slice(0, 10);
    const scheduled = records.filter(({ event }) => { const date = knownDate(event); return date && date >= start && date <= end; });
    const ranges = records.filter(({ event }) => event.schedule.precision === 'week' && event.schedule.date_start <= end && event.schedule.date_end >= start);
    const conflicts = records.filter(({ event }) => event.status === 'conflict' || event.schedule.precision === 'conflict');
    const undated = records.filter(({ event }) => !knownDate(event) && !['week', 'conflict'].includes(event.schedule.precision) && event.status !== 'conflict');
    const noEvents = status === 'all' ? companies.filter((company) => !company.events.length) : [];
    text('month-label', +monthCursor.slice(0, 4) + '년 ' + +monthCursor.slice(5, 7) + '월');
    text('today-label', dateText(kstDay(new Date())) + ' KST');
    text('result-count', `이달 ${scheduled.length}건 · 기간 ${ranges.length}건 `);
    const content = document.createDocumentFragment();
    if (view === 'month') {
      const weekdays = element('div', 'month-grid'); ['일', '월', '화', '수', '목', '금', '토'].forEach((day) => weekdays.append(element('div', 'weekday', day + '요일'))); content.append(weekdays);
      const grid = element('div', 'month-grid');
      const first = new Date(start + 'T12:00:00Z'); first.setUTCDate(first.getUTCDate() - first.getUTCDay());
      const last = new Date(end + 'T12:00:00Z'); last.setUTCDate(last.getUTCDate() + 6 - last.getUTCDay());
      for (const date = new Date(first); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
        const day = date.toISOString().slice(0, 10), events = scheduled.filter(({ event }) => knownDate(event) === day);
        const cell = element('div', 'day-cell' + (day.slice(0, 7) !== monthCursor ? ' outside' : '') + ([0, 6].includes(date.getUTCDay()) ? ' weekend' : ''));
        const head = element('div', 'day-heading'), number = element('time', 'day-number' + (day === kstDay(new Date()) ? ' today' : ''), String(date.getUTCDate()));
        number.dateTime = day; number.setAttribute('aria-label', dateText(day)); head.append(number);
        if (events.length) head.append(element('span', 'day-count', events.length + '건'));
        cell.append(head); events.forEach(({ company, event }) => cell.append(chip(company, event))); grid.append(cell);
      }
      content.append(grid);
    } else {
      const scroll = element('div', 'list-scroll'), table = element('table', 'event-list'), thead = element('thead'), headings = element('tr');
      ['날짜 · 시각', '기업', '일정', '확인 상태'].forEach((value) => headings.append(element('th', '', value))); thead.append(headings); table.append(thead);
      const tbody = element('tbody');
      [...scheduled, ...ranges].sort((a, b) => String(knownDate(a.event) || a.event.schedule.date_start).localeCompare(String(knownDate(b.event) || b.event.schedule.date_start))).forEach(({ company, event }) => {
        const row = element('tr'), date = element('td', 'event-time', scheduleText(event.schedule)[0]), name = element('td'), button = element('button', 'list-event', company.name);
        button.type = 'button'; button.addEventListener('click', () => openEvent(company, event)); name.append(button, element('small', '', company.ticker || '종목코드 미확인'));
        date.append(element('small', '', event.schedule.date_basis === 'source_printed' ? (event.schedule.time_zone ? '출처 현지시각 · ' + event.schedule.time_zone : '출처 표기일 · 시각·시간대 미정') : event.schedule.kst_datetime ? '한국시간(KST)' : '시각 미정'));
        const state = element('td'); state.append(element('span', 'badge ' + statuses[event.status][1], (event.lifecycle === 'superseded' ? '이전 · ' : '') + statuses[event.status][0]));
        row.append(date, name, element('td', '', types[event.event_type]), state); tbody.append(row);
      });
      table.append(tbody); scroll.append(table); content.append(scroll);
    }
    if (!scheduled.length && !ranges.length) content.append(element('p', 'empty-state', '이달에는 조건에 맞는 일정이 없습니다. 날짜 미정·충돌 항목은 별도로 표시합니다.'));
    $('results').replaceChildren(content);
    $('range-section').hidden = ranges.length === 0 || view === 'list'; $('range-list').replaceChildren(...ranges.map(({ company, event }) => { const node = chip(company, event); node.append(element('small', '', scheduleText(event.schedule)[0])); return node; }));
    const side = (id, rows) => { $(id + '-count').textContent = rows.length; $(id + '-list').replaceChildren(...rows.map(({ company, event }) => chip(company, event, true))); if (!rows.length) $(id + '-list').append(element('p', 'side-empty', '해당 항목이 없습니다.')); };
    side('undated', undated); side('conflict', conflicts);
    noEvents.forEach((company) => $('undated-list').append(element('p', 'side-empty', company.name + ' · 일정 미정')));
    if (noEvents.length) text('undated-count', undated.length + noEvents.length);
  }
  async function load() {
    if (busy) return;
    busy = true; $('results').setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('./data.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('http');
      const next = validate(await response.json());
      snapshot = next; $('notice').hidden = true; text('superseded-count', '(' + snapshot.companies.flatMap(c => c.events).filter(e => e.lifecycle === 'superseded').length + ')'); populateCompanies(); render();
    } catch {
      $('notice').hidden = false; $('notice').classList.add('error');
      text('notice', snapshot ? '공개 일정을 불러오지 못해 이전 화면을 유지합니다. 페이지를 새로고침해 주세요.' : '공개 일정을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      if (!snapshot) $('results').replaceChildren(element('p', 'empty-state', '일정을 불러올 수 없습니다.'));
    } finally { busy = false; $('results').setAttribute('aria-busy', 'false'); }
  }
  function setMonth(delta) {
    const date = new Date(monthCursor + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + delta); monthCursor = date.toISOString().slice(0, 7); render();
  }
  ['search', 'status-filter', 'company-filter', 'show-superseded'].forEach((id) => $(id).addEventListener(id === 'search' ? 'input' : 'change', render));
  $('previous-month').addEventListener('click', () => setMonth(-1));
  $('next-month').addEventListener('click', () => setMonth(1));
  $('today').addEventListener('click', () => { monthCursor = kstDay(new Date()).slice(0, 7); render(); });
  $('reset-filters').addEventListener('click', () => { $('search').value = ''; $('company-filter').value = 'all'; $('status-filter').value = 'all'; $('show-superseded').checked = false; render(); });
  ['month', 'list'].forEach((value) => $(value + '-view').addEventListener('click', () => { view = value; ['month', 'list'].forEach((item) => $(item + '-view').setAttribute('aria-pressed', String(item === value))); render(); }));
  $('close-dialog').addEventListener('click', () => $('event-dialog').close());
  $('event-dialog').addEventListener('click', (event) => { if (event.target === $('event-dialog')) $('event-dialog').close(); });
  load();
})();
