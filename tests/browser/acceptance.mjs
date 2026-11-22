import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import axe from 'axe-core'

const BASE = process.env.BASE_URL || 'http://localhost:8091'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'owner'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'integrity-test'
const ARTIFACTS = process.env.ARTIFACT_DIR || '/artifacts/browser'
const BROWSER_EXECUTABLE_PATH = process.env.BROWSER_EXECUTABLE_PATH || ''
const widths = [320, 360, 390, 414, 480, 600, 768, 820, 900, 1024, 1180, 1280, 1440, 1920]
const errors = []

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
  const sections = current.payload.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    enabled: section.kind === 'lottery' ? enabled : section.enabled,
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
  return sections.find((section) => section.kind === 'lottery')?.enabled === true
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
      '.quiz-wrap',
      '.state-page h1',
      '.screen-head',
      '.srow',
      '.admin-top',
      '.panel-head',
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
  expect(chrome.header.backdrop.includes('blur'), `${label}: header is missing frosted blur`)
  expect(chrome.footer.backdrop.includes('blur'), `${label}: footer is missing frosted blur`)
  const maxFooterHeight = chrome.viewport <= 820 ? 170 : chrome.viewport <= 1023 ? 118 : 96
  expect(chrome.footer.height <= maxFooterHeight, `${label}: footer is too tall (${chrome.footer.height}px)`)
  expect(chrome.main.top >= chrome.header.bottom - 1, `${label}: header overlaps main content`)
  expect(chrome.footer.top >= chrome.main.bottom - 1, `${label}: footer overlaps main content`)
}

