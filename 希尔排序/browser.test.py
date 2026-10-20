"""Run with Python Playwright. Serve the repository, then pass --base URL.
Optional --gsap PATH serves a local copy of the exact CDN library for reproducible tests.
"""
import argparse
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:8000')
parser.add_argument('--gsap')
parser.add_argument('--chromium', help='Optional installed Chromium executable')
args = parser.parse_args()
url = args.base.rstrip('/') + '/' + quote('希尔排序') + '/index.html'
file_url = Path(__file__).with_name('index.html').resolve().as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100})
    if args.gsap:
        context.route('**/gsap.min.js', lambda route: route.fulfill(path=args.gsap, content_type='application/javascript'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: (errors.append(str(error)), print('PAGE ERROR:', error)))

    def ready(target):
        # Hash parameters are deliberately read only on full document load.
        page.goto('about:blank')
        page.goto(target)
        page.wait_for_load_state('networkidle')
        page.wait_for_function("document.querySelector('#step-label').textContent !== '0 / 0'")

    def seek(value):
        page.locator('#progress').evaluate('(el, value) => {el.value=value; el.dispatchEvent(new Event("input", {bubbles:true}));}', value)

    def time():
        return float(page.locator('#progress').input_value())

    def finish():
        seek(float(page.locator('#progress').get_attribute('max')))

    ready(url)
    assert page.locator('#btn-play').is_enabled(), 'CDN library must load for playback tests'
    assert page.locator('[data-token]').count() == 8
    assert page.locator('#inversion-count').inner_text() == '15'
    assert page.locator('#btn-prev').is_disabled()
    page.screenshot(path='/tmp/shell-desktop.png', full_page=True)
    reverse_time = page.evaluate("ShellModel.buildSequence('counter').reversalTime")
    group_times = page.evaluate("""() => {
      const s=ShellModel.buildSequence('classic');
      const at=kind=>s.steps.findIndex(step=>step.kind===kind && step.after.gap===2 && step.after.group===0);
      return {rise:at('group-lift')+1,shift:at('shift')+.45,insert:at('insert')+1,lower:at('group-lower')+1};
    }""")
    def upper_count():
        return page.locator('[data-token]').evaluate_all('(nodes)=>nodes.filter(n=>n.transform.baseVal.consolidate().matrix.f===ShellChoreo.UPPER_Y).length')
    # A complete four-item group rises; other groups stay in the lower array.
    seek(group_times['rise'])
    assert upper_count() == 4
    assert page.locator('[data-upper-index][visibility=visible]').count() == 4
    assert page.locator('#prefix-label').text_content() == '已排序区 · 1 项'
    page.screenshot(path='/tmp/shell-group-raised.png', full_page=True)
    seek(group_times['shift'])
    assert upper_count() == 3  # one item is held in temp, not moved back to the lower array
    page.screenshot(path='/tmp/shell-group-insertion.png', full_page=True)
    seek(group_times['insert'])
    assert upper_count() == 4
    assert page.locator('#prefix-label').text_content() == '已排序区 · 2 项'
    seek(group_times['lower'])
    assert upper_count() == 0
    assert page.locator('[data-upper-index][visibility=visible]').count() == 0
    page.screenshot(path='/tmp/shell-group-returned.png', full_page=True)
    # All final results, backwards navigation and state restoration.
    finish()
    assert page.locator('#inversion-count').inner_text() == '0'
    assert page.locator('#order-sequence').inner_text() == '当前 a → b'
    assert '不代表算法稳定' in page.locator('#order-caption').inner_text()
    page.locator('#btn-prev').click()
    assert page.locator('#btn-next').is_enabled()
    page.locator('#btn-reset').click()
    page.locator('#btn-next').click()
    assert time() == 1
    page.locator('#btn-next').click()
    assert time() == 2
    # Fractional t redraw is exactly reproducible after visiting the endpoint.
    seek(4.45)
    transforms = page.locator('[data-token]').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("transform"))')
    finish()
    seek(4.45)
    assert page.locator('[data-token]').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("transform"))') == transforms
    page.screenshot(path='/tmp/shell-fraction.png', full_page=True)
    # Pause freezes the current action; changing speed affects the current timeline.
    seek(3.2)
    page.locator('#btn-play').click()
    page.wait_for_function("Number(document.querySelector('#progress').value) > 3.3")
    page.locator('#btn-play').click()
    paused = time()
    page.wait_for_timeout(300)
    assert abs(time() - paused) < .001
    page.locator('#speed').select_option('2')
    page.locator('#btn-play').click()
    assert page.evaluate('gsap.globalTimeline.getChildren(false,true,true).some(animation => animation.timeScale() === 2)')
    assert paused < 4, 'first playback after arbitrary seeks must not inherit an endpoint as its start'
    page.wait_for_function('(before) => Number(document.querySelector("#progress").value) > before + .35', arg=paused)
    page.locator('#btn-play').click()
    # Case changes retain and clamp the current time, pause, and update all tokens.
    seek(reverse_time)
    page.locator('[data-case=counter]').click()
    assert time() == reverse_time and page.locator('[data-token]').count() == 4
    assert page.locator('#order-sequence').inner_text() == '当前 b → a'
    page.locator('[data-reversal]').click()
    assert time() == reverse_time
    page.screenshot(path='/tmp/shell-counter.png', full_page=True)
    finish()
    assert page.locator('#inversion-count').inner_text() == '0'
    assert '不稳定' in page.locator('#narration').inner_text()
    # Reduced mode snaps, has no token motion between events, and can play.
    page.locator('#reduce-motion').check()
    page.locator('#btn-reset').click()
    seek(2.3)
    assert time() == 2
    page.locator('#btn-play').click()
    page.wait_for_function("Number(document.querySelector('#progress').value) >= 3")
    page.locator('#btn-play').click()
    assert time().is_integer()
    page.locator('#reduce-motion').uncheck()
    seek(2.2)
    page.locator('#btn-play').click()
    page.locator('#reduce-motion').check()
    assert page.locator('body').get_attribute('data-playing') == 'true'
    assert time().is_integer()
    page.locator('#btn-play').click()
    # Snapping the last action to its end must stop, not restart playback.
    page.locator('#reduce-motion').uncheck()
    seek(float(page.locator('#progress').get_attribute('max')) - .9)
    page.locator('#btn-play').click()
    page.locator('#reduce-motion').check()
    assert page.locator('body').get_attribute('data-playing') == 'false'
    assert time() == float(page.locator('#progress').get_attribute('max'))
    # Keyboard shortcuts work on body and never hijack native range keys.
    page.locator('body').click(position={'x': 3, 'y': 3})
    page.keyboard.press('Home')
    assert time() == 0
    page.keyboard.press('ArrowRight')
    assert time() == 1
    page.locator('#progress').focus()
    page.keyboard.press('Home')
    assert time() == 0
    # A hash replay restores the full state, and invalid values are sanitized.
    seek(reverse_time)
    restored_url = page.url
    ready(restored_url)
    assert time() == reverse_time
    assert page.locator('[data-case=counter]').get_attribute('aria-pressed') == 'true'
    assert page.locator('#reduce-motion').is_checked()
    ready(url + '#case=bad&t=NaN&speed=99&motion=full')
    assert time() == 0
    assert page.locator('[data-token]').count() == 8
    assert page.locator('#speed').input_value() == '1'
    # Automatic background pause (visibility is supplied deterministically).
    page.locator('#btn-play').click()
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange'))")
    assert page.locator('body').get_attribute('data-playing') == 'false'
    paused = time()
    page.wait_for_timeout(150)
    assert time() == paused
    # Narrow layouts retain a local scrollable stage without document overflow.
    for width in [390, 768, 1024]:
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow at {width}'
    page.set_viewport_size({'width': 390, 'height': 1000})
    page.screenshot(path='/tmp/shell-narrow.png', full_page=True)
    # file:// supports the same classic-script implementation.
    ready(file_url + f'#case=counter&t={reverse_time}&motion=full')
    assert page.locator('#order-sequence').inner_text() == '当前 b → a'
    assert page.locator('#btn-play').is_enabled()
    assert not errors, errors
    context.close()

    # No animation engine: every teaching state remains accessible, including file://.
    fallback = browser.new_context(viewport={'width': 1280, 'height': 1000}, reduced_motion='reduce')
    fallback.route('**/gsap.min.js', lambda route: route.abort())
    page = fallback.new_page()
    fallback_errors = []
    page.on('pageerror', lambda error: fallback_errors.append(str(error)))
    for target in [url, file_url]:
        ready(target)
        assert page.locator('#btn-play').is_disabled()
        assert page.locator('#engine-notice').is_visible()
        assert page.locator('#reduce-motion').is_checked()
        page.locator('#btn-next').click()
        assert time() == 1
        page.locator('[data-case=counter]').click()
        page.locator('[data-reversal]').click()
        assert page.locator('#order-sequence').inner_text() == '当前 b → a'
        finish()
        assert page.locator('#inversion-count').inner_text() == '0'
    assert not fallback_errors, fallback_errors
    fallback.close()
    browser.close()
    print('PASS: whole-group rise, upstairs insertion and prefix growth, complete-group return, static/file, replay, controls, speed, keyboard, hash, background pause, narrow overflow, reduced motion, engine fallback; no JS errors')
