import { randomUUID } from 'node:crypto';

const BINDING = '__jenteraProcedureEventV1';
const MAX_EVENTS = 400;
const MAX_DURATION_MS = 20 * 60 * 1000;
const ALLOWED_DOM_EVENTS = new Set(['click', 'input', 'change', 'submit']);
const ALLOWED_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);
const MAX_TEMPLATE_DEPTH = 6;
const MAX_TEMPLATE_FIELDS = 80;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

function boundedText(value, length) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, length);
}

function safeLocation(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const rawSegments = url.pathname.split('/');
    const segments = rawSegments.map((segment, index) => {
      const previous = rawSegments[index - 1] ?? '';
      if (/(?:token|reset|verify|verification|magic|invite|session|auth|login|sso)/i.test(previous)) return ':value';
      if (/^[0-9]{4,}$/.test(segment)) return ':number';
      if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)) return ':id';
      if (/@|%[0-9a-f]{2}|\d{3,}/i.test(segment)) return ':value';
      if (/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{8,}$/.test(segment)) return ':value';
      if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ':value';
      return segment.slice(0, 80);
    });
    return {
      origin: url.origin,
      path: segments.join('/').slice(0, 400) || '/',
      queryKeys: [...new Set([...url.searchParams.keys()].map(key => boundedText(key, 60)).filter(Boolean))].slice(0, 20),
    };
  } catch { return null; }
}

function safeFieldName(value, fallback = 'field') {
  const name = boundedText(value, 80);
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(name) || /^[A-Za-z0-9_-]{24,}$/.test(name) || /@|%[0-9a-f]{2}/i.test(name)) return fallback;
  return SAFE_FIELD.test(name) ? name : fallback;
}

function slotName(path, fallback = 'value') {
  const parts = path.map(part => /^\d+$/.test(String(part)) ? `item_${part}` : safeFieldName(String(part), '')).filter(Boolean);
  const joined = parts.join('_').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const base = joined || fallback;
  return (/^[A-Za-z]/.test(base) ? base : `value_${base}`).slice(0, 96);
}

function scalarTemplate(value, path) {
  const key = String(path.at(-1) ?? '');
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/(?:authorization|cookie|csrf|xsrf|password|passwd|passcode|secret|token|apikey|otp|onetimecode|session(?:id|key|token)?)/.test(normalizedKey)) {
    return { kind: 'credential', source: 'vault_or_browser_session', valueType };
  }
  return { kind: 'slot', name: slotName(path), valueType: ['string', 'number', 'boolean', 'null'].includes(valueType) ? valueType : 'string' };
}

function templateValue(value, path = [], state = { fields: 0 }, depth = 0) {
  if (depth > MAX_TEMPLATE_DEPTH || state.fields >= MAX_TEMPLATE_FIELDS) return { kind: 'omitted' };
  if (value === null || !['object'].includes(typeof value)) {
    state.fields += 1;
    return scalarTemplate(value, path);
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length && state.fields < MAX_TEMPLATE_FIELDS; index += 1) {
      items.push(templateValue(value[index], [...path, String(index + 1)], state, depth + 1));
    }
    return { kind: 'array', items };
  }
  const fields = [];
  for (const [index, [rawKey, child]] of Object.entries(value).entries()) {
    if (state.fields >= MAX_TEMPLATE_FIELDS) break;
    const key = safeFieldName(rawKey, `field_${index + 1}`);
    fields.push({ key, value: templateValue(child, [...path, key], state, depth + 1) });
  }
  return { kind: 'object', fields };
}

