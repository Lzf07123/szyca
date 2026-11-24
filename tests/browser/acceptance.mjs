import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import axe from 'axe-core'

const BASE = process.env.BASE_URL || 'http://localhost:8091'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'owner'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'integrity-test'
const ARTIFACTS = process.env.ARTIFACT_DIR || '/artifacts/browser'
const BROWSER_EXECUTABLE_PATH = process.env.BROWSER_EXECUTABLE_PATH || ''
const widths = [320, 360, 390, 414, 480, 600, 768, 820, 900, 1024, 1180, 1280, 1440, 1920]
const errors = []
const moduleCatalog = JSON.parse(await fs.readFile(
  new URL('../../frontend/src/generated/module-catalog.generated.json', import.meta.url),
  'utf8',
))
const sectionLayouts = new Map(moduleCatalog.modules.flatMap((module) => (
  module.sections.map((section) => [`${section.key}@${section.version}`, section.layout])
)))
const fullscreenRoutes = new Set(moduleCatalog.modules.flatMap((module) => (
  module.routes.filter((route) => route.fullscreen).map((route) => route.path)
)))

async function loadModuleScenarios() {
  const scenarios = []
  for (const module of moduleCatalog.modules) {
    const testURL = new URL(`../../modules/${module.key}/tests/browser.mjs`, import.meta.url)
    const facet = await import(`${testURL.href}?v=${Date.now()}`)
    scenarios.push(...(facet.scenarios ?? []))
  }
  return scenarios
}

await fs.mkdir(`${ARTIFACTS}/screenshots`, { recursive: true })

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function api(path, { method = 'GET', body, csrf = '', cookie = '' } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Origin: BASE,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let payload = text
  try {
    payload = JSON.parse(text)
  } catch {
    // CSV and empty responses stay as text.
  }
  return { status: response.status, payload, headers: response.headers }
}

async function loginApi() {
  const response = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  })
  expect(response.status === 200, `admin API login failed: ${response.status} ${JSON.stringify(response.payload)}`)
  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ')
  return { cookie, csrf: response.payload.csrf_token }
}

async function setLottery(admin, enabled) {
  const response = await api('/api/admin/platform/features', {
    method: 'PUT',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { features: [{ key: 'lottery', enabled, config: {} }] },
  })
  expect(response.status === 200, `set lottery feature failed: ${JSON.stringify(response.payload)}`)
}

async function setLotterySection(admin, enabled) {
  const current = await api('/api/admin/site/sections', { cookie: admin.cookie })
  expect(current.status === 200, 'could not read site sections')
  const lotteryKinds = new Set(['lottery', 'lottery-participate'])
  const sections = current.payload.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    plugin_version: section.plugin_version || 1,
    enabled: lotteryKinds.has(section.kind) ? enabled : section.enabled,
    sort: section.sort,
    starts_at: section.starts_at || null,
    ends_at: section.ends_at || null,
    config: section.config,
    status: section.status,
  }))
  const response = await api('/api/admin/site/sections', {
    method: 'PUT',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { sections },
  })
  expect(response.status === 200, `set lottery section failed: ${JSON.stringify(response.payload)}`)
  return sections
    .filter((section) => lotteryKinds.has(section.kind))
    .every((section) => section.enabled === enabled)
}

async function expectedHomeModuleCount() {
  const site = await api('/api/site')
  expect(site.status === 200, `could not read public site: ${site.status}`)
  return site.payload.sections.filter((section) => (
    section.enabled
    && section.status === 'published'
    && sectionLayouts.get(`${section.kind}@${section.plugin_version || 1}`) === 'module-card'
  )).length
}

async function ensureCampaign(admin) {
  const now = Date.now()
  const created = await api('/api/admin/lottery/campaigns', {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      name: `浏览器验收活动-${Math.random().toString(16).slice(2, 8)}`,
      status: 'active',
      starts_at: new Date(now - 60_000).toISOString(),
      ends_at: new Date(now + 3_600_000).toISOString(),
      eligibility: 'completed_round',
      eligibility_min_score: 0,
      no_win_weight: 100,
      enabled: true,
    },
  })
  expect(created.status === 200, `create campaign failed: ${JSON.stringify(created.payload)}`)
  const campaign = created.payload.campaign
  const prize = await api(`/api/admin/lottery/campaigns/${campaign.id}/prizes`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      name: '协会周边礼包',
      total: 20,
      remaining: 20,
      weight: 1,
      enabled: true,
      sort: 10,
    },
  })
  expect(prize.status === 200, `create prize failed: ${JSON.stringify(prize.payload)}`)
  return campaign.id
}

async function setLotteryModes(admin, { screen, personal }) {
  const response = await api('/api/admin/lottery/modes', {
    method: 'PUT',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { screen_enabled: screen, personal_enabled: personal },
  })
  expect(response.status === 200, `set lottery modes failed: ${JSON.stringify(response.payload)}`)
}

async function ensureNumberEvent(admin) {
  const listed = await api('/api/admin/lottery/number-events', { cookie: admin.cookie })
  expect(listed.status === 200, `list number events failed: ${JSON.stringify(listed.payload)}`)
  for (const event of listed.payload.events) {
    if (event.status === 'live') {
      const archived = await api(`/api/admin/lottery/number-events/${event.id}/archive`, {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
      })
      expect(archived.status === 200, `archive old number event failed: ${JSON.stringify(archived.payload)}`)
    }
  }
  const created = await api('/api/admin/lottery/number-events', {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      name: `浏览器号码场次-${Math.random().toString(16).slice(2, 8)}`,
      range_start: '1',
      range_end: '30',
      number_width: 3,
      levels: [
        { name: '三等奖', winner_count: 5 },
        { name: '二等奖', winner_count: 3 },
        { name: '一等奖', winner_count: 1 },
      ],
    },
  })
  expect(created.status === 200, `create number event failed: ${JSON.stringify(created.payload)}`)
  const published = await api(`/api/admin/lottery/number-events/${created.payload.event.id}/publish`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
  })
  expect(published.status === 200, `publish number event failed: ${JSON.stringify(published.payload)}`)
  const firstLevel = published.payload.levels[0]
  const secondLevel = published.payload.levels[1]
  const thirdLevel = published.payload.levels[2]
  const firstDraw = await api(`/api/admin/lottery/number-events/${created.payload.event.id}/draw`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { level_id: firstLevel.id, request_id: randomUUID() },
  })
  expect(firstDraw.status === 200, `draw first number level failed: ${JSON.stringify(firstDraw.payload)}`)
  const switchName = `浏览器切换场次-${Math.random().toString(16).slice(2, 8)}`
  const switchDraft = await api('/api/admin/lottery/number-events', {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      name: switchName,
      range_start: '1',
      range_end: '50',
      number_width: 2,
      levels: [{ name: '一等奖', winner_count: 1 }],
    },
  })
  expect(switchDraft.status === 200, `create switch draft event failed: ${JSON.stringify(switchDraft.payload)}`)
  return {
    id: created.payload.event.id,
    name: created.payload.event.name,
    secondLevelID: secondLevel.id,
    thirdLevelID: thirdLevel.id,
    switchDraftID: switchDraft.payload.event.id,
    switchName,
  }
}

