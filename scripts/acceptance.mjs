#!/usr/bin/env node
/**
 * Werefa release-candidate acceptance gate.
 *
 * Answers exactly one question:
 *
 *   "Has the repository preserved the verified Werefa release-candidate baseline?"
 *
 * It is NOT a product-decision checker. It never decides whether an unresolved
 * §46 decision, a deployment input, a blocked requirement or a deferred
 * requirement is good, bad, complete or incomplete. It only verifies the
 * objectively enforceable release invariants that were audited in
 * docs/implementation/48-final-canonical-traceability-audit.md and
 * docs/implementation/48-release-handoff-and-reproducible-deployment-contract.md,
 * and then re-runs the existing, already-trusted release gates.
 *
 * Deliberately NOT done here (see docs/implementation/49-… for the full list):
 *  - no semantic proof of the 214 implemented requirements;
 *  - no re-classification of requirements from source code;
 *  - no provider, infrastructure, domain, secret or §46 decision;
 *  - no second test framework, no new external dependency, no second worker.
 *
 * Invoked from the repository root:
 *   npm run acceptance            # static checks + every existing release gate
 *   npm run acceptance:static     # static checks only (fast; no npm sub-gates)
 *
 * Exit code 0 = PASS, 1 = FAIL. It never mutates the repository.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_ONLY = process.argv.slice(2).includes('--static-only');

/* ------------------------------------------------------------------------- *
 * Pinned acceptance values.
 *
 * The canonical specification digest is written out literally here on purpose:
 * it must never be derived from the file currently on disk, otherwise the check
 * would approve whatever the specification happens to contain.
 * ------------------------------------------------------------------------- */

const REQUIRED_SPEC_SHA256 = '5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b';

const BASELINE_PATH = 'docs/implementation/release-candidate-baseline.json';
const SPEC_PATH = 'docs/WEREFA-COMPLETE-SPECIFICATION.md';

/** The six §46 decisions that must remain unresolved. Order-insensitive. */
const EXPECTED_SECTION_46_DECISIONS = [
  'subscription monthly price',
  'global timezone identity',
  'subscription-reminder lead time',
  'owner booking-report PDF export',
  'owner "modify" scope',
  'timezone-abbreviation display rule',
];

/** Environment-variable groups the application actually requires. */
const REQUIRED_BACKEND_ENV = {
  runtime: ['NODE_ENV', 'HOST', 'PORT', 'LOG_LEVEL', 'LOG_PRETTY', 'CORS_ORIGINS', 'BODY_LIMIT', 'TRUST_PROXY'],
  'auth/security': [
    'AUTH_TEST_ENABLED',
    'AUTH_SESSION_TTL_HOURS',
    'AUTH_RECOVERY_TTL_MINUTES',
    'AUTH_RECOVERY_MAX_ATTEMPTS',
    'AUTH_RECOVERY_CODE_LENGTH',
    'AUTH_COOKIE_NAME',
  ],
  database: ['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'TEST_DATABASE_URL', 'RUN_DB_TESTS'],
  'dev provisioning only': ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'MIGRATOR_PASSWORD'],
  telegram: [
    'TELEGRAM_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_HANDLE',
    'TELEGRAM_BOT_WEBHOOK_SECRET',
    'TELEGRAM_BOT_WEBHOOK_URL',
    'TELEGRAM_DELIVERY_INTERVAL_MS',
    'TELEGRAM_DELIVERY_MAX_ATTEMPTS',
  ],
  'proof storage': ['PROOF_STORAGE_DIR'],
  worker: ['BUSINESS_LIFECYCLE_INTERVAL_MS'],
  'pending §46 product parameters': [
    'PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR',
    'PRODUCT_APP_TIMEZONE',
    'PRODUCT_REMINDER_LEAD_DAYS',
    'PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED',
    'PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS',
    'PRODUCT_SHOW_TIMEZONE_ABBREVIATION',
  ],
};

/** Backend variables that must stay value-less in the committed template. */
const BACKEND_SECRET_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_WEBHOOK_SECRET'];

/** Built-in Vite env keys; not application configuration. */
const VITE_BUILTIN_ENV = new Set(['DEV', 'PROD', 'SSR', 'MODE', 'BASE_URL']);

/**
 * The single accepted demo-only mock seam (branding logo/cover editor, pending
 * an image-storage decision). Any *other* production frontend source importing
 * `@/mock/*` fails the gate.
 */
const ACCEPTED_MOCK_SEAMS = ['src/features/owner-portal/pages/BusinessProfilePage.tsx'];

/** Exactly these two in-process workers may exist — no second scheduler. */
const EXPECTED_WORKERS = [
  'src/domain/services/business-lifecycle.worker.ts',
  'src/domain/notifications/notification-background.worker.ts',
];

/** Log lines must never carry these values (targeted check, not a scanner). */
const NEVER_LOGGED_IDENTIFIERS = [
  'telegramBotToken',
  'telegramBotWebhookSecret',
  'passwordHash',
  'sessionToken',
  'recoveryCodeHash',
];

/* ------------------------------------------------------------------------- *
 * Small filesystem helpers
 * ------------------------------------------------------------------------- */

const abs = (p) => join(ROOT, p);

function readText(p) {
  return readFileSync(abs(p), 'utf8');
}

function exists(p) {
  return existsSync(abs(p));
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(abs(p))).digest('hex');
}

function walk(dir, filter = () => true) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (filter(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Repo-relative POSIX path, so messages are identical on every platform. */
const repoPath = (p) => relative(ROOT, p).split(sep).join('/');

function sourceFiles(dir, exts) {
  return walk(abs(dir), (f) => exts.some((e) => f.endsWith(e))).map(repoPath);
}

function documentedEnvKeys(path) {
  const keys = new Map();
  for (const line of readText(path).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) keys.set(m[1], m[2]);
  }
  return keys;
}

/* ------------------------------------------------------------------------- *
 * Check plumbing
 * ------------------------------------------------------------------------- */

/** Accumulates failures for one check; every failure names expected/observed. */
class CheckContext {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.failures = [];
    this.notes = [];
  }

  expect(condition, { expected, observed, fix }) {
    if (!condition) this.failures.push({ expected, observed, fix });
    return Boolean(condition);
  }

  note(text) {
    this.notes.push(text);
  }
}

