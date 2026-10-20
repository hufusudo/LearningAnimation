"""Browser acceptance: python browser.test.py [URL]. Uses local Playwright Chromium."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
URL = sys.argv[1] if len(sys.argv) > 1 else ROOT.joinpath('index.html').as_uri()
OUT = Path('/tmp/cauchy-acceptance')
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1120}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='networkidle')
    page.locator('#next').wait_for()
    assert page.locator('#root-buttons button').count() == 2
    page.screenshot(path=str(OUT / 'initial.png'), full_page=True)
    def slider(selector, value):
        page.locator(selector).evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}', str(value))
    # Forward/backward seeking draws exactly the same geometry, including captions.
    slider('#progress', 37)
    first = page.locator('#plane').inner_html()
    slider('#progress', 90)
    slider('#progress', 5)
    slider('#progress', 37)
    assert page.locator('#plane').inner_html() == first
    page.locator('#replay').click()
    page.locator('#next').click()
    assert page.locator('#clock').inner_text() == '2.00 s'
    page.locator('#prev').click()
    assert page.locator('#clock').inner_text() == '0.00 s'
    for key in ['cubic', 'elliptic', 'multi-xi', 'lagrange', 'rolle']:
        page.locator('[data-preset="' + key + '"]').click()
        assert page.locator('#condition').inner_text()
        roots = page.locator('#root-buttons button')
        assert roots.count() > 0
        for i in range(roots.count()):
            roots.nth(i).click()
            assert page.locator('#angle-value').inner_text() == '0.00°', key
            assert page.locator('#point-label').text_content() == 'P(ξ)', key
        slider('#progress', 100)
        assert page.locator('#match-tag').get_attribute('opacity') == '1'
    # A parallel endpoint must never be called the theorem's interior xi.
    page.locator('[data-preset="multi-xi"]').click()
    slider('#a', -1)
    slider('#b', 2)
    slider('#t', -1)
    assert page.locator('#point-label').text_content() == 'P(t)'
    assert 'F′(ξ)' not in page.locator('#aux-receipt').inner_text()
    assert '开区间' in page.locator('#narration').inner_text()
    # Same-x endpoints yield a vertical chord: valid geometric observation, invalid ratio form.
    page.locator('[data-preset="elliptic"]').click()
    slider('#a', -1)
    slider('#b', 1)
    assert 'warning' in page.locator('#condition').get_attribute('class')
    assert page.locator('#secant-value').inner_text() == '竖直'
    page.locator('#root-buttons button').first.click()
    assert page.locator('#tangent-value').inner_text() == '竖直'
    assert page.locator('#angle-value').inner_text() == '0.00°'
    page.locator('[data-preset="multi-xi"]').click()
    slider('#progress', 100)
    page.screenshot(path=str(OUT / 'completed.png'), full_page=True)
    # Slider interaction and a real pointer drag change P and restore the demonstration.
    slider('#t', .31)
    assert page.locator('#mode-label').inner_text() == '自由观察'
    before = page.locator('#handle-p').get_attribute('transform')
    point = page.locator('#handle-p').bounding_box()
    page.mouse.move(point['x'] + point['width'] / 2, point['y'] + point['height'] / 2)
    page.mouse.down()
    page.mouse.move(point['x'] + 90, point['y'] - 25, steps=10)
    page.mouse.up()
    assert page.locator('#handle-p').get_attribute('transform') != before
    page.locator('#resume-demo').click()
    assert page.locator('#mode-label').inner_text() == '分步演示'
    # Actual timeline playback, pause freeze, rate change, and keyboard.
    engine = not page.locator('#play').is_disabled()
    if engine:
        page.locator('#replay').click()
        page.locator('#play').click()
        page.wait_for_timeout(350)
        page.locator('#play').click()
        frozen = page.locator('#progress').input_value()
        assert float(frozen) > 0
        page.wait_for_timeout(200)
        assert page.locator('#progress').input_value() == frozen
        page.locator('#speed').select_option('2')
        page.locator('#play').click()
        page.wait_for_timeout(300)
        page.locator('#play').click()
        assert float(page.locator('#progress').input_value()) - float(frozen) > 3
        page.locator('#reduced').check()
        page.locator('#replay').click()
        page.locator('#play').click()
        page.wait_for_timeout(550)
        page.locator('#play').click()
        assert float(page.locator('#progress').input_value()) > 0
    page.locator('body').click(position={"x": 1, "y": 1})
    page.keyboard.press('Home')
    assert page.locator('#clock').inner_text() == '0.00 s'
    page.keyboard.press('ArrowRight')
    assert page.locator('#clock').inner_text() == '2.00 s'
    for width in [820, 390]:
        page.set_viewport_size({"width": width, "height": 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
    page.screenshot(path=str(OUT / 'narrow.png'), full_page=True)
    # Native local-file loading is required alongside HTTP.
    page.goto(ROOT.joinpath('index.html').as_uri(), wait_until='networkidle')
    assert page.locator('#root-buttons button').count() == 2
    # Engine unavailable: all meaningful static operations still work.
    fallback = browser.new_page()
    fallback.on('pageerror', lambda error: errors.append(str(error)))
    fallback.route('**/*gsap*', lambda route: route.abort())
    fallback.goto(ROOT.joinpath('index.html').as_uri(), wait_until='networkidle')
    assert fallback.locator('#play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    fallback.locator('#next').click()
    assert fallback.locator('#clock').inner_text() == '2.00 s'
    fallback.locator('#root-buttons button').first.click()
    assert fallback.locator('#angle-value').inner_text() == '0.00°'
    # System reduced motion preference is honored on first render.
    reduced = browser.new_page(reduced_motion='reduce')
    reduced.on('pageerror', lambda error: errors.append(str(error)))
    reduced.goto(ROOT.joinpath('index.html').as_uri(), wait_until='networkidle')
    assert reduced.locator('#reduced').is_checked()
    assert reduced.locator('body').get_attribute('data-motion') == 'reduced'
    assert not errors, errors
    print(json.dumps({"result": "PASS", "engine_loaded": engine, "page_errors": errors, "screenshots": str(OUT), "url": URL}, ensure_ascii=False))
    browser.close()
