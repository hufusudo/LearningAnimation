"""Run against an existing local static server: python browser.test.py [base URL]."""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8765'
URL=BASE.rstrip('/')+'/极限定义的几何直观/'

def seek(page,t):
    page.locator('#progress').fill(str(t))
    assert abs(float(page.locator('#time').inner_text().split()[0])-t)<.06

def snapshot(page):
    return page.locator('#limit-svg').inner_html(),page.locator('#proof').inner_text(),page.locator('#caption').inner_text()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL,wait_until='networkidle')
    assert page.evaluate('!!window.gsap'), 'Network required for normal GSAP playback test'
    for t in [0,2,4,6,9,11,13,16,18,7.35]:seek(page,t)
    before=snapshot(page)
    seek(page,16);seek(page,2);seek(page,7.35)
    assert snapshot(page)==before,'Reverse seek must restore identical state'
    seek(page,6)
    page.locator('#play').click();page.wait_for_timeout(300);page.locator('#play').click()
    stopped=page.locator('#progress').input_value();page.wait_for_timeout(200)
    assert page.locator('#progress').input_value()==stopped,'Pause must freeze the current action'
    assert 6<float(stopped)<8,'Playback must resume at the selected time'
    page.locator('#play').click();page.locator('#speed').select_option('2');page.wait_for_timeout(200);page.locator('#play').click()
    assert float(page.locator('#progress').input_value())>float(stopped)
    seek(page,6)
    page.locator('#epsilon').fill('0.16');assert page.locator('#time').inner_text()=='06.0 s'
    page.locator('#target').fill('4');assert page.locator('#time').inner_text()=='06.0 s'
    assert 'a = 4' in page.locator('#a-label').text_content()
    for mode in ['continuous','discrete']:
        page.locator('#mode-'+mode).click()
        for key in page.locator('#model option').evaluate_all('(options)=>options.map(o=>o.value)'):
            page.locator('#model').select_option(key);seek(page,18)
            assert '已越过' in page.locator('#guarantee-status').text_content()
            assert page.locator('#probe-status').text_content()=='当前点在带内'
            if mode=='discrete':
                assert page.locator('#curve').get_attribute('d')==''
                assert float(page.locator('#probe-slider').input_value()).is_integer()
                assert 'n > N' in page.locator('#proof').inner_text()
            page.locator('#view').select_option('detail');page.locator('#view').select_option('overview')
    seek(page,9)
    page.screenshot(path='/tmp/limit-discrete.png',full_page=True)
    seek(page,10.5)
    assert '充分' not in page.locator('#threshold-label').text_content()
    assert '待更新' in page.locator('#threshold-label').text_content()
    assert '待建立' in page.locator('#guarantee-status').text_content()
    page.locator('#model').select_option('d-monotone')
    page.locator('#epsilon').fill('0.32');seek(page,18)
    page.locator('#probe-slider').fill('400')
    assert '边界' in page.locator('#probe-status').text_content()
    assert '未越过' in page.locator('#guarantee-status').text_content()
    seek(page,6)
    page.locator('#probe-slider').fill('5')
    assert 'n = 5' in page.locator('#probe-output').inner_text()
    assert '未越过' in page.locator('#guarantee-status').text_content()
    page.locator('#follow-script').click()
    assert page.locator('#follow-script').is_disabled()
    page.locator('h1').click();page.keyboard.press('Home');assert page.locator('#progress').input_value()=='0'
    page.keyboard.press('ArrowRight');assert page.locator('#progress').input_value()=='2'
    page.keyboard.press('ArrowLeft');assert page.locator('#progress').input_value()=='0'
    page.locator('#reduce-motion').check();page.locator('#progress').fill('0.5');assert page.locator('#progress').input_value()=='2';seek(page,0);page.locator('#play').click();page.wait_for_timeout(1100);page.locator('#play').click()
    assert float(page.locator('#progress').input_value()) in [2,4,6,9,11,13,16,18]
    seek(page,13)
    page.reload(wait_until='networkidle');assert page.locator('#progress').input_value()=='13'
    assert 'N =' in page.locator('#threshold-label').text_content()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Whole page must not overflow'
    page.screenshot(path='/tmp/limit-narrow.png',full_page=True)
    assert not errors,errors

    # Isolated external-resource failure: the entire teaching process remains browsable.
    fallback=browser.new_page()
    fallback.route('**/*gsap*',lambda route:route.abort())
    fallback.goto(URL,wait_until='networkidle')
    assert fallback.locator('#play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    fallback.locator('#next').click();assert fallback.locator('#progress').input_value()=='2'
    seek(fallback,18);fallback.locator('#epsilon').fill('0.2');assert fallback.locator('#progress').input_value()=='18'
    fallback.close()

    local=browser.new_page(reduced_motion='reduce')
    local.goto(Path(__file__).with_name('index.html').resolve().as_uri(),wait_until='networkidle')
    assert local.locator('#reduce-motion').is_checked()
    seek(local,18)
    assert '当前点在带内' in local.locator('#probe-status').text_content()
    local.locator('#mode-discrete').click();seek(local,18)
    assert 'n > N' in local.locator('#proof').inner_text()
    local.close()
    browser.close()
    print('PASS: HTTP/file, all 8 models, deterministic seek, pause/resume, speed, parameters, keyboard, reduced motion, GSAP fallback, narrow overflow; screenshots in /tmp/limit-*.png')