const CHECKS = [];
const check = (id, title, run) => CHECKS.push({ id, title, run });

function loadBaseline(ctx) {
  if (!ctx.expect(exists(BASELINE_PATH), {
    expected: `${BASELINE_PATH} exists`,
    observed: 'file not found',
    fix: 'restore the machine-readable release-candidate baseline',
  })) {
    return null;
  }
  try {
    return JSON.parse(readText(BASELINE_PATH));
  } catch (err) {
    ctx.expect(false, {
      expected: `${BASELINE_PATH} is valid JSON`,
      observed: err instanceof Error ? err.message : String(err),
      fix: 'restore the baseline file to its committed form',
    });
    return null;
  }
}

/** Normalised REQ id → number, or NaN when malformed. */
const reqNumber = (id) => {
  const m = /^REQ-(\d{3})$/.exec(id);
  return m ? Number(m[1]) : Number.NaN;
};

/* ------------------------------------------------------------------------- *
 * A. Canonical specification integrity
 * ------------------------------------------------------------------------- */

check('spec-hash', 'Canonical specification hash', (ctx) => {
  if (!ctx.expect(exists(SPEC_PATH), {
    expected: `${SPEC_PATH} exists`,
    observed: 'file not found',
    fix: 'restore the canonical specification',
  })) {
    return;
  }
  const observed = sha256(SPEC_PATH);
  ctx.expect(observed === REQUIRED_SPEC_SHA256, {
    expected: `sha256(${SPEC_PATH}) = ${REQUIRED_SPEC_SHA256}`,
    observed: `sha256(${SPEC_PATH}) = ${observed}`,
    fix: 'the canonical specification must not be edited; it is read-only for this project',
  });

  const baseline = loadBaseline(ctx);
  if (baseline?.canonicalSpecification) {
    ctx.expect(baseline.canonicalSpecification.sha256 === REQUIRED_SPEC_SHA256, {
      expected: `${BASELINE_PATH} records the pinned digest ${REQUIRED_SPEC_SHA256}`,
      observed: `recorded ${baseline.canonicalSpecification.sha256}`,
      fix: 'the baseline must agree with the pinned digest; do not update it to match a changed file',
    });
  }
  ctx.note(observed);
});

