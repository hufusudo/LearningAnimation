from pathlib import Path
from playwright.sync_api import sync_playwright
import os
ROOT=Path(__file__).resolve().parent
BASE=os.environ.get('TEST_BASE', ROOT.as_uri()+'/index.html')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.locator('#next').click()
    assert page.locator('[data-time="1"]').get_attribute('aria-current')=='step'
    assert page.locator('#narration').evaluate('(el)=>Number(getComputedStyle(el).opacity)')==1
    page.locator('#next').click()
    assert page.locator('#area').inner_text()=='0.352'
    page.locator('#next').click()
    page.locator('#next').click()
    assert float(page.locator('#probability').inner_text())>0
    page.screenshot(path='/tmp/conditional-desktop.png',full_page=True)
    first=page.locator('#chart').inner_html()
    page.locator('#prev').click()
    page.locator('#next').click()
    assert page.locator('#chart').inner_html()==first
    for model in ['triangle','ramp','normal']:
        page.locator('[data-model='+model+']').click()
        for direction in ['x','y']:
            page.locator('#direction').select_option(direction)
            assert 'NaN' not in page.locator('#scene').inner_html()
            assert 'NaN' not in page.locator('#chart').inner_html()
    page.locator('[data-model=triangle]').click()
    page.locator('#direction').select_option('y')
    page.locator('#slice').fill('2')
    assert page.locator('#probability').inner_text()=='未定义'
    page.locator('#slice').fill('0.6')
    page.locator('#direction').select_option('x')
    page.locator('#slice').fill('0')
    assert page.locator('#probability').inner_text()=='未定义'
    page.locator('[data-model=ramp]').click()
    page.locator('summary').click()
    page.locator('#delta').fill('0.3')
    assert '有限厚度体积比' in page.locator('#slab-result').inner_text()
    page.locator('#regression').check()
    page.locator('#front').click()
    page.locator('#top').click()
    page.locator('#camera').click()
    page.locator('#a').fill('1.9')
    assert page.locator('#b').input_value()=='1.9'
    page.locator('#reset').click()
    if page.locator('#play').is_enabled():
        page.locator('#play').click()
        page.wait_for_timeout(220)
        page.locator('#play').click()
        t=page.locator('#progress').input_value()
        page.wait_for_timeout(200)
        assert page.locator('#progress').input_value()==t
        page.locator('#speed').select_option('2')
        page.locator('#reduced').check()
        page.locator('#play').click()
        page.wait_for_timeout(520)
        assert float(page.locator('#progress').input_value())>=1
        page.locator('#play').click()
    page.locator('#reset').click()
    page.locator('h1').click()
    page.keyboard.press('ArrowRight')
    assert page.locator('#progress').input_value()=='1'
    page.keyboard.press('Home')
    assert page.locator('#progress').input_value()=='0'
    for width in [760,390]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
    page.screenshot(path='/tmp/conditional-narrow.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    page.goto(BASE+'#m=triangle&d=x&t=4&c=1&a=0&b=1')
    page.reload()
    page.wait_for_load_state('networkidle')
    assert page.locator('#probability').inner_text()=='1.000', page.locator('main').inner_text()
    page.screenshot(path='/tmp/conditional-triangle.png',full_page=True)
    # GSAP failure must leave all deterministic controls available.
    page.route('**/*gsap*',lambda route:route.abort())
    page.goto(BASE)
    page.reload()
    page.wait_for_load_state('networkidle')
    assert page.locator('#play').is_disabled()
    assert page.locator('#engine-notice').is_visible()
    page.locator('[data-time="4"]').click()
    assert float(page.locator('#probability').inner_text())>0
    assert not errors,errors
    print('PASS',BASE,'desktop/narrow, 3 models x 2 directions, bounds, seek, controls, hash, GSAP fallback; page errors:',errors)
    browser.close()
