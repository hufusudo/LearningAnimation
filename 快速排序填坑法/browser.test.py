"""Browser regression checks. Requires Playwright + Chromium.
Run: python browser.test.py [http://localhost:8000/快速排序填坑法/index.html]
Without a URL, tests the sibling index.html through file://.
"""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright


def seek(page, time):
    page.locator('#progress').evaluate(
        '(el,t)=>{el.value=t;el.dispatchEvent(new Event("input"))}', time)


def current(page):
    return float(page.locator('#array-svg').get_attribute('data-time'))


def end(page):
    seek(page, float(page.locator('#progress').get_attribute('max')))


url = sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name('index.html').as_uri()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle')
    assert page.evaluate('!!window.gsap'), 'GSAP required for the animation checks'

    # Regression: a seek before first playback must not alter the tween start.
    seek(page, 3.45)
    page.locator('#btn-reset').click()
    assert current(page) == 0
    page.locator('#btn-next').click()
    page.wait_for_function('document.querySelector("#array-svg").dataset.time==="1.00000"')
    assert page.locator('#btn-play').inner_text() == '▶ 播放'
    page.locator('#btn-play').click()
    page.wait_for_timeout(250)
    page.locator('#btn-play').click()
    frozen = current(page)
    assert 1 < frozen < 2
    page.wait_for_timeout(250)
    assert current(page) == frozen
    page.locator('#btn-play').click()
    page.locator('#speed-select').select_option('2')
    start = current(page)
    page.wait_for_timeout(450)
    page.locator('#btn-play').click()
    assert .5 < current(page) - start < 1.5

    page.locator('#reduce-motion').check()
    seek(page, 4)
    page.locator('#btn-next').click()
    assert current(page) == 5
    page.locator('#reduce-motion').uncheck()
    page.locator('#mode-single').click()
    end(page)
    assert '未保证全局有序' in page.locator('#narration').inner_text()
    assert page.locator('#stat-locked').inner_text() == '1 / 7'
    page.locator('#input-array').fill('1,,2')
    page.get_by_role('button', name='应用序列').click()
    assert page.locator('#input-error').inner_text()
    page.locator('#input-array').fill('8')
    page.get_by_role('button', name='应用序列').click()
    end(page)
    assert page.locator('#narration').inner_text() == '单元素本身有序'
    page.locator('#mode-recursive').click()
    page.locator('#preset-select').select_option('sorted')
    end(page)
    assert page.locator('#stat-comparisons').inner_text() == '21'
    assert page.locator('#stat-locked').inner_text() == '7 / 7'
    assert page.locator('#stack-depth').inner_text() == '0 层'
    for width in [375, 660, 900, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    seek(page, 12.45)
    page.reload(wait_until='networkidle')
    assert abs(current(page) - 12.45) < .001

    fallback = browser.new_page(reduced_motion='reduce')
    fallback.on('pageerror', lambda error: errors.append(str(error)))
    fallback.route('**/gsap.min.js', lambda route: route.abort())
    fallback.goto(url, wait_until='networkidle')
    assert fallback.locator('#btn-play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    assert fallback.locator('#reduce-motion').is_checked()
    fallback.locator('#btn-next').click()
    assert current(fallback) == 1
    end(fallback)
    assert fallback.locator('#stat-locked').inner_text() == '7 / 7'
    assert not errors, errors
    browser.close()
print('PASS: playback, seek/reset regression, steps, speed, reduced motion, input, modes, hash, widths and GSAP fallback')