async function ensureOverflowNumberEvent(admin) {
  const created = await api('/api/admin/lottery/number-events', {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      name: `浏览器百人中奖-${Math.random().toString(16).slice(2, 8)}`,
      range_start: '1',
      range_end: '100',
      number_width: 3,
      levels: [{ name: '三等奖', winner_count: 100 }],
    },
  })
  expect(created.status === 200, `create overflow number event failed: ${JSON.stringify(created.payload)}`)
  const eventID = created.payload.event.id
  const published = await api(`/api/admin/lottery/number-events/${eventID}/publish`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
  })
  expect(published.status === 200, `publish overflow number event failed: ${JSON.stringify(published.payload)}`)
  const drawn = await api(`/api/admin/lottery/number-events/${eventID}/draw`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { level_id: published.payload.levels[0].id, request_id: randomUUID() },
  })
  expect(drawn.status === 200, `draw overflow number event failed: ${JSON.stringify(drawn.payload)}`)
  return eventID
}

async function drawNumberLevel(admin, eventID, levelID) {
  const response = await api(`/api/admin/lottery/number-events/${eventID}/draw`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { level_id: levelID, request_id: randomUUID() },
  })
  expect(response.status === 200, `draw number level failed: ${JSON.stringify(response.payload)}`)
}

