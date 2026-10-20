"""浏览器回归：python browser.test.py [--base-url http://127.0.0.1:8000]
可选 --gsap-file 指向本地 GSAP 3.12.5 副本，仅用于隔离 CDN 网络波动。
"""
import argparse
import os
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base-url')
parser.add_argument('--gsap-file', type=Path)
args = parser.parse_args()
module = Path(__file__).resolve().parent
relative = quote(module.name) + '/index.html'
http_url = args.base_url.rstrip('/') + '/' + relative if args.base_url else None
file_url = (module / 'index.html').as_uri()


def time(page):
    return float(page.locator('#time-label').text_content())


def seek(page, t):
    page.locator('#progress').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input",{bubbles:true}))}', str(t))


def load(browser, url, blocked=False, width=1440, motion='no-preference'):
    page = browser.new_page(viewport={'width': width, 'height': 1100}, reduced_motion=motion)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    if blocked:
        page.route('**/gsap.min.js', lambda route: route.abort())
    elif args.gsap_file:
        page.route('**/gsap.min.js', lambda route: route.fulfill(path=str(args.gsap_file), content_type='application/javascript'))
    page.goto(url)
    page.wait_for_load_state('networkidle')
    assert not errors, errors
    return page, errors


def run_tests(browser, base):
    page, errors = load(browser, base)
    assert page.evaluate('!!window.gsap'), '正常动效测试需要可用 GSAP；可用 --gsap-file 隔离网络波动'
    assert time(page) == 0
    assert page.locator('#cut-count').text_content() == '4 条'
    page.locator('#btn-step-next').click()
    page.wait_for_function('document.body.dataset.playing === "false"')
    assert time(page) == 1.2
    assert page.locator('#phase-label').text_content() == '选出最小边'
    page.locator('#btn-step-prev').click()
    assert time(page) == 0

    # Land advances from A toward F before swallowing F; the whole border is then refreshed.
    assert page.locator('#frontier-gates').get_attribute('mask') == 'url(#land-frontier-mask)'
    seek(page, 3.36)
    land = page.locator('[data-land-edge="A-F"]')
    assert 0 < float(land.get_attribute('stroke-dashoffset')) < 1
    assert page.locator('[data-guard-node="F"]').get_attribute('opacity') == '1'
    assert page.locator('[data-land-node="F"]').get_attribute('visibility') == 'hidden'
    assert '正在吞并 F' in page.locator('#hud-text').text_content()
    halfway = page.locator('#map-svg').inner_html()
    page.screenshot(path='/tmp/prim-browser-swallow.png', full_page=True)
    seek(page, 4.2)
    assert page.locator('[data-guard-node="F"]').get_attribute('opacity') == '0'
    assert page.locator('[data-land-node="F"]').get_attribute('r') == '65'
    assert page.locator('[data-frontier-edge="A-F"]').get_attribute('opacity') == '0'
    assert page.locator('[data-frontier-edge="B-F"]').get_attribute('opacity') == '1'
    seek(page, 3.36)
    assert page.locator('#map-svg').inner_html() == halfway
    page.locator('#btn-reset').click()

    # Pause freezes a partial step; changing speed must not jump the clock.
    page.locator('#btn-play').click()
    page.wait_for_function('Number(document.querySelector("#time-label").textContent) > .3')
    page.locator('#btn-play').click()
    frozen = time(page)
    page.wait_for_timeout(250)
    assert time(page) == frozen
    page.locator('#speed').select_option('2')
    assert time(page) == frozen
    page.locator('#btn-play').click()
    page.wait_for_timeout(350)
    page.locator('#btn-play').click()
    advanced = time(page) - frozen
    assert .35 < advanced < 1.25, advanced

    # Rewinding and resampling restore the identical SVG without animation history.
    seek(page, 1.85)
    sample = page.locator('#map-svg').inner_html()
    assert page.locator('#growing-road').get_attribute('stroke-dashoffset') not in ['0', '1']
    seek(page, 15.2)
    seek(page, 1.85)
    replayed = page.locator('#map-svg').inner_html()
    if replayed != sample:
        import difflib
        print('\n'.join(difflib.unified_diff(sample.split('><'), replayed.split('><'))))
    assert replayed == sample
    seek(page, 8)
    page.locator('#capital').select_option('C')
    assert time(page) == 8
    page.locator('[data-preset="dense"]').click()
    assert time(page) == 8
    assert page.locator('#capital').input_value() == 'C'
    page.locator('[data-node="G"]').click()
    assert page.locator('#capital').input_value() == 'G'
    assert time(page) == 8

    # All presets and starts finish with the model's expected MST cost.
    for preset in ['classic', 'dense', 'chain']:
        page.locator('[data-preset="'+preset+'"]').click()
        expected = page.evaluate('key=>PrimModel.buildRun(PrimModel.makeGraph(key),"A").final.cost', preset)
        ids = page.locator('#capital option').evaluate_all('(els)=>els.map(e=>e.value)')
        for capital in ids:
            page.locator('#capital').select_option(capital)
            seek(page, page.locator('#progress').get_attribute('max'))
            assert int(page.locator('#cost-total').text_content()) == expected
            assert page.locator('#phase-label').text_content() == '构建完成'
            assert page.locator('#progress-label').text_content() == ('15 / 15 步' if preset == 'classic' else '18 / 18 步')
            assert page.locator('#btn-step-next').is_disabled()
    page.screenshot(path='/tmp/prim-browser-complete.png', full_page=True)

    # Keyboard actions work outside form controls and leave native controls alone.
    page.locator('body').click(position={'x': 5, 'y': 5})
    page.keyboard.press('Home')
    assert time(page) == 0
    page.keyboard.press('ArrowRight')
    page.wait_for_function('document.body.dataset.playing === "false"')
    assert time(page) == 1.2
    page.locator('#capital').focus()
    page.keyboard.press('Home')
    assert time(page) == 1.2
    # Returning from navigation must leave a playable controller, including BFCache restores.
    page.goto('about:blank')
    page.go_back()
    page.wait_for_load_state('networkidle')
    page.locator('#btn-play').click()
    page.wait_for_function('Number(document.querySelector("#time-label").textContent) > 1.3')
    page.locator('#btn-play').click()
    page.locator('#reduce-motion').check()
    page.locator('#btn-reset').click()
    page.locator('#btn-step-next').click()
    assert time(page) == 1.2
    assert page.locator('#road-layer').get_attribute('visibility') == 'hidden'
    page.locator('#btn-play').click()
    page.wait_for_timeout(550)
    page.locator('#btn-play').click()
    assert page.evaluate('t=>PrimModel.buildRun(PrimModel.makeGraph("chain"),"G").boundaries.some(b=>Math.abs(t-b)<.01)', time(page))

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert page.locator('.map-scroll').evaluate('(e)=>e.scrollWidth > e.clientWidth')
    page.screenshot(path='/tmp/prim-browser-narrow.png', full_page=True)
    assert not errors, errors
    page.close()

    # A shared URL restores exact parameter/time state in a fresh document.
    page, errors = load(browser, base + '#map=dense&capital=F&t=7.25&speed=1.5&motion=full')
    assert time(page) == 7.25
    assert page.locator('#capital').input_value() == 'F'
    assert page.locator('#speed').input_value() == '1.5'
    assert page.locator('[data-preset="dense"]').get_attribute('aria-pressed') == 'true'
    assert not errors
    page.close()

    # No engine: all deterministic controls work; playback has an explicit reason.
    page, errors = load(browser, base, blocked=True)
    assert page.locator('#btn-play').is_disabled()
    assert page.locator('#engine-notice').is_visible()
    page.locator('#btn-step-next').click()
    assert time(page) == 1.2
    page.locator('#btn-step-prev').click()
    assert time(page) == 0
    seek(page, 21)
    assert page.locator('#cost-total').text_content() == '10'
    page.locator('#capital').select_option('E')
    assert page.locator('#cost-total').text_content() == '10'
    page.locator('#btn-reset').click()
    assert time(page) == 0
    assert not errors, errors
    page.close()

    page, errors = load(browser, base, motion='reduce')
    assert page.locator('#reduce-motion').is_checked()
    page.locator('#btn-step-next').click()
    assert time(page) == 1.2
    assert page.locator('#event-tag').get_attribute('visibility') == 'hidden'
    assert not errors
    page.close()
    print('PASS', base)


with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    if not executable:
        candidates = sorted((Path.home() / '.cache/ms-playwright').glob('chromium-*/chrome-linux64/chrome'))
        executable = str(candidates[-1]) if candidates else None
    browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    try:
        run_tests(browser, file_url)
        if http_url:
            run_tests(browser, http_url)
    finally:
        browser.close()
