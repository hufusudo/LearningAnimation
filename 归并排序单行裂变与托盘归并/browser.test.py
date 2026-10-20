"""Playwright regression test; defaults to file://, accepts a static-server URL.
Optional env: CHROMIUM_EXECUTABLE, GSAP_FIXTURE (local copy for repeatable tests).
"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name('index.html').as_uri()


def seek(page, time):
    page.locator('#progress').evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input"))}', time)


def current(page):
    return float(page.locator('#stage-svg').get_attribute('data-time'))


def event_times(page):
    return page.evaluate('''() => {
      const s=MergeModel.build(), out=[]; let t=0;
      s.events.forEach(e=>{out.push({kind:e.kind,start:t,end:t+e.duration,tie:e.tie});t+=e.duration});return out;
    }''')


with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('CHROMIUM_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1440, 'height': 1050})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    if os.environ.get('GSAP_FIXTURE'):
        page.route('**/gsap.min.js', lambda r: r.fulfill(path=os.environ['GSAP_FIXTURE'], content_type='application/javascript'))
    page.goto(URL, wait_until='networkidle')
    assert page.evaluate('!!window.gsap'), 'GSAP must load for animation checks'
    total = float(page.locator('#progress').get_attribute('max'))
    times = event_times(page)
    assert current(page) == 0
    assert page.locator('#btn-prev').is_disabled()
    assert page.locator('#tray-layer > g').get_attribute('visibility') == 'hidden'
    page.screenshot(path='/tmp/merge-desktop.png', full_page=True)

    # Deterministic seek (including after an earlier backward seek).
    seek(page, 7.35)
    transforms = page.locator('#cards-layer > g').evaluate_all('(els)=>Object.fromEntries(els.map(el=>[el.dataset.card,el.getAttribute("transform")]))')
    seek(page, 60)
    seek(page, 7.35)
    assert transforms == page.locator('#cards-layer > g').evaluate_all('(els)=>Object.fromEntries(els.map(el=>[el.dataset.card,el.getAttribute("transform")]))')
    page.locator('#btn-reset').click()
    page.locator('#btn-next').click()
    page.wait_for_function('Number(document.querySelector("#stage-svg").dataset.time)>=1.1')
    assert abs(current(page) - times[0]['end']) < .001
    assert page.locator('#play-label').inner_text() == '播放'

    # Pause freezes the exact intermediate pose; resume and speed affect this clock.
    page.locator('#btn-play').click()
    page.wait_for_timeout(320)
    page.locator('#btn-play').click()
    frozen = current(page)
    assert frozen > 1.1
    page.wait_for_timeout(180)
    assert current(page) == frozen
    page.locator('#btn-play').click()
    page.locator('#speed').evaluate('(el)=>{el.value=3;el.dispatchEvent(new Event("input"))}')
    start = current(page)
    page.wait_for_timeout(350)
    page.locator('#btn-play').click()
    assert .65 < current(page) - start < 1.8

    # A paused single-step can become continuous playback; reset cancels its clock.
    page.locator('#btn-reset').click()
    page.locator('#btn-next').click()
    page.wait_for_timeout(130)
    page.locator('#btn-play').click()
    page.locator('#btn-play').click()
    page.wait_for_timeout(650)
    page.locator('#btn-play').click()
    assert current(page) > times[0]['end']
    page.locator('#btn-reset').click()
    page.wait_for_timeout(200)
    assert current(page) == 0

    # Visibility change pauses rather than silently advancing in the background.
    page.locator('#btn-play').click()
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;}''')
    hidden_clock = current(page)
    page.wait_for_timeout(150)
    assert current(page) == hidden_clock
    assert page.locator('#play-label').inner_text() == '播放'

    # Every identity stays in the same SVG node throughout a flight.
    take = next(e for e in times if e['kind'] == 'take')
    seek(page, take['start'] + (take['end']-take['start'])*.47)
    assert page.locator('#cards-layer > g').count() == 8
    assert float(page.locator('#flight-path').get_attribute('opacity')) > 0
    page.screenshot(path='/tmp/merge-flight.png', full_page=True)
    tie = next(e for e in times if e.get('tie'))
    seek(page, tie['end'])
    assert '等值取左' in page.locator('#comparison').text_content()
    assert page.locator('#event-tag').get_attribute('visibility') == 'visible'
    page.screenshot(path='/tmp/merge-tie.png', full_page=True)

    # Reduced motion goes to event boundaries and pauses there for 0.9 / speed seconds.
    page.locator('#reduced-motion').check()
    page.locator('#btn-reset').click()
    page.locator('#btn-next').click()
    assert abs(current(page)-times[0]['end']) < .001
    page.locator('#btn-prev').click()
    assert current(page) == 0
    page.locator('#speed').evaluate('(el)=>{el.value=1;el.dispatchEvent(new Event("input"))}')
    page.locator('#btn-play').click()
    page.wait_for_timeout(220)
    assert current(page) == 0
    page.wait_for_timeout(820)
    assert abs(current(page)-times[0]['end']) < .001
    page.locator('#btn-play').click()

    # Presets keep the clock and pause; final order retains equal-value identities.
    seek(page, 20)
    page.locator('#preset').select_option('duplicates')
    assert current(page) == 20
    assert page.locator('#play-label').inner_text() == '播放'
    seek(page, float(page.locator('#progress').get_attribute('max')))
    ordered = page.locator('#cards-layer > g').evaluate_all(r'''els=>els.map(el=>({id:Number(el.dataset.card),x:Number(el.getAttribute('transform').match(/translate\(([-.\d]+)/)[1])})).sort((a,b)=>a.x-b.x).map(c=>c.id)''')
    assert ordered == [1,3,5,7,0,2,4,6]
    page.locator('#preset').select_option('classic')
    page.get_by_role('button', name='完整有序', exact=True).click()
    assert page.locator('#stat-cmp').inner_text() == '16'
    assert page.locator('#stat-mv').inner_text() == '24'
    assert page.locator('#btn-next').is_disabled()
    page.screenshot(path='/tmp/merge-complete.png', full_page=True)

    # Hash restoration, keyboard focus protection and narrow viewport containment.
    seek(page, 12.3)
    page.reload(wait_until='networkidle')
    assert abs(current(page)-12.3) < .001
    page.locator('#preset').focus()
    page.keyboard.press('Home')
    assert abs(current(page)-12.3) < .001
    page.locator('body').click(position={'x': 2, 'y': 2})
    page.keyboard.press('Home')
    assert current(page) == 0
    for width in [375,660,900,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'page overflow at {width}'
    page.set_viewport_size({'width':375,'height':1000})
    page.screenshot(path='/tmp/merge-narrow.png', full_page=True)

    # No CDN engine: still browse every state, including final stable order.
    fallback = browser.new_page(viewport={'width':1440,'height':1050})
    fallback.on('pageerror', lambda error: errors.append(str(error)))
    fallback.route('**/gsap.min.js', lambda r: r.abort())
    fallback.goto(URL, wait_until='networkidle')
    assert fallback.locator('#btn-play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    fallback.locator('#btn-next').click()
    assert abs(current(fallback)-times[0]['end']) < .001
    fallback.get_by_role('button', name='完整有序', exact=True).click()
    assert fallback.locator('#stat-mv').inner_text() == '24'
    assert not errors, errors
    browser.close()
    print('PASS: playback, reversible seek, stable IDs, reduced motion, presets, hash, keyboard, overflow and no-GSAP fallback:', URL)
