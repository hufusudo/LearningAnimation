"""Run with a static server on :8127 (or pass the base URL as the first argument)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import sys

MODULE = Path(__file__).resolve().parent
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8127/')
URL = BASE.rstrip('/') + '/' + MODULE.name + '/index.html'
ARTIFACTS = Path('/tmp/marginal-qa')
ARTIFACTS.mkdir(exist_ok=True)


def slider(page, selector, value):
    page.locator(selector).evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}', value)


def state(page):
    return page.evaluate('''() => ({
        t: Number(document.querySelector('#progress').value),
        u: Number(document.querySelector('#slice').value),
        area: Number(document.querySelector('#area-value').textContent),
        marginal: Number(document.querySelector('#marginal-value').textContent),
        section: document.querySelector('#section-line').getAttribute('d'),
        trace: document.querySelector('#marginal-trace').getAttribute('d'),
        conditional: document.querySelector('#conditional-line').getAttribute('d'),
        post: document.querySelector('#marginal-post').getAttribute('y2'),
        hash: location.hash
    })''')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    assert page.locator('#engine-notice').is_hidden(), 'Online GSAP did not load'
    assert state(page)['area'] == .3521
    assert page.locator('#rho').input_value() == '0.4'
    slider(page, '#progress', 9.8)
    before = state(page)
    slider(page, '#progress', 1)
    slider(page, '#progress', 9.8)
    after = state(page)
    for key in ['u', 'area', 'section', 'post']:
        assert before[key] == after[key], ('reverse redraw', key)
    page.screenshot(path=str(ARTIFACTS / 'normal-transfer.png'), full_page=True)

    # Correlation changes the section, preserving time and the full marginal.
    slider(page, '#rho', -.8)
    changed = state(page)
    assert changed['t'] == 9.8 and changed['area'] == before['area']
    assert changed['section'] != before['section']
    page.locator('[data-dir=y]').click()
    assert page.locator('#section-axis-label').text_content() == 'x'
    assert page.locator('#marginal-axis-label').text_content() == 'y'
    assert state(page)['area'] == before['area']

    # Finite-domain geometry, zero-area conditionals and endpoint controls.
    page.locator('[data-model=triangle]').click()
    assert state(page)['t'] == 9.8
    slider(page, '#slice', 1)
    assert state(page)['area'] == .5
    page.locator('#conditional').check()
    assert '全域积分 = 1' in page.locator('#conditional-readout').inner_text()
    slider(page, '#slice', 2)
    assert state(page)['area'] == 0
    assert '不能' in page.locator('#conditional-readout').inner_text()
    assert state(page)['conditional'] == ''
    page.screenshot(path=str(ARTIFACTS / 'triangle-zero.png'), full_page=True)
    slider(page, '#slice', 0)
    page.locator('[data-model=normal]').click()
    assert state(page)['u'] == -3, 'Slider range must update before value'
    assert page.locator('#slice-output').inner_text() == '-3.00'

    page.locator('[data-model=ramp]').click()
    slider(page, '#slice', 1)
    assert state(page)['area'] == .5
    page.locator('#conditional').uncheck()
    page.locator('#surface').uncheck()
    page.locator('#surface').check()
    for view in ['front', 'top', 'default']:
        page.locator('#view-' + view).click()
        assert page.locator('#view-' + view).get_attribute('aria-pressed') == 'true'
    slider(page, '#progress', 16)
    assert state(page)['trace']
    assert state(page)['area'] == .5
    assert page.locator('#next').is_disabled()
    page.screenshot(path=str(ARTIFACTS / 'ramp-complete.png'), full_page=True)

    # Playback pause/resume and rate changes act on the current clock.
    page.locator('#reset').click()
    page.locator('#play').click()
    page.wait_for_timeout(350)
    page.locator('#play').click()
    paused = state(page)['t']
    assert paused > .1
    page.wait_for_timeout(180)
    assert state(page)['t'] == paused
    page.locator('#speed').select_option('2')
    page.locator('#play').click()
    page.wait_for_timeout(350)
    page.locator('#play').click()
    assert state(page)['t'] > paused + .45

    # Named boundaries, keyboard and reduced-motion switching during playback.
    slider(page, '#progress', 7)
    page.locator('#previous').click()
    assert state(page)['t'] == 4
    page.locator('#next').click()
    assert state(page)['t'] == 7
    page.locator('h1').click()
    page.keyboard.press('Home')
    assert state(page)['t'] == 0
    page.keyboard.press('ArrowRight')
    assert state(page)['t'] == 2
    page.locator('#play').click()
    page.locator('#reduced-motion').check()
    assert page.locator('#play').inner_text() == '暂停演示'
    page.wait_for_timeout(600)
    assert state(page)['t'] >= 4
    page.locator('#play').click()
    page.locator('#reduced-motion').uncheck()

    # Save/reload retains model, direction, selected cut and teaching time.
    slider(page, '#progress', 9.8)
    slider(page, '#slice', .7)
    expected = state(page)
    page.reload(wait_until='networkidle')
    actual = state(page)
    for key in ['t', 'u', 'area', 'section', 'post']:
        assert expected[key] == actual[key], ('hash restore', key)

    # Dragged view and container resize are supported, including narrow widths.
    bridge_before = page.locator('#bridge-line').get_attribute('d')
    canvas = page.locator('canvas').bounding_box()
    page.mouse.move(canvas['x']+150, canvas['y']+150)
    page.mouse.down();page.mouse.move(canvas['x']+225, canvas['y']+170,steps=6);page.mouse.up()
    assert 'yaw=' in state(page)['hash']
    assert page.locator('#bridge-line').get_attribute('d') != bridge_before
    for width in [1280, 820, 390]:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
    page.screenshot(path=str(ARTIFACTS / 'narrow.png'), full_page=True)

    # A file:// page also supports the normal engine-backed playback path.
    local = browser.new_page(viewport={'width': 1280, 'height': 1000})
    local.on('pageerror', lambda e: errors.append(str(e)))
    local.goto(MODULE.joinpath('index.html').as_uri(), wait_until='networkidle')
    assert not local.locator('#play').is_disabled()
    local.locator('#play').click()
    local.wait_for_timeout(180)
    local.locator('#play').click()
    assert state(local)['t'] > 0
    local.close()

    # Missing engine: file:// still renders all graphs and accepts all manual controls.
    offline = browser.new_page(viewport={'width': 1280, 'height': 1000}, reduced_motion='reduce')
    offline.on('pageerror', lambda e: errors.append(str(e)))
    offline.route('https://**/*', lambda route: route.abort())
    offline.goto(MODULE.joinpath('index.html').as_uri(),wait_until='networkidle')
    assert offline.locator('#play').is_disabled()
    assert offline.locator('#engine-notice').is_visible()
    assert offline.locator('#reduced-motion').is_checked()
    assert state(offline)['section']
    offline.locator('[data-model=triangle]').click()
    slider(offline, '#slice', 1)
    offline.locator('#next').click()
    assert state(offline)['t'] == 2 and state(offline)['area'] == .5
    slider(offline, '#progress', 10)
    assert state(offline)['trace']
    offline.screenshot(path=str(ARTIFACTS / 'file-no-engine.png'),full_page=True)
    assert not errors, errors
    print(json.dumps({'status':'PASS','checks':['models','cut-directions','correlation','zero-area','reverse-redraw','play-pause-speed','keyboard','reduced-motion','hash-restore','camera','narrow-layout','file-no-engine'],'page_errors':errors,'screenshots':str(ARTIFACTS)},ensure_ascii=False))
    browser.close()