function requestTemplate(request) {
  const query = [];
  try {
    const url = new URL(request.url?.());
    for (const [index, key] of [...new Set(url.searchParams.keys())].slice(0, 20).entries()) {
      const safeKey = safeFieldName(key, `query_${index + 1}`);
      query.push({ key: safeKey, value: scalarTemplate(url.searchParams.get(key), ['query', safeKey]) });
    }
  } catch { /* safeLocation already rejects malformed URLs. */ }

  const rawBody = request.postData?.();
  let body;
  if (typeof rawBody === 'string' && rawBody.length > 0 && rawBody.length <= 32768) {
    try {
      body = { format: 'json', root: templateValue(JSON.parse(rawBody), ['body']) };
    } catch {
      try {
        const params = new URLSearchParams(rawBody);
        const fields = [];
        if ([...params.keys()].length > 0 && rawBody.includes('=')) {
          for (const [index, key] of [...new Set(params.keys())].slice(0, MAX_TEMPLATE_FIELDS).entries()) {
            const safeKey = safeFieldName(key, `field_${index + 1}`);
            fields.push({ key: safeKey, value: scalarTemplate(params.get(key), ['body', safeKey]) });
          }
          body = { format: 'form', root: { kind: 'object', fields } };
        }
      } catch { /* Unknown bodies remain browser-only. */ }
    }
    if (!body) body = { format: 'opaque', replay: 'browser_only' };
  } else if (typeof rawBody === 'string' && rawBody.length > 0) {
    body = { format: 'opaque', replay: 'browser_only' };
  }
  return {
    authentication: { source: 'vault_or_browser_session', exposedToModel: false },
    query,
    ...(body ? { body } : {}),
  };
}

function installObserver(binding) {
  if (window.__jenteraProcedureObserverV1) return;
  window.__jenteraProcedureObserverV1 = true;
  const seenInputs = new WeakSet();
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const target = raw => {
    const element = raw instanceof Element ? raw.closest('button, a, input, textarea, select, [role], [contenteditable="true"]') ?? raw : null;
    if (!element) return null;
    const tag = element.tagName.toLowerCase();
    const type = tag === 'input' ? clean(element.getAttribute('type') || 'text').toLowerCase() : '';
    const role = clean(element.getAttribute('role'));
    let name = clean(element.getAttribute('aria-label'));
    if (!name && element.id) {
      try { name = clean(document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent); } catch { /* Invalid ids are unnamed. */ }
    }
    if (!name && ['button', 'a'].includes(tag)) name = clean(element.textContent);
    if (!name && type !== 'password') name = clean(element.getAttribute('placeholder'));
    return { tag, ...(type ? { type } : {}), ...(role ? { role } : {}), ...(name ? { name } : {}) };
  };
  const send = (kind, raw) => {
    const descriptor = target(raw);
    if (!descriptor) return;
    try { window[binding]({ kind, target: descriptor }); } catch { /* Recording must never disrupt the website. */ }
  };
  document.addEventListener('click', event => send('click', event.target), true);
  document.addEventListener('input', event => {
    if (!(event.target instanceof Element) || seenInputs.has(event.target)) return;
    seenInputs.add(event.target); send('input', event.target);
  }, true);
  document.addEventListener('change', event => send('change', event.target), true);
  document.addEventListener('submit', event => send('submit', event.submitter ?? event.target), true);
}

function compact(events) {
  const result = [];
  for (const event of events) {
    const previous = result.at(-1);
    if (previous && event.kind === previous.kind && event.kind === 'request' &&
        event.method === previous.method && event.origin === previous.origin && event.path === previous.path) continue;
    if (previous && event.kind === 'navigation' && previous.kind === 'navigation' &&
        event.origin === previous.origin && event.path === previous.path) continue;
    result.push(event);
  }
  return result;
}

function compileDraft(session, endedAt) {
  const events = compact(session.events);
  const observed = events.filter(event => event.kind !== 'request');
  const candidates = events.filter(event => event.kind === 'request');
  const steps = observed.map((event, index) => {
    if (event.kind === 'navigation') return {
      id: `step-${index + 1}`, kind: 'navigate', label: `Open ${event.origin}${event.path}`,
      execution: 'browser', evidence: event.id,
    };
    const name = event.target.name || event.target.role || event.target.type || event.target.tag;
    const verb = event.action === 'input' || event.action === 'change' ? 'Enter information in'
      : event.action === 'submit' ? 'Submit' : 'Select';
    return {
      id: `step-${index + 1}`, kind: event.action === 'input' || event.action === 'change' ? 'input' : 'interact',
      label: `${verb} ${name}`,
      execution: 'browser', target: event.target, evidence: event.id,
    };
  });
  return {
    schemaVersion: 1,
    id: session.id,
    version: 1,
    status: 'draft',
    objective: session.objective,
    startedAt: session.startedAt,
    endedAt,
    safety: {
      capturedValues: false,
      capturedRequestBodies: false,
      capturedHeaders: false,
      transientParameterization: true,
      credentialBoundary: 'opaque_reference_only',
      activation: 'review_required',
    },
    steps: steps.slice(0, 200),
    connectorCandidates: candidates.map(event => ({
      method: event.method, origin: event.origin, path: event.path,
      queryKeys: event.queryKeys, resourceType: event.resourceType, evidence: event.id,
      compilation: 'review_required',
      ...(event.requestTemplate ? { requestTemplate: event.requestTemplate } : {}),
    })).slice(0, 100),
    truncated: session.truncated,
  };
}