async function assertCosmosHome(page, label) {
  const cosmos = await page.evaluate(() => {
    const canvas = document.querySelector('.cosmic-canvas')
    const grid = document.querySelector('.cosmic-grid')
    const logo = document.querySelector('.logo-mark')
    const moduleGrid = document.querySelector('.module-grid')
    return {
      canvas: canvas instanceof HTMLCanvasElement,
      nodes: canvas?.getAttribute('data-nodes'),
      linkDistance: canvas?.getAttribute('data-link-distance'),
      gravityDistance: canvas?.getAttribute('data-gravity-distance'),
      gridSize: getComputedStyle(grid).backgroundSize,
      logoTransform: getComputedStyle(logo, '::before').transform,
      logoGradient: getComputedStyle(logo, '::before').backgroundImage,
      moduleCount: document.querySelectorAll('.module-card').length,
      moduleColumns: getComputedStyle(moduleGrid).gridTemplateColumns.split(' ').length,
      bootCommand: document.querySelector('.boot-command')?.textContent ?? '',
      terminalText: document.querySelector('.terminal-card')?.textContent ?? '',
      footerText: document.querySelector('.footer-terminal')?.textContent ?? '',
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
  expect(cosmos.logoTransform !== 'none', `${label}: rotated logo mark missing`)
  expect(cosmos.logoGradient.includes('conic-gradient'), `${label}: conic logo gradient missing`)
  expect(cosmos.moduleCount === 3, `${label}: expected three core modules, got ${cosmos.moduleCount}`)
  expect(cosmos.moduleColumns === (page.viewportSize().width <= 820 ? 1 : 3), `${label}: module grid breakpoint failed`)
  expect(cosmos.bootCommand.includes('boot nebula_os') && cosmos.bootCommand.includes('[OK]'), `${label}: boot line missing`)
  expect(cosmos.terminalText.includes('computer_association'), `${label}: terminal identity missing`)
  expect(cosmos.footerText.includes('EOF') && cosmos.footerText.includes('感谢阅读到底部'), `${label}: EOF footer missing`)
  expect(cosmos.notoReady && cosmos.displayReady && cosmos.monoReady, `${label}: required variable fonts did not load`)
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
      await assertCosmosHome(page, `home-off-${width}`)
      if (width === 1440) {
        const beforeScroll = await page.locator('.whoami-section').evaluate((element) => getComputedStyle(element).opacity)
        await page.locator('.whoami-section').scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)
        const afterScroll = await page.locator('.whoami-section').evaluate((element) => getComputedStyle(element).opacity)
        expect(beforeScroll === '0', `home reveal should start hidden, got ${beforeScroll}`)
        expect(afterScroll === '1', `home reveal did not enter, got ${afterScroll}`)
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
        await axeCheck(page, `home-${width}`)
      }
      await context.close()
    }

    await setLotterySection(admin, true)
    await setLottery(admin, true)
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await attachDiagnostics(page, `home-on-${width}`)
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      await assertNoOverflow(page, `home-on-${width}`)
      await assertReadableText(page, `home-on-${width}`)
      await assertFramedChrome(page, `home-on-${width}`)
      await assertCosmosHome(page, `home-on-${width}`)
      expect(await page.locator('#site-navigation a[href="/lottery"]').count() === 1, `home-on-${width}: lottery nav missing`)
      expect(await page.locator('#lottery').count() === 1, `home-on-${width}: lottery section missing`)
      await revealForScreenshot(page)
      await page.screenshot({ path: `${ARTIFACTS}/screenshots/home-on-${width}.jpg`, fullPage: true, type: 'jpeg', quality: 78 })
      await context.close()
    }

    const pages = [
      ['/join', '加入我们 · 计算机协会'],
      ['/quiz', '答题挑战 · 计算机协会'],
      ['/screen', '实时排行榜 · 计算机协会'],
      ['/lottery', '招新抽奖 · 计算机协会'],
      ['/not-a-page', '页面不存在 · 计算机协会'],
    ]
    const routeWidths = [320, 390, 768, 1024, 1440]
    const titles = new Set()
    for (const width of routeWidths) {
      for (const [path, expected] of pages) {
        const label = `route-${path}-${width}`
        const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 } })
        const page = await context.newPage()
        await attachDiagnostics(page, label)
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        const title = await page.title()
        expect(title === expected, `${label}: title ${title} != ${expected}`)
        titles.add(title)
        await assertNoOverflow(page, label)
        await assertReadableText(page, label)
        if (path !== '/screen') await assertFramedChrome(page, label)
        if (['/join', '/quiz', '/lottery'].includes(path)) {
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
        if (path === '/lottery' && [390, 768, 1440].includes(width)) {
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
        await context.close()
      }
    }
    expect(titles.size === pages.length, 'public page titles are not unique')

    const landscapeContext = await browser.newContext({ viewport: { width: 844, height: 390 } })
    const landscapePage = await landscapeContext.newPage()
    await attachDiagnostics(landscapePage, 'home-landscape-844x390')
    await landscapePage.goto(BASE + '/', { waitUntil: 'networkidle' })
    await assertNoOverflow(landscapePage, 'home-landscape-844x390')
    await assertTouchTargets(landscapePage, 'home-landscape-844x390')
    await assertReadableText(landscapePage, 'home-landscape-844x390')
    await assertFramedChrome(landscapePage, 'home-landscape-844x390')
    await assertCosmosHome(landscapePage, 'home-landscape-844x390')
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
    await adminPage.getByRole('button', { name: '抽奖' }).click()
    await adminPage.getByText('抽奖总开关').waitFor({ state: 'visible' })
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
    await adminContext.close()

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
    const fallbackHeading = (await fallbackPage.locator('#hero-title').textContent())?.trim()
    expect(fallbackHeading === '把好奇心，写进每一行代码', `fallback home missing: ${fallbackHeading}`)
    await fallback.close()

    const unexpectedErrors = errors.filter(
      (message) => !(message.startsWith('site-fallback: console Failed to load resource') && message.includes('ERR_FAILED')),
    )
    expect(unexpectedErrors.length === 0, `browser diagnostics:\n${unexpectedErrors.join('\n')}`)
    console.log(`browser ok: ${widths.length} viewports x 2 module states + landscape, routes at ${routeWidths.length} widths, axe, keyboard, fallback, reduced motion; campaign ${campaignID}`)
  } finally {
    await browser.close()
    await setLotterySection(admin, originalLotterySection)
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
