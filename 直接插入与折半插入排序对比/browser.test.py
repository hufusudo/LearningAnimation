"""Run with a static server at INSERTION_TEST_URL; also checks file://.
Optional PLAYWRIGHT_CHROMIUM_EXECUTABLE selects an installed Chromium.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('INSERTION_TEST_URL', 'http://127.0.0.1:8765')
MODULE = Path(__file__).resolve().parent
URL = BASE + '/' + MODULE.name + '/index.html'


def seek(page, time):
    page.locator('#step-slider').evaluate('(el, value) => { el.value = value; el.dispatchEvent(new Event("input", {bubbles:true})); }', time)


def traces(page, mode='binary'):
    return page.evaluate('(mode) => InsertionModel.buildTrace(InsertionModel.makeItems(InsertionModel.SAMPLE), mode)', mode)


with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):
        options['executable_path'] = os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1440, 'height': 1200})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    assert page.locator('.value-tile').count() == 8
    assert page.locator('#play-button').is_enabled(), 'GSAP CDN did not load'
    # Every event snapshot lands each persistent tile exactly in its slot/temp.
    for mode in ['direct', 'binary']:
        page.locator('#mode-' + mode).click()
        assert page.evaluate('''mode => {
          const steps = InsertionModel.buildTrace(InsertionModel.makeItems(InsertionModel.SAMPLE), mode);
          const slider = document.getElementById('step-slider');
          return steps.every((state, time) => {
            slider.value = time;
            slider.dispatchEvent(new Event('input', {bubbles: true}));
            return state.array.filter(Boolean).concat(state.temp || []).every(item => {
              const slot = state.temp && state.temp.id === item.id ? document.getElementById('temp-slot') :
                document.querySelector('.array-slot[data-index="' + state.array.findIndex(x => x && x.id === item.id) + '"]');
              const tile = document.querySelector('.value-tile[data-item-id="' + item.id + '"]');
              const a = slot.getBoundingClientRect(), b = tile.getBoundingClientRect();
              return Math.abs(a.x + a.width/2 - b.x - b.width/2) < 0.7 && Math.abs(a.y + a.height/2 - b.y - b.height/2) < 0.7;
            });
          });
        }''', mode), mode + ' tile geometry'
    page.locator('#mode-binary').click()
    steps = traces(page)
    narrow = next(i for i, s in enumerate(steps) if s['phase'] == 'narrow')
    seek(page, narrow - 1)
    old = page.locator('.pointer-high').bounding_box()['x']
    seek(page, narrow - 0.56)
    middle = page.locator('.pointer-high').bounding_box()['x']
    seek(page, narrow)
    new = page.locator('.pointer-high').bounding_box()['x']
    assert min(old, new) < middle < max(old, new), (old, middle, new)
    assert '-1' in page.locator('.pointer-high').inner_text()
    page.locator('.array-stage').screenshot(path='/tmp/insertion-narrow.png')
    # Position and the next round's wider range, including coincident low/mid/high.
    position = next(i for i, s in enumerate(steps) if s['phase'] == 'position')
    seek(page, position)
    assert '区间为空' in page.locator('#pointer-summary').inner_text()
    assert '插入' in page.locator('#stage-cue').inner_text()
    later = next(i for i, s in enumerate(steps) if s['phase'] == 'locate' and s['i'] >= 5)
    seek(page, later)
    page.screenshot(path='/tmp/insertion-desktop.png', full_page=True)
    # Same time is deterministic after forward/backward seeks.
    seek(page, later - 0.5)
    transform = page.locator('.pointer-mid').get_attribute('style')
    seek(page, 0)
    seek(page, later - 0.5)
    assert page.locator('.pointer-mid').get_attribute('style') == transform
    # Pause freezes the current in-step geometry; speed changes keep the same playhead.
    page.locator('#play-button').click()
    page.wait_for_timeout(250)
    page.locator('#play-button').click()
    time = float(page.locator('#step-slider').input_value())
    tile_style = page.locator('.value-tile').first.get_attribute('style')
    page.wait_for_timeout(350)
    assert float(page.locator('#step-slider').input_value()) == time
    assert page.locator('.value-tile').first.get_attribute('style') == tile_style
    page.locator('#speed-select').select_option('520')
    assert float(page.locator('#step-slider').input_value()) == time
    page.locator('#play-button').click()
    page.wait_for_timeout(250)
    page.locator('#play-button').click()
    assert float(page.locator('#step-slider').input_value()) > time
    # Single step stops on exact event boundary, including reverse.
    page.locator('#reset-button').click()
    page.locator('#next-button').click()
    page.wait_for_timeout(900)
    assert float(page.locator('#step-slider').input_value()) == 1
    page.locator('#previous-button').click()
    page.wait_for_timeout(900)
    assert float(page.locator('#step-slider').input_value()) == 0
    # Finishing, switching mode and reset leave no old callback writing into the scene.
    seek(page, len(steps) - 1)
    assert page.locator('#next-button').is_disabled()
    assert '全部' in page.locator('#pointer-summary').inner_text()
    page.locator('#mode-direct').click()
    page.locator('#play-button').click()
    page.wait_for_timeout(200)
    page.locator('#mode-binary').click()
    page.wait_for_timeout(300)
    assert float(page.locator('#step-slider').input_value()) == 0
    # Reduced motion uses complete event states with no in-between geometry.
    page.locator('#reduce-motion').check()
    page.locator('#next-button').click()
    assert float(page.locator('#step-slider').input_value()) == 1
    page.locator('#play-button').click()
    page.wait_for_timeout(200)
    assert float(page.locator('#step-slider').input_value()).is_integer()
    page.locator('#play-button').click()
    for width in [1180, 800, 390, 320]:
        page.set_viewport_size({'width': width, 'height': 844})
        page.wait_for_timeout(50)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'page overflow at ' + str(width)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path='/tmp/insertion-narrow-screen.png', full_page=True)
    assert not errors, errors
    page.close()
    local = browser.new_page()
    local.goto(MODULE.joinpath('index.html').as_uri())
    local.wait_for_load_state('networkidle')
    assert local.locator('#play-button').is_enabled()
    seek(local, 5.44)
    assert float(local.locator('#step-slider').input_value()) == 5.44
    local.close()
    # file:// works and missing engine leaves step/seek functional.
    for url in [URL, MODULE.joinpath('index.html').as_uri()]:
        context = browser.new_context(reduced_motion='reduce')
        context.route('**/gsap.min.js', lambda route: route.abort())
        fallback = context.new_page()
        fallback.on('pageerror', lambda error: errors.append(str(error)))
        fallback.goto(url)
        fallback.wait_for_load_state('networkidle')
        assert fallback.locator('#reduce-motion').is_checked()
        assert fallback.locator('#play-button').is_disabled()
        assert fallback.locator('#engine-notice').is_visible()
        fallback.locator('#mode-binary').click()
        fallback.locator('#next-button').click()
        assert float(fallback.locator('#step-slider').input_value()) == 1
        seek(fallback, 8)
        assert float(fallback.locator('#step-slider').input_value()) == 8
        context.close()
    assert not errors, errors
    browser.close()
    print('Insertion browser checks passed (HTTP, file://, pause, seek, step, reduced motion, fallback, overflow).')