/** Explicit, owner-started browser demonstration capture. Raw values may be
 * inspected transiently inside this trusted process solely to replace them
 * with typed slots or opaque credential references. Raw values, headers,
 * cookies, bodies, screenshots and coordinates never enter recorder state or
 * cross the runtime boundary. */
export function createProcedureRecorder({ now = Date.now } = {}) {
  let active = null;
  let context = null;
  const pages = new WeakSet();
  let contextListener = null;

  function append(event) {
    if (!active) return;
    if (now() - active.startedAt > MAX_DURATION_MS || active.events.length >= MAX_EVENTS) {
      active.truncated = true;
      return;
    }
    active.events.push({ id: `event-${active.events.length + 1}`, at: now(), ...event });
  }

  async function observePage(page) {
    if (pages.has(page)) return;
    pages.add(page);
    try {
      await page.exposeBinding?.(BINDING, (_source, event) => {
        if (!active || !event || typeof event !== 'object' || !ALLOWED_DOM_EVENTS.has(event.kind)) return;
        const target = event.target;
        if (!target || typeof target !== 'object') return;
        const descriptor = {
          tag: boundedText(target.tag, 20).toLowerCase(),
          ...(boundedText(target.type, 30) ? { type: boundedText(target.type, 30).toLowerCase() } : {}),
          ...(boundedText(target.role, 40) ? { role: boundedText(target.role, 40) } : {}),
          ...(boundedText(target.name, 120) ? { name: boundedText(target.name, 120) } : {}),
        };
        if (!descriptor.tag || descriptor.type === 'password') return;
        append({ kind: 'interaction', action: event.kind, target: descriptor });
      });
    } catch { /* Binding may already exist after a stopped recording. */ }
    const inject = () => page.evaluate?.(installObserver, BINDING).catch(() => {});
    page.on?.('domcontentloaded', inject);
    page.on?.('framenavigated', frame => {
      if (!active || frame !== page.mainFrame?.()) return;
      const location = safeLocation(page.url?.());
      if (location) append({ kind: 'navigation', ...location });
    });
    page.on?.('request', request => {
      if (!active) return;
      const resourceType = request.resourceType?.();
      if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) return;
      const location = safeLocation(request.url?.());
      const method = boundedText(request.method?.(), 12).toUpperCase();
      if (location && method) append({ kind: 'request', method, resourceType, ...location,
        requestTemplate: requestTemplate(request) });
    });
    await inject();
  }

  async function attach(nextContext) {
    if (context === nextContext) return;
    if (context && contextListener) context.off?.('page', contextListener);
    context = nextContext;
    contextListener = page => { void observePage(page); };
    context.on?.('page', contextListener);
    await Promise.all(context.pages().map(observePage));
  }

  async function start(nextContext, objective) {
    if (active) throw new Error('procedure_recording_active');
    await attach(nextContext);
    active = { id: randomUUID(), objective: boundedText(objective, 240), startedAt: now(), events: [], truncated: false };
    for (const page of nextContext.pages()) {
      const location = safeLocation(page.url?.());
      if (location) append({ kind: 'navigation', ...location });
    }
    return status();
  }

  function stop() {
    if (!active) throw new Error('procedure_recording_inactive');
    const session = active;
    active = null;
    return compileDraft(session, now());
  }

  function cancel() { active = null; }
  function status() { return active ? { recording: true, recordingStartedAt: active.startedAt } : { recording: false }; }

  return { start, stop, cancel, status };
}

export const procedureRecorderInternals = { safeLocation, compileDraft, requestTemplate, templateValue };