async function attachDiagnostics(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: console ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: pageerror ${error.message}`))
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(metrics.scrollWidth <= metrics.innerWidth, `${label}: horizontal overflow ${JSON.stringify(metrics)}`)
}

async function assertTouchTargets(page, label) {
  const small = await page.evaluate(() => {
    const selectors = '.public-topbar a, .public-topbar button, .nav-toggle, .btn, .text-link, .module-card a, .footer-links a'
    return Array.from(document.querySelectorAll(selectors))
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { text: element.textContent?.trim().slice(0, 30), width: rect.width, height: rect.height }
      })
      .filter((item) => item.width < 44 || item.height < 44)
  })
  expect(small.length === 0, `${label}: undersized targets ${JSON.stringify(small)}`)
}

async function assertReadableText(page, label) {
  const issues = await page.evaluate(() => {
    const selectors = [
      '.hero-copy',
      '.hero-title-line',
      '.whoami-grid',
      '.modules-heading',
      '.module-card',
      '.module-copy h3',
      '.home-section h2',
      '.section-heading > div',
      '.action-section > div',
      '.activity-card',
      '.join-head',
      '.lottery-copy',
      '.public-footer .footer-brand',
      '.lottery-card',
      '.lottery-screen-titlebar',
      '.lottery-result-level',
      '.quiz-wrap',
      '.state-page h1',
      '.screen-head',
      '.srow',
      '.admin-top',
      '.panel-head',
      '.number-event-item',
    ]
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const text = element.textContent?.trim() ?? ''
        return {
          selector: element.className || element.tagName.toLowerCase(),
          text: text.slice(0, 40),
          width: Math.round(rect.width),
          writingMode: style.writingMode,
          wordBreak: style.wordBreak,
          clipped: ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2,
          narrowText: text.length > 12 && rect.width < 160,
        }
      })
      .filter((item) =>
        item.writingMode !== 'horizontal-tb'
        || item.wordBreak === 'break-all'
        || item.clipped
        || item.narrowText
      )
  })
  expect(issues.length === 0, `${label}: distorted text ${JSON.stringify(issues)}`)
}

async function assertFramedChrome(page, label) {
  const chrome = await page.evaluate(() => {
    const header = document.querySelector('.public-topbar')
    const footer = document.querySelector('.public-footer')
    const main = document.querySelector('main')
    if (!header || !footer || !main) return null
    const headerStyle = getComputedStyle(header)
    const footerStyle = getComputedStyle(footer)
    const headerRect = header.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    return {
      viewport: window.innerWidth,
      header: {
        top: Math.round(headerRect.top),
        bottom: Math.round(headerRect.bottom),
        height: Math.round(headerRect.height),
        left: Math.round(headerRect.left),
        right: Math.round(headerRect.right),
        radius: parseFloat(headerStyle.borderTopLeftRadius),
        position: headerStyle.position,
        backdrop: headerStyle.backdropFilter,
        borderWidth: parseFloat(headerStyle.borderBottomWidth),
      },
      footer: {
        top: Math.round(footerRect.top),
        height: Math.round(footerRect.height),
        left: Math.round(footerRect.left),
        right: Math.round(footerRect.right),
        radius: parseFloat(footerStyle.borderTopLeftRadius),
        backdrop: footerStyle.backdropFilter,
        borderWidth: parseFloat(footerStyle.borderTopWidth),
      },
      main: {
        top: Math.round(mainRect.top),
        bottom: Math.round(mainRect.bottom),
      },
    }
  })
  if (!chrome) return
  expect(chrome.header.position === 'sticky', `${label}: header is not sticky`)
  expect(chrome.header.top === 0, `${label}: sticky header does not sit at viewport top`)
  expect(chrome.header.left <= 1 && chrome.header.right >= chrome.viewport - 1, `${label}: header is not full width`)
  expect(chrome.footer.left <= 1 && chrome.footer.right >= chrome.viewport - 1, `${label}: footer is not full width`)
  expect(chrome.header.radius <= 1 && chrome.footer.radius <= 1, `${label}: chrome uses floating-card corners`)
  expect(chrome.header.height <= 72, `${label}: header is too tall (${chrome.header.height}px)`)
  expect(chrome.header.borderWidth <= 1 && chrome.footer.borderWidth <= 1, `${label}: chrome has a hard divider`)
  expect(chrome.header.backdrop === 'none', `${label}: header must not blur the page background`)
  expect(chrome.footer.backdrop.includes('blur'), `${label}: footer is missing frosted blur`)
  const maxFooterHeight = chrome.viewport <= 820 ? 170 : chrome.viewport <= 1023 ? 118 : 96
  expect(chrome.footer.height <= maxFooterHeight, `${label}: footer is too tall (${chrome.footer.height}px)`)
  expect(chrome.main.top >= chrome.header.bottom - 1, `${label}: header overlaps main content`)
  expect(chrome.footer.top >= chrome.main.bottom - 1, `${label}: footer overlaps main content`)
}

async function assertCosmosHome(page, label, expectedModuleCount) {
  const cosmos = await page.evaluate(() => {
    const canvas = document.querySelector('.cosmic-canvas')
    const grid = document.querySelector('.cosmic-grid')
    const logo = document.querySelector('.logo-mark')
    const moduleGrid = document.querySelector('.module-grid')
    const orbit = document.querySelector('.signal-orbit')
    const orbitStyle = getComputedStyle(orbit)
    return {
      canvas: canvas instanceof HTMLCanvasElement,
      nodes: canvas?.getAttribute('data-nodes'),
      linkDistance: canvas?.getAttribute('data-link-distance'),
      gravityDistance: canvas?.getAttribute('data-gravity-distance'),
      gridSize: getComputedStyle(grid).backgroundSize,
      logoTransform: getComputedStyle(logo, '::before').transform,
      logoGradient: getComputedStyle(logo, '::before').backgroundImage,
      hasUploadedLogo: Boolean(logo.querySelector('img')),
      moduleCount: document.querySelectorAll('.module-card').length,
      moduleColumns: getComputedStyle(moduleGrid).gridTemplateColumns
        .split(' ')
        .filter((column) => Number.parseFloat(column) > 0)
        .length,
      bootCommand: document.querySelector('.boot-command')?.textContent ?? '',
      terminalText: document.querySelector('.terminal-card')?.textContent ?? '',
      footerText: document.querySelector('.footer-terminal')?.textContent ?? '',
      orbitBackground: orbitStyle.backgroundImage,
      orbitShadow: orbitStyle.boxShadow,
      notoReady: document.fonts.check('300 40px "Noto Sans SC Variable"'),
      displayReady: document.fonts.check('400 20px "Space Grotesk Variable"'),
      monoReady: document.fonts.check('400 12px "JetBrains Mono Variable"'),
    }
  })
  expect(cosmos.canvas, `${label}: particle canvas missing`)
  expect(cosmos.nodes === '90', `${label}: expected 90 particles, got ${cosmos.nodes}`)
  expect(cosmos.linkDistance === '110', `${label}: expected 110px links, got ${cosmos.linkDistance}`)
  expect(cosmos.gravityDistance === '190', `${label}: missing pointer gravity contract`)
  expect(cosmos.gridSize.includes('56px'), `${label}: 56px grid missing (${cosmos.gridSize})`)
  expect(cosmos.hasUploadedLogo || cosmos.logoTransform !== 'none', `${label}: logo mark missing`)
  expect(cosmos.hasUploadedLogo || cosmos.logoGradient.includes('conic-gradient'), `${label}: fallback logo gradient missing`)
  const viewportWidth = page.viewportSize().width
  const expectedColumns = viewportWidth <= 820
    ? 1
    : expectedModuleCount >= 4 && viewportWidth >= 1280
      ? 4
      : expectedModuleCount >= 3 && viewportWidth >= 1024
        ? 3
        : 2
  expect(cosmos.moduleCount === expectedModuleCount, `${label}: expected ${expectedModuleCount} core modules, got ${cosmos.moduleCount}`)
  expect(cosmos.moduleColumns === expectedColumns, `${label}: expected ${expectedColumns} module columns, got ${cosmos.moduleColumns}`)
  expect(cosmos.bootCommand.includes('boot nebula_os') && cosmos.bootCommand.includes('[OK]'), `${label}: boot line missing`)
  expect(cosmos.terminalText.includes('computer_association'), `${label}: terminal identity missing`)
  expect(cosmos.footerText.includes('EOF') && cosmos.footerText.includes('感谢阅读到底部'), `${label}: EOF footer missing`)
  expect(cosmos.notoReady && cosmos.displayReady && cosmos.monoReady, `${label}: required variable fonts did not load`)
  expect(cosmos.orbitBackground.includes('conic-gradient'), `${label}: orbit arc styling missing`)
  expect(!cosmos.orbitBackground.includes('radial-gradient'), `${label}: orbit still has an inner circular fill`)
  expect(cosmos.orbitShadow === 'none', `${label}: orbit still has a circular shadow`)
}

async function revealForScreenshot(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-reveal]').forEach((element) => {
      element.style.setProperty('--reveal-delay', '0ms')
      element.style.transition = 'none'
      element.classList.add('is-revealed')
    })
  })
  await page.waitForTimeout(50)
}

async function assertRuntimeAndBrandAssets(page, label) {
  const state = await page.evaluate(async () => {
    const response = await fetch('/api/runtime', { cache: 'no-store' })
    const runtime = await response.json()
    const headerLogo = document.querySelector('.logo-mark img')
    const footerLogo = document.querySelector('.footer-mark img')
    const orbitHasLogo = Boolean(document.querySelector('.signal-orbit img, .signal-orbit .orbit-logo'))
    const orbitText = document.querySelector('.signal-orbit')?.textContent?.trim() ?? ''
    const uptime = document.querySelector('.hero-facts div:nth-child(3) dt')?.textContent?.trim() ?? ''
    const uptimeLabel = document.querySelector('.hero-facts div:nth-child(3) dd')?.textContent?.trim() ?? ''
    const logoStyle = headerLogo ? getComputedStyle(headerLogo) : null
    return {
      runtimeStatus: response.status,
      uptimeSeconds: runtime.uptime_seconds,
      startedAt: runtime.started_at,
      uptime,
      uptimeLabel,
      headerSrc: headerLogo?.getAttribute('src') ?? '',
      footerSrc: footerLogo?.getAttribute('src') ?? '',
      orbitHasLogo,
      orbitText,
      logoBackground: logoStyle?.backgroundColor ?? '',
      logoBorder: logoStyle ? parseFloat(logoStyle.borderTopWidth) : null,
      logoPadding: logoStyle?.padding ?? '',
    }
  })
  expect(state.runtimeStatus === 200, `${label}: runtime endpoint failed`)
  expect(Number.isFinite(state.uptimeSeconds), `${label}: runtime uptime is invalid`)
  expect(Number.isFinite(Date.parse(state.startedAt)), `${label}: runtime started_at is invalid`)
  expect(state.uptime !== '24h', `${label}: hero still uses the hard-coded 24h uptime`)
  expect(/^(--|(?:\d+d\s)?\d{2}:\d{2}:\d{2})$/.test(state.uptime), `${label}: unexpected uptime format ${state.uptime}`)
  expect(state.uptimeLabel.includes('UPTIME'), `${label}: uptime label is missing`)
  expect(!state.orbitHasLogo, `${label}: Hero orbit must not render a brand logo`)
  expect(state.orbitText === '', `${label}: Hero orbit must not contain placeholder text`)
  await page.waitForFunction(
    (previous) => {
      const value = document.querySelector('.hero-facts div:nth-child(3) dt')?.textContent?.trim()
      return value && value !== previous
    },
    state.uptime,
    { timeout: 2500 },
  )
  const nextUptime = await page.locator('.hero-facts div:nth-child(3) dt').textContent()
  expect(nextUptime?.trim() !== state.uptime, `${label}: uptime does not advance to the second`)
  if (state.headerSrc) {
    expect(state.footerSrc === state.headerSrc, `${label}: footer logo is not synchronized`)
    expect(state.logoBackground === 'rgba(0, 0, 0, 0)', `${label}: header logo still has a background`)
    expect(state.logoBorder === 0, `${label}: header logo still has a border`)
    expect(state.logoPadding === '0px', `${label}: header logo still has padding`)
  }
}

async function assertFutureUptimeFormat(browser) {
  const uptimeSeconds = 400 * 86400 + 3 * 3600 + 4 * 60 + 5
  const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.route(
    (url) => new URL(url).pathname === '/api/runtime',
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uptime_seconds: uptimeSeconds, started_at: startedAt }),
    }),
  )
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const state = await page.evaluate(() => {
    const fact = document.querySelector('.hero-facts div:nth-child(3)')
    const value = fact?.querySelector('dt')?.textContent?.trim() ?? ''
    const rect = fact?.getBoundingClientRect()
    return {
      value,
      width: rect ? Math.round(rect.width) : 0,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      long: fact?.classList.contains('is-long') ?? false,
    }
  })
  expect(state.long, 'long uptime did not switch to the calendar layout')
  expect(
    /^\d+年 \d+月 \d+日 \d{2}:\d{2}:\d{2}$/.test(state.value),
    `future uptime format is invalid: ${state.value}`,
  )
  expect(state.width > 0, 'future uptime fact has no width')
  expect(state.scrollWidth <= state.viewport, 'future uptime format causes horizontal overflow')
  await context.close()
}

async function axeCheck(page, label) {
  await page.addScriptTag({ content: axe.source })
  const result = await page.evaluate(async () => {
    return window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    })
  })
  const serious = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(
    serious.length === 0,
    `${label}: axe ${JSON.stringify(serious.map((v) => ({
      id: v.id,
      targets: v.nodes.map((node) => node.target),
      failure: v.nodes.map((node) => node.failureSummary),
    })))}`,
  )
}

async function main() {
  const admin = await loginApi()
  await setLottery(admin, false)
  const originalLotterySection = await setLotterySection(admin, false)
  const campaignID = await ensureCampaign(admin)
  const offModuleCount = await expectedHomeModuleCount()
  let numberEvent = null
  let overflowEventID = 0

  const browser = await chromium.launch({
    headless: true,
    ...(BROWSER_EXECUTABLE_PATH ? { executablePath: BROWSER_EXECUTABLE_PATH } : {}),
  })
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await attachDiagnostics(page, `home-off-${width}`)
      let siteRequests = 0
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/site') siteRequests++
      })
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      expect(siteRequests === 1, `home-off-${width}: /api/site requested ${siteRequests} times`)
      await assertNoOverflow(page, `home-off-${width}`)
      await assertTouchTargets(page, `home-off-${width}`)
      await assertReadableText(page, `home-off-${width}`)
      await assertFramedChrome(page, `home-off-${width}`)
      await assertCosmosHome(page, `home-off-${width}`, offModuleCount)
      if (width === 1440) {
        const beforeScroll = await page.locator('.whoami-section').evaluate((element) => getComputedStyle(element).opacity)
        await page.locator('.whoami-section').scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)
        const afterScroll = Number(await page.locator('.whoami-section').evaluate((element) => getComputedStyle(element).opacity))
        expect(beforeScroll === '0', `home reveal should start hidden, got ${beforeScroll}`)
        expect(afterScroll >= 0.99, `home reveal did not enter, got ${afterScroll}`)
        const moduleCard = page.locator('.module-card').first()
        await moduleCard.scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)
        const normalBorder = await moduleCard.evaluate((element) => getComputedStyle(element).borderColor)
        await moduleCard.hover()
        await page.waitForTimeout(320)
        const hover = await moduleCard.evaluate((element) => {
          const style = getComputedStyle(element)
          return { transform: style.transform, borderColor: style.borderColor, shadow: style.boxShadow }
        })
        expect(hover.transform !== 'none', 'module card hover does not lift')
        expect(hover.borderColor !== normalBorder, `module card hover border did not change: ${hover.borderColor}`)
        expect(hover.shadow !== 'none', 'module card hover glow missing')
      }
      await revealForScreenshot(page)
      await page.screenshot({ path: `${ARTIFACTS}/screenshots/home-off-${width}.jpg`, fullPage: true, type: 'jpeg', quality: 78 })
      if (width === 320) {
        const beforeMenu = await page.evaluate(() => ({
          header: document.querySelector('.public-topbar').getBoundingClientRect().height,
          main: document.querySelector('main').getBoundingClientRect().top,
        }))
        await page.getByRole('button', { name: '打开导航' }).click()
        await page.locator('#site-navigation').waitFor({ state: 'visible' })
        await page.waitForTimeout(220)
        const openMenu = await page.evaluate(() => {
          const header = document.querySelector('.public-topbar')
          const nav = document.querySelector('#site-navigation')
          const main = document.querySelector('main')
          const rect = nav.getBoundingClientRect()
          return {
            header: header.getBoundingClientRect().height,
            main: main.getBoundingClientRect().top,
            position: getComputedStyle(nav).position,
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            viewport: innerWidth,
          }
        })
        expect(Math.abs(openMenu.header - beforeMenu.header) <= 1, 'mobile menu changed header height')
        expect(Math.abs(openMenu.main - beforeMenu.main) <= 1, 'mobile menu pushed page content down')
        expect(openMenu.position === 'absolute', `mobile menu should be an overlay, got ${openMenu.position}`)
        expect(openMenu.height <= 170, `mobile menu overlay is too tall (${openMenu.height}px)`)
        expect(openMenu.width <= openMenu.viewport - 20, 'mobile menu overlay overflows viewport gutters')
        expect(await page.locator('#site-navigation a[href="/lottery"]').count() === 0, 'closed lottery appeared in navigation')
        await assertNoOverflow(page, 'home-menu-320')
        await assertTouchTargets(page, 'home-menu-320')
        await revealForScreenshot(page)
        await page.screenshot({
          path: `${ARTIFACTS}/screenshots/home-menu-320.jpg`,
          fullPage: false,
          type: 'jpeg',
          quality: 82,
        })
        await page.keyboard.press('Escape')
        await page.waitForTimeout(220)
        expect(!(await page.locator('#site-navigation').isVisible()), 'Escape did not close the mobile menu')
        expect(
          await page.evaluate(() => document.activeElement?.classList.contains('nav-toggle')),
          'Escape did not return focus to the menu trigger',
        )
      }
      if (width === 390) {
        await assertRuntimeAndBrandAssets(page, `home-${width}`)
        await axeCheck(page, `home-${width}`)
      }
      await context.close()
    }

    await setLotterySection(admin, true)
    await setLottery(admin, true)
    await setLotteryModes(admin, { screen: true, personal: false })
    numberEvent = await ensureNumberEvent(admin)
    const onModuleCount = await expectedHomeModuleCount()
    expect(onModuleCount === offModuleCount + 1, `lottery should add one module card: ${offModuleCount} -> ${onModuleCount}`)
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await attachDiagnostics(page, `home-on-${width}`)
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      await assertNoOverflow(page, `home-on-${width}`)
      await assertReadableText(page, `home-on-${width}`)
      await assertFramedChrome(page, `home-on-${width}`)
      await assertCosmosHome(page, `home-on-${width}`, onModuleCount)
      expect(await page.locator('#site-navigation a[href="/lottery"]').count() === 1, `home-on-${width}: lottery nav missing`)
      const screenNavText = (
        (await page.locator('#site-navigation a[href="/lottery"]').textContent()) || ''
      ).replace(/\s+/g, '')
      expect(
        screenNavText.endsWith('抽奖大屏'),
        `home-on-${width}: screen nav label is not synced with the module card (${JSON.stringify(screenNavText)})`,
      )
      expect(
        await page.locator('#site-navigation a[href="/lottery/participate"]').count() === 0,
        `home-on-${width}: disabled recruit lottery appeared in navigation`,
      )
      expect(await page.locator('#lottery').count() === 1, `home-on-${width}: lottery section missing`)
      expect(
        await page.locator('#lottery-participate').count() === 0,
        `home-on-${width}: disabled recruit lottery section appeared`,
      )
      expect(
        !/管理员|后台/.test(await page.locator('#lottery').innerText()),
        `home-on-${width}: public lottery card exposes admin wording`,
      )
      await revealForScreenshot(page)
      await page.screenshot({ path: `${ARTIFACTS}/screenshots/home-on-${width}.jpg`, fullPage: true, type: 'jpeg', quality: 78 })
      await context.close()
    }

    const entryContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const entryPage = await entryContext.newPage()
    await attachDiagnostics(entryPage, 'lottery-entry-modes')

    await setLotteryModes(admin, { screen: true, personal: true })
    const bothModuleCount = await expectedHomeModuleCount()
    expect(
      bothModuleCount === offModuleCount + 2,
      `both lottery modes should add two module cards: ${offModuleCount} -> ${bothModuleCount}`,
    )
    await entryPage.goto(BASE + '/', { waitUntil: 'networkidle' })
    expect(await entryPage.locator('#lottery').count() === 1, 'both modes: screen card missing')
    expect(await entryPage.locator('#lottery-participate').count() === 1, 'both modes: recruit card missing')
    expect(
      await entryPage.locator('#site-navigation').getByRole('link', { name: '抽奖大屏', exact: true }).count() === 1,
      'both modes: screen navigation label is not synced',
    )
    expect(
      await entryPage.locator('#site-navigation').getByRole('link', { name: '招新抽奖', exact: true }).count() === 1,
      'both modes: recruit navigation label is not synced',
    )
    expect(
      (await entryPage.locator('#lottery h3').innerText()).includes('SCREEN'),
      'both modes: screen card is not visually distinguished',
    )
    expect(
      (await entryPage.locator('#lottery-participate h3').innerText()).includes('RECRUIT'),
      'both modes: recruit card is not visually distinguished',
    )

    await entryPage.goto(BASE + '/lottery/participate', { waitUntil: 'networkidle' })
    expect(
      await entryPage.locator('#site-navigation a[href="/lottery/participate"]').getAttribute('class') === 'active',
      'both modes: recruit navigation is not active on its route',
    )
    expect(
      !((await entryPage.locator('#site-navigation a[href="/lottery"]').getAttribute('class')) || '').includes('active'),
      'both modes: screen navigation is incorrectly active on the recruit route',
    )

    await setLotteryModes(admin, { screen: false, personal: true })
    const personalModuleCount = await expectedHomeModuleCount()
    expect(
      personalModuleCount === offModuleCount + 1,
      `personal lottery alone should add one module card: ${offModuleCount} -> ${personalModuleCount}`,
    )
    await entryPage.goto(BASE + '/', { waitUntil: 'networkidle' })
    expect(await entryPage.locator('#lottery').count() === 0, 'personal-only mode exposed the screen card')
    expect(
      await entryPage.locator('#lottery-participate').count() === 1,
      'personal-only mode is missing the recruit card',
    )
    expect(
      await entryPage.locator('#site-navigation a[href="/lottery"]').count() === 0,
      'personal-only mode exposed the screen navigation item',
    )
    expect(
      await entryPage.locator('#site-navigation').getByRole('link', { name: '招新抽奖', exact: true }).count() === 1,
      'personal-only mode is missing the recruit navigation item',
    )

    await setLotteryModes(admin, { screen: true, personal: false })
    await entryContext.close()

    const pages = [
      ...(await loadModuleScenarios()).map((scenario) => [scenario.path, scenario.title]),
      ['/not-a-page', '页面不存在 · 计算机协会'],
    ]
    const routeWidths = [320, 390, 768, 1024, 1440, 1920]
    const titles = new Set()
    for (const width of routeWidths) {
      for (const [path, expected] of pages) {
        const label = `route-${path}-${width}`
        const context = await browser.newContext({
          viewport: {
            width,
            height: width <= 390 ? 844 : width === 1920 ? 1080 : 900,
          },
        })
        const page = await context.newPage()
        await attachDiagnostics(page, label)
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        const title = await page.title()
        expect(title === expected, `${label}: title ${title} != ${expected}`)
        titles.add(title)
        await assertNoOverflow(page, label)
        await assertReadableText(page, label)
        if (!fullscreenRoutes.has(path)) await assertFramedChrome(page, label)
        if (['/join', '/quiz', '/lottery/participate'].includes(path)) {
          const intro = await page.locator('.page-intro').evaluate((element) => {
            const style = getComputedStyle(element)
            const title = getComputedStyle(element.querySelector('h1'))
            const rect = element.getBoundingClientRect()
            return {
              align: style.textAlign,
              border: parseFloat(style.borderTopWidth),
              background: style.backgroundColor,
              width: Math.round(rect.width),
              titleSize: parseFloat(title.fontSize),
            }
          })
          expect(intro.align === 'center', `${label}: page intro is not centered`)
          expect(intro.border === 0, `${label}: page intro still has a frame`)
          expect(intro.background === 'rgba(0, 0, 0, 0)', `${label}: page intro still has a panel background`)
          expect(intro.width <= 760, `${label}: page intro is too wide`)
          expect(intro.titleSize <= 56, `${label}: page intro title is too large (${intro.titleSize}px)`)
        }
        if (path === '/lottery' && [390, 768, 1440, 1920].includes(width)) {
          expect(
            await page.locator('.lottery-screen').getByRole('button').count() === 0,
            `${label}: public lottery screen exposed a control`,
          )
          expect(
            await page.locator('.lottery-screen').getAttribute('data-audio-enabled') === 'false',
            `${label}: lottery audio should default to off`,
          )
          await page.keyboard.press('m')
          await page
            .locator('.lottery-screen[data-audio-enabled="true"]')
            .waitFor({ state: 'visible' })
          await page.keyboard.press('m')
          await page
            .locator('.lottery-screen[data-audio-enabled="false"]')
            .waitFor({ state: 'visible' })
          expect(
            await page.locator('.lottery-screen-atmosphere').count() === 1,
            `${label}: lottery stage atmosphere is missing`,
          )
          expect(
            await page.locator('.lottery-signal-deck').isVisible() === (width >= 768),
            `${label}: lottery signal deck visibility is incorrect`,
          )
          if (width >= 768) {
            const deckBox = await page.locator('.lottery-signal-deck').boundingBox()
            expect(
              deckBox && deckBox.height >= 40,
              `${label}: lottery signal deck is too shallow`,
            )
            expect(
              /EVENT/.test(await page.locator('.lottery-signal-deck').innerText()),
              `${label}: lottery signal deck is missing event telemetry`,
            )
          }
          expect(
            await page.getByText(/开始抽奖|开始抽取/).count() === 0,
            `${label}: public lottery screen exposed draw controls`,
          )
          expect(
            !/管理员|后台/.test(await page.locator('.lottery-screen').innerText()),
            `${label}: public lottery screen exposes admin wording`,
          )
          expect(
            await page.locator('.lottery-screen-home, .lottery-screen-foot').count() === 0,
            `${label}: public lottery screen still has return/footer chrome`,
          )
          expect(
            await page.locator('.lottery-screen-brand img, .lottery-screen-brand .logo-mark').count() === 1,
            `${label}: public lottery screen is missing the brand logo`,
          )
          await revealForScreenshot(page)
          await page.screenshot({
            path: `${ARTIFACTS}/screenshots/lottery-on-${width}.jpg`,
            fullPage: true,
            type: 'jpeg',
            quality: 82,
          })
        }
        if ((path === '/join' || path === '/quiz') && [390, 1440].includes(width)) {
          await revealForScreenshot(page)
          await page.screenshot({
            path: `${ARTIFACTS}/screenshots/${path.slice(1)}-${width}.jpg`,
            fullPage: true,
            type: 'jpeg',
            quality: 82,
          })
        }
        if ((path === '/join' || path === '/quiz') && width === 390) {
          await axeCheck(page, path.slice(1))
        }
        if (path === '/lottery' && width === 390) {
          await axeCheck(page, 'lottery')
        }
        if (path === '/lottery/participate' && width === 390) {
          expect(
            await page.getByRole('button', { name: /开始抽奖|参与抽取/ }).count() === 0,
            `${label}: disabled personal mode exposed a draw button`,
          )
          await axeCheck(page, 'lottery-participate')
        }
        await context.close()
      }
    }
    expect(titles.size === pages.length, 'public page titles are not unique')

    const reducedLiveContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    const reducedLivePage = await reducedLiveContext.newPage()
    await attachDiagnostics(reducedLivePage, 'lottery-live-reduced-motion')
    await reducedLivePage.goto(BASE + '/lottery', { waitUntil: 'networkidle' })
    await reducedLivePage.locator('.lottery-result-level.revealed').first().waitFor({ state: 'visible' })
    const reducedRevealWait = reducedLivePage
      .locator('.lottery-result-level.revealed')
      .nth(1)
      .waitFor({ state: 'visible', timeout: 8000 })
    await drawNumberLevel(admin, numberEvent.id, numberEvent.secondLevelID)
    await reducedRevealWait
    expect(
      await reducedLivePage.locator('.lottery-sequence-stage').count() === 0,
      'reduced motion number lottery screen rendered the sequential stage',
    )
    const reducedAnimations = await reducedLivePage.evaluate(() => (
      [
        '.lottery-stage-beam',
        '.lottery-star-field-a',
        '.lottery-live-beacon',
        '.lottery-signal-bars i',
      ].map((selector) => {
        const element = document.querySelector(selector)
        return element ? getComputedStyle(element).animationName : 'missing'
      })
    ))
    expect(
      reducedAnimations.every((name) => name === 'none'),
      `reduced motion kept lottery stage animation: ${JSON.stringify(reducedAnimations)}`,
    )
    await reducedLiveContext.close()

    const liveContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const livePage = await liveContext.newPage()
    await attachDiagnostics(livePage, 'lottery-live-reveal')
    await livePage.goto(BASE + '/lottery', { waitUntil: 'networkidle' })
    await livePage.locator('.lottery-result-level.revealed').first().waitFor({ state: 'visible' })
    const sequenceWait = livePage.locator('.lottery-sequence-stage').waitFor({ state: 'visible', timeout: 8000 })
    await drawNumberLevel(admin, numberEvent.id, numberEvent.thirdLevelID)
    await sequenceWait
    expect(
      await livePage.locator('.lottery-sequence-stage').getAttribute('data-sequence-index') === '0',
      'number lottery sequence did not start with the first winner',
    )
    await livePage.waitForTimeout(700)
    await livePage.screenshot({
      path: `${ARTIFACTS}/screenshots/lottery-reveal-1440.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 84,
    })
    await livePage.locator('.lottery-sequence-stage').waitFor({ state: 'detached', timeout: 8000 })
    expect(
      await livePage.locator('.lottery-result-level.revealed').count() === 3,
      'number lottery screen did not reveal all levels',
    )
    expect(
      await livePage.locator('.lottery-winner-grid .scramble-char').count() > 0,
      'number lottery winners do not use the shared scramble animation',
    )
    const winnerTracks = await livePage.locator('.lottery-winner-grid').evaluateAll((grids) => (
      grids.map((grid) => ({
        tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        width: Math.round(grid.querySelector('li')?.getBoundingClientRect().width ?? 0),
      }))
    ))
    expect(
      winnerTracks.length === 3 && winnerTracks.every((grid) => grid.tracks === 3),
      `number lottery winner grids are not using a consistent three-column matrix: ${JSON.stringify(winnerTracks)}`,
    )
    const winnerWidths = winnerTracks.map((grid) => grid.width)
    expect(
      Math.max(...winnerWidths) - Math.min(...winnerWidths) <= 1,
      `number lottery winner cells changed size by prize tier: ${JSON.stringify(winnerWidths)}`,
    )
    expect(
      await livePage.getByText('本场已开完').count() === 1,
      'number lottery screen did not show completed state',
    )
    await livePage.waitForTimeout(750)
    await livePage.setViewportSize({ width: 1920, height: 1080 })
    await assertNoOverflow(livePage, 'lottery-final-1920')
    await livePage.screenshot({
      path: `${ARTIFACTS}/screenshots/lottery-final-1920.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 84,
    })
    await liveContext.close()

    const landscapeContext = await browser.newContext({ viewport: { width: 844, height: 390 } })
    const landscapePage = await landscapeContext.newPage()
    await attachDiagnostics(landscapePage, 'home-landscape-844x390')
    await landscapePage.goto(BASE + '/', { waitUntil: 'networkidle' })
    await assertNoOverflow(landscapePage, 'home-landscape-844x390')
    await assertTouchTargets(landscapePage, 'home-landscape-844x390')
    await assertReadableText(landscapePage, 'home-landscape-844x390')
    await assertFramedChrome(landscapePage, 'home-landscape-844x390')
    await assertCosmosHome(landscapePage, 'home-landscape-844x390', onModuleCount)
    await revealForScreenshot(landscapePage)
    await landscapePage.screenshot({
      path: `${ARTIFACTS}/screenshots/home-landscape-844x390.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 78,
    })
    await landscapeContext.close()

    await setLottery(admin, false)
    const offContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const offPage = await offContext.newPage()
    await attachDiagnostics(offPage, 'lottery-off')
    await offPage.goto(BASE + '/lottery', { waitUntil: 'networkidle' })
    expect(await offPage.getByText('抽奖模块尚未启用').count() === 1, 'disabled lottery route did not show unavailable state')
    await revealForScreenshot(offPage)
    await offPage.screenshot({ path: `${ARTIFACTS}/screenshots/lottery-off-390.jpg`, fullPage: true, type: 'jpeg', quality: 82 })
    await offContext.close()

    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const adminPage = await adminContext.newPage()
    await attachDiagnostics(adminPage, 'admin')
    await adminPage.goto(BASE + '/admin', { waitUntil: 'networkidle' })
    await adminPage.getByLabel('用户名').fill(ADMIN_USERNAME)
    await adminPage.getByLabel('密码').fill(ADMIN_PASSWORD)
    await adminPage.getByRole('button', { name: '登录' }).click()
    await adminPage.locator('.admin-overview').waitFor({ state: 'visible' })
    expect(await adminPage.locator('.stat-card').count() === 4, 'admin overview stat cards missing')
    expect(await adminPage.locator('.bar-column').count() === 5, 'admin overview bar chart missing')
    expect(await adminPage.locator('.runtime-table tbody tr').count() >= 6, 'admin overview runtime table missing')
    expect(await adminPage.locator('.terminal-log-card pre').count() === 1, 'admin overview terminal log missing')
    await assertNoOverflow(adminPage, 'admin-overview')
    await adminPage.screenshot({ path: `${ARTIFACTS}/screenshots/admin-overview-390.jpg`, fullPage: true, type: 'jpeg', quality: 82 })
    await axeCheck(adminPage, 'admin-overview')
    await adminPage.getByRole('button', { name: /当前功能/ }).click()
    await adminPage.getByRole('button', { name: '抽奖', exact: true }).click()
    await adminPage.getByText('抽奖模块', { exact: true }).waitFor({ state: 'visible' })
    await adminPage.getByText('号码开奖大屏', { exact: true }).first().waitFor({ state: 'visible' })
    await assertNoOverflow(adminPage, 'admin-lottery')
    await assertReadableText(adminPage, 'admin-lottery')
    await assertFramedChrome(adminPage, 'admin-lottery')
    const storage = await adminPage.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      cookie: document.cookie,
    }))
    expect(!storage.local.includes(ADMIN_PASSWORD), 'admin password leaked to localStorage')
    expect(!storage.session.includes(ADMIN_PASSWORD), 'admin password leaked to sessionStorage')
    expect(!storage.cookie.includes(ADMIN_PASSWORD), 'admin password leaked to visible cookie')
    await adminPage.screenshot({ path: `${ARTIFACTS}/screenshots/admin-lottery-390.jpg`, fullPage: true, type: 'jpeg', quality: 82 })
    await axeCheck(adminPage, 'admin-lottery')
    await adminPage.locator('.number-live-order').waitFor({ state: 'visible' })
    expect(
      (await adminPage.locator('.number-live-order b').allTextContents()).join('→')
        === '三等奖→二等奖→一等奖',
      'admin lottery live draw order is not small-to-large',
    )
    await adminPage.getByRole('button', { name: '归档场次' }).click()
    const dangerDialog = adminPage.getByRole('dialog')
    await dangerDialog.waitFor({ state: 'visible' })
    expect(
      (await dangerDialog.getAttribute('class'))?.includes('confirm-dialog danger'),
      'lottery archive confirmation does not use the built-in danger dialog',
    )
    await dangerDialog.getByRole('button', { name: '取消' }).click()
    if (numberEvent) {
      await adminPage.route(
        /\/api\/admin\/lottery\/number-events\/\d+$/,
        async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 800))
          await route.continue()
        },
      )
      const switchButton = adminPage.getByRole('button', {
        name: new RegExp(numberEvent.switchName),
      })
      await switchButton.click()
      await adminPage.locator('.number-event-item.loading').waitFor({ state: 'visible' })
      expect(
        await adminPage.locator('.number-live-panel').isVisible(),
        'admin lottery detail collapsed while switching events',
      )
      await adminPage.getByText('编辑草稿', { exact: true }).waitFor({ state: 'visible' })
      await adminPage.getByText('开奖顺序（小奖 → 大奖）', { exact: true }).waitFor({
        state: 'visible',
      })
      expect(
        await adminPage.locator('.number-level-list').getAttribute('aria-label')
          === '开奖顺序，从上到下由小奖到大奖',
        'admin lottery editor does not explain the small-to-large draw order',
      )
      const levelName = adminPage
        .locator('.number-level-row')
        .first()
        .locator('label')
        .first()
        .locator('input')
      await levelName.fill('')
      await levelName.pressSequentially('测试等级', { delay: 25 })
      expect(
        await levelName.inputValue() === '测试等级',
        `admin lottery level name lost typing focus: ${await levelName.inputValue()}`,
      )
      await adminPage.getByRole('button', { name: '上线大屏' }).click()
      const primaryDialog = adminPage.getByRole('dialog')
      await primaryDialog.waitFor({ state: 'visible' })
      expect(
        (await primaryDialog.getAttribute('class'))?.includes('confirm-dialog primary'),
        'lottery publish confirmation does not use the built-in primary dialog',
      )
      expect(
        await primaryDialog.getByText(/开奖规则：小奖先开，大奖压轴/).count() === 1,
        'lottery publish confirmation does not state the small-to-large order',
      )
      await primaryDialog.getByRole('button', { name: '取消' }).click()
      await adminPage.unroute(/\/api\/admin\/lottery\/number-events\/\d+$/)
    }
    await adminContext.close()

    await setLottery(admin, true)
    const archiveForStandby = await api(`/api/admin/lottery/number-events/${numberEvent.id}/archive`, {
      method: 'POST',
      cookie: admin.cookie,
      csrf: admin.csrf,
    })
    expect(archiveForStandby.status === 200, `archive event for standby failed: ${JSON.stringify(archiveForStandby.payload)}`)
    const standbyContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const standbyPage = await standbyContext.newPage()
    await attachDiagnostics(standbyPage, 'lottery-standby')
    await standbyPage.goto(BASE + '/lottery', { waitUntil: 'networkidle' })
    await standbyPage.locator('.lottery-standby-facts').waitFor({ state: 'visible' })
    expect(await standbyPage.locator('.lottery-standby-orbit').count() === 1, 'standby visual is missing')
    expect(
      await standbyPage.locator('.lottery-screen-home, .lottery-screen-foot').count() === 0,
      'standby screen still has return/footer chrome',
    )
    await standbyPage.screenshot({
      path: `${ARTIFACTS}/screenshots/lottery-standby-1920.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 84,
    })
    await standbyContext.close()

    overflowEventID = await ensureOverflowNumberEvent(admin)
    const overflowContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const overflowPage = await overflowContext.newPage()
    await attachDiagnostics(overflowPage, 'lottery-overflow')
    await overflowPage.goto(BASE + '/lottery', { waitUntil: 'networkidle' })
    await overflowPage.locator('.lottery-result-level.revealed').waitFor({ state: 'visible' })
    const overflowBoard = overflowPage.locator('.lottery-result-board')
    const overflowGrid = overflowPage.locator('.lottery-winner-grid').first()
    const overflowHeader = overflowPage.locator('.lottery-result-level header').first()
    expect(
      await overflowPage.locator('.lottery-terminal').isVisible(),
      'lottery telemetry terminal decoration is missing',
    )
    expect(
      (await overflowPage.locator('.lottery-terminal-log').innerText())
        .includes(String(overflowEventID).padStart(3, '0')),
      'lottery telemetry terminal does not use the real event ID',
    )
    await overflowPage.waitForTimeout(400)
    const overflowStart = await overflowPage.evaluate(() => {
      const grid = document.querySelector('.lottery-winner-grid')
      const board = document.querySelector('.lottery-result-board')
      const header = document.querySelector('.lottery-result-level header')
      return {
        scrollTop: grid?.scrollTop ?? 0,
        clientHeight: grid?.clientHeight ?? 0,
        scrollHeight: grid?.scrollHeight ?? 0,
        boardScrollTop: board?.scrollTop ?? 0,
        headerTop: header?.getBoundingClientRect().top ?? 0,
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      }
    })
    expect(
      overflowStart.scrollHeight > overflowStart.clientHeight + 200,
      `lottery overflow result should scroll inside its container: ${JSON.stringify(overflowStart)}`,
    )
    expect(
      overflowStart.pageHeight <= overflowStart.viewportHeight + 1,
      `lottery overflow result stretched the page: ${JSON.stringify(overflowStart)}`,
    )
    await overflowGrid.hover()
    await overflowPage.waitForTimeout(2200)
    const autoScroll = await overflowPage.evaluate(() => ({
      scrollTop: document.querySelector('.lottery-winner-grid')?.scrollTop ?? 0,
      boardScrollTop: document.querySelector('.lottery-result-board')?.scrollTop ?? 0,
      headerTop: document.querySelector('.lottery-result-level header')?.getBoundingClientRect().top ?? 0,
    }))
    expect(
      autoScroll.scrollTop > overflowStart.scrollTop + 5,
      `lottery overflow result did not auto-scroll: ${overflowStart.scrollTop} -> ${autoScroll.scrollTop}`,
    )
    expect(
      Math.abs(autoScroll.headerTop - overflowStart.headerTop) <= 1,
      `lottery overflow scrolled the prize heading: ${overflowStart.headerTop} -> ${autoScroll.headerTop}`,
    )
    expect(
      autoScroll.boardScrollTop <= 1,
      `lottery overflow scrolled the result board instead of the winner list: ${autoScroll.boardScrollTop}`,
    )
    await overflowGrid.focus()
    await overflowPage.waitForTimeout(120)
    const focusedScrollTop = await overflowGrid.evaluate((element) => element.scrollTop)
    await overflowPage.waitForTimeout(700)
    const pausedScrollTop = await overflowGrid.evaluate((element) => element.scrollTop)
    expect(
      Math.abs(pausedScrollTop - focusedScrollTop) <= 1,
      `focused lottery results kept scrolling: ${focusedScrollTop} -> ${pausedScrollTop}`,
    )
    expect(
      await overflowHeader.isVisible(),
      'lottery overflow hid the prize heading',
    )
    await axeCheck(overflowPage, 'lottery-overflow')
    await overflowPage.screenshot({
      path: `${ARTIFACTS}/screenshots/lottery-overflow-1440.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 84,
    })
    const nearEnd = await overflowGrid.evaluate((element) => {
      const maxScroll = element.scrollHeight - element.clientHeight
      element.scrollTop = maxScroll - 2
      return maxScroll
    })
    await overflowGrid.blur()
    await overflowPage.waitForTimeout(500)
    const wrappedScrollTop = await overflowGrid.evaluate((element) => element.scrollTop)
    expect(
      wrappedScrollTop > 0 && wrappedScrollTop < nearEnd - 100,
      `lottery result cycle paused at the boundary: ${nearEnd} -> ${wrappedScrollTop}`,
    )
    await overflowContext.close()
    const archivedOverflow = await api(`/api/admin/lottery/number-events/${overflowEventID}/archive`, {
      method: 'POST',
      cookie: admin.cookie,
      csrf: admin.csrf,
    })
    expect(
      archivedOverflow.status === 200,
      `archive overflow number event failed: ${JSON.stringify(archivedOverflow.payload)}`,
    )
    overflowEventID = 0

    const reduced = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    })
    const reducedPage = await reduced.newPage()
    await attachDiagnostics(reducedPage, 'reduced-motion')
    await reducedPage.goto(BASE + '/', { waitUntil: 'networkidle' })
    const reducedState = await reducedPage.evaluate(() => ({
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      canvases: document.querySelectorAll('canvas').length,
      particleNodes: document.querySelector('.cosmic-canvas')?.getAttribute('data-nodes'),
      hiddenReveal: Array.from(document.querySelectorAll('[data-reveal]'))
        .filter((element) => getComputedStyle(element).opacity !== '1').length,
      cursorAnimation: getComputedStyle(document.querySelector('.terminal-cursor')).animationName,
    }))
    expect(reducedState.reduced, 'reduced-motion media query was not applied')
    expect(reducedState.canvases === 1, `reduced motion should keep one static canvas: ${reducedState.canvases}`)
    expect(reducedState.particleNodes === '90', 'reduced motion canvas lost its 90-node constellation')
    expect(reducedState.hiddenReveal === 0, 'reduced motion left content hidden')
    expect(reducedState.cursorAnimation === 'none', 'reduced motion kept the cursor blinking')
    await reduced.close()

    const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const fallbackPage = await fallback.newPage()
    await attachDiagnostics(fallbackPage, 'site-fallback')
    await fallbackPage.route('**/api/site', (route) => route.abort())
    await fallbackPage.goto(BASE + '/', { waitUntil: 'networkidle' })
    expect(await fallbackPage.getByText('站点配置暂时不可用，正在显示静态内容。').count() === 1, 'fallback banner missing')
    const fallbackHeading = (await fallbackPage.locator('#hero-title').getAttribute('aria-label'))?.trim()
    expect(fallbackHeading === '把好奇心，写进每一行代码', `fallback home missing: ${fallbackHeading}`)
    await fallback.close()

    await assertFutureUptimeFormat(browser)

    const unexpectedErrors = errors.filter(
      (message) => !(
        (message.startsWith('site-fallback: console Failed to load resource') && message.includes('ERR_FAILED'))
        || (
          message.startsWith('route-/lottery/participate-')
          && message.includes('console Failed to load resource')
          && message.includes('404')
        )
      ),
    )
    expect(unexpectedErrors.length === 0, `browser diagnostics:\n${unexpectedErrors.join('\n')}`)
    console.log(`browser ok: ${widths.length} viewports x 2 module states + landscape, routes at ${routeWidths.length} widths, axe, keyboard, fallback, reduced motion; campaign ${campaignID}`)
  } finally {
    await browser.close()
    await setLotterySection(admin, originalLotterySection)
    if (overflowEventID) {
      const archivedOverflow = await api(`/api/admin/lottery/number-events/${overflowEventID}/archive`, {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
      })
      expect(
        archivedOverflow.status === 200 || archivedOverflow.payload?.code === 'event_not_live',
        'browser overflow number event cleanup failed',
      )
    }
    if (numberEvent) {
      const archived = await api(`/api/admin/lottery/number-events/${numberEvent.id}/archive`, {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
      })
      expect(
        archived.status === 200 || archived.payload?.code === 'event_not_live',
        'browser number event cleanup failed',
      )
      const deletedDraft = await api(`/api/admin/lottery/number-events/${numberEvent.switchDraftID}`, {
        method: 'DELETE',
        cookie: admin.cookie,
        csrf: admin.csrf,
      })
      expect(
        deletedDraft.status === 200 || deletedDraft.payload?.code === 'event_not_found',
        'browser switch draft cleanup failed',
      )
    }
    await setLottery(admin, false)
    const ended = await api(`/api/admin/lottery/campaigns/${campaignID}/status`, {
      method: 'POST',
      cookie: admin.cookie,
      csrf: admin.csrf,
      body: { status: 'ended' },
    })
    expect(ended.status === 200, 'browser test campaign cleanup failed')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
