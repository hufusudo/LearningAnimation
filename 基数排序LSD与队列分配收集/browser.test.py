"""Run against a static server with RADIX_BASE_URL; optionally set CHROMIUM_EXECUTABLE."""
import os
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get('RADIX_BASE_URL', 'http://127.0.0.1:8765')
URL = BASE.rstrip('/') + '/' + quote(ROOT.name) + '/index.html'


def scrub(page, value):
    page.locator('#progress').evaluate("(el, value) => { el.value = value; el.dispatchEvent(new Event('input', {bubbles: true})); }", value)


def current(page):
    return float(page.locator('#progress').input_value())


def check_page(page):
    page.wait_for_load_state('networkidle')
    assert page.locator('#card-layer > g').count() == 8
    assert page.locator('#bucket-layer > g').count() == 10


with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('CHROMIUM_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1440, 'height': 1180})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    check_page(page)
    assert page.evaluate('Boolean(window.gsap)'), 'CDN engine unavailable; run fallback tests separately'
    assert not page.locator('#play').is_disabled()
    assert page.locator('#prev').is_disabled()
    page.screenshot(path='/tmp/radix-desktop.png', full_page=True)
    page.get_by_role('button', name='第 2 轮十位收集', exact=True).click()
    assert current(page) == 28
    assert '十位 · FIFO 收集' in page.locator('#phase').inner_text()
    page.locator('#reset').click()
    # SVG runtime fill must not be overridden by CSS.
    assert page.locator('[data-item="0"] .number').nth(2).evaluate('(el) => getComputedStyle(el).fill') == 'rgb(255, 255, 255)'
    # Next animates exactly one event then pauses.
    page.locator('#next').click()
    page.wait_for_function("document.body.dataset.playing === 'false'")
    assert current(page) == 1
    page.locator('#next').click()
    page.wait_for_function("document.body.dataset.playing === 'false'")
    assert current(page) == 2
    # Pause mid-flight really freezes the same frame and resumes from it.
    scrub(page, 2.35)
    expected = page.locator('#card-layer').inner_html()
    page.locator('#play').click()
    page.wait_for_timeout(180)
    page.locator('#play').click()
    frozen = page.locator('#card-layer').inner_html()
    frozen_time = current(page)
    page.wait_for_timeout(220)
    assert current(page) == frozen_time
    assert page.locator('#card-layer').inner_html() == frozen
    assert frozen != expected
    page.locator('#play').click()
    page.wait_for_timeout(160)
    page.locator('#play').click()
    assert current(page) > frozen_time
    # Background visibility stops the controller and its pending work.
    page.locator('#play').click()
    page.evaluate("Object.defineProperty(document, 'hidden', {configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;")
    assert page.locator('body').get_attribute('data-playing') == 'false'
    # Playback naturally reaches the finish state and pauses.
    scrub(page, 54.7)
    page.locator('#play').click()
    page.wait_for_function("document.body.dataset.playing === 'false'")
    assert current(page) == 55
    # Deterministic reverse and seek.
    scrub(page, 8.49)
    snapshot = page.locator('#card-layer').inner_html()
    scrub(page, 32.64)
    scrub(page, 8.49)
    assert page.locator('#card-layer').inner_html() == snapshot
    # Both geometry and layer order are independent of history.
    geometry = lambda: page.locator('#card-layer > g').evaluate_all('(els) => els.map(el => [el.dataset.item,el.getAttribute("transform")]).sort()')
    expected_geo = geometry()
    scrub(page, 4.25)
    scrub(page, 8.49)
    assert geometry() == expected_geo
    # Speed applies to the running timeline (not just the next step).
    scrub(page, 3.1)
    page.locator('#play').click()
    page.locator('#speed').evaluate("el => {el.value=2;el.dispatchEvent(new Event('input'));}")
    scale = page.evaluate("gsap.globalTimeline.getChildren().filter(t => t.getChildren && t.getChildren().some(c => c.targets().some(o => 't' in o))).map(t => t.timeScale())")
    assert 2 in scale
    page.locator('#play').click()
    # Parameter change keeps t and pauses. Repeated identities remain visible.
    scrub(page, 9)
    page.locator('[data-preset="conflict"]').click()
    assert current(page) == 9
    assert page.locator('#bucket-layer > g').nth(4).locator('text').last.text_content() == '占用 8'
    page.screenshot(path='/tmp/radix-full-bucket.png', full_page=True)
    scrub(page, 10.53)
    page.screenshot(path='/tmp/radix-collect-flight.png', full_page=True)
    # All identical numbers remain ordered A..H; invalid input never silently clips.
    page.locator('#custom-toggle').click()
    page.locator('#custom-input').fill('1,2,3,4,5,6,7,nope')
    page.locator('#custom-form button').click()
    assert page.locator('#input-error').inner_text()
    assert current(page) == 10.53
    page.locator('#custom-input').fill('424,424,424,424,424,424,424,424')
    page.locator('#custom-form button').click()
    assert page.locator('#input-error').inner_text() == ''
    scrub(page, 55)
    ordered = page.locator('#card-layer > g').evaluate_all('(els) => els.sort((a,b) => a.transform.baseVal.getItem(0).matrix.e - b.transform.baseVal.getItem(0).matrix.e).map(el => el.querySelector(".identity").textContent)')
    assert ordered == list('ABCDEFGH')
    assert page.locator('#next').is_disabled()
    page.screenshot(path='/tmp/radix-complete.png', full_page=True)
    # Keyboard shortcuts do not steal form-control keystrokes.
    page.locator('#custom-input').focus()
    page.keyboard.press('Home')
    assert current(page) == 55
    page.evaluate('document.activeElement.blur()')
    page.keyboard.press('Home')
    assert current(page) == 0
    # Reduced motion contains only event endpoints, including restored URLs.
    page.locator('#reduced').check()
    scrub(page, 1.52)
    assert current(page) == 2
    page.locator('#next').click()
    assert current(page) == 3
    page.locator('#play').click()
    page.wait_for_timeout(620)
    assert current(page).is_integer()
    page.locator('#play').click()
    hash_url = page.url
    page.reload()
    check_page(page)
    assert page.locator('#reduced').is_checked()
    assert page.url == hash_url
    # No page-wide horizontal overflow at narrow width.
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert page.locator('.stage-scroll').evaluate('el => el.scrollWidth > el.clientWidth')
    page.screenshot(path='/tmp/radix-narrow.png', full_page=True)
    assert not errors, errors

    # Missing GSAP: steps, progress, data inputs and all three rounds still work.
    fallback = browser.new_page(viewport={'width': 1280, 'height': 1000})
    fallback_errors = []
    fallback.on('pageerror', lambda error: fallback_errors.append(str(error)))
    fallback.route('**/gsap.min.js', lambda route: route.abort())
    fallback.goto(URL)
    check_page(fallback)
    assert fallback.locator('#play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    fallback.locator('#next').click()
    assert current(fallback) == 1
    scrub(fallback, 55)
    assert fallback.locator('#next').is_disabled()
    fallback.locator('#prev').click()
    assert current(fallback) == 54
    fallback.screenshot(path='/tmp/radix-no-engine.png', full_page=True)
    assert not fallback_errors, fallback_errors

    # file:// uses the same classic scripts, no module/CORS dependency.
    local = browser.new_page(viewport={'width': 1280, 'height': 1000}, reduced_motion='reduce')
    local.goto((ROOT / 'index.html').as_uri())
    check_page(local)
    assert local.locator('#reduced').is_checked()
    local.locator('#next').click()
    assert current(local) == 1
    scrub(local, 55)
    assert local.locator('#next').is_disabled()
    browser.close()
    print('PASS: HTTP/file, playback/pause/resume/step/speed, deterministic seek, full bucket, stability, validation, reduced motion, hash, narrow layout and missing GSAP')
