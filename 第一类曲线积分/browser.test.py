"""本模块浏览器回归；需先启动静态服务。"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
URL = os.environ.get('CURVE_DEMO_URL', 'http://127.0.0.1:8013/第一类曲线积分/index.html')
OUT = Path(os.environ.get('CURVE_TEST_OUTPUT', '/tmp/curve-integral-qa'))
OUT.mkdir(exist_ok=True, parents=True)

def scrub(page, value):
    page.locator('#progress').evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input"));}', value)

def snapshot(page):
    return page.locator('#scene').evaluate('(e)=>e.outerHTML')

def time(page):
    return float(page.locator('#scene').get_attribute('data-time'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROME_PATH', '/opt/google/chrome/chrome'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1100}, device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    assert page.evaluate('!!window.gsap && !!window.katex'), 'online dependencies unavailable'
    assert len(page.locator('#wire path').all())==200
    page.locator('#steps button').nth(5).click()
    assert page.locator('#local-formula').text_content().strip()
    page.screenshot(path=str(OUT/'desktop-micro.png'),full_page=True)
    scrub(page,615); before=snapshot(page)
    scrub(page,900); scrub(page,615)
    assert before==snapshot(page), 'seek is not deterministic'
    # Playback freezes exactly, then resumes at the selected speed.
    page.locator('#play').click();page.wait_for_timeout(300);page.locator('#play').click()
    paused=time(page);page.wait_for_timeout(180);assert time(page)==paused
    page.locator('#speed').select_option('2');page.locator('#play').click();page.wait_for_timeout(300);page.locator('#play').click()
    assert .25<time(page)-paused<1.2
    # Form controls do not steal shortcuts; stage keyboard controls work.
    page.locator('#reset').click();page.locator('#scene').click(position={'x':10,'y':10});page.keyboard.press('ArrowRight');assert time(page)>0
    page.keyboard.press('Home');assert time(page)==0
    page.locator('#curve').focus();page.keyboard.press('ArrowRight');assert time(page)==0
    # Keep the same moment on parameter changes; every curve/density combination is finite.
    scrub(page,400);keep=time(page)
    for curve in ['parabola','semicircle','line']:
        keep=time(page)
        page.locator('#curve').select_option(curve)
        assert abs(time(page)-keep)<.002
        for density in ['uniform','gradient']:
            page.locator('#density').select_option(density)
            for n in [4,9,128]:
                page.locator('#segments').evaluate('(e,n)=>{e.value=n;e.dispatchEvent(new Event("input"));}',n)
                page.locator('#selected').evaluate('(e,n)=>{e.value=n;e.dispatchEvent(new Event("input"));}',n)
                scrub(page,1000)
                assert 'NaN' not in page.locator('#scene').text_content()
                actual=float(page.locator('#sum-value').text_content())
                expected=page.evaluate('CurveModel.stats(CurveModel.CURVES[document.querySelector("#curve").value],CurveModel.DENSITIES[document.querySelector("#density").value],+document.querySelector("#segments").value).M')
                assert abs(actual-expected)<.00006
    page.locator('#curve').select_option('semicircle');page.locator('#density').select_option('gradient')
    page.locator('#segments').evaluate('(e)=>{e.value=9;e.dispatchEvent(new Event("input"));}')
    page.locator('#selected').evaluate('(e)=>{e.value=9;e.dispatchEvent(new Event("input"));}')
    page.locator('#steps button').nth(5).click()
    assert '−' in page.locator('#dy-label').text_content() or '-' in page.locator('#dy-label').text_content()
    page.screenshot(path=str(OUT/'negative-slope.png'),full_page=True)
    # First ten segments retain individual steps; the tail is one bounded sweep.
    for n in [10,11,128]:
        page.locator('#segments').evaluate('(e,n)=>{e.value=n;e.dispatchEvent(new Event("input"));}',n)
        page.locator('#steps button').nth(5).click()
        for count in range(1,11):
            page.locator('#next').click()
            assert page.locator('#sum-count').text_content()==f'已累加 {count} / {n} 段'
        if n>10:
            seq=page.evaluate('CurveChoreo.build(+document.querySelector("#segments").value)')
            assert abs(time(page)-21.7)<.002
            scrub(page,round(22.3/seq['duration']*1000))
            partial=snapshot(page)
            first_ten=page.evaluate('CurveModel.stats(CurveModel.CURVES[document.querySelector("#curve").value],CurveModel.DENSITIES[document.querySelector("#density").value],+document.querySelector("#segments").value).segs.slice(0,10).reduce((sum,s)=>sum+s.dm,0)')
            current=float(page.locator('#sum-value').text_content())
            assert current>first_ten
            assert page.locator('#mass-token').get_attribute('visibility')=='hidden'
            if n==128:
                page.screenshot(path=str(OUT/'quick-sweep.png'),full_page=True)
            scrub(page,1000);scrub(page,round(22.3/seq['duration']*1000))
            assert partial==snapshot(page)
            page.locator('#next').click()
            assert abs(time(page)-22.9)<.002
            assert page.locator('#sum-count').text_content()==f'已累加 {n} / {n} 段'
    # Reduced motion toggle, event-only seek, and no accidental restart near completion.
    page.locator('#reduce-motion').check();assert page.locator('body').get_attribute('data-motion')=='reduced'
    scrub(page,999);assert time(page)>0
    page.locator('#reduce-motion').uncheck();assert page.locator('body').get_attribute('data-motion')=='full'
    scrub(page,970);page.locator('#play').click();page.wait_for_timeout(80);page.locator('#reduce-motion').check()
    assert time(page)>15, 'reducing motion restarted the lesson'
    page.locator('#reset').click();page.locator('#play').click();page.wait_for_timeout(80)
    assert time(page)==2.4
    page.locator('#play').click()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'whole-page overflow'
    page.screenshot(path=str(OUT/'narrow.png'),full_page=True)
    # Reload restores the saved time and parameters.
    saved=page.url;page.reload(wait_until='networkidle');assert page.url==saved
    assert not errors, errors
    # All local scripts also run through file:// with both CDNs missing.
    offline=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    offline.route('https://**/*',lambda route:route.abort())
    local=offline.new_page();local_errors=[];local.on('pageerror',lambda e:local_errors.append(str(e)))
    for address in [ROOT.joinpath('index.html').as_uri(),URL]:
        local.goto(address,wait_until='networkidle')
        assert local.locator('#play').is_disabled()
        assert local.locator('#notice').is_visible()
        assert local.locator('#reduce-motion').is_checked()
        local.locator('#next').click();assert time(local)==2.4
        scrub(local,1000)
        assert float(local.locator('#sum-value').text_content())>0
        assert 'M = lim' in local.locator('#limit-formula').text_content()
    assert not local_errors,local_errors
    offline.close();browser.close()
print('PASS: playback/pause/speed, deterministic seek, keyboard, 18 parameter cases, negative slope, reduced motion, narrow overflow, hash, file/HTTP CDN fallback')
print('Screenshots:',OUT)