check('spec-inventory', 'Canonical requirement inventory', (ctx) => {
  const baseline = loadBaseline(ctx);
  if (!baseline || !ctx.expect(exists(SPEC_PATH), { expected: SPEC_PATH, observed: 'missing', fix: 'restore the file' })) {
    return;
  }
  const headings = [...readText(SPEC_PATH).matchAll(/^#### (REQ-\d{3}) — /gm)].map((m) => m[1]);
  const unique = new Set(headings);
  const first = headings[0];
  const last = headings[headings.length - 1];
  const declaredTotal = baseline.canonicalSpecification?.requirementHeadingCount ?? baseline.requirements?.total;

  ctx.expect(headings.length === declaredTotal, {
    expected: `${declaredTotal} \`#### REQ-### — \` headings in the canonical specification`,
    observed: `${headings.length} headings found`,
    fix: 'requirement inventory changed; that is a specification change, which is not permitted',
  });
  ctx.expect(unique.size === headings.length, {
    expected: 'every requirement heading id is unique',
    observed: `${headings.length - unique.size} duplicate heading id(s)`,
    fix: 'remove the duplicated requirement headings',
  });
  ctx.expect(first === 'REQ-001' && last === 'REQ-232', {
    expected: 'requirement headings span REQ-001 … REQ-232',
    observed: `${first} … ${last}`,
    fix: 'the requirement range must remain REQ-001 … REQ-232',
  });
  ctx.note(`${headings.length} requirements (${first} … ${last})`);
});

/* ------------------------------------------------------------------------- *
 * B. Requirement traceability baseline
 * ------------------------------------------------------------------------- */

check('req-baseline', 'Requirement classification baseline', (ctx) => {
  const baseline = loadBaseline(ctx);
  if (!baseline) return;
  const r = baseline.requirements;
  if (!ctx.expect(Boolean(r), { expected: 'requirements block in the baseline', observed: 'absent', fix: 'restore the baseline' })) {
    return;
  }

  const depIds = r.deploymentProviderDependentIds ?? [];
  const blockedIds = r.blockedIds ?? [];
  const deferredIds = r.deferredIds ?? [];
  const classified = [...depIds, ...blockedIds, ...deferredIds];

  ctx.expect(depIds.length === r.deploymentProviderDependent, {
    expected: `${r.deploymentProviderDependent} deployment/provider-dependent requirement ids`,
    observed: `${depIds.length} listed`,
    fix: 'keep the count and the id list in agreement',
  });
  ctx.expect(blockedIds.length === r.blocked, {
    expected: `${r.blocked} blocked requirement ids`,
    observed: `${blockedIds.length} listed`,
    fix: 'keep the count and the id list in agreement',
  });
  ctx.expect(deferredIds.length === r.deferred, {
    expected: `${r.deferred} deferred requirement ids`,
    observed: `${deferredIds.length} listed`,
    fix: 'keep the count and the id list in agreement',
  });
  ctx.expect(r.implemented + r.deploymentProviderDependent + r.blocked + r.deferred === r.total, {
    expected: 'implemented + deployment-dependent + blocked + deferred = total',
    observed: `${r.implemented} + ${r.deploymentProviderDependent} + ${r.blocked} + ${r.deferred} ≠ ${r.total}`,
    fix: 'reconcile the four classes against the total',
  });
  ctx.expect(r.implemented === r.total - classified.length, {
    expected: `${r.implemented} implemented = ${r.total} − ${classified.length} classified`,
    observed: `implemented = ${r.implemented}`,
    fix: 'the implemented class is the complement of the classified ids; recompute it',
  });

  const seen = new Map();
  for (const id of classified) {
    const n = reqNumber(id);
    ctx.expect(Number.isInteger(n) && n >= 1 && n <= r.total, {
      expected: `"${id}" is a REQ-NNN id within REQ-001 … REQ-${String(r.total).padStart(3, '0')}`,
      observed: `"${id}"`,
      fix: 'use canonical REQ-NNN identifiers',
    });
    ctx.expect(!seen.has(id), {
      expected: `"${id}" appears in exactly one class`,
      observed: `also listed under ${seen.get(id)}`,
      fix: 'a requirement belongs to exactly one class',
    });
    seen.set(id, id);
  }

  const audit = baseline.sourceAudit;
  if (ctx.expect(Boolean(audit?.path && audit?.sha256), {
    expected: 'the baseline pins its source audit (path + sha256)',
    observed: 'sourceAudit missing',
    fix: 'record which audit produced the classification',
  })) {
    ctx.expect(exists(audit.path), {
      expected: `${audit.path} exists`,
      observed: 'file not found',
      fix: 'restore the audited traceability report',
    });
    if (exists(audit.path)) {
      const observed = sha256(audit.path);
      ctx.expect(observed === audit.sha256, {
        expected: `sha256(${audit.path}) = ${audit.sha256}`,
        observed: `sha256(${audit.path}) = ${observed}`,
        fix: 'the classification came from this audit; re-audit and re-pin rather than edit it silently',
      });
      ctx.note(`classification source: ${audit.path}`);
    }
  }

  const decisions = baseline.unresolvedSection46Decisions ?? [];
  const normalizeDecision = (d) => String(d).trim().replace(/\s+/g, ' ').toLowerCase();
  const normalized = decisions.map(normalizeDecision).sort();
  const expectedDecisions = EXPECTED_SECTION_46_DECISIONS.map(normalizeDecision).sort();
  ctx.expect(
    normalized.length === expectedDecisions.length && normalized.every((d, i) => d === expectedDecisions[i]),
    {
      expected: `the six unresolved §46 decisions remain recorded as unresolved (${expectedDecisions.length})`,
      observed: `${decisions.length} recorded: ${JSON.stringify(decisions)}`,
      fix: '§46 decisions must stay unresolved; the gate records them, it does not resolve them',
    },
  );

  const extra = baseline.additionalBlockedReportingItems ?? [];
  ctx.expect(
    extra.some((item) => /owner booking-report PDF export/i.test(item)),
    {
      expected: 'owner booking-report PDF export (§25.3 / §46-4) recorded as a blocked reporting item',
      observed: JSON.stringify(extra),
      fix: 'keep the blocked reporting item listed',
    },
  );

  ctx.note(`A=${r.implemented} B=${r.deploymentProviderDependent} C=${r.blocked} D=${r.deferred} total=${r.total}`);
});

/* ------------------------------------------------------------------------- *
 * C. Production authentication safety
 * ------------------------------------------------------------------------- */

check('auth-safety', 'Production auth safety', (ctx) => {
  const configPath = 'backend/src/config/app-config.ts';
  const resolverPath = 'backend/src/api/auth/auth-context.ts';
  if (!ctx.expect(exists(configPath) && exists(resolverPath), {
    expected: 'the production auth boundary and config validator exist',
    observed: `missing ${[!exists(configPath) ? configPath : null, !exists(resolverPath) ? resolverPath : null].filter(Boolean).join(', ')}`,
    fix: 'restore the auth boundary',
  })) {
    return;
  }
  const config = readText(configPath);
  const resolver = readText(resolverPath);

  ctx.expect(
    /nodeEnv === 'production' && config\.authTestEnabled/.test(config) &&
      /AUTH_TEST_ENABLED must not be enabled in production/.test(config),
    {
      expected: 'startup rejects AUTH_TEST_ENABLED=true when NODE_ENV=production',
      observed: 'no production guard on authTestEnabled in assertConfigInvariants',
      fix: 'restore the fail-fast production guard in assertConfigInvariants',
    },
  );
  ctx.expect(/config\.nodeEnv === 'production'/.test(resolver) && /never be used in production/.test(resolver), {
    expected: 'TestAuthContextResolver hard-fails its constructor in production',
    observed: 'no production constructor guard',
    fix: 'restore the belt-and-suspenders guard on the test resolver',
  });
  ctx.expect(
    /authTestEnabled && config\.nodeEnv !== 'production'/.test(resolver) &&
      /return new SessionAuthContextResolver\(config, authService\)/.test(resolver),
    {
      expected: "the resolver factory only selects the test bridge when nodeEnv !== 'production', otherwise the server-side session resolver",
      observed: 'resolver factory selection is not guarded by nodeEnv',
      fix: 'restore the factory guard so production always uses SessionAuthContextResolver',
    },
  );

  // The test-actor headers must be read in exactly one production module, so no
  // other module can grow a header-based authentication bypass.
  const headerReaders = sourceFiles('backend/src', ['.ts'])
    .filter((file) => !isTestFile(file))
    .filter((file) => /x-actor-(role|id)/i.test(readText(file)));
  ctx.expect(
    headerReaders.length === 1 && headerReaders[0] === resolverPath,
    {
      expected: 'only backend/src/api/auth/auth-context.ts reads the test actor headers',
      observed: headerReaders.length === 0 ? 'no reader found' : headerReaders.join(', '),
      fix: 'remove the additional test-header authentication path',
    },
  );

  const guardPath = 'backend/src/domain/authorization/tenant-guard.ts';
  if (ctx.expect(exists(guardPath), { expected: guardPath, observed: 'missing', fix: 'restore the tenant guard' })) {
    ctx.expect(/requireOwnedBusiness/.test(readText(guardPath)), {
      expected: 'ownership is enforced in-query (no production localhost/authorization bypass)',
      observed: 'requireOwnedBusiness not found in the tenant guard',
      fix: 'restore the ownership guard',
    });
  }

  // Behavioural coverage must live in the existing suite, not only in source text.
  const behaviourSpec = 'backend/src/api/http-auth.spec.ts';
  ctx.expect(exists(behaviourSpec) && /never be used in production/.test(readText(behaviourSpec)), {
    expected: `${behaviourSpec} covers the production auth-safety behaviour`,
    observed: 'existing regression coverage not found',
    fix: 'restore the existing test; do not rely on the static check alone',
  });
});

/* ------------------------------------------------------------------------- *
 * D. Frontend production API safety
 * ------------------------------------------------------------------------- */

check('frontend-api-safety', 'Frontend API base URL safety', (ctx) => {
  const configPath = 'frontend/src/api/config.ts';
  if (!ctx.expect(exists(configPath), { expected: configPath, observed: 'missing', fix: 'restore the API base URL resolver' })) {
    return;
  }
  const source = readText(configPath);

  const guardIndex = source.indexOf('if (isDev)');
  const fallbackIndex = source.indexOf('return DEVELOPMENT_API_BASE_URL');
  const throwIndex = source.indexOf('throw new Error(');
  ctx.expect(guardIndex !== -1 && throwIndex !== -1 && throwIndex > guardIndex, {
    expected: 'an unset VITE_API_BASE_URL throws outside development instead of falling back',
    observed: 'no dev-gated throw path found in resolveApiBaseUrl',
    fix: 'restore the production throw; never ship a hard-coded localhost API origin',
  });
  ctx.expect(guardIndex !== -1 && fallbackIndex > guardIndex, {
    expected: 'the localhost fallback is reachable only through the development branch',
    observed: 'the development fallback is not inside the isDev branch',
    fix: 'keep DEVELOPMENT_API_BASE_URL behind import.meta.env.DEV',
  });
  ctx.expect(/import\.meta\.env\.VITE_API_BASE_URL/.test(source), {
    expected: 'VITE_API_BASE_URL is the only supported source of the API base URL',
    observed: 'VITE_API_BASE_URL is not read',
    fix: 'restore the VITE_API_BASE_URL source',
  });

  // No production frontend module may hard-code a localhost origin. Type
  // declarations and test seams are not runtime code.
  const offenders = sourceFiles('frontend/src', ['.ts', '.tsx'])
    .filter((file) => !isTestFile(file) && !file.endsWith('.d.ts'))
    .filter((file) => !file.startsWith('frontend/src/test/') && !file.startsWith('frontend/src/mock/'))
    .filter((file) => {
      const body = readText(file);
      return /https?:\/\/(localhost|127\.0\.0\.1)/.test(body) && !file.endsWith('frontend/src/api/config.ts');
    });
  ctx.expect(offenders.length === 0, {
    expected: 'no production frontend module hard-codes a localhost origin',
    observed: offenders.length === 0 ? 'none' : offenders.join(', '),
    fix: 'resolve the API origin from configuration instead of a literal',
  });

  const envExample = 'frontend/.env.example';
  if (ctx.expect(exists(envExample), { expected: envExample, observed: 'missing', fix: 'restore the frontend env template' })) {
    const template = readText(envExample);
    ctx.expect(/VITE_API_BASE_URL=/.test(template), {
      expected: `${envExample} documents VITE_API_BASE_URL`,
      observed: 'not documented',
      fix: 'document the only frontend variable in the template',
    });
  }
});

function isTestFile(file) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/* ------------------------------------------------------------------------- *
 * E. Mock / test provider safety
 * ------------------------------------------------------------------------- */

check('provider-safety', 'Mock / test provider safety', (ctx) => {
  const modulePath = 'backend/src/domain/domain-services.module.ts';
  if (ctx.expect(exists(modulePath), { expected: modulePath, observed: 'missing', fix: 'restore the domain module wiring' })) {
    const wiring = readText(modulePath);
    ctx.expect(
      /provide: EMAIL_PROVIDER,[\s\S]{0,200}?useClass: DisabledEmailProvider/.test(wiring),
      {
        expected: 'EMAIL_PROVIDER is bound to DisabledEmailProvider (no fake payment/email sender is selectable)',
        observed: 'EMAIL_PROVIDER is not bound to DisabledEmailProvider',
        fix: 'no external email provider may be invented; keep the disabled binding until one is approved',
      },
    );
    ctx.expect(
      /config\.telegramEnabled[\s\S]{0,300}?: new DisabledTelegramProvider\(\)/.test(wiring),
      {
        expected: 'TELEGRAM_PROVIDER falls back to DisabledTelegramProvider when the channel is off',
        observed: 'no disabled Telegram fallback in the provider factory',
        fix: 'keep the fail-safe Telegram provider binding',
      },
    );
  }

  const disabled = 'backend/src/domain/notifications/disabled-email-provider.ts';
  if (ctx.expect(exists(disabled), { expected: disabled, observed: 'missing', fix: 'restore the honest email provider stub' })) {
    const source = readText(disabled);
    ctx.expect(/isConfigured\(\)[\s\S]{0,80}?return false/.test(source) && /accepted: false/.test(source), {
      expected: 'DisabledEmailProvider never reports acceptance (no false "delivered")',
      observed: 'the disabled provider does not report isConfigured()=false / accepted:false',
      fix: 'keep the provider incapable of claiming delivery',
    });
  }

  const mockProviders = sourceFiles('backend/src', ['.ts'])
    .filter((file) => !isTestFile(file))
    .filter((file) => /class\s+(Mock|Fake|Stub)\w*(Provider|Transport|Sender)\b/.test(readText(file)));
  ctx.expect(mockProviders.length === 0, {
    expected: 'no mock/fake provider implementation exists in the backend',
    observed: mockProviders.length === 0 ? 'none' : mockProviders.join(', '),
    fix: 'production must not be able to select a mock provider',
  });

  // The accepted demo-only seam stays; every other production mock import fails.
  const mockImporters = sourceFiles('frontend/src', ['.ts', '.tsx'])
    .filter((file) => !file.startsWith('frontend/src/mock/') && !file.startsWith('frontend/src/test/'))
    .filter((file) => !isTestFile(file))
    .map((file) => file.replace(/^frontend\//, ''))
    .filter((file) => /from\s+['"]@\/mock\//.test(readText(`frontend/${file}`)));
  const unexpected = mockImporters.filter((file) => !ACCEPTED_MOCK_SEAMS.includes(file)).sort();
  ctx.expect(unexpected.length === 0, {
    expected: `only the documented branding demo seam imports @/mock/* (${ACCEPTED_MOCK_SEAMS.join(', ')})`,
    observed: unexpected.length === 0 ? 'as expected' : unexpected.join(', '),
    fix: 'route the surface through the real API client; the branding seam is the only accepted exception',
  });

  const seam = 'frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx';
  if (ctx.expect(exists(seam), { expected: seam, observed: 'missing', fix: 'restore the branding editor' })) {
    const source = readText(seam);
    ctx.expect(/saveBranding/.test(source) && /Branding/.test(source), {
      expected: 'the accepted seam stays limited to the branding (logo/cover) editor',
      observed: 'the mock seam is present but not confined to branding',
      fix: 'keep the mock seam confined to branding previews',
    });
  }
});

/* ------------------------------------------------------------------------- *
 * F. Environment documentation contract
 * ------------------------------------------------------------------------- */

check('env-contract', 'Environment documentation contract', (ctx) => {
  const templatePath = 'backend/.env.example';
  if (!ctx.expect(exists(templatePath), { expected: templatePath, observed: 'missing', fix: 'restore the backend env template' })) {
    return;
  }
  const documented = documentedEnvKeys(templatePath);

  for (const [group, names] of Object.entries(REQUIRED_BACKEND_ENV)) {
    const missing = names.filter((name) => !documented.has(name));
    ctx.expect(missing.length === 0, {
      expected: `${templatePath} documents the ${group} variable(s): ${names.join(', ')}`,
      observed: missing.length === 0 ? 'all present' : `missing ${missing.join(', ')}`,
      fix: 'document every variable the application reads',
    });
  }

  // Reverse direction: every variable the code reads must be documented.
  const consumed = new Set();
  for (const file of ['backend/src/config/app-config.ts', ...sourceFiles('backend/scripts', ['.mjs'])]) {
    const body = readText(file);
    for (const m of body.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) consumed.add(m[1]);
    for (const m of body.matchAll(/envOr\('([A-Z][A-Z0-9_]*)'/g)) consumed.add(m[1]);
    for (const m of body.matchAll(/^\s*(PRODUCT_[A-Z0-9_]+):\s*'[A-Z0-9_]+',/gm)) consumed.add(m[1]);
  }
  const undocumented = [...consumed].filter((name) => !documented.has(name)).sort();
  ctx.expect(undocumented.length === 0, {
    expected: 'every environment variable read by the code is documented in backend/.env.example',
    observed: undocumented.length === 0 ? 'no gaps' : `undocumented: ${undocumented.join(', ')}`,
    fix: 'add the missing variable to the template (name only; never a real secret)',
  });

  // No committed provider credentials.
  const leaked = BACKEND_SECRET_VARS.filter((name) => (documented.get(name) ?? '').trim() !== '');
  ctx.expect(leaked.length === 0, {
    expected: `${BACKEND_SECRET_VARS.join(', ')} are present in the template with empty values`,
    observed: leaked.length === 0 ? 'empty' : `${leaked.join(', ')} carries a value`,
    fix: 'never commit credentials; the template documents names only',
  });

  // Frontend: only VITE_-prefixed, documented variables reach the browser bundle.
  const frontendExample = 'frontend/.env.example';
  if (ctx.expect(exists(frontendExample), { expected: frontendExample, observed: 'missing', fix: 'restore the frontend env template' })) {
    const used = new Set();
    for (const file of sourceFiles('frontend/src', ['.ts', '.tsx'])) {
      for (const m of readText(file).matchAll(/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
    }
    const frontendKeys = documentedEnvKeys(frontendExample);
    const undeclared = [...used]
      .filter((name) => !VITE_BUILTIN_ENV.has(name))
      .filter((name) => !frontendKeys.has(name))
      .sort();
    ctx.expect(undeclared.length === 0, {
      expected: 'every VITE_ variable read by the frontend is documented in frontend/.env.example',
      observed: undeclared.length === 0 ? 'no gaps' : `undeclared: ${undeclared.join(', ')}`,
      fix: 'document the variable, or stop reading it',
    });
    const nonPublic = [...frontendKeys.keys()].filter((name) => !name.startsWith('VITE_'));
    ctx.expect(nonPublic.length === 0, {
      expected: 'frontend/.env.example contains only VITE_-prefixed (public) names',
      observed: nonPublic.length === 0 ? 'ok' : nonPublic.join(', '),
      fix: 'a non-VITE_ name in the browser template risks shipping a secret',
    });
  }

  // Real environment files stay ignored.
  for (const ignorePath of ['.gitignore', 'backend/.gitignore']) {
    if (ctx.expect(exists(ignorePath), { expected: ignorePath, observed: 'missing', fix: 'restore the ignore file' })) {
      ctx.expect(/(^|\n)\.env(\n|$)/.test(readText(ignorePath)), {
        expected: `${ignorePath} ignores .env`,
        observed: 'no .env entry',
        fix: 'real environment files must never be committed',
      });
    }
  }
  ctx.note(`${documented.size} backend variables documented`);
});

/* ------------------------------------------------------------------------- *
 * H. Database release safety
 * ------------------------------------------------------------------------- */

check('db-safety', 'Database release safety', (ctx) => {
  const migrationsDir = 'backend/prisma/migrations';
  if (ctx.expect(exists(migrationsDir), { expected: `${migrationsDir} exists`, observed: 'missing', fix: 'restore the migrations' })) {
    ctx.expect(exists(join(migrationsDir, 'migration_lock.toml')), {
      expected: 'prisma/migrations/migration_lock.toml exists',
      observed: 'missing',
      fix: 'restore the migration lock file',
    });
    const migrations = readdirSync(abs(migrationsDir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const withoutSql = migrations.filter((name) => !exists(join(migrationsDir, name, 'migration.sql')));
    ctx.expect(migrations.length > 0 && withoutSql.length === 0, {
      expected: 'every committed migration directory contains a migration.sql',
      observed: withoutSql.length === 0 ? `${migrations.length} migrations` : `incomplete: ${withoutSql.join(', ')}`,
      fix: 'restore the committed migration files',
    });
  }

  const pkg = JSON.parse(readText('backend/package.json'));
  const scripts = pkg.scripts ?? {};
  ctx.expect(/prisma-migrate\.mjs deploy$/.test(scripts['prisma:deploy'] ?? ''), {
    expected: 'a `prisma:deploy` script applies committed migrations only',
    observed: `prisma:deploy = ${scripts['prisma:deploy'] ?? '(absent)'}`,
    fix: 'restore the deploy migration command',
  });
  ctx.expect(/run-db-tests\.mjs$/.test(scripts['test:db'] ?? ''), {
    expected: 'a `test:db` script gates the DB suite',
    observed: `test:db = ${scripts['test:db'] ?? '(absent)'}`,
    fix: 'restore the DB test runner',
  });

  const migratorScript = 'backend/scripts/prisma-migrate.mjs';
  if (ctx.expect(exists(migratorScript), { expected: migratorScript, observed: 'missing', fix: 'restore the migration wrapper' })) {
    const source = readText(migratorScript);
    ctx.expect(/MIGRATOR_DATABASE_URL/.test(source) && /process\.env\.DATABASE_URL = migratorUrl/.test(source), {
      expected: 'migrations always run as the migrator role (DDL owner), never the runtime app role',
      observed: 'the migration wrapper does not pin DATABASE_URL to the migrator role',
      fix: 'restore the migrator-role pinning',
    });
  }

  // Ordinary application startup must not replace the migration process.
  const startupMigration = sourceFiles('backend/src', ['.ts'])
    .filter((file) => !isTestFile(file))
    .filter((file) => /prisma\s+migrate|migrate\s+deploy|execSync\([^)]*prisma|spawnSync\([^)]*prisma/.test(readText(file)));
  ctx.expect(startupMigration.length === 0, {
    expected: 'no backend application source runs migrations at startup',
    observed: startupMigration.length === 0 ? 'none' : startupMigration.join(', '),
    fix: 'run migrations separately via prisma:deploy before rolling out the app',
  });

  // Test DB gating must remain intact.
  const dbSpecs = sourceFiles('backend/src', ['.ts']).filter((file) => file.endsWith('.db.spec.ts'));
  ctx.expect(dbSpecs.length > 0, {
    expected: 'DB-gated spec files exist',
    observed: 'none found',
    fix: 'restore the DB integration suite',
  });
  const ungated = dbSpecs.filter((file) => {
    const body = readText(file);
    return !/RUN_DB_TESTS/.test(body) || !/TEST_DATABASE_URL/.test(body);
  });
  ctx.expect(ungated.length === 0, {
    expected: 'every *.db.spec.ts is gated by RUN_DB_TESTS + TEST_DATABASE_URL',
    observed: ungated.length === 0 ? `all ${dbSpecs.length} gated` : ungated.join(', '),
    fix: 'restore the DB test gate so the suite never touches a non-test database',
  });
  const runner = 'backend/scripts/run-db-tests.mjs';
  ctx.expect(exists(runner) && /RUN_DB_TESTS: 'true'/.test(readText(runner)), {
    expected: 'run-db-tests.mjs sets RUN_DB_TESTS=true for the DB suite',
    observed: 'the runner does not set the gate',
    fix: 'restore the DB gate in the runner',
  });
  ctx.note(`${dbSpecs.length} DB-gated spec files`);
});

/* ------------------------------------------------------------------------- *
 * I. Worker / outbox safety
 * ------------------------------------------------------------------------- */

check('worker-outbox', 'Worker / outbox safety', (ctx) => {
  const timers = sourceFiles('backend/src', ['.ts'])
    .filter((file) => /setInterval\(/.test(readText(file)))
    .sort();
  const expected = EXPECTED_WORKERS.map((f) => `backend/${f}`).sort();
  ctx.expect(
    timers.length === expected.length && timers.every((file, i) => file === expected[i]),
    {
      expected: `exactly the two in-process workers exist and own the only sweep timers (${EXPECTED_WORKERS.join(', ')})`,
      observed: timers.length === 0 ? 'no timer found' : timers.join(', '),
      fix: 'no second worker or scheduler may be added; fold new duties into the existing workers',
    },
  );

  for (const file of EXPECTED_WORKERS) {
    const path = `backend/${file}`;
    if (!ctx.expect(exists(path), { expected: path, observed: 'missing', fix: 'restore the worker' })) continue;
    const source = readText(path);
    const bootstrap = source.slice(source.indexOf('onApplicationBootstrap'));
    const gate = bootstrap.indexOf('return;');
    ctx.expect(bootstrap.indexOf('setInterval(') > gate && gate !== -1, {
      expected: `${path} returns before arming its timer when disabled (tests / channel off)`,
      observed: 'no early-return guard before setInterval',
      fix: 'restore the disabled guard so tests and disabled channels never arm a sweep',
    });
    ctx.expect(/\.unref\?\.\(\)/.test(source), {
      expected: `${path} uses an unref'd timer so it never keeps the process alive`,
      observed: 'no unref on the interval',
      fix: 'restore timer.unref()',
    });
    const destroy = source.slice(source.indexOf('onModuleDestroy'));
    ctx.expect(/clearInterval\(/.test(destroy), {
      expected: `${path} clears its timer on shutdown`,
      observed: 'onModuleDestroy does not clear the interval',
      fix: 'restore clearInterval in onModuleDestroy',
    });
  }

  const workerSpec = 'backend/src/domain/services/business-lifecycle.worker.spec.ts';
  ctx.expect(exists(workerSpec), {
    expected: `${workerSpec} exercises the lifecycle worker`,
    observed: 'missing',
    fix: 'restore the existing worker test',
  });

  const schemaPath = 'backend/prisma/schema.prisma';
  if (ctx.expect(exists(schemaPath), { expected: schemaPath, observed: 'missing', fix: 'restore the Prisma schema' })) {
    const delivery = /model NotificationDelivery \{[\s\S]*?\n\}/.exec(readText(schemaPath));
    ctx.expect(Boolean(delivery) && /idempotencyKey\s+String[\s\S]*?@unique/.test(delivery?.[0] ?? ''), {
      expected: 'NotificationDelivery.idempotencyKey is unique (outbox idempotency)',
      observed: delivery ? 'idempotencyKey is not unique' : 'NotificationDelivery model not found',
      fix: 'restore the outbox idempotency constraint',
    });
  }

  const deliveryService = 'backend/src/domain/notifications/notification-delivery.service.ts';
  if (ctx.expect(exists(deliveryService), { expected: deliveryService, observed: 'missing', fix: 'restore the delivery service' })) {
    const source = readText(deliveryService);
    ctx.expect(/reclaimStale/.test(source) && /STALE_SENDING_MS/.test(source) && /state: 'SENDING'/.test(source), {
      expected: 'stale SENDING deliveries are reclaimed',
      observed: 'no stale SENDING recovery',
      fix: 'restore stale-SENDING recovery',
    });
    ctx.expect(/DEAD_LETTERED/.test(source) && /telegramDeliveryMaxAttempts/.test(source), {
      expected: 'deliveries are dead-lettered at the bounded attempt cap',
      observed: 'no dead-letter path',
      fix: 'restore the dead-letter behavior',
    });
  }
});

/* ------------------------------------------------------------------------- *
 * J. Secret / logging safety
 * ------------------------------------------------------------------------- */

check('log-safety', 'Secret / logging safety', (ctx) => {
  const factoryPath = 'backend/src/common/logging/pino.factory.ts';
  if (ctx.expect(exists(factoryPath), { expected: factoryPath, observed: 'missing', fix: 'restore the logging factory' })) {
    const source = readText(factoryPath);
    const redact = /export const REDACT_PATHS = \[([\s\S]*?)\];/.exec(source);
    const required = [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.passwordHash',
      'req.body.sessionToken',
      'req.body.token',
      'res.headers["set-cookie"]',
    ];
    const declared = new Set(
      [...(redact?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );
    const missing = required.filter((path) => !declared.has(path));
    ctx.expect(missing.length === 0, {
      expected: `pino REDACT_PATHS covers ${required.join(', ')}`,
      observed: missing.length === 0 ? 'all present' : `not redacted: ${missing.join(', ')}`,
      fix: 'restore the redaction paths; secrets must never reach the log stream',
    });
  }

  // Prefer the repository's existing redaction tests over a new global scanner.
  const redactionSpec = 'backend/src/common/logging/pino.factory.spec.ts';
  ctx.expect(exists(redactionSpec), {
    expected: `${redactionSpec} (existing targeted redaction test) is present`,
    observed: 'missing',
    fix: 'restore the existing redaction test rather than adding a brittle global scanner',
  });

  // Config validation reports field names only — never interpolated values.
  const configPath = 'backend/src/config/app-config.ts';
  if (ctx.expect(exists(configPath), { expected: configPath, observed: 'missing', fix: 'restore the config validator' })) {
    const source = readText(configPath);
    const invariants = /export function assertConfigInvariants[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    ctx.expect(!invariants.includes('${'), {
      expected: 'assertConfigInvariants reports literal messages only (no value interpolation)',
      observed: 'a template literal interpolates a value into the validation error',
      fix: 'report field names, never values',
    });
  }

  // Targeted: no log call may carry a known secret value on the same line.
  const offenders = [];
  for (const file of sourceFiles('backend/src', ['.ts'])) {
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\b(this\.)?(logger|log|console)\s*\.?\s*(trace|debug|info|warn|error|fatal|log)\s*\(/.test(line)) return;
      if (NEVER_LOGGED_IDENTIFIERS.some((id) => line.includes(id))) offenders.push(`${file}:${i + 1}`);
    });
  }
  ctx.expect(offenders.length === 0, {
    expected: `no log call passes ${NEVER_LOGGED_IDENTIFIERS.join('/')} to the logger`,
    observed: offenders.length === 0 ? 'none' : offenders.join(', '),
    fix: 'log a message or an error name; never a token, hash or session value',
  });
});

/* ------------------------------------------------------------------------- *
 * K. Forbidden-regression guards
 * ------------------------------------------------------------------------- */

check('forbidden-regression', 'Forbidden-regression guards', (ctx) => {
  const baseline = loadBaseline(ctx);
  if (!baseline) return;
  const r = baseline.requirements;
  const guards = baseline.forbiddenRegressionGuards;
  if (!ctx.expect(Boolean(r && guards?.mustNotBeImplemented), {
    expected: 'forbiddenRegressionGuards.mustNotBeImplemented is declared',
    observed: 'absent from the baseline',
    fix: 'restore the guard list',
  })) {
    return;
  }

  const classified = new Map();
  for (const [label, ids] of [
    ['deployment/provider-dependent', r.deploymentProviderDependentIds],
    ['blocked', r.blockedIds],
    ['deferred', r.deferredIds],
  ]) {
    for (const id of ids) classified.set(id, label);
  }

  const misclassified = (guards.mustNotBeImplemented ?? []).filter((id) => !classified.has(id));
  ctx.expect(misclassified.length === 0, {
    expected: 'every guarded requirement stays in blocked / deferred / deployment-dependent (never implemented)',
    observed: misclassified.length === 0 ? 'all guarded' : `claimed implemented: ${misclassified.join(', ')}`,
    fix: 'these requirements must not be reported as implemented; resolve the open decision first',
  });

  // The owner booking-report PDF export must stay an unimplemented §46 item.
  const pdfKey = 'PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED';
  const configSource = exists('backend/src/config/app-config.ts') ? readText('backend/src/config/app-config.ts') : '';
  ctx.expect(/ownerBookingReportPdfEnabled: z\.boolean\(\)\.nullable\(\)\.default\(null\)/.test(configSource), {
    expected: `${pdfKey} stays nullable with a null default (not silently enabled)`,
    observed: 'the owner booking-report PDF parameter is not nullable/null by default',
    fix: '§46 item 4 is unresolved; expose the boundary without enabling it',
  });
  const envKeys = exists('backend/.env.example') ? documentedEnvKeys('backend/.env.example') : new Map();
  ctx.expect(envKeys.has(pdfKey) && (envKeys.get(pdfKey) ?? '').trim() === '', {
    expected: `${pdfKey} is documented in backend/.env.example with an empty value`,
    observed: envKeys.has(pdfKey) ? `documented with value "${envKeys.get(pdfKey)}"` : 'not documented',
    fix: 'document the parameter name only; never invent the product decision',
  });

  // Phase-2 2FA must not have been added (REQ-034 is deferred by design).
  const twoFactor = sourceFiles('backend/src', ['.ts']).filter((file) => /\b(2fa|twoFactor|totp)\b/i.test(readText(file)));
  ctx.expect(twoFactor.length === 0, {
    expected: 'no Phase-2 2FA implementation exists (REQ-034 is deferred by design)',
    observed: twoFactor.length === 0 ? 'none' : twoFactor.join(', '),
    fix: '2FA is out of Phase 1; do not implement it speculatively',
  });

  ctx.note(`${(guards.mustNotBeImplemented ?? []).length} guarded requirement ids, none claimed implemented`);
});

/* ------------------------------------------------------------------------- *
 * Command stages — the existing, already-trusted release gates
 * ------------------------------------------------------------------------- */

const COMMAND_STAGES = [
  { id: 'backend-test', title: 'Backend tests', cwd: 'backend', args: ['run', 'test'] },
  { id: 'backend-test-db', title: 'Backend DB tests', cwd: 'backend', args: ['run', 'test:db'] },
  { id: 'frontend-test', title: 'Frontend tests', cwd: 'frontend', args: ['run', 'test'] },
  { id: 'backend-typecheck', title: 'Backend typecheck', cwd: 'backend', args: ['run', 'typecheck'] },
  { id: 'backend-lint', title: 'Backend lint', cwd: 'backend', args: ['run', 'lint'] },
  { id: 'backend-build', title: 'Backend build', cwd: 'backend', args: ['run', 'build'] },
  { id: 'frontend-typecheck', title: 'Frontend typecheck', cwd: 'frontend', args: ['run', 'typecheck'] },
  { id: 'frontend-lint', title: 'Frontend lint', cwd: 'frontend', args: ['run', 'lint'] },
  { id: 'frontend-build', title: 'Frontend build', cwd: 'frontend', args: ['run', 'build'] },
];

function runStage(stage) {
  const started = Date.now();
  const command = `npm ${stage.args.join(' ')}`;
  // A single command string under `shell: true` keeps Windows-safe npm.cmd
  // resolution (the same approach as backend/scripts/run-db-tests.mjs) and
  // avoids Node's DEP0190 warning about unescaped args.
  const result = spawnSync(command, {
    cwd: abs(stage.cwd),
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) {
    return { ok: true, detail: `${stage.cwd}/ ${command} (${duration}s)` };
  }
  const tail = output.trimEnd().split(/\r?\n/).slice(-25).join('\n');
  return {
    ok: false,
    detail: `${stage.cwd}/ ${command} exited ${result.status ?? 'signal'}`,
    failures: [
      {
        expected: `\`${command}\` exits 0 in ${stage.cwd}/`,
        observed: tail,
        fix: 'this is an existing, unchanged release gate — fix the regression it reports; do not weaken the gate',
      },
    ],
  };
}

/* ------------------------------------------------------------------------- *
 * Orchestration
 * ------------------------------------------------------------------------- */

function report(entries) {
  const failed = entries.filter((e) => !e.ok);
  process.stdout.write('Werefa Acceptance Gate\n');
  process.stdout.write('======================\n\n');
  for (const entry of entries) {
    process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.title}\n`);
    if (entry.ok) {
      if (entry.detail) process.stdout.write(`        ${entry.detail}\n`);
      continue;
    }
    for (const failure of entry.failures) {
      process.stdout.write(`        expected: ${failure.expected}\n`);
      process.stdout.write(`        observed: ${failure.observed}\n`);
      if (failure.fix) process.stdout.write(`        fix:      ${failure.fix}\n`);
    }
  }
  process.stdout.write('\n');
  process.stdout.write(
    failed.length === 0
      ? 'ACCEPTANCE GATE: PASS\n'
      : `ACCEPTANCE GATE: FAIL (${failed.length} of ${entries.length} checks failed)\n`,
  );
  return failed.length === 0 ? 0 : 1;
}

function main() {
  const entries = [];
  process.stdout.write(`Werefa Acceptance Gate (${STATIC_ONLY ? 'static checks only' : 'static checks + release gates'})\n\n`);

  for (const { id, title, run } of CHECKS) {
    const ctx = new CheckContext(id, title);
    let thrown = null;
    try {
      run(ctx);
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }
    if (thrown) {
      ctx.failures.push({
        expected: 'the check runs to completion',
        observed: thrown,
        fix: 'the check itself is broken or a required file is unreadable',
      });
    }
    entries.push({ id, title, ok: ctx.failures.length === 0, detail: ctx.notes.join('; '), failures: ctx.failures });
  }

  if (!STATIC_ONLY) {
    for (const stage of COMMAND_STAGES) {
      const outcome = runStage(stage);
      entries.push({ id: stage.id, title: stage.title, ...outcome });
    }
  }

  process.exitCode = report(entries);
}

main();
